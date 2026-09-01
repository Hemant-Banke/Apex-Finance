/**
 * How much of a parsed statement to take on trust — mirrors `server/lib/confidence.js`.
 *
 * ONE number for the whole file, not one per row. The server scores every stage of
 * every row (which parser, was the direction balance-checked, did the instrument
 * resolve, which layer picked the category) and averages them; what arrives here is
 * that average plus the handful of counts that explain it.
 *
 * Per-row badges were the obvious design and the wrong one: sixty small verdicts is
 * sixty judgements to make, which is the same as none, and it turns review into an
 * argument with the machine. One figure answers the only question actually being
 * asked — is this import worth reading before I accept it?
 */

/** Below this, the file is worth reading through. */
export const REVIEW = 0.6;
/** At or above this, it is as good as typed. */
export const GOOD = 0.85;

export function confidenceBand(score) {
  if (score == null) return null;
  if (score >= GOOD)   return 'high';
  if (score >= REVIEW) return 'fair';
  return 'low';
}

/**
 * Colour by band. High is deliberately MUTED, not green: green is this app's gain
 * colour, and a clean parse is the ordinary case — it should read as "nothing to see",
 * not as a congratulation.
 */
export const BAND_COLOR = {
  high: 'var(--color-text-muted)',
  fair: 'var(--color-chart-warm)',
  low:  'var(--color-danger)',
};

export const BAND_LABEL = {
  high: 'Read confidently',
  fair: 'Worth a scan',
  low:  'Check these rows before importing',
};

/** "92%" — the score as the user reads it. */
export const asPercent = (score) => `${Math.round((score ?? 0) * 100)}%`;

/**
 * The tooltip behind the figure: how it was parsed, and what specifically is shaky.
 * The counts are the actionable part — the score only says whether to look.
 */
export function confidenceDetail(summary) {
  if (!summary) return '';
  const { method, rows, weakRows, unresolved, unclassified } = summary;
  const lines = [];
  if (method) lines.push(method);
  lines.push(`${rows} row${rows === 1 ? '' : 's'} read`);
  if (weakRows)     lines.push(`${weakRows} uncertain`);
  if (unresolved)   lines.push(`${unresolved} instrument${unresolved === 1 ? '' : 's'} unresolved`);
  if (unclassified) lines.push(`${unclassified} left uncategorised`);
  return lines.join(' · ');
}
