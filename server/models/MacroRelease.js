const mongoose = require('mongoose');

// A publication already read into MacroPoint (an RBI press release id), so a refresh fetches only new ones.
const macroReleaseSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  title: String,
  points: Number,
  v: Number,   // the parser version that read it
}, { timestamps: true });

module.exports = mongoose.model('MacroRelease', macroReleaseSchema);
