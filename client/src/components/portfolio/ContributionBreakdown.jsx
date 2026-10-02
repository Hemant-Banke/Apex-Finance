import { useState, useEffect, useMemo } from 'react';
import { dashboardAPI } from '../../lib/api';
import { compactIfLarge, formatCurrency, formatPct, formatSigned, pnlColor } from '../../lib/utils';
import Card from '../ui/Card';
import SectionHeader from '../ui/SectionHeader';
import Spinner from '../ui/Spinner';
import ShowMore from '../ui/ShowMore';
import SegmentedControl from '../ui/SegmentedControl';
import AssetIcon from '../market/AssetIcon';
import HoldingLink from './HoldingLink';

/**
 * What made the window's return: each holding's gain over the whole book's committed
 * capital, in percentage points that sum exactly to the total. Split into what added and
 * what took away, because those are opposite in kind.
 */

// Keys are the day counts the endpoint takes (0 = all time).
const WINDOWS = [
  { key: '30',  label: '1M'  },
  { key: '182', label: '6M'  },
  { key: '365', label: '1Y'  },
  { key: '0',   label: 'All' },
];
const COLS = 'minmax(0, 1.5fr) minmax(90px, 1fr) 76px 96px';

const money = (v) => formatSigned(Math.round(v || 0), compactIfLarge);
const pp = (v) => (v == null ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)} pp`);

function Row({ r, maxPp }) {
  const tone = pnlColor(r.gain);
  const width = maxPp ? (Math.abs(r.contributionPp || 0) / maxPp) * 100 : 0;
  return (
    <div title={`${formatCurrency(r.gain)} on ${formatCurrency(r.rowBase || 0)} of its own capital`}
      style={{ display: 'grid', gridTemplateColumns: COLS, alignItems: 'center', columnGap: 16, padding: '10px 0', borderTop: '1px solid var(--color-border-subtle)' }}>
      <div className="flex items-center" style={{ gap: 11, minWidth: 0 }}>
        <AssetIcon symbol={r.symbol} name={r.name} type={r.type} size={26} />
        <div style={{ minWidth: 0 }}>
          <p className="text-sm truncate" style={{ color: 'var(--color-text-secondary)' }}><HoldingLink h={r}>{r.name}</HoldingLink></p>
          <p className="text-xs truncate" style={{ color: 'var(--color-text-muted)', marginTop: 2 }}>
            {r.returnPct == null ? 'no capital base' : <><span className="figure" style={{ color: tone }}>{formatPct(r.returnPct, 1)}</span> on its own capital</>}
            {r.capital > 0 ? '' : ' · closed'}
            {!r.quoted && ' · at cost'}
          </p>
        </div>
      </div>
      <div style={{ height: 6, borderRadius: 99, background: 'var(--color-bg-elevated)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.max(width, 1.5)}%`, borderRadius: 99, background: `color-mix(in srgb, ${tone} 70%, #0B0D10)` }} />
      </div>
      <span className="figure text-sm" style={{ textAlign: 'right', fontWeight: 500, color: tone }}>{pp(r.contributionPp)}</span>
      <span className="figure text-sm" style={{ textAlign: 'right', color: 'var(--color-text-primary)' }}>{money(r.gain)}</span>
    </div>
  );
}

function Group({ title, rows, maxPp }) {
  if (!rows.length) return null;
  const gain = rows.reduce((s, r) => s + r.gain, 0);
  const pts  = rows.reduce((s, r) => s + (r.contributionPp || 0), 0);
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: COLS, columnGap: 16, alignItems: 'baseline', paddingBottom: 8 }}>
        <span className="col-head">{title} <span style={{ opacity: 0.7 }}>· {rows.length}</span></span>
        <span />
        <span className="figure text-xs" style={{ textAlign: 'right', color: pnlColor(gain) }}>{pp(pts)}</span>
        <span className="figure text-xs" style={{ textAlign: 'right', color: 'var(--color-text-muted)' }}>{money(gain)}</span>
      </div>
      <ShowMore items={rows} initial={5} noun="holdings" render={(r) => <Row key={r.symbol} r={r} maxPp={maxPp} />} />
    </div>
  );
}

// `account` scopes it to one account; `bare` drops the card when it sits inside another.
export default function ContributionBreakdown({ account, bare = false }) {
  const [days,    setDays]    = useState(365);
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    dashboardAPI.getContribution(days, account)
      .then(r => { if (!cancelled) setData(r.data); })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [days, account]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const { added, taken, maxPp } = useMemo(() => {
    const rows = (data?.rows || []).filter(r => Math.abs(r.gain) >= 0.5);
    return {
      added: rows.filter(r => r.gain >= 0).sort((a, b) => b.gain - a.gain),
      taken: rows.filter(r => r.gain < 0).sort((a, b) => a.gain - b.gain),
      maxPp: rows.reduce((m, r) => Math.max(m, Math.abs(r.contributionPp || 0)), 0),
    };
  }, [data]);

  const t = data?.totals || {};
  const label = WINDOWS.find(w => w.key === String(days))?.label;
  const Wrap = bare ? 'div' : Card;
  const empty = !added.length && !taken.length;

  return (
    <Wrap>
      <SectionHeader
        eyebrow="Contribution"
        size="sm"
        sub="What each holding added to the return — the points sum to the total"
        style={{ marginBottom: 20 }}
        action={<SegmentedControl options={WINDOWS} value={String(days)} onChange={k => setDays(Number(k))} ariaLabel="Window" />}
      />

      {loading ? <Spinner height={200} /> : empty ? (
        <div className="flex items-center justify-center" style={{ height: 160 }}>
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Nothing held or traded in this window</p>
        </div>
      ) : (
        <>
          {/* The answer first: what the window returned, and how it splits. */}
          <div className="flex items-end" style={{ gap: 32, flexWrap: 'wrap', marginBottom: 24 }}>
            <div>
              <p className="col-head" style={{ marginBottom: 6 }}>{label === 'All' ? 'All-time return' : `Return · ${label}`}</p>
              <p className="figure" style={{ fontSize: '1.5rem', fontWeight: 500, color: pnlColor(t.returnPct) }}>
                {t.returnPct == null ? '—' : formatPct(t.returnPct, 2)}
              </p>
            </div>
            <div style={{ paddingBottom: 3 }}>
              <p className="figure text-sm" style={{ color: pnlColor(t.gain) }}>{money(t.gain)}</p>
              <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 2 }}>
                on <span className="figure">{compactIfLarge(Math.round(t.capital || 0))}</span> committed
              </p>
            </div>
            <div style={{ paddingBottom: 3, marginLeft: 'auto', textAlign: 'right' }}>
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                <span className="figure" style={{ color: 'var(--color-success)' }}>{money(added.reduce((s, r) => s + r.gain, 0))}</span> added by {added.length}
              </p>
              <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 3 }}>
                <span className="figure" style={{ color: 'var(--color-danger)' }}>{money(taken.reduce((s, r) => s + r.gain, 0))}</span> taken by {taken.length}
              </p>
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: 560, display: 'flex', flexDirection: 'column', gap: 22 }}>
              <Group title="Added" rows={added} maxPp={maxPp} />
              <Group title="Took away" rows={taken} maxPp={maxPp} />

              {/* The reconciliation: every row above adds up to this. */}
              <div style={{ display: 'grid', gridTemplateColumns: COLS, columnGap: 16, alignItems: 'center', paddingTop: 12, borderTop: '1px solid var(--color-accent-dim)' }}>
                <span className="text-sm" style={{ color: 'var(--color-accent)' }}>Total</span>
                <span />
                <span className="figure text-sm" style={{ textAlign: 'right', fontWeight: 500, color: pnlColor(t.returnPct) }}>
                  {t.returnPct == null ? '—' : pp(t.returnPct)}
                </span>
                <span className="figure text-sm" style={{ textAlign: 'right', fontWeight: 500, color: pnlColor(t.gain) }}>{money(t.gain)}</span>
              </div>
            </div>
          </div>
        </>
      )}
    </Wrap>
  );
}
