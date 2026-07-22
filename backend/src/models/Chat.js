// IMPORTANT: Chats are NEVER hard-deleted. Use the isArchived flag for soft deletion.
// This preserves conversation history and lead data even if a customer asks to stop.
// Hard deletion would break data integrity and lose valuable customer insights.

const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  sender: {
    type: String,
    enum: ['customer', 'bot', 'staff'],
    required: true
  },
  text: {
    type: String,
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  messageType: {
    type: String,
    enum: ['text', 'image', 'document'],
    default: 'text'
  },
  deliveryStatus: {
    type: String,
    enum: ['sending', 'sent', 'failed'],
    default: 'sent'
  }
}, { _id: false });

const bookingDraftSchema = new mongoose.Schema({
  bookingType: {
    type: String,
    enum: ['couple', 'group', 'picnic', null]
  },
  date: String,
  nights: Number,
  adults: Number,
  kids: [{
    age: Number
  }],
  isMarried: Boolean,
  calculatedPrice: Number,
  priceBreakdown: String,
  specialRequests: String
}, { _id: false });

const chatSchema = new mongoose.Schema({
  customerPhone: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  customerName: {
    type: String,
    default: null
  },
  whatsappNumberUsed: {
    type: String
  },
  mode: {
    type: String,
    enum: ['ai', 'human'],
    default: 'ai'
  },
  language: {
    type: String,
    enum: ['hindi', 'marathi', 'english', 'hinglish', 'gujarati', 'unknown'],
    default: 'unknown'
  },
  messages: [messageSchema],
  lastMessageAt: {
    type: Date,
    index: true
  },
  bookingStage: {
    type: String,
    enum: ['none', 'type_selected', 'date_given', 'guests_given', 'kids_given', 'married_checked', 'price_quoted', 'name_given', 'phone_given', 'special_requests', 'handed_over', 'completed'],
    default: 'none'
  },
  bookingDraft: {
    type: bookingDraftSchema,
    default: {}
  },
  isNewConversation: {
    type: Boolean,
    default: true
  },
  conversationResetAt: {
    type: Date,
    default: null
  },
  isArchived: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

chatSchema.index({ customerPhone: 1 });
chatSchema.index({ lastMessageAt: -1 });
chatSchema.index({ mode: 1 });
chatSchema.index({ bookingStage: 1 });
chatSchema.index({ isArchived: 1 });
chatSchema.index({ language: 1 });

module.exports = mongoose.model('Chat', chatSchema);
