import Card from '../ui/Card';
import Delta from '../ui/Delta';
import { MastheadFigure } from '../ui/Masthead';
import { formatCurrency, compactIfLarge, formatCount } from '../../lib/utils';

/**
 * "Your position" — what the user holds of the instrument a page is about, marked to market.
 * The one card behind the stock page and the asset page.
 *
 * Laid out as the answer and then its parts, like every masthead: what it is worth to YOU
 * and how far it has come, large on the left; the quantities behind that figure in a
 * recessed panel on the right. A row of five equal figures made "how many shares" weigh
 * as much as "what it is worth", which is the reason anyone reads this card.
 *
 * `positions` is one or more `{ qty, invested, value, pnl?, dayChange? }`, summed (gold is
 * every physical gold holding at once); `pnl` defaults to value − invested. With a single
 * position it shows the average cost; with several, an average across purities means
 * little, so it is left out. "Today" appears only when the positions carry a day change.
 */
export default function PositionCard({ positions, unitLabel = 'Units' }) {
  if (!positions?.length) return null;
  const sum = (k) => positions.reduce((s, p) => s + (p[k] || 0), 0);
  const qty = sum('qty'), value = sum('value'), invested = sum('invested');
  const pnl = positions.reduce((s, p) => s + (p.pnl ?? ((p.value || 0) - (p.invested || 0))), 0);
  const ret = invested ? (pnl / Math.abs(invested)) * 100 : null;
  const hasDay = positions.some(p => p.dayChange != null);
  const day = sum('dayChange');
  const dayBase = value - day;
  const single = positions.length === 1;

  return (
    <Card gilt flush style={{ display: 'flex', flexWrap: 'wrap', overflow: 'hidden' }}>
      <div style={{ flex: '1 1 260px', padding: '20px 24px', minWidth: 0 }}>
        <p className="eyebrow" style={{ marginBottom: 12 }}>Your position</p>
        <p className="display-number" style={{ fontSize: 'clamp(1.35rem, 3vw, 1.6rem)', color: 'var(--color-text-primary)' }}>
          {formatCurrency(value)}
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 16px', marginTop: 10 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Delta value={pnl} pct={ret} compact />
            <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>since bought</span>
          </span>
          {hasDay && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Delta value={day} pct={dayBase ? (day / Math.abs(dayBase)) * 100 : null} compact />
              <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>today</span>
            </span>
          )}
        </div>
      </div>

      <div style={{
        flex: '1 1 300px', padding: '20px 24px', minWidth: 0,
        background: 'var(--color-bg-input)', borderLeft: '1px solid var(--color-border-subtle)',
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 18, alignContent: 'center',
      }}>
        <MastheadFigure label={unitLabel} value={formatCount(qty, 4)}
          sub={!single ? <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>across {positions.length} holdings</p> : null} />
        {single && qty ? <MastheadFigure label="Average cost" value={formatCurrency(invested / qty)} /> : null}
        <MastheadFigure label="Invested" value={compactIfLarge(invested)} />
      </div>
    </Card>
  );
}
