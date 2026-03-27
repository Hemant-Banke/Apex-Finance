import { useState } from 'react';
import { transactionsAPI } from '../../lib/api';
import {
  formatCurrency,
  TRANSACTION_TYPES, EXPENSE_CATEGORIES, INCOME_CATEGORIES
} from '../../lib/utils';
import { ArrowRight } from 'lucide-react';

const FORM_TYPES = TRANSACTION_TYPES.filter(t => !['buy', 'sell'].includes(t.value));

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
  const cats = form.type === 'expense' ? EXPENSE_CATEGORIES
             : form.type === 'income'  ? INCOME_CATEGORIES
             : [];

  // Adjustment preview (only meaningful when we have the live account balance)
  const currentCash     = account?.balance ?? null;
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

      {/* Type pills */}
      <div>
        <label className="label block" style={{ marginBottom: 8 }}>Type</label>
        <div className="pill-group" style={{ display: 'flex', flexWrap: 'wrap' }}>
          {FORM_TYPES.map(t => (
            <button key={t.value} type="button"
              onClick={() => set({ type: t.value, amount: '', category: '' })}
              className={`pill-item ${form.type === t.value ? 'active' : ''}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Transfer */}
      {isTransfer && (
        <>
          <div>
            <label className="label block" style={{ marginBottom: 8 }}>To account</label>
            <select value={form.toAccount} onChange={e => set({ toAccount: e.target.value })}
              className="input-field" required>
              <option value="">Select destination account</option>
              {allAccounts.map(a => (
                <option key={a._id} value={a._id}>{a.name} ({a.type})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label block" style={{ marginBottom: 8 }}>Amount</label>
            <input type="number" step="any" min="0" value={form.amount}
              onChange={e => set({ amount: e.target.value })}
              className="input-field" placeholder="₹ 0.00" required />
          </div>
        </>
      )}

      {/* Adjustment */}
      {isAdjustment && (
        <>
          {currentCash !== null && (
            <div style={{ padding: '12px 16px', borderRadius: 8, background: 'var(--color-bg-elevated)', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div className="flex justify-between">
                <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Current cash</span>
                <span className="text-xs font-medium tabular-nums" style={{ color: 'var(--color-text-primary)' }}>
                  {formatCurrency(currentCash)}
                </span>
              </div>
              {form.amount !== '' && (
                <div className="flex justify-between">
                  <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>After adjustment</span>
                  <span className="text-xs font-medium tabular-nums"
                    style={{ color: afterAdjustment < 0 ? 'var(--color-danger)' : 'var(--color-text-primary)' }}>
                    {formatCurrency(afterAdjustment)}
                  </span>
                </div>
              )}
            </div>
          )}
          <div>
            <label className="label block" style={{ marginBottom: 8 }}>
              Adjustment amount
              <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}> (positive to add · negative to subtract)</span>
            </label>
            <input type="number" step="any" value={form.amount}
              onChange={e => set({ amount: e.target.value })}
              className="input-field" placeholder="e.g. 500 or -200" required />
          </div>
        </>
      )}

      {/* Income / Expense amount */}
      {!isTransfer && !isAdjustment && (
        <div>
          <label className="label block" style={{ marginBottom: 8 }}>Amount</label>
          <input type="number" step="any" min="0" value={form.amount}
            onChange={e => set({ amount: e.target.value })}
            className="input-field" placeholder="₹ 0.00" required />
        </div>
      )}

      {/* Category */}
      {cats.length > 0 && (
        <div>
          <label className="label block" style={{ marginBottom: 8 }}>Category</label>
          <select value={form.category} onChange={e => set({ category: e.target.value })} className="input-field">
            <option value="">Select category</option>
            {cats.map(c => (
              <option key={c} value={c}>
                {c.charAt(0).toUpperCase() + c.slice(1).replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Date */}
      <div>
        <label className="label block" style={{ marginBottom: 8 }}>Date</label>
        <input type="date" value={form.date} onChange={e => set({ date: e.target.value })}
          className="input-field" />
      </div>

      {/* Notes */}
      <div>
        <label className="label block" style={{ marginBottom: 8 }}>Notes</label>
        <input type="text" value={form.notes} onChange={e => set({ notes: e.target.value })}
          className="input-field" placeholder="Optional" />
      </div>

      {error && <p className="text-xs" style={{ color: 'var(--color-danger)' }}>{error}</p>}

      <button type="submit" disabled={saving} className="btn-primary"
        style={{ width: '100%', padding: '11px 18px', marginTop: 4 }}>
        {saving
          ? <div className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
          : <><span>{isEdit ? 'Save changes' : 'Add transaction'}</span><ArrowRight size={15} /></>
        }
      </button>
    </form>
  );
}
