import { useEffect, useState } from 'react';
import Card from '../ui/Card';
import SectionHeader from '../ui/SectionHeader';
import SegmentedControl from '../ui/SegmentedControl';
import Spinner from '../ui/Spinner';
import Delta from '../ui/Delta';
import ShowMore from '../ui/ShowMore';
import AllocationBar, { OTHER_TONE } from '../portfolio/AllocationBar';
import { CHART_COLORS, formatCrore, formatCompactNative, fiscalYear, pctChange } from '../../lib/utils';
import { marketsAPI } from '../../lib/api';

/**
 * Where the company's money comes from and how it trades with the world — read from its
 * own annual reports (10-Ks abroad) by `businessService`. A report never read before takes
 * ~30s, so this loads apart from the page and says what it is doing meanwhile.
 *
 * Shape: four answers in a recessed band (biggest line, biggest market, exports, net
 * trade), then one view at a time — Revenue, Trade, Value chain — then what changed.
 * Every figure is the report's own, merged across the last three reports.
 */
export default function BusinessProfile({ symbol, global }) {
  // Held with the symbol it answers, so moving to another company never shows the last one's.
  const key = `${global ? 'g' : 'n'}:${symbol}`;
  const [loaded, setLoaded] = useState({ key: null, data: null });
  const [tab, setTab] = useState(null);
  const data = loaded.key === key ? loaded.data : null;

  useEffect(() => {
    let live = true;
    marketsAPI.business(symbol, global)
      .then(r => live && setLoaded({ key, data: r.data }))
      .catch(() => live && setLoaded({ key, data: { available: false, reason: 'failed' } }));
    return () => { live = false; };
  }, [symbol, global, key]);

  if (!data) {
    return (
      <Card>
        <SectionHeader eyebrow="The business" size="sm" style={{ marginBottom: 6 }} />
        <Spinner height={180} label="Reading the annual reports…" />
      </Card>
    );
  }
  if (!data.available) return null;

  const home = data.unit === 'crore';
  const fmt = home ? (v) => formatCrore(v) : (v) => formatCompactNative(v * 1e6, data.currency);
  const fy = (iso) => (home ? fiscalYear(iso) : `FY${iso.slice(2, 4)}`);
  const latestFy = fy(data.reports[0].fiscalYearEnd);
  const span = `${fy(data.reports.at(-1).fiscalYearEnd)}–${latestFy}`;

  const business = data.business?.rows?.length ? data.business : null;
  const splits = [
    business && { key: 'business', label: business.by === 'product' ? 'By product' : 'By business', rows: business.rows },
    data.geography.length > 0 && { key: 'geography', label: 'By geography', rows: data.geography },
  ].filter(Boolean);
  const trade = data.trade.filter(r => r.forexEarnings != null || r.importsCif != null || r.exportShare != null);
  const { materials, customers, suppliers } = data;
  const hasChain = materials.length > 0 || customers?.summary || customers?.types || customers?.named?.length
    || suppliers?.summary || suppliers?.named?.length;

  const tabs = [
    (splits.length || data.products.length) && { key: 'revenue', label: 'Revenue' },
    trade.length && { key: 'trade', label: 'Trade' },
    hasChain && { key: 'chain', label: 'Value chain' },
  ].filter(Boolean);
  const view = tabs.some(t => t.key === tab) ? tab : tabs[0]?.key;

  return (
    <Card>
      <SectionHeader eyebrow="The business" size="sm"
        sub={`From the annual reports, ${span}${data.basis ? ` · ${data.basis}` : ''} · ${home ? '₹ crore' : `${data.currency} millions`}`}
        action={tabs.length > 1 ? <SegmentedControl ariaLabel="View" value={view} onChange={setTab} options={tabs} /> : null}
        style={{ marginBottom: 18 }} />

      <Glance splits={splits} trade={trade} fmt={fmt} fy={fy} />

      <div style={{ marginTop: 26 }}>
        {view === 'revenue' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
            {splits.length > 0 && <Revenue splits={splits} years={data.years} fmt={fmt} fy={fy} />}
            {!business && data.products.length > 0 && <Shares rows={data.products} />}
          </div>
        )}
        {view === 'trade' && <Trade rows={trade} fmt={fmt} fy={fy} />}
        {view === 'chain' && <Chain materials={materials} customers={customers} suppliers={suppliers} />}
      </div>

      {data.highlights.length > 0 && (
        <div style={{ marginTop: 28, paddingTop: 22, borderTop: '1px solid var(--color-border-subtle)' }}>
          <p className="col-head" style={{ marginBottom: 12 }}>What changed in {latestFy}</p>
          <ul style={{ display: 'flex', flexDirection: 'column', gap: 9, paddingLeft: 18, listStyle: 'disc' }}>
            {data.highlights.map(h => (
              <li key={h} className="text-sm" style={{ color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>{h}</li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 22, lineHeight: 1.6 }}>
        Read by AI from {data.source === 'sec' ? 'the 10-K filings' : 'the annual reports filed with BSE'}:{' '}
        {data.reports.map((r, i) => (
          <span key={r.url}>{i ? ', ' : ''}<a href={r.url} target="_blank" rel="noreferrer" style={{ color: 'var(--color-text-secondary)', textDecoration: 'underline' }}>{fy(r.fiscalYearEnd)}</a></span>
        ))}. Check the report before relying on a figure.
      </p>
    </Card>
  );
}

const colorAt = (i) => (i < CHART_COLORS.length ? CHART_COLORS[i] : OTHER_TONE);

/** The latest year with figures for a set of rows. */
const latestYear = (rows) => rows.flatMap(r => Object.keys(r.revenue)).sort().at(-1);

/** The largest line of a split, as a share of that split's total, in its latest year. */
function leader(rows) {
  const y = latestYear(rows);
  const total = rows.reduce((s, r) => s + (r.revenue[y] ?? 0), 0);
  const top = rows.find(r => r.revenue[y] > 0);
  return top && total ? { name: top.name, share: (top.revenue[y] / total) * 100 } : null;
}

/** Four answers before any detail: the biggest line, the biggest market, how much is exported, which way trade nets. */
function Glance({ splits, trade, fmt, fy }) {
  const biz = splits.find(s => s.key === 'business');
  const geo = splits.find(s => s.key === 'geography');
  const lead = biz && leader(biz.rows);
  const market = geo && leader(geo.rows);
  const exp = trade.findLast(r => r.exportShare != null);
  const fx = trade.findLast(r => r.forexEarnings != null && r.forexOutgo != null);
  const net = fx ? fx.forexEarnings - fx.forexOutgo : null;

  const cells = [
    lead && { label: biz.label === 'By product' ? 'Largest product' : 'Largest business', value: lead.name, sub: `${lead.share.toFixed(0)}% of revenue` },
    market && { label: 'Largest market', value: market.name, sub: `${market.share.toFixed(0)}% of revenue` },
    exp && { label: `Exports · ${fy(exp.date)}`, value: `${exp.exportShare}%`, sub: 'of revenue', figure: true },
    net != null && {
      label: net >= 0 ? 'Net exporter' : 'Net importer', value: fmt(Math.abs(net)), figure: true,
      sub: `${net >= 0 ? 'more' : 'less'} foreign currency earned than spent · ${fy(fx.date)}`,
      tone: net >= 0 ? 'var(--color-success)' : 'var(--color-chart-warm)',
    },
  ].filter(Boolean);
  if (!cells.length) return null;

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 20,
      padding: '18px 20px', borderRadius: 'var(--radius-md, 10px)', background: 'var(--color-bg-secondary)',
      border: '1px solid var(--color-border-subtle)',
    }}>
      {cells.map(c => (
        <div key={c.label} style={{ minWidth: 0 }}>
          <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginBottom: 7 }}>{c.label}</p>
          <p className={c.figure ? 'figure' : 'text-sm'} title={c.value} style={{
            fontSize: c.figure ? '1.2rem' : undefined, fontWeight: 500, color: c.tone || 'var(--color-text-primary)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{c.value}</p>
          <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 4 }}>{c.sub}</p>
        </div>
      ))}
    </div>
  );
}

/**
 * One split at a time, full width: a bar per year (so a shift in the mix reads as bars
 * changing shape down the column), then the lines with their figures. Hovering a line
 * lights it in every year's bar.
 */
function Revenue({ splits, years: allYears, fmt, fy }) {
  const [pick, setPick] = useState(splits[0].key);
  const [hover, setHover] = useState(null);
  const split = splits.find(s => s.key === pick) || splits[0];
  const rows = split.rows;

  const years = allYears.filter(y => rows.some(r => r.revenue[y] != null)).slice(-4);
  const latest = years.at(-1), prev = years.at(-2);
  const totalOf = (y) => rows.reduce((s, r) => s + (r.revenue[y] ?? 0), 0);
  // A line keeps its colour in every year, taken from its rank in the latest one.
  const color = new Map(rows.map((r, i) => [r.name, colorAt(i)]));
  const barFor = (y) => {
    const total = totalOf(y);
    return rows.filter(r => r.revenue[y] > 0).map(r => ({
      key: r.name, name: r.name, value: r.revenue[y], weight: (r.revenue[y] / total) * 100, color: color.get(r.name),
    }));
  };

  const shown = years.slice(-3);
  const grid = `minmax(0, 1.8fr) ${shown.map(() => 'minmax(72px, 1fr)').join(' ')} 60px 84px`;

  return (
    <div>
      {splits.length > 1 && (
        <div style={{ marginBottom: 18 }}>
          <SegmentedControl ariaLabel="Split" size="sm" value={split.key} onChange={setPick}
            options={splits.map(s => ({ key: s.key, label: s.label }))} />
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 22 }}>
        {years.map(y => (
          <div key={y} style={{ display: 'grid', gridTemplateColumns: '48px minmax(0, 1fr) 84px', gap: 14, alignItems: 'center' }}>
            <span className="text-xs" style={{ color: y === latest ? 'var(--color-text-primary)' : 'var(--color-text-muted)' }}>{fy(y)}</span>
            <AllocationBar items={barFor(y)} showValue={false} legend={false} active={hover} onActive={setHover} muted={y !== latest} />
            <span className="figure text-xs" style={{ textAlign: 'right', color: 'var(--color-text-secondary)' }}>{fmt(totalOf(y))}</span>
          </div>
        ))}
      </div>

      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 520 }} onMouseLeave={() => setHover(null)}>
          <div style={{ display: 'grid', gridTemplateColumns: grid, gap: 12, paddingBottom: 8, borderBottom: '1px solid var(--color-border-subtle)' }}>
            <span className="col-head">{split.key === 'geography' ? 'Region' : 'Line'}</span>
            {shown.map(y => <span key={y} className="col-head" style={{ textAlign: 'right' }}>{fy(y)}</span>)}
            <span className="col-head" style={{ textAlign: 'right' }}>Share</span>
            <span className="col-head" style={{ textAlign: 'right' }}>YoY</span>
          </div>
          <ShowMore items={rows} initial={6} noun="lines" render={(r) => {
            const now = r.revenue[latest];
            const total = totalOf(latest);
            const yoy = now != null && r.revenue[prev] != null ? pctChange(now, r.revenue[prev]) : null;
            const dim = hover != null && hover !== r.name;
            return (
              <div key={r.name} onMouseEnter={() => setHover(r.name)} style={{
                display: 'grid', gridTemplateColumns: grid, gap: 12, padding: '10px 0', alignItems: 'baseline',
                borderBottom: '1px solid var(--color-border-subtle)', opacity: dim ? 0.45 : 1, transition: 'opacity 0.18s ease',
              }}>
                <span className="text-sm flex items-center gap-2" style={{ color: 'var(--color-text-primary)', minWidth: 0 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, flexShrink: 0, background: now > 0 ? color.get(r.name) : OTHER_TONE }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.name}>{r.name}</span>
                </span>
                {shown.map(y => (
                  <span key={y} className="figure text-xs" style={{ textAlign: 'right', color: y === latest ? 'var(--color-text-primary)' : 'var(--color-text-muted)' }}>
                    {r.revenue[y] != null ? fmt(r.revenue[y]) : '—'}
                  </span>
                ))}
                <span className="figure text-xs" style={{ textAlign: 'right', color: 'var(--color-text-secondary)' }}>
                  {now != null && total ? `${((now / total) * 100).toFixed(0)}%` : '—'}
                </span>
                <span style={{ textAlign: 'right' }}>{yoy != null ? <Delta value={yoy} pct={yoy} amount={false} /> : null}</span>
              </div>
            );
          }} />
        </div>
      </div>
    </div>
  );
}

/** A split stated only as shares (BRSR's products/services sold), when no revenue was printed. */
function Shares({ rows }) {
  const items = rows.map((r, i) => ({ key: r.name, name: `${r.name} · ${r.share}%`, value: r.share, weight: r.share, color: colorAt(i) }));
  return (
    <div>
      <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginBottom: 12 }}>Share of turnover by product, as filed — the report prints no revenue split</p>
      <AllocationBar items={items} showValue={false} />
    </div>
  );
}

/**
 * Foreign exchange earned against foreign exchange spent — the disclosure every Indian
 * annual report carries — with what the company imports. The net verdict sits in the
 * band above; this is its history.
 */
function Trade({ rows, fmt, fy }) {
  const latest = rows.at(-1);
  const withImports = latest.imports?.length ? latest : rows.findLast(r => r.imports?.length);
  const imports = withImports?.imports || [];
  const importTotal = imports.reduce((s, i) => s + i.value, 0);
  const grid = '56px repeat(5, minmax(72px, 1fr))';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 520 }}>
          <div style={{ display: 'grid', gridTemplateColumns: grid, gap: 12, paddingBottom: 8, borderBottom: '1px solid var(--color-border-subtle)' }}>
            {['Year', 'Earned', 'Spent', 'Net', 'Imports', 'Exports'].map((h, i) => (
              <span key={h} className="col-head" style={{ textAlign: i ? 'right' : 'left' }}>{h}</span>
            ))}
          </div>
          {[...rows].reverse().map(r => {
            const n = r.forexEarnings != null && r.forexOutgo != null ? r.forexEarnings - r.forexOutgo : null;
            return (
              <div key={r.date} style={{ display: 'grid', gridTemplateColumns: grid, gap: 12, padding: '10px 0', borderBottom: '1px solid var(--color-border-subtle)' }}>
                <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{fy(r.date)}</span>
                <span className="figure text-xs" style={{ textAlign: 'right' }}>{r.forexEarnings != null ? fmt(r.forexEarnings) : '—'}</span>
                <span className="figure text-xs" style={{ textAlign: 'right' }}>{r.forexOutgo != null ? fmt(r.forexOutgo) : '—'}</span>
                <span className="figure text-xs" style={{ textAlign: 'right', color: n == null ? 'var(--color-text-muted)' : n >= 0 ? 'var(--color-success)' : 'var(--color-chart-warm)' }}>
                  {n == null ? '—' : `${n >= 0 ? '+' : '−'}${fmt(Math.abs(n))}`}
                </span>
                <span className="figure text-xs" style={{ textAlign: 'right', color: 'var(--color-text-muted)' }}>{r.importsCif != null ? fmt(r.importsCif) : '—'}</span>
                <span className="figure text-xs" style={{ textAlign: 'right', color: 'var(--color-text-muted)' }}>{r.exportShare != null ? `${r.exportShare}%` : '—'}</span>
              </div>
            );
          })}
          <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 10, lineHeight: 1.6 }}>
            Earned and spent are in foreign currency, as disclosed; spent includes imports. Imports at CIF value.
          </p>
        </div>
      </div>

      {imports.length > 1 && importTotal > 0 && (
        <div>
          <p className="col-head" style={{ marginBottom: 12 }}>What it imports · {fy(withImports.date)}</p>
          <AllocationBar showValue={false} items={imports.map((i, k) => ({
            key: i.item, name: `${i.item} · ${fmt(i.value)}`, value: i.value, weight: (i.value / importTotal) * 100, color: colorAt(k),
          }))} />
        </div>
      )}
    </div>
  );
}

/** Inputs, customers and suppliers — as much as the report says, and no more. */
function Chain({ materials, customers, suppliers }) {
  const blocks = [
    {
      title: 'What it buys',
      body: materials.length ? (
        <ul style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {materials.map(m => (
            <li key={m.name} className="text-sm" style={{ color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
              <span style={{ color: 'var(--color-text-primary)' }}>{m.name}</span>
              {m.source ? ` · ${m.source}` : ''}{m.importedShare != null ? ` · ${m.importedShare}% imported` : ''}
            </li>
          ))}
        </ul>
      ) : null,
    },
    { title: 'Who buys', body: <Party summary={customers?.summary} extra={customers?.types} named={customers?.named} /> },
    { title: 'Who supplies', body: <Party summary={suppliers?.summary} named={suppliers?.named} /> },
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '22px 32px' }}>
      {blocks.map(b => (
        <div key={b.title} style={{ minWidth: 0 }}>
          <p className="col-head" style={{ marginBottom: 12 }}>{b.title}</p>
          {b.body || <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Not disclosed in the report.</p>}
        </div>
      ))}
    </div>
  );
}

function Party({ summary, extra, named = [] }) {
  if (!summary && !extra && !named?.length) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {summary && <p className="text-sm" style={{ color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>{summary}</p>}
      {extra && <p className="text-xs" style={{ color: 'var(--color-text-muted)', lineHeight: 1.6 }}>{extra}</p>}
      {named?.length > 0 && (
        <div className="flex flex-wrap" style={{ gap: 6 }}>
          {named.map(n => (
            <span key={n} className="text-xs" style={{ padding: '3px 9px', borderRadius: 99, background: 'var(--color-bg-elevated)', color: 'var(--color-text-secondary)' }}>{n}</span>
          ))}
        </div>
      )}
    </div>
  );
}
