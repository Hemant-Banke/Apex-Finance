import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { CHART_COLORS, compactIfLarge, formatCurrency } from '../../lib/utils';
import ShowMore from '../ui/ShowMore';
import HoldingLink from './HoldingLink';
import AllocationBar, { OTHER_TONE, CASH_TONE } from './AllocationBar';
import { STYLES } from '../../lib/portfolioStyle';

const CLASS_META = [
  ['equity',    'Equity',       CHART_COLORS[1]],
  ['debt',      'Fixed income', CHART_COLORS[2]],
  ['gold',      'Gold',         CHART_COLORS[0]],
  ['silver',    'Silver',       CHART_COLORS[6]],
  ['crypto',    'Crypto',       CHART_COLORS[3]],
  ['commodity', 'Commodities',  CHART_COLORS[4]],
  ['alt',       'Other assets', CHART_COLORS[5]],
  ['cash',      'Cash',         CASH_TONE],
];
const CAP_META = [
  ['large',   'Large cap',              CHART_COLORS[1]],
  ['mid',     'Mid cap',                CHART_COLORS[3]],
  ['small',   'Small cap',              CHART_COLORS[5]],
  ['flexi',   'Fund-managed (any cap)', CHART_COLORS[2]],
  ['global',  'Outside India',          CHART_COLORS[6]],
  ['unknown', 'Unclassified',           OTHER_TONE],
];


const toItems = (meta, values, total) => meta
  .filter(([k]) => values[k] > 0)
  .map(([key, name, color]) => ({ key, name, color, value: values[key], weight: (values[key] / total) * 100 }))
  .sort((a, b) => b.value - a.value);

const pct = (v, d = 0) => `${v.toFixed(d)}%`;
const age = (y) => (y < 1 ? `${Math.max(1, Math.round(y * 12))} mo` : `${y.toFixed(1)} yrs`);

function capTilt(caps) {
  const { large = 0, mid = 0, small = 0, flexi = 0 } = caps;
  const t = large + mid + small + flexi;
  if (!t) return null;
  if (flexi / t >= 0.5) return 'Mostly fund-managed equity';
  if (large / t >= 0.6) return 'Large-cap core';
  if ((mid + small) / t >= 0.6) return small >= mid ? 'Small-cap tilt' : 'Mid-cap tilt';
  return 'Spread across caps';
}

/**
 * The holdings counted in one slice of one bar, each with the amount it contributes and the
 * reason it was put there. Mirrors `portfolioProfileService`'s aggregation exactly, so the
 * rows add up to the slice.
 */
function membersOf({ bar, key }, profile, cash) {
  const rows = [];
  if (bar === 'class') {
    if (key === 'cash') return [{ symbol: 'cash', name: 'Cash', counted: cash, why: 'Uninvested balance in this account' }];
    for (const m of profile.members) {
      const f = m.cls[key] || 0;
      if (f > 0) rows.push({ ...m, counted: m.value * f, why: m.basis, part: f < 1 ? f : null });
    }
  } else if (bar === 'cap') {
    for (const m of profile.members) {
      const eq = m.cls.equity || 0;
      const slot = m.global ? { global: 1 } : (m.cap || { flexi: 1 });
      const f = eq * (slot[key] || 0);
      if (f > 0) rows.push({ ...m, counted: m.value * f, why: m.capBasis, part: f < 1 ? f : null });
    }
  } else {
    // The sector bar folds everything past the palette into "Other".
    const keys = key === 'other' ? new Set(profile.sectors.slice(CHART_COLORS.length - 1).map(s => s.key)) : new Set([key]);
    const label = Object.fromEntries(profile.sectors.map(s => [s.key, s.label]));
    for (const m of profile.members) {
      if (m.sector && keys.has(m.sector)) rows.push({ ...m, counted: m.value, why: `${label[m.sector]} · Nifty 500 industry` });
    }
  }
  return rows.sort((a, b) => b.counted - a.counted);
}

/**
 * The book described as a whole: a style verdict on a risk scale, the figures that define
 * it, and its make-up by asset class, market cap and (for direct stocks) sector.
 * `profile` comes from `GET /dashboard/portfolio`; `cash` joins the asset-class split.
 */
export default function PortfolioProfile({ profile, cash = 0 }) {
  // One open slice across all three bars: { bar, key, label, color }.
  const [picked, setPicked] = useState(null);
  useEffect(() => {
    if (!picked) return;
    const onKey = (e) => { if (e.key === 'Escape') setPicked(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [picked]);

  if (!profile?.total) return null;
  const pick = (bar, items) => (key) => {
    const it = items.find(i => i.key === key);
    setPicked(p => (p?.bar === bar && p.key === key ? null : { bar, key, label: it?.name || 'Other', color: it?.color || OTHER_TONE }));
  };
  const pickedOn = (bar) => (picked?.bar === bar ? picked.key : null);
  const drill = picked && profile.members && (
    <SliceDrill slice={picked} rows={membersOf(picked, profile, cash)} onClose={() => setPicked(null)} />
  );
  const classes = { ...profile.classes, ...(cash > 0 && { cash }) };
  const total = profile.total + Math.max(0, cash);
  const share = (k) => ((classes[k] || 0) / total) * 100;

  const growth = share('equity') + share('crypto');
  const style = STYLES.find(s => growth < s.max);
  const equity = classes.equity || 0;
  const globalShare = equity ? ((profile.regions.global || 0) / equity) * 100 : 0;
  const alts = share('gold') + share('silver') + share('crypto') + share('commodity');

  const traits = [
    capTilt(profile.caps),
    equity > 0 && (globalShare < 10 ? 'India-focused' : `${pct(globalShare)} of equity abroad`),
    share('debt') >= 10 && `${pct(share('debt'))} fixed income`,
    alts >= 10 && `${pct(alts)} in gold, crypto & commodities`,
    cash > 0 && share('cash') >= 10 && `${pct(share('cash'))} idle cash`,
  ].filter(Boolean);

  const sectorTotal = profile.sectors.reduce((s, x) => s + x.value, 0);
  const capTotal = Object.values(profile.caps).reduce((s, v) => s + v, 0);
  const classItems = toItems(CLASS_META, classes, total);
  const capItems = toItems(CAP_META, profile.caps, capTotal);
  const sectorItems = profile.sectors.map((s, i) => ({
    key: s.key, name: s.count > 1 ? `${s.label} (${s.count})` : s.label,
    value: s.value, weight: (s.value / sectorTotal) * 100,
    color: i < CHART_COLORS.length ? CHART_COLORS[i] : OTHER_TONE,
  }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
      {/* Verdict, then where it sits on the scale it was read from. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.3fr)', gap: 32, alignItems: 'center' }}>
        <div style={{ minWidth: 0 }}>
          <p className="col-head" style={{ marginBottom: 8 }}>Portfolio style</p>
          <p className="heading-lg" style={{ color: 'var(--color-text-primary)' }}>{style.label}</p>
          <p className="text-sm" style={{ color: 'var(--color-text-muted)', marginTop: 6, lineHeight: 1.5 }}>
            {traits.join(' · ')}
          </p>
        </div>
        <StyleScale growth={growth} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 18 }}>
        <Figure label="Growth assets" value={pct(growth, 1)} sub="equity + crypto"
          title="Share of the book in assets whose value is driven by markets rather than a contract." />
        {profile.yield != null && (
          <Figure label="Fixed-income yield" value={pct(profile.yield, 2)} sub={`on ${pct((profile.yieldBase / total) * 100)} of the book`}
            title="Value-weighted coupon / rate on FDs, bonds, EPF/NPS and other rate-bearing holdings." />
        )}
        <Figure label="In profit" value={`${profile.inProfit.count} of ${profile.n}`}
          sub={`${pct((profile.inProfit.value / profile.total) * 100)} of invested value`} />
        <Figure label="Liquid" value={pct(((profile.liquid + Math.max(0, cash)) / total) * 100)}
          sub="sellable on a market"
          title="Excludes FDs, EPF/NPS, bonds and self-valued assets, which cannot be sold same-day." />
        {profile.avgAgeYears != null && (
          <Figure label="Avg holding age" value={age(profile.avgAgeYears)} sub="weighted by value"
            title="Time since first purchase, weighted by each holding's current value." />
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 28 }}>
        <Composition title="Asset class" note={profile.hybrid ? 'Hybrid funds split by their category’s typical mix' : null}
          items={classItems} picked={pickedOn('class')} onPick={pick('class', classItems)} />
        {capTotal > 0 && (
          <Composition title="Equity by market cap" note="SEBI tiers: top 100 large, next 150 mid, rest small"
            items={capItems} picked={pickedOn('cap')} onPick={pick('cap', capItems)} />
        )}
      </div>
      {picked && picked.bar !== 'sector' && drill}

      {sectorItems.length > 0 && (
        <Composition title="Direct stocks by sector"
          note={`Nifty 500 classification · ${pct((sectorTotal / (equity || 1)) * 100)} of equity mapped (funds and smaller companies are not)`}
          items={sectorItems} picked={pickedOn('sector')} onPick={pick('sector', sectorItems)} />
      )}
      {picked?.bar === 'sector' && drill}
    </div>
  );
}

// Each style's band on the 0–100 scale, for placing its label at the band's middle.
const BANDS = STYLES.map((s, i) => ({ ...s, lo: i ? STYLES[i - 1].max : 0, hi: Math.min(100, s.max) }));

function StyleScale({ growth }) {
  const at = Math.min(100, Math.max(0, growth));
  return (
    <div title={`${growth.toFixed(1)}% in growth assets`}>
      <div style={{ position: 'relative', height: 8, borderRadius: 99, background: `linear-gradient(90deg, color-mix(in srgb, ${CHART_COLORS[6]} 55%, transparent), color-mix(in srgb, var(--color-accent) 70%, transparent), color-mix(in srgb, var(--color-chart-warm) 80%, transparent))` }}>
        {STYLES.slice(0, -1).map(s => (
          <span key={s.max} style={{ position: 'absolute', left: `${s.max}%`, top: -2, bottom: -2, width: 2, background: 'var(--color-bg-card)' }} />
        ))}
        <span style={{
          position: 'absolute', left: `${at}%`, top: '50%', width: 14, height: 14, borderRadius: '50%',
          transform: 'translate(-50%, -50%)', background: 'var(--color-text-primary)',
          boxShadow: '0 0 0 3px var(--color-bg-card), var(--shadow-sm)',
        }} />
      </div>
      <div style={{ position: 'relative', height: 16, marginTop: 10 }}>
        {BANDS.map(s => {
          const on = growth >= s.lo && growth < s.max;
          return (
            <span key={s.max} className="text-xs" style={{
              position: 'absolute', left: `${(s.lo + s.hi) / 2}%`, transform: 'translateX(-50%)', whiteSpace: 'nowrap',
              color: on ? 'var(--color-text-primary)' : 'var(--color-text-muted)', fontWeight: on ? 600 : 400,
            }}>{s.short}</span>
          );
        })}
      </div>
    </div>
  );
}

function Composition({ title, note, items, picked, onPick }) {
  if (!items.length) return null;
  return (
    <div style={{ minWidth: 0 }}>
      <p className="col-head" style={{ marginBottom: 12 }}>{title}</p>
      <AllocationBar items={items} height={10} picked={picked} onPick={onPick} />
      {note && <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 12, opacity: 0.8 }}>{note}</p>}
    </div>
  );
}

/** What one slice is made of — opened by clicking it, closed by ✕, Esc or clicking it again. */
function SliceDrill({ slice, rows, onClose }) {
  const total = rows.reduce((s, r) => s + r.counted, 0);
  return (
    <div className="animate-in" style={{
      borderRadius: 12, padding: '16px 18px 8px', background: 'var(--color-bg-primary)',
      border: '1px solid rgba(0, 0, 0, 0.35)',
      // Deep top shadow, softer sides, and a faint lit lower lip: a well cut into the card.
      boxShadow: 'inset 0 3px 8px rgba(0, 0, 0, 0.6), inset 0 1px 2px rgba(0, 0, 0, 0.5), inset 0 -1px 0 rgba(255, 255, 255, 0.04), 0 1px 0 rgba(255, 255, 255, 0.03)',
    }}>
      <div className="flex items-center justify-between" style={{ gap: 12, marginBottom: 8 }}>
        <p className="text-sm flex items-center" style={{ color: 'var(--color-text-primary)', fontWeight: 500, gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: slice.color, flexShrink: 0 }} />
          {slice.label}
          <span className="figure text-xs" style={{ color: 'var(--color-text-muted)', marginLeft: 2, fontWeight: 400 }}>
            {formatCurrency(total)} · {rows.length} holding{rows.length === 1 ? '' : 's'}
          </span>
        </p>
        <button type="button" onClick={onClose} aria-label="Close" title="Close (Esc)" className="btn-icon btn-icon-sm btn-icon-circle"
          style={{ width: 26, height: 26 }}>
          <X size={13} />
        </button>
      </div>

      <ShowMore items={rows} initial={6} noun="holdings" render={(r) => (
        <div key={r.symbol} className="flex items-baseline" style={{ gap: 12, padding: '6px 0', borderTop: '1px solid var(--color-border-subtle)' }}>
          <p className="text-sm truncate" style={{ flex: 1, minWidth: 0, color: 'var(--color-text-secondary)' }} title={r.why}>
            {r.type ? <HoldingLink h={r}>{r.name}</HoldingLink> : r.name}
            <span className="text-xs" style={{ color: 'var(--color-text-muted)', marginLeft: 10 }}>
              {r.part != null && <span className="figure">{Math.round(r.part * 100)}% of {compactIfLarge(r.value)} · </span>}
              {r.why}
            </span>
          </p>
          <span className="figure text-sm" style={{ flexShrink: 0, color: 'var(--color-text-primary)' }}>{compactIfLarge(r.counted)}</span>
          <span className="figure text-xs" style={{ flexShrink: 0, width: 44, textAlign: 'right', color: 'var(--color-text-muted)' }}>
            {total ? ((r.counted / total) * 100).toFixed(1) : '0.0'}%
          </span>
        </div>
      )} />
    </div>
  );
}

export function Figure({ label, value, sub, title }) {
  return (
    <div title={title} style={{ minWidth: 0, paddingLeft: 12, borderLeft: '1px solid var(--color-border-hover)' }}>
      <p className="col-head" style={{ marginBottom: 6 }}>{label}</p>
      <p className="figure" style={{ fontSize: '1.15rem', fontWeight: 500, color: 'var(--color-text-primary)' }}>{value}</p>
      <p className="text-xs truncate" style={{ color: 'var(--color-text-muted)', marginTop: 3 }}>{sub}</p>
    </div>
  );
}
