const mongoose = require('mongoose');

// An app registered to use the Apex connector (Claude, ChatGPT…), via OAuth dynamic client registration.
const mcpClientSchema = new mongoose.Schema({
  clientId: { type: String, required: true, unique: true },
  info:     { type: mongoose.Schema.Types.Mixed, required: true },   // the registration as the SDK returns it
}, { timestamps: true, minimize: false });

module.exports = mongoose.model('McpClient', mcpClientSchema);
