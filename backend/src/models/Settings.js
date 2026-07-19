const mongoose = require('mongoose');

const whatsappNumberSchema = new mongoose.Schema({
  number: String,
  label: String,
  isActive: {
    type: Boolean,
    default: true
  },
  isPrimary: {
    type: Boolean,
    default: false
  }
}, { _id: false });

const settingsSchema = new mongoose.Schema({
  globalMode: {
    type: String,
    enum: ['ai', 'human'],
    default: 'ai' // Represents the default mode for brand-new chats going forward. Toggling this via PATCH /global-mode triggers a bulk action that overrides all existing chats' modes. It is NOT checked live per-message.
  },
  whatsappNumbers: [whatsappNumberSchema],
  openRouterModelOverride: {
    type: String,
    default: null
  },
  followUpEnabled: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

settingsSchema.index({ globalMode: 1 });

module.exports = mongoose.model('Settings', settingsSchema);
