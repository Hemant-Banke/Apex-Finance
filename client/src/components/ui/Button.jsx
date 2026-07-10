/**
 * Button — the app's one button primitive.
 * Wraps the shared .btn-* classes so every call site inherits the same
 * spacing, weight, focus ring, and press feedback.
 *
 * Props:
 *   variant — 'primary' (light) | 'gold' (gilt CTA) | 'secondary' (solid fill)
 *             | 'ghost' (alias of secondary) | 'danger' | 'icon' (square, icon-only)
 *   size    — 'sm' | 'md' (default)
 *   icon    — optional lucide icon component, rendered before children
 *   ...rest — onClick, type, disabled, style, title, etc. pass straight through
 */
const VARIANT_CLASS = {
  primary: 'btn-primary',
  gold: 'btn-gold',
  secondary: 'btn-ghost',
  ghost: 'btn-ghost',
  danger: 'btn-ghost',
  icon: 'btn-icon',
};

const SIZE_STYLE = {
  sm: { padding: '6px 12px', fontSize: '0.75rem' },
  md: null,
};

export default function Button({
  variant = 'primary',
  size = 'md',
  icon: Icon,
  className = '',
  style,
  children,
  ...rest
}) {
  const base = VARIANT_CLASS[variant] || VARIANT_CLASS.primary;
  const dangerStyle = variant === 'danger' ? { color: 'var(--color-danger)' } : null;
  const isIconOnly = variant === 'icon' || !children;
  const iconSize = variant === 'icon' ? 16 : size === 'sm' ? 13 : 15;

  return (
    <button
      className={`${base} ${className}`.trim()}
      style={{ ...(variant === 'icon' ? null : SIZE_STYLE[size]), ...dangerStyle, ...style }}
      {...rest}
    >
      {Icon && <Icon size={iconSize} strokeWidth={2} />}
      {!isIconOnly && children}
    </button>
  );
}
