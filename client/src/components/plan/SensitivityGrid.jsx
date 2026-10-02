import { fireNumber, realRate, yearsToTarget } from '../../lib/fire';

const SWRS = [3, 3.5, 4, 4.5];
const RETURNS = [8, 10, 12, 14];
const COLS  = '86px repeat(4, minmax(0, 1fr))';

/**
 * The age you reach FIRE across withdrawal rates × returns. A higher rate means a smaller
 * pot is enough, so the age falls — at the cost of a higher chance of running out.
 */
export default function SensitivityGrid({ corpus, contribution, annualSpend, inflation, age, swr, ret }) {
  const cells = SWRS.map(w => RETURNS.map(r => {
    const y = yearsToTarget(corpus, contribution, realRate(r, inflation), fireNumber(annualSpend, w));
    return y == null ? null : age + y;
  }));
  // Your settings may sit between grid values; mark the nearest cell.
  const near = (list, v) => list.reduce((b, x) => (Math.abs(x - v) < Math.abs(b - v) ? x : b), list[0]);
  const myW = near(SWRS, swr), myR = near(RETURNS, ret);
  const vals = cells.flat().filter(v => v != null);
  const lo = Math.min(...vals), hi = Math.max(...vals);

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 6, alignItems: 'end', marginBottom: 6 }}>
        <span className="col-head" style={{ whiteSpace: 'nowrap' }}>Withdraw ↓</span>
        {RETURNS.map(r => <span key={r} className="col-head" style={{ textAlign: 'center' }}>{r}% return</span>)}
      </div>
      {SWRS.map((w, i) => (
        <div key={w} style={{ display: 'grid', gridTemplateColumns: COLS, gap: 6, marginBottom: 6, alignItems: 'center' }}>
          <span className="figure text-xs" style={{ color: 'var(--color-text-muted)' }}>{w}%</span>
          {RETURNS.map((r, j) => {
            const v = cells[i][j];
            const t = v == null || hi === lo ? 1 : (v - lo) / (hi - lo);   // 0 = earliest
            const mine = w === myW && r === myR;
            return (
              <span key={r} className="figure" style={{
                textAlign: 'center', padding: '10px 0', borderRadius: 10, fontSize: '0.9rem', fontWeight: mine ? 600 : 500,
                // Sooner grows greener, like the garden. Yours is the one light chip.
                color: mine ? 'var(--color-bg-primary)' : v == null ? 'var(--color-text-muted)' : 'var(--color-text-primary)',
                background: mine ? 'var(--color-text-primary)'
                  : v == null ? 'var(--color-bg-elevated)'
                  : `color-mix(in srgb, var(--color-garden) ${Math.round(8 + (1 - t) * 42)}%, var(--color-bg-elevated))`,
              }}>
                {v == null ? '70+' : v.toFixed(0)}
              </span>
            );
          })}
        </div>
      ))}
      <div className="flex items-center justify-between" style={{ marginTop: 12 }}>
        <span className="text-xs flex items-center" style={{ gap: 8, color: 'var(--color-text-muted)' }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: 'var(--color-text-primary)' }} /> your settings · age you reach FIRE
        </span>
        <span className="flex items-center text-xs" style={{ gap: 8, color: 'var(--color-text-muted)' }}>
          sooner
          <span style={{ width: 80, height: 6, borderRadius: 99, background: 'linear-gradient(90deg, color-mix(in srgb, var(--color-garden) 50%, var(--color-bg-elevated)), var(--color-bg-elevated))' }} />
          later
        </span>
      </div>
    </div>
  );
}
