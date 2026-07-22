const express = require('express');
const { verifyToken, requireAdmin } = require('../middleware/auth');
const { initSession, initSessionWithPairingCode, getSessionStatus, getAllSessionsStatus, destroySession, deleteSessionFolder } = require('../services/whatsappService');
const { Settings } = require('../models');
const logger = require('../config/logger');

const router = express.Router();

/**
 * GET /api/whatsapp/sessions
 * Returns status of all WhatsApp sessions
 */
router.get('/sessions', verifyToken, async (req, res, next) => {
  try {
    const settings = await Settings.findOne();
    const whatsappNumbers = settings?.whatsappNumbers || [];
    
    const statusMap = getAllSessionsStatus(whatsappNumbers);
    
    res.json({
      success: true,
      sessions: statusMap
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/whatsapp/sessions
 * Add a new WhatsApp session (admin only).
 * 
 * This endpoint is NON-BLOCKING: it starts initialization in the background
 * and immediately returns 200. The frontend should listen for socket events
 * ('whatsapp:qr', 'whatsapp:ready', 'whatsapp:init_failed') to drive the UI.
 */
router.post('/sessions', verifyToken, requireAdmin, async (req, res, next) => {
  try {
    const { sessionId, cleanStart } = req.body;
    
    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: 'sessionId is required'
      });
    }

    // Start initialization (non-blocking — returns immediately)
    initSession(sessionId, { cleanStart: !!cleanStart });
    
    res.json({
      success: true,
      message: 'Session initialization started. Listen for socket events.',
      sessionId
    });
  } catch (error) {
    logger.error(`Failed to start session ${req.body.sessionId}: ${error.message}`);
    next(error);
  }
});

/**
 * POST /api/whatsapp/sessions/:id/pairing-code
 * Initialize session with pairing code instead of QR
 */
router.post('/:id/pairing-code', verifyToken, async (req, res, next) => {
  try {
    const { id: sessionId } = req.params;
    const { phoneNumber } = req.body;
    
    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'phoneNumber is required'
      });
    }
    
    await initSessionWithPairingCode(sessionId, phoneNumber);
    
    res.json({
      success: true,
      message: 'Pairing code requested'
    });
  } catch (error) {
    next(error);
  }
});

const deleteSessionHandler = async (req, res, next) => {
  try {
    const sessionId = req.params.id;
    logger.info(`[AUDIT] DELETE_WHATSAPP_NUMBER: User "${req.user?.email || 'admin'}" deleting WhatsApp session/number "${sessionId}"`);
    
    await destroySession(sessionId, { deleteData: true });
    
    res.json({
      success: true,
      message: 'Number deleted — you can add it again with the same label',
      sessionId
    });
  } catch (error) {
    logger.error(`Error deleting WhatsApp session ${req.params.id}: ${error.message}`);
    // Even if error happens, ensure folder and DB state are cleaned up
    try {
      deleteSessionFolder(req.params.id);
    } catch (_) {}
    res.json({
      success: true,
      message: 'Number deleted — you can add it again with the same label',
      sessionId: req.params.id
    });
  }
};

router.delete('/:id', verifyToken, deleteSessionHandler);
router.delete('/sessions/:id', verifyToken, deleteSessionHandler);

module.exports = router;
