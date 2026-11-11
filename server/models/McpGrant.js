const mongoose = require('mongoose');

/**
 * One app's access to one user's data through the connector. It starts as a pending
 * authorization request, becomes a one-time code once the user approves, then holds the
 * tokens. Only SHA-256 hashes of codes and tokens are stored.
 */
const mcpGrantSchema = new mongoose.Schema({
  requestId:  { type: String, index: true, sparse: true },   // the consent page's handle while pending
  user:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  clientId:   { type: String, required: true },
  clientName: { type: String },
  redirectUri:   { type: String, required: true },
  state:         { type: String },
  scopes:        { type: [String], default: [] },
  resource:      { type: String },
  codeChallenge: { type: String, required: true },
  status:     { type: String, enum: ['pending', 'approved', 'active', 'revoked'], default: 'pending' },
  codeHash:   { type: String, index: true, sparse: true },
  codeExpires: Date,
  accessHash: { type: String, index: true, sparse: true },
  accessExpires: Date,
  refreshHash: { type: String, index: true, sparse: true },
  refreshExpires: Date,
  lastUsedAt: Date,
  expiresAt:  { type: Date },   // pending requests and unused codes clean themselves up
}, { timestamps: true });

mcpGrantSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('McpGrant', mcpGrantSchema);
