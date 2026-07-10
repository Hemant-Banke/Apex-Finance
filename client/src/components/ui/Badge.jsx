/**
 * Badge — a small status/label chip. Wraps the shared .badge classes.
 *
 * Props:
 *   variant — 'default' | 'success' | 'danger' | 'gold'
 */
const VARIANT_CLASS = {
  default: 'badge-default',
  success: 'badge-success',
  danger: 'badge-danger',
  gold: 'badge-gold',
};

export default function Badge({ variant = 'default', className = '', style, children, ...rest }) {
  return (
    <span
      className={`badge ${VARIANT_CLASS[variant] || VARIANT_CLASS.default} ${className}`.trim()}
      style={style}
      {...rest}
    >
      {children}
    </span>
  );
}
