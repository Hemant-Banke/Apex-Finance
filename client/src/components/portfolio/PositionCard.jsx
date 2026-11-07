import Card from '../ui/Card';
import Delta from '../ui/Delta';
import { GainBar } from './HoldingsBook';
import { formatCurrency, compactIfLarge, formatCount, formatSigned, formatPct, MONTHS_SHORT } from '../../lib/utils';

const heldSince = (d) => {
  const t = d && new Date(d);
  return t && !isNaN(t) ? `${MONTHS_SHORT[t.getUTCMonth()]} ${t.getUTCFullYear()}` : null;
};

// A figure never breaks mid-number; when the card is narrow, whole cells wrap instead.
function Figure({ label, children, sub }) {
  return (
    <div style={{ whiteSpace: 'nowrap' }}>
      <p className="col-head" style={{ marginBottom: 8 }}>{label}</p>
      {children}
      {sub && <p className="figure text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 6 }}>{sub}</p>}
    </div>
  );
}

/**
 * "Your position" on the stock and asset pages: what you hold of this instrument, marked to market.
 * `positions` are portfolio holdings (summed — gold is every physical gold holding); all figures are INR.
 */
export default function PositionCard({ positions, unitLabel = 'Units' }) {
  if (!positions?.length) return null;
  const sum = (k) => positions.reduce((s, p) => s + (p[k] || 0), 0);
  const qty = sum('qty'), value = sum('value'), invested = sum('invested'), weight = sum('weight');
  const pnl = positions.reduce((s, p) => s + (p.unrealisedPnl ?? ((p.value || 0) - (p.invested || 0))), 0);
  const realised = sum('realisedPnl');
  const ret = invested ? (pnl / Math.abs(invested)) * 100 : null;
  const hasDay = positions.some(p => p.dayChange != null);
  const day = sum('dayChange');
  const dayBase = value - day;
  const single = positions.length === 1 ? positions[0] : null;
  const priced = positions.every(p => p.priced !== false);
  const accounts = new Set(positions.flatMap(p => (p.positions || []).map(x => x.account))).size;
  const firstDate = positions.map(p => p.firstPurchaseDate).filter(Boolean).sort()[0];
  const since = heldSince(firstDate);
  const meta = [since && `Held since ${since}`, accounts > 1 && `in ${accounts} accounts`, !single && `${positions.length} holdings`]
    .filter(Boolean).join(' · ');

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 18 }}>
        <p className="eyebrow">Your position</p>
        {meta && <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{meta}</p>}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: '18px 32px' }}>
        <Figure label="Market value" sub={weight ? `${weight.toFixed(1)}% of your portfolio` : null}>
          <p className="display-number" style={{ fontSize: 'clamp(1.35rem, 2.6vw, 1.65rem)', color: 'var(--color-text-primary)', lineHeight: 1 }}>
            {formatCurrency(value)}
          </p>
        </Figure>

        <Figure label="Return" sub={[priced && ret != null && formatPct(ret), realised ? `${formatSigned(realised, compactIfLarge)} realised` : null].filter(Boolean).join(' · ') || null}>
          {priced ? <Delta value={pnl} compact size="md" /> : <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>at cost</span>}
        </Figure>

        <Figure label="Today" sub={hasDay && dayBase ? formatPct((day / Math.abs(dayBase)) * 100) : null}>
          {hasDay
            ? <Delta value={day} compact size="md" />
            : <span className="figure text-sm" style={{ color: 'var(--color-text-muted)' }}>—</span>}
        </Figure>

        <Figure label={unitLabel} sub={single?.avgCostPerUnit && single?.price ? `avg ${formatCurrency(single.avgCostPerUnit)} · now ${formatCurrency(single.price)}` : null}>
          <p className="figure" style={{ fontSize: '0.9375rem', fontWeight: 500, color: 'var(--color-text-primary)' }}>{formatCount(qty, 4)}</p>
        </Figure>
      </div>

      {/* Cost against worth, drawn the way every holdings row draws it. */}
      <div style={{ marginTop: 22 }}>
        <GainBar h={{ value, invested, priced }} scale={Math.max(Math.abs(value), Math.abs(invested))} height={6} />
        <div className="figure text-xs" style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, color: 'var(--color-text-muted)' }}>
          <span>Invested {compactIfLarge(invested)}</span>
          <span>Worth {compactIfLarge(value)}</span>
        </div>
      </div>
    </Card>
  );
}
