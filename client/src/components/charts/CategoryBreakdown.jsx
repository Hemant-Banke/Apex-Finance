import Card from '../ui/Card';
import Delta from '../ui/Delta';
import ShowMore from '../ui/ShowMore';
import SectionHeader from '../ui/SectionHeader';
import { formatCurrency, compactIfLarge, CHART_COLORS, pctChange } from '../../lib/utils';

/**
 * Category totals as a ranked list, each against what it was last time.
 *
 * One component for both directions — where the money goes and where it comes from are
 * the same question asked twice, and two hand-built lists would have drifted the moment
 * either was touched. Bars are scaled to the LARGEST row, not to the total: this is a
 * ranking, and scaling to the total leaves every bar a stub when the spend is spread
 * across a dozen categories.
 *
 * Two things it was missing, both of which made it a list of facts rather than an
 * analysis:
 *
 * **A category total says how big, never which way.** "₹42,000 on eating out" is not
 * something you can act on; "₹42,000, up 38% on the six months before" is. Every row now
 * carries that change, and so does the card's own total. It sits on the BAR's line, not
 * the name's, so the row stays two lines deep and the ranking keeps the top line to
 * itself. `invert` on the expense card colours a rise red — the arrow states the
 * direction either way, the colour states whether it is good news (see `Delta`).
 *
 * **The tail was dropped silently.** The list showed the top eight while the percentages
 * were of the FULL total, so the visible rows added up to 71% and nothing said where the
 * rest went. The remainder now folds into one "Other" row — the same rule `AllocationBar`
 * and the account page's rail follow — which takes a neutral tone rather than a ninth
 * hue that is not really its own, and the column reconciles to 100% again.
 */
const TOP_N = 8;

export default function CategoryBreakdown({ title, rows, months, invert, emptyText, sub, onSelect, active }) {
  // The denominator is the rows' OWN sum, so the percentages in the column are
  // guaranteed to reconcile to the column — not to a total aggregated elsewhere that
  // agrees only as long as two queries stay in step.
  const total     = rows.reduce((s, r) => s + r.total, 0);
  const prevTotal = rows.reduce((s, r) => s + (r.prev || 0), 0);

  const tail = rows.slice(TOP_N);
  const shown = tail.length
    ? [...rows.slice(0, TOP_N), {
        _id:   '__other__',
        name:  `Other · ${tail.length} categor${tail.length === 1 ? 'y' : 'ies'}`,
        total: tail.reduce((s, r) => s + r.total, 0),
        prev:  tail.reduce((s, r) => s + (r.prev || 0), 0),
        count: tail.reduce((s, r) => s + r.count, 0),
        other: true,
      }]
    : rows;

  // The longest bar, not the first row's — a long tail can sum to more than the leader.
  const max = shown.reduce((m, r) => Math.max(m, r.total), 0);
  // With no previous window there is nothing to compare against, and a column of "new"
  // chips on a first-ever month is noise dressed as a finding.
  const comparable = prevTotal > 0;

  return (
    <Card>
      <SectionHeader
        eyebrow={title}
        size="sm"
        sub={sub ?? (comparable
          ? `Last ${months} months, against the ${months} before`
          : `Over the last ${months} months`)}
        style={{ marginBottom: 22 }}
        action={
          <div style={{ textAlign: 'right' }}>
            <p className="figure text-sm" style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>
              {compactIfLarge(total)}
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
        // The five largest open; the tail — and the "Other" row folding the rest of
        // it — sits behind the toggle. The card's own total above still covers it all.
        <ShowMore items={shown} initial={5} noun="categories"
          wrap={(body) => <div style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>{body}</div>}
          render={(cat, i) => {
            const change = pctChange(cat.total, cat.prev || 0);
            const avg    = cat.count ? cat.total / cat.count : 0;

            return (
              <div key={cat._id || `row-${i}`}
                className={onSelect && !cat.other ? 'category-row' : undefined}
                data-active={[].concat(active ?? []).includes(cat._id) ? 'true' : undefined}
                onClick={onSelect && !cat.other ? () => onSelect(cat) : undefined}
                title={[
                  `${cat.count} transaction${cat.count === 1 ? '' : 's'}`,
                  `${formatCurrency(avg)} average`,
                  comparable && `${formatCurrency(cat.prev || 0)} in the previous ${months} months`,
                ].filter(Boolean).join(' · ')}>

                <div className="flex items-center justify-between" style={{ marginBottom: 7, gap: 12 }}>
                  <span className="text-sm" style={{ color: 'var(--color-text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                    {cat.emoji && <span>{cat.emoji}</span>}
                    <span className="truncate">{cat.name}</span>
                    <span className="figure text-xs" style={{ color: 'var(--color-text-muted)', flexShrink: 0 }}>
                      ×{cat.count}
                    </span>
                  </span>
                  <span className="figure text-sm" style={{ color: 'var(--color-text-primary)', flexShrink: 0 }}>
                    {formatCurrency(cat.total)}
                    <span style={{ color: 'var(--color-text-muted)', marginLeft: 8 }}>
                      {total ? ((cat.total / total) * 100).toFixed(0) : 0}%
                    </span>
                  </span>
                </div>

                {/* The bar and its trend share a line: the bar says how this row ranks
                    NOW, the chip says how it got here. */}
                <div className="flex items-center" style={{ gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0, height: 4, borderRadius: 99, background: 'var(--color-bg-elevated)', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', borderRadius: 99,
                      width: `${max ? (cat.total / max) * 100 : 0}%`,
                      // Past the palette the tail is one "Other" — it takes a neutral
                      // tone rather than a ninth hue that belongs to nothing.
                      background: cat.other ? 'var(--color-text-muted)' : CHART_COLORS[i % CHART_COLORS.length],
                      opacity: cat.other ? 0.45 : 1,
                    }} />
                  </div>
                  {comparable && (
                    <span style={{ flexShrink: 0 }}>
                      {change != null
                        ? <Delta value={cat.total - (cat.prev || 0)} pct={change} amount={false} invert={invert} />
                        // No base to measure from — it did not exist last time, which is
                        // a fact about the category, not a percentage.
                        : <span className="text-xs" style={{ color: 'var(--color-accent)' }}>new</span>}
                    </span>
                  )}
                </div>
              </div>
            );
          }} />
      ) : (
        <div className="flex items-center justify-center" style={{ height: 160 }}>
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{emptyText}</p>
        </div>
      )}
    </Card>
  );
}

