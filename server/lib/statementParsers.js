const { autoCategory } = require('./categoryRules');
const llmService = require('./llmService');

// ─── Shared helpers ────────────────────────────────────────────────────────

function parseAmount(str) {
  if (!str) return 0;
  return parseFloat(String(str).replace(/,/g, '')) || 0;
}

// DD/MM/YY or DD/MM/YYYY → YYYY-MM-DD
function parseDate(str) {
  const parts = str.split('/');
  if (parts.length !== 3) return null;
  const [d, m, y] = parts;
  const year = y.length === 2 ? `20${y}` : y;
  return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

let _txCounter = 0;
function uid() { return `import_${Date.now()}_${++_txCounter}`; }

// Produce a short, human-readable description from raw bank narration
function cleanNarration(raw) {
  if (!raw) return '';
  
  let s = raw
    // 1. Payment rail identifiers + trailing separators
    .replace(/\b(UPI(INT)?|IMPS|NEFT|RTGS|NWD|FT|NACH|ECS|AUTOPAY|MANDATE|ACH|INB|MMT|CMS)\b[-–_/]*/gi, ' ')
    // 2. Any IFSC code (4 letters + 0 + 6 alphanumeric is the RBI format)
    .replace(/\b[A-Z]{4}0[A-Z0-9]{6}\b/gi, ' ')
    // 3. UPI handles (vpa@bank)
    .replace(/\b[A-Za-z0-9._-]{3,}@[A-Za-z0-9.-]+\b/g, ' ')
    // 4. Long numeric IDs (UTR, transaction refs, phone numbers)
    .replace(/\b\d{10,}\b/g, ' ')
    // 5. Date-like patterns (DDMMYYYY, DD/MM/YY, YYYYMMDD)
    .replace(/\b\d{2}[-/]?\d{2}[-/]?\d{2,4}\b/g, ' ')
    // 6. Common junk fragments
    .replace(/\b(REF|TXN|TRF|PYT|PMT|RCV|DR|CR|BIL|PAY|TO|FROM|VIA|BY)\b\s*[:#-]?/gi, ' ')
    // 7. Standalone short alphanumeric tokens that look like codes (5+ chars mixed letters+digits)
    .replace(/\b(?=\w*\d)(?=\w*[A-Za-z])\w{5,}\b/g, ' ')
    // 8. Collapse separators and whitespace
    .replace(/[-–_/]{2,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  s = s.split(' ').filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');

  // Word-boundary-aware truncation
  if (s.length > 100) {
    s = s.slice(0, 100).replace(/\s\S*$/, '').trim();
  }

  return s;
}

function buildTx({ date, narration, amount, type, source, assetSymbol, assetName, assetType, units, pricePerUnit }) {
  const isAsset = type === 'buy' || type === 'sell';
  const u = units       != null ? Number(units)       : undefined;
  const p = pricePerUnit != null ? Number(pricePerUnit) : undefined;

  const tx = {
    id: uid(),
    date,
    narration,
    description: cleanNarration(narration),
    // Asset amount is derived from units × price (0 when price is unknown yet).
    amount: isAsset ? ((u && p) ? u * p : 0) : amount,
    type,
    suggestedCategory: isAsset ? null : autoCategory(narration, type),
    notes: '',
    source,
  };

  if (isAsset) {
    tx.assetSymbol  = (assetSymbol || assetName || '').toUpperCase();
    tx.assetName    = assetName || assetSymbol || '';
    tx.assetType    = assetType || 'stock';
    tx.units        = u;
    tx.pricePerUnit = p;
  }
  return tx;
}

const isAssetTx = tx => tx.type === 'buy' || tx.type === 'sell';

/** Keep valid rows: asset rows need units; cash rows need a positive amount. */
function keepTx(tx) {
  if (!tx.date) return false;
  return isAssetTx(tx) ? (tx.units > 0) : (tx.amount > 0.01);
}

/** Turn an LLM extraction result into the standard import payload (aiParsed=true). */
function finalizeAiResult(parsed, source) {
  const transactions = (parsed.transactions || [])
    .map(tx => buildTx({
      date:         tx.date,
      narration:    tx.narration || '',
      amount:       parseFloat(tx.amount) || 0,
      type:         tx.type || 'expense',
      source,
      assetSymbol:  tx.assetSymbol,
      assetName:    tx.assetName,
      assetType:    tx.assetType,
      units:        tx.units,
      pricePerUnit: tx.pricePerUnit,
    }))
    .filter(keepTx);

  return {
    transactions,
    bankName:    parsed.bankName,
    accountName: parsed.accountName,
    period:      parsed.period,
    source,
    aiParsed:    true,
  };
}

// ─── PDF Parser ────────────────────────────────────────────────────────────

async function parsePDF(buffer, password) {
  // pdf-parse v2: the constructor takes a single LoadParameters object with the
  // PDF bytes in `data` and (optionally) the decryption `password`. Passing the
  // Uint8Array positionally silently drops both the data and the password.
  const { PDFParse, PasswordException } = require('pdf-parse');
  let parser, result;
  try {
    const uint8 = new Uint8Array(buffer);
    parser = new PDFParse({ data: uint8, password: password || undefined });
    result = await parser.getText();
  } catch (err) {
    // pdfjs PasswordException.code: 1 = NEED_PASSWORD, 2 = INCORRECT_PASSWORD.
    const isPwd = err instanceof PasswordException
      || err?.name === 'PasswordException'
      || /password|encrypted/i.test(err?.message || '');
    if (isPwd) {
      const wrong = err?.code === 2 || /incorrect/i.test(err?.message || '');
      const e = new Error(wrong ? 'PDF_INCORRECT_PASSWORD' : 'PDF_PASSWORD_REQUIRED');
      e.needsPassword = true;
      e.wrongPassword = wrong;
      throw e;
    }
    throw err;
  } finally {
    if (parser) { try { await parser.destroy(); } catch { /* ignore */ } }
  }

  const text = (result.pages || []).map(p => p.text).join('\n');
  return buildResultFromText(text, 'pdf');
}

/**
 * Turn arbitrary statement text into a parsed result.
 * Prefers the LLM parser (any format/structure) when an API key is configured,
 * and falls back to the deterministic regex parser (HDFC-style layouts).
 */
async function buildResultFromText(text, source) {
  if (llmService.isLLMAvailable()) {
    try {
      const result = finalizeAiResult(await llmService.extractTransactionsFromText(text), source);
      if (result.transactions.length) return result;
      // LLM found nothing usable — fall through to the regex parser.
    } catch (err) {
      console.error('LLM statement parse failed, falling back to regex:', err.message);
    }
  }

  const transactions = parseBankText(text);
  const meta = extractBankMeta(text);
  return { transactions, ...meta, source };
}

function parseBankText(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // Single-line transaction: DD/MM/YY <narr> <ref> DD/MM/YY <amt> <closing>
  const SINGLE_RE = /^(\d{2}\/\d{2}\/\d{2})\s+(.+?)\s+(\d{13,16})\s+\d{2}\/\d{2}\/\d{2}\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s*$/;
  // Ref+amounts-only line (multi-line transactions): <ref> DD/MM/YY <amt> <closing>
  const REF_RE   = /^(\d{13,16})\s+\d{2}\/\d{2}\/\d{2}\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s*$/;
  // Date start
  const DATE_RE  = /^(\d{2}\/\d{2}\/\d{2})\s+/;
  // Summary line: opening_bal dr_count cr_count debits credits closing
  const SUM_RE   = /^([\d,]+\.\d{2})\s+\d+\s+\d+\s+[\d,]+\.\d{2}\s+[\d,]+\.\d{2}\s+[\d,]+\.\d{2}\s*$/;

  // Extract opening balance
  let prevBalance = null;
  for (const line of lines) {
    if (SUM_RE.test(line)) { prevBalance = parseAmount(SUM_RE.exec(line)[1]); break; }
  }

  // Extract account holder words (for transfer detection)
  let holderWords = [];
  for (const line of lines) {
    const m = line.match(/^(MR|MS|MRS|DR)\.?\s+([A-Z][A-Z\s]{3,})/);
    if (m) {
      holderWords = m[2].trim().split(/\s+/).filter(w => w.length > 3);
      break;
    }
  }

  const JUNK = /^(Date Narration|STATEMENT SUMMARY|Opening Balance|Page No|Generated On|Generated By|Contents of|https?:|Registered Office|HDFC BANK|State account|Account Branch|Address:|City:|State:|Phone|OD Limit|Currency:|Email:|Cust ID|Account No|Account Status|RTGS|Branch Code|Account Type|JOINT|Nomination|From\s*:|To\s*:|adjacent|embassy|outer ring|marathahalli|bengaluru|karnataka|MR |MS |MRS |VRM POTENTIAL)/i;

  const transactions = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Try single-line format first
    const sm = SINGLE_RE.exec(line);
    if (sm) {
      const dateISO  = parseDate(sm[1]);
      const narration = sm[2].trim();
      const amount   = parseAmount(sm[4]);
      const closing  = parseAmount(sm[5]);
      if (dateISO && amount > 0.01) {
        const type = resolveType(prevBalance, closing, narration, holderWords);
        transactions.push(buildTx({ date: dateISO, narration, amount, type, source: 'pdf' }));
        prevBalance = closing;
      }
      i++;
      continue;
    }

    // Try multi-line: date line starts a block
    const dm = DATE_RE.exec(line);
    if (dm) {
      const startDate = parseDate(dm[1]);
      if (startDate) {
        const narrationParts = [line.slice(dm[0].length).trim()];
        i++;
        // Accumulate lines until we hit the ref+amounts line
        while (i < lines.length) {
          const next = lines[i];
          const rm = REF_RE.exec(next);
          if (rm) {
            const amount  = parseAmount(rm[2]);
            const closing = parseAmount(rm[3]);
            // Skip junk narration lines, join valid ones
            const narration = narrationParts.filter(l => l && !JUNK.test(l)).join(' ').trim();
            if (narration && amount > 0.01) {
              const type = resolveType(prevBalance, closing, narration, holderWords);
              transactions.push(buildTx({ date: startDate, narration, amount, type, source: 'pdf' }));
              prevBalance = closing;
            }
            i++;
            // Skip post-ref continuation lines (they're extra narration, not a new tx)
            while (i < lines.length && !DATE_RE.test(lines[i]) && !REF_RE.test(lines[i]) && !SINGLE_RE.test(lines[i])) i++;
            break;
          }
          // Another date line hit before ref → previous block is orphan; don't advance i
          if (DATE_RE.test(next) || SINGLE_RE.test(next)) break;
          if (!JUNK.test(next)) narrationParts.push(next);
          i++;
        }
        continue;
      }
    }
    i++;
  }

  return transactions;
}

function resolveType(prevBalance, closing, narration, holderWords) {
  let type = prevBalance !== null
    ? (closing > prevBalance + 0.5 ? 'income' : 'expense')
    : 'expense';

  // Self-transfer: narration contains all main words of account holder's name
  if (holderWords.length >= 2) {
    const upper = narration.toUpperCase();
    if (holderWords.every(w => upper.includes(w))) type = 'transfer';
  }
  return type;
}

function extractBankMeta(text) {
  const fromMatch = text.match(/From\s*:\s*(\d{2}\/\d{2}\/\d{4})/i);
  const toMatch   = text.match(/To\s*:\s*(\d{2}\/\d{2}\/\d{4})/i);
  const bankMatch = text.match(/(HDFC BANK|AXIS BANK|STATE BANK|SBI|ICICI BANK|KOTAK|YES BANK|UNION BANK|CANARA BANK|PUNJAB NATIONAL BANK|IDFC|FEDERAL BANK)/i);
  const nameMatch = text.match(/(MR|MS|MRS|DR)\.?\s+([A-Z][A-Z\s]{3,}?)(?:\n|WELLS FARGO|Account No|Cust ID)/);

  const parseFull = str => {
    if (!str) return null;
    const p = str.split('/');
    return p.length === 3 ? `${p[2]}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}` : null;
  };

  return {
    bankName:    bankMatch ? bankMatch[1] : 'Bank',
    accountName: nameMatch ? nameMatch[2].trim() : '',
    period: {
      from: parseFull(fromMatch?.[1]),
      to:   parseFull(toMatch?.[1]),
    },
  };
}

// ─── UPI / BHIM HTML Parser ────────────────────────────────────────────────

function parseUPIHtml(html) {
  const dataMatch = html.match(/var DATA\s*=\s*'([\s\S]+?)'\s*;/);
  if (!dataMatch) throw new Error('Could not find UPI transaction data in this HTML file');

  const xml = dataMatch[1];

  const appMatch  = xml.match(/appName="([^"]+)"/);
  const fromMatch = xml.match(/fromDate="([^"]+)"/);
  const toMatch   = xml.match(/toDate="([^"]+)"/);

  // Collect all payer VPA bases the user owns (appear as PayerVpa with DR, meaning it's their account sending)
  const ownVpas = new Set();
  const vpaScanRe = /BenefitType="DR"[^>]+PayerVpa="([^"(]+)/g;
  let vsm;
  while ((vsm = vpaScanRe.exec(xml)) !== null) ownVpas.add(vsm[1].toLowerCase());

  // Parse transactions
  const txRe = /<Transaction\s+([^/]+)\/>/g;
  const transactions = [];
  const seenIds = new Set();
  let txm;

  while ((txm = txRe.exec(xml)) !== null) {
    const attrs = txm[1];
    const get = key => { const m = attrs.match(new RegExp(`${key}="([^"]+)"`)); return m ? m[1] : ''; };

    const txId        = get('Id');
    const benefitType = get('BenefitType');
    const amount      = parseFloat(get('Amount')) || 0;
    const timeRaw     = get('Time');
    const payeeVpa    = get('PayeeVpa');
    const payerVpa    = get('PayerVpa');

    if (amount < 0.01) continue;
    const dedupKey = `${txId}-${benefitType}`;
    if (seenIds.has(dedupKey)) continue;
    seenIds.add(dedupKey);
    const dateISO = timeRaw ? timeRaw.split('T')[0] : null;
    if (!dateISO) continue;

    // Extract name from VPA pattern: xxx(NAME) → NAME
    const nameFromVpa = vpa => { const m = vpa.match(/\(([^)]+)\)/); return m ? m[1].trim() : vpa.split('@')[0]; };
    const payeeName = nameFromVpa(payeeVpa);
    const payerName = nameFromVpa(payerVpa);

    const payeeVpaBase = payeeVpa.split('(')[0].toLowerCase();
    const payerVpaBase = payerVpa.split('(')[0].toLowerCase();

    let type;
    if (benefitType === 'CR') {
      // Income unless the payer is one of user's own accounts (= self-transfer)
      type = ownVpas.has(payerVpaBase) ? 'transfer' : 'income';
    } else {
      // Expense unless the payee is one of user's own accounts (= self-transfer)
      type = ownVpas.has(payeeVpaBase) ? 'transfer' : 'expense';
    }

    const narration = benefitType === 'DR'
      ? `UPI ${payeeName} ${payeeVpa}`
      : `UPI from ${payerName} ${payerVpa}`;

    transactions.push(buildTx({ date: dateISO, narration, amount, type, source: 'upi' }));
  }

  const parseUPIDate = str => {
    if (!str) return null;
    const p = str.split('/');
    return p.length === 3 ? `${p[2]}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}` : null;
  };

  return {
    transactions,
    bankName:    appMatch ? appMatch[1] : 'UPI',
    accountName: '',
    period: { from: parseUPIDate(fromMatch?.[1]), to: parseUPIDate(toMatch?.[1]) },
    source: 'html',
  };
}

// ─── Image Parser (Claude Vision) ─────────────────────────────────────────
// Thin wrapper — the actual model call lives in llmService.

async function parseImage(buffer, mimeType) {
  if (!llmService.isLLMAvailable()) {
    throw new Error('Reading screenshots requires AI parsing to be enabled on the server.');
  }
  const parsed = await llmService.extractTransactionsFromImage(buffer, mimeType);
  return finalizeAiResult(parsed, 'image');
}

// ─── Entry point ──────────────────────────────────────────────────────────

async function parseStatement({ buffer, mimetype, originalname, password }) {
  const ext = (originalname || '').split('.').pop().toLowerCase();

  if (mimetype === 'application/pdf' || ext === 'pdf') {
    return parsePDF(buffer, password);
  }
  if (mimetype === 'text/html' || ['html', 'htm'].includes(ext)) {
    return parseUPIHtml(buffer.toString('utf-8'));
  }
  if (mimetype === 'text/csv' || mimetype === 'text/plain' || ['csv', 'tsv', 'txt'].includes(ext)) {
    return buildResultFromText(buffer.toString('utf-8'), 'csv');
  }
  if (['image/png','image/jpeg','image/webp'].includes(mimetype) || ['png','jpg','jpeg','webp'].includes(ext)) {
    return parseImage(buffer, mimetype || `image/${ext}`);
  }
  throw new Error(`Unsupported file type: ${mimetype || ext}. Upload a PDF, CSV, HTML, or image file.`);
}

module.exports = { parseStatement };
