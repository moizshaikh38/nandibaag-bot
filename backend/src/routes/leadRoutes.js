const express = require('express');
const { verifyToken } = require('../middleware/auth');
const { Lead } = require('../models');

const router = express.Router();

/**
 * GET /api/leads
 * List leads with status filter
 */
router.get('/', verifyToken, async (req, res, next) => {
  try {
    const { status } = req.query;
    
    const query = {};
    if (status && ['cold', 'warm', 'hot', 'converted', 'lost'].includes(status)) {
      query.status = status;
    }
    
    const leads = await Lead.find(query)
      .sort({ score: -1, lastActivityAt: -1 })
      .populate('chatId', 'customerPhone customerName');
    
    res.json({
      success: true,
      leads
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/leads/stats
 * Get lead counts by status for dashboard
 */
router.get('/stats', verifyToken, async (req, res, next) => {
  try {
    const stats = await Lead.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);
    
    const result = {
      cold: 0,
      warm: 0,
      hot: 0,
      converted: 0,
      lost: 0,
      total: 0
    };
    
    stats.forEach(stat => {
      result[stat._id] = stat.count;
      result.total += stat.count;
    });
    
    res.json({
      success: true,
      stats: result
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
