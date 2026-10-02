import { useState } from 'react';
import { CHART_COLORS, formatCurrency, compactIfLarge } from '../../lib/utils';
import { assetTypeLabel } from '../../lib/constants';

/** Neutral tones for slices that belong to no category (the folded tail, idle cash). */
export const OTHER_TONE = 'color-mix(in srgb, var(--color-text-muted) 45%, transparent)';
export const CASH_TONE  = 'color-mix(in srgb, var(--color-text-muted) 70%, transparent)';

const labelOf = (s) => s.name || assetTypeLabel(s.type);
const keyOf   = (s) => s.key ?? labelOf(s);

/**
 * Allocation as a single stacked bar plus a legend.
 *
 * A bar, not a donut: length is judged far better than angle. Past the palette the tail
 * folds into one neutral "Other" — two categories never share a hue.
 *
 * Props:
 *   items     — [{ key?, type|name, value, weight, color? }], largest first
 *   showValue — print each slice's rupee amount (off where `value` is not money)
 *   legend    — draw the legend beneath (off when a table names the slices)
 *   active / onActive — controlled hover key, to link the bar with a table
 *   muted     — a secondary bar (e.g. cost beneath value)
 *   picked / onPick — a clicked slice stays lit; clicking makes slices selectable
 */
export default function AllocationBar({
  items = [], height = 10, showValue = true, legend = true, active, onActive, muted = false, picked, onPick,
}) {
  const [hoverOwn, setHoverOwn] = useState(null);
  const hover    = active !== undefined ? active : hoverOwn;
  const setHover = onActive || setHoverOwn;

  const visible = items.filter(i => i.value > 0);
  if (!visible.length) return null;

  const head = visible.slice(0, CHART_COLORS.length);
  const tail = visible.slice(CHART_COLORS.length);
  const slices = head.map((s, i) => ({ ...s, color: s.color ?? CHART_COLORS[i] }));
  if (tail.length) {
    slices[slices.length - 1] = {
      key: 'other', name: `Other (${tail.length + 1})`, color: OTHER_TONE,
      value:  [head.at(-1), ...tail].reduce((s, i) => s + i.value, 0),
      weight: [head.at(-1), ...tail].reduce((s, i) => s + i.weight, 0),
    };
  }

  const lit = hover ?? picked;
  const dim = (s) => lit != null && lit !== keyOf(s);
  const pickProps = (s) => onPick ? {
    role: 'button', tabIndex: 0, 'aria-pressed': picked === keyOf(s),
    onClick: () => onPick(keyOf(s)),
    onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(keyOf(s)); } },
  } : {};

  return (
    <div onMouseLeave={() => setHover(null)}>
      <div style={{ display: 'flex', gap: 2, height, borderRadius: 99, overflow: 'hidden', opacity: muted ? 0.5 : 1 }}>
        {slices.map(s => (
          <div
            key={keyOf(s)}
            title={`${labelOf(s)} · ${s.weight.toFixed(1)}%`}
            onMouseEnter={() => setHover(keyOf(s))}
            {...pickProps(s)}
            style={{
              width: `${s.weight}%`, minWidth: 2, background: s.color, cursor: onPick ? 'pointer' : undefined,
              opacity: dim(s) ? 0.28 : 1, transition: 'opacity 0.18s ease',
            }}
          />
        ))}
      </div>

      {legend && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 20px', marginTop: 16 }}>
          {slices.map(s => (
            <div key={keyOf(s)} className="flex items-center gap-2"
              onMouseEnter={() => setHover(keyOf(s))}
              {...pickProps(s)}
              style={{
                minWidth: 0, opacity: dim(s) ? 0.45 : 1, transition: 'opacity 0.18s ease',
                cursor: onPick ? 'pointer' : 'default',
                ...(picked === keyOf(s) && { textDecoration: 'underline', textUnderlineOffset: 4, textDecorationColor: 'var(--color-border-hover)' }),
              }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, flexShrink: 0, background: s.color }} />
              <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{labelOf(s)}</span>
              <span className="figure text-xs" style={{ color: 'var(--color-text-muted)' }}>{s.weight.toFixed(1)}%</span>
              {showValue && (
                <span className="figure text-xs" style={{ color: 'var(--color-text-muted)', opacity: 0.7 }}>
                  {compactIfLarge(s.value, formatCurrency)}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
