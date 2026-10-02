import { useState } from 'react';
import Card from '../ui/Card';
import Delta from '../ui/Delta';
import ShowMore from '../ui/ShowMore';
import Sparkline from '../ui/Sparkline';
import SectionHeader from '../ui/SectionHeader';
import AllocationBar, { OTHER_TONE } from '../portfolio/AllocationBar';
import { formatCurrency, compactIfLarge, CHART_COLORS, pctChange } from '../../lib/utils';

/**
 * Category totals as a ranked ledger: one stacked bar for the shape of the whole, then a
 * row per category with its trend, share and change on the window before. The tail folds
 * into a neutral "Other" so the rows always reconcile to the total.
 */
// Seven hues plus a neutral Other keeps the stacked bar inside the 8-colour palette.
const TOP_N = 7;
const keyOf = (r) => r._id ?? '__none__';

// `trend={false}` drops the sparkline column where the card is narrow.
export default function CategoryBreakdown({ title, rows, months, invert, emptyText, sub, onSelect, active, trend = true }) {
  const [hover, setHover] = useState(null);
  const total     = rows.reduce((s, r) => s + r.total, 0);
  const prevTotal = rows.reduce((s, r) => s + (r.prev || 0), 0);

  const tail = rows.slice(TOP_N);
  const shown = (tail.length > 1
    ? [...rows.slice(0, TOP_N), {
        _id:   '__other__',
        name:  `Other · ${tail.length} categories`,
        total: tail.reduce((s, r) => s + r.total, 0),
        prev:  tail.reduce((s, r) => s + (r.prev || 0), 0),
        count: tail.reduce((s, r) => s + r.count, 0),
        other: true,
      }]
    : rows
  ).map((r, i) => ({ ...r, color: r.other ? OTHER_TONE : CHART_COLORS[i % CHART_COLORS.length] }));

  const comparable = prevTotal > 0;
  const trends = trend && shown.some(r => r.series?.length > 1);
  const activeSet = new Set([].concat(active ?? []));
  const cols = `minmax(0, 1fr)${trends ? ' 76px' : ''} 92px${comparable ? ' 70px' : ''}`;

  return (
    <Card>
      <SectionHeader
        eyebrow={title}
        size="sm"
        sub={sub ?? (comparable
          ? `Last ${months} months, against the ${months} before`
          : `Over the last ${months} month${months === 1 ? '' : 's'}`)}
        style={{ marginBottom: 18 }}
        action={
          <div style={{ textAlign: 'right' }}>
            <p className="figure" style={{ fontSize: '1.05rem', color: 'var(--color-text-primary)', fontWeight: 500 }}>
              {compactIfLarge(Math.round(total))}
            </p>
            {comparable && (
              <div style={{ marginTop: 3 }}>
                <Delta value={total - prevTotal} pct={pctChange(total, prevTotal)} amount={false} invert={invert} />
              </div>
            )}
          </div>
        }
      />

      {shown.length ? (
        <>
          <div style={{ marginBottom: 14 }}>
            <AllocationBar
              items={shown.map(r => ({ key: keyOf(r), name: r.name, color: r.color, value: r.total, weight: total ? (r.total / total) * 100 : 0 }))}
              height={8} legend={false} active={hover} onActive={setHover} />
          </div>

          <ShowMore items={shown} initial={5} noun="categories"
            wrap={(body) => <div onMouseLeave={() => setHover(null)}>{body}</div>}
            render={(cat, i) => {
              const change = pctChange(cat.total, cat.prev || 0);
              const parts  = String(cat.name).split(' · ');
              const main   = cat.other ? cat.name : parts.at(-1);
              const group  = !cat.other && parts.length > 1 ? parts[0] : null;
              const dim    = hover != null && hover !== keyOf(cat);
              const clickable = onSelect && !cat.other;

              return (
                <div key={cat._id || `row-${i}`}
                  className={clickable ? 'category-row' : undefined}
                  data-active={activeSet.has(cat._id) ? 'true' : undefined}
                  onClick={clickable ? () => onSelect(cat) : undefined}
                  onMouseEnter={() => setHover(keyOf(cat))}
                  title={[
                    `${cat.count} transaction${cat.count === 1 ? '' : 's'}`,
                    comparable && `${formatCurrency(cat.prev || 0)} in the previous ${months} months`,
                  ].filter(Boolean).join(' · ')}
                  style={{
                    display: 'grid', gridTemplateColumns: cols, alignItems: 'center', columnGap: 14,
                    padding: clickable ? '10px 8px' : '10px 0', margin: clickable ? '0 -8px' : 0,
                    borderTop: '1px solid var(--color-border-subtle)',
                    opacity: dim ? 0.45 : 1, transition: 'opacity 0.18s ease',
                  }}>

                  <div className="flex items-center" style={{ gap: 11, minWidth: 0 }}>
                    <span style={{
                      width: 28, height: 28, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 14, background: `color-mix(in srgb, ${cat.color} 16%, transparent)`,
                      boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${cat.color} 35%, transparent)`,
                    }}>
                      {cat.emoji || <span style={{ width: 7, height: 7, borderRadius: 2, background: cat.color }} />}
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <p className="text-sm truncate" style={{ color: 'var(--color-text-secondary)' }}>{main}</p>
                      <p className="text-xs truncate" style={{ color: 'var(--color-text-muted)', marginTop: 2 }}>
                        {group && <>{group} · </>}
                        <span className="figure">{cat.count}</span> txn{cat.count === 1 ? '' : 's'}
                        {cat.count > 1 && <> · avg <span className="figure">{compactIfLarge(Math.round(cat.total / cat.count))}</span></>}
                      </p>
                    </div>
                  </div>

                  {trends && (
                    <div style={{ display: 'flex', justifyContent: 'center' }}>
                      <Sparkline values={cat.series} width={68} height={22} tone={cat.other ? 'var(--color-text-muted)' : cat.color}
                        title={`${main}, month by month`} />
                    </div>
                  )}

                  <div style={{ textAlign: 'right' }}>
                    <p className="figure text-sm" style={{ color: 'var(--color-text-primary)' }}>{compactIfLarge(Math.round(cat.total))}</p>
                    <p className="figure text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 2 }}>
                      {total ? ((cat.total / total) * 100).toFixed(1) : '0.0'}%
                    </p>
                  </div>

                  {comparable && (
                    <div style={{ textAlign: 'right' }}>
                      {change != null
                        ? <Delta value={cat.total - (cat.prev || 0)} pct={change} amount={false} invert={invert} />
                        : <span className="text-xs" style={{ color: 'var(--color-accent)' }}>new</span>}
                    </div>
                  )}
                </div>
              );
            }} />
        </>
      ) : (
        <div className="flex items-center justify-center" style={{ height: 160 }}>
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{emptyText}</p>
        </div>
      )}
    </Card>
  );
}
