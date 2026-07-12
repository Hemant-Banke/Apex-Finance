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
 */
export default function TransactionRow({ tx, subtitle, badge = false, onEdit, onDelete, divided = false }) {
  const { label } = useCategoryNames();

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
          {getTransactionName(tx, label)}
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
        {getTransactionSign(tx.type)}{formatCurrency(tx.amount)}
      </span>

      {onEdit && (
        <button
          onClick={() => onEdit(tx)}
          className="opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ ...actionStyle, marginLeft: 8 }}
        >
          <Pencil size={13} />
        </button>
      )}
      {onDelete && (
        <button
          onClick={() => onDelete(tx)}
          className="opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ ...actionStyle, marginLeft: 4 }}
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
}
