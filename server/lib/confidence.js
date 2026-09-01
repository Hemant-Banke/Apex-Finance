/**
 * confidence — how much to trust what came out of a statement.
 *
 * An import used to arrive as a flat list of assertions: this row IS ₹1,240 of food on
 * the 14th. Nothing distinguished a figure lifted off a strict regex and cross-checked
 * against the running balance from one a vision model read off a blurry screenshot, or
 * a merchant the user has categorised forty times from a coin-flip the model would not
 * defend. The user was asked to review all of it equally, so in practice they reviewed
 * none of it.
 *
 * Every stage now reports how sure it is, on one 0–1 scale:
 *
 *   fields   — the date, amount and direction (which parser, and was the direction
 *              actually verified against a balance?)
 *   symbol   — asset rows: did the instrument resolve to a REAL, priceable ticker?
 *   category — income/expense rows: which layer classified it, and how decisively?
 *
 * A row's score is `min(fields, symbol)` — its FACTS. Category is scored too but kept
 * out of that minimum: a rent payment that fell through to "Miscellaneous" is still a
 * perfectly well-read ₹35,000 on the 1st.
 *
 * **Only ONE number leaves this module**, though. The per-row scores exist to be
 * averaged, not shown: a badge on every row is sixty small judgements the user has to
 * make, which is the same problem as no badge at all, and it invites arguing with the
 * machine row by row. What actually helps is a single answer to "how much of this file
 * can I take on trust?" — see `summarise` — sitting next to the AI-generated pill,
 * where the same question was already being raised.
 *
 * The numbers are judgements, not measurements. What they must get right is the
 * ORDER: a file that needs reading has to score below one that doesn't.
 */

/** Field extraction, by the parser that produced the row. */
const PARSE = {
  // A structured export. The amount and direction are attributes, not prose.
  upi:        0.98,
  // Strict single-line regex AND the running closing balance agreed with it.
  bank_line:  0.95,
  // Same parser, but the row was reassembled from wrapped lines.
  bank_block: 0.90,
  // A language model reading arbitrary text. Refined by the model's own per-row score.
  llm_text:   0.72,
  // Vision on top of that: OCR misreads names and digits (see symbolResolver).
  llm_image:  0.58,
  // Typed by the user in the review table. Nothing to doubt.
  manual:     1.00,
};

/**
 * The deterministic parser infers direction from the running balance. Before the
 * opening balance is found there is nothing to check against and it assumes a debit —
 * a real guess, and the one that silently turns a salary credit into an expense.
 */
const UNVERIFIED_DIRECTION = 0.72;

/** Instrument resolution (services/symbolResolver). */
const SYMBOL = {
  isin:       1.00,  // an ISIN names one plan of one fund outright
  ticker:     0.95,  // a printed ticker that actually priced
  nav:        0.90,  // name matched AND the traded NAV matched on the trade date
  name:       0.70,  // name matched, nothing corroborated it
  ambiguous:  0.45,  // matched a name but the NAV disagrees — likely the wrong plan
  unresolved: 0.10,  // nothing credible; the row will not price until a human fixes it
};

/** Categorisation layer (routes/import → applySmartCategories). */
const CATEGORY = {
  rule:     0.85,  // an explicit merchant keyword rule
  llm:      0.65,  // the model's own score refines this
  fallback: 0.15,  // Other · Miscellaneous — i.e. nobody classified it
};

/** Human-readable source labels, for the review UI's tooltip. */
const LABELS = {
  upi: 'Structured export',
  bank_line: 'Balance-checked',
  bank_block: 'Balance-checked (multi-line)',
  llm_text: 'AI extraction',
  llm_image: 'AI vision (OCR)',
  manual: 'Entered by you',
  isin: 'Matched by ISIN',
  ticker: 'Ticker verified',
  nav: 'NAV matched',
  name: 'Name match only',
  ambiguous: 'NAV disagrees',
  unresolved: 'Not resolved',
  rule: 'Keyword rule',
  profile: 'Your past choices',
  llm: 'AI suggestion',
  fallback: 'No match — filed as Miscellaneous',
};

const clamp01 = (n) => Math.min(1, Math.max(0, n));

/** One scored part: `{ score, source, label }`. */
function part(source, score) {
  return { source, score: Math.round(clamp01(score) * 100) / 100, label: LABELS[source] || source };
}

/**
 * Blend a stage's own prior with a score the model reported for that row.
 *
 * The prior is what we know about the METHOD, the model's number is what it thinks of
 * this particular row; neither alone is trustworthy. A model that says 0.99 on a
 * smudged screenshot must not out-rank a balance-checked regex, so the prior caps the
 * result and the model's score can only move it within its own band.
 */
function withModelScore(prior, reported) {
  const r = Number(reported);
  if (!Number.isFinite(r) || r < 0 || r > 1) return prior;
  // The prior is what the method scores at the model's own par (0.75); below par the
  // row is marked down proportionally, above par it can recover at most a third of
  // the remaining headroom.
  return r >= 0.75
    ? prior + (1 - prior) * ((r - 0.75) / 0.25) / 3
    : prior * (0.55 + 0.45 * (r / 0.75));
}

/**
 * The `fields` part: how much the row's date, amount and direction can be trusted.
 *
 * @param parseSource        which extractor produced the row (a key of PARSE)
 * @param modelScore         the model's own 0–1 score for this row, if it gave one
 * @param directionVerified  false when income/expense was assumed rather than checked
 */
function fieldsPart(parseSource, { modelScore, directionVerified = true } = {}) {
  const prior  = PARSE[parseSource] ?? PARSE.llm_text;
  const scored = modelScore != null ? withModelScore(prior, modelScore) : prior;
  if (directionVerified) return part(parseSource, scored);

  // The figure and date still came off a strict regex — it is only the DIRECTION that
  // was assumed, so the label has to say that rather than keep claiming a balance
  // check the parser never got to make.
  const p = part(parseSource, scored * UNVERIFIED_DIRECTION);
  p.label = 'Direction assumed';
  return p;
}

/**
 * The row's headline score, and what drove it.
 *
 * @param {{fields?: object, symbol?: object, category?: object}} parts
 * @returns {number} 0–1, the weakest FACT the row rests on.
 */
function overall(parts = {}) {
  const facts = [parts.fields, parts.symbol].filter(Boolean).map(p => p.score);
  if (!facts.length) return 1;
  return Math.round(Math.min(...facts) * 100) / 100;
}

/** Bands the review UI colours by. Anything below `REVIEW` deserves a human. */
const REVIEW = 0.6;
const GOOD   = 0.85;

/**
 * ONE score for the whole parse, plus the few counts that explain it.
 *
 * The score is the MEAN of the per-row scores, and it is meant to be read literally:
 * the share of this file's rows we expect to be right. A mean is the only aggregate
 * that answers that question — the minimum would let one unreadable row condemn a
 * clean statement, and the maximum would hide it.
 *
 * The mean alone would hide a small bad tail (three ruined rows in sixty barely move
 * it), so the counts ride alongside: how many rows are weak, how many instruments went
 * unresolved, how many categories nobody could pick. Those are what the user acts on;
 * the score is what tells them whether to bother looking.
 *
 * @returns {{score, method, rows, weakRows, unresolved, unclassified}|null}
 */
function summarise(transactions = []) {
  const rows = (transactions || []).filter(t => t?.confidenceParts);
  if (!rows.length) return null;

  const scores = rows.map(t => overall(t.confidenceParts));
  const mean   = scores.reduce((a, b) => a + b, 0) / scores.length;

  // One file is parsed by one extractor, so the method is the same on every row —
  // take the commonest rather than assuming, since a mixed result is not impossible.
  const methods = {};
  for (const t of rows) {
    const l = t.confidenceParts.fields?.label;
    if (l) methods[l] = (methods[l] || 0) + 1;
  }
  const method = Object.entries(methods).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  return {
    score:        Math.round(mean * 100) / 100,
    method,
    rows:         rows.length,
    weakRows:     scores.filter(s => s < REVIEW).length,
    unresolved:   rows.filter(t => t.confidenceParts.symbol?.source === 'unresolved').length,
    unclassified: rows.filter(t => t.confidenceParts.category?.source === 'fallback').length,
  };
}

/**
 * Drop the per-row workings from the payload.
 *
 * They are the summary's raw material, not something the client should render or the
 * user should have to adjudicate — and once a row is edited in review they describe a
 * value that no longer exists.
 */
function stripRowScores(transactions = []) {
  for (const t of transactions || []) {
    delete t.confidence;
    delete t.confidenceParts;
  }
  return transactions;
}

module.exports = {
  PARSE, SYMBOL, CATEGORY, LABELS,
  UNVERIFIED_DIRECTION,
  REVIEW, GOOD,
  part, fieldsPart, withModelScore, overall,
  summarise, stripRowScores,
};
