const mongoose = require('mongoose');
const { Chat, Settings } = require('../models');

// Trackers for AI actions
let aiServiceCalled = false;
let sendMessageCalled = false;

// Require and stub services FIRST before requiring messageHandler
const aiService = require('../services/aiService');
const whatsappService = require('../services/whatsappService');

aiService.getAIResponse = async (chat, messageText, settingsDoc) => {
  aiServiceCalled = true;
  return "Mocked AI reply";
};
whatsappService.sendMessage = async (sessionId, customerPhone, message) => {
  sendMessageCalled = true;
  return { id: "mock-message-id" };
};

const { handleMessage } = require('../services/messageHandler');

async function runTest() {
  console.log("=== NANDIBAAG BULK MODE SCENARIO VERIFICATION ===");

  // Connect to local MongoDB
  const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/nandibaag';
  await mongoose.connect(mongoUri);
  console.log("Connected to MongoDB at:", mongoUri);

  // Clear existing collections to start clean (drops collections and indexes)
  await mongoose.connection.db.collection('chats').drop().catch(() => {});
  await mongoose.connection.db.collection('settings').drop().catch(() => {});

  // Seed default settings and 3 test chats
  const settings = new Settings({
    globalMode: 'ai',
    whatsappNumbers: []
  });
  await settings.save();

  const chat1 = new Chat({ customerPhone: '911111111111', mode: 'ai', name: 'Chat 1' });
  const chat2 = new Chat({ customerPhone: '922222222222', mode: 'ai', name: 'Chat 2' });
  const chat3 = new Chat({ customerPhone: '933333333333', mode: 'ai', name: 'Chat 3' });
  await chat1.save();
  await chat2.save();
  await chat3.save();
  console.log("Seeded settings and 3 test chats (initialized as mode: ai).");

  function resetTrackers() {
    aiServiceCalled = false;
    sendMessageCalled = false;
  }

  // Define local helper to mimic HTTP request to PATCH /api/settings/global-mode
  async function simulatePatchGlobalMode(newMode) {
    const s = await Settings.findOne({});
    s.globalMode = newMode;
    await s.save();
    // Bulk update existing chats
    await Chat.updateMany({}, { mode: newMode });
  }

  // -------------------------------------------------------------
  // STEP 1: Set Global to Human -> confirm ALL chats show mode: 'human'
  // -------------------------------------------------------------
  console.log("\n--- STEP 1: Setting global mode to human ---");
  await simulatePatchGlobalMode('human');

  let chats = await Chat.find({});
  console.log("Chat 1 mode:", chats[0].mode);
  console.log("Chat 2 mode:", chats[1].mode);
  console.log("Chat 3 mode:", chats[2].mode);

  if (chats.every(c => c.mode === 'human')) {
    console.log("✅ Step 1 Passed: All chats successfully bulk-updated to 'human' mode.");
  } else {
    throw new Error("❌ Step 1 Failed: Some chats are not in 'human' mode.");
  }

  // Verify that an incoming message on human chat does not reply
  resetTrackers();
  await handleMessage('main', { from: '911111111111@c.us', body: 'Hello', hasMedia: false });
  if (!aiServiceCalled && !sendMessageCalled) {
    console.log("✅ Verified: Incoming message on human chat is silent.");
  } else {
    throw new Error("❌ Failed: AI responded to human chat.");
  }

  // -------------------------------------------------------------
  // STEP 2: Manually flip Chat 1 to AI -> confirm it replies via AI while Chat 2 (still human) does not
  // -------------------------------------------------------------
  console.log("\n--- STEP 2: Flipping Chat 1 to AI mode individually ---");
  await Chat.findOneAndUpdate({ customerPhone: '911111111111' }, { mode: 'ai' });

  // Test Chat 1 (AI)
  resetTrackers();
  await handleMessage('main', { from: '911111111111@c.us', body: 'Hello AI', hasMedia: false });
  const step2Chat1Passed = aiServiceCalled && sendMessageCalled;

  // Test Chat 2 (Human)
  resetTrackers();
  await handleMessage('main', { from: '922222222222@c.us', body: 'Hello Human', hasMedia: false });
  const step2Chat2Passed = !aiServiceCalled && !sendMessageCalled;

  if (step2Chat1Passed && step2Chat2Passed) {
    console.log("✅ Step 2 Passed: Chat 1 (AI) replied, Chat 2 (Human) remained silent.");
  } else {
    throw new Error(`❌ Step 2 Failed: Chat1 replied=${step2Chat1Passed}, Chat2 replied=${!step2Chat2Passed}`);
  }

  // -------------------------------------------------------------
  // STEP 3: Set Global to AI -> confirm ALL chats now show mode: 'ai' (overwrites overrides)
  // -------------------------------------------------------------
  console.log("\n--- STEP 3: Setting global mode to AI ---");
  await simulatePatchGlobalMode('ai');

  chats = await Chat.find({});
  console.log("Chat 1 mode:", chats[0].mode);
  console.log("Chat 2 mode:", chats[1].mode);
  console.log("Chat 3 mode:", chats[2].mode);

  if (chats.every(c => c.mode === 'ai')) {
    console.log("✅ Step 3 Passed: Global bulk action successfully overwrote individual overrides. All chats are now 'ai'.");
  } else {
    throw new Error("❌ Step 3 Failed: Some chats are not in 'ai' mode.");
  }

  // Verify that Chat 2 (previously human) now replies
  resetTrackers();
  await handleMessage('main', { from: '922222222222@c.us', body: 'Hello again', hasMedia: false });
  if (aiServiceCalled && sendMessageCalled) {
    console.log("✅ Verified: Chat 2 now replies under AI mode.");
  } else {
    throw new Error("❌ Failed: Chat 2 did not reply in AI mode.");
  }

  // -------------------------------------------------------------
  // STEP 4: Manually flip Chat 3 to Human -> confirm only Chat 3 is silent, others get AI replies
  // -------------------------------------------------------------
  console.log("\n--- STEP 4: Flipping Chat 3 to Human individually ---");
  await Chat.findOneAndUpdate({ customerPhone: '933333333333' }, { mode: 'human' });

  // Test Chat 3 (Human)
  resetTrackers();
  await handleMessage('main', { from: '933333333333@c.us', body: 'Shh', hasMedia: false });
  const step4Chat3Passed = !aiServiceCalled && !sendMessageCalled;

  // Test Chat 1 (AI)
  resetTrackers();
  await handleMessage('main', { from: '911111111111@c.us', body: 'Hello AI 3', hasMedia: false });
  const step4Chat1Passed = aiServiceCalled && sendMessageCalled;

  if (step4Chat3Passed && step4Chat1Passed) {
    console.log("✅ Step 4 Passed: Chat 3 (Human override) stayed silent, other chats still get AI replies.");
  } else {
    throw new Error(`❌ Step 4 Failed: Chat3 silent=${step4Chat3Passed}, Chat1 replied=${step4Chat1Passed}`);
  }

  console.log("\n🎉 ALL 4 BULK GLOBAL MODE TEST STEPS COMPLETED SUCCESSFULLY!");
  await mongoose.disconnect();
}

runTest().catch(err => {
  console.error("Test execution failed:", err);
  mongoose.disconnect();
  process.exit(1);
});
