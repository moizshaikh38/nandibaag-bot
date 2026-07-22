const OpenAI = require('openai');
const logger = require('../config/logger');
const { buildSystemPrompt } = require('./systemPrompt');
const {
  openrouterApiKey, openrouterModelPrimary,
  aiTestMode, ollamaBaseUrl, ollamaModel,
  groqApiKey, groqModel, groqBaseUrl,
  cloudflareAccountId, cloudflareApiToken, cloudflareModel
} = require('../config/env');
const crypto = require('crypto');

// ── OpenRouter client (OpenAI-compatible) ─────────────────────────────
const openai = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: openrouterApiKey,
  maxRetries: 0
});



// ── Ollama client (local dev/testing ONLY) ─────────────────────────────
let ollamaClientInstance = null;
function getOllamaClient() {
  if (!ollamaClientInstance) {
    ollamaClientInstance = new OpenAI({
      baseURL: ollamaBaseUrl,
      apiKey: 'ollama', // Ollama runs unauthenticated locally
      maxRetries: 0
    });
  }
  return ollamaClientInstance;
}

// ── Groq client (production tier) ──────────────────────────────────────
let groqClientInstance = null;
function getGroqClient() {
  if (!groqClientInstance && groqApiKey) {
    groqClientInstance = new OpenAI({
      baseURL: groqBaseUrl,
      apiKey: groqApiKey,
      maxRetries: 0
    });
  }
  return groqClientInstance;
}





/**
 * Adapter that calls Cloudflare Workers AI via REST API.
 * Cloudflare does NOT use OpenAI-compatible format, so this is a dedicated adapter.
 *
 * @param {Array} messages - [{role: 'user'|'assistant', content: string}]
 * @param {string} systemPrompt - The system instruction text
 * @param {number} timeoutMs - Abort timeout in milliseconds
 * @returns {string} The model's text reply
 */
async function callCloudflare(messages, systemPrompt, timeoutMs = 8000) {
  if (!cloudflareAccountId || !cloudflareApiToken) {
    throw new Error('Cloudflare client not configured (missing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN)');
  }

  // Convert messages to Cloudflare's format
  // Cloudflare expects a simple array of messages with role/content
  const cloudflareMessages = [
    { role: 'system', content: systemPrompt },
    ...messages
  ];

  const url = `https://api.cloudflare.com/client/v4/accounts/${cloudflareAccountId}/ai/run/${cloudflareModel}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cloudflareApiToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messages: cloudflareMessages,
        max_tokens: 200
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Cloudflare API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    
    // Cloudflare Workers AI response format: { result: { response: "text" } }
    const aiText = data?.result?.response?.trim();
    if (!aiText) {
      throw new Error('Empty response from Cloudflare');
    }

    return aiText;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw Object.assign(new Error('timeout'), { name: 'AbortError' });
    }
    throw error;
  }
}

/**
 * In-memory response cache for FAQ-type questions only.
 * TTL: 5 minutes. Keyed by hash of (last customer message + booking stage).
 * 
 * IMPORTANT: This cache is ONLY for pure static-info questions (timing, facilities, etc.).
 * NEVER cache anything involving:
 * - Price calculations (depends on date, guest count, etc.)
 * - Dates or time-sensitive info
 * - Personal data (name, phone)
 * - Booking-specific queries
 * 
 * This tradeoff reduces API calls for repeated FAQs while ensuring
 * dynamic booking queries always get fresh responses.
 */
const responseCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Simple hash function for cache key generation
 */
function hashString(str) {
  return crypto.createHash('md5').update(str).digest('hex');
}

/**
 * Sanitizes AI response to strip leaked reasoning tokens and markdown
 */
function sanitizeReply(text) {
  if (!text) return '';
  
  let sanitized = text;
  
  // Remove content between <thought> and </thought> tags (including tags)
  sanitized = sanitized.replace(/<thought>[\s\S]*?<\/thought>/gi, '');
  
  // Remove content between <reasoning> and </reasoning> tags (including tags)
  sanitized = sanitized.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '');
  
  // Remove markdown code blocks
  sanitized = sanitized.replace(/```[\s\S]*?```/g, '');
  
  // Remove markdown bold (**text**)
  sanitized = sanitized.replace(/\*\*([^*]+)\*\*/g, '$1');
  
  // Remove markdown headers (# text, ## text, etc.)
  sanitized = sanitized.replace(/^#{1,6}\s+/gm, '');
  
  // Remove markdown links [text](url)
  sanitized = sanitized.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  
  // Remove any remaining markdown-style formatting
  sanitized = sanitized.replace(/\*([^*]+)\*/g, '$1');
  
  // Trim whitespace
  sanitized = sanitized.trim();
  
  return sanitized;
}

/**
 * Trims response to max 700 chars at nearest sentence boundary if needed
 */
function trimToSentenceBoundary(text, maxLength = 700) {
  if (text.length <= maxLength) return text;
  
  const trimmed = text.substring(0, maxLength);
  
  // Find last sentence boundary (., !, ?, ।,॥)
  const sentenceEnds = ['.', '!', '?', '।', '॥'];
  let lastBoundary = -1;
  
  for (let i = trimmed.length - 1; i >= 0; i--) {
    if (sentenceEnds.includes(trimmed[i])) {
      lastBoundary = i;
      break;
    }
  }
  
  if (lastBoundary > 0) {
    return trimmed.substring(0, lastBoundary + 1);
  }
  
  // Fallback: return as-is with ellipsis
  return trimmed + '...';
}

/**
 * Enforces max 4 lines and ~500 characters
 */
function enforceLengthLimits(text) {
  const lines = text.split('\n').filter(line => line.trim());
  
  if (lines.length > 4) {
    logger.warn(`Response exceeded 4 lines (${lines.length} lines), truncating`);
    return lines.slice(0, 4).join('\n');
  }
  
  if (text.length > 500) {
    logger.warn(`Response exceeded 500 characters (${text.length} chars), will trim at sentence boundary`);
    return trimToSentenceBoundary(text, 700);
  }
  
  return text;
}

// Common English words that are NOT expected resort loanwords
const commonEnglishWords = new Set([
  'the', 'and', 'with', 'for', 'about', 'from', 'this', 'that', 'these', 'those',
  'what', 'when', 'where', 'which', 'who', 'how', 'why', 'will', 'would', 'should',
  'could', 'can', 'may', 'might', 'must', 'shall', 'been', 'were', 'was', 'are',
  'is', 'am', 'have', 'has', 'had', 'having', 'does', 'did', 'done',
  'verifier', 'processor', 'handler', 'manager', 'controller', 'service', 'helper',
  'system', 'prompt', 'variable', 'function', 'object', 'array', 'string', 'number',
  'boolean', 'null', 'undefined', 'error', 'timeout', 'exception', 'validation',
  'status', 'token', 'response', 'request', 'client', 'server', 'host', 'database',
  'connection', 'index', 'loop', 'class', 'module', 'import', 'export', 'require',
  'test', 'case', 'debug', 'code', 'file', 'stack', 'trace', 'memory', 'process',
  'thread', 'run', 'execute', 'build', 'compile', 'load', 'render', 'template',
  'component', 'layout', 'view', 'route', 'router', 'middle', 'end', 'fetch',
  'get', 'post', 'patch', 'delete', 'put', 'options', 'aborted', 'timeout', 'timed',
  'buffer', 'buffering', 'terminated', 'close', 'open', 'exit', 'quit',
  'write', 'read', 'update', 'create', 'insert', 'select', 'where', 'limit', 'offset',
  'count', 'sum', 'avg', 'min', 'max', 'order', 'group', 'by', 'having', 'join',
  'inner', 'left', 'right', 'outer', 'full', 'cross', 'natural', 'on', 'using',
  'their', 'them', 'they', 'him', 'her', 'his', 'its', 'our', 'us', 'you', 'your',
  'myself', 'yourself', 'himself', 'herself', 'itself', 'ourselves', 'yourselves',
  'themselves', 'someone', 'somebody', 'something', 'somewhere', 'anyone', 'anybody',
  'anything', 'anywhere', 'everyone', 'everybody', 'everything', 'everywhere',
  'nobody', 'nothing', 'nowhere', 'none', 'neither', 'either', 'each', 'every',
  'other', 'another', 'such', 'what', 'whatever', 'whichever', 'whoever', 'whomever',
  'whose', 'whyever', 'however', 'indeed', 'perhaps', 'probably', 'possibly',
  'maybe', 'always', 'never', 'sometimes', 'often', 'seldom', 'rarely', 'usually',
  'generally', 'especially', 'particularly', 'specifically', 'mostly', 'mainly',
  'first', 'second', 'third', 'last', 'next', 'previous', 'early', 'late', 'soon',
  'already', 'yet', 'still', 'anymore', 'ago', 'since', 'until', 'till', 'before',
  'after', 'during', 'while', 'meanwhile', 'meantime', 'whereas', 'although',
  'though', 'even', 'only', 'just', 'almost', 'nearly', 'about', 'around', 'above',
  'below', 'under', 'over', 'between', 'among', 'through', 'into', 'onto', 'upon',
  'within', 'without', 'behind', 'beside', 'besides', 'beyond', 'toward', 'towards',
  'across', 'along', 'against', 'amongst', 'around', 'beneath', 'underneath',
  'except', 'instead', 'because', 'since', 'unless', 'whether', 'whereas', 'lest'
]);

const allowedResortWords = new Set();

function initializeAllowedWords() {
  const manualWhitelist = [
    // Safe common Hinglish / Resort English loanwords
    'booking', 'couple', 'group', 'picnic', 'resort', 'ac', 'dj', 'wifi', 'pool', 
    'cafe', 'cottages', 'kayaking', 'boating', 'games', 'buffet', 'veg', 'jain', 
    'pet', 'check', 'checkout', 'tea', 'taxi', 'rickshaw', 'instagram', 'website', 
    'maps', 'aadhaar', 'pan', 'license', 'room', 'rooms', 'deluxe', 'bathtub', 
    'price', 'rates', 'pricing', 'details', 'detail', 'date', 'dates', 'weekend', 
    'weekends', 'weekday', 'weekdays', 'person', 'people', 'per', 'rs', 'rupees', 
    'rupee', 'married', 'marriage', 'unmarried', 'postpone', 'cancel', 'cancellation', 
    'refund', 'non-refundable', 'reschedule', 'year', 'morning', 'evening', 'day', 
    'night', 'nights', 'breakfast', 'lunch', 'dinner', 'sunset', 'baby', 'family', 
    'anniversary', 'wedding', 'event', 'events', 'corporate', 'birthday', 'birthdays', 
    'alcohol', 'byob', 'team', 'call', 'phone', 'number', 'numbers', 'ok', 'yes', 'no', 
    'hi', 'hello', 'hey', 'sorry', 'thank', 'thanks', 'welcome', 'please', 'enquiry', 'enquiries',
    'swagat', 'kuch', 'kuchh', 'log', 'raat', 'bahut', 'bohot', 'bhut', 'madad', 'shayad', 'umeed', 
    'ummeed', 'waqt', 'vakt', 'soch', 'bach', 'baat', 'baatein', 'respect', 'package', 'packages', 'budget',
    
    // User requested supplementary whitelist
    'okay', 'sure', 'thanks', 'card', 'cash', 'upi', 'google', 'id',
    'valid', 'friends', 'stay', 'possible', 'allow', 'allows', 'allowed', 
    'support', 'customer', 'assistant', 'proof', 'confirm', 'help',

    // Booking-flow words that AI models commonly use in replies
    'options', 'option', 'offer', 'offers', 'choice', 'choices', 'choose',
    'includes', 'included', 'including', 'inclusive', 'available', 'availability',
    'great', 'nice', 'good', 'wonderful', 'lovely', 'perfect', 'excellent',
    'total', 'guests', 'guest', 'adult', 'adults', 'child', 'children', 'kids',
    'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
    'visitor', 'visitors', 'member', 'members', 'order', 'cater', 'catering',
    'need', 'want', 'like', 'visit', 'visiting', 'plan', 'planning',
    'time', 'hour', 'hours', 'minutes', 'tomorrow', 'today',
    'tell', 'send', 'share', 'know', 'book', 'booked'
  ];
  
  for (const word of manualWhitelist) {
    allowedResortWords.add(word.toLowerCase());
  }

  // Programmatically extract all English words from systemPrompt.js
  try {
    const fs = require('fs');
    const path = require('path');
    const systemPromptPath = path.join(__dirname, 'systemPrompt.js');
    if (fs.existsSync(systemPromptPath)) {
      const fileContent = fs.readFileSync(systemPromptPath, 'utf8');
      const extractedWords = fileContent.toLowerCase().match(/[a-z]+/g) || [];
      for (const word of extractedWords) {
        if (word.length >= 3) {
          allowedResortWords.add(word);
        }
      }
    } else {
      // Fallback if file doesn't exist
      const promptText = buildSystemPrompt('Monday, 1 January 2026', 'Monday', {});
      const words = promptText.toLowerCase().match(/[a-z]+/g) || [];
      for (const word of words) {
        if (word.length >= 3) {
          allowedResortWords.add(word);
        }
      }
    }
  } catch (err) {
    logger.error(`Failed to programmatically read systemPrompt.js: ${err.message}`);
  }
}

// Run allowed word extraction on module load
initializeAllowedWords();

// ══════════════════════════════════════════════════════════════════════
// Per-provider health + latency metrics (hourly reset, in-memory)
// ══════════════════════════════════════════════════════════════════════

/**
 * providerMetrics structure:
 * {
 *   "blueminds": { success: 0, invalid: 0, error: 0, totalLatencyMs: 0, callCount: 0 },
 *   "gemini":    { ... },
 *   "openrouter/meta-llama/llama-3.3-70b-instruct:free": { ... },
 *   ...
 * }
 */
let providerMetrics = {};
let metricsResetTimestamp = Date.now();

function checkMetricsReset() {
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;
  if (now - metricsResetTimestamp >= oneHour) {
    providerMetrics = {};
    metricsResetTimestamp = now;
  }
}

function ensureProvider(providerKey) {
  checkMetricsReset();
  if (!providerMetrics[providerKey]) {
    providerMetrics[providerKey] = { success: 0, invalid: 0, error: 0, totalLatencyMs: 0, callCount: 0 };
  }
  return providerMetrics[providerKey];
}

function recordSuccess(providerKey, latencyMs) {
  const m = ensureProvider(providerKey);
  m.success++;
  m.totalLatencyMs += latencyMs;
  m.callCount++;
}

function recordInvalid(providerKey, latencyMs) {
  const m = ensureProvider(providerKey);
  m.invalid++;
  m.totalLatencyMs += latencyMs;
  m.callCount++;
}

function recordError(providerKey, latencyMs) {
  const m = ensureProvider(providerKey);
  m.error++;
  m.totalLatencyMs += latencyMs;
  m.callCount++;
}

/**
 * Returns per-provider health + latency snapshot for the current hour.
 * Consumed by GET /api/dashboard/stats.
 */
function getModelHealthLast1Hour() {
  checkMetricsReset();
  const snapshot = {};
  for (const [key, m] of Object.entries(providerMetrics)) {
    snapshot[key] = {
      success: m.success,
      invalid: m.invalid,
      error: m.error,
      avgLatencyMs: m.callCount > 0 ? Math.round(m.totalLatencyMs / m.callCount) : 0
    };
  }
  return snapshot;
}

// ══════════════════════════════════════════════════════════════════════
// Reply validation
// ══════════════════════════════════════════════════════════════════════

function isReplyValid(text) {
  if (!text || typeof text !== 'string') return false;
  
  const trimmed = text.trim();
  
  // 1. Length boundaries check
  if (trimmed.length < 3 || trimmed.length > 700) {
    return false;
  }
  
  // 1b. Anti-confirmation guard: bot must NEVER self-confirm bookings
  if (/booking\s*(is\s*)?confirm(ed|ed\s*hai|hai)?/i.test(trimmed) || /aapki\s*booking\s*confirm/i.test(trimmed) || /booking\s*ho\s*gayi\s*hai/i.test(trimmed)) {
    return false;
  }
  
  // 2. Unexpected script check (e.g. Chinese, Cyrillic, Arabic, etc.)
  // Allows: ASCII, Devanagari, Gujarati, General Punctuation (em/en dash, ellipsis, bullets),
  // Currency symbols (₹), Misc Symbols, Dingbats, and full emoji ranges
  if (/[^\x00-\x7F\u{0900}-\u{097F}\u{0A80}-\u{0AFF}\u{2000}-\u{206F}\u{20A0}-\u{20CF}\u{2100}-\u{214F}\u{2190}-\u{21FF}\u{2600}-\u{27BF}\u{1F000}-\u{1FAFF}\u{FE00}-\u{FE0F}]/u.test(trimmed)) {
    return false;
  }
  
  // 3. Leftover markdown or code syntax checks (```, <, >, #, *)
  if (/`{3}|[<>#\*]/.test(trimmed)) {
    return false;
  }
  
  // 4. Repeated word duplication checks
  const repeatedWordRegex = /\b(\w+)\s+\1\b/ig;
  let match;
  const allowedReduplications = new Set([
    'kabhi', 'dhire', 'garam', 'gol', 'sath', 'saath', 'thoda', 'thodi', 
    'bade', 'chote', 'door', 'pass', 'paas', 'chal', 'chalo', 'ruko', 
    'suno', 'haan', 'acha', 'accha', 'ek', 'naye', 'nayee', 'garma',
    'sirf' // Allow repeating sirf if needed
  ]);
  
  while ((match = repeatedWordRegex.exec(trimmed)) !== null) {
    const word = match[1].toLowerCase();
    if (!allowedReduplications.has(word)) {
      return false;
    }
  }
  
  // 5. English word whitelist and Hinglish truncation checks
  // Strategy: whitelist + commonEnglishWords blacklist only.
  // We intentionally do NOT use suffix-based heuristics (e.g. /er$|or$|tion$/)
  // because they produce too many false positives on legitimate resort loanwords
  // like "offer", "number", "order", "visitor", "catering", etc.
  const words = trimmed.toLowerCase().match(/[a-z]+/g) || [];
  
  for (const word of words) {
    if (word.length < 3) continue;
    
    // If it is in the whitelisted/allowed words set, it's safe
    if (allowedResortWords.has(word)) continue;
    
    // Out-of-place random English word check (technical/programming terms only)
    if (commonEnglishWords.has(word)) {
      return false;
    }
    
    // Suspicious if it has no vowels (cannot be a real Hinglish/English word)
    if (!/[aeiouy]/.test(word)) {
      return false;
    }
    
    // Targeted check for typical Hinglish truncation errors
    if (/sakt$|chah$|karn$/.test(word)) {
      return false;
    }
  }
  
  return true;
}

/**
 * Diagnostic helper: returns a human-readable string explaining WHY isReplyValid()
 * rejected the given text. Mirrors the same checks as isReplyValid() above.
 * Used for enhanced logging so we can see exactly what triggered rejections.
 */
function getReplyRejectionReason(text) {
  if (!text || typeof text !== 'string') return 'EMPTY_OR_NOT_STRING';
  const trimmed = text.trim();
  if (trimmed.length < 3) return `TOO_SHORT (${trimmed.length} chars)`;
  if (trimmed.length > 700) return `TOO_LONG (${trimmed.length} chars)`;

  const scriptMatch = trimmed.match(/[^\x00-\x7F\u0900-\u097F\u0A80-\u0AFF\u{2000}-\u{206F}\u{20A0}-\u{20CF}\u{2100}-\u{214F}\u{2190}-\u{21FF}\u2600-\u27BF\u{1F000}-\u{1FAFF}\u{FE00}-\u{FE0F}]/u);
  if (scriptMatch) return `UNEXPECTED_SCRIPT: char="${scriptMatch[0]}" U+${scriptMatch[0].codePointAt(0).toString(16).toUpperCase()}`;

  if (/booking\s*(is\s*)?confirm(ed|ed\s*hai|hai)?/i.test(trimmed) || /aapki\s*booking\s*confirm/i.test(trimmed) || /booking\s*ho\s*gayi\s*hai/i.test(trimmed)) {
    return 'FORBIDDEN_SELF_CONFIRMATION_PHRASE';
  }

  if (/`{3}/.test(trimmed)) return 'MARKDOWN_CODE_BLOCK';
  const mdMatch = trimmed.match(/[<>#\*]/);
  if (mdMatch) return `MARKDOWN_SYNTAX: char="${mdMatch[0]}"`;

  const repeatedWordRegex = /\b(\w+)\s+\1\b/ig;
  const allowedReduplications = new Set([
    'kabhi', 'dhire', 'garam', 'gol', 'sath', 'saath', 'thoda', 'thodi',
    'bade', 'chote', 'door', 'pass', 'paas', 'chal', 'chalo', 'ruko',
    'suno', 'haan', 'acha', 'accha', 'ek', 'naye', 'nayee', 'garma', 'sirf'
  ]);
  let match;
  while ((match = repeatedWordRegex.exec(trimmed)) !== null) {
    const word = match[1].toLowerCase();
    if (!allowedReduplications.has(word)) return `REPEATED_WORD: "${word} ${word}"`;
  }

  const words = trimmed.toLowerCase().match(/[a-z]+/g) || [];
  for (const word of words) {
    if (word.length < 3) continue;
    if (allowedResortWords.has(word)) continue;
    if (commonEnglishWords.has(word)) return `COMMON_ENGLISH_WORD: "${word}"`;
    if (!/[aeiouy]/.test(word)) return `NO_VOWELS: "${word}"`;
    if (/sakt$|chah$|karn$/.test(word)) return `TRUNCATED_WORD: "${word}"`;
  }

  return 'UNKNOWN (passed all checks)';
}

/**
 * Heuristic language detection based on Unicode ranges and common words
 * This is for dashboard/analytics purposes only, not for AI response generation
 */
function detectLanguage(text) {
  if (!text || text.length === 0) return 'unknown';
  
  const lowerText = text.toLowerCase();
  
  // Marathi Unicode range: U+0900 to U+097F
  const hasMarathi = /[\u0900-\u097F]/.test(text);
  
  // Gujarati Unicode range: U+0A80 to U+0AFF
  const hasGujarati = /[\u0A80-\u0AFF]/.test(text);
  
  // Hindi/Devanagari Unicode range: U+0900 to U+097F (overlaps with Marathi)
  const hasDevanagari = /[\u0900-\u097F]/.test(text);
  
  // Common Marathi-only words (not in Hindi)
  const marathiWords = ['aahe', 'kadhi', 'tumhi', 'mala', 'tyala', 'kay', 'mi', 'tu', 'apan', 'kasa', 'kashi'];
  const hasMarathiWords = marathiWords.some(word => lowerText.includes(word));
  
  // Common Hindi loanwords in Hinglish
  const hindiLoanwords = ['kya', 'hai', 'kaise', 'kahan', 'kab', 'kaun', 'kyun', 'bhai', 'didi', 'ji', 'accha', 'theek', 'sahi', 'galat', 'please', 'thank'];
  const hasHindiLoanwords = hindiLoanwords.some(word => lowerText.includes(word));
  
  // Detect language
  if (hasGujarati) {
    return 'gujarati';
  }
  
  if (hasMarathiWords) {
    return 'marathi';
  }
  
  if (hasDevanagari) {
    // If Devanagari but no specific Marathi words, assume Hindi
    return 'hindi';
  }
  
  // Latin script - check for Hindi loanwords (Hinglish)
  if (hasHindiLoanwords) {
    return 'hinglish';
  }
  
  // Pure Latin script with no Hindi loanwords
  return 'english';
}

// ══════════════════════════════════════════════════════════════════════
// Core getAIResponse — tiered chain when AI_CHAIN_ENABLED=true
// ══════════════════════════════════════════════════════════════════════

/**
 * Attempts a single OpenAI-compatible provider call.
 * Used for both Blueminds and OpenRouter models.
 *
 * @returns {string|null} sanitized+validated reply, or null if failed
 */
async function tryOpenAICompatibleCall(client, modelName, providerKey, tierLabel, messages, systemPrompt, timeoutMs = 8000) {
  const t0 = Date.now();
  let timeoutId;
  console.log(`[TIMING] [${tierLabel}] Starting API request to model: ${modelName} at ${new Date().toISOString()}`);

  if (tierLabel.includes('BLUEMINDS')) {
    const payload = {
      model: modelName,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages
      ],
      temperature: 0.7,
      max_tokens: 200
    };
    console.log(`[DIAGNOSTIC] [${tierLabel}] Raw Request Payload:\n`, JSON.stringify(payload, null, 2));
  }

  try {
    const controller = new AbortController();
    timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await client.chat.completions.create({
      model: modelName,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages
      ],
      temperature: 0.7,
      max_tokens: 200
    }, { signal: controller.signal });

    clearTimeout(timeoutId);

    if (tierLabel.includes('BLUEMINDS')) {
      console.log(`[DIAGNOSTIC] [${tierLabel}] Raw Response:\n`, JSON.stringify(response, null, 2));
    }

    const aiText = response?.choices?.[0]?.message?.content?.trim();
    if (!aiText) {
      throw new Error('Empty response from model');
    }

    let sanitized = sanitizeReply(aiText);
    sanitized = enforceLengthLimits(sanitized);

    const latency = Date.now() - t0;

    if (!isReplyValid(sanitized)) {
      recordInvalid(providerKey, latency);
      const rejectionReason = getReplyRejectionReason(sanitized);
      logger.warn(`[${tierLabel}] Model ${providerKey} produced an invalid/corrupted reply (reason: ${rejectionReason}): "${aiText}"`);
      console.log(`[DIAGNOSTIC] [${tierLabel}] RAW reply BEFORE sanitize: "${aiText}"`);
      console.log(`[DIAGNOSTIC] [${tierLabel}] SANITIZED reply: "${sanitized}"`);
      console.log(`[DIAGNOSTIC] [${tierLabel}] REJECTION REASON: ${rejectionReason}`);
      console.log(`[TIMING] [${tierLabel}] Completed in ${latency}ms (invalid output generated)`);
      return null;
    }

    recordSuccess(providerKey, latency);
    logger.info(`[${tierLabel}] success (${latency}ms)`);
    console.log(`[TIMING] [${tierLabel}] Completed successfully in ${latency}ms`);
    return sanitized;

  } catch (error) {
    if (timeoutId) clearTimeout(timeoutId);
    const latency = Date.now() - t0;
    recordError(providerKey, latency);

    const reason = error.name === 'AbortError' ? 'timeout' :
                   error.status === 429 ? 'rate limit' :
                   error.status >= 500 ? 'server error' : error.message;
    logger.warn(`[${tierLabel}] failed: ${reason} (${latency}ms)`);
    console.error(`[DIAGNOSTIC] [${tierLabel}] Full error details: Name=${error.name}, Message=${error.message}, Status=${error.status}, Code=${error.code}`);
    if (error.stack) console.error(error.stack);
    console.log(`[TIMING] [${tierLabel}] Failed in ${latency}ms due to: ${reason}`);
    return null;
  }
}



/**
 * Attempts a Cloudflare Workers AI call via the REST API.
 *
 * @returns {string|null} sanitized+validated reply, or null if failed
 */
async function tryCloudflareCall(tierLabel, messages, systemPrompt, timeoutMs = 8000) {
  const providerKey = `cloudflare/${cloudflareModel}`;
  const t0 = Date.now();
  console.log(`[TIMING] [${tierLabel}] Starting Cloudflare API request at ${new Date().toISOString()}`);
  try {
    const rawText = await callCloudflare(messages, systemPrompt, timeoutMs);
    if (!rawText) throw new Error('Empty response from Cloudflare');

    let sanitized = sanitizeReply(rawText);
    sanitized = enforceLengthLimits(sanitized);

    const latency = Date.now() - t0;

    if (!isReplyValid(sanitized)) {
      recordInvalid(providerKey, latency);
      const rejectionReason = getReplyRejectionReason(sanitized);
      logger.warn(`[${tierLabel}] Cloudflare (${cloudflareModel}) produced an invalid/corrupted reply (reason: ${rejectionReason}): "${rawText}"`);
      console.log(`[DIAGNOSTIC] [${tierLabel}] RAW reply: "${rawText}"`);
      console.log(`[DIAGNOSTIC] [${tierLabel}] SANITIZED reply: "${sanitized}"`);
      console.log(`[DIAGNOSTIC] [${tierLabel}] REJECTION REASON: ${rejectionReason}`);
      console.log(`[TIMING] [${tierLabel}] Completed in ${latency}ms (invalid output generated)`);
      return null;
    }

    recordSuccess(providerKey, latency);
    logger.info(`[${tierLabel}] success (${latency}ms)`);
    console.log(`[TIMING] [${tierLabel}] Completed successfully in ${latency}ms`);
    return sanitized;

  } catch (error) {
    const latency = Date.now() - t0;
    recordError(providerKey, latency);

    const reason = error.name === 'AbortError' ? 'timeout' : error.message;
    logger.warn(`[${tierLabel}] failed: ${reason} (${latency}ms)`);
    console.error(`[DIAGNOSTIC] [${tierLabel}] Full error details: Name=${error.name}, Message=${error.message}`);
    if (error.stack) console.error(error.stack);
    console.log(`[TIMING] [${tierLabel}] Failed in ${latency}ms due to: ${reason}`);
    return null;
  }
}

/**
 * Gets AI response with tiered fallback logic.
 *
 * When AI_TEST_MODE=true (local dev/testing ONLY):
 *   TIER 1 — Ollama (local, OpenAI-compatible, 8s timeout)
 *   TIER 2 — Hardcoded safe fallback (no further retries if Ollama fails validation)
 *
 * When AI_TEST_MODE=false (production):
 *   TIER 1 — Groq (OpenAI-compatible, 8s timeout)
 *   TIER 2 — Cloudflare Workers AI (REST API, 8s timeout)
 *   TIER 3 — OpenRouter 3-model chain (8s timeout per model)
 *   TIER 4 — Hardcoded safe fallback
 */
async function getAIResponse(chat, incomingMessage, resortSettings) {
  const bookingStage = chat.bookingStage || 'none';
  
  // Check cache for FAQ-type questions only (not booking-related)
  const nonBookingStages = ['none', 'type_selected'];
  const isBookingQuery = !nonBookingStages.includes(bookingStage);
  
  if (!isBookingQuery) {
    const cacheKey = hashString(incomingMessage + bookingStage);
    const cached = responseCache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      logger.debug(`Cache hit for FAQ query: ${incomingMessage.substring(0, 30)}...`);
      return cached.response;
    }
  }
  
  const tPromptStart = Date.now();
 
  // Trim message history (last 10 messages max to optimize token speed)
  const messageHistory = chat.messages
    .slice(-10)
    .map(msg => ({
      role: msg.sender === 'customer' ? 'user' : 'assistant',
      content: msg.text
    }));
  
  // Add current incoming message
  messageHistory.push({
    role: 'user',
    content: incomingMessage
  });
  
  // Build system prompt with today's date
  const today = new Date();
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayOfWeek = days[today.getDay()];
  const todayDateString = today.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
  
  const baseSystemPrompt = buildSystemPrompt(todayDateString, dayOfWeek, resortSettings);

  // Extract structured booking progress context
  const bookingDraft = chat.bookingDraft || {};
  const customerName = chat.customerName || bookingDraft.customerName || null;
  const customerPhone = chat.customerPhone || bookingDraft.customerPhone || null;
  const quotedPrice = bookingDraft.calculatedPrice ? `₹${bookingDraft.calculatedPrice}` : (bookingDraft.priceBreakdown || null);

  const bookingProgressContext = `

[CURRENT BOOKING PROGRESS (do not re-ask anything already filled in here)]
- Booking type: ${bookingDraft.bookingType || 'NOT YET SELECTED'}
- Date: ${bookingDraft.date || 'NOT YET GIVEN'}
- Guests: ${bookingDraft.adults ? `${bookingDraft.adults} adults` : 'NOT YET GIVEN'}${bookingDraft.kids?.length ? `, ${bookingDraft.kids.length} kids` : ''}
- Name: ${customerName || 'NOT YET COLLECTED'}
- Phone: ${customerPhone || 'NOT YET COLLECTED'}
- Price quoted: ${quotedPrice || 'NOT YET QUOTED'}
- Stage: ${bookingStage}

STRICT STAGE INSTRUCTIONS:
- If Name and Phone above are already filled in, do NOT ask for them again under any circumstance.
- If Stage is 'handed_over', do NOT re-quote the price or restart the booking flow — only answer the customer's new question (e.g. about alcohol, food, timing) and then briefly remind them staff will contact them for payment and confirmation, nothing more.
- NEVER say "booking confirm hai" or "booking is confirmed". Only state that details are noted and team will call for payment/confirmation.
`;

  const systemPrompt = baseSystemPrompt + bookingProgressContext;
  console.log(`[TIMING] [3/6] System prompt and message history built in ${Date.now() - tPromptStart}ms (Stage: ${bookingStage})`);
 
  let result = null;
 
  // ── AI_TEST_MODE: Local Ollama-only mode (for dev/testing ONLY) ──
  if (aiTestMode) {
    logger.info(`[TIER 1 - OLLAMA] attempting (AI_TEST_MODE=true, local only)...`);
    const ollamaClient = getOllamaClient();
    const providerKey = `ollama/${ollamaModel}`;
    
    result = await tryOpenAICompatibleCall(
      ollamaClient, ollamaModel, providerKey, 'TIER 1 - OLLAMA',
      messageHistory, systemPrompt, 8000
    );
 
    if (!result) {
      const rejectionReason = result ? 'N/A' : 'call failed or validation failed';
      logger.warn(`[TIER 1 - OLLAMA] failed (${rejectionReason}), using fallback (no retry in test mode)`);
    } else {
      logger.info(`[TIER 1 - OLLAMA] success`);
    }
  } else {
    // ── PRODUCTION MODE: Full tier chain ─────────────────────────────
    
    // ── TIER 1: Groq (production tier, OpenAI-compatible) ──
    if (groqApiKey) {
      logger.info(`[TIER 1 - GROQ] attempting...`);
      const groqClient = getGroqClient();
      const providerKey = `groq/${groqModel}`;
      
      result = await tryOpenAICompatibleCall(
        groqClient, groqModel, providerKey, 'TIER 1 - GROQ',
        messageHistory, systemPrompt, 8000
      );
 
      if (!result) {
        logger.info(`[TIER 1 - GROQ] invalid/failed, falling to TIER 2`);
      } else {
        logger.info(`[TIER 1 - GROQ] success`);
      }
    }
 
    // ── TIER 2: Cloudflare Workers AI (REST API, different infra) ──
    if (!result && cloudflareAccountId && cloudflareApiToken) {
      logger.info(`[TIER 2 - CLOUDFLARE] attempting...`);
      result = await tryCloudflareCall(
        'TIER 2 - CLOUDFLARE', messageHistory, systemPrompt, 8000
      );
      if (!result) {
        logger.info(`[TIER 2 - CLOUDFLARE] invalid/failed, falling to TIER 3`);
      }
    }
 
    // ── TIER 3: OpenRouter multi-model chain (3 free models across diverse infra) ──
    if (!result) {
      const models = [
        { name: openrouterModelPrimary,             label: 'PRIMARY' },     // Meta Llama 70B
        { name: 'qwen/qwen-2.5-72b-instruct:free', label: 'QWEN_72B' },    // Qwen 72B
        { name: 'google/gemma-2-9b-it:free',        label: 'GEMMA_9B' }     // Google Gemma 9B
      ];
 
      for (let i = 0; i < models.length; i++) {
        const model = models[i];
        const providerKey = `openrouter/${model.name}`;
        const tierLabel = `TIER 3 - OPENROUTER/${model.label}`;
 
        logger.info(`[${tierLabel}] attempting (model ${i + 1}/${models.length})...`);
 
        result = await tryOpenAICompatibleCall(
          openai, model.name, providerKey, tierLabel,
          messageHistory, systemPrompt, 8000
        );
 
        if (result) {
          logger.info(`[${tierLabel}] succeeded — using this reply`);
          break;
        }
 
        if (i < models.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }
  }

  // ── FINAL FALLBACK: Hardcoded safe fallback ───────────────────────
  if (!result) {
    logger.error(`All AI tiers failed for this message`);

    const { resortContact1 } = require('../config/env');
    const defaultBackup = resortContact1 || '9257657665';

    let primaryNumber = resortSettings?.whatsappNumbers
      ?.find(n => n.isPrimary)?.number;

    // Check if the primary number is missing or invalid (non-numeric, e.g. "main")
    if (!primaryNumber || !/^\+?\d+$/.test(primaryNumber)) {
      // Fallback to first active number that is numeric
      const firstValidActive = resortSettings?.whatsappNumbers
        ?.filter(n => n.isActive && /^\+?\d+$/.test(n.number))
        ?.map(n => n.number)?.[0];
      
      primaryNumber = firstValidActive || defaultBackup;
    }

    result = `Ji iske baare me main team se confirm karke batata hun. Ya seedha call karein: ${primaryNumber} 📞`;
  }

  // Cache FAQ responses
  if (!isBookingQuery) {
    const cacheKey = hashString(incomingMessage + bookingStage);
    responseCache.set(cacheKey, {
      response: result,
      timestamp: Date.now()
    });
  }

  return result;
}

// ── Startup fallback check ──────────────────────────────────────────
function checkStartupFallbackPhone() {
  const { resortContact1 } = require('../config/env');
  if (!resortContact1 || !/^\+?\d+$/.test(resortContact1)) {
    logger.warn(`[WARNING] RESORT_CONTACT_1 is not set or contains non-numeric characters: "${resortContact1}". Fallback messages might render with invalid phone numbers.`);
  } else {
    logger.info(`Startup check: Fallback contact phone number validated: ${resortContact1}`);
  }
}

// ── Startup AI_TEST_MODE warning ─oooooooo────────────────────────────
function checkStartupTestMode() {
  if (aiTestMode) {
    logger.warn('');
    logger.warn('⚠️  AI_TEST_MODE IS ON — using local Ollama only, NOT connected to real AI providers.');
    logger.warn('⚠️  Do not use this mode with the live resort WhatsApp number.');
    logger.warn('');
  }
}
checkStartupTestMode();
checkStartupFallbackPhone();

module.exports = {
  getAIResponse,
  detectLanguage,
  sanitizeReply,
  getModelHealthLast1Hour,
  isReplyValid
};
