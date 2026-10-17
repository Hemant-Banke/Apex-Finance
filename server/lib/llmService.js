/**
 * llmService — the ONLY place that talks to the Anthropic API.
 *
 * Statement parsing (text + image), category prediction and annual-report reading run through
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
    { "date": "YYYY-MM-DD", "time": "HH:MM (24h) only if the row prints a time, else omit", "narration": "original description verbatim", "amount": 1234.56, "type": "expense|income|transfer", "confidence": 0.95, "accountRef": "only if the statement covers several accounts — see below" },
    // ASSET trade (broker / demat statement):
    { "date": "YYYY-MM-DD", "narration": "original description verbatim", "type": "buy|sell", "confidence": 0.95, "assetSymbol": "TICKER", "assetName": "Full instrument name", "assetType": "stock|etf|mutual_fund|bond|crypto|other", "units": 10, "pricePerUnit": 250.5 }
  ]
}

CONFIDENCE — report one on EVERY row, and mean it:
- "confidence" is how sure you are of that row's DATE, AMOUNT and TYPE together. 0.0 = a guess, 1.0 = the statement states all three unambiguously. It is NOT about the category, which you are not being asked for here.
- Judge the row you actually read, not the document in general. Two rows of the same statement routinely deserve different scores.
- Score HIGH (0.9–1.0) when the date, the figure and the debit/credit column are all printed plainly and you copied them.
- Score MIDDLING (0.6–0.85) when you had to infer something real: the direction from a running balance, a year the row omitted, a row you reassembled from wrapped lines, an amount you picked between two adjacent numbers.
- Score LOW (below 0.5) when a character was genuinely unclear, a column was cut off, the row may be a subtotal, or the amount could plausibly be read another way.
- Do NOT report high confidence everywhere. A uniform score tells the user nothing and is worse than no score at all — the whole point is that they can see which rows to look at.

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
- "assetType": names containing "ETF" or "BEES" (incl. gold/silver ETFs like "GOLDBEES") -> "etf"; Sovereign Gold Bonds -> "bond"; "MUTUAL"/"FUND"/"SCHEME"/"NAV" -> "mutual_fund"; "BOND"/"GILT" -> "bond"; otherwise "stock".
- "pricePerUnit": the per-unit price/rate for that trade. For mutual funds this is the NAV (often printed inline, e.g. "164.34 (Nav 221.78)" -> units 164.34, pricePerUnit 221.78). Demat "transaction" rows often have NO price — in that case look for a separate HOLDINGS / valuation table in the same statement and use that instrument's per-unit Rate as the price. If no price exists anywhere, use null.
- Do NOT set "amount" on buy/sell rows — it is computed from units x pricePerUnit.

MULTIPLE ACCOUNTS:
- Some statements are consolidated: they cover more than ONE account of the holder's (e.g. a savings account and a credit card, or two accounts printed in sections). ONLY in that case, set "accountRef" on every transaction to the account it belongs to, exactly as the statement labels it (e.g. "XXXX1234", "Savings — 5678", "Platinum Card"). Use the same string for every row of the same account.
- If the statement covers a SINGLE account, omit "accountRef" entirely. Never invent one.

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
// A long statement in one call overruns max_tokens and the truncated JSON parses to nothing.
const CHUNK_CHARS = 12000;
const MAX_CHUNKS  = 16;

function _chunkText(text) {
  const chunks = [];
  let cur = '';
  for (const line of text.split('\n')) {
    if (cur.length + line.length > CHUNK_CHARS && cur) { chunks.push(cur); cur = ''; }
    cur += line + '\n';
  }
  if (cur.trim()) chunks.push(cur);
  return chunks.slice(0, MAX_CHUNKS);
}

async function _extractChunk(client, text, part, total) {
  const note = total > 1
    ? `\n\nThis is part ${part} of ${total} of one statement. Extract only rows that START in this part; a row cut off at the very end belongs to the next part.`
    : '';
  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    messages: [{ role: 'user', content: `${EXTRACTION_INSTRUCTIONS}${note}\n\nSTATEMENT TEXT:\n${text}` }],
  });
  return _finalizeExtraction(_extractJSON(resp.content?.[0]?.text || ''));
}

async function extractTransactionsFromText(rawText) {
  const client = getClient();
  const chunks = _chunkText(rawText || '');
  const results = [];
  for (let i = 0; i < chunks.length; i += 4) {
    const batch = chunks.slice(i, i + 4).map((c, k) =>
      _extractChunk(client, c, i + k + 1, chunks.length).catch((err) => {
        console.error(`LLM statement chunk ${i + k + 1} failed:`, err.message);
        return null;
      }));
    results.push(...await Promise.all(batch));
  }
  const ok = results.filter(Boolean);
  if (!ok.length) throw new Error('Every statement chunk failed to parse');
  const head = ok.find(r => r.bankName !== 'Statement') || ok[0];
  return {
    ...head,
    period: {
      from: ok.map(r => r.period?.from).filter(Boolean).sort()[0] || null,
      to:   ok.map(r => r.period?.to).filter(Boolean).sort().pop() || null,
    },
    transactions: ok.flatMap(r => r.transactions),
  };
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
// Rows per categorisation call; one call for a whole statement overran max_tokens.
const CATEGORIZE_BATCH = 60;

/**
 * items: [{ id, type, narration, amount, day, dom, hour, payee, payeeKind, payeeCount,
 * payeeMedian, payeeDays }] — the payee fields describe the WHOLE file, not the batch.
 */
async function categorizeTransactions(items, taxonomy, profileSummary = '') {
  if (!items.length) return {};
  const client = getClient();
  const batches = [];
  for (let i = 0; i < items.length; i += CATEGORIZE_BATCH) batches.push(items.slice(i, i + CATEGORIZE_BATCH));
  const out = {};
  for (let i = 0; i < batches.length; i += 4) {
    const maps = await Promise.all(batches.slice(i, i + 4).map(b =>
      _categorizeBatch(client, b, taxonomy, profileSummary).catch((err) => {
        console.error('LLM categorisation batch failed:', err.message);
        return {};
      })));
    for (const m of maps) Object.assign(out, m);
  }
  return out;
}

async function _categorizeBatch(client, items, taxonomy, profileSummary) {
  const fmt = list => (list || []).map(o => `${o.code}\t${o.label}`).join('\n');

  const profileBlock = profileSummary
    ? `\nLEARNED PROFILE FOR THIS USER (their own past categorizations — trust these strongly):\n${profileSummary}\n`
    : '';

  const prompt = `You assign each of a user's bank/UPI transactions to exactly one category from THEIR taxonomy. Accuracy matters — a wrong category is worse than a slightly more generic correct one.

Decide with this priority:
1. LEARNED PROFILE (below, if present) — if a transaction matches a known merchant or a clear amount/day pattern this user has established, use that category. This is how you get recurring items (rent, salary, EMI, subscriptions) and personal habits right.
2. MERCHANT / RECEIVER in the narration — the business or biller name is the strongest generic signal (e.g. SWIGGY/ZOMATO → food delivery, UBER/OLA → rideshare, IRCTC → transit, NETFLIX → streaming, LIC/insurer → insurance, a landlord/rent keyword → rent, an employer/"SALARY"/"PAYROLL" → salary, "DIVIDEND"/"INTEREST" → investment income).
3. BEHAVIOUR — most UPI rows name only a person or a tiny shop, so read the pattern, not just the name. Each row carries:
   - payeeKind: "business" (a payment gateway or company), "vendor" (a shop QR — stalls, autos, kiranas, tea shops), "person" (a personal UPI id), "unknown".
   - payeeCount / payeeDays / payeeMedian: how often THIS payee appears in the whole statement, on how many distinct days, and its usual amount.
   - amount, day (weekday), dom (day of month), hour (0–23, null when the statement prints no time).
   Reason like someone who knows Indian spending. Examples, not an exhaustive list:
   - A one-off ₹30–₹400 payment to a person or vendor QR, especially around commute hours (7–11, 17–22) or late at night, is very often an auto/cab ride paid to the driver (Rapido, Namma Yatri, autos) → rideshare; prefer it over groceries when the payee never recurs.
   - A vendor paid many times on many days in small amounts (₹10–₹150) around meal or tea times is a canteen, café or tea stall → coffee/restaurants; on weekday office hours it is likely an office cafeteria.
   - The same person paid a similar large amount once a month near the month boundary is rent (or a domestic help's salary if smaller); a large monthly debit to a lender is an EMI.
   - Late-night small vendor/person payments on weekends lean to food and outings; ₹100–₹400 mid-morning payments to a vendor lean to groceries or daily needs.
   Weigh these together; one weak signal alone is a guess.

Hard rules:
- "expense" transactions may ONLY use expense codes; "income" transactions may ONLY use income codes.
- A payment to another person or a business is NOT a transfer; categorize it normally.
- If, after all signals, no category is a good fit, return null (a fallback is applied later) — do NOT force a wrong specific category.
${profileBlock}
ALLOWED EXPENSE CATEGORIES (code<TAB>label):
${fmt(taxonomy.expense)}

ALLOWED INCOME CATEGORIES (code<TAB>label):
${fmt(taxonomy.income)}

TRANSACTIONS (JSON array of {id, type, narration, amount, day, dom, hour, payee, payeeKind, payeeCount, payeeDays, payeeMedian}):
${JSON.stringify(items)}

Return ONLY a JSON object mapping each transaction id to your choice and how sure you are of it:
{ "<id>": { "code": "<code|null>", "confidence": 0.0-1.0 }, ... }
- "confidence" is for THAT row: 0.9+ when the learned profile or an unmistakable merchant name settles it, 0.6–0.85 when the merchant is recognisable but the exact sub-category is a judgement, 0.4–0.6 when a clear behavioural pattern (above) points one way, below 0.4 when it is a lone hunch — but still give your best category rather than null when the pattern is real. Vary it honestly — a flat score across every row is useless to the user reviewing them.
- Use codes EXACTLY as written in the allowed list. No markdown, no commentary.`;

  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 8192,
    messages: [{ role: 'user', content: prompt }],
  });

  const map = _extractJSON(resp.content?.[0]?.text || '');
  if (!map || typeof map !== 'object') return {};

  // Normalise to `{ code, confidence }`. A bare string is still accepted — models drift
  // back to the simpler shape, and losing the whole batch over a missing wrapper would
  // be a far worse failure than an unscored (but correct) category.
  const out = {};
  for (const [id, v] of Object.entries(map)) {
    if (v == null) continue;
    if (typeof v === 'string') { out[id] = { code: v, confidence: null }; continue; }
    if (typeof v === 'object' && v.code) {
      const c = Number(v.confidence);
      out[id] = { code: v.code, confidence: Number.isFinite(c) && c >= 0 && c <= 1 ? c : null };
    }
  }
  return out;
}

// ─── Company business profile (annual report / 10-K excerpts) ─────────────────

const BUSINESS_INSTRUCTIONS = `You read excerpts from ONE company's annual report (an Indian annual report, or a US 10-K) and report where its revenue comes from and how it trades with the world. The excerpts were cut out by keyword, so they are fragments; some may belong to the standalone and some to the consolidated statements.

Return ONLY a JSON object (no markdown, no commentary):
{
  "fiscalYearEnd": "YYYY-MM-DD — the end of the year this report covers",
  "basis": "consolidated|standalone — which statements the figures below come from",
  "unit": "the unit the SEGMENT and GEOGRAPHY figures are printed in, exactly one of: rupees|thousands|lakhs|crore|millions|billions",
  "currency": "INR|USD|… as printed",
  "segments": [ { "name": "Business segment", "revenue": 0, "prevRevenue": 0, "result": 0, "prevResult": 0 } ],
  "geography": [ { "region": "India / United States / Europe / Rest of world …", "revenue": 0, "prevRevenue": 0 } ],
  "products": [ { "name": "product or service line", "revenue": 0, "prevRevenue": 0, "share": 0 } ],
  "trade": {
    "unit": "the unit the trade figures are printed in (same choices) — often different from the segment note's",
    "exportShare": 0,
    "forexEarnings": 0, "prevForexEarnings": 0,
    "forexOutgo": 0, "prevForexOutgo": 0,
    "importsCif": 0, "prevImportsCif": 0,
    "imports": [ { "item": "Raw materials / Components / Capital goods / …", "value": 0 } ]
  },
  "materials": [ { "name": "key input", "source": "where it comes from (imported from X / domestic / both), only if stated", "importedShare": 0 } ],
  "customers": { "summary": "one sentence on concentration, as stated", "topShare": "the largest single customer's % of revenue, only if a figure is printed (not a threshold like 'more than 10%')", "named": ["customer names, only if printed"], "types": "who buys (OEMs, retail, government …)" },
  "suppliers": { "summary": "one sentence, as stated", "named": ["supplier names, only if printed"] },
  "highlights": ["at most 4 short factual sentences on notable changes this year: a new segment, a market entered or exited, a shift in mix"]
}

RULES:
- Copy figures EXACTLY as printed; never convert. Segments and geography use "unit"; every trade figure uses "trade.unit". Read each unit off the table it comes from (a "₹ lakhs" or "In crore" heading above it).
- Prefer CONSOLIDATED figures when both are present, and use the same basis for segments and geography.
- "products" is revenue by product/service line (e.g. "net sales by category", BRSR "products/services sold"), in "unit". Fill revenue where printed, else only "share".
- "prev*" fields are the previous-year column printed beside the current year. null when not printed.
- Shares ("exportShare", "share", "importedShare", "topShare") are percentages 0–100. null when not stated.
- "forexEarnings" / "forexOutgo" come from the "Foreign exchange earnings and outgo" disclosure (outgo = total foreign-exchange outflow / expenditure in foreign currency incl. imports).
- Customers and suppliers: only names the report actually prints. NEVER infer a name from your own knowledge. An empty list is the honest answer.
- "highlights" must come from the excerpts, with figures copied exactly. Nothing from your own knowledge.
- Any field the excerpts do not support is null (or [] for lists). A guess is worse than a gap.`;

/** Structure what an annual report says about the business. Null when the model returns nothing usable. */
async function extractBusinessProfile(excerpts, { company, year } = {}) {
  const resp = await getClient().messages.create({
    model: MODEL,
    max_tokens: 8000,
    messages: [{ role: 'user', content: `${BUSINESS_INSTRUCTIONS}\n\nCOMPANY: ${company || 'unknown'} · REPORT YEAR: ${year || 'unknown'}\n\nEXCERPTS:\n${excerpts}` }],
  });
  if (resp.stop_reason === 'max_tokens') return null;
  return _extractJSON(resp.content?.find(b => b.type === 'text')?.text || '');
}

module.exports = {
  isLLMAvailable,
  extractBusinessProfile,
  extractTransactionsFromText,
  extractTransactionsFromImage,
  categorizeTransactions,
};
