const { Lead } = require('../models');
const logger = require('../config/logger');

// Socket.io emitter will be set by the server initialization
let io = null;

/**
 * Sets the Socket.io instance for emitting events to the frontend
 * @param {object} socketIo - Socket.io server instance
 */
function setSocketIo(socketIo) {
  io = socketIo;
}

/**
 * Scores a message and updates the Lead document
 * 
 * Awards points based on conversation signals:
 * - Asked about pricing/cost → +15
 * - Gave a specific date → +25
 * - Gave number of guests → +15
 * - Reached bookingStage 'price_quoted' → +10
 * - Gave their name → +15
 * - Gave phone number → +20
 * - Asked about photos/location → +5
 * - Booking intent phrases → +30
 * 
 * Updates Lead.status based on cumulative score:
 * - 0-30 = cold
 * - 31-60 = warm
 * - 61-100 = hot
 * 
 * @param {object} chat - Chat document
 * @param {string} incomingMessage - Customer's incoming message
 * @param {string} aiReply - AI's response (optional, for context)
 * @returns {object} Updated Lead document
 */
async function scoreMessage(chat, incomingMessage, aiReply) {
  const chatId = chat._id;
  const customerPhone = chat.customerPhone;
  const lowerMessage = incomingMessage.toLowerCase();
  
  // Find or create Lead document
  let lead = await Lead.findOne({ chatId });
  
  if (!lead) {
    lead = new Lead({
      chatId,
      customerPhone,
      score: 0,
      scoreFactors: [],
      status: 'cold',
      lastActivityAt: new Date()
    });
  }
  
  const previousScore = lead.score;
  const previousStatus = lead.status;
  let pointsAdded = 0;
  const newFactors = [];
  
  // Check for pricing/cost keywords
  const pricingKeywords = ['price', 'cost', 'rate', 'kitna', 'kitne', 'rate', 'charges', 'fees', 'paisa', 'rupees', 'rs', '₹', 'pricing', 'quote', 'quotation'];
  if (pricingKeywords.some(keyword => lowerMessage.includes(keyword))) {
    pointsAdded += 15;
    newFactors.push({ factor: 'asked_pricing', points: 15, addedAt: new Date() });
  }
  
  // Check for specific date (simple heuristic - contains date-like patterns)
  const datePatterns = /\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|tomorrow|today|kal|aaj|next week|coming weekend|this weekend/i;
  if (datePatterns.test(lowerMessage)) {
    pointsAdded += 25;
    newFactors.push({ factor: 'gave_date', points: 25, addedAt: new Date() });
  }
  
  // Check for guest count
  const guestPatterns = /(\d+)\s*(people|person|guests|guest|log|adami|members)/i;
  if (guestPatterns.test(lowerMessage)) {
    pointsAdded += 15;
    newFactors.push({ factor: 'gave_guest_count', points: 15, addedAt: new Date() });
  }
  
  // Check for bookingStage progression
  if (chat.bookingStage === 'price_quoted') {
    // Only add if not already added for this stage
    const hasPriceQuotedFactor = lead.scoreFactors.some(f => f.factor === 'reached_price_quoted');
    if (!hasPriceQuotedFactor) {
      pointsAdded += 10;
      newFactors.push({ factor: 'reached_price_quoted', points: 10, addedAt: new Date() });
    }
  }
  
  // Check for name (simple heuristic - common Indian names or patterns)
  const namePatterns = /my name is|i am|mera naam|mujhe|main|name:/i;
  if (namePatterns.test(lowerMessage) && lowerMessage.length > 10) {
    // Only add if not already added
    const hasNameFactor = lead.scoreFactors.some(f => f.factor === 'gave_name');
    if (!hasNameFactor) {
      pointsAdded += 15;
      newFactors.push({ factor: 'gave_name', points: 15, addedAt: new Date() });
    }
  }
  
  // Check for phone number (10-digit pattern)
  const phonePattern = /\b\d{10}\b/;
  if (phonePattern.test(lowerMessage)) {
    // Only add if not already added
    const hasPhoneFactor = lead.scoreFactors.some(f => f.factor === 'gave_phone');
    if (!hasPhoneFactor) {
      pointsAdded += 20;
      newFactors.push({ factor: 'gave_phone', points: 20, addedAt: new Date() });
    }
  }
  
  // Check for photos/location browsing signals
  const browseKeywords = ['photo', 'picture', 'image', 'location', 'where', 'kaha', 'kahan', 'direction', 'map', 'gallery', 'room', 'cottage'];
  if (browseKeywords.some(keyword => lowerMessage.includes(keyword))) {
    pointsAdded += 5;
    newFactors.push({ factor: 'browsing_photos_location', points: 5, addedAt: new Date() });
  }
  
  // Check for booking intent phrases
  const bookingIntentPhrases = [
    'book karna hai', 'book karunga', 'book karungi', 'booking karna hai',
    'confirm karo', 'confirm kar do', 'confirm karna hai',
    'book', 'booking', 'confirm', 'reserve', 'reservation',
    'pakka karo', 'final karo', 'book kar dena'
  ];
  if (bookingIntentPhrases.some(phrase => lowerMessage.includes(phrase))) {
    pointsAdded += 30;
    newFactors.push({ factor: 'booking_intent', points: 30, addedAt: new Date() });
  }
  
  // Update lead score and factors
  if (pointsAdded > 0) {
    lead.score = Math.min(100, lead.score + pointsAdded);
    lead.scoreFactors.push(...newFactors);
    lead.lastActivityAt = new Date();
    
    // Update status based on score
    if (lead.score >= 61) {
      lead.status = 'hot';
    } else if (lead.score >= 31) {
      lead.status = 'warm';
    } else {
      lead.status = 'cold';
    }
    
    await lead.save();
    logger.info(`Lead scored: +${pointsAdded} points for ${customerPhone}, new score: ${lead.score}, status: ${lead.status}`);
    
    // Check for hot lead alert (first time crossing 60)
    if (lead.score >= 60 && previousScore < 60) {
      await checkForHotLeadAlert(lead);
    }
  } else {
    // Just update last activity time even if no points added
    lead.lastActivityAt = new Date();
    await lead.save();
  }
  
  return lead;
}

/**
 * Checks if lead has crossed the hot threshold (60 points) for the first time
 * and emits a Socket.io alert to the dashboard
 * 
 * @param {object} lead - Lead document
 */
async function checkForHotLeadAlert(lead) {
  logger.info(`Hot lead detected: ${lead.customerPhone} with score ${lead.score}`);
  
  if (io) {
    io.emit('lead:hot_alert', {
      chatId: lead.chatId,
      customerPhone: lead.customerPhone,
      score: lead.score,
      status: lead.status
    });
  }
}

/**
 * Emits an AI failure alert to the dashboard
 * Called from aiService.js when all 3 models fail
 * 
 * @param {string} chatId - Chat ID
 * @param {string} customerPhone - Customer phone number
 * @param {string} error - Error message
 */
function emitAIFailureAlert(chatId, customerPhone, error) {
  logger.error(`AI failure alert for ${customerPhone}: ${error}`);
  
  if (io) {
    io.emit('lead:ai_failure_alert', {
      chatId,
      customerPhone,
      error
    });
  }
}

/**
 * Marks a lead as converted when a booking is completed
 * 
 * @param {string} chatId - Chat ID
 */
async function markLeadAsConverted(chatId) {
  const lead = await Lead.findOne({ chatId });
  
  if (lead) {
    lead.status = 'converted';
    lead.convertedAt = new Date();
    lead.score = 100; // Max score for converted leads
    await lead.save();
    logger.info(`Lead marked as converted: ${chatId}`);
    
    if (io) {
      io.emit('lead:converted', {
        chatId,
        customerPhone: lead.customerPhone
      });
    }
  }
}

module.exports = {
  setSocketIo,
  scoreMessage,
  checkForHotLeadAlert,
  emitAIFailureAlert,
  markLeadAsConverted
};
