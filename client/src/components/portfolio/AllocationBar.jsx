import { CHART_COLORS, formatCurrency, compactIfLarge } from '../../lib/utils';
import { assetTypeLabel } from '../../lib/constants';

/**
 * Allocation as a single stacked bar plus a legend.
 *
 * A bar, not a donut: the job here is comparing magnitudes against the whole, and a
 * reader judges length far better than angle. The donut still earns its place on the
 * Analytics page, where the split IS the subject; here it is a supporting figure.
 *
 * Segments carry a 2px surface gap so adjacent slices stay separable, and the legend
 * names every slice — identity is never colour-alone.
 *
 * Props:
 *   items — [{ type|name, value, weight }] already sorted, largest first
 *   total — the whole, for the legend's amounts
 */
export default function AllocationBar({ items = [], height = 10 }) {
  const visible = items.filter(i => i.value > 0);
  if (!visible.length) return null;

  // A 9th slice would have to reuse a colour, so anything past the palette folds into
  // one honest "Other" rather than two categories wearing the same hue.
  const head = visible.slice(0, CHART_COLORS.length - 1);
  const tail = visible.slice(CHART_COLORS.length - 1);
  const slices = [...head];
  if (tail.length) {
    slices.push({
      type:   'other',
      name:   `Other (${tail.length})`,
      value:  tail.reduce((s, i) => s + i.value, 0),
      weight: tail.reduce((s, i) => s + i.weight, 0),
    });
  }

  const labelOf = (s) => s.name || assetTypeLabel(s.type);

  return (
    <div>
      <div style={{ display: 'flex', gap: 2, height, borderRadius: 99, overflow: 'hidden' }}>
        {slices.map((s, i) => (
          <div
            key={labelOf(s)}
            title={`${labelOf(s)} · ${s.weight.toFixed(1)}%`}
            style={{
              width: `${s.weight}%`,
              background: CHART_COLORS[i % CHART_COLORS.length],
              minWidth: 2,
            }}
          />
        ))}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 20px', marginTop: 16 }}>
        {slices.map((s, i) => (
          <div key={labelOf(s)} className="flex items-center gap-2" style={{ minWidth: 0 }}>
            <span style={{
              width: 8, height: 8, borderRadius: 2, flexShrink: 0,
              background: CHART_COLORS[i % CHART_COLORS.length],
            }} />
            <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
              {labelOf(s)}
            </span>
            <span className="figure text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {s.weight.toFixed(1)}%
            </span>
            <span className="figure text-xs" style={{ color: 'var(--color-text-muted)', opacity: 0.7 }}>
              {compactIfLarge(s.value, formatCurrency)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
