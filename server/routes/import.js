const express = require('express');
const multer  = require('multer');
const router  = express.Router();
const { protect }        = require('../middleware/auth');
const { parseStatement } = require('../lib/statementParsers');
const llmService         = require('../lib/llmService');
const { getUserCategoryTaxonomy } = require('../services/categoryService');

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
 * Predict categories for parsed transactions using the user's taxonomy (LLM).
 * Best-effort: on any failure the existing keyword-based `suggestedCategory`
 * from the parser is left untouched.
 */
async function applySmartCategories(userId, result) {
  if (!llmService.isLLMAvailable() || !result.transactions?.length) return;

  // Only income/expense rows carry a category — skip transfers and asset trades.
  const items = result.transactions
    .filter(t => t.type === 'income' || t.type === 'expense')
    .map(t => ({ id: t.id, type: t.type, narration: t.narration, amount: t.amount, date: t.date }));
  if (!items.length) return;

  try {
    const taxonomy = await getUserCategoryTaxonomy(userId);
    const suggestions = await llmService.categorizeTransactions(items, taxonomy);
    result.transactions = result.transactions.map(t => ({
      ...t,
      suggestedCategory: suggestions[t.id] ?? t.suggestedCategory ?? null,
    }));
  } catch (err) {
    console.error('LLM categorization failed, keeping keyword suggestions:', err.message);
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
