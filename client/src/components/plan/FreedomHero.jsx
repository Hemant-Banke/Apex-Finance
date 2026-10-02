import { useId } from 'react';
import { compactIfLarge } from '../../lib/utils';
import Card from '../ui/Card';
import DitherField from '../ui/DitherField';

const money = (v) => compactIfLarge(Math.round(v || 0));
const yrs = (y) => (y < 1 ? `${Math.max(1, Math.round(y * 12))} months` : `${y.toFixed(1)} years`);

/** Progress as a ring in the house gold. */
function Ring({ pct, size = 168 }) {
  const id = useId();
  const r = size / 2 - 10, c = 2 * Math.PI * r;
  const shown = Math.min(100, Math.max(0, pct));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0, position: 'relative' }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--color-accent-strong)" />
          <stop offset="100%" stopColor="var(--color-accent)" />
        </linearGradient>
      </defs>
      <circle cx={size / 2} cy={size / 2} r={r} fill="var(--color-bg-card)" stroke="var(--color-border-subtle)" strokeWidth="6" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={`url(#${id})`} strokeWidth="6" strokeLinecap="round"
        strokeDasharray={`${(shown / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dasharray 0.6s ease' }} />
      <text x="50%" y="48%" textAnchor="middle" dominantBaseline="middle" fill="var(--color-text-primary)"
        style={{ fontFamily: 'var(--font-mono)', fontSize: 32, fontWeight: 500 }}>{Math.min(999, pct).toFixed(0)}%</text>
      <text x="50%" y="64%" textAnchor="middle" fill="var(--color-text-muted)" style={{ fontSize: 10, letterSpacing: '0.16em' }}>OF THE WAY</text>
    </svg>
  );
}

/**
 * The top of the Plan page: when you are free and how far along. The money garden behind it
 * grows fuller as you get closer — the same garden the app is planted in.
 */
export default function FreedomHero({ m, s }) {
  const headline = m.yearsFI === 0 ? 'You are free' : m.fiAge != null ? `Free at ${m.fiAge.toFixed(0)}` : 'Keep building';
  const coasting = m.corpus >= m.coast;
  // Never bare: even a new plan has seedlings. Grows fuller toward 100%.
  const growth = Math.min(1, 0.35 + (m.progress / 100) * 0.65);

  return (
    <Card gilt flush style={{ position: 'relative' }}>
      <DitherField growth={growth} rest={0.32} vivid={0.95}
        style={{ maskImage: 'linear-gradient(90deg, transparent 20%, #000 75%)', WebkitMaskImage: 'linear-gradient(90deg, transparent 20%, #000 75%)' }} />

      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 36, flexWrap: 'wrap', padding: '30px 30px 26px' }}>
        <div style={{ flex: 1, minWidth: 280 }}>
          <p className="eyebrow" style={{ marginBottom: 14 }}>Financial independence</p>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(2.1rem, 5vw, 2.9rem)', lineHeight: 1.05, color: 'var(--color-text-primary)', letterSpacing: '-0.02em' }}>
            {headline}
          </h1>
          <p style={{ color: 'var(--color-text-secondary)', marginTop: 12, lineHeight: 1.55, maxWidth: 520, fontSize: '0.95rem' }}>
            {m.yearsFI === 0
              ? <>Your money already pays for a life of <span className="figure" style={{ color: 'var(--color-text-primary)' }}>{money(m.spend)}</span> a month, for good.</>
              : m.yearsFI != null
                ? <>In <span className="figure" style={{ color: 'var(--color-text-primary)' }}>{yrs(m.yearsFI)}</span>, your money can pay for your life indefinitely.</>
                : <>At this pace your money does not yet catch up with a <span className="figure">{money(m.spend)}</span>-a-month life.</>}
          </p>
          <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 8 }}>
            <span className="figure">{money(m.corpus)}</span> today · <span className="figure">{money(m.target)}</span> to be free · <span className="figure">{money(m.contribution)}</span> invested a month
          </p>
          <div style={{ marginTop: 20, paddingLeft: 14, borderLeft: '2px solid var(--color-accent)', maxWidth: 440 }}>
            <div className="flex items-baseline justify-between" style={{ gap: 12 }}>
              <span className="col-head">Coast FIRE</span>
              <span className="figure text-xs" style={{ color: coasting ? 'var(--color-success)' : 'var(--color-text-secondary)' }}>
                {coasting ? 'reached' : `${money(m.coast - m.corpus)} to go`}
              </span>
            </div>
            <div style={{ height: 3, borderRadius: 99, background: 'var(--color-bg-elevated)', overflow: 'hidden', margin: '8px 0 7px' }}>
              <div style={{ height: '100%', width: `${Math.min(100, m.coast ? (m.corpus / m.coast) * 100 : 0)}%`, borderRadius: 99, background: 'var(--color-accent)' }} />
            </div>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
              {coasting
                ? `You could stop saving today and still be free by ${s.retireAge}.`
                : `Reach ${money(m.coast)} and you could stop saving — it grows to freedom by ${s.retireAge} on its own.`}
            </p>
          </div>
        </div>
        <Ring pct={m.progress} />
      </div>

      <div style={{
        position: 'relative', display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 24,
        padding: '18px 30px 22px', borderTop: '1px solid var(--color-border-subtle)', background: 'color-mix(in srgb, var(--color-bg-secondary) 62%, transparent)',
      }}>
        {m.variants.map(v => {
          const on = s.basis === v.k;
          return (
            <div key={v.k} style={{ minWidth: 0 }}>
              <div className="flex items-center justify-between" style={{ gap: 8 }}>
                <span className="col-head" style={{ color: on ? 'var(--color-accent)' : undefined }}>{v.label}</span>
                <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  {v.years === 0 ? 'reached' : v.years == null ? '70+ yrs' : `age ${(s.age + v.years).toFixed(0)}`}
                </span>
              </div>
              <p className="figure" style={{ fontSize: '1.15rem', fontWeight: 500, color: on ? 'var(--color-text-primary)' : 'var(--color-text-secondary)', marginTop: 8 }}>
                {money(v.target)}
              </p>
              <div style={{ height: 3, borderRadius: 99, background: 'var(--color-bg-elevated)', overflow: 'hidden', marginTop: 10 }}>
                <div style={{ height: '100%', width: `${Math.min(100, v.pct)}%`, borderRadius: 99, background: on ? 'var(--color-accent)' : 'var(--color-text-muted)' }} />
              </div>
              <p className="figure text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 6 }}>{Math.min(999, v.pct).toFixed(0)}% there</p>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
