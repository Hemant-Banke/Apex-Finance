/**
 * SectionHeader — the standard header row above a content block.
 * The eyebrow carries the recurring gilt tick; the title uses the Fraunces
 * serif. An optional `action` node sits flush right.
 *
 * Props:
 *   eyebrow — small tracked label with the gilt tick
 *   title   — serif heading (optional; omit for eyebrow-only headers)
 *   sub     — muted caption under the title
 *   action  — right-aligned node (button, link, etc.)
 *   size    — 'sm' (eyebrow only, tighter) | 'md' (default)
 */
export default function SectionHeader({ eyebrow, title, sub, action, size = 'md', style }) {
  return (
    <div
      className="flex items-end justify-between"
      style={{ gap: 16, ...style }}
    >
      <div style={{ minWidth: 0 }}>
        {eyebrow && <p className="eyebrow" style={{ marginBottom: title ? 10 : 0 }}>{eyebrow}</p>}
        {title && (
          <h2 className={size === 'sm' ? 'heading-lg' : 'heading-xl'} style={{ color: 'var(--color-text-primary)' }}>
            {title}
          </h2>
        )}
        {sub && <p className="text-sm" style={{ color: 'var(--color-text-muted)', marginTop: 6 }}>{sub}</p>}
      </div>
      {action && <div style={{ flexShrink: 0 }}>{action}</div>}
    </div>
  );
}
