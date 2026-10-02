import { formatPct, pnlColor } from '../../lib/utils';
import Card from '../ui/Card';
import SectionHeader from '../ui/SectionHeader';

const WINDOWS = [['1m', '1M'], ['1y', '1Y'], ['3y', '3Y'], ['5y', '5Y']];
const COLS = 'minmax(150px, 1.4fr) repeat(4, minmax(64px, 1fr))';

/**
 * A rupee return taken apart: the asset in its own currency, the rupee against that
 * currency, and the two compounded. `split[k]` is `{ native, fx, inr }`.
 */
export default function ReturnSplit({ split, currency, assetLabel, sub, children }) {
  if (!split) return null;
  const cols = WINDOWS.filter(([k]) => split[k] && (split[k].native != null || split[k].inr != null));
  if (!cols.length) return null;
  const row = (label, pick, strong) => (
    <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 8, padding: '10px 0', borderBottom: '1px solid var(--color-border-subtle)', alignItems: 'baseline' }}>
      <span className="text-sm truncate" style={{ color: strong ? 'var(--color-text-primary)' : 'var(--color-text-secondary)' }}>{label}</span>
      {cols.map(([k]) => {
        const v = pick(split[k]);
        return <span key={k} className="figure text-xs" style={{ textAlign: 'right', fontWeight: strong ? 600 : 400, color: v == null ? 'var(--color-text-muted)' : pnlColor(v) }}>{formatPct(v, 1)}</span>;
      })}
    </div>
  );
  return (
    <Card>
      <SectionHeader eyebrow="Where the return came from" size="sm" sub={sub} style={{ marginBottom: 16 }} />
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 440 }}>
          <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 8, paddingBottom: 9, borderBottom: '1px solid var(--color-border-subtle)' }}>
            <span />
            {cols.map(([k, l]) => <span key={k} className="col-head" style={{ textAlign: 'right' }}>{l}</span>)}
          </div>
          {row(`${assetLabel} in ${currency}`, x => x.native)}
          {row(`${currency} against the rupee`, x => x.fx)}
          {row('In rupees', x => x.inr, true)}
        </div>
      </div>
      {children}
    </Card>
  );
}
