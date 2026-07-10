const express = require('express');
const multer  = require('multer');
const router  = express.Router();
const { protect }        = require('../middleware/auth');
const { parseStatement } = require('../lib/statementParsers');
const llmService         = require('../lib/llmService');
const categoryProfile    = require('../services/categoryProfileService');
const { getUserCategoryTaxonomy } = require('../services/categoryService');
const { MISC_CATEGORY }  = require('../lib/categoryRules');

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dayName = d => { const x = new Date(d); return isNaN(x) ? '' : DOW[x.getUTCDay()]; };

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'application/pdf',
      'text/html',
      'text/csv',
      'text/plain',
      'image/png',
      'image/jpeg',
      'image/jpg',
      'image/webp',
    ];
    if (allowed.includes(file.mimetype) ||
        /\.(pdf|html?|csv|tsv|txt|png|jpe?g|webp)$/i.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file type. Please upload a PDF, CSV, HTML, or image file.'));
    }
  },
});

/**
 * Fill each income/expense transaction's `suggestedCategory` in layers, cheapest
 * first, so the LLM is only called for what earlier layers couldn't classify:
 *   1. regex keyword rules  (already applied in buildTx)
 *   2. the user's learned category profile (decisive, no model call)
 *   3. the LLM (only for whatever remains, with the profile as context)
 *   4. Other → Miscellaneous fallback for anything still unclassified
 * Every step is best-effort; a failure just leaves earlier suggestions in place.
 */
async function applySmartCategories(userId, result) {
  const cashRows = (result.transactions || []).filter(t => t.type === 'income' || t.type === 'expense');
  if (!cashRows.length) return;

  const taxonomy   = await getUserCategoryTaxonomy(userId);
  const validByType = {
    expense: new Set(taxonomy.expense.map(o => o.code)),
    income:  new Set(taxonomy.income.map(o => o.code)),
  };

  // Layer 1 (regex) already ran in buildTx → suggestedCategory. Collect the rest.
  let pending = cashRows.filter(t => !t.suggestedCategory);

  // Layer 2 — learned profile (decisive merchant→category).
  if (pending.length) {
    try {
      const preds = await categoryProfile.predictFromProfile(
        userId,
        pending.map(t => ({ id: t.id, type: t.type, narration: t.narration, amount: t.amount, date: t.date })),
        validByType,
      );
      for (const t of pending) if (preds[t.id]) t.suggestedCategory = preds[t.id];
      pending = pending.filter(t => !t.suggestedCategory);
    } catch (err) { console.error('Profile categorization failed:', err.message); }
  }

  // Layer 3 — LLM for whatever remains, primed with the user's profile.
  if (pending.length && llmService.isLLMAvailable()) {
    try {
      const summary = await categoryProfile.getProfileSummary(userId, taxonomy);
      const items = pending.map(t => ({ id: t.id, type: t.type, narration: t.narration, amount: t.amount, day: dayName(t.date) }));
      const preds = await llmService.categorizeTransactions(items, taxonomy, summary);
      for (const t of pending) {
        const code = preds[t.id];
        if (code && validByType[t.type].has(code)) t.suggestedCategory = code;
      }
    } catch (err) { console.error('LLM categorization failed:', err.message); }
  }

  // Layer 4 — Other → Miscellaneous fallback (works with or without an API key).
  for (const t of cashRows) {
    if (!t.suggestedCategory) t.suggestedCategory = MISC_CATEGORY[t.type];
  }
}

// POST /api/import/parse
// Body: multipart — file + optional password field
router.post('/parse', protect, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

  try {
    const result = await parseStatement({
      buffer:       req.file.buffer,
      mimetype:     req.file.mimetype,
      originalname: req.file.originalname,
      password:     req.body.password || null,
    });

    await applySmartCategories(req.user._id, result);

    res.json(result);
  } catch (err) {
    if (err.needsPassword) {
      return res.status(422).json({
        message: err.wrongPassword
          ? 'Incorrect password. Please try again.'
          : 'This PDF is password-protected. Enter the password to unlock it.',
        needsPassword: true,
        wrongPassword: !!err.wrongPassword,
      });
    }
    console.error('Import parse error:', err.message);
    res.status(400).json({ message: err.message || 'Failed to parse statement' });
  }
});

module.exports = router;
