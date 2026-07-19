const mongoose = require('mongoose');

const kidSchema = new mongoose.Schema({
  age: Number,
  rate: Number
}, { _id: false });

const bookingSchema = new mongoose.Schema({
  chatId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Chat'
  },
  customerName: {
    type: String,
    required: true
  },
  customerPhone: {
    type: String,
    required: true
  },
  bookingType: {
    type: String,
    enum: ['couple', 'group', 'picnic'],
    required: true
  },
  date: {
    type: String,
    required: true
  },
  isWeekend: {
    type: Boolean
  },
  adults: {
    type: Number
  },
  kids: [kidSchema],
  totalAmount: {
    type: Number,
    required: true
  },
  priceBreakdown: {
    type: String
  },
  specialRequests: {
    type: String
  },
  status: {
    type: String,
    enum: ['draft', 'pending_payment', 'confirmed', 'cancelled'],
    default: 'draft',
    index: true
  },
  createdBy: {
    type: String,
    enum: ['ai', 'staff'],
    default: 'ai'
  }
}, {
  timestamps: true
});

bookingSchema.index({ customerPhone: 1 });
bookingSchema.index({ date: 1 });
bookingSchema.index({ status: 1 });
bookingSchema.index({ bookingType: 1 });
bookingSchema.index({ chatId: 1 });

module.exports = mongoose.model('Booking', bookingSchema);
