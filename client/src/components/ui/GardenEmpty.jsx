import Card from './Card';
import DitherField from './DitherField';

// The garden rises from the foot and stays clear of the copy above it.
const MASK = 'linear-gradient(180deg, transparent 22%, #000 78%)';

/**
 * THE empty state: the money garden with falling petals behind a short message.
 * `card` wraps it in a gilt card; without it, it fills a section of a card that already exists.
 * `oneLine` keeps the text on a single line, clear of the garden below.
 * `children` sits under the copy (actions, starter tiles); `art` above it (a ghost preview).
 */
export default function GardenEmpty({ eyebrow, title, text, icon: Icon, art, children, card = true, compact = false, oneLine = false, align = 'center', style }) {
  const body = (
    <div className="garden-empty" style={{ textAlign: align, padding: compact ? '30px 24px 34px' : '34px 28px 30px', ...style }}>
      <DitherField fall growth={compact ? 0.7 : 0.85} rest={0.3} vivid={0.95} style={{ maskImage: MASK, WebkitMaskImage: MASK }} />
      <div style={{ position: 'relative' }}>
        {Icon && (
          <span className="garden-empty-icon" style={align === 'center' ? { margin: '0 auto 12px' } : { marginBottom: 12 }}>
            <Icon size={18} strokeWidth={1.7} />
          </span>
        )}
        {eyebrow && <p className="eyebrow" style={{ justifyContent: align === 'center' ? 'center' : undefined, marginBottom: 12 }}>{eyebrow}</p>}
        {title && (
          <h2 className={compact ? 'heading-lg' : 'heading-xl'} style={{ color: 'var(--color-text-primary)' }}>{title}</h2>
        )}
        {text && (
          <p className="text-sm" style={{ color: 'var(--color-text-muted)', margin: align === 'center' ? '8px auto 0' : '8px 0 0', lineHeight: 1.6,
            ...(oneLine ? { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } : { maxWidth: 460 }) }}>
            {text}
          </p>
        )}
        {art}
        {children && <div style={{ marginTop: 20 }}>{children}</div>}
      </div>
    </div>
  );
  return card ? <Card gilt flush>{body}</Card> : body;
}
