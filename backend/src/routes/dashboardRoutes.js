const express = require('express');
const { verifyToken } = require('../middleware/auth');
const { Chat, Lead, Booking, Settings } = require('../models');
const { getSessionStatus, getAllSessionsStatus } = require('../services/whatsappService');
const { getModelHealthLast1Hour } = require('../services/aiService');

const router = express.Router();

/**
 * GET /api/dashboard/stats
 * Dashboard summary statistics
 */
router.get('/stats', verifyToken, async (req, res, next) => {
  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    // Total chats today
    const chatsToday = await Chat.countDocuments({
      createdAt: { $gte: todayStart }
    });
    
    // Hot leads count
    const hotLeadsCount = await Lead.countDocuments({ status: 'hot' });
    
    // AI failure count last 24h (this would need to be tracked separately, using placeholder)
    const aiFailuresLast24h = 0; // TODO: Implement AI failure tracking
    
    // Active WhatsApp sessions count
    const settings = await Settings.findOne();
    const whatsappNumbers = settings?.whatsappNumbers || [];
    const sessionStatuses = getAllSessionsStatus(whatsappNumbers);
    const activeSessions = Object.values(sessionStatuses).filter(status => status === 'connected').length;
    
    // Bookings this week
    const bookingsThisWeek = await Booking.countDocuments({
      createdAt: { $gte: weekStart }
    });
    
    // Total chats (all time)
    const totalChats = await Chat.countDocuments({ isArchived: false });
    
    // Total bookings
    const totalBookings = await Booking.countDocuments();
    
    // Conversion rate
    const conversionRate = totalChats > 0 ? (totalBookings / totalChats * 100).toFixed(1) : 0;
    
    res.json({
      success: true,
      stats: {
        chatsToday,
        hotLeadsCount,
        aiFailuresLast24h,
        activeSessions,
        bookingsThisWeek,
        totalChats,
        totalBookings,
        conversionRate,
        modelHealthLast1Hour: getModelHealthLast1Hour()
      }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
