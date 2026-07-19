const { FollowUp, Chat } = require('../models');
const logger = require('../config/logger');

/**
 * Schedules follow-up messages for a chat
 * 
 * Creates 4 FollowUp documents with scheduledFor times:
 * - 3 hours from now
 * - 1 day from now
 * - 3 days from now
 * - 7 days from now
 * 
 * Called when a chat first shows booking interest (bookingStage != 'none')
 * 
 * @param {string} chatId - Chat ID
 * @param {string} customerPhone - Customer phone number
 */
async function scheduleFollowUps(chatId, customerPhone) {
  const now = new Date();
  
  // Check if follow-ups already exist for this chat
  const existingFollowUps = await FollowUp.find({ chatId });
  if (existingFollowUps.length > 0) {
    logger.info(`Follow-ups already exist for chat ${chatId}, skipping scheduling`);
    return;
  }
  
  // Check if chat has opted out
  const chat = await Chat.findById(chatId);
  if (chat && chat.optedOut) {
    logger.info(`Chat ${chatId} has opted out, not scheduling follow-ups`);
    return;
  }
  
  const stages = ['3hr', '1day', '3day', '7day'];
  const delays = [
    3 * 60 * 60 * 1000,      // 3 hours
    24 * 60 * 60 * 1000,     // 1 day
    3 * 24 * 60 * 60 * 1000, // 3 days
    7 * 24 * 60 * 60 * 1000  // 7 days
  ];
  
  const followUps = [];
  
  for (let i = 0; i < stages.length; i++) {
    const scheduledFor = new Date(now.getTime() + delays[i]);
    
    const followUp = new FollowUp({
      chatId,
      customerPhone,
      stage: stages[i],
      scheduledFor,
      status: 'pending'
    });
    
    followUps.push(followUp);
  }
  
  await FollowUp.insertMany(followUps);
  logger.info(`Scheduled 4 follow-ups for chat ${chatId} (${customerPhone})`);
}

/**
 * Cancels all pending follow-ups for a chat
 * 
 * Called when:
 * - Customer sends a new message (they're engaged)
 * - A Booking is created
 * - Customer opts out
 * - Staff takes over (mode = human)
 * 
 * @param {string} chatId - Chat ID
 * @param {string} reason - Cancellation reason
 */
async function cancelPendingFollowUps(chatId, reason) {
  const result = await FollowUp.updateMany(
    {
      chatId,
      status: 'pending'
    },
    {
      status: 'cancelled',
      cancelReason: reason
    }
  );
  
  if (result.modifiedCount > 0) {
    logger.info(`Cancelled ${result.modifiedCount} pending follow-ups for chat ${chatId} (reason: ${reason})`);
  }
}

/**
 * Checks if a message contains opt-out phrases
 * 
 * @param {string} message - Message text
 * @returns {boolean} True if message contains opt-out phrases
 */
function containsOptOutPhrases(message) {
  const lowerMessage = message.toLowerCase();
  const optOutPhrases = [
    'stop', 'band karo', 'mat bhejo', 'no more messages', 'unsubscribe',
    'don\'t send', 'please stop', 'not interested', 'remove me',
    'ruko', 'bas karo', 'aur mat bhejo', 'message mat karo'
  ];
  
  return optOutPhrases.some(phrase => lowerMessage.includes(phrase));
}

/**
 * Marks a chat as opted out and cancels all follow-ups
 * 
 * @param {string} chatId - Chat ID
 */
async function markChatAsOptedOut(chatId) {
  await Chat.findByIdAndUpdate(chatId, { optedOut: true });
  await cancelPendingFollowUps(chatId, 'opted_out');
  logger.info(`Chat ${chatId} marked as opted out`);
}

module.exports = {
  scheduleFollowUps,
  cancelPendingFollowUps,
  containsOptOutPhrases,
  markChatAsOptedOut
};
