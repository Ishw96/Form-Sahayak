const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { LRUCache } = require('lru-cache');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Allow large base64 payloads

// Serve frontend files
app.use(express.static(path.join(__dirname, '../')));

// Rate Limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 20, 
    message: { error: 'Too many requests, please try again later.' },
    standardHeaders: true, 
    legacyHeaders: false, 
});
app.use('/api', limiter);

// LRU Cache for Template Caching (Saves AI calls for repeated forms)
const templateCache = new LRUCache({
    max: 500, 
    ttl: 1000 * 60 * 60 * 24, 
});

function hashBuffer(text) {
    return crypto.createHash('sha256').update(text).digest('hex');
}

// ──────────────────── SHARE CHAT PERSISTENCE ────────────────────
const SHARE_FILE = path.join(__dirname, 'data/shares.json');

function loadShares() {
  try { return JSON.parse(fs.readFileSync(SHARE_FILE, 'utf8')); }
  catch { return {}; }
}
function saveShares(shares) {
  fs.mkdirSync(path.dirname(SHARE_FILE), { recursive: true });
  fs.writeFileSync(SHARE_FILE, JSON.stringify(shares), 'utf8');
}

let sharedChats = loadShares();

const shareLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 10, // 10 shares per 15 minutes
    message: { error: 'Too many share links created. Please wait.' },
    standardHeaders: true,
    legacyHeaders: false
});

app.post('/api/share', shareLimiter, (req, res) => {
  const { chatId, messages } = req.body;
  if (!chatId || !messages) return res.status(400).json({ error: 'Missing data' });

  const shareId = crypto.randomBytes(8).toString('hex'); // 16-char hex for better collision resistance
  
  sharedChats[shareId] = {
    chatId,
    messages,
    createdAt: Date.now(),
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000 // 7 days
  };
  
  saveShares(sharedChats);

  res.json({
    shareUrl: `${req.protocol}://${req.get('host')}/s/${shareId}`
  });
});

app.get('/api/share/:shareId', (req, res) => {
  const data = sharedChats[req.params.shareId];
  if (!data || Date.now() > data.expiresAt) {
    return res.status(404).json({ error: 'Link expire ho gaya ya exist nahi karta.' });
  }
  res.json(data);
});

app.get('/s/:shareId', (req, res) => {
  const data = sharedChats[req.params.shareId];
  if (!data || Date.now() > data.expiresAt) {
    return res.status(404).send('Link expire ho gaya ya exist nahi karta.');
  }
  res.sendFile(path.join(__dirname, '../share.html'));
});

// API Endpoint for Proxying Form Analysis
app.post('/api/analyze-form', async (req, res) => {
    try {
        const body = req.body;
        
        if (!body || !body.contents) {
            return res.status(400).json({ error: 'Invalid request body format' });
        }

        // We can hash the base64 data to check cache
        // Hash ALL images in the request (which corresponds to one form group)
        let imageBase64s = "";
        try {
            const parts = body.contents[0].parts;
            for (const part of parts) {
                if (part.inlineData && part.inlineData.data) {
                    imageBase64s += part.inlineData.data;
                }
            }
        } catch(e) {
            console.log("Could not extract image data for hashing");
        }
        
        const cacheKey = hashBuffer(imageBase64s || JSON.stringify(body));

        // Check Cache
        if (templateCache.has(cacheKey)) {
            console.log('Cache hit for form:', cacheKey);
            return res.json(templateCache.get(cacheKey));
        }

        console.log('Cache miss. Translating request and proxying to GitHub Models API...');

        // Collect available keys
        const headerKey = req.headers['x-api-key'];
        const envKeysStr = process.env.GITHUB_TOKEN || process.env.OPENROUTER_API_KEY || process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY || '';
        const envKeys = envKeysStr.split(',').map(k => k.trim()).filter(k => k.length > 0);
        const availableKeys = headerKey ? [headerKey, ...envKeys] : envKeys;

        if (availableKeys.length === 0) {
            return res.status(500).json({ error: 'No GitHub PAT configured on server.' });
        }

        // Translate Gemini payload to OpenAI format payload
        const parts = body.contents[0].parts;
        const oaiContent = [];
        
        for (const part of parts) {
            if (part.inlineData) {
                oaiContent.push({
                    type: "image_url",
                    image_url: {
                        url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`,
                        detail: "high"
                    }
                });
            } else if (part.text) {
                oaiContent.push({
                    type: "text",
                    text: part.text
                });
            }
        }

        const oaiBody = {
            model: "gpt-4o",
            messages: [
                {
                    role: "user",
                    content: oaiContent
                }
            ],
            temperature: 0.2
        };

        let lastResponseData = null;
        let lastStatus = 500;
        let success = false;

        for (const apiKey of availableKeys) {
            console.log(`Trying API Key (starts with ${apiKey.substring(0, 4)}...)`);
            const apiUrl = 'https://models.inference.ai.azure.com/chat/completions';

            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify(oaiBody),
            });

            lastResponseData = await response.json();
            lastStatus = response.status;
            
            if (response.ok) {
                success = true;
                break; 
            } else if (response.status === 429 || response.status === 401 || response.status === 403 || response.status === 402) {
                console.warn(`API Key failed (${response.status}). Trying next key if available...`);
                continue; 
            } else {
                console.error(`API failed with status ${response.status}`, lastResponseData);
                break; 
            }
        }

        if (!success) {
            return res.status(lastStatus).json(lastResponseData);
        }

        // Store successful response in cache
        templateCache.set(cacheKey, lastResponseData);

        res.json(lastResponseData);

    } catch (error) {
        console.error('Error analyzing form:', error);
        res.status(500).json({ error: 'Failed to analyze the form. Please try again later.' });
    }
});

// API Endpoint for Text-only Chat (Follow-up questions — no image, cheaper)
app.post('/api/chat', async (req, res) => {
    try {
        const { messages } = req.body;

        if (!messages || !Array.isArray(messages) || messages.length === 0) {
            return res.status(400).json({ error: 'Invalid request: messages array required.' });
        }

        const envKey = process.env.GITHUB_TOKEN || '';
        const apiKey = req.headers['x-api-key'] || envKey.split(',')[0].trim();

        if (!apiKey) {
            return res.status(500).json({ error: 'No API key configured.' });
        }

        const oaiBody = {
            model: 'gpt-4o-mini',  // Use cheaper model for text-only follow-ups
            messages: messages.map(m => ({
                role: m.role,
                content: m.content
            })),
            temperature: 0.3
        };

        const apiUrl = 'https://models.inference.ai.azure.com/chat/completions';

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify(oaiBody),
        });

        const data = await response.json();

        if (!response.ok) {
            console.error(`Chat API failed with status ${response.status}`, data);
            return res.status(response.status).json(data);
        }

        res.json(data);

    } catch (error) {
        console.error('Error in chat endpoint:', error);
        res.status(500).json({ error: 'Chat request failed. Please try again.' });
    }
});

// Default route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../index.html'));
});

// Start server
app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});

