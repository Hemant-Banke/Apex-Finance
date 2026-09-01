import { Pencil, X } from 'lucide-react';
import { formatCurrency, getTransactionColor, getTransactionSign, getTransactionName } from '../../lib/utils';
import { useCategoryNames } from '../../lib/categoryNames';

/**
 * One transaction in a list — the Dashboard's recent feed, the Transactions page and
 * an account's history all render the same thing: the name, a muted subtitle, the
 * signed amount in its type's colour, and (where the list is editable) actions that
 * appear on hover.
 *
 * Only the SUBTITLE genuinely differs between the three — the account and date, or the
 * type and destination, or the asset and units — so it is passed in as a node rather
 * than reconstructed from flags. `onEdit`/`onDelete` are optional: a read-only feed
 * simply omits them and gets no hover affordances.
 *
 * `incoming` is for TRANSFERS only, and only where the list is read from one account's
 * point of view: a transfer is money in for the destination and money out for the
 * source, and the same row means both depending on where you are standing. Leave it
 * undefined in an account-agnostic list and the row shows no direction, as before.
 *
 * `reserveActions` keeps the action gutter even on a row that has no handlers. The
 * buttons are `opacity-0` until hover but still OCCUPY their space, so a row without
 * them let its amount slide ~50px further right than every other row in the list —
 * which is exactly what happened to incoming transfers, the one row type here that is
 * deliberately read-only. Set it on any list where some rows are actionable and some
 * are not; a wholly read-only feed leaves it off and gives up no space.
 */
export default function TransactionRow({ tx, subtitle, badge = false, incoming, onEdit, onDelete, reserveActions = false, divided = false }) {
  const { label } = useCategoryNames();

  // One action button's footprint (13px icon + 4px padding each side), so an empty
  // slot measures exactly the same as a filled one.
  const SLOT = { width: 21, height: 21, display: 'block' };

  const actionStyle = {
    color: 'var(--color-text-muted)',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: 4,
  };

  return (
    <div
      className="data-row group"
      style={{
        padding: '12px 24px',
        borderTop: divided ? '1px solid var(--color-border-subtle)' : 'none',
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <p className="text-sm truncate" style={{ color: 'var(--color-text-primary)' }}>
          {getTransactionName(tx, label, incoming)}
        </p>
        <p className="text-xs truncate" style={{ color: 'var(--color-text-muted)', marginTop: 2 }}>
          {subtitle}
        </p>
      </div>

      {badge && <span className="badge badge-default" style={{ marginRight: 12 }}>{tx.type}</span>}

      <span
        className={`figure text-sm ${getTransactionColor(tx.type)}`}
        style={{ marginLeft: 16, fontWeight: 500 }}
      >
        {getTransactionSign(tx.type, incoming)}{formatCurrency(tx.amount)}
      </span>

      {/* The action gutter. Rendered as one fixed-width slot so every amount in a
          list stops at the same x, whether or not that row can be edited. */}
      {(onEdit || onDelete || reserveActions) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 8, flexShrink: 0 }}>
          {onEdit
            ? <button onClick={() => onEdit(tx)} title="Edit" aria-label="Edit transaction"
                className="opacity-0 group-hover:opacity-100 transition-opacity" style={actionStyle}>
                <Pencil size={13} />
              </button>
            : <span style={SLOT} aria-hidden />}
          {onDelete
            ? <button onClick={() => onDelete(tx)} title="Delete" aria-label="Delete transaction"
                className="opacity-0 group-hover:opacity-100 transition-opacity" style={actionStyle}>
                <X size={13} />
              </button>
            : <span style={SLOT} aria-hidden />}
        </div>
      )}
    </div>
  );
}
