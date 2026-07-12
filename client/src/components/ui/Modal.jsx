import { createPortal } from 'react-dom';
import { X, ArrowLeft } from 'lucide-react';

/**
 * Modal — a titled "slip" dialog.
 *
 * Props:
 *   title       — main heading (serif display)
 *   eyebrow     — small tracked label above the title (gilt tick)
 *   subtitle    — muted line under the title
 *   titlePrefix — optional node rendered left of the title (e.g. an asset icon)
 *   titleSuffix — optional node rendered inline right of the title (e.g. a type pill)
 *   onBack      — optional; shows a back arrow in the header
 *   align       — 'center' (default) | 'top' (pins the dialog near the top so it
 *                 doesn't jump when its content changes height)
 *   wide / maxWidth — width control
 */
export default function Modal({
  open, onClose, title, eyebrow, subtitle, titlePrefix, titleSuffix, onBack,
  align = 'center', children, wide = false, maxWidth, className = '',
}) {
  if (!open) return null;

  const width = maxWidth ?? (wide ? 660 : undefined);

  return createPortal(
    <div className={`modal-overlay${align === 'top' ? ' modal-overlay-top' : ''}`} onClick={onClose}>
      <div className={`modal-content${className ? ` ${className}` : ''}`} onClick={e => e.stopPropagation()} style={width ? { maxWidth: width } : undefined}>

        {/* Header — [back] eyebrow · title · subtitle, closed by a gilt hairline */}
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            {onBack && (
              <button onClick={onBack} className="btn-icon btn-icon-circle" aria-label="Back" title="Back" style={{ width: 34, height: 34, flexShrink: 0 }}>
                <ArrowLeft size={16} />
              </button>
            )}
            {titlePrefix}
            <div style={{ minWidth: 0, flex: 1 }}>
              {eyebrow && <p className="eyebrow" style={{ marginBottom: 6 }}>{eyebrow}</p>}
              {/* Long instrument names (a fund plan runs to ~60 chars) wrap onto a
                  second line rather than being truncated to an unreadable stub. The
                  suffix pill is allowed to drop below them instead of squeezing. */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flexWrap: 'wrap' }}>
                <h2 className="modal-title" style={{
                  minWidth: 0,
                  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                  overflow: 'hidden', overflowWrap: 'anywhere',
                }}>{title}</h2>
                {titleSuffix}
              </div>
              {subtitle && <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{subtitle}</p>}
            </div>
          </div>
          <button onClick={onClose} className="btn-icon btn-icon-circle modal-close" aria-label="Close" title="Close" style={{ width: 34, height: 34 }}>
            <X size={16} />
          </button>
        </div>
        <div className="gilt-rule" style={{ marginBottom: 24 }} />

        {children}
      </div>
    </div>,
    document.body
  );
}
