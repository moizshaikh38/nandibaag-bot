#!/usr/bin/env node

/**
 * Debug Script: Reproduce "One day picnic" booking flow failure
 * 
 * Simulates the exact 2-message conversation:
 *   Customer: "Hii"
 *   Bot: [greeting + booking type question]
 *   Customer: "One day picnic"
 * 
 * Tests isReplyValid() against sample replies with detailed rejection reasons,
 * then runs the full getAIResponse() tier chain.
 */

require('dotenv').config();

const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const { mongoUri } = require('../config/env');
const { getAIResponse, isReplyValid, sanitizeReply } = require('../services/aiService');
const { buildSystemPrompt } = require('../services/systemPrompt');

const MOCK_RESORT_SETTINGS = {
  whatsappNumbers: [
    { number: '9257657665', isActive: true, isPrimary: true },
    { number: '9257657664', isActive: true, isPrimary: false },
    { number: '9257657663', isActive: true, isPrimary: false }
  ],
  globalMode: 'ai',
  followUpEnabled: true
};

/**
 * Enhanced isReplyValid with detailed diagnostic output — mirrors the real
 * implementation exactly, but returns structured info on WHY it fails.
 */
function isReplyValidDiagnostic(text) {
  if (!text || typeof text !== 'string') {
    return { valid: false, reason: 'EMPTY_OR_NOT_STRING', detail: `typeof=${typeof text}` };
  }

  const trimmed = text.trim();

  // 1. Length check
  if (trimmed.length < 3) {
    return { valid: false, reason: 'TOO_SHORT', detail: `length=${trimmed.length}` };
  }
  if (trimmed.length > 700) {
    return { valid: false, reason: 'TOO_LONG', detail: `length=${trimmed.length}` };
  }

  // 2. Unexpected script check
  const scriptMatch = trimmed.match(/[^\x00-\x7F\u0900-\u097F\u0A80-\u0AFF\u2600-\u27BF\u{1F300}-\u{1F9FF}]/u);
  if (scriptMatch) {
    const charCode = scriptMatch[0].codePointAt(0);
    return { valid: false, reason: 'UNEXPECTED_SCRIPT', detail: `char="${scriptMatch[0]}" codePoint=U+${charCode.toString(16).toUpperCase()} at position=${trimmed.indexOf(scriptMatch[0])}` };
  }

  // 3. Markdown/code syntax
  if (/`{3}/.test(trimmed)) {
    return { valid: false, reason: 'MARKDOWN_CODE_BLOCK', detail: 'Found triple backticks' };
  }
  const mdMatch = trimmed.match(/[<>#\*]/);
  if (mdMatch) {
    const pos = trimmed.indexOf(mdMatch[0]);
    const context = trimmed.substring(Math.max(0, pos - 15), Math.min(trimmed.length, pos + 15));
    return { valid: false, reason: 'MARKDOWN_SYNTAX', detail: `char="${mdMatch[0]}" at pos=${pos}, context="...${context}..."` };
  }

  // 4. Repeated word check
  const repeatedWordRegex = /\b(\w+)\s+\1\b/ig;
  const allowedReduplications = new Set([
    'kabhi', 'dhire', 'garam', 'gol', 'sath', 'saath', 'thoda', 'thodi',
    'bade', 'chote', 'door', 'pass', 'paas', 'chal', 'chalo', 'ruko',
    'suno', 'haan', 'acha', 'accha', 'ek', 'naye', 'nayee', 'garma', 'sirf'
  ]);

  let match;
  while ((match = repeatedWordRegex.exec(trimmed)) !== null) {
    const word = match[1].toLowerCase();
    if (!allowedReduplications.has(word)) {
      return { valid: false, reason: 'REPEATED_WORD', detail: `"${word} ${word}" at pos=${match.index}` };
    }
  }

  // 5. English word whitelist checks — rebuild the same sets as aiService
  const manualWhitelist = [
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
    'okay', 'sure', 'thanks', 'card', 'cash', 'upi', 'google', 'id',
    'valid', 'friends', 'stay', 'possible', 'allow', 'allows', 'allowed',
    'support', 'customer', 'assistant', 'proof', 'confirm', 'help'
  ];

  const allowedResortWords = new Set();
  for (const w of manualWhitelist) {
    allowedResortWords.add(w.toLowerCase());
  }

  // Extract words from systemPrompt.js
  try {
    const systemPromptPath = path.join(__dirname, '../services/systemPrompt.js');
    if (fs.existsSync(systemPromptPath)) {
      const fileContent = fs.readFileSync(systemPromptPath, 'utf8');
      const extractedWords = fileContent.toLowerCase().match(/[a-z]+/g) || [];
      for (const w of extractedWords) {
        if (w.length >= 3) {
          allowedResortWords.add(w);
        }
      }
    }
  } catch (err) {
    console.error('  [WARN] Could not read systemPrompt.js for word extraction');
  }

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

  const words = trimmed.toLowerCase().match(/[a-z]+/g) || [];

  for (const word of words) {
    if (word.length < 3) continue;
    if (allowedResortWords.has(word)) continue;

    const isCommonEnglish = commonEnglishWords.has(word);
    const hasEnglishSuffix = /er$|or$|tion$|ment$|ive$|able$|ly$/.test(word);

    if (isCommonEnglish) {
      return { valid: false, reason: 'COMMON_ENGLISH_WORD', detail: `word="${word}" (in commonEnglishWords set)`, flaggedWords: [word] };
    }
    if (hasEnglishSuffix) {
      return { valid: false, reason: 'ENGLISH_SUFFIX', detail: `word="${word}" matches suffix pattern`, flaggedWords: [word] };
    }

    if (!/[aeiouy]/.test(word)) {
      return { valid: false, reason: 'NO_VOWELS', detail: `word="${word}" has no vowels`, flaggedWords: [word] };
    }

    if (/sakt$|chah$|karn$/.test(word)) {
      return { valid: false, reason: 'TRUNCATED_WORD', detail: `word="${word}" matches truncation pattern`, flaggedWords: [word] };
    }
  }

  return { valid: true, reason: 'ALL_CHECKS_PASSED', detail: 'No issues found' };
}


async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  🔍 Debug: "One day picnic" Booking Flow Failure            ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  // ── Part 1: Test isReplyValid() against likely AI replies ──────────
  console.log('━━━━ PART 1: isReplyValid() Diagnostic Against Sample Replies ━━━━');
  console.log('');

  const sampleReplies = [
    'Accha! One day picnic ke liye kitne log honge? Morning-Evening ya Full Day picnic plan kar rahe hain?',
    'Bilkul! One day picnic ke liye do options hain:\nMorning to Evening: Rs 1000/person (breakfast + lunch + dinner)\nFull Day: Rs 1250/person (breakfast + lunch + hi-tea + dinner)\nKitne guests honge?',
    'Great choice! For a one day picnic, we have two options:\nMorning to Evening: Rs 1000 per person\nFull Day: Rs 1250 per person\nHow many guests will be joining?',
    'Ji zaroor! Picnic ke liye kitne log aayenge aur kab aana chahte ho? Date bata dijiye toh main details share karta hun.',
    'Bahut accha! Picnic plan ke liye date aur guest count batayiye. Rs 1000 per person morning to evening aur Rs 1250 per person full day rehta hai.',
    'Sure! We offer one day picnic packages. Could you tell me the date and number of guests?',
  ];

  for (let i = 0; i < sampleReplies.length; i++) {
    const reply = sampleReplies[i];
    const resultOfficial = isReplyValid(reply);
    const resultDiag = isReplyValidDiagnostic(reply);

    console.log(`  Sample ${i + 1}: "${reply.substring(0, 80)}${reply.length > 80 ? '...' : ''}"`);
    console.log(`    isReplyValid() = ${resultOfficial}`);
    if (!resultOfficial) {
      console.log(`    ❌ REJECTION REASON: ${resultDiag.reason}`);
      console.log(`       DETAIL: ${resultDiag.detail}`);
      if (resultDiag.flaggedWords) console.log(`       FLAGGED WORDS: ${resultDiag.flaggedWords.join(', ')}`);
    } else {
      console.log(`    ✅ PASSED`);
    }
    console.log('');
  }

  // ── Part 2: Connect to MongoDB and run actual AI call ──────────────
  console.log('━━━━ PART 2: Live AI Tier Test (exact reproduction) ━━━━');
  console.log('');

  console.log('  ⏳ Connecting to MongoDB...');
  try {
    await mongoose.connect(mongoUri);
    console.log('  ✅ MongoDB connected');
  } catch (err) {
    console.log(`  ❌ MongoDB failed: ${err.message}`);
    process.exit(1);
  }
  console.log('');

  // Exact 2-message history: Customer said "Hii", bot responded with booking type question
  const chat = {
    messages: [
      { sender: 'customer', text: 'Hii', timestamp: new Date() },
      { sender: 'bot', text: 'Namaste! Nandibaag Resort me aapka swagat hai 😊 Aap kis type ki booking ke liye enquiry kar rahe hain?\n\n1. Couple Stay\n2. Group/Family Stay\n3. One Day Picnic\n4. Event Booking', timestamp: new Date() }
    ],
    bookingStage: 'none',
    customerPhone: '919876543210',
    mode: 'ai'
  };

  const incomingMessage = 'One day picnic';

  console.log('  📋 Conversation History:');
  console.log('     Customer: "Hii"');
  console.log('     Bot: "Namaste! Nandibaag Resort me aapka swagat hai ... Aap kis type ki booking..."');
  console.log(`  💬 New Customer Message: "${incomingMessage}"`);
  console.log('');

  console.log('  ⏳ Calling getAIResponse() (will hit all tiers with detailed logging)...');
  console.log('  ─────────────────────────────────────────────────────');

  const t0 = Date.now();
  const reply = await getAIResponse(chat, incomingMessage, MOCK_RESORT_SETTINGS);
  const elapsed = Date.now() - t0;

  console.log('  ─────────────────────────────────────────────────────');
  console.log('');
  console.log(`  ⏱️  Total time: ${elapsed}ms`);
  console.log('');
  console.log('  🤖 FINAL AI Reply:');
  console.log('  ┌─────────────────────────────────────────────────────────');
  reply.split('\n').forEach(line => {
    console.log(`  │ ${line}`);
  });
  console.log('  └─────────────────────────────────────────────────────────');
  console.log('');

  // Check if it's the hardcoded fallback
  const isFallback = reply.includes('team se confirm karke batata hun');
  if (isFallback) {
    console.log('  ⚠️  RESULT: Got HARDCODED FALLBACK — all tiers failed or were rejected!');
  } else {
    console.log('  ✅ RESULT: Got a real AI reply (not fallback)');
  }

  // Validate the final reply with diagnostic
  const finalValid = isReplyValid(reply);
  const finalDiag = isReplyValidDiagnostic(reply);
  console.log(`  isReplyValid(finalReply) = ${finalValid}`);
  if (!finalValid) {
    console.log(`  ❌ REJECTION: ${finalDiag.reason} — ${finalDiag.detail}`);
  }
  console.log('');

  await mongoose.disconnect();
  console.log('  ✅ Done. MongoDB disconnected.');
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
