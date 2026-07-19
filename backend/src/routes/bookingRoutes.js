const express = require('express');
const { verifyToken } = require('../middleware/auth');
const { Booking } = require('../models');

const router = express.Router();

/**
 * GET /api/bookings
 * List bookings with status filter
 */
router.get('/', verifyToken, async (req, res, next) => {
  try {
    const { status } = req.query;
    
    const query = {};
    if (status && ['draft', 'pending_payment', 'confirmed', 'cancelled'].includes(status)) {
      query.status = status;
    }
    
    const bookings = await Booking.find(query)
      .sort({ createdAt: -1 })
      .populate('chatId', 'customerPhone customerName');
    
    res.json({
      success: true,
      bookings
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/bookings/:id/status
 * Update booking status manually
 */
router.patch('/:id/status', verifyToken, async (req, res, next) => {
  try {
    const { status } = req.body;
    
    if (!status || !['draft', 'pending_payment', 'confirmed', 'cancelled'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status'
      });
    }
    
    const booking = await Booking.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );
    
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }
    
    res.json({
      success: true,
      booking
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
