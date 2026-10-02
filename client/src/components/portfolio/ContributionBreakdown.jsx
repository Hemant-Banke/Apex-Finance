import { useState, useEffect, useMemo } from 'react';
import { dashboardAPI } from '../../lib/api';
import { compactIfLarge, formatCurrency, formatPct, pnlColor } from '../../lib/utils';
import Card from '../ui/Card';
import SectionHeader from '../ui/SectionHeader';
import Spinner from '../ui/Spinner';
import ShowMore from '../ui/ShowMore';
import SegmentedControl from '../ui/SegmentedControl';
import DivergingBar from '../ui/DivergingBar';
import AssetIcon from '../market/AssetIcon';
import HoldingLink from './HoldingLink';

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

// Keys are the day counts the endpoint takes (0 = all time), as strings for the picker.
const WINDOWS = [
  { key: '30',  label: '1M'  },
  { key: '182', label: '6M'  },
  { key: '365', label: '1Y'  },
  { key: '0',   label: 'All' },
];

const TOP_N   = 10;
const TRACK   = 132;   // px the diverging bar spans, zero at its centre
const PP_COL  = 84;
const RET_COL = 74;
const GAIN_COL = 100;
const GAP     = 14;


/** The column names, so four numeric columns are a table rather than a wall. */
function Head() {
  const cell = { textAlign: 'right', flexShrink: 0, whiteSpace: 'nowrap' };
  return (
    <div className="flex items-center" style={{ gap: GAP, paddingBottom: 10, borderBottom: '1px solid var(--color-border-subtle)' }}>
      <span style={{ width: 26, flexShrink: 0 }} />
      <span className="col-head" style={{ flex: 1, minWidth: 0 }}>Holding</span>
      <span className="col-head" style={{ ...cell, width: GAIN_COL }}>Gain</span>
      <span className="col-head" style={{ ...cell, width: RET_COL }}>Return</span>
      <span className="col-head" style={{ ...cell, width: TRACK + GAP + PP_COL }}>Contribution</span>
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
        action={<SegmentedControl options={WINDOWS} value={String(days)} onChange={k => setDays(Number(k))} ariaLabel="Window" />}
      />

      {loading ? <Spinner height={200} /> : !rows.length ? (
        <div className="flex items-center justify-center" style={{ height: 180 }}>
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            Nothing held or traded in this window
          </p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 620 }}>
            <Head />

            {/* Ranked by signed gain, so the biggest contributors AND the worst
                detractors stay open — the middle, the holdings that barely moved the
                total, folds. The Total line still reconciles to every row, shown or not. */}
            <ShowMore items={rows} ends initial={6} noun="holdings"
              render={(r) => {
              const pos  = (r.contributionPp || 0) >= 0;

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
                    <p className="text-sm truncate" style={{ color: 'var(--color-text-secondary)' }}>{r.rest ? r.name : <HoldingLink h={r}>{r.name}</HoldingLink>}</p>
                    {/* A price that fell back to book cost is not a market opinion, and
                        the row says so where it happened rather than in a footnote
                        about holdings the reader then has to go and identify. */}
                    {!r.quoted && !r.rest && (
                      <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 2 }}>at cost</p>
                    )}
                  </div>

                  <span className="figure text-sm" style={{ width: GAIN_COL, textAlign: 'right', flexShrink: 0, whiteSpace: 'nowrap', color: pnlColor(r.gain) }}>
                    {compactIfLarge(r.gain)}
                  </span>

                  <span className="figure text-xs" style={{ width: RET_COL, textAlign: 'right', flexShrink: 0, whiteSpace: 'nowrap', color: r.returnPct == null ? 'var(--color-text-muted)' : pnlColor(r.returnPct) }}>
                    {r.returnPct == null ? '—' : formatPct(r.returnPct, 1)}
                  </span>

                  <div style={{ width: TRACK, flexShrink: 0 }}>
                    <DivergingBar value={r.contributionPp || 0} max={maxPp} height={7} muted={r.rest} />
                  </div>

                  <span className="figure text-sm" style={{ width: PP_COL, textAlign: 'right', flexShrink: 0, whiteSpace: 'nowrap', fontWeight: 500, color: pnlColor(r.contributionPp) }}>
                    {r.contributionPp == null ? '—' : `${pos ? '+' : '−'}${Math.abs(r.contributionPp).toFixed(2)} pp`}
                  </span>
                </div>
              );
              }} />
            {/* The reconciliation: the rows above add up to exactly this. Without it
                they are a list of plausible-looking numbers. It sits AFTER the fold
                toggle — a "show all" beneath the total read as a row of the table. */}
            <div className="flex items-center"
              style={{ gap: GAP, padding: '13px 0 0', marginTop: 8, borderTop: '1px solid var(--color-accent-dim)' }}>
              <span style={{ width: 26, flexShrink: 0 }} />
              <span className="text-sm" style={{ flex: 1, minWidth: 0, color: 'var(--color-accent)' }}>Total</span>
              <span className="figure text-sm" style={{ width: GAIN_COL, textAlign: 'right', flexShrink: 0, whiteSpace: 'nowrap', fontWeight: 500, color: pnlColor(totals.gain) }}>
                {compactIfLarge(totals.gain || 0)}
              </span>
              <span style={{ width: RET_COL, flexShrink: 0 }} />
              <span className="figure text-sm" style={{ width: TRACK + GAP + PP_COL, textAlign: 'right', flexShrink: 0, whiteSpace: 'nowrap', fontWeight: 500, color: pnlColor(totals.returnPct) }}>
                {totals.returnPct == null ? '—' : formatPct(totals.returnPct, 2)}
              </span>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
