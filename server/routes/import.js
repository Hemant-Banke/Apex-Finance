const express = require('express');
const multer  = require('multer');
const router  = express.Router();
const { protect }        = require('../middleware/auth');
const { asyncHandler }   = require('../middleware/asyncHandler');
const { HttpError, badRequest } = require('../utils/httpError');
const { parseStatement } = require('../lib/statementParsers');
const llmService         = require('../lib/llmService');
const categoryProfile    = require('../services/categoryProfileService');
const { getUserCategoryTaxonomy } = require('../services/categoryService');
const { resolveStatementAssets }  = require('../services/symbolResolver');
const { MISC_CATEGORY, normalizeCategory }  = require('../lib/categoryRules');

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
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',  // .xlsx
      'application/vnd.ms-excel',                                           // .xls
      'application/vnd.oasis.opendocument.spreadsheet',                     // .ods
      'image/png',
      'image/jpeg',
      'image/jpg',
      'image/webp',
    ];
    if (allowed.includes(file.mimetype) ||
        /\.(pdf|html?|csv|tsv|txt|xlsx?|ods|png|jpe?g|webp)$/i.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file type. Please upload a PDF, spreadsheet, CSV, HTML, or image file.'));
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

  // Layer 4 — Other → Miscellaneous fallback (works with or without an API key), and
  // push anything that merely landed on the bare "Other" group down to Miscellaneous.
  for (const t of cashRows) {
    t.suggestedCategory = t.suggestedCategory
      ? normalizeCategory(t.suggestedCategory, t.type)
      : MISC_CATEGORY[t.type];
  }
}

// POST /api/import/parse
// Body: multipart — file + optional password field
router.post('/parse', protect, upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) throw badRequest('No file uploaded');

  let result;
  try {
    result = await parseStatement({
      buffer:       req.file.buffer,
      mimetype:     req.file.mimetype,
      originalname: req.file.originalname,
      password:     req.body.password || null,
    });
  } catch (err) {
    // A locked PDF is not a failure — it is the client's cue to ask for the password
    // and retry, so the flags ride along on the response.
    if (err.needsPassword) {
      throw new HttpError(422, err.wrongPassword
        ? 'Incorrect password. Please try again.'
        : 'This PDF is password-protected. Enter the password to unlock it.',
        { needsPassword: true, wrongPassword: !!err.wrongPassword });
    }
    throw badRequest(err.message || 'Failed to parse statement');
  }

  // Turn each asset row's name/ticker into a real market symbol before review, so the
  // user confirms something that will actually price. Best-effort: an unresolved row is
  // flagged for review rather than sinking the import.
  try {
    await resolveStatementAssets(result.transactions);
  } catch (e) {
    console.error('Symbol resolution failed:', e.message);
  }

  await applySmartCategories(req.user._id, result);

  res.json(result);
}));

module.exports = router;
