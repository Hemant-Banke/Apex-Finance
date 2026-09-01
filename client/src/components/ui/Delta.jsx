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
 * Props:
 *   value  — the absolute change (drives colour + arrow)
 *   pct    — optional percentage change
 *   amount — false to show the percentage only
 *   size   — 'sm' | 'md'
 */
export default function Delta({ value = 0, pct = null, amount = true, compact = false, size = 'sm' }) {
  const color = pnlColor(value);
  const Arrow = value > 0 ? ArrowUpRight : value < 0 ? ArrowDownRight : Minus;
  const px    = size === 'md' ? '0.875rem' : '0.75rem';

  const money = compact
    ? formatSigned(value, compactIfLarge)
    : formatSigned(value);

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
