/**
 * @fileoverview SpeechService — Text-to-Speech for reading form explanations
 * aloud in Indian languages using the Web Speech API.
 * Part of Form Sahayak PWA.
 * @module speech-service
 */

/**
 * BCP 47 language tag mapping for Indian languages.
 * @type {Object<string, string>}
 */
const LANG_MAP = {
  'hinglish': 'hi-IN',
  'hindi': 'hi-IN',
  'english': 'en-IN',
  'bengali': 'bn-IN',
  'tamil': 'ta-IN',
  'telugu': 'te-IN',
  'marathi': 'mr-IN',
  'gujarati': 'gu-IN',
  'kannada': 'kn-IN',
  'malayalam': 'ml-IN',
  'punjabi': 'pa-IN',
  'odia': 'or-IN',
  'assamese': 'as-IN',
  'urdu': 'ur-IN',
};

/**
 * Manages text-to-speech playback for form field explanations
 * using the Web Speech API with support for multiple Indian languages.
 *
 * @example
 * const speech = new SpeechService();
 * await speech.init();
 * speech.setLanguage('hindi');
 * speech.speakText('Yeh aapka naam hai');
 */
export class SpeechService {
  constructor() {
    /** @type {boolean} */
    this.isPlaying = false;

    /** @type {boolean} */
    this.isPaused = false;

    /** @type {number} */
    this.currentFieldIndex = -1;

    /** @type {number} Speech rate (0.5–2.0) */
    this.rate = 1.0;

    /** @type {string} BCP 47 language tag */
    this.selectedLang = 'hi-IN';

    /** @type {SpeechSynthesisVoice[]} */
    this._voices = [];

    /** @type {SpeechSynthesisUtterance|null} */
    this._currentUtterance = null;

    /** @type {Array<{label: string, explanation: string}>|null} */
    this._fields = null;

    /** @type {Function|null} */
    this._onFieldStart = null;

    /** @type {Function|null} */
    this._onComplete = null;

    /** @type {Function|null} Bound handler for cleanup */
    this._voicesChangedHandler = null;
  }

  // ───────────────────────── Lifecycle ─────────────────────────

  /**
   * Initialise the service — loads available voices.
   * Voices may load asynchronously in some browsers, so this method
   * listens for the `voiceschanged` event and resolves when at least
   * one voice is available (or after a 3-second timeout).
   *
   * @returns {Promise<void>}
   */
  init() {
    if (!this.isSupported) {
      console.warn('[SpeechService] Web Speech API not supported in this browser.');
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      const synth = window.speechSynthesis;

      const loadVoices = () => {
        this._voices = synth.getVoices() || [];
        if (this._voices.length > 0) {
          this._selectBestVoice();
        }
      };

      // Some browsers populate voices synchronously
      loadVoices();
      if (this._voices.length > 0) {
        resolve();
        return;
      }

      // Others fire voiceschanged asynchronously
      let resolved = false;
      this._voicesChangedHandler = () => {
        loadVoices();
        if (!resolved && this._voices.length > 0) {
          resolved = true;
          resolve();
        }
      };
      synth.addEventListener('voiceschanged', this._voicesChangedHandler);

      // Safety timeout so we never hang
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          loadVoices(); // one last try
          resolve();
        }
      }, 3000);
    });
  }

  // ───────────────────────── Configuration ─────────────────────

  /**
   * Set the speech language.
   *
   * @param {string} langCode — one of: hinglish, hindi, english, bengali,
   *   tamil, telugu, marathi, gujarati, kannada, malayalam, punjabi,
   *   odia, assamese, urdu.
   */
  setLanguage(langCode) {
    const normalized = (langCode || '').toLowerCase().trim();
    const tag = LANG_MAP[normalized];

    if (!tag) {
      console.warn(`[SpeechService] Unknown language "${langCode}", defaulting to hi-IN.`);
      this.selectedLang = 'hi-IN';
    } else {
      this.selectedLang = tag;
    }

    // Re-select voice for the new language
    this._selectBestVoice();
  }

  /**
   * Set the speech rate.
   *
   * @param {number} rate — value between 0.5 and 2.0.
   */
  setRate(rate) {
    const r = Number(rate);
    if (Number.isNaN(r)) {
      console.warn('[SpeechService] Invalid rate, keeping current:', this.rate);
      return;
    }
    this.rate = Math.max(0.5, Math.min(2.0, r));
  }

  // ───────────────────────── Playback ──────────────────────────

  /**
   * Speak a single piece of text.
   *
   * @param {string}   text  — text to speak.
   * @param {Function} [onEnd] — optional callback fired when speech ends.
   */
  speakText(text, onEnd) {
    if (!this.isSupported || !text) {
      if (typeof onEnd === 'function') onEnd();
      return;
    }

    // Cancel any ongoing speech first
    this._cancelSynth();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = this.selectedLang;
    utterance.rate = this.rate;

    // Assign voice if we found a match
    const voice = this._findVoice(this.selectedLang);
    if (voice) {
      utterance.voice = voice;
    }

    utterance.onend = () => {
      this.isPlaying = false;
      this._currentUtterance = null;
      if (typeof onEnd === 'function') onEnd();
    };

    utterance.onerror = (event) => {
      // 'interrupted' and 'canceled' are expected when we call stop()
      if (event.error !== 'interrupted' && event.error !== 'canceled') {
        console.error('[SpeechService] Utterance error:', event.error);
      }
      this.isPlaying = false;
      this._currentUtterance = null;
      if (typeof onEnd === 'function') onEnd();
    };

    this._currentUtterance = utterance;
    this.isPlaying = true;
    this.isPaused = false;
    window.speechSynthesis.speak(utterance);
  }

  /**
   * Read an array of form fields sequentially.
   *
   * @param {Array<{label: string, explanation: string}>} fields
   * @param {Function} [onFieldStart] — called with the field index before each field starts.
   * @param {Function} [onComplete]   — called when all fields have been read.
   */
  speakFields(fields, onFieldStart, onComplete) {
    if (!this.isSupported) {
      if (typeof onComplete === 'function') onComplete();
      return;
    }

    if (!Array.isArray(fields) || fields.length === 0) {
      if (typeof onComplete === 'function') onComplete();
      return;
    }

    // Store references so pause/resume/skip can work
    this._fields = fields;
    this._onFieldStart = onFieldStart;
    this._onComplete = onComplete;

    this._speakFieldAt(0);
  }

  /**
   * Pause current speech.
   */
  pause() {
    if (!this.isSupported) return;
    if (this.isPlaying && !this.isPaused) {
      window.speechSynthesis.pause();
      this.isPaused = true;
    }
  }

  /**
   * Resume paused speech.
   */
  resume() {
    if (!this.isSupported) return;
    if (this.isPaused) {
      window.speechSynthesis.resume();
      this.isPaused = false;
    }
  }

  /**
   * Stop all speech and reset playback state.
   */
  stop() {
    if (!this.isSupported) return;

    this._cancelSynth();
    this.isPlaying = false;
    this.isPaused = false;
    this.currentFieldIndex = -1;
    this._fields = null;
    this._onFieldStart = null;
    this._onComplete = null;
    this._currentUtterance = null;
  }

  /**
   * Stop current field and jump to a specific field index.
   *
   * @param {number} index — zero-based field index to start speaking from.
   */
  skipToField(index) {
    if (!this.isSupported) return;
    if (!this._fields || index < 0 || index >= this._fields.length) {
      console.warn('[SpeechService] Invalid skip index:', index);
      return;
    }

    this._cancelSynth();
    this._speakFieldAt(index);
  }

  /**
   * Whether the Web Speech API is available in this browser.
   *
   * @type {boolean}
   */
  get isSupported() {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  // ───────────────────────── Private helpers ───────────────────

  /**
   * Speak the field at the given index, then chain to the next.
   *
   * @param {number} index
   * @private
   */
  _speakFieldAt(index) {
    if (!this._fields || index >= this._fields.length) {
      this.isPlaying = false;
      this.currentFieldIndex = -1;
      if (typeof this._onComplete === 'function') {
        this._onComplete();
      }
      return;
    }

    this.currentFieldIndex = index;

    // Notify UI so it can highlight the current field
    if (typeof this._onFieldStart === 'function') {
      this._onFieldStart(index);
    }

    const field = this._fields[index];
    const label = (field.label || '').trim();
    const explanation = (field.explanation || '').trim();
    const text = `Field ${index + 1}: ${label}. ${explanation}`;

    this.speakText(text, () => {
      // Chain to the next field when this one finishes
      // (but only if we haven't been stopped in the meantime)
      if (this._fields) {
        this._speakFieldAt(index + 1);
      }
    });
  }

  /**
   * Cancel any ongoing speech synthesis.
   * @private
   */
  _cancelSynth() {
    try {
      window.speechSynthesis.cancel();
    } catch (_) {
      // Ignore — browser may already be idle
    }
  }

  /**
   * Find the best available voice for the given BCP 47 language tag.
   *
   * Strategy:
   * 1. Exact lang match (e.g. "hi-IN")
   * 2. Primary language match (e.g. "hi")
   * 3. null (browser default)
   *
   * @param {string} langTag
   * @returns {SpeechSynthesisVoice|null}
   * @private
   */
  _findVoice(langTag) {
    if (!this._voices.length) return null;

    // 1. Exact match
    const exact = this._voices.find(
      (v) => v.lang.toLowerCase() === langTag.toLowerCase()
    );
    if (exact) return exact;

    // 2. Primary language prefix match (e.g. "hi" matches "hi-IN")
    const primary = langTag.split('-')[0].toLowerCase();
    const partial = this._voices.find(
      (v) => v.lang.toLowerCase().startsWith(primary)
    );
    if (partial) return partial;

    return null;
  }

  /**
   * Select the best default voice for the current language.
   * Prefers Hindi voices; falls back to the first available Indian voice.
   * @private
   */
  _selectBestVoice() {
    // This is primarily used during init to warm-select a voice.
    // Actual voice assignment happens per-utterance in _findVoice().
    // Nothing extra to persist here — _findVoice is called each time.
  }

  // ───────────────────────── Speech-to-Text (STT) ──────────

  /**
   * Whether the Web Speech Recognition API is available.
   * @type {boolean}
   */
  get isRecognitionSupported() {
    return typeof window !== 'undefined' &&
      ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);
  }

  /**
   * Start speech recognition (STT).
   *
   * @param {Function} onResult — called with (transcript, isFinal) on each result.
   * @param {Function} [onEnd]  — called when recognition ends.
   */
  startRecognition(onResult, onEnd) {
    if (!this.isRecognitionSupported) {
      console.warn('[SpeechService] Speech Recognition not supported.');
      if (typeof onEnd === 'function') onEnd();
      return;
    }

    // Stop any existing recognition
    this.stopRecognition();

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    this._recognition = new SpeechRecognition();
    this._recognition.lang = this.selectedLang;
    this._recognition.interimResults = true;
    this._recognition.continuous = false;
    this._recognition.maxAlternatives = 1;

    this._recognition.onresult = (event) => {
      let transcript = '';
      let isFinal = false;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
        if (event.results[i].isFinal) isFinal = true;
      }
      if (typeof onResult === 'function') {
        onResult(transcript, isFinal);
      }
    };

    this._recognition.onerror = (event) => {
      if (event.error !== 'aborted' && event.error !== 'no-speech') {
        console.error('[SpeechService] Recognition error:', event.error);
      }
    };

    this._recognition.onend = () => {
      this._recognition = null;
      if (typeof onEnd === 'function') onEnd();
    };

    try {
      this._recognition.start();
      console.log('[SpeechService] Recognition started');
    } catch (err) {
      console.error('[SpeechService] Failed to start recognition:', err);
      this._recognition = null;
      if (typeof onEnd === 'function') onEnd();
    }
  }

  /**
   * Stop the current speech recognition session.
   */
  stopRecognition() {
    if (this._recognition) {
      try {
        this._recognition.stop();
      } catch (_) { }
      this._recognition = null;
    }
  }
}
