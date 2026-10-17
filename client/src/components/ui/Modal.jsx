import { createPortal } from 'react-dom';
import { X, ArrowLeft } from 'lucide-react';

// Long names (a fund plan runs ~60 chars) wrap to two lines; the tail is what distinguishes them.
const clampTwo = {
  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
  overflow: 'hidden', overflowWrap: 'anywhere',
};

/**
 * Modal — a titled "slip" dialog.
 *
 * Props:
 *   title       — main heading (serif display)
 *   eyebrow     — small tracked label above the title (gilt tick)
 *   subtitle    — muted line under the title
 *   titlePrefix — optional node left of the title (an asset icon); switches to the identity header
 *   tag         — optional type label leading the subtitle line (identity header only)
 *   onBack      — optional; shows a back arrow in the header
 *   align       — 'center' (default) | 'top' (pins the dialog near the top so it
 *                 doesn't jump when its content changes height)
 *   wide / maxWidth — width control
 */
export default function Modal({
  open, onClose, title, eyebrow, subtitle, titlePrefix, tag, onBack,
  align = 'center', children, wide = false, maxWidth, className = '',
}) {
  if (!open) return null;

  const width = maxWidth ?? (wide ? 660 : undefined);
  const back = onBack && (
    <button onClick={onBack} className="btn-icon btn-icon-circle" aria-label="Back" title="Back" style={{ width: 34, height: 34, flexShrink: 0 }}>
      <ArrowLeft size={16} />
    </button>
  );

  return createPortal(
    <div className={`modal-overlay${align === 'top' ? ' modal-overlay-top' : ''}`} onClick={onClose}>
      <div className={`modal-content${className ? ` ${className}` : ''}`} onClick={e => e.stopPropagation()} style={width ? { maxWidth: width } : undefined}>

        {titlePrefix ? (
          // Identity header (an asset): navigation on its own bar, then icon · name · meta.
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 34, marginBottom: 14 }}>
              {back}
              {eyebrow && <p className="eyebrow" style={{ flex: 1, minWidth: 0 }}>{eyebrow}</p>}
              <button onClick={onClose} className="btn-icon btn-icon-circle modal-close" aria-label="Close" title="Close" style={{ width: 34, height: 34, marginLeft: 'auto' }}>
                <X size={16} />
              </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
              <span style={{ flexShrink: 0, display: 'flex' }}>{titlePrefix}</span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <h2 className="modal-title" style={clampTwo}>{title}</h2>
                {(tag || subtitle) && (
                  <div className="text-xs" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, minWidth: 0, color: 'var(--color-text-muted)' }}>
                    {tag && <span className="modal-tag">{tag}</span>}
                    {subtitle && <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{subtitle}</span>}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="modal-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
              {back}
              <div style={{ minWidth: 0, flex: 1 }}>
                {eyebrow && <p className="eyebrow" style={{ marginBottom: 6 }}>{eyebrow}</p>}
                <h2 className="modal-title" style={clampTwo}>{title}</h2>
                {subtitle && <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{subtitle}</p>}
              </div>
            </div>
            <button onClick={onClose} className="btn-icon btn-icon-circle modal-close" aria-label="Close" title="Close" style={{ width: 34, height: 34 }}>
              <X size={16} />
            </button>
          </div>
        )}
        <div className="divider" style={{ marginBottom: 24, background: 'var(--color-border-subtle)' }} />

        {children}
      </div>
    </div>,
    document.body
  );
}
