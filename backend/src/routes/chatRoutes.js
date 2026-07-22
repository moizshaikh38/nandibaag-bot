const express = require('express');
const { verifyToken } = require('../middleware/auth');
const { Chat, Lead } = require('../models');
const { sendMessage } = require('../services/whatsappService');
const { cancelPendingFollowUps, containsOptOutPhrases, markChatAsOptedOut } = require('../services/followUpService');
const logger = require('../config/logger');

const router = express.Router();

/**
 * GET /api/chats
 * List all chats with search and pagination
 */
router.get('/', verifyToken, async (req, res, next) => {
  try {
    const { search, page = 1, limit = 1000 } = req.query;
    
    const query = { isArchived: false };
    
    if (search) {
      query.$or = [
        { customerPhone: { $regex: search, $options: 'i' } },
        { customerName: { $regex: search, $options: 'i' } }
      ];
    }
    
    const skip = (page - 1) * limit;
    
    const [chats, total] = await Promise.all([
      Chat.find(query)
        .sort({ lastMessageAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Chat.countDocuments(query)
    ]);

    // Attach leadStatus to each chat
    const chatIds = chats.map(c => c._id);
    const leads = await Lead.find({ chatId: { $in: chatIds } });
    const leadMap = {};
    leads.forEach(l => {
      leadMap[l.chatId.toString()] = l.status;
    });

    const chatsWithLeadStatus = chats.map(c => {
      const plainChat = c.toObject();
      plainChat.leadStatus = leadMap[c._id.toString()] || 'cold';
      return plainChat;
    });
    
    res.json({
      success: true,
      chats: chatsWithLeadStatus,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/chats/:id
 * Get single chat with full message history
 */
router.get('/:id', verifyToken, async (req, res, next) => {
  try {
    const chat = await Chat.findById(req.params.id);
    
    if (!chat) {
      return res.status(404).json({
        success: false,
        message: 'Chat not found'
      });
    }
    
    res.json({
      success: true,
      chat
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/chats/:id/mode
 * Toggle per-chat AI/human mode
 */
router.patch('/:id/mode', verifyToken, async (req, res, next) => {
  try {
    const { mode } = req.body;
    
    if (!mode || !['ai', 'human'].includes(mode)) {
      return res.status(400).json({
        success: false,
        message: 'mode must be "ai" or "human"'
      });
    }
    
    const chat = await Chat.findByIdAndUpdate(
      req.params.id,
      { mode },
      { new: true }
    );
    
    if (!chat) {
      return res.status(404).json({
        success: false,
        message: 'Chat not found'
      });
    }
    
    // If switching to human, cancel pending follow-ups
    if (mode === 'human') {
      await cancelPendingFollowUps(chat._id, 'staff_handled');
    }
    
    // Emit socket event for real-time sync across tabs/devices
    try {
      const { getIO } = require('../sockets');
      const io = getIO();
      io.emit('chat:mode_updated', { chatId: chat._id, mode: chat.mode });
    } catch (socketErr) {
      // Socket emit is best-effort, don't fail the request
      console.warn('Socket emit failed for chat:mode_updated:', socketErr.message);
    }

    res.json({
      success: true,
      chat
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/chats/:id/message
 * Staff sends manual message from dashboard
 */
router.post('/:id/message', verifyToken, async (req, res, next) => {
  try {
    const { text } = req.body;
    
    if (!text) {
      return res.status(400).json({
        success: false,
        message: 'text is required'
      });
    }
    
    const chat = await Chat.findById(req.params.id);
    
    if (!chat) {
      return res.status(404).json({
        success: false,
        message: 'Chat not found'
      });
    }
    
    const sessionId = chat.whatsappNumberUsed || 'default';
    logger.info(`[STAFF MESSAGE] Route hit for chatId: ${chat._id}, phone: ${chat.customerPhone}, requested session: "${sessionId}"`);
    
    let deliveryStatus = 'sent';
    let sendError = null;

    // Try sending message via WhatsApp
    try {
      await sendMessage(sessionId, chat.customerPhone, text);
    } catch (err) {
      deliveryStatus = 'failed';
      sendError = err.message;
      logger.error(`[STAFF MESSAGE FAILED] Could not send to ${chat.customerPhone}: ${err.message}`);
    }
    
    // Append to chat messages with deliveryStatus
    const newMessageObj = {
      sender: 'staff',
      text,
      timestamp: new Date(),
      messageType: 'text',
      deliveryStatus
    };

    chat.messages.push(newMessageObj);
    chat.lastMessageAt = new Date();
    await chat.save();
    
    // Cancel pending follow-ups since staff engaged
    await cancelPendingFollowUps(chat._id, 'staff_handled');
    
    // Emit socket event for real-time dashboard sync
    try {
      const { getIO } = require('../sockets');
      const io = getIO();
      console.log(`[EMITTING new_message] Staff message for chat ${chat._id}, status: ${deliveryStatus}`);
      io.emit('chat:new_message', {
        chatId: chat._id,
        customerPhone: chat.customerPhone,
        message: text,
        sender: 'staff',
        timestamp: newMessageObj.timestamp,
        deliveryStatus
      });
    } catch (socketErr) {
      logger.warn(`Failed to emit socket event for staff message: ${socketErr.message}`);
    }

    if (deliveryStatus === 'failed') {
      return res.status(500).json({
        success: false,
        message: `Message failed to send on WhatsApp: ${sendError}`
      });
    }
    
    res.json({
      success: true,
      message: 'Message sent',
      messageObj: newMessageObj
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/chats/:id/reset
 * Reset conversation (keeps history for record)
 */
router.post('/:id/reset', verifyToken, async (req, res, next) => {
  try {
    const chat = await Chat.findById(req.params.id);
    
    if (!chat) {
      return res.status(404).json({
        success: false,
        message: 'Chat not found'
      });
    }
    
    // Add system marker
    chat.messages.push({
      sender: 'bot',
      text: '--- New Conversation Started ---',
      timestamp: new Date(),
      messageType: 'text'
    });
    
    // Reset conversation state
    chat.isNewConversation = true;
    chat.bookingStage = 'none';
    chat.bookingDraft = {};
    chat.conversationResetAt = new Date();
    
    await chat.save();
    
    // Cancel pending follow-ups
    await cancelPendingFollowUps(chat._id, 'conversation_reset');
    
    res.json({
      success: true,
      message: 'Conversation reset'
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/chats/:id/archive
 * Soft delete chat
 */
router.patch('/:id/archive', verifyToken, async (req, res, next) => {
  try {
    const chat = await Chat.findByIdAndUpdate(
      req.params.id,
      { isArchived: true },
      { new: true }
    );
    
    if (!chat) {
      return res.status(404).json({
        success: false,
        message: 'Chat not found'
      });
    }
    
    // Cancel pending follow-ups
    await cancelPendingFollowUps(chat._id, 'chat_archived');
    
    res.json({
      success: true,
      message: 'Chat archived'
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/chats/clear-all
 * Clear all chats and associated lead/follow-up data
 */
router.delete('/clear-all', verifyToken, async (req, res, next) => {
  try {
    const { Lead, FollowUp, Booking } = require('../models');
    
    const [chatRes, leadRes, followRes, bookingRes] = await Promise.all([
      Chat.deleteMany({}),
      Lead.deleteMany({}),
      FollowUp.deleteMany({}),
      Booking.deleteMany({})
    ]);
    
    logger.info(`Cleared all chats (${chatRes.deletedCount}), leads (${leadRes.deletedCount}), follow-ups (${followRes.deletedCount})`);
    
    res.json({
      success: true,
      message: `Cleared ${chatRes.deletedCount} chats and ${leadRes.deletedCount} leads`,
      deletedCount: chatRes.deletedCount
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
