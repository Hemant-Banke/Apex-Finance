import Switch from '../ui/Switch';
import { usePricing } from '../../context/PricingContext';
import { todayStr } from '../../lib/utils';

const dayLabel = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).replace(',', '');
const shift = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const clock = (ms) => new Date(ms).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });

/**
 * The price basis for every figure in the app, and what the figures are really as of.
 * The as-of line reads the last priced response, so a live fetch that fell back says so.
 */
export default function PriceBasis() {
  const { live, setLive, priced } = usePricing();
  const today = todayStr();
  const close = dayLabel(shift(today, -1));
  const fellBack = live && priced && priced.date < today;
  const tone = live && !fellBack ? 'is-live' : fellBack ? 'is-warn' : '';

  return (
    <div className={`price-basis ${tone}`}>
      <Switch className="price-basis-switch" on={live} onChange={setLive} label="Live prices"
        title="Off: assets at the last close, cash as of today. On: assets at live market prices." />
      <div className="price-basis-asof">
        <span className="price-basis-dot" />
        <span style={{ minWidth: 0 }}>
          {!live && <>Assets at close of <span className="figure">{close}</span><span className="price-basis-sub">Cash as of today</span></>}
          {live && !fellBack && <>Live{priced ? <> · <span className="figure">{clock(priced.at)}</span></> : ''}<span className="price-basis-sub">Assets and cash, {dayLabel(today)}</span></>}
          {fellBack && <>Quotes unavailable<span className="price-basis-sub">Showing close of {dayLabel(priced.date)}</span></>}
        </span>
      </div>
    </div>
  );
}
