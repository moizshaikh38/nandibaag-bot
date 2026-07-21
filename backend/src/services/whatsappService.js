const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');
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
 * Multi-session WhatsApp service architecture:
 * 
 * This service manages multiple simultaneous WhatsApp sessions, one per resort number.
 * Each session is identified by a sessionId (label/number from Settings.whatsappNumbers).
 * 
 * Key design decisions:
 * - Map<sessionId, Client> stores active sessions in memory
 * - LocalAuth strategy persists auth data per session in sessions/{sessionId}/
 * - Auto-reconnect with exponential backoff (5s, 10s, 20s, 40s, 80s) up to 5 attempts
 * - Per-chat message queue prevents race conditions on Chat document updates
 * - Socket.io events keep dashboard in sync with session status
 * 
 * This is the most failure-prone part of the system due to:
 * - WhatsApp Web API instability
 * - Network connectivity issues
 * - Session expiration
 * - QR scanning delays
 * - Rate limiting from WhatsApp
 */

// Active sessions Map: sessionId -> Client instance
const sessions = new Map();

// Reconnect attempt counters: sessionId -> attempt count
const reconnectAttempts = new Map();

// Per-chat message queue locks: chatPhone -> Promise
// This ensures messages for the same chat are processed sequentially
const messageQueueLocks = new Map();

/**
 * Returns the absolute path to a session's on-disk data folder
 */
function getSessionDataPath(sessionId) {
  return path.join(__dirname, '../../sessions', sessionId);
}

/**
 * Deletes a session's on-disk data folder (stale/corrupted session cleanup)
 */
function deleteSessionFolder(sessionId) {
  const sessionPath = getSessionDataPath(sessionId);
  try {
    if (fs.existsSync(sessionPath)) {
      fs.rmSync(sessionPath, { recursive: true, force: true });
      logger.info(`Deleted session folder for ${sessionId}: ${sessionPath}`);
    }
  } catch (err) {
    logger.error(`Failed to delete session folder for ${sessionId}: ${err.message}`);
  }
}

/**
 * Cleans up stale Puppeteer/Chrome lock files (SingletonLock, SingletonSocket)
 * to prevent the "The browser is already running..." error on nodemon restarts.
 */
function clearSessionLocks(sessionId) {
  const sessionPath = getSessionDataPath(sessionId);
  const lockPath = path.join(sessionPath, 'session/SingletonLock');
  const socketPath = path.join(sessionPath, 'session/SingletonSocket');
  try {
    if (fs.existsSync(lockPath)) {
      fs.unlinkSync(lockPath);
      logger.info(`Cleaned up stale SingletonLock for session ${sessionId}`);
    }
    if (fs.existsSync(socketPath)) {
      fs.unlinkSync(socketPath);
      logger.info(`Cleaned up stale SingletonSocket for session ${sessionId}`);
    }
  } catch (err) {
    logger.warn(`Could not delete session lock files for session ${sessionId}: ${err.message}`);
  }
}

/**
 * Initializes a WhatsApp session for a given sessionId.
 * 
 * IMPORTANT: This function is NON-BLOCKING. It registers all event listeners,
 * starts client.initialize() in the background, and returns immediately.
 * The caller should NOT await the full initialization — socket events
 * ('whatsapp:qr', 'whatsapp:ready', 'whatsapp:init_failed') drive the UI.
 *
 * @param {string} sessionId - Session identifier (label/number from Settings)
 * @param {object} options
 * @param {boolean} options.cleanStart - If true, delete any existing session folder first
 * @returns {{ client: Client, initPromise: Promise }} The client and its init promise
 */
function initSession(sessionId, { cleanStart = false } = {}) {
  // If there's already a live connected client, return it
  if (sessions.has(sessionId)) {
    const existingClient = sessions.get(sessionId);
    try {
      if (existingClient.info && existingClient.info.wid) {
        logger.warn(`Session ${sessionId} already connected, returning existing client`);
        return { client: existingClient, initPromise: Promise.resolve() };
      }
    } catch (_) {
      // Dead client — fall through to re-init
    }
    // Remove dead/stale client from map so we can re-init
    sessions.delete(sessionId);
  }

  if (cleanStart) {
    deleteSessionFolder(sessionId);
  } else {
    // Clear lock files from a previous abruptly killed Puppeteer session
    clearSessionLocks(sessionId);
  }

  logger.info(`Initializing WhatsApp session: ${sessionId}`);

  const puppeteerOptions = {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-default-apps',
        '--disable-sync',
        '--disable-translate',
        '--no-first-run',
        '--no-zygote',
        '--js-flags=--max-old-space-size=256'
      ]
    };

  // Use system-installed Chromium in Docker/production environments
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    puppeteerOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    logger.info(`Using custom Chrome path: ${process.env.PUPPETEER_EXECUTABLE_PATH}`);
  }

  const client = new Client({
    authStrategy: new LocalAuth({
      dataPath: getSessionDataPath(sessionId)
    }),
    puppeteer: puppeteerOptions
  });

  // ─── EVENT LISTENERS (registered BEFORE initialize) ───

  // QR code event - emit to frontend
  client.on('qr', async (qr) => {
    try {
      const qrDataUrl = await qrcode.toDataURL(qr);
      logger.info(`QR code generated for session ${sessionId}`);
      if (io) {
        io.emit('whatsapp:qr', { sessionId, qr: qrDataUrl });
      }
    } catch (error) {
      logger.error(`Failed to generate QR for session ${sessionId}: ${error.message}`);
    }
  });

  // Ready event - session successfully connected
  client.on('ready', async () => {
    logger.info(`WhatsApp session ${sessionId} is ready`);
    
    // Auto-save session to settings in database when successfully connected
    try {
      const { Settings } = require('../models');
      const settings = await Settings.findOne();
      if (settings) {
        const exists = settings.whatsappNumbers.some(n => n.label === sessionId);
        if (!exists) {
          settings.whatsappNumbers.push({
            number: sessionId,
            label: sessionId,
            isActive: true,
            isPrimary: settings.whatsappNumbers.length === 0
          });
          await settings.save();
          logger.info(`Added session ${sessionId} to Settings whatsappNumbers in database`);
        }
      }
    } catch (dbErr) {
      logger.error(`Failed to save session ${sessionId} to database settings: ${dbErr.message}`);
    }

    if (io) {
      io.emit('whatsapp:ready', { sessionId });
    }
    // Reset reconnect counter on successful connection
    reconnectAttempts.set(sessionId, 0);
  });

  // Authenticated event - session authenticated (before ready)
  client.on('authenticated', () => {
    logger.info(`Session ${sessionId} authenticated`);
  });

  // Auth failure event
  client.on('auth_failure', (message) => {
    logger.error(`Session ${sessionId} authentication failed: ${message}`);
    // Remove dead client from sessions map so retry can work
    sessions.delete(sessionId);
    if (io) {
      io.emit('whatsapp:auth_failure', { sessionId, message: String(message) });
    }
  });

  // Disconnected event - trigger auto-reconnect or clean up permanent unlinking
  client.on('disconnected', async (reason) => {
    const timestamp = new Date().toISOString();
    logger.warn(`[DISCONNECT] Session ${sessionId} disconnected at ${timestamp}. Reason: ${reason || 'UNKNOWN_REASON'}`);
    
    // Check if the reason indicates the session was permanently unlinked/logged out
    const upperReason = String(reason || '').toUpperCase();
    const isPermanentDisconnect = upperReason === 'LOGOUT' || upperReason === 'UNPAIRED';

    if (isPermanentDisconnect) {
      logger.warn(`[DISCONNECT] Session ${sessionId} permanently unlinked (Reason: ${reason}). Deleting session data and notifying dashboard.`);
      
      // Remove from active sessions
      sessions.delete(sessionId);
      
      // Reset reconnection attempt counters
      reconnectAttempts.set(sessionId, 0);

      // Delete stale session folder to prevent crash loops
      deleteSessionFolder(sessionId);

      if (io) {
        // Emit a clear dashboard alert using the standard channel but descriptive reason message
        io.emit('whatsapp:disconnected', { 
          sessionId, 
          reason: `UNLINKED (${reason}). WhatsApp number ${sessionId} was unlinked from the phone — please reconnect via QR/pairing code.`
        });
        // Also emit reconnect_failed to update ConnectPage connection state
        io.emit('whatsapp:reconnect_failed', { 
          sessionId,
          message: `WhatsApp number ${sessionId} was unlinked from the phone — please reconnect via QR/pairing code.`
        });
      }
      return; // Do NOT trigger auto-reconnect
    }

    if (io) {
      io.emit('whatsapp:disconnected', { sessionId, reason });
    }
    
    // Remove from sessions map
    sessions.delete(sessionId);
    
    // Trigger auto-reconnect with exponential backoff
    await autoReconnect(sessionId);
  });

  // Message event - route to messageHandler
  client.on('message', async (message) => {
    try {
      // Extract phone number from message
      const contact = message.from;
      let chatPhone = contact.replace('@c.us', '').replace('@s.whatsapp.net', '');
      
      if (contact.endsWith('@lid')) {
        try {
          const mapping = await client.getContactLidAndPhone(contact);
          if (mapping && mapping[0] && mapping[0].pn) {
            chatPhone = mapping[0].pn.replace('@c.us', '').replace('@s.whatsapp.net', '');
            message.resolvedPhone = chatPhone;
            logger.info(`Resolved LID ${contact} to phone ${chatPhone}`);
          }
        } catch (resolveErr) {
          logger.debug(`Failed to resolve phone from LID ${contact}: ${resolveErr.message}`);
        }
      }
      
      // Get or create lock for this chat
      let lock = messageQueueLocks.get(chatPhone);
      
      if (!lock) {
        lock = Promise.resolve();
        messageQueueLocks.set(chatPhone, lock);
      }
      
      // Queue this message processing behind any previous one for this chat
      messageQueueLocks.set(chatPhone, lock.then(async () => {
        try {
          // Import messageHandler dynamically to avoid circular dependency
          const messageHandler = require('./messageHandler');
          await messageHandler.handleMessage(sessionId, message);
        } catch (error) {
          logger.error(`Error processing message from ${chatPhone}: ${error.message}`);
        } finally {
          // Remove lock after processing
          messageQueueLocks.delete(chatPhone);
        }
      }));
      
    } catch (error) {
      logger.error(`Error queuing message: ${error.message}`);
    }
  });

  // ─── STORE SESSION AND INITIALIZE (non-blocking) ───
  sessions.set(sessionId, client);
  reconnectAttempts.set(sessionId, 0);

  // Fire-and-forget initialize — socket events will drive the frontend.
  // We capture the promise so callers CAN await it if they choose (e.g. restartAll).
  const initPromise = client.initialize()
    .then(() => {
      logger.info(`client.initialize() resolved for session ${sessionId}`);
    })
    .catch((error) => {
      logger.error(`client.initialize() FAILED for session ${sessionId}`);
      logger.error(`  Error: ${error.message}`);
      logger.error(`  Stack: ${error.stack}`);

      // Remove dead client from map so retry works
      sessions.delete(sessionId);

      // Emit failure event so frontend can show error + retry button
      if (io) {
        io.emit('whatsapp:init_failed', {
          sessionId,
          message: error.message,
          hint: 'Try deleting the stale session and retrying.'
        });
      }
    });

  return { client, initPromise };
}

/**
 * Auto-reconnect logic with exponential backoff
 * 
 * Attempts to reconnect a disconnected session up to 5 times with delays:
 * 5s, 10s, 20s, 40s, 80s
 * 
 * After 5 failed attempts, emits 'whatsapp:reconnect_failed' to alert staff
 * 
 * @param {string} sessionId - Session identifier
 */
async function autoReconnect(sessionId) {
  const maxAttempts = 5;
  const backoffDelays = [5000, 10000, 20000, 40000, 80000]; // 5s, 10s, 20s, 40s, 80s
  
  let attempts = reconnectAttempts.get(sessionId) || 0;
  
  if (attempts >= maxAttempts) {
    logger.error(`Session ${sessionId} reconnection failed after ${maxAttempts} attempts`);
    if (io) {
      io.emit('whatsapp:reconnect_failed', { sessionId });
    }
    reconnectAttempts.set(sessionId, 0);
    return;
  }
  
  const delay = backoffDelays[attempts];
  reconnectAttempts.set(sessionId, attempts + 1);
  
  logger.info(`Reconnecting session ${sessionId} in ${delay / 1000}s (attempt ${attempts + 1}/${maxAttempts})`);
  
  await new Promise(resolve => setTimeout(resolve, delay));
  
  try {
    const { initPromise } = initSession(sessionId);
    await initPromise;
  } catch (error) {
    logger.error(`Reconnection attempt ${attempts + 1} failed for session ${sessionId}: ${error.message}`);
    // Continue to next attempt via recursive call
    await autoReconnect(sessionId);
  }
}

/**
 * Initializes a WhatsApp session using pairing code instead of QR
 * 
 * This is an alternative authentication method where the user enters
 * a pairing code on their phone instead of scanning a QR code.
 * 
 * @param {string} sessionId - Session identifier
 * @param {string} phoneNumber - Phone number to send pairing code to (with country code, no +)
 * @returns {Client} The whatsapp-web.js Client instance
 */
async function initSessionWithPairingCode(sessionId, phoneNumber) {
  logger.info(`Initializing WhatsApp session ${sessionId} with pairing code for ${phoneNumber}`);
  
  const { client, initPromise } = initSession(sessionId);
  
  // Wait for client to be ready to request pairing code
  await new Promise((resolve) => {
    if (client.info) {
      resolve();
    } else {
      client.once('ready', resolve);
    }
  });
  
  try {
    const pairingCode = await client.requestPairingCode(phoneNumber);
    logger.info(`Pairing code generated for session ${sessionId}: ${pairingCode}`);
    
    if (io) {
      io.emit('whatsapp:pairing_code', { sessionId, code: pairingCode });
    }
  } catch (error) {
    logger.error(`Failed to request pairing code for session ${sessionId}: ${error.message}`);
    throw error;
  }
  
  return client;
}

/**
 * Gets the status of a specific session
 * 
 * @param {string} sessionId - Session identifier
 * @returns {string} Status: 'connected' | 'disconnected' | 'connecting' | 'not_initialized'
 */
function getSessionStatus(sessionId) {
  const client = sessions.get(sessionId);
  
  if (!client) {
    return 'not_initialized';
  }
  
  try {
    const info = client.info;
    if (info && info.wid) {
      return 'connected';
    } else {
      return 'connecting';
    }
  } catch (error) {
    return 'disconnected';
  }
}

/**
 * Gets the status of all configured WhatsApp sessions
 * 
 * @param {Array} whatsappNumbers - Array of WhatsApp number configs from Settings
 * @returns {Object} Map of sessionId -> status
 */
function getAllSessionsStatus(whatsappNumbers) {
  const statusMap = {};
  
  // First, map all sessions configured in settings
  for (const numberConfig of whatsappNumbers) {
    const sessionId = numberConfig.label || numberConfig.number;
    statusMap[sessionId] = getSessionStatus(sessionId);
  }
  
  // Also, add any other active sessions currently in memory (covers connecting/QR state)
  for (const sessionId of sessions.keys()) {
    if (!statusMap[sessionId]) {
      statusMap[sessionId] = getSessionStatus(sessionId);
    }
  }
  
  return statusMap;
}

/**
 * Sends a WhatsApp message through a specific session
 * 
 * Validates the session is connected before sending.
 * Formats phone number to WhatsApp JID format.
 * Implements retry logic for transient failures.
 * 
 * @param {string} sessionId - Session identifier
 * @param {string} toPhone - Recipient phone number (digits only or with @c.us)
 * @param {string} text - Message text to send
 * @throws {Error} If session is not connected or send fails after retry
 */
async function sendMessage(sessionId, toPhone, text) {
  const client = sessions.get(sessionId);
  
  if (!client) {
    throw new Error(`Session ${sessionId} not initialized`);
  }
  
  const status = getSessionStatus(sessionId);
  if (status !== 'connected') {
    throw new Error(`Session ${sessionId} is not connected (status: ${status})`);
  }
  
  // Format phone number to JID format
  let jid = toPhone;
  if (!jid.includes('@')) {
    // If it's a raw phone number, strip all non-digits and append @c.us
    const digits = toPhone.replace(/\D/g, '');
    jid = `${digits}@c.us`;
  }
  
  logger.info(`Sending message via session ${sessionId} to ${jid}`);
  
  let lastError = null;
  
  // Try sending, retry once after 3 seconds on failure
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await client.sendMessage(jid, text);
      logger.info(`Message sent successfully via session ${sessionId}`);
      return;
    } catch (error) {
      lastError = error;
      logger.warn(`Send attempt ${attempt + 1} failed for session ${sessionId}: ${error.message}`);
      
      if (attempt === 0) {
        // Wait 3 seconds before retry
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
  }
  
  throw new Error(`Failed to send message via session ${sessionId} after 2 attempts: ${lastError.message}`);
}

/**
 * Destroys a WhatsApp session gracefully.
 * 
 * Logs out the session, removes it from the sessions Map,
 * removes it from Settings, and optionally deletes the on-disk session folder.
 * 
 * @param {string} sessionId - Session identifier
 * @param {object} options
 * @param {boolean} options.deleteData - If true, also deletes the on-disk session folder
 */
async function destroySession(sessionId, { deleteData = true } = {}) {
  const client = sessions.get(sessionId);
  
  if (client) {
    try {
      await client.logout();
      logger.info(`Session ${sessionId} logged out`);
    } catch (error) {
      logger.error(`Error logging out session ${sessionId}: ${error.message}`);
    }
    
    try {
      await client.destroy();
      logger.info(`Session ${sessionId} destroyed`);
    } catch (error) {
      logger.error(`Error destroying session ${sessionId}: ${error.message}`);
    }
  } else {
    logger.warn(`Session ${sessionId} not found in memory, skipping logout/destroy`);
  }
  
  // Auto-remove session from settings in database when destroyed
  try {
    const { Settings } = require('../models');
    const settings = await Settings.findOne();
    if (settings) {
      const originalLength = settings.whatsappNumbers.length;
      settings.whatsappNumbers = settings.whatsappNumbers.filter(n => n.label !== sessionId);
      if (settings.whatsappNumbers.length !== originalLength) {
        await settings.save();
        logger.info(`Removed session ${sessionId} from Settings whatsappNumbers in database`);
      }
    }
  } catch (dbErr) {
    logger.error(`Failed to remove session ${sessionId} from database settings: ${dbErr.message}`);
  }

  sessions.delete(sessionId);
  reconnectAttempts.delete(sessionId);

  // Delete on-disk session folder to prevent stale/corrupted data blocking retries
  if (deleteData) {
    deleteSessionFolder(sessionId);
  }
  
  if (io) {
    io.emit('whatsapp:session_destroyed', { sessionId });
  }
}

/**
 * Restarts all active WhatsApp sessions
 * 
 * Called once at server startup to re-initialize every number marked
 * as isActive in Settings.whatsappNumbers.
 * 
 * Since LocalAuth data persists on disk, sessions reconnect without
 * requiring QR re-scanning (unless auth data is expired).
 * 
 * @param {Array} whatsappNumbers - Array of WhatsApp number configs from Settings
 */
async function restartAllActiveSessions(whatsappNumbers) {
  logger.info('Restarting all active WhatsApp sessions...');
  
  const activeNumbers = whatsappNumbers.filter(n => n.isActive);
  
  for (const numberConfig of activeNumbers) {
    const sessionId = numberConfig.label || numberConfig.number;
    
    try {
      logger.info(`Initializing session ${sessionId}...`);
      const { initPromise } = initSession(sessionId);
      await initPromise;
    } catch (error) {
      logger.error(`Failed to initialize session ${sessionId}: ${error.message}`);
    }
  }
  
  logger.info(`Completed restart of ${activeNumbers.length} active sessions`);
}

// Start a periodic health check cron job (runs every 2 minutes)
cron.schedule('*/2 * * * *', async () => {
  logger.debug(`Running WhatsApp session health check for ${sessions.size} active session(s)...`);
  for (const [sessionId, client] of sessions.entries()) {
    try {
      const state = await client.getState();
      logger.info(`Session health check: Session ${sessionId} state is ${state}`);
    } catch (err) {
      logger.error(`Session health check failed for ${sessionId}: ${err.message}`);
    }
  }
});

/**
 * Destroys all active WhatsApp sessions cleanly (releasing Puppeteer processes)
 */
async function destroyAllSessions() {
  logger.info(`Destroying all ${sessions.size} active WhatsApp session(s)...`);
  for (const [sessionId, client] of sessions.entries()) {
    try {
      await client.destroy();
      logger.info(`Session ${sessionId} destroyed cleanly`);
    } catch (err) {
      logger.error(`Failed to destroy session ${sessionId} cleanly: ${err.message}`);
    }
  }
  sessions.clear();
}

module.exports = {
  setSocketIo,
  initSession,
  initSessionWithPairingCode,
  getSessionStatus,
  getAllSessionsStatus,
  sendMessage,
  destroySession,
  restartAllActiveSessions,
  deleteSessionFolder,
  destroyAllSessions
};
