const express = require('express');
const multer  = require('multer');
const router  = express.Router();
const { protect }        = require('../middleware/auth');
const { parseStatement } = require('../lib/statementParsers');

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'application/pdf',
      'text/html',
      'image/png',
      'image/jpeg',
      'image/jpg',
      'image/webp',
    ];
    if (allowed.includes(file.mimetype) ||
        /\.(pdf|html?|png|jpe?g|webp)$/i.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file type. Please upload a PDF, HTML, or image file.'));
    }
  },
});

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
    res.json(result);
  } catch (err) {
    if (err.needsPassword) {
      return res.status(422).json({ message: 'PDF_PASSWORD_REQUIRED', needsPassword: true });
    }
    console.error('Import parse error:', err.message);
    res.status(400).json({ message: err.message || 'Failed to parse statement' });
  }
});

module.exports = router;
