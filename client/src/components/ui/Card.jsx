/**
 * Card — the app's surface primitive.
 * Wraps the shared .card class and its modifiers so elevation, hairlines,
 * and the optional gilt top-rule stay consistent everywhere.
 *
 * Props:
 *   gilt    — draws the champagne gilt top-rule (headline surfaces only)
 *   compact — tighter padding (.card-compact)
 *   flush   — removes padding (for edge-to-edge lists)
 *   className, style, ...rest — pass through
 */
export default function Card({
  gilt = false,
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
    className,
  ].filter(Boolean).join(' ');

  return (
    <div
      className={classes}
      style={{ ...(flush ? { padding: 0, overflow: 'hidden' } : null), ...style }}
      {...rest}
    >
      {children}
    </div>
  );
}
