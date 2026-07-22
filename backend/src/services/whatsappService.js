const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
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
 * Multi-session WhatsApp service architecture (Baileys):
 * 
 * This service manages multiple simultaneous WhatsApp sessions, one per resort number.
 * Each session is identified by a sessionId (label/number from Settings.whatsappNumbers).
 * 
 * Key design decisions:
 * - Map<sessionId, WASocket> stores active sockets in memory
 * - useMultiFileAuthState persists auth data per session in sessions/{sessionId}/
 * - Auto-reconnect with exponential backoff (5s, 15s, 30s, 60s cap) up to 5 attempts
 * - Per-chat message queue prevents race conditions on Chat document updates
 * - Socket.io events keep dashboard in sync with session status
 * - NO Chromium/Puppeteer dependency — connects directly over WebSocket (~50MB RAM)
 */

// Active sockets Map: sessionId -> WASocket instance
const activeSockets = new Map();

// Reconnect attempt counters: sessionId -> attempt count
const reconnectAttempts = new Map();

// Per-chat message queue locks: chatPhone -> Promise
const messageQueueLocks = new Map();

// Track connection state: sessionId -> 'connected' | 'connecting' | 'disconnected'
const connectionStates = new Map();

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
 * Initializes a WhatsApp session for a given sessionId using Baileys.
 * 
 * IMPORTANT: This function is NON-BLOCKING. It creates the socket, registers
 * event listeners, and returns immediately. Socket events ('whatsapp:qr',
 * 'whatsapp:ready', 'whatsapp:init_failed') drive the UI.
 *
 * @param {string} sessionId - Session identifier (label/number from Settings)
 * @param {object} options
 * @param {boolean} options.cleanStart - If true, delete any existing session folder first
 * @returns {{ client: WASocket, initPromise: Promise }} The socket and a resolved promise for compat
 */
function initSession(sessionId, { cleanStart = false } = {}) {
  // If there's already a live connected socket, return it
  if (activeSockets.has(sessionId)) {
    const existingSock = activeSockets.get(sessionId);
    if (connectionStates.get(sessionId) === 'connected') {
      logger.warn(`Session ${sessionId} already connected, returning existing socket`);
      return { client: existingSock, initPromise: Promise.resolve() };
    }
    // Dead/stale socket — remove and re-init
    activeSockets.delete(sessionId);
  }

  if (cleanStart) {
    deleteSessionFolder(sessionId);
  }

  logger.info(`Initializing WhatsApp session (Baileys): ${sessionId}`);
  connectionStates.set(sessionId, 'connecting');

  // The actual async initialization is wrapped in a promise
  const initPromise = (async () => {
    try {
      const sessionPath = getSessionDataPath(sessionId);
      const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
      const { version } = await fetchLatestBaileysVersion();

      const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: ['Nandibaag Resort', 'Chrome', '1.0.0'],
        // Connection tuning for low-memory environments
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: undefined,
        markOnlineOnConnect: false,
      });

      // ─── EVENT: Credentials update (MUST wire or session won't persist) ───
      sock.ev.on('creds.update', saveCreds);

      // ─── EVENT: Connection update (QR, connected, disconnected) ───
      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        // QR code received — emit to frontend
        if (qr) {
          try {
            const qrDataUrl = await qrcode.toDataURL(qr);
            logger.info(`QR code generated for session ${sessionId}`);
            if (io) {
              io.emit('whatsapp:qr', { sessionId, qr: qrDataUrl });
            }
          } catch (error) {
            logger.error(`Failed to generate QR for session ${sessionId}: ${error.message}`);
          }
        }

        // Connection opened successfully
        if (connection === 'open') {
          logger.info(`WhatsApp session ${sessionId} is ready (Baileys)`);
          connectionStates.set(sessionId, 'connected');
          reconnectAttempts.set(sessionId, 0);

          // Auto-save session to settings in database
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
        }

        // Connection closed
        if (connection === 'close') {
          connectionStates.set(sessionId, 'disconnected');
          const statusCode = (lastDisconnect?.error)?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

          logger.warn(`Session ${sessionId} connection closed. Status: ${statusCode}. Reconnect: ${shouldReconnect}`);

          // Remove from active sockets
          activeSockets.delete(sessionId);

          if (shouldReconnect) {
            // Transient disconnect — auto-reconnect
            if (io) {
              io.emit('whatsapp:disconnected', { sessionId, reason: `Connection closed (code: ${statusCode})` });
            }
            await autoReconnect(sessionId);
          } else {
            // Permanently logged out — clean up
            logger.warn(`Session ${sessionId} logged out permanently. Deleting session data.`);
            reconnectAttempts.set(sessionId, 0);
            deleteSessionFolder(sessionId);

            if (io) {
              io.emit('whatsapp:disconnected', {
                sessionId,
                reason: `UNLINKED. WhatsApp number ${sessionId} was unlinked — please reconnect via QR/pairing code.`
              });
              io.emit('whatsapp:reconnect_failed', {
                sessionId,
                message: `WhatsApp number ${sessionId} was unlinked — please reconnect via QR/pairing code.`
              });
            }
          }
        }
      });

      // ─── EVENT: Incoming messages ───
      sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
          // Skip messages sent by us
          if (msg.key.fromMe) continue;
          // Skip status broadcasts
          if (msg.key.remoteJid === 'status@broadcast') continue;
          // Skip group messages
          if (msg.key.remoteJid?.endsWith('@g.us')) continue;

          try {
            const customerPhone = msg.key.remoteJid.replace('@s.whatsapp.net', '');

            // Get or create lock for this chat
            let lock = messageQueueLocks.get(customerPhone);
            if (!lock) {
              lock = Promise.resolve();
              messageQueueLocks.set(customerPhone, lock);
            }

            // Queue this message processing behind any previous one for this chat
            messageQueueLocks.set(customerPhone, lock.then(async () => {
              try {
                const messageHandler = require('./messageHandler');
                await messageHandler.handleIncomingMessage(sessionId, msg, io);
              } catch (error) {
                logger.error(`Error processing message from ${customerPhone}: ${error.message}`);
              } finally {
                messageQueueLocks.delete(customerPhone);
              }
            }));
          } catch (error) {
            logger.error(`Error queuing message: ${error.message}`);
          }
        }
      });

      // Store socket in active map
      activeSockets.set(sessionId, sock);
      reconnectAttempts.set(sessionId, 0);

      logger.info(`Baileys socket created for session ${sessionId}`);
    } catch (error) {
      logger.error(`initSession FAILED for session ${sessionId}: ${error.message}`);
      logger.error(`  Stack: ${error.stack}`);
      activeSockets.delete(sessionId);
      connectionStates.set(sessionId, 'disconnected');

      if (io) {
        io.emit('whatsapp:init_failed', {
          sessionId,
          message: error.message,
          hint: 'Try deleting the stale session and retrying.'
        });
      }
    }
  })();

  return { client: activeSockets.get(sessionId), initPromise };
}

/**
 * Auto-reconnect logic with exponential backoff
 * 
 * Attempts: 5s, 15s, 30s, 60s, 60s (capped)
 * After 5 failed attempts, emits 'whatsapp:reconnect_failed'
 */
async function autoReconnect(sessionId) {
  const maxAttempts = 5;
  const backoffDelays = [5000, 15000, 30000, 60000, 60000];

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
    await autoReconnect(sessionId);
  }
}

/**
 * Initializes a WhatsApp session using pairing code instead of QR
 * 
 * @param {string} sessionId - Session identifier
 * @param {string} phoneNumber - Phone number (with country code, no +)
 */
async function initSessionWithPairingCode(sessionId, phoneNumber) {
  logger.info(`Initializing WhatsApp session ${sessionId} with pairing code for ${phoneNumber}`);

  const { initPromise } = initSession(sessionId);
  await initPromise;

  const sock = activeSockets.get(sessionId);
  if (!sock) {
    throw new Error(`Socket not available for session ${sessionId}`);
  }

  try {
    // Wait briefly for socket to be ready for pairing
    await new Promise(resolve => setTimeout(resolve, 3000));
    const pairingCode = await sock.requestPairingCode(phoneNumber);
    logger.info(`Pairing code generated for session ${sessionId}: ${pairingCode}`);

    if (io) {
      io.emit('whatsapp:pairing_code', { sessionId, code: pairingCode });
    }
  } catch (error) {
    logger.error(`Failed to request pairing code for session ${sessionId}: ${error.message}`);
    throw error;
  }
}

/**
 * Gets the status of a specific session
 */
function getSessionStatus(sessionId) {
  if (!activeSockets.has(sessionId)) {
    return 'not_initialized';
  }
  return connectionStates.get(sessionId) || 'connecting';
}

/**
 * Gets the status of all configured WhatsApp sessions
 */
function getAllSessionsStatus(whatsappNumbers) {
  const statusMap = {};

  for (const numberConfig of whatsappNumbers) {
    const sessionId = numberConfig.label || numberConfig.number;
    statusMap[sessionId] = getSessionStatus(sessionId);
  }

  for (const sessionId of activeSockets.keys()) {
    if (!statusMap[sessionId]) {
      statusMap[sessionId] = getSessionStatus(sessionId);
    }
  }

  return statusMap;
}

/**
 * Sends a WhatsApp message through a specific session
 */
async function sendMessage(sessionId, toPhone, text) {
  const sock = activeSockets.get(sessionId);

  if (!sock) {
    throw new Error(`Session ${sessionId} not initialized`);
  }

  const status = getSessionStatus(sessionId);
  if (status !== 'connected') {
    throw new Error(`Session ${sessionId} is not connected (status: ${status})`);
  }

  // Format to JID — accept both full JIDs and plain phone numbers
  let jid = toPhone;
  if (!toPhone.includes('@')) {
    // Plain phone number — format to standard WhatsApp JID
    const digits = toPhone.replace(/\D/g, '');
    jid = `${digits}@s.whatsapp.net`;
  }

  logger.info(`Sending message via session ${sessionId} to ${jid}`);

  let lastError = null;

  // Try sending, retry once after 3 seconds on failure
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await sock.sendMessage(jid, { text });
      logger.info(`Message sent successfully via session ${sessionId}`);
      return;
    } catch (error) {
      lastError = error;
      logger.warn(`Send attempt ${attempt + 1} failed for session ${sessionId}: ${error.message}`);
      if (attempt === 0) {
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
  }

  throw new Error(`Failed to send message via session ${sessionId} after 2 attempts: ${lastError.message}`);
}

/**
 * Destroys a WhatsApp session gracefully.
 */
async function destroySession(sessionId, { deleteData = true } = {}) {
  const sock = activeSockets.get(sessionId);

  if (sock) {
    try {
      await sock.logout();
      logger.info(`Session ${sessionId} logged out`);
    } catch (error) {
      logger.error(`Error logging out session ${sessionId}: ${error.message}`);
      try {
        sock.end(undefined);
      } catch (_) {}
    }
  } else {
    logger.warn(`Session ${sessionId} not found in memory, skipping logout`);
  }

  // Auto-remove session from settings in database
  try {
    const { Settings } = require('../models');
    const settings = await Settings.findOne();
    if (settings) {
      const originalLength = settings.whatsappNumbers.length;
      settings.whatsappNumbers = settings.whatsappNumbers.filter(n => n.label !== sessionId && n.number !== sessionId);
      if (settings.whatsappNumbers.length !== originalLength) {
        await settings.save();
        logger.info(`Removed session ${sessionId} from Settings whatsappNumbers in database`);
      }
    }
  } catch (dbErr) {
    logger.error(`Failed to remove session ${sessionId} from database settings: ${dbErr.message}`);
  }

  activeSockets.delete(sessionId);
  connectionStates.delete(sessionId);
  reconnectAttempts.delete(sessionId);

  if (deleteData) {
    deleteSessionFolder(sessionId);
  }

  if (io) {
    io.emit('whatsapp:session_destroyed', { sessionId });
  }
}

/**
 * Restarts all active WhatsApp sessions on server boot.
 * Saved creds handle re-authentication without QR re-scanning.
 */
async function restartAllActiveSessions(whatsappNumbers) {
  logger.info('Restarting all active WhatsApp sessions (Baileys)...');

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

// Periodic health check cron (every 2 minutes)
cron.schedule('*/2 * * * *', async () => {
  logger.debug(`Running WhatsApp session health check for ${activeSockets.size} active session(s)...`);
  for (const [sessionId] of activeSockets.entries()) {
    const state = connectionStates.get(sessionId) || 'unknown';
    logger.info(`Session health check: Session ${sessionId} state is ${state}`);
  }
});

/**
 * Destroys all active WhatsApp sessions cleanly
 */
async function destroyAllSessions() {
  logger.info(`Destroying all ${activeSockets.size} active WhatsApp session(s)...`);
  for (const [sessionId, sock] of activeSockets.entries()) {
    try {
      sock.end(undefined);
      logger.info(`Session ${sessionId} ended cleanly`);
    } catch (err) {
      logger.error(`Failed to end session ${sessionId}: ${err.message}`);
    }
  }
  activeSockets.clear();
  connectionStates.clear();
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
  destroyAllSessions,
  activeSockets
};
