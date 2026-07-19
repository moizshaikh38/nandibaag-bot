const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { jwtSecret } = require('../config/env');
const { User } = require('../models');
const logger = require('../config/logger');

let io = null;

/**
 * Initializes Socket.io on the HTTP server
 * 
 * - Handles auth via JWT passed in socket handshake
 * - Joins authenticated staff users to 'dashboard' room
 * - Exports getIO() helper for services to emit events
 * 
 * @param {object} httpServer - HTTP server instance
 */
function initializeSocket(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: process.env.FRONTEND_URL || '*',
      methods: ['GET', 'POST']
    }
  });

  // Authentication middleware for Socket.io
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      
      if (!token) {
        return next(new Error('Authentication token required'));
      }
      
      const decoded = jwt.verify(token, jwtSecret);
      const user = await User.findById(decoded.id);
      
      if (!user || !user.isActive) {
        return next(new Error('Invalid user'));
      }
      
      socket.user = user;
      next();
    } catch (error) {
      logger.error(`Socket authentication error: ${error.message}`);
      next(new Error('Authentication failed'));
    }
  });

  io.on('connection', (socket) => {
    logger.info(`Staff user connected: ${socket.user.email} (socket: ${socket.id})`);
    
    // Join dashboard room for real-time updates
    socket.join('dashboard');
    
    // Handle disconnection
    socket.on('disconnect', () => {
      logger.info(`Staff user disconnected: ${socket.user.email} (socket: ${socket.id})`);
    });
  });

  logger.info('Socket.io initialized');
}

/**
 * Gets the Socket.io instance
 * Used by services to emit events without circular imports
 * 
 * @returns {object} Socket.io instance
 */
function getIO() {
  if (!io) {
    throw new Error('Socket.io not initialized');
  }
  return io;
}

module.exports = {
  initializeSocket,
  getIO
};
