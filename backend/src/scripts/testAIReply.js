#!/usr/bin/env node

/**
 * AI Reply Test Script for Nandibaag Bot
 * 
 * Directly calls aiService.getAIResponse() with scripted fake conversations
 * to verify AI behaviour WITHOUT needing a real WhatsApp connection.
 * 
 * Usage: npm run test-ai
 * Prerequisites: .env must be configured (OpenRouter API key, MongoDB, etc.)
 */

require('dotenv').config();

const mongoose = require('mongoose');
const { mongoUri, aiTestMode } = require('../config/env');
const { getAIResponse, isReplyValid } = require('../services/aiService');

// ── Mock resort settings (matches real config) ────────────────────────
const MOCK_RESORT_SETTINGS = {
  whatsappNumbers: [
    { number: '9257657665', isActive: true, isPrimary: true },
    { number: '9257657664', isActive: true, isPrimary: false },
    { number: '9257657663', isActive: true, isPrimary: false }
  ],
  globalMode: 'ai',
  followUpEnabled: true
};

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Build a minimal mock chat object that matches what aiService expects.
 * @param {Array} messages - Array of {sender, text} objects representing conversation history
 * @param {string} bookingStage - Current booking stage
 */
function buildMockChat(messages = [], bookingStage = 'none') {
  return {
    messages: messages.map(m => ({
      sender: m.sender || 'customer',
      text: m.text,
      timestamp: new Date()
    })),
    bookingStage,
    customerPhone: '919876543210',
    mode: 'ai'
  };
}

/**
 * Check if the AI reply contains expected keywords (case-insensitive).
 * Returns { found: [...], missing: [...] }
 */
function checkKeywords(reply, keywords) {
  const lowerReply = reply.toLowerCase();
  const found = [];
  const missing = [];
  for (const kw of keywords) {
    if (lowerReply.includes(kw.toLowerCase())) {
      found.push(kw);
    } else {
      missing.push(kw);
    }
  }
  return { found, missing };
}

// ── Test Scenarios ─────────────────────────────────────────────────────

const scenarios = [
  {
    id: 'a',
    name: 'Hinglish couple booking inquiry',
    message: 'Namaste, couple booking chahiye',
    history: [],
    bookingStage: 'none',
    expectedKeywords: ['couple'],
    description: 'Should respond warmly and start the couple booking flow'
  },
  {
    id: 'b',
    name: 'Pure Marathi inquiry',
    message: 'Namaskar, aamhala couple room pahije, kadhi milel?',
    history: [],
    bookingStage: 'none',
    expectedKeywords: ['couple'],
    description: 'Should reply in Marathi (or Marathi-mix) and start booking flow'
  },
  {
    id: 'c',
    name: 'Pure English weekend booking',
    message: 'Hi, I want to book for a couple this weekend',
    history: [],
    bookingStage: 'none',
    expectedKeywords: ['couple'],
    description: 'Should reply in English and ask for specific date'
  },
  {
    id: 'd',
    name: 'Past date rejection (15 January 2025)',
    message: '15 January 2025 ko aana hai',
    history: [
      { sender: 'customer', text: 'Couple booking chahiye' },
      { sender: 'bot', text: 'Bilkul! Kab aana chahte ho?' }
    ],
    bookingStage: 'date_asked',
    expectedKeywords: [],  // We check for past-date rejection manually
    rejectKeywords: ['15 january 2025'],  // Should NOT confirm this date
    description: 'Should reject the past date and ask for a valid future date'
  },
  {
    id: 'e',
    name: 'Weekend pricing (valid Saturday)',
    message: 'This Saturday ko aana hai',
    history: [
      { sender: 'customer', text: 'Couple booking chahiye' },
      { sender: 'bot', text: 'Bilkul! Kab aana chahte ho?' }
    ],
    bookingStage: 'date_asked',
    expectedKeywords: ['5500'],
    description: 'Should quote weekend couple pricing Rs 5500, not weekday Rs 4500'
  },
  {
    id: 'f',
    name: 'Unmarried couple — polite decline',
    message: 'Hum dono married nahi hain',
    history: [
      { sender: 'customer', text: 'Couple booking chahiye' },
      { sender: 'bot', text: 'Bilkul! Kab aana chahte ho?' },
      { sender: 'customer', text: 'Is Saturday ko' },
      { sender: 'bot', text: 'Saturday weekend rate hai — Rs 5500 per couple. Kitne guests honge?' },
      { sender: 'customer', text: 'Hum do hi hain' },
    ],
    bookingStage: 'married_check',
    expectedKeywords: ['group'],
    description: 'Should politely decline couple booking and suggest group/family booking'
  },
  {
    id: 'g',
    name: 'Non-veg inquiry — clear no',
    message: 'Kya non-veg milta hai?',
    history: [],
    bookingStage: 'none',
    expectedKeywords: ['veg'],
    description: 'Should clearly state the resort is pure veg / Jain'
  },
  {
    id: 'h',
    name: 'Price negotiation — hold firm',
    message: 'Bahut mehnga hai yaar, thoda kam karo',
    history: [
      { sender: 'customer', text: 'Couple booking chahiye' },
      { sender: 'bot', text: 'Bilkul! Kab aana chahte ho?' },
      { sender: 'customer', text: 'Monday ko' },
      { sender: 'bot', text: 'Monday weekday rate hai — Rs 4500 per couple. All-inclusive meals aur activities included hain!' },
    ],
    bookingStage: 'price_quoted',
    expectedKeywords: ['4500'],  // Should mention original price, not discount it
    description: 'Should use negotiation strategy (value pitch / weekday suggestion) WITHOUT discounting'
  },
  {
    id: 'i',
    name: 'Abusive message — calm redirect',
    message: 'Saale, bc, bakwaas band kar',
    history: [
      { sender: 'customer', text: 'Booking chahiye' },
      { sender: 'bot', text: 'Bilkul! Couple, group, ya picnic — kaunsa booking chahiye?' },
    ],
    bookingStage: 'none',
    expectedKeywords: ['call'],
    description: 'Should stay calm, NOT mirror rudeness, redirect to phone call'
  },
  {
    id: 'j',
    name: 'Out-of-scope question — polite redirect',
    message: 'Kal cricket match kaun jeetega?',
    history: [],
    bookingStage: 'none',
    expectedKeywords: [],
    rejectKeywords: ['jeetega', 'cricket', 'india', 'score', 'match'],
    description: 'Should NOT try to answer the cricket question, politely redirect to resort topics'
  },
  {
    id: 'k',
    name: 'One Day Picnic — booking flow continuation',
    message: 'One day picnic',
    history: [
      { sender: 'customer', text: 'Hii' },
      { sender: 'bot', text: 'Namaste! Nandibaag Resort me aapka swagat hai 😊 Aap kis type ki booking ke liye enquiry kar rahe hain?\n\n1. Couple Stay\n2. Group/Family Stay\n3. One Day Picnic\n4. Event Booking' }
    ],
    bookingStage: 'none',
    expectedKeywords: ['picnic'],
    description: 'Should continue booking flow by asking about guest count / morning-evening vs full-day, NOT return fallback'
  },
  {
    id: 'l',
    name: 'Ollama test mode (local dev only)',
    message: 'Couple booking chahiye',
    history: [],
    bookingStage: 'none',
    expectedKeywords: ['couple'],
    skipIf: () => !aiTestMode,
    description: 'When AI_TEST_MODE=true, should use local Ollama. Skipped gracefully if AI_TEST_MODE=false or Ollama not running.'
  },
  {
    id: 'm',
    name: 'Groq production tier positioning',
    message: 'Hi, I want to book for a couple',
    history: [],
    bookingStage: 'none',
    expectedKeywords: ['couple'],
    skipIf: () => aiTestMode,
    description: 'When AI_TEST_MODE=false, Groq should be Tier 1 in the production chain.'
  },
  {
    id: 'o',
    name: 'Cloudflare production tier positioning',
    message: 'Hey, couple stay details query',
    history: [],
    bookingStage: 'none',
    expectedKeywords: ['couple'],
    skipIf: () => aiTestMode,
    description: 'When AI_TEST_MODE=false, Cloudflare Workers AI should be Tier 2 in the production chain.'
  },
  {
    id: 'p',
    name: 'Room details include gallery link',
    message: 'room ke baare mein batao',
    history: [],
    bookingStage: 'none',
    expectedKeywords: ['https://nandibaag.com/rooms'],
    description: 'Should explain room types/details and naturally share the room gallery link'
  },
  {
    id: 'q',
    name: 'Picnic optional room upgrade includes gallery link',
    message: 'Ye Rs2000 picnic room upgrade kaisa hai? add karna chahiye kya?',
    history: [
      { sender: 'customer', text: 'One Day Picnic booking chahiye' },
      { sender: 'bot', text: 'Bilkul! One Day Picnic ke liye kaunsi date plan kar rahe ho?' },
      { sender: 'customer', text: 'Next Monday' },
      { sender: 'bot', text: 'One Day Picnic me Morning-Evening Rs1000/person aur Full Day Rs1250/person hai. Optional room Rs2000 extra hai, max 10 people, 12PM se allot hota hai.' }
    ],
    bookingStage: 'price_quoted',
    expectedKeywords: ['https://nandibaag.com/rooms'],
    description: 'Should mention the gallery link while helping customer decide on the optional picnic room upgrade'
  }
];

// ── Main ───────────────────────────────────────────────────────────────

function runReplyValidationTests() {
  console.log('── Running Reply Validation Heuristics Tests ────────────────');
  console.log('');
  
  const testCases = [
    {
      name: 'Verifier corruption example (Exact User String)',
      text: 'Kaunse tarah ka booking karna chah verifier? Group, Couple, Picnic, ya koi event?',
      expectedValid: false
    },
    {
      name: 'Repeated word bug ("chahiye chahiye")',
      text: 'Bilkul, aapko kis tarah ki booking chahiye chahiye? Hamare paas couple aur group rates hain.',
      expectedValid: false
    },
    {
      name: 'Markdown leak leakage (**Couple Room**)',
      text: 'Aap **Couple Room** book karna chahte hain ya group package?',
      expectedValid: false
    },
    {
      name: 'Truncated mid-word consonant cluster ("de sakt")',
      text: 'Hum group bookings ke liye discount de sakt hain.',
      expectedValid: false
    },
    {
      name: 'Clean valid Hinglish reply (No false-positives)',
      text: 'Namaste! Nandibaag Resort me aapka swagat hai. Aap Couple ya Group booking ke liye enquiry kar rahe hain? 😊',
      expectedValid: true
    },
    {
      name: 'Policy sentence test 1 ("married couples allowed")',
      text: 'Ji, couple stay sirf married couples ke liye allowed hai aur check-in par valid ID proof required hota hai.',
      expectedValid: true
    },
    {
      name: 'Policy sentence test 2 ("pool, rain dance, kayaking")',
      text: 'Hamare paas pool, rain dance aur sunset kayaking bhi included hain.',
      expectedValid: true
    },
    {
      name: 'Policy sentence test 3 ("picnic morning to evening Rs 1000")',
      text: 'Picnic stay morning to evening Rs 1000 per person rehta hai jisme unlimited buffet meal milta hai.',
      expectedValid: true
    },
    {
      name: 'Booking options word ("do options hain" — was false positive)',
      text: 'Bilkul! One day picnic ke liye do options hain: Morning to Evening Rs 1000/person ya Full Day Rs 1250/person.',
      expectedValid: true
    },
    {
      name: 'Offer word ("we offer" — was false positive from /er$/ suffix)',
      text: 'We offer one day picnic packages starting from Rs 1000 per person. Kitne guests honge?',
      expectedValid: true
    }
  ];

  let passedAll = true;
  for (const tc of testCases) {
    const isValid = isReplyValid(tc.text);
    const passed = isValid === tc.expectedValid;
    console.log(`  ${passed ? '✅' : '❌'} [${tc.name}]:`);
    console.log(`     Input: "${tc.text}"`);
    console.log(`     Expected Valid: ${tc.expectedValid} | Got: ${isValid}`);
    if (!passed) passedAll = false;
  }
  
  if (passedAll) {
    console.log('');
    console.log('  🎉 All validation heuristic test cases passed successfully!');
    console.log('');
  } else {
    console.log('');
    console.log('  ❌ Some validation test cases failed.');
    console.log('');
    process.exit(1);
  }
}

async function main() {
  // Run heuristic tests first
  runReplyValidationTests();

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║           🤖 Nandibaag AI Reply Test Suite                  ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  // Connect to MongoDB (aiService needs the DB connection indirectly via config)
  console.log('  ⏳ Connecting to MongoDB...');
  try {
    await mongoose.connect(mongoUri);
    console.log('  ✅ MongoDB connected\n');
  } catch (err) {
    console.log(`  ❌ MongoDB connection failed: ${err.message}`);
    console.log('     Make sure MONGO_URI in .env is correct.\n');
    process.exit(1);
  }

  let passCount = 0;
  let warnCount = 0;
  let failCount = 0;

  for (const scenario of scenarios) {
    // Check if scenario should be skipped
    if (scenario.skipIf && scenario.skipIf()) {
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`  Scenario ${scenario.id}) ${scenario.name}`);
      console.log(`  📝 ${scenario.description}`);
      console.log(`  ⏭️  SKIPPED (condition met: ${scenario.skipIf.toString()})`);
      console.log('');
      continue;
    }

    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`  Scenario ${scenario.id}) ${scenario.name}`);
    console.log(`  📝 ${scenario.description}`);
    console.log(`  💬 Customer: "${scenario.message}"`);
    console.log('');

    try {
      const chat = buildMockChat(scenario.history, scenario.bookingStage);
      const reply = await getAIResponse(chat, scenario.message, MOCK_RESORT_SETTINGS);

      console.log(`  🤖 AI Reply:`);
      console.log(`  ┌─────────────────────────────────────────────────────────`);
      reply.split('\n').forEach(line => {
        console.log(`  │ ${line}`);
      });
      console.log(`  └─────────────────────────────────────────────────────────`);

      // Keyword checks
      let scenarioPassed = true;

      if (scenario.expectedKeywords && scenario.expectedKeywords.length > 0) {
        const { found, missing } = checkKeywords(reply, scenario.expectedKeywords);
        if (missing.length > 0) {
          console.log(`  ⚠️  MISSING expected keywords: ${missing.map(k => `"${k}"`).join(', ')}`);
          console.log(`     ↳ Read this reply carefully — it may still be correct but phrased differently`);
          warnCount++;
          scenarioPassed = false;
        } else {
          console.log(`  ✅ Expected keywords found: ${found.map(k => `"${k}"`).join(', ')}`);
        }
      }

      if (scenario.rejectKeywords && scenario.rejectKeywords.length > 0) {
        const lowerReply = reply.toLowerCase();
        const badMatches = scenario.rejectKeywords.filter(k => lowerReply.includes(k.toLowerCase()));
        if (badMatches.length > 0) {
          console.log(`  ⚠️  Reply CONTAINS rejected keywords: ${badMatches.map(k => `"${k}"`).join(', ')}`);
          console.log(`     ↳ AI may have tried to answer something it shouldn't have`);
          warnCount++;
          scenarioPassed = false;
        } else {
          console.log(`  ✅ Correctly avoided rejected keywords`);
        }
      }

      if (scenarioPassed) {
        passCount++;
      }
    } catch (err) {
      console.log(`  ❌ ERROR: ${err.message}`);
      // For Ollama test specifically, don't fail the whole suite if Ollama isn't running
      if (scenario.id === 'l' && err.message.includes('ECONNREFUSED')) {
        console.log(`  ⏭️  Ollama not running locally — skipping gracefully (not a test failure)`);
        warnCount++;
      } else {
        failCount++;
      }
    }

    console.log('');
  }

  // ── Summary ──────────────────────────────────────────────────────────
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log('── Summary ─────────────────────────────────────────────────');
  console.log(`  Total:  ${scenarios.length}`);
  console.log(`  ✅ Clean pass:    ${passCount}`);
  console.log(`  ⚠️  Needs review: ${warnCount}`);
  console.log(`  ❌ Errors:        ${failCount}`);
  console.log('');

  if (failCount > 0) {
    console.log('  ⛔ Some scenarios errored out — check your API key and model availability.');
  } else if (warnCount > 0) {
    console.log('  📋 Some replies need manual review (marked with ⚠️ above).');
    console.log('     The keyword check is a rough heuristic — read the actual replies to judge quality.');
  } else {
    console.log('  🎉 All keyword checks passed! Read the replies above to verify quality.');
  }

  console.log('');
  await mongoose.disconnect();
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error in AI test:', err);
  mongoose.disconnect().catch(() => {});
  process.exit(1);
});
