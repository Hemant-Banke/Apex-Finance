import { formatCurrency, formatNativeCurrency } from '../../lib/utils';
import Card from '../ui/Card';
import SectionHeader from '../ui/SectionHeader';
import { Stat, StatGrid, RangeBar } from '../stock/PricePerformance';
import ReturnSplit from './ReturnSplit';

/** Gold or silver as an Indian buyer meets it: by purity, against the world price, and the rupee's part in the return. */
export default function MetalProfile({ p, name }) {
  const gold = p.metal === 'gold';
  const bulk = gold ? { label: 'Per 10 g', grams: 10 } : { label: 'Per kg', grams: 1000 };
  const ratio = p.ratio;
  return (
    <>
      <Card>
        <SectionHeader eyebrow="Price by purity" size="sm"
          sub="The domestic price per gram of each common fineness — import duty, GST and the local premium included, making charges not" style={{ marginBottom: 16 }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(140px, 1.4fr) 1fr 1fr', gap: 12, paddingBottom: 9, borderBottom: '1px solid var(--color-border-subtle)' }}>
          <span className="col-head">Purity</span>
          <span className="col-head" style={{ textAlign: 'right' }}>Per gram</span>
          <span className="col-head" style={{ textAlign: 'right' }}>{bulk.label}</span>
        </div>
        {p.purities.map(o => (
          <div key={o.label} style={{ display: 'grid', gridTemplateColumns: 'minmax(140px, 1.4fr) 1fr 1fr', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--color-border-subtle)', alignItems: 'baseline' }}>
            <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>{o.label}</span>
            <span className="figure text-sm" style={{ textAlign: 'right', color: 'var(--color-text-primary)' }}>{formatCurrency(o.perGram)}</span>
            <span className="figure text-sm" style={{ textAlign: 'right', color: 'var(--color-text-secondary)' }}>{formatCurrency(o.perGram * bulk.grams)}</span>
          </div>
        ))}
        <StatGrid style={{ marginTop: 10 }} stats={[
          { label: 'World price', value: p.spotUsdOz != null ? `${formatNativeCurrency(p.spotUsdOz, 'USD')}/oz` : null, note: gold ? 'COMEX gold future' : 'COMEX silver future' },
          { label: 'World price in rupees', value: p.internationalPerGram != null ? `${formatCurrency(p.internationalPerGram)}/g` : null,
            note: p.usdInr != null ? `At ₹${p.usdInr.toFixed(2)} to the dollar` : null },
          { label: 'Domestic premium', value: p.premiumPct != null ? `+${p.premiumPct.toFixed(1)}%` : null, note: 'Duty, GST and local premium over the world price' },
        ]} />
      </Card>

      <ReturnSplit split={p.split} currency="USD" assetLabel={name}
        sub={`The rupee price is the world price times the dollar. Over each window, how much came from ${name.toLowerCase()} itself and how much from the rupee weakening.`}>
        {ratio && (
          <div style={{ marginTop: 18, maxWidth: 420 }}>
            <Stat label="Gold-to-silver ratio" value={`${ratio.now.toFixed(1)}×`}
              note={`Ounces of silver one ounce of gold buys · 5-year median ${ratio.median.toFixed(1)}×. High means silver is cheap against gold.`} />
            <RangeBar low={ratio.low} high={ratio.high} value={ratio.now} fmt={v => `${v.toFixed(0)}×`} />
          </div>
        )}
      </ReturnSplit>
    </>
  );
}
