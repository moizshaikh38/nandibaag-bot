const { Chat, Settings } = require('../models');
const { getAIResponse, detectLanguage } = require('./aiService');
const { scoreMessage } = require('./leadScoring');
const { scheduleFollowUps, cancelPendingFollowUps, containsOptOutPhrases, markChatAsOptedOut } = require('./followUpService');
const { sendMessage, activeSockets } = require('./whatsappService');
const logger = require('../config/logger');

/**
 * Handles incoming WhatsApp messages
 * 
 * This is the core message routing logic:
 * 1. Find or create Chat document
 * 2. Check mode (AI/human, global/per-chat)
 * 3. If AI mode: generate response, score lead, schedule follow-ups
 * 4. If human mode: notify staff, don't auto-reply
 * 5. Handle opt-out phrases
 * 6. Update chat language detection
 * 
 * @param {string} sessionId - WhatsApp session ID
 * @param {object} msg - Baileys message object
 * @param {object} io - Socket.io instance
 */
async function handleIncomingMessage(sessionId, msg, io) {
  const tStart = Date.now();
  try {
    // Extract message details (Baileys format)
    const customerPhone = msg.key.remoteJid.replace("@s.whatsapp.net", "");
    const messageText = msg.message?.conversation || msg.message?.extendedTextMessage?.text || "";
    
    // Detect message type
    let messageType = 'text';
    if (msg.message?.imageMessage) messageType = 'image';
    else if (msg.message?.videoMessage) messageType = 'video';
    else if (msg.message?.audioMessage) messageType = 'audio';
    else if (msg.message?.documentMessage) messageType = 'document';
    else if (msg.message?.stickerMessage) messageType = 'sticker';
    
    if (!messageText) {
      logger.debug(`Ignoring non-text message from ${customerPhone}`);
      return;
    }
    
    console.log(`[TIMING] [1/6] Received message from WhatsApp at ${new Date().toISOString()}`);
    logger.info(`Processing message from ${customerPhone}: ${messageText.substring(0, 50)}...`);

    // Trigger WhatsApp "typing..." state immediately (Baileys format)
    try {
      const sock = activeSockets.get(sessionId);
      if (sock) {
        const jid = msg.key.remoteJid;
        await sock.sendPresenceUpdate("composing", jid);
      }
    } catch (chatErr) {
      logger.debug(`Failed to send typing state: ${chatErr.message}`);
    }
    
    // Get settings for global mode and resort info
    console.log(`[TIMING] [2/6] Starting prompt building and AI chain execution after ${Date.now() - tStart}ms`);
    const settings = await Settings.findOne();
    console.log(`[DEBUG] Settings found: ${!!settings}, globalMode: ${settings?.globalMode}`);
    if (!settings) {
      logger.error('Settings not found');
      return;
    }
    
    // Find or create chat
    let chat = await Chat.findOne({ customerPhone });
    console.log(`[DEBUG] Chat found: ${!!chat}, mode: ${chat?.mode}`);
    
    if (!chat) {
      chat = new Chat({
        customerPhone,
        whatsappNumberUsed: sessionId,
        mode: settings.globalMode,
        language: 'unknown',
        messages: [],
        bookingStage: 'none',
        bookingDraft: {},
        isNewConversation: true,
        isArchived: false
      });
      await chat.save();
      console.log(`[DEBUG] Created new chat for ${customerPhone}, mode: ${chat.mode}`);
    }
    
    // Check for opt-out phrases
    if (containsOptOutPhrases(messageText)) {
      await markChatAsOptedOut(chat._id);
      logger.info(`Customer ${customerPhone} opted out`);
      return;
    }
    
    // Update chat language detection
    const detectedLanguage = detectLanguage(messageText);
    if (chat.language === 'unknown' || chat.language !== detectedLanguage) {
      chat.language = detectedLanguage;
    }
    
    // Add customer message to chat
    chat.messages.push({
      sender: 'customer',
      text: messageText,
      timestamp: new Date(),
      messageType
    });
    
    chat.lastMessageAt = new Date();
    
    // Cancel pending follow-ups since customer is engaged
    await cancelPendingFollowUps(chat._id, 'customer_replied');
    
    // Determine mode (only per-chat mode is used now)
    const mode = chat.mode;
    console.log(`[DEBUG] Chat mode: ${mode}`);
    
    if (mode === 'human') {
      // Human mode - don't auto-reply, just save and notify staff
      await chat.save();
      logger.info(`Chat ${customerPhone} in human mode, message saved, no auto-reply`);
      
      // Emit event to dashboard for staff notification
      const { getIO } = require('../sockets');
      try {
        const io = getIO();
        io.emit('chat:new_message', {
          chatId: chat._id,
          customerPhone,
          message: messageText
        });
      } catch (error) {
        logger.error(`Failed to emit socket event: ${error.message}`);
      }
      
      return;
    }
    
    // AI mode - generate response
    console.log(`[DEBUG] [3/6] Calling getAIResponse now...`);
    try {
      const aiReply = await getAIResponse(chat, messageText, settings);
      console.log(`[TIMING] [4/6] getAIResponse finished, AI reply generated in ${Date.now() - tStart}ms`);
      console.log(`[DEBUG] AI reply (first 100 chars): ${aiReply?.substring(0, 100)}`);
      
      // Add AI reply to chat
      chat.messages.push({
        sender: 'bot',
        text: aiReply,
        timestamp: new Date(),
        messageType: 'text'
      });
      
      // Update conversation state
      if (chat.isNewConversation) {
        chat.isNewConversation = false;
      }
      
      await chat.save();
      
      // Send reply via WhatsApp
      const tSendStart = Date.now();
      console.log(`[DEBUG] [5/6] Sending message via session "${sessionId}" to phone "${customerPhone}"`);
      console.log(`[DEBUG] remoteJid was: ${msg.key.remoteJid}`);
      try {
        await sendMessage(sessionId, customerPhone, aiReply);
        console.log(`[TIMING] [6/6] Sent message back via WhatsApp in ${Date.now() - tSendStart}ms. Total: ${Date.now() - tStart}ms.`);
      } catch (sendErr) {
        console.error(`[ERROR] sendMessage FAILED for session "${sessionId}" to "${customerPhone}": ${sendErr.message}`);
        console.error(`[ERROR] Stack: ${sendErr.stack}`);
      }
      
      // Stop "typing..." state (Baileys format)
      try {
        const sock = activeSockets.get(sessionId);
        if (sock) {
          const jid = msg.key.remoteJid;
          await sock.sendPresenceUpdate("paused", jid);
        }
      } catch (chatErr) {
        logger.debug(`Failed to send paused state: ${chatErr.message}`);
      }
      
      // Score the message for lead tracking
      await scoreMessage(chat, messageText, aiReply);
      
      // Schedule follow-ups if this is first booking interest
      const previousStage = chat.bookingStage;
      if (previousStage === 'none' && chat.bookingStage !== 'none') {
        await scheduleFollowUps(chat._id, customerPhone);
      }
      
      logger.info(`AI response sent to ${customerPhone}`);
      
    } catch (aiError) {
      logger.error(`AI generation failed for ${customerPhone}: ${aiError.message}`);
      
      // Save chat even if AI fails
      await chat.save();
      
      // Emit AI failure alert
      const { emitAIFailureAlert } = require('./leadScoring');
      emitAIFailureAlert(chat._id, customerPhone, aiError.message);
    }
    
  } catch (error) {
    logger.error(`Error handling message: ${error.message}`);
    // Don't throw - let the message queue continue
  }
}

module.exports = {
  handleIncomingMessage
};
