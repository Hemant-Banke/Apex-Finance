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
- ONLY a DEBIT (money leaving this account) can be a "transfer". A CREDIT (money coming in) is NEVER a transfer — classify every credit as "income".
- Among debits, use "transfer" ONLY when the money moves to the SAME holder's OWN account (a self-transfer). Signals: the counterparty name matches the account holder ("accountName"); or the narration indicates an own-account / self / wallet top-up / investment-funding movement (e.g. "towards US stocks", "to my ... account", "add money to wallet").
- A DEBIT paid to ANY other person, merchant, biller, or business is NOT a transfer — it is an "expense".
- When unsure whether a debit goes to the holder's own account, DEFAULT to "expense". Never guess "transfer".

ASSET / BROKER RULES:
- On broker or demat statements, each instrument (stock/ETF/fund/bond) movement is a "buy" or "sell".
- Units/shares credited IN (a "Buy/Cr" column, a "payin", an acquisition) -> "buy". Units/shares debited OUT (a "Sell/Dr" column, a "payout", a sale/delivery-out) -> "sell".
- "units" = the quantity of shares/units moved (a positive number).
- "assetName" = the full instrument name, transcribed EXACTLY as printed (e.g. "Quant Small Cap Fund", "Reliance Industries Ltd"). Do not abbreviate, expand or reorder it — it is matched against a market database downstream.
- "assetSymbol" = the ticker ONLY if the statement actually prints one (e.g. "RELIANCE", "INFY.NS", "TCS"). Copy it verbatim, including or omitting any exchange suffix exactly as shown. If the statement shows only a name, an ISIN or a scheme code, set "assetSymbol" to null. NEVER invent, guess or derive a ticker from the name — a wrong ticker is far worse than none.
- "assetType": names containing "ETF" -> "etf"; "GOLD" -> "gold"; "MUTUAL"/"FUND"/"SCHEME"/"NAV" -> "mutual_fund"; "BOND"/"GILT" -> "bond"; otherwise "stock".
- "pricePerUnit": the per-unit price/rate for that trade. For mutual funds this is the NAV (often printed inline, e.g. "164.34 (Nav 221.78)" -> units 164.34, pricePerUnit 221.78). Demat "transaction" rows often have NO price — in that case look for a separate HOLDINGS / valuation table in the same statement and use that instrument's per-unit Rate as the price. If no price exists anywhere, use null.
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
 * Predict a category code for each transaction using the user's own taxonomy and
 * their learned categorization profile.
 *
 * @param {Array<{id, type, narration, amount, day}>} items
 * @param {{ expense: Array<{code,label}>, income: Array<{code,label}> }} taxonomy
 * @param {string} [profileSummary]  learned per-user patterns (from categoryProfileService)
 * @returns {Promise<Object.<string, string|null>>}  { [id]: code|null }
 */
async function categorizeTransactions(items, taxonomy, profileSummary = '') {
  if (!items.length) return {};
  const client = getClient();
  const fmt = list => (list || []).map(o => `${o.code}\t${o.label}`).join('\n');

  const profileBlock = profileSummary
    ? `\nLEARNED PROFILE FOR THIS USER (their own past categorizations — trust these strongly):\n${profileSummary}\n`
    : '';

  const prompt = `You assign each of a user's bank/UPI transactions to exactly one category from THEIR taxonomy. Accuracy matters — a wrong category is worse than a slightly more generic correct one.

Decide with this priority:
1. LEARNED PROFILE (below, if present) — if a transaction matches a known merchant or a clear amount/day pattern this user has established, use that category. This is how you get recurring items (rent, salary, EMI, subscriptions) and personal habits right.
2. MERCHANT / RECEIVER in the narration — the business or biller name is the strongest generic signal (e.g. SWIGGY/ZOMATO → food delivery, UBER/OLA → rideshare, IRCTC → transit, NETFLIX → streaming, LIC/insurer → insurance, a landlord/rent keyword → rent, an employer/"SALARY"/"PAYROLL" → salary, "DIVIDEND"/"INTEREST" → investment income).
3. AMOUNT (size) — small everyday amounts skew to food/transport/daily spends; large regular amounts skew to rent/EMI/salary/investment.
4. DAY OF WEEK — weekday commute vs weekend leisure, month-boundary salary/rent, etc.

Hard rules:
- "expense" transactions may ONLY use expense codes; "income" transactions may ONLY use income codes.
- A payment to another person or a business is NOT a transfer; categorize it normally.
- If, after all signals, no category is a good fit, return null (a fallback is applied later) — do NOT force a wrong specific category.
${profileBlock}
ALLOWED EXPENSE CATEGORIES (code<TAB>label):
${fmt(taxonomy.expense)}

ALLOWED INCOME CATEGORIES (code<TAB>label):
${fmt(taxonomy.income)}

TRANSACTIONS (JSON array of {id, type, narration, amount, day}):
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
