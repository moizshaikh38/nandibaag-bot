const cron = require('node-cron');
const { FollowUp, Chat, Settings } = require('../models');
const { getFollowUpMessage } = require('../utils/followUpTemplates');
const { sendMessage } = require('./whatsappService');
const logger = require('../config/logger');

/**
 * Follow-up cron job service
 * 
 * Runs every 5 minutes to process pending follow-up messages.
 * 
 * Logic:
 * - Queries FollowUp where status='pending' AND scheduledFor <= now
 * - For each follow-up:
 *   - Checks Chat isn't archived/optedOut/mode=human
 *   - Generates message via getFollowUpMessage
 *   - Sends via whatsappService.sendMessage
 *   - Marks FollowUp as sent
 *   - Appends message to chat.messages
 * - Skips if WhatsApp session not connected (retries next tick)
 * - Cancels stale follow-ups (>24h past due) with 'session_unavailable_expired'
 * - Wrapped in try/catch to prevent single failure from stopping future runs
 * - Only runs if Settings.followUpEnabled is true
 */

let cronJob = null;

/**
 * Processes a single follow-up
 * 
 * @param {object} followUp - FollowUp document
 */
async function processFollowUp(followUp) {
  try {
    // Get the chat
    const chat = await Chat.findById(followUp.chatId);
    
    if (!chat) {
      logger.warn(`Chat not found for follow-up ${followUp._id}, cancelling`);
      await FollowUp.findByIdAndUpdate(followUp._id, {
        status: 'cancelled',
        cancelReason: 'chat_not_found'
      });
      return;
    }
    
    // Check if chat is archived, opted out, or in human mode
    if (chat.isArchived || chat.optedOut || chat.mode === 'human') {
      logger.info(`Chat ${chat._id} is archived/optedOut/human, cancelling follow-up ${followUp._id}`);
      await FollowUp.findByIdAndUpdate(followUp._id, {
        status: 'cancelled',
        cancelReason: chat.isArchived ? 'chat_archived' : 
                     chat.optedOut ? 'opted_out' : 'human_mode'
      });
      return;
    }
    
    // Check if scheduledFor is more than 24 hours in the past
    const now = new Date();
    const scheduledFor = new Date(followUp.scheduledFor);
    const hoursPast = (now - scheduledFor) / (1000 * 60 * 60);
    
    if (hoursPast > 24) {
      logger.warn(`Follow-up ${followUp._id} is ${hoursPast.toFixed(1)}h past due, cancelling as stale`);
      await FollowUp.findByIdAndUpdate(followUp._id, {
        status: 'cancelled',
        cancelReason: 'session_unavailable_expired'
      });
      return;
    }
    
    // Generate follow-up message
    const message = getFollowUpMessage(
      followUp.stage,
      chat.language || 'hinglish',
      chat.customerName || null
    );
    
    // Determine which WhatsApp session to use
    const sessionId = chat.whatsappNumberUsed || 'default';
    
    // Send message
    try {
      await sendMessage(sessionId, chat.customerPhone, message);
      logger.info(`Follow-up sent to ${chat.customerPhone} (stage: ${followUp.stage})`);
      
      // Mark follow-up as sent
      await FollowUp.findByIdAndUpdate(followUp._id, {
        status: 'sent',
        sentAt: now
      });
      
      // Append message to chat
      chat.messages.push({
        sender: 'bot',
        text: message,
        timestamp: now,
        messageType: 'text'
      });
      
      await chat.save();
      
    } catch (sendError) {
      // If send fails due to session not connected, skip and retry next tick
      if (sendError.message.includes('not connected') || sendError.message.includes('not initialized')) {
        logger.warn(`WhatsApp session not connected for ${sessionId}, will retry follow-up ${followUp._id} next tick`);
        return; // Don't mark as cancelled, will retry
      }
      
      // Other errors - log and cancel
      logger.error(`Failed to send follow-up ${followUp._id}: ${sendError.message}`);
      await FollowUp.findByIdAndUpdate(followUp._id, {
        status: 'cancelled',
        cancelReason: 'send_failed'
      });
    }
    
  } catch (error) {
    logger.error(`Error processing follow-up ${followUp._id}: ${error.message}`);
    // Don't throw - continue with other follow-ups
  }
}

/**
 * Main cron job function that runs every 5 minutes
 */
async function runFollowUpJob() {
  try {
    // Check if follow-ups are enabled in settings
    const settings = await Settings.findOne();
    if (!settings || !settings.followUpEnabled) {
      logger.debug('Follow-ups are disabled in settings, skipping cron job');
      return;
    }
    
    logger.debug('Running follow-up cron job...');
    
    // Find all pending follow-ups that are due
    const now = new Date();
    const pendingFollowUps = await FollowUp.find({
      status: 'pending',
      scheduledFor: { $lte: now }
    });
    
    if (pendingFollowUps.length === 0) {
      logger.debug('No pending follow-ups due');
      return;
    }
    
    logger.info(`Processing ${pendingFollowUps.length} pending follow-ups`);
    
    // Process each follow-up sequentially to avoid overwhelming WhatsApp API
    for (const followUp of pendingFollowUps) {
      await processFollowUp(followUp);
    }
    
    logger.info('Follow-up cron job completed');
    
  } catch (error) {
    logger.error(`Follow-up cron job failed: ${error.message}`);
    // Don't throw - cron will continue running
  }
}

/**
 * Starts the follow-up cron job
 * 
 * Runs every 5 minutes (cron: every-5-min * * * *)
 */
function startFollowUpCron() {
  if (cronJob) {
    logger.warn('Follow-up cron job already running');
    return;
  }
  
  // Run every 5 minutes
  cronJob = cron.schedule('*/5 * * * *', runFollowUpJob, {
    timezone: 'Asia/Kolkata'
  });
  
  logger.info('Follow-up cron job started (runs every 5 minutes)');
}

/**
 * Stops the follow-up cron job
 */
function stopFollowUpCron() {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
    logger.info('Follow-up cron job stopped');
  }
}

/**
 * Manually triggers the follow-up job (for testing)
 */
async function triggerFollowUpJob() {
  logger.info('Manually triggering follow-up job');
  await runFollowUpJob();
}

module.exports = {
  startFollowUpCron,
  stopFollowUpCron,
  triggerFollowUpJob,
  runFollowUpJob
};
