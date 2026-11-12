import { formatCurrency, formatPct, pnlColor, MONTHS_SHORT as MONTHS } from '../../lib/utils';

/**
 * The surface every chart tooltip in the app sits on — the popover surface, SOLID. It
 * used to be translucent glass with a backdrop blur, which over a coloured chart (the
 * sector map above all) smeared the marks behind it into the panel, so a tooltip about a
 * falling sector could look faintly green. Custom tooltips use this shell too, so there
 * is one tooltip look, not two.
 */
export function TooltipPanel({ children, minWidth = 170, style }) {
  return (
    <div style={{
      background: 'var(--color-bg-popover)',
      border: '1px solid var(--color-border-hover)',
      boxShadow: 'var(--shadow-popover)',
      borderRadius: 10,
      overflow: 'hidden',
      minWidth,
      ...style,
    }}>
      {children}
    </div>
  );
}

/** Format YYYY-MM-DD → "Mar 15, 2024"  |  YYYY-MM → "Mar 2024"  |  other → as-is */
function formatDateLabel(str) {
  if (!str) return str;
  const full = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (full) return `${MONTHS[parseInt(full[2], 10) - 1]} ${parseInt(full[3], 10)}, ${full[1]}`;
  const mon = str.match(/^(\d{4})-(\d{2})$/);
  if (mon)  return `${MONTHS[parseInt(mon[2], 10) - 1]} ${mon[1]}`;
  return str;
}

/**
 * Unified Recharts tooltip.
 * Works with bar/pie charts (label = X-axis value) and PriceGrapher
 * (date comes from payload[0].payload.date).
 *
 * Optional props beyond Recharts defaults:
 *   formatValue(v) — override value formatter (default: formatCurrency)
 *   valueLabel     — label for single-series charts (overrides p.name)
 *   percentBase    — when set, each series also shows its % change from this value.
 *                    Used by the growth view, where the index number alone ("112.43")
 *                    states the answer in a unit nobody thinks in: what the reader
 *                    wants is "+12.4%". Anchoring on the base rather than on a literal
 *                    100 keeps it right when the visible window starts partway into
 *                    the series — and it is the SAME anchor the benchmark overlays are
 *                    rebased to, so every line's percentage is measured from one point.
 */
// Past this many series the tooltip goes compact: one dense row each, so it stops burying the chart.
const COMPACT_AT = 4;

export default function ChartTooltip({ active, payload, label, formatValue = formatCurrency, valueLabel, percentBase }) {
  if (!active || !payload?.length) return null;

  const dateLabel = formatDateLabel(payload[0]?.payload?.date || label);
  const compact = payload.length >= COMPACT_AT;
  const pctOf = (p) => (percentBase && p.value != null) ? (p.value / percentBase - 1) * 100 : null;
  // Compact rows are ranked by value, so they read top-down in the order the lines sit.
  const rows = compact ? [...payload].sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity)) : payload;

  return (
    <TooltipPanel minWidth={compact ? 0 : 170}>
      {dateLabel && (
        <div style={{
          padding: compact ? '4px 10px' : '6px 12px',
          background: 'var(--color-bg-elevated)',
          borderBottom: '1px solid var(--color-border-subtle)',
        }}>
          <p style={{
            fontSize: 10,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: 'var(--color-text-muted)',
            margin: 0,
            fontFamily: 'var(--font-mono)',
          }}>
            {dateLabel}
          </p>
        </div>
      )}
      {compact ? (
        <div style={{ padding: '5px 10px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {rows.map((p, i) => {
            const pct = pctOf(p);
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: p.color || p.fill || 'var(--color-text-primary)' }} />
                <span style={{ fontSize: 10.5, color: 'var(--color-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 120, flex: 1 }}>
                  {valueLabel || p.name}
                </span>
                {/* The growth index is redundant beside its percentage, so only one figure shows. */}
                <span style={{
                  fontSize: 11, fontWeight: 600, fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-mono)',
                  whiteSpace: 'nowrap', marginLeft: 10,
                  color: pct != null ? pnlColor(pct) : 'var(--color-text-primary)',
                }}>
                  {pct != null ? formatPct(pct, 1) : formatValue(p.value)}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
      <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 5 }}>
        {rows.map((p, i) => {
          // A growth reading is a gain or a loss, so the percentage takes the status colours.
          const pct = pctOf(p);

          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24 }}>
              <span style={{ fontSize: 11, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                {valueLabel || p.name}
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 8, whiteSpace: 'nowrap' }}>
                <span style={{
                  fontSize: 12, fontWeight: 600, fontVariantNumeric: 'tabular-nums',
                  fontFamily: 'var(--font-mono)',
                  color: p.color || p.fill || 'var(--color-text-primary)',
                }}>
                  {formatValue(p.value)}
                </span>
                {pct != null && (
                  <span style={{
                    fontSize: 11, fontWeight: 600, fontVariantNumeric: 'tabular-nums',
                    fontFamily: 'var(--font-mono)', color: pnlColor(pct),
                  }}>
                    {formatPct(pct, 1)}
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>
      )}
    </TooltipPanel>
  );
}
