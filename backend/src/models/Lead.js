const mongoose = require('mongoose');

const scoreFactorSchema = new mongoose.Schema({
  factor: String,
  points: Number,
  addedAt: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

const leadSchema = new mongoose.Schema({
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
  score: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  scoreFactors: [scoreFactorSchema],
  status: {
    type: String,
    enum: ['cold', 'warm', 'hot', 'converted', 'lost'],
    default: 'cold',
    index: true
  },
  convertedAt: {
    type: Date,
    default: null
  },
  lastActivityAt: {
    type: Date,
    index: true
  }
}, {
  timestamps: true
});

leadSchema.index({ chatId: 1 });
leadSchema.index({ customerPhone: 1 });
leadSchema.index({ status: 1 });
leadSchema.index({ score: -1 });
leadSchema.index({ lastActivityAt: -1 });

module.exports = mongoose.model('Lead', leadSchema);
