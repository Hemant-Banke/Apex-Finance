import { useRef } from 'react';
import DitherField from './DitherField';

// The Freedom Plan hero's garden: it grows in from the right, clear of the figures on the left.
const GARDEN_MASK = 'linear-gradient(90deg, transparent 18%, #000 70%)';
const TILT_X = 3, TILT_Y = 2;   // degrees at the card's edges
const SETTLE_MS = 650;          // matches the .card-tilt transition

/**
 * A metal card's motion: it turns slightly toward the pointer.
 * Written straight to CSS variables once a frame, never through state. The transform exists
 * only while hovered — a lingering one put pages on a layer Safari painted over the top bar.
 */
function useTilt(on) {
  const ref = useRef(null);
  const st = useRef({ frame: 0, timer: 0, x: 0.5, y: 0.5 });
  if (!on) return {};
  const allowed = () => window.matchMedia('(pointer: fine)').matches
    && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const apply = () => {
    const el = ref.current, s = st.current;
    s.frame = 0;
    if (!el) return;
    el.style.setProperty('--tilt-x', `${((0.5 - s.y) * 2 * TILT_X).toFixed(2)}deg`);
    el.style.setProperty('--tilt-y', `${((s.x - 0.5) * 2 * TILT_Y).toFixed(2)}deg`);
  };
  return {
    ref,
    onPointerEnter: (e) => {
      if (e.pointerType === 'touch' || !allowed()) return;
      clearTimeout(st.current.timer);
      ref.current?.classList.remove('is-settling');
      ref.current?.classList.add('is-tilting');
    },
    onPointerMove: (e) => {
      const el = ref.current;
      if (!el || !el.classList.contains('is-tilting')) return;
      const r = el.getBoundingClientRect();
      st.current.x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      st.current.y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
      if (!st.current.frame) st.current.frame = requestAnimationFrame(apply);
    },
    onPointerLeave: () => {
      const el = ref.current, s = st.current;
      if (!el) return;
      cancelAnimationFrame(s.frame); s.frame = 0;
      s.x = 0.5; s.y = 0.5; apply();
      el.classList.add('is-settling');
      s.timer = setTimeout(() => el.classList.remove('is-tilting', 'is-settling'), SETTLE_MS);
    },
  };
}

/**
 * Card — the app's surface primitive.
 * Wraps the shared .card class and its modifiers so elevation and hairlines
 * stay consistent everywhere.
 *
 * Props:
 *   gilt    — a headline surface: a brighter edge and deeper shadow (no rule)
 *   garden  — the money garden behind the content, as on the Freedom Plan hero (a page's top card);
 *             it also turns slightly toward the pointer, like a metal card
 *   tilt    — that metal-card motion alone (defaults to `garden`; the Freedom Plan hero draws its own garden)
 *   compact — tighter padding (.card-compact)
 *   flush   — removes padding (for edge-to-edge lists)
 *   className, style, ...rest — pass through
 */
export default function Card({
  gilt = false,
  garden = false,
  tilt = garden,
  compact = false,
  flush = false,
  className = '',
  style,
  children,
  ...rest
}) {
  const motion = useTilt(tilt);
  const classes = [
    'card',
    compact && 'card-compact',
    gilt && 'card-gilt',
    garden && 'card-garden',
    tilt && 'card-tilt',
    className,
  ].filter(Boolean).join(' ');

  return (
    <div
      className={classes}
      style={{ ...(flush || garden ? { overflow: 'hidden' } : null), ...(flush ? { padding: 0 } : null), ...style }}
      {...rest}
      {...motion}
    >
      {garden && <DitherField fall growth={0.75} rest={0.34} vivid={0.95}
        style={{ maskImage: GARDEN_MASK, WebkitMaskImage: GARDEN_MASK }} />}
      {children}
    </div>
  );
}
