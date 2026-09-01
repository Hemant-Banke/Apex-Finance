import Card from './Card';

/**
 * The headline surface a page opens with.
 *
 * Every main page answers one question with one figure — net worth, an account's total,
 * the portfolio's market value — and every one of them had that figure sitting in a
 * plain block with its own components in a SEPARATE card underneath, which put the
 * answer and its parts on equal footing. This is the shape that fixes it, in one place
 * so four pages cannot drift: the gilt top-rule the system reserves for a headline, the
 * figure and its identity up top, and the components in a recessed band beneath, where
 * being subordinate is the whole point.
 *
 * Three slots, no children, because the arrangement is the component's job and the
 * content is the page's:
 *   lead   — identity and the figure itself (left of the top row)
 *   action — the page's primary control (right of the top row, vertically centred on
 *            the lead rather than pinned to its first line)
 *   band   — the components of the figure; omitted entirely when there are none
 */
export default function Masthead({ lead, action, band }) {
  return (
    <Card gilt flush>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 16, flexWrap: 'wrap', padding: '22px 24px 20px',
      }}>
        <div style={{ minWidth: 0 }}>{lead}</div>
        {action && <div style={{ flexShrink: 0 }}>{action}</div>}
      </div>

      {band && (
        <div style={{
          padding: '18px 24px 22px',
          borderTop: '1px solid var(--color-border-subtle)',
          background: 'var(--color-bg-secondary)',
        }}>
          {band}
        </div>
      )}
    </Card>
  );
}

/**
 * A component of the masthead's figure.
 *
 * Deliberately smaller than the figure it sits beneath: these add up TO it, and a row
 * of equal-sized numbers says they are equal facts.
 *
 * `swatch` ties a figure to its segment of the composition bar above — identity is never
 * colour alone, so a bar's slices are named here rather than left to be guessed from a
 * tooltip. `pct` prints the share beside the amount: an amount says how much, only a
 * share says how much OF it.
 *
 * Each figure used to be able to draw its OWN little rule of its own share, which put
 * three separate baselines in one band — three drawings of a single composition, none of
 * them comparable with the others. One bar above the row says it once, and says it
 * better; the figures just name their percentage.
 */
export function MastheadFigure({ label, value, pct, sub, accent, swatch }) {
  return (
    <div style={{ minWidth: 0 }}>
      <p className="text-xs" style={{ color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
        {swatch && <span style={{ width: 7, height: 7, borderRadius: 2, background: swatch, flexShrink: 0 }} />}
        {label}
      </p>
      <p style={{ display: 'flex', alignItems: 'baseline', gap: 7, marginTop: 5 }}>
        <span className="figure" style={{ fontSize: '1.0625rem', fontWeight: 500, color: accent || 'var(--color-text-primary)' }}>
          {value}
        </span>
        {pct != null && (
          <span className="figure text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {pct.toFixed(0)}%
          </span>
        )}
      </p>

      {sub && <div style={{ marginTop: 7 }}>{sub}</div>}
    </div>
  );
}
