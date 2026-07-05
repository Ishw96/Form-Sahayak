/**
 * @fileoverview Multi-provider AI service for Form Sahayak.
 *
 * Providers:
 *   - Gemini (primary, free tier available)
 *   - Claude (BYOK)
 *   - OpenAI (BYOK)
 *
 * All API keys are held in-memory only — **never** persisted to localStorage,
 * IndexedDB, cookies, or any other storage mechanism.
 *
 * @module ai-service
 */

import { sleep } from './utils.js';

const LOG_PREFIX = '[FormSahayak]';

/* ------------------------------------------------------------------ */
/*  Language map                                                       */
/* ------------------------------------------------------------------ */

/** @type {Record<string, string>} Prompt language instructions keyed by language id */
const LANGUAGE_MAP = {
  hinglish: 'Sabhi explanations Hinglish (Hindi-English mix) mein likho',
  hindi: 'Sabhi explanations shuddh Hindi mein likho',
  english: 'Write all explanations in simple English',
  bengali: 'Sabhi explanations Bengali (বাংলা) mein likho',
  tamil: 'Sabhi explanations Tamil (தமிழ்) mein likho',
  telugu: 'Sabhi explanations Telugu (తెలుగు) mein likho',
  marathi: 'Sabhi explanations Marathi (मराठी) mein likho',
  gujarati: 'Sabhi explanations Gujarati (ગુજરાતી) mein likho',
  kannada: 'Sabhi explanations Kannada (ಕನ್ನಡ) mein likho',
  malayalam: 'Sabhi explanations Malayalam (മലയാളം) mein likho',
  punjabi: 'Sabhi explanations Punjabi (ਪੰਜਾਬੀ) mein likho',
  odia: 'Sabhi explanations Odia (ଓଡ଼ିଆ) mein likho',
  assamese: 'Sabhi explanations Assamese (অসমীয়া) mein likho',
  urdu: 'Sabhi explanations Urdu (اردو) mein likho',
};

/* ------------------------------------------------------------------ */
/*  Provider Descriptors                                               */
/* ------------------------------------------------------------------ */

/**
 * @typedef {Object} ProviderDescriptor
 * @property {string}  id
 * @property {string}  name
 * @property {string}  description
 * @property {boolean} freeAvailable
 */

/** @type {ProviderDescriptor[]} */
const PROVIDERS = [
  {
    id: 'gemini',
    name: 'Google Gemini',
    description: 'Gemini 2.0 Flash — fast multimodal model with a generous free tier.',
    freeAvailable: true,
  },
  {
    id: 'claude',
    name: 'Anthropic Claude',
    description: 'Claude Sonnet — excellent at structured output. Requires your own API key.',
    freeAvailable: false,
  },
  {
    id: 'openai',
    name: 'OpenAI GPT-4o',
    description: 'GPT-4o — strong vision capabilities. Requires your own API key.',
    freeAvailable: false,
  },
];

/* ------------------------------------------------------------------ */
/*  AIService                                                          */
/* ------------------------------------------------------------------ */

export class AIService {
  constructor() {
    /** @type {string} Current provider id */
    this.currentProvider = 'gemini';

    /**
     * In-memory API key storage per provider.
     * Keys are **never** written to any persistent storage.
     * @type {Record<string, string>}
     * @private
     */
    this._keys = {};
  }

  /* ------------------------------------------------------------------ */
  /*  Provider management                                                */
  /* ------------------------------------------------------------------ */

  /**
   * Switch the active AI provider.
   * @param {'gemini'|'claude'|'openai'} providerName
   */
  setProvider(providerName) {
    const valid = PROVIDERS.find((p) => p.id === providerName);
    if (!valid) {
      throw new Error(`Unknown provider "${providerName}". Supported: ${PROVIDERS.map((p) => p.id).join(', ')}`);
    }
    this.currentProvider = providerName;
    console.log(LOG_PREFIX, 'Provider set to:', providerName);
  }

  /**
   * Store an API key for the current provider (in-memory only).
   * @param {string} key
   */
  setApiKey(key) {
    if (!key || typeof key !== 'string' || key.trim().length === 0) {
      throw new Error('API key must be a non-empty string.');
    }
    this._keys[this.currentProvider] = key.trim();
    console.log(LOG_PREFIX, `API key set for ${this.currentProvider} (in-memory only)`);
  }

  /**
   * Retrieve the stored key for the current provider.
   * @returns {string|undefined}
   */
  getApiKey() {
    return this._keys[this.currentProvider];
  }

  /**
   * List all supported providers.
   * @returns {ProviderDescriptor[]}
   */
  getSupportedProviders() {
    return [...PROVIDERS];
  }

  /* ------------------------------------------------------------------ */
  /*  Core analysis & Detection                                          */
  /* ------------------------------------------------------------------ */

  /**
   * Group images into distinct forms using heuristics (EXIF or filename matching).
   * No AI call needed. Very fast.
   *
   * @param {{ base64: string, mediaType: string, file?: File }[]} images
   * @returns {Promise<{ forms: { image_indices: number[] }[] }>}
   */
  async groupImagesHeuristically(images) {
    if (!images || images.length === 0) {
      throw new Error('At least one image is required for grouping.');
    }

    if (images.length === 1) {
      return { forms: [{ image_indices: [0] }] };
    }

    const groups = [];
    let currentGroup = [0];
    let lastTime = await this._getExifTimeOrTimestamp(images[0]);

    for (let i = 1; i < images.length; i++) {
      const currentTime = await this._getExifTimeOrTimestamp(images[i]);
      
      // If timestamps are within 60 seconds (60000ms), group them together
      if (lastTime && currentTime && Math.abs(currentTime - lastTime) <= 60000) {
        currentGroup.push(i);
      } else if (images[i].file && images[i-1].file && 
                 this._areFilenamesSequential(images[i-1].file.name, images[i].file.name)) {
        // Fallback: Check if filenames look like sequentially taken photos (e.g., IMG_001.jpg, IMG_002.jpg)
        currentGroup.push(i);
      } else {
        groups.push({ image_indices: currentGroup });
        currentGroup = [i];
      }
      lastTime = currentTime;
    }
    
    if (currentGroup.length > 0) {
      groups.push({ image_indices: currentGroup });
    }

    return { forms: groups };
  }

  /**
   * Helper to extract EXIF DateTimeOriginal or fallback to file.lastModified
   * @private
   */
  async _getExifTimeOrTimestamp(img) {
    if (!img.file) return null;
    try {
      if (window.exifr) {
        const exifData = await window.exifr.parse(img.file);
        if (exifData && exifData.DateTimeOriginal) {
          return exifData.DateTimeOriginal.getTime();
        }
      }
      return img.file.lastModified || null;
    } catch (e) {
      return img.file.lastModified || null;
    }
  }

  /**
   * Helper to check if two filenames look sequential.
   * Very basic heuristic.
   * @private
   */
  _areFilenamesSequential(name1, name2) {
    if (!name1 || !name2) return false;
    
    // Extract numbers from filenames
    const num1 = name1.match(/\d+/g);
    const num2 = name2.match(/\d+/g);
    
    if (num1 && num2 && num1.length > 0 && num2.length > 0) {
      const n1 = parseInt(num1[num1.length - 1], 10);
      const n2 = parseInt(num2[num2.length - 1], 10);
      return Math.abs(n1 - n2) === 1;
    }
    return false;
  }

  /**
   * Analyse one or more form images using the active AI provider.
   *
   * @param {{ base64: string, mediaType: string }[]} images
   * @param {Object}  [options]
   * @param {string}  [options.language='hinglish']
   * @param {number}  [options.maxRetries=2]
   * @returns {Promise<Object>} Parsed analysis JSON
   */
  async analyzeForm(images, options = {}) {
    const language = options.language ?? 'hinglish';
    const maxRetries = options.maxRetries ?? 2;

    if (!images || images.length === 0) {
      throw new Error('At least one image is required for analysis.');
    }

    const apiKey = this.getApiKey();
    if (!apiKey && this.currentProvider !== 'gemini') {
      throw new Error(
        `No API key set for provider "${this.currentProvider}". ` +
        'Please add your API key in Settings before analysing.',
      );
    }

    let lastError = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          const backoff = Math.min(1000 * Math.pow(2, attempt), 8000);
          console.log(LOG_PREFIX, `Retry ${attempt}/${maxRetries} after ${backoff}ms`);
          await sleep(backoff);
        }

        const { url, fetchOptions } = this._buildRequest(images, language, apiKey);

        console.log(LOG_PREFIX, `Calling ${this.currentProvider} (attempt ${attempt + 1})…`);
        const response = await fetch(url, fetchOptions);

        // Handle retryable errors
        if (response.status === 429 || response.status >= 500) {
          const body = await response.text().catch(() => '');
          lastError = new Error(`${this.currentProvider} returned ${response.status}: ${body.slice(0, 200)}`);
          console.warn(LOG_PREFIX, lastError.message);

          if (attempt < maxRetries) continue;
          throw this._wrapError(lastError);
        }

        // Handle non-retryable errors
        if (!response.ok) {
          const body = await response.text().catch(() => '');
          throw this._wrapError(
            new Error(`${this.currentProvider} returned ${response.status}: ${body.slice(0, 500)}`),
          );
        }

        // Parse provider-specific response
        const data = await response.json();
        const rawText = this._extractTextFromResponse(data);
        const parsed = this._extractJSON(rawText);
        const validated = this._validateResponse(parsed);

        console.log(LOG_PREFIX, 'Analysis complete:', validated.form_name);
        return validated;
      } catch (err) {
        lastError = err;

        // Only retry on network / server errors
        const isRetryable =
          err.name === 'TypeError' || // fetch network failure
          err.message?.includes('429') ||
          err.message?.includes('500') ||
          err.message?.includes('502') ||
          err.message?.includes('503');

        if (isRetryable && attempt < maxRetries) {
          console.warn(LOG_PREFIX, 'Retryable error:', err.message);
          continue;
        }

        throw this._wrapError(err);
      }
    }

    // Should be unreachable, but safeguard
    throw this._wrapError(lastError || new Error('Analysis failed after all retries.'));
  }

  /* ------------------------------------------------------------------ */
  /*  Request builders                                                   */
  /* ------------------------------------------------------------------ */

  /**
   * Route to the correct provider-specific builder.
   * @private
   * @param {{ base64: string, mediaType: string }[]} images
   * @param {string} language
   * @param {string} apiKey
   * @returns {{ url: string, fetchOptions: RequestInit }}
   */
  _buildRequest(images, language, apiKey) {
    switch (this.currentProvider) {
      case 'gemini': return this._buildGeminiRequest(images, language, apiKey);
      case 'claude': return this._buildClaudeRequest(images, language, apiKey);
      case 'openai': return this._buildOpenAIRequest(images, language, apiKey);
      default:
        throw new Error(`No request builder for provider "${this.currentProvider}".`);
    }
  }

  /**
   * Build a custom request with a specific prompt (used for fast tasks like detectForms).
   * @private
   */
  _buildCustomRequest(images, customPrompt, apiKey) {
    const originalProvider = this.currentProvider;
    // Temporary override logic if needed, but we can just use the provider-specific builders
    switch (originalProvider) {
      case 'gemini':
        return this._buildGeminiRequestWithPrompt(images, customPrompt, apiKey);
      case 'claude':
        return this._buildClaudeRequestWithPrompt(images, customPrompt, apiKey);
      case 'openai':
        return this._buildOpenAIRequestWithPrompt(images, customPrompt, apiKey);
      default:
        throw new Error(`No request builder for provider "${originalProvider}".`);
    }
  }

  _buildGeminiRequestWithPrompt(images, prompt, apiKey) {
    const imageParts = images.map((img) => ({
      inlineData: { mimeType: img.mediaType, data: img.base64 },
    }));
    const body = {
      contents: [{ parts: [...imageParts, { text: prompt }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 1024 },
    };
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['x-api-key'] = apiKey;
    return { url: `/api/analyze-form`, fetchOptions: { method: 'POST', headers, body: JSON.stringify(body) } };
  }

  _buildClaudeRequestWithPrompt(images, prompt, apiKey) {
    const imageContent = images.map((img) => ({
      type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.base64 },
    }));
    const body = {
      model: 'claude-sonnet-4-20250514', max_tokens: 1024,
      messages: [{ role: 'user', content: [...imageContent, { type: 'text', text: prompt }] }],
    };
    return {
      url: 'https://api.openai.com/v1/messages', // Using proxy/claude endpoint usually, but left as is for reference
      fetchOptions: { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }, body: JSON.stringify(body) },
    };
  }

  _buildOpenAIRequestWithPrompt(images, prompt, apiKey) {
    const imageContent = images.map((img) => ({
      type: 'image_url', image_url: { url: `data:${img.mediaType};base64,${img.base64}`, detail: 'low' },
    }));
    const body = {
      model: 'gpt-4o', max_tokens: 1024, temperature: 0.1,
      messages: [{ role: 'user', content: [...imageContent, { type: 'text', text: prompt }] }],
    };
    return {
      url: 'https://api.openai.com/v1/chat/completions',
      fetchOptions: { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body: JSON.stringify(body) },
    };
  }

  /**
   * Build a Gemini generateContent request.
   * @param {{ base64: string, mediaType: string }[]} images
   * @param {string} language
   * @param {string} apiKey
   * @returns {{ url: string, fetchOptions: RequestInit }}
   */
  _buildGeminiRequest(images, language, apiKey) {
    const prompt = this._buildPrompt(language);

    const imageParts = images.map((img) => ({
      inlineData: {
        mimeType: img.mediaType,
        data: img.base64,
      },
    }));

    const body = {
      contents: [
        {
          parts: [
            ...imageParts,
            { text: prompt },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 4096,
      },
    };

    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) {
      headers['x-api-key'] = apiKey;
    }

    return {
      url: `/api/analyze-form`,
      fetchOptions: {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(body),
      },
    };
  }

  /**
   * Build an Anthropic Claude Messages API request.
   * @param {{ base64: string, mediaType: string }[]} images
   * @param {string} language
   * @param {string} apiKey
   * @returns {{ url: string, fetchOptions: RequestInit }}
   */
  _buildClaudeRequest(images, language, apiKey) {
    const prompt = this._buildPrompt(language);

    const imageContent = images.map((img) => ({
      type: 'image',
      source: {
        type: 'base64',
        media_type: img.mediaType,
        data: img.base64,
      },
    }));

    const body = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [
            ...imageContent,
            { type: 'text', text: prompt },
          ],
        },
      ],
    };

    return {
      url: 'https://api.anthropic.com/v1/messages',
      fetchOptions: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify(body),
      },
    };
  }

  /**
   * Build an OpenAI Chat Completions request with vision.
   * @param {{ base64: string, mediaType: string }[]} images
   * @param {string} language
   * @param {string} apiKey
   * @returns {{ url: string, fetchOptions: RequestInit }}
   */
  _buildOpenAIRequest(images, language, apiKey) {
    const prompt = this._buildPrompt(language);

    const imageContent = images.map((img) => ({
      type: 'image_url',
      image_url: {
        url: `data:${img.mediaType};base64,${img.base64}`,
        detail: 'high',
      },
    }));

    const body = {
      model: 'gpt-4o',
      max_tokens: 4096,
      temperature: 0.2,
      messages: [
        {
          role: 'user',
          content: [
            ...imageContent,
            { type: 'text', text: prompt },
          ],
        },
      ],
    };

    return {
      url: 'https://api.openai.com/v1/chat/completions',
      fetchOptions: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      },
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Prompt                                                             */
  /* ------------------------------------------------------------------ */

  /**
   * Build the system/analysis prompt.
   * @param {string} language  Key from LANGUAGE_MAP
   * @returns {string}
   */
  _buildPrompt(language) {
    const langInstruction = LANGUAGE_MAP[language] || LANGUAGE_MAP.hinglish;

    return `You are "Form Sahayak" — an expert assistant that helps Indian citizens understand bank and government forms.

TASK:
Carefully study the attached form image(s). Identify the form (Indian bank, post office, insurance, or government form) and explain every visible field so that a common person can fill it correctly.

OUTPUT RULES:
1. Return ONLY valid JSON — no markdown, no backticks, no extra text before or after the JSON.
2. Follow this exact JSON schema:
{
  "form_name": "Full official name of the form",
  "purpose": "One-line description of what this form is used for",
  "fields": [
    {
      "label": "Exact field label as printed on the form",
      "explanation": "Simple 1-2 line explanation of what to write here",
      "example": "A realistic Indian example value",
      "category": "Choose one: personal | address | contact | family | financial | documents | other",
      "display_type": "Choose 'boxed' OR 'plain'",
      "confidence": "Choose one: high | medium | low — how confident you are about this field's interpretation"
    }
  ],
  "documents_needed": ["List of documents typically required to submit this form"],
  "tips": "A single string containing 2-3 helpful tips for filling or submitting this form",
  "handwriting_notes": "If any field is already filled with handwriting, provide a brief assessment here: mention which fields appear filled, if handwriting is legible, and any potential errors you spot. If no handwriting is visible, set this to null."
}

GUIDELINES:
- Cover ALL visible fields in the order they appear on the form.
- Keep explanations simple — imagine explaining to someone who has never filled a bank form.
- For examples, use realistic Indian names, addresses, PAN numbers (ABCDE1234F), Aadhaar patterns (XXXX XXXX 1234), IFSC codes, etc.
- display_type = 'boxed' SIRF short structured values ke liye do (mobile, PAN, PIN, account number, DOB, OTP jaisa) — max 15 characters. Baaki sab (address, email, sentences, occupation, names) ke liye 'plain' do.
- confidence = 'high' for clearly printed, standard fields. 'medium' for partially visible or ambiguous fields. 'low' for barely readable or uncertain fields.
- If multiple pages are provided, treat them as parts of the same form.
- Add a tip: "Yeh sirf guide hai — final confirmation apne bank branch se zaroor karein" (or equivalent in the target language).

LANGUAGE:
${langInstruction}

Remember: Return ONLY the JSON object. No explanation text outside the JSON.`;
  }

  /* ------------------------------------------------------------------ */
  /*  Response parsing                                                   */
  /* ------------------------------------------------------------------ */

  /**
   * Extract the raw text from a provider-specific API response.
   * @private
   * @param {Object} data  Parsed JSON response body
   * @returns {string}
   */
  _extractTextFromResponse(data) {
    // Gemini
    if (data.candidates) {
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) return text;
      throw new Error('Gemini response did not contain expected text content.');
    }

    // Claude
    if (data.content && Array.isArray(data.content)) {
      const textBlock = data.content.find((b) => b.type === 'text');
      if (textBlock?.text) return textBlock.text;
      throw new Error('Claude response did not contain expected text content.');
    }

    // OpenAI
    if (data.choices) {
      const text = data.choices?.[0]?.message?.content;
      if (text) return text;
      throw new Error('OpenAI response did not contain expected text content.');
    }

    throw new Error('Unrecognised API response structure.');
  }

  /**
   * Extract valid JSON from raw response text.
   * Handles:
   *   - Clean JSON (starts with `{`)
   *   - Markdown-fenced JSON (` ```json ... ``` `)
   *   - JSON buried in surrounding prose
   *
   * @param {string} text
   * @returns {Object} Parsed JSON object
   * @throws {Error} If no valid JSON can be extracted
   */
  _extractJSON(text) {
    if (!text || typeof text !== 'string') {
      throw new Error('Empty or non-string response received from AI provider.');
    }

    let cleaned = text.trim();

    // Strip markdown code fences
    const fenceRegex = /```(?:json)?\s*\n?([\s\S]*?)```/;
    const fenceMatch = cleaned.match(fenceRegex);
    if (fenceMatch) {
      cleaned = fenceMatch[1].trim();
    }

    // Try direct parse first
    try {
      return JSON.parse(cleaned);
    } catch {
      // Fall through to brace extraction
    }

    // Extract the first top-level JSON object by brace matching
    const startIdx = cleaned.indexOf('{');
    if (startIdx === -1) {
      throw new Error('No JSON object found in AI response.');
    }

    let depth = 0;
    let endIdx = -1;
    let inString = false;
    let escape = false;

    for (let i = startIdx; i < cleaned.length; i++) {
      const ch = cleaned[i];

      if (escape) {
        escape = false;
        continue;
      }

      if (ch === '\\' && inString) {
        escape = true;
        continue;
      }

      if (ch === '"') {
        inString = !inString;
        continue;
      }

      if (inString) continue;

      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          endIdx = i;
          break;
        }
      }
    }

    if (endIdx === -1) {
      throw new Error('Malformed JSON in AI response — unbalanced braces.');
    }

    const jsonStr = cleaned.substring(startIdx, endIdx + 1);

    try {
      return JSON.parse(jsonStr);
    } catch (err) {
      throw new Error(`Failed to parse extracted JSON: ${err.message}`);
    }
  }

  /**
   * Validate the parsed response against the expected schema.
   *
   * Required:
   *   - `form_name` (string)
   *   - `fields`    (array with ≥ 1 entry, each having `label` and `explanation`)
   *
   * Optional (defaults applied):
   *   - `purpose`, `documents_needed`, `tips`
   *
   * @param {Object} parsed
   * @returns {Object} Validated (and lightly normalised) object
   * @throws {Error} If essential fields are missing
   */
  _validateResponse(parsed) {
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('AI response is not a valid JSON object.');
    }

    // Handle case where AI wraps single form in a "forms" array
    let formObj = parsed;
    if (parsed.forms && Array.isArray(parsed.forms) && parsed.forms.length > 0) {
      formObj = parsed.forms[0];
    }

    // form_name
    if (!formObj.form_name || typeof formObj.form_name !== 'string') {
      throw new Error('AI response missing required field: "form_name".');
    }

    // Normalize: if AI returned sections, use them; if only fields, wrap in a default section
    if (!Array.isArray(formObj.sections) || formObj.sections.length === 0) {
      if (Array.isArray(formObj.fields) && formObj.fields.length > 0) {
        formObj.sections = [{ section_name: 'Form Details', icon: '📋', fields: formObj.fields }];
      } else {
        throw new Error('AI response must contain "sections" or "fields" array.');
      }
    }

    // Validate each field in each section
    formObj.sections.forEach((sec, sIdx) => {
      if (!Array.isArray(sec.fields)) sec.fields = [];
      for (let i = 0; i < sec.fields.length; i++) {
        const f = sec.fields[i];
        if (!f || typeof f.label !== 'string' || typeof f.explanation !== 'string') {
          throw new Error(
            `Field at section ${sIdx} index ${i} is invalid — must have "label" and "explanation".`,
          );
        }
        if (f.example === undefined) f.example = '';
        if (!f.confidence || !['high', 'medium', 'low'].includes(f.confidence)) {
          f.confidence = 'medium';
        }
      }
    });

    // Apply defaults for optional top-level fields
    return {
      form_name: formObj.form_name,
      purpose: formObj.purpose || '',
      confidence: formObj.confidence || 'medium',
      sections: formObj.sections,
      documents_needed: Array.isArray(formObj.documents_needed) ? formObj.documents_needed : [],
      tips: Array.isArray(formObj.tips) ? formObj.tips.join(' ') : (formObj.tips || ''),
      handwriting_notes: formObj.handwriting_notes || null,
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Error handling                                                     */
  /* ------------------------------------------------------------------ */

  /**
   * Wrap a raw error into a user-friendly message.
   * @private
   * @param {Error} err
   * @returns {Error}
   */
  _wrapError(err) {
    const msg = err?.message || String(err);

    // Network / CORS
    if (err?.name === 'TypeError' && msg.includes('Failed to fetch')) {
      return new Error(
        'Network error — unable to reach the AI service. Please check your internet connection and try again.',
      );
    }

    // Rate limiting
    if (msg.includes('429')) {
      return new Error(
        'Rate limit exceeded. The free tier has usage limits — please wait a minute and try again, or switch to a BYOK provider.',
      );
    }

    // Auth
    if (msg.includes('401') || msg.includes('403') || msg.toLowerCase().includes('api key')) {
      return new Error(
        'Authentication failed. Please verify your API key in Settings.',
      );
    }

    // Server errors
    if (msg.includes('500') || msg.includes('502') || msg.includes('503')) {
      return new Error(
        'The AI service is temporarily unavailable. Please try again in a few moments.',
      );
    }

    // JSON parse issues
    if (msg.includes('JSON') || msg.includes('parse')) {
      return new Error(
        'The AI returned an unexpected response format. Please try again — if the issue persists, try a different form image.',
      );
    }

    // Validation
    if (msg.includes('missing required field') || msg.includes('invalid')) {
      return new Error(
        `Analysis incomplete: ${msg}. Please try again with a clearer image.`,
      );
    }

    // Fallback
    return new Error(`Analysis failed: ${msg}`);
  }

  /* ------------------------------------------------------------------ */
  /*  Text follow-up (no image re-send!)                                 */
  /* ------------------------------------------------------------------ */

  /**
   * Send a text-only follow-up question.
   * Sends previous AI result JSON as context + new question.
   * Does NOT re-send images (cost optimization).
   *
   * @param {string} question — user's follow-up question
   * @param {string} contextJson — previous AI result as JSON string
   * @param {string} language — language key
   * @returns {Promise<string>} AI text response
   */
  async sendTextMessage(question, contextJson, language = 'hinglish') {
    const langInstruction = LANGUAGE_MAP[language] || LANGUAGE_MAP.hinglish;

    let systemPrompt = `You are "Form Sahayak" — an expert assistant that helps Indian citizens understand bank and government forms. ${langInstruction}.`;

    if (contextJson) {
      systemPrompt += `\n\nHere is the previously analyzed form data for context:\n${contextJson}\n\nAnswer the user's question based on this context. Be simple, clear, and helpful.`;
    }

    const body = {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: question }
      ],
      language: language
    };

    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Chat request failed with status ${response.status}`);
    }

    const data = await response.json();

    // Extract text from OpenAI-compatible response
    if (data.choices?.[0]?.message?.content) {
      return data.choices[0].message.content;
    }

    throw new Error('Unexpected response format from chat API');
  }
}
