/**
 * llmService — the ONLY place that talks to the Anthropic API.
 *
 * Statement parsing (text + image) and category prediction all run through
 * Claude Haiku 4.5 here. Callers (statementParsers, routes) never construct an
 * Anthropic client themselves. Every entry point degrades gracefully: callers
 * check `isLLMAvailable()` and fall back to deterministic logic when the model
 * is unavailable.
 */

const Anthropic = require('@anthropic-ai/sdk');

const MODEL = 'claude-haiku-4-5';

function isLLMAvailable() {
  return !!process.env.ANTHROPIC_API_KEY;
}

function getClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

/** Pull the first JSON object/array out of a model response and parse it. */
function _extractJSON(text) {
  const match = (text || '').match(/[[{][\s\S]*[\]}]/);
  if (!match) throw new Error('No JSON found in model response');
  return JSON.parse(match[0]);
}

// ─── Shared extraction instructions ───────────────────────────────────────────
// Used verbatim for both text (PDF/CSV) and image (screenshot) parsing so the
// two paths stay consistent.

const EXTRACTION_INSTRUCTIONS = `You are a universal financial statement parser. Extract EVERY transaction from the statement, regardless of the institution, language, layout, or columns. This includes BANK statements, UPI/wallet exports, credit-card statements, AND broker / demat statements (stock, ETF, mutual-fund, bond trades).

Return ONLY a JSON object (no markdown, no commentary):
{
  "bankName": "issuer / bank / broker / app name, or 'Statement'",
  "accountName": "the account HOLDER's own name, or empty string",
  "period": { "from": "YYYY-MM-DD or null", "to": "YYYY-MM-DD or null" },
  "transactions": [
    // CASH movement (bank / UPI / card):
    { "date": "YYYY-MM-DD", "narration": "original description verbatim", "amount": 1234.56, "type": "expense|income|transfer" },
    // ASSET trade (broker / demat statement):
    { "date": "YYYY-MM-DD", "narration": "original description verbatim", "type": "buy|sell", "assetSymbol": "TICKER", "assetName": "Full instrument name", "assetType": "stock|etf|mutual_fund|bond|gold|crypto|other", "units": 10, "pricePerUnit": 250.5 }
  ]
}

DIRECTION RULES (cash):
- Money OUT of the account (debit / withdrawal / DR / paid / purchase / spent) -> "expense".
- Money IN to the account (credit / deposit / CR / received / refund / salary / interest / dividend) -> "income".
- For bank statements where the debit vs credit column is ambiguous in the raw text, infer direction from the running Closing Balance: if the balance went DOWN it is an "expense", if it went UP it is "income".

TRANSFER RULE — be strict:
- Use "transfer" ONLY when money moves between the SAME account holder's OWN accounts (a self-transfer). Signals: the counterparty name in the narration matches the account holder name ("accountName"), or the narration explicitly indicates an own-account / self / wallet top-up / "to my ..." movement.
- A payment to ANY other person, merchant, biller, or business is NOT a transfer — it is an "expense" (money out) or "income" (money in).
- When you are unsure whether the counterparty is the holder's own account, DEFAULT to expense/income based on direction. Never guess "transfer".

ASSET / BROKER RULES:
- On broker or demat statements, each instrument (stock/ETF/fund/bond) movement is a "buy" or "sell".
- Units/shares credited IN (a "Buy/Cr" column, a "payin", an acquisition) -> "buy". Units/shares debited OUT (a "Sell/Dr" column, a "payout", a sale/delivery-out) -> "sell".
- "units" = the quantity of shares/units moved (a positive number).
- "assetName" = the full instrument name. "assetSymbol" = the ticker if present; if only a company name or ISIN is shown, derive a short UPPERCASE symbol from the name (no spaces).
- "assetType": names containing "ETF" -> "etf"; "GOLD" -> "gold"; "MUTUAL"/"FUND" -> "mutual_fund"; "BOND"/"GILT" -> "bond"; otherwise "stock".
- "pricePerUnit": the per-unit price/rate for that trade. Demat "transaction" rows often have NO price — in that case look for a separate HOLDINGS / valuation table in the same statement and use that instrument's per-unit Rate as the price. If no price exists anywhere, use null.
- Do NOT set "amount" on buy/sell rows — it is computed from units x pricePerUnit.

GENERAL:
- Convert any date format into ISO "YYYY-MM-DD".
- Statement rows frequently WRAP across multiple physical lines — rejoin a row and its continuation lines before extracting.
- SKIP: column headers, opening/closing/running balance rows, subtotals and "Total" rows, page headers/footers, address and legal boilerplate, and any non-transaction line.
- Keep the ORIGINAL narration text verbatim (it is used later for categorization).`;

function _finalizeExtraction(parsed) {
  return {
    bankName:     parsed.bankName || 'Statement',
    accountName:  parsed.accountName || '',
    period:       parsed.period || { from: null, to: null },
    transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
  };
}

/**
 * Extract transactions from arbitrary statement TEXT (PDF text dump, CSV, etc.).
 * @returns {Promise<{ bankName, accountName, period, transactions }>}
 */
async function extractTransactionsFromText(rawText) {
  const client = getClient();
  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    messages: [{
      role: 'user',
      content: `${EXTRACTION_INSTRUCTIONS}\n\nSTATEMENT TEXT:\n${(rawText || '').slice(0, 60000)}`,
    }],
  });
  return _finalizeExtraction(_extractJSON(resp.content?.[0]?.text || ''));
}

/**
 * Extract transactions from a statement/receipt IMAGE (screenshot or photo).
 * @returns {Promise<{ bankName, accountName, period, transactions }>}
 */
async function extractTransactionsFromImage(buffer, mimeType) {
  const client = getClient();
  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 8192,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mimeType, data: buffer.toString('base64') } },
        { type: 'text', text: `${EXTRACTION_INSTRUCTIONS}\n\nExtract from the attached statement/receipt image.` },
      ],
    }],
  });
  return _finalizeExtraction(_extractJSON(resp.content?.[0]?.text || ''));
}

/**
 * Predict a category code for each transaction using the user's own taxonomy.
 * Uses the receiver/merchant in the narration, the amount (size), the direction,
 * and the date to infer the best fit.
 *
 * @param {Array<{id, type, narration, amount, date}>} items
 * @param {{ expense: Array<{code,label}>, income: Array<{code,label}> }} taxonomy
 * @returns {Promise<Object.<string, string|null>>}  { [id]: code|null }
 */
async function categorizeTransactions(items, taxonomy) {
  if (!items.length) return {};
  const client = getClient();
  const fmt = list => (list || []).map(o => `${o.code}\t${o.label}`).join('\n');

  const prompt = `You are categorizing a user's bank/UPI transactions into their personal category taxonomy.

For EACH transaction, choose the single best category CODE from the allowed list that matches the transaction's "type" ("expense" uses the expense list, "income" uses the income list). Return null when nothing fits, and ALWAYS null for type "transfer", "buy", or "sell".

Use every available signal to decide:
- The narration text — the merchant / biller / receiver name and payment channel are the strongest signal (e.g. "SWIGGY" -> food delivery, "IRCTC" -> transit, "LIC" -> insurance, a person's name -> likely a personal transfer/gift, not a merchant category).
- The amount (size) — small amounts skew to food/transport/daily spends; large recurring amounts skew to rent/EMI/salary/investment.
- The date — helps distinguish e.g. monthly salary/rent from one-off spends.
- The direction (type) — only pick income categories for income, expense categories for expense.

ALLOWED EXPENSE CATEGORIES (code<TAB>label):
${fmt(taxonomy.expense)}

ALLOWED INCOME CATEGORIES (code<TAB>label):
${fmt(taxonomy.income)}

TRANSACTIONS (JSON array of {id, type, narration, amount, date}):
${JSON.stringify(items)}

Return ONLY a JSON object mapping each transaction id to a category code from the matching type's allowed list, or null:
{ "<id>": "<code|null>", ... }
Use codes EXACTLY as written in the allowed list. No markdown, no commentary.`;

  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 8192,
    messages: [{ role: 'user', content: prompt }],
  });

  const map = _extractJSON(resp.content?.[0]?.text || '');
  return (map && typeof map === 'object') ? map : {};
}

module.exports = {
  isLLMAvailable,
  extractTransactionsFromText,
  extractTransactionsFromImage,
  categorizeTransactions,
};
