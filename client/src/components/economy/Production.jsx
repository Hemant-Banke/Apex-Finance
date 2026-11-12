import { useMemo, useState } from 'react';
import Card from '../ui/Card';
import SectionHeader from '../ui/SectionHeader';
import { ContributionChart, ContributionTable } from './Contribution';
import { CHART_COLORS } from '../../lib/utils';

// Biggest first; one palette slot each, never cycled.
const INDUSTRIES = [
  { key: 'finance', label: 'Finance, real estate & professional services', short: 'Finance & real estate', color: CHART_COLORS[0] },
  { key: 'trade', label: 'Trade, hotels, transport & communication', short: 'Trade & transport', color: CHART_COLORS[1] },
  { key: 'agri', label: 'Agriculture, forestry & fishing', short: 'Agriculture', color: CHART_COLORS[7] },
  { key: 'mfg', label: 'Manufacturing', short: 'Manufacturing', color: CHART_COLORS[3] },
  { key: 'public', label: 'Public administration & other services', short: 'Public & other services', color: CHART_COLORS[2] },
  { key: 'construction', label: 'Construction', short: 'Construction', color: CHART_COLORS[4] },
  { key: 'utilities', label: 'Electricity, gas & water', short: 'Utilities', color: CHART_COLORS[6] },
  { key: 'mining', label: 'Mining & quarrying', short: 'Mining', color: CHART_COLORS[5] },
];

/** What India makes: output by industry, and which industries carried each quarter's growth. */
export default function Production({ quarters }) {
  const rows = useMemo(() => quarters.map(q => ({
    label: q.short, total: q.gvaYoY,
    ...Object.fromEntries(INDUSTRIES.map(i => [i.key, q.industries[i.key]?.contrib ?? null])),
  })), [quarters]);
  const [sel, setSel] = useState(rows.length - 1);
  const q = quarters[sel] || quarters[quarters.length - 1];
  if (!q) return null;

  // Ranked by share: the table and the bar above it read as what India makes, biggest first.
  const table = INDUSTRIES.map(i => ({ ...i, ...q.industries[i.key] })).sort((a, b) => (b.share ?? 0) - (a.share ?? 0));
  const sum = table.reduce((s, r) => s + (r.contrib ?? 0), 0);

  return (
    <Card>
      <SectionHeader eyebrow="What India makes" size="sm" style={{ marginBottom: 18 }}
        sub="Real output (gross value added) by industry. Each bar is what an industry added to growth on the same quarter a year earlier; the line is total output growth. Click a quarter to read it below." />
      <ContributionChart rows={rows} parts={INDUSTRIES.map(i => ({ key: i.key, name: i.short, color: i.color }))}
        line={{ key: 'total', name: 'Output growth' }} selected={sel} onSelect={setSel} />

      <div style={{ marginTop: 26 }}>
        <div className="flex items-baseline justify-between" style={{ gap: 12, marginBottom: 10 }}>
          <p className="col-head">Share of output · four quarters to {q.months}</p>
        </div>
        <div style={{ display: 'flex', height: 10, borderRadius: 3, overflow: 'hidden', gap: 2, marginBottom: 18 }}>
          {table.filter(r => r.share).map(r => (
            <span key={r.key} title={`${r.label}: ${r.share.toFixed(1)}%`} style={{ flex: r.share, background: r.color }} />
          ))}
        </div>
        <ContributionTable rows={table} shareLabel="Share" growthLabel="Growth"
          total={{ label: `All output, ${q.short}`, share: 100, yoy: q.gvaYoY, contrib: Math.round(sum * 100) / 100 }} />
      </div>
    </Card>
  );
}
