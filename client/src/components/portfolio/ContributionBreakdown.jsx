import { useState, useEffect, useMemo } from 'react';
import { dashboardAPI } from '../../lib/api';
import { compactIfLarge, formatCurrency, formatPct, pnlColor } from '../../lib/utils';
import Card from '../ui/Card';
import SectionHeader from '../ui/SectionHeader';
import Spinner from '../ui/Spinner';
import AssetIcon from '../market/AssetIcon';

/**
 * What actually made the money — and what took it away.
 *
 * A return is not an explanation: a 90% gain on 2% of the book moved the total by 1.8
 * points, while a 12% gain on half of it moved six. Read down a column of returns and
 * the eye ranks them exactly backwards.
 *
 * CONTRIBUTION is the figure that composes. Each holding's gain measured against the
 * WHOLE book's committed capital is its share of the total in percentage POINTS,
 * and those points sum, exactly, to the return printed on the total line. So this is not
 * a ranking of opinions about what did well; it is the headline taken apart, and it
 * reconciles. The two columns sit side by side because the gap between them IS the
 * insight — a stellar percentage next to the 1.8 points it actually moved.
 *
 * **Return** is that holding's gain over the capital IT used; **Contribution** is the same
 * gain over the whole book's. Same numerator, different denominator, and the gap between
 * them is the pair's point.
 *
 * On an all-time window with nothing sold this lands on the same base as the masthead's
 * unrealised P&L %, so the two agree. They part company once something HAS been sold —
 * realised gains are in this numerator and not in that one — which is a difference in what
 * is being asked, not a discrepancy.
 *
 * Drawn as a diverging bar from a shared zero, because the data diverges: what added and
 * what took away are opposite in kind, not merely far apart in magnitude, and a ranked
 * list growing from one edge makes the worst detractor look like the smallest
 * contributor.
 *
 * **The window is the whole point of the server call.** `/dashboard/portfolio` reads the
 * AVCO cost basis, which carries no date, so every figure derived from it is lifetime by
 * construction — it can only ever answer "since you bought it". A window has to be
 * valued at both ends with the money moved in between taken out, or a ₹2L purchase made
 * last month reads as ₹2L of profit. That is `getContribution`, and it is also why a
 * position CLOSED inside the window still appears here: the profit is counted where it
 * happened. "All" therefore includes realised gains, which the lifetime unrealised view
 * never could.
 */

const WINDOWS = [
  { label: '1M',  days: 30   },
  { label: '6M',  days: 182  },
  { label: '1Y',  days: 365  },
  { label: 'All', days: 0    },
];

const TOP_N   = 10;
const TRACK   = 132;   // px the diverging bar spans, zero at its centre
const HALF    = TRACK / 2;
const PP_COL  = 78;
const RET_COL = 66;
const GAIN_COL = 84;
const GAP     = 14;

function WindowPicker({ days, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {WINDOWS.map(w => (
        <button key={w.label} onClick={() => onChange(w.days)}
          className="text-xs font-medium"
          style={{
            padding: '5px 11px', borderRadius: 7, cursor: 'pointer',
            border: '1px solid ' + (days === w.days ? 'var(--color-accent-dim)' : 'var(--color-border-subtle)'),
            background: days === w.days ? 'var(--color-accent-dim)' : 'transparent',
            color: days === w.days ? 'var(--color-accent)' : 'var(--color-text-muted)',
          }}>
          {w.label}
        </button>
      ))}
    </div>
  );
}

/** The column names, so four numeric columns are a table rather than a wall. */
function Head() {
  const cell = { fontSize: '0.625rem', letterSpacing: '0.1em', textAlign: 'right', flexShrink: 0 };
  return (
    <div className="flex items-center" style={{ gap: GAP, paddingBottom: 10, borderBottom: '1px solid var(--color-border-subtle)' }}>
      <span style={{ width: 26, flexShrink: 0 }} />
      <span className="heading-sm" style={{ flex: 1, minWidth: 0, fontSize: '0.625rem', letterSpacing: '0.1em' }}>Holding</span>
      <span className="heading-sm" style={{ ...cell, width: GAIN_COL }}>Gain</span>
      <span className="heading-sm" style={{ ...cell, width: RET_COL }}>Return</span>
      <span className="heading-sm" style={{ ...cell, width: TRACK + GAP + PP_COL }}>Contribution</span>
    </div>
  );
}

export default function ContributionBreakdown() {
  const [days,    setDays]    = useState(365);
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);

  // A data-fetching effect that owns its own loading/data state, so the synchronous
  // reset here is intentional — same shape as PriceGrapher's and MarketSearch's.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    dashboardAPI.getContribution(days)
      .then(r => { if (!cancelled) setData(r.data); })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [days]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const rows = useMemo(() => {
    const all = data?.rows || [];
    if (!all.length) return [];

    // Rank by SIZE of effect to decide what earns a row, so the fold takes the holdings
    // that barely moved the total — from either direction — where dropping the tail of
    // a signed sort would quietly hide every loser.
    const byImpact = [...all].sort((a, b) => Math.abs(b.gain) - Math.abs(a.gain));
    const tail     = byImpact.slice(TOP_N);
    const shown    = byImpact.slice(0, TOP_N);

    if (tail.length) {
      shown.push({
        symbol: '__rest__',
        name:   `${tail.length} smaller holding${tail.length === 1 ? '' : 's'}`,
        gain:   tail.reduce((s, r) => s + r.gain, 0),
        contributionPp: tail.reduce((s, r) => s + (r.contributionPp || 0), 0),
        returnPct: null,
        quoted: true,
        rest:   true,
      });
    }
    return shown.sort((a, b) => b.gain - a.gain);
  }, [data]);

  const totals = data?.totals || {};
  const maxPp  = rows.reduce((m, r) => Math.max(m, Math.abs(r.contributionPp || 0)), 0) || 1;

  return (
    <Card>
      <SectionHeader
        eyebrow="Contribution"
        size="sm"
        style={{ marginBottom: 18 }}
        action={<WindowPicker days={days} onChange={setDays} />}
      />

      {loading ? <Spinner height={200} /> : !rows.length ? (
        <div className="flex items-center justify-center" style={{ height: 180 }}>
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            Nothing held or traded in this window
          </p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 560 }}>
            <Head />

            {rows.map(r => {
              const pos  = (r.contributionPp || 0) >= 0;
              const w    = Math.max(2, (Math.abs(r.contributionPp || 0) / maxPp) * HALF);

              return (
                <div key={r.symbol} className="flex items-center"
                  style={{ gap: GAP, padding: '10px 0', borderBottom: '1px solid var(--color-border-subtle)' }}
                  title={r.rest ? undefined
                    : `${formatCurrency(r.gain)} on ${formatCurrency(r.rowBase || 0)} of capital`
                      + (r.capital > 0 ? '' : ' · position closed in this window')}>

                  {r.rest
                    ? <span style={{ width: 26, flexShrink: 0 }} />
                    : <AssetIcon symbol={r.symbol} name={r.name} type={r.type} size={26} />}

                  <div style={{ minWidth: 0, flex: 1 }}>
                    <p className="text-sm truncate" style={{ color: 'var(--color-text-secondary)' }}>{r.name}</p>
                    {/* A price that fell back to book cost is not a market opinion, and
                        the row says so where it happened rather than in a footnote
                        about holdings the reader then has to go and identify. */}
                    {!r.quoted && !r.rest && (
                      <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 2 }}>at cost</p>
                    )}
                  </div>

                  <span className="figure text-sm" style={{ width: GAIN_COL, textAlign: 'right', flexShrink: 0, color: pnlColor(r.gain) }}>
                    {compactIfLarge(r.gain)}
                  </span>

                  <span className="figure text-xs" style={{ width: RET_COL, textAlign: 'right', flexShrink: 0, color: r.returnPct == null ? 'var(--color-text-muted)' : pnlColor(r.returnPct) }}>
                    {r.returnPct == null ? '—' : formatPct(r.returnPct, 1)}
                  </span>

                  <div style={{ position: 'relative', width: TRACK, height: 7, flexShrink: 0 }}>
                    <span style={{ position: 'absolute', left: HALF, top: -3, bottom: -3, width: 1, background: 'var(--color-border)' }} />
                    <span style={{
                      position: 'absolute', top: 0, height: 7, width: w, borderRadius: 2,
                      ...(pos ? { left: HALF } : { left: HALF - w }),
                      background: pos ? 'var(--color-success)' : 'var(--color-danger)',
                      opacity: r.rest ? 0.45 : 0.85,
                    }} />
                  </div>

                  <span className="figure text-sm" style={{ width: PP_COL, textAlign: 'right', flexShrink: 0, fontWeight: 500, color: pnlColor(r.contributionPp) }}>
                    {r.contributionPp == null ? '—' : `${pos ? '+' : '−'}${Math.abs(r.contributionPp).toFixed(2)} pp`}
                  </span>
                </div>
              );
            })}

            {/* The reconciliation: the rows above add up to exactly this. Without it
                they are a list of plausible-looking numbers. */}
            <div className="flex items-center"
              style={{ gap: GAP, padding: '13px 0 0', marginTop: 2, borderTop: '1px solid var(--color-accent-dim)' }}>
              <span style={{ width: 26, flexShrink: 0 }} />
              <span className="text-sm" style={{ flex: 1, minWidth: 0, color: 'var(--color-accent)' }}>Total</span>
              <span className="figure text-sm" style={{ width: GAIN_COL, textAlign: 'right', flexShrink: 0, fontWeight: 500, color: pnlColor(totals.gain) }}>
                {compactIfLarge(totals.gain || 0)}
              </span>
              <span style={{ width: RET_COL, flexShrink: 0 }} />
              <span className="figure text-sm" style={{ width: TRACK + GAP + PP_COL, textAlign: 'right', flexShrink: 0, fontWeight: 500, color: pnlColor(totals.returnPct) }}>
                {totals.returnPct == null ? '—' : formatPct(totals.returnPct, 2)}
              </span>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
