import DitherField from './DitherField';

// The Freedom Plan hero's garden: it grows in from the right, clear of the figures on the left.
const GARDEN_MASK = 'linear-gradient(90deg, transparent 18%, #000 70%)';

/**
 * Card — the app's surface primitive.
 * Wraps the shared .card class and its modifiers so elevation and hairlines
 * stay consistent everywhere.
 *
 * Props:
 *   gilt    — a headline surface: a brighter edge and deeper shadow (no rule)
 *   garden  — the money garden behind the content, as on the Freedom Plan hero (a page's top card)
 *   compact — tighter padding (.card-compact)
 *   flush   — removes padding (for edge-to-edge lists)
 *   className, style, ...rest — pass through
 */
export default function Card({
  gilt = false,
  garden = false,
  compact = false,
  flush = false,
  className = '',
  style,
  children,
  ...rest
}) {
  const classes = [
    'card',
    compact && 'card-compact',
    gilt && 'card-gilt',
    garden && 'card-garden',
    className,
  ].filter(Boolean).join(' ');

  return (
    <div
      className={classes}
      style={{ ...(flush || garden ? { overflow: 'hidden' } : null), ...(flush ? { padding: 0 } : null), ...style }}
      {...rest}
    >
      {garden && <DitherField fall growth={0.75} rest={0.34} vivid={0.95}
        style={{ maskImage: GARDEN_MASK, WebkitMaskImage: GARDEN_MASK }} />}
      {children}
    </div>
  );
}
