/**
 * Divider — a horizontal rule.
 * Default is the neutral hairline; `gilt` draws the champagne signature rule.
 *
 * Props:
 *   gilt   — use the gilt-rule gradient
 *   margin — vertical margin (number → px, or any CSS length)
 */
export default function Divider({ gilt = false, margin = 0, style }) {
  const m = typeof margin === 'number' ? `${margin}px` : margin;
  return (
    <hr
      className={gilt ? 'gilt-rule' : 'divider'}
      style={{ margin: `${m} 0`, ...style }}
    />
  );
}
