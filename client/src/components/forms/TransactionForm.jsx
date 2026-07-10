import { useState } from 'react';
import { transactionsAPI } from '../../lib/api';
import { formatCurrency, TRANSACTION_TYPES } from '../../lib/utils';
import { accountOptions } from '../../lib/accountPickerOptions';
import CategoryPicker from './CategoryPicker';
import TypePicker from './TypePicker';
import DatePicker from './DatePicker';
import { ArrowRight, ArrowDownLeft, ArrowUpRight, ArrowLeftRight, SlidersHorizontal } from 'lucide-react';

const TODAY = new Date().toISOString().split('T')[0];

// Type vocabulary for the segmented control — colour + icon per cash type.
const TYPE_META = {
  income:     { label: 'Income',     Icon: ArrowDownLeft,     color: 'var(--color-success)' },
  expense:    { label: 'Expense',    Icon: ArrowUpRight,      color: 'var(--color-danger)' },
  transfer:   { label: 'Transfer',   Icon: ArrowLeftRight,    color: 'var(--color-chart-warm)' },
  adjustment: { label: 'Adjustment', Icon: SlidersHorizontal, color: 'var(--color-accent)' },
};
const FORM_TYPE_KEYS = TRANSACTION_TYPES.filter(t => !['buy', 'sell'].includes(t.value)).map(t => t.value);

function toDateInput(date) {
  return new Date(date).toISOString().split('T')[0];
}

function initFromTransaction(tx) {
  return {
    type:      tx.type,
    amount:    String(tx.amount),
    category:  tx.category || '',
    date:      toDateInput(tx.date),
    notes:     tx.notes || '',
    toAccount: tx.toAccount?._id || tx.toAccount || '',
  };
}

const EMPTY_FORM = {
  type: 'income', amount: '', category: '', notes: '', toAccount: '',
  date: new Date().toISOString().split('T')[0],
};

/**
 * Create or edit a transaction.
 *
 * Props:
 *   accountId    – target account ID (create mode only)
 *   account      – full account object (for adjustment preview)
 *   allAccounts  – other accounts for transfer destination
 *   transaction  – existing transaction object → edit mode
 *   onSuccess    – called after successful submit
 */
export default function TransactionForm({ accountId, account, allAccounts = [], transaction, onSuccess }) {
  const isEdit = !!transaction;
  const [form, setForm]     = useState(isEdit ? initFromTransaction(transaction) : EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  const set = patch => setForm(f => ({ ...f, ...patch }));

  const isTransfer   = form.type === 'transfer';
  const isAdjustment = form.type === 'adjustment';
  const hasCategoryPicker = form.type === 'expense' || form.type === 'income';

  // Adjustment preview (only meaningful when we have the live account cash balance)
  const currentCash     = account?.cashBalance ?? account?.balance ?? null;
  const adjustedAmount  = parseFloat(form.amount) || 0;
  const afterAdjustment = currentCash !== null ? currentCash + adjustedAmount : null;

  const handleSubmit = async e => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const data = {
        type:     form.type,
        date:     form.date,
        notes:    form.notes   || undefined,
        category: form.category || undefined,
        amount:   parseFloat(form.amount),
      };
      if (isTransfer) data.toAccount = form.toAccount;
      if (!isEdit)    data.account   = accountId;

      if (isEdit) {
        await transactionsAPI.update(transaction._id, data);
      } else {
        await transactionsAPI.create(data);
      }

      if (!isEdit) setForm(EMPTY_FORM);
      onSuccess?.();
    } catch (err) {
      setError(
        err.response?.data?.message ||
        err.response?.data?.errors?.[0]?.msg ||
        (isEdit ? 'Failed to update transaction' : 'Failed to add transaction')
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Type — colour-coded segmented control */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
        {FORM_TYPE_KEYS.map(k => {
          const m = TYPE_META[k];
          const on = form.type === k;
          return (
            <button key={k} type="button"
              onClick={() => set({ type: k, amount: '', category: '' })}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
                padding: '10px 4px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                fontFamily: 'inherit', fontSize: '0.6875rem', fontWeight: 600,
                border: `1px solid ${on ? m.color : 'var(--color-border)'}`,
                background: on ? `color-mix(in srgb, ${m.color} 12%, transparent)` : 'var(--color-bg-elevated)',
                color: on ? m.color : 'var(--color-text-muted)',
                boxShadow: on ? `inset 0 0 0 1px ${m.color}` : 'var(--elev-ring)',
                transition: 'all 0.15s ease',
              }}>
              <m.Icon size={16} strokeWidth={2.2} /> {m.label}
            </button>
          );
        })}
      </div>

      {/* Hero amount — the figure the whole slip is about */}
      <div className="txn-amount">
        <span className="txn-amount-mark">₹</span>
        <input
          type="number" step="any" min={isAdjustment ? undefined : '0'}
          value={form.amount}
          onChange={e => set({ amount: e.target.value })}
          placeholder="0.00" required autoFocus
          className="txn-amount-input"
        />
        {isAdjustment && (
          <span className="txn-amount-hint">+ adds · − subtracts</span>
        )}
      </div>

      {/* Transfer destination */}
      {isTransfer && (
        <div className="field">
          <label className="label">To account</label>
          <TypePicker
            options={accountOptions(allAccounts)}
            value={form.toAccount}
            onChange={v => set({ toAccount: v })}
            placeholder="Select destination account"
            searchable={allAccounts.length > 6}
          />
        </div>
      )}

      {/* Adjustment preview */}
      {isAdjustment && currentCash !== null && (
        <div style={{ padding: '11px 14px', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg-input)', border: '1px solid var(--color-border)', boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className="flex justify-between">
            <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Current cash</span>
            <span className="figure text-xs" style={{ color: 'var(--color-text-secondary)' }}>{formatCurrency(currentCash)}</span>
          </div>
          {form.amount !== '' && (
            <div className="flex justify-between" style={{ paddingTop: 6, borderTop: '1px solid var(--color-border-subtle)' }}>
              <span className="text-xs" style={{ color: 'var(--color-text-secondary)', fontWeight: 500 }}>After adjustment</span>
              <span className="figure text-xs" style={{ fontWeight: 600, color: afterAdjustment < 0 ? 'var(--color-danger)' : 'var(--color-success)' }}>{formatCurrency(afterAdjustment)}</span>
            </div>
          )}
        </div>
      )}

      {/* Category */}
      {hasCategoryPicker && (
        <div className="field">
          <label className="label">Category</label>
          <CategoryPicker value={form.category} onChange={cat => set({ category: cat })} transactionType={form.type} />
        </div>
      )}

      {/* Date + Notes */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="field">
          <label className="label">Date</label>
          <DatePicker value={form.date} onChange={v => set({ date: v })} max={TODAY} />
        </div>
        <div className="field">
          <label className="label">Note</label>
          <input type="text" value={form.notes} onChange={e => set({ notes: e.target.value })}
            className="input-field" placeholder="Optional" />
        </div>
      </div>

      {error && <p className="text-xs" style={{ color: 'var(--color-danger)' }}>{error}</p>}

      <button type="submit" disabled={saving} className="btn-gold"
        style={{ width: '100%', padding: '12px 18px', marginTop: 4 }}>
        {saving
          ? <div className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
          : <><span>{isEdit ? 'Save changes' : 'Add transaction'}</span><ArrowRight size={15} /></>
        }
      </button>
    </form>
  );
}
