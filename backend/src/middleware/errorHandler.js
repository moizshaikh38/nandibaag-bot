const logger = require('../config/logger');
const { nodeEnv } = require('../config/env');

/**
 * Global Express error handler
 * Logs error via winston and returns consistent JSON error shape
 * Never leaks stack traces in production
 */
function errorHandler(err, req, res, next) {
  // Log the error
  logger.error(`Error: ${err.message}`, {
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip
  });
  
  // Determine status code
  const statusCode = err.statusCode || 500;
  
  // Build error response
  const errorResponse = {
    success: false,
    message: err.message || 'Internal server error'
  };
  
  // Include stack trace only in development
  if (nodeEnv === 'development') {
    errorResponse.stack = err.stack;
  }
  
  res.status(statusCode).json(errorResponse);
}

module.exports = errorHandler;
