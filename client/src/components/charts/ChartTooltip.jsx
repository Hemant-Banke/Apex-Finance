import { formatCurrency } from '../../lib/utils';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

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
 */
export default function ChartTooltip({ active, payload, label, formatValue = formatCurrency, valueLabel }) {
  if (!active || !payload?.length) return null;

  const dateLabel = formatDateLabel(payload[0]?.payload?.date || label);

  return (
    <div style={{
      background: 'rgba(10, 10, 10, 0.88)',
      backdropFilter: 'blur(14px)',
      WebkitBackdropFilter: 'blur(14px)',
      border: '1px solid rgba(255,255,255,0.07)',
      borderRadius: 10,
      overflow: 'hidden',
      minWidth: 170,
    }}>
      {dateLabel && (
        <div style={{
          padding: '6px 12px',
          background: 'rgba(255,255,255,0.05)',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}>
          <p style={{
            fontSize: 10,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: 'rgba(255,255,255,0.38)',
            margin: 0,
            fontFamily: 'var(--font-mono)',
          }}>
            {dateLabel}
          </p>
        </div>
      )}
      <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 5 }}>
        {payload.map((p, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24 }}>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.42)', whiteSpace: 'nowrap' }}>
              {valueLabel || p.name}
            </span>
            <span style={{
              fontSize: 12, fontWeight: 600, fontVariantNumeric: 'tabular-nums',
              fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap',
              color: p.color || p.fill || 'rgba(255,255,255,0.88)',
            }}>
              {formatValue(p.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
