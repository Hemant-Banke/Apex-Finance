const mongoose = require('mongoose');

// A user's own AI provider, used by the assistant. The key is sealed (utils/secretBox) and never leaves the server.
const aiConnectionSchema = new mongoose.Schema({
  user:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  provider: { type: String, required: true },          // a key of lib/aiProviders PROVIDERS
  label:    { type: String, trim: true, maxlength: 40 },
  baseUrl:  { type: String, trim: true },              // custom OpenAI-compatible endpoints only
  model:    { type: String, required: true, trim: true, maxlength: 120 },
  modelName: { type: String, trim: true, maxlength: 120 },   // the provider's display name, for the picker
  key:      { iv: String, tag: String, data: String },
  keyHint:  { type: String },
  isDefault: { type: Boolean, default: false },
  lastError: { type: String, default: null },
  lastUsedAt: { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.model('AiConnection', aiConnectionSchema);
