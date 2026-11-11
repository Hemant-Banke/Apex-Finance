const crypto = require('crypto');

// AES-256-GCM for secrets at rest (users' AI API keys). Set AI_KEYS_SECRET in production:
// without it the key derives from JWT_SECRET, and rotating that would make stored keys unreadable.
function key() {
  const base = process.env.AI_KEYS_SECRET || `${process.env.JWT_SECRET}:ai-keys`;
  if (!base || base.startsWith('undefined')) throw new Error('No secret configured for key encryption');
  return crypto.createHash('sha256').update(base).digest();
}

function seal(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}

function open(box) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(box.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(box.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(box.data, 'base64')), decipher.final()]).toString('utf8');
}

// What the UI may show of a key: never more than its last four characters.
const hint = (plain) => `…${String(plain).slice(-4)}`;

module.exports = { seal, open, hint };
