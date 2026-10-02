import { ArrowUpRight } from 'lucide-react';

/**
 * The affordance for selling a position you hold.
 *
 * One component for both places a holding is listed — the account's Holdings card and
 * the portfolio's book — so the two cannot drift into looking like different actions.
 *
 * It reveals in two stages rather than one. At rest the row is quiet; hovering the row
 * brings the button up as a soft tint; hovering the BUTTON fills it. That second
 * stage is what separates "there is an action here" from "you are about to sell
 * something", which a flat outline that appeared and then did nothing never did.
 *
 * Red because Sell is red everywhere in this app, and muted rather than saturated —
 * the fill is `color-mix(danger 68%, ink)` per the house rule for tinted buttons, so a
 * list of ten holdings does not read as ten alarms.
 *
 * It carries the word, not just the arrow: an unlabelled glyph on a row of figures is
 * a guess, and this one moves money.
 */
export default function SellButton({ onClick, label = 'Sell', title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title || label}
      // `focus-visible` matters here: an opacity-0 button is still in the tab order,
      // so a keyboard user would otherwise be focused on something invisible.
      className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity sell-button"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0,
        padding: '5px 10px', borderRadius: 999, cursor: 'pointer',
        fontFamily: 'inherit', fontSize: '0.6875rem', fontWeight: 600,
        letterSpacing: '0.02em', lineHeight: 1,
        color: 'var(--color-danger)',
        background: 'color-mix(in srgb, var(--color-danger) 13%, transparent)',
        border: 'none',
        transition: 'background 0.15s ease, color 0.15s ease',
      }}
    >
      <ArrowUpRight size={12} strokeWidth={2.4} />
      {label}
    </button>
  );
}
