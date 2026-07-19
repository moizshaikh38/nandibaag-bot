const mongoose = require('mongoose');

const followUpSchema = new mongoose.Schema({
  chatId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Chat',
    required: true,
    index: true
  },
  customerPhone: {
    type: String,
    required: true
  },
  stage: {
    type: String,
    enum: ['3hr', '1day', '3day', '7day'],
    required: true
  },
  scheduledFor: {
    type: Date,
    required: true,
    index: true
  },
  status: {
    type: String,
    enum: ['pending', 'sent', 'cancelled'],
    default: 'pending',
    index: true
  },
  cancelReason: {
    type: String,
    default: null
  },
  sentAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

followUpSchema.index({ chatId: 1 });
followUpSchema.index({ customerPhone: 1 });
followUpSchema.index({ scheduledFor: 1 });
followUpSchema.index({ status: 1 });
followUpSchema.index({ stage: 1 });

module.exports = mongoose.model('FollowUp', followUpSchema);
