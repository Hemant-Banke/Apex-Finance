import { useSyncExternalStore } from 'react';
import ApexLogo from '../ui/ApexLogo';

/**
 * Apex is a desktop product.
 *
 * Its pages are built around wide ledgers, side-by-side comparisons and charts that need
 * room to be read; squeezed onto a phone they become a column of truncated figures. So
 * rather than ship a mobile layout nobody designed, a small or touch-first screen gets a
 * clear note instead of the app.
 *
 * Two conditions, both read live (a desktop window dragged narrow is told to widen,
 * and recovers the moment it is):
 *   - at least `MIN_WIDTH` px of viewport
 *   - a primary pointer that can HOVER — a phone or tablet in landscape can be wide
 *     enough, but every hover-revealed control in the app (sell buttons, row actions,
 *     chart tooltips) would be unreachable on it. A touchscreen laptop still passes:
 *     its primary pointer is the trackpad.
 */
const MIN_WIDTH = 1024;
const QUERY = `(min-width: ${MIN_WIDTH}px) and (hover: hover)`;
const HOVER = '(hover: hover)';

const subscribe = (cb) => {
  const lists = [window.matchMedia(QUERY), window.matchMedia(HOVER)];
  lists.forEach(m => m.addEventListener('change', cb));
  return () => lists.forEach(m => m.removeEventListener('change', cb));
};
const fits      = () => window.matchMedia(QUERY).matches;
const canHover  = () => window.matchMedia(HOVER).matches;

export default function DesktopOnly({ children }) {
  const ok = useSyncExternalStore(subscribe, fits, () => true);
  const desktop = useSyncExternalStore(subscribe, canHover, () => true);
  if (ok) return children;

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--color-bg-primary)', padding: '32px 24px',
    }}>
      <div style={{ maxWidth: 420, textAlign: 'center' }}>
        <ApexLogo size={36} style={{ color: 'var(--color-accent)', margin: '0 auto', display: 'block' }} />
        <h1 style={{
          fontFamily: 'var(--font-display)', fontSize: '1.75rem', fontWeight: 400,
          color: 'var(--color-text-primary)', marginTop: 24, lineHeight: 1.2,
        }}>
          {desktop ? 'A little more room' : 'Apex lives on the desktop'}
        </h1>
        <p className="text-sm" style={{ color: 'var(--color-text-secondary)', marginTop: 14, lineHeight: 1.65 }}>
          {desktop
            ? `Apex is laid out for a wide screen. Widen this window to at least ${MIN_WIDTH}px and everything will appear.`
            : 'Its ledgers, comparisons and charts are built for a large screen, a keyboard and a pointer. Open Apex on your laptop or desktop to continue.'}
        </p>
      </div>
    </div>
  );
}
