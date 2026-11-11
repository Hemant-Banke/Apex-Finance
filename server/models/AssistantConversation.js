const mongoose = require('mongoose');

/**
 * One assistant conversation. `messages` is what the user sees; `native` is the provider's
 * own transcript (tool calls, thinking blocks), replayed unchanged while the same model is
 * used, since editing it would invalidate the model's thinking. A model switch rebuilds it from `messages`.
 */
const messageSchema = new mongoose.Schema({
  role:  { type: String, enum: ['user', 'assistant'], required: true },
  text:  { type: String, default: '' },
  tools: [{ _id: false, name: String, label: String, ok: Boolean }],
  error: { type: String, default: null },
  at:    { type: Date, default: Date.now },
}, { _id: false });

const conversationSchema = new mongoose.Schema({
  user:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title:    { type: String, trim: true, maxlength: 80, default: 'New conversation' },
  messages: { type: [messageSchema], default: [] },
  native:   {
    kind:  String,     // 'anthropic' | 'openai'
    model: String,
    messages: { type: mongoose.Schema.Types.Mixed, default: [] },
  },
  usage:    { input: { type: Number, default: 0 }, output: { type: Number, default: 0 } },
}, { timestamps: true, minimize: false });   // a tool call with no arguments must keep its `{}`

conversationSchema.index({ user: 1, updatedAt: -1 });

module.exports = mongoose.model('AssistantConversation', conversationSchema);
