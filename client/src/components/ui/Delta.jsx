import { ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';
import { formatSigned, formatPct, pnlColor, compactIfLarge } from '../../lib/utils';

/**
 * A change: an amount, a percentage, or both — carrying its own direction.
 *
 * Colour alone never states the direction (a red-green reader sees one grey chip beside
 * another), so the arrow and the explicit +/− sign always ride with it.
 *
 * A null `pct` renders as nothing rather than "0%": the server withholds a percentage
 * when the base is zero or negative, because "up 150%" from −₹1,000 to +₹500 is not a
 * fact about anything.
 *
 * `invert` separates the two jobs the chip was quietly doing at once. The ARROW states
 * the direction — up is up, always — and the COLOUR states whether that is good news.
 * On a balance those agree and nothing needs saying. On SPENDING they do not: a category
 * up 40% is unambiguously up and unambiguously not a gain, and painting it green because
 * the number rose is the chart telling a cheerful lie. So `invert` flips the colour only,
 * never the arrow or the sign.
 *
 * Props:
 *   value  — the absolute change (drives colour + arrow)
 *   pct    — optional percentage change
 *   amount — false to show the percentage only
 *   invert — colour a RISE as bad and a fall as good (spending, liabilities)
 *   size   — 'sm' | 'md'
 *   stacked — the percentage on its own line beneath the amount
 */
export default function Delta({ value = 0, pct = null, amount = true, compact = false, invert = false, size = 'sm', stacked = false }) {
  const color = pnlColor(invert ? -value : value);
  const Arrow = value > 0 ? ArrowUpRight : value < 0 ? ArrowDownRight : Minus;
  const px    = size === 'md' ? '0.875rem' : '0.75rem';

  const money = compact
    ? formatSigned(value, compactIfLarge)
    : formatSigned(value);

  if (stacked && amount && pct != null) {
    return (
      <span className="figure" style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, color, fontSize: px, fontWeight: 500 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Arrow size={size === 'md' ? 15 : 13} strokeWidth={2} style={{ flexShrink: 0 }} />
          {money}
        </span>
        <span style={{ opacity: 0.75, fontWeight: 400 }}>{formatPct(pct)}</span>
      </span>
    );
  }

  return (
    <span
      className="figure"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color, fontSize: px, fontWeight: 500 }}
    >
      <Arrow size={size === 'md' ? 15 : 13} strokeWidth={2} style={{ flexShrink: 0 }} />
      {amount && money}
      {pct != null && (
        <span style={{ opacity: amount ? 0.75 : 1 }}>
          {amount ? `(${formatPct(pct)})` : formatPct(pct)}
        </span>
      )}
    </span>
  );
}
