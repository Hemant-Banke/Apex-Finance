import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

/**
 * The way back, wherever you are.
 *
 * There were three of these and no two matched: a bare "← Back" typed as a literal
 * arrow character, an icon-plus-text button that nudged on hover, and a chevron-led
 * link inside the import flow. A back affordance is the one control a page cannot
 * afford to make you look for, so it is one component and one shape everywhere.
 *
 * The arrow sits in its own chip. At rest the whole thing is muted and reads as a
 * caption; on hover the chip's border lifts and the arrow slides toward the edge it
 * takes you to — motion pointing the way it goes, which is the only thing motion is
 * really good for here.
 *
 * Give it `to` for a route, or `onClick` for a step back inside a flow.
 */
export default function BackLink({ to, onClick, children = 'Back', style }) {
  const inner = (
    <>
      <span
        aria-hidden
        className="backlink-chip"
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 22, height: 22, borderRadius: 999, flexShrink: 0,
          border: '1px solid var(--color-border)',
          background: 'var(--color-bg-elevated)',
          boxShadow: 'var(--elev-ring)',
          transition: 'border-color 0.15s ease, background 0.15s ease',
        }}
      >
        <ArrowLeft size={12} strokeWidth={2} className="backlink-arrow"
          style={{ transition: 'transform 0.15s ease' }} />
      </span>
      <span>{children}</span>
    </>
  );

  const shared = {
    className: 'backlink',
    style: {
      display: 'inline-flex', alignItems: 'center', gap: 9,
      alignSelf: 'flex-start',
      background: 'none', border: 'none', padding: 0,
      cursor: 'pointer', textDecoration: 'none',
      fontFamily: 'inherit', fontSize: '0.8125rem', fontWeight: 500,
      color: 'var(--color-text-muted)',
      transition: 'color 0.15s ease',
      ...style,
    },
  };

  return to
    ? <Link to={to} {...shared}>{inner}</Link>
    : <button type="button" onClick={onClick} {...shared}>{inner}</button>;
}
