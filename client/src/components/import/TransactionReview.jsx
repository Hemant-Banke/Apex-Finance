import { useState } from 'react';
import { Check, ChevronLeft, Sparkles, ArrowRight, Pencil, X } from 'lucide-react';
import { transactionsAPI } from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/utils';
import CategoryPicker from '../forms/CategoryPicker';
import DatePicker from '../forms/DatePicker';

function toDateInput(iso) {
  return iso ? iso.split('T')[0] : new Date().toISOString().split('T')[0];
}

export default function TransactionReview({ data, accounts, accountId, onBack, onDone }) {
  const { transactions: raw, bankName, accountName, period, aiParsed } = data;

  const [rows, setRows] = useState(() =>
    raw.map(tx => ({
      ...tx,
      selected:   true,
      type:       tx.type,
      category:   tx.suggestedCategory || '',
      date:       toDateInput(tx.date),
      notes:      tx.notes || '',
      toAccount:  '',
      editing:    false,
    }))
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState('');
  const [done, setDone]             = useState(false);
  const [importedCount, setImportedCount] = useState(0);

  // Date-range filter — defaults to the full range of parsed transactions.
  const parsedDates = raw.map(tx => toDateInput(tx.date)).filter(Boolean).sort();
  const fullFrom = parsedDates[0] || '';
  const fullTo   = parsedDates[parsedDates.length - 1] || '';
  const [rangeFrom, setRangeFrom] = useState(fullFrom);
  const [rangeTo,   setRangeTo]   = useState(fullTo);
  const inRange = r => (!rangeFrom || r.date >= rangeFrom) && (!rangeTo || r.date <= rangeTo);

  const visibleRows  = rows.filter(inRange);
  const selected     = visibleRows.filter(r => r.selected);
  const totalIncome  = selected.filter(r => r.type === 'income').reduce((s, r) => s + r.amount, 0);
  const totalExpense = selected.filter(r => r.type === 'expense').reduce((s, r) => s + r.amount, 0);

  function patch(id, changes) {
    setRows(rs => rs.map(r => r.id === id ? { ...r, ...changes } : r));
  }

  // Select/deselect only the currently-visible (in-range) rows.
  function toggleAll(val) {
    setRows(rs => rs.map(r => inRange(r) ? { ...r, selected: val } : r));
  }

  async function handleImport() {
    const toImport = rows.filter(r => r.selected && inRange(r));
    if (!toImport.length) { setError('Select at least one transaction'); return; }

    // Validate transfers have destination
    const badTransfers = toImport.filter(r => r.type === 'transfer' && !r.toAccount);
    if (badTransfers.length) {
      setError(`${badTransfers.length} transfer(s) are missing a destination account. Please select one or change the type.`);
      return;
    }

    // Validate asset trades have units + price per unit
    const badAssets = toImport.filter(r =>
      (r.type === 'buy' || r.type === 'sell') && !(Number(r.units) > 0 && Number(r.pricePerUnit) > 0));
    if (badAssets.length) {
      setError(`${badAssets.length} asset trade(s) need units and a price per unit — expand the row to fill them, or deselect.`);
      return;
    }

    setSubmitting(true);
    setError('');
    let count = 0;
    const errors = [];

    for (const row of toImport) {
      try {
        const payload = {
          account: accountId,
          type:    row.type,
          date:    row.date,
          notes:   row.notes || undefined,
        };
        if (row.type === 'buy' || row.type === 'sell') {
          payload.units        = Number(row.units);
          payload.pricePerUnit = Number(row.pricePerUnit);
          payload.assetSymbol  = row.assetSymbol;
          payload.assetName    = row.assetName;
          payload.assetType    = row.assetType;
        } else {
          payload.amount   = row.amount;
          payload.category = row.category || undefined;
          if (row.type === 'transfer') payload.toAccount = row.toAccount;
        }
        await transactionsAPI.create(payload);
        count++;
      } catch (err) {
        errors.push(err.response?.data?.message || `Row ${count + 1} failed`);
      }
    }

    setSubmitting(false);
    setImportedCount(count);

    if (errors.length) {
      setError(`${count} imported, ${errors.length} failed: ${errors[0]}`);
    } else {
      setDone(true);
      setTimeout(() => onDone?.(), 1800);
    }
  }

  if (done) {
    return (
      <div style={{ padding: '40px 0', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
        <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--color-success-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Check size={22} style={{ color: 'var(--color-success)' }} />
        </div>
        <div>
          <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
            {importedCount} transaction{importedCount !== 1 ? 's' : ''} imported
          </p>
          <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 4 }}>Closing…</p>
        </div>
      </div>
    );
  }

  const allSelected  = visibleRows.length > 0 && visibleRows.every(r => r.selected);
  const noneSelected = visibleRows.every(r => !r.selected);
  const isFiltered   = rangeFrom !== fullFrom || rangeTo !== fullTo;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, minWidth: 0 }}>

      {/* Header summary */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)', fontWeight: 500 }}>
            {bankName}{accountName ? ` · ${accountName}` : ''}
          </p>
          {period?.from && (
            <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 2 }}>
              {formatDate(period.from)} – {formatDate(period.to)}
            </p>
          )}
        </div>
        <div style={{ display: 'flex', gap: 16, textAlign: 'right', flexShrink: 0 }}>
          <div>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Income</p>
            <p className="text-sm font-medium" style={{ color: 'var(--color-success)' }}>+{formatCurrency(totalIncome)}</p>
          </div>
          <div>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Expense</p>
            <p className="text-sm font-medium" style={{ color: 'var(--color-danger)' }}>{formatCurrency(totalExpense)}</p>
          </div>
        </div>
      </div>

      {/* Date range filter */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 130 }}>
          <label className="label block" style={{ marginBottom: 4 }}>From</label>
          <DatePicker value={rangeFrom} onChange={setRangeFrom} max={rangeTo || undefined} />
        </div>
        <div style={{ flex: 1, minWidth: 130 }}>
          <label className="label block" style={{ marginBottom: 4 }}>To</label>
          <DatePicker value={rangeTo} onChange={setRangeTo} min={rangeFrom || undefined} />
        </div>
        {isFiltered && (
          <button type="button"
            onClick={() => { setRangeFrom(fullFrom); setRangeTo(fullTo); }}
            className="text-xs"
            style={{ color: 'var(--color-text-muted)', background: 'none', border: 'none', cursor: 'pointer', paddingBottom: 10 }}>
            Reset range
          </button>
        )}
      </div>

      {/* AI-generated badge */}
      {aiParsed && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 12, padding: '7px 12px', borderRadius: 'var(--radius-sm)', background: 'var(--color-accent-muted)', border: '1px solid var(--color-accent-dim)' }}>
          <Sparkles size={12} style={{ color: 'var(--color-accent)', flexShrink: 0 }} />
          <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
            <span style={{ fontWeight: 600, color: 'var(--color-accent)' }}>AI-generated</span> — review dates, amounts, and categories before importing.
          </p>
        </div>
      )}

      {/* Select all row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', marginBottom: 4 }}>
        <Checkbox
          checked={allSelected}
          indeterminate={!allSelected && !noneSelected}
          onChange={v => toggleAll(v)}
        />
        <span className="text-xs" style={{ color: 'var(--color-text-muted)', flex: 1 }}>
          {selected.length} of {visibleRows.length} selected{isFiltered ? ` · ${rows.length - visibleRows.length} outside range` : ''}
        </span>
        <button type="button" onClick={onBack}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: 4 }}>
          <ChevronLeft size={12} /> Upload different file
        </button>
      </div>

      {/* Transaction rows */}
      <div style={{
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius)',
        overflow: 'hidden',
        maxHeight: 460,
        overflowY: 'auto',
      }}>
        {visibleRows.map((row, i) => (
          <ReviewRow
            key={row.id}
            row={row}
            accounts={accounts}
            accountId={accountId}
            isLast={i === visibleRows.length - 1}
            onChange={changes => patch(row.id, changes)}
          />
        ))}
        {visibleRows.length === 0 && (
          <div className="flex items-center justify-center" style={{ padding: '32px 24px' }}>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>No transactions in this date range</p>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <p className="text-xs" style={{ color: 'var(--color-danger)', marginTop: 12 }}>{error}</p>
      )}

      {/* Import button */}
      <button
        type="button"
        onClick={handleImport}
        disabled={submitting || !selected.length}
        className="btn-primary"
        style={{ width: '100%', padding: '11px 18px', marginTop: 16 }}
      >
        {submitting ? (
          <><div className="spinner" style={{ width: 15, height: 15, borderWidth: 2 }} /><span>Importing…</span></>
        ) : (
          <><span>Import {selected.length} transaction{selected.length !== 1 ? 's' : ''}</span><ArrowRight size={14} /></>
        )}
      </button>
    </div>
  );
}

// ─── Individual row ────────────────────────────────────────────────────────

function ReviewRow({ row, accounts, accountId, isLast, onChange }) {
  const [expanded, setExpanded] = useState(false);

  const isAsset = row.type === 'buy' || row.type === 'sell';
  const typeColor = {
    income:   'var(--color-success)',
    expense:  'var(--color-danger)',
    transfer: 'var(--color-chart-warm)',
    buy:      'var(--color-accent)',
    sell:     'var(--color-success)',
  }[row.type] || 'var(--color-text-secondary)';

  const sign = row.type === 'income' ? '+' : row.type === 'expense' ? '−' : '';
  const assetAmount = (Number(row.units) || 0) * (Number(row.pricePerUnit) || 0);

  return (
    <div style={{
      borderBottom: isLast ? 'none' : '1px solid var(--color-border-subtle)',
      opacity: row.selected ? 1 : 0.4,
      transition: 'opacity 0.15s',
    }}>
      {/* Main row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', minWidth: 0 }}>
        <Checkbox checked={row.selected} onChange={v => onChange({ selected: v })} />

        {/* Date */}
        <input
          type="date"
          value={row.date}
          onChange={e => onChange({ date: e.target.value })}
          style={{
            flexShrink: 0, width: 118, fontSize: '0.75rem', padding: '4px 8px',
            background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)', color: 'var(--color-text-secondary)',
            fontFamily: 'inherit', outline: 'none', colorScheme: 'dark',
          }}
        />

        {/* Description */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {isAsset ? (
            <>
              <p className="text-sm" style={{ color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {row.assetSymbol || row.assetName || 'Asset'}
              </p>
              <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {row.assetName ? `${row.assetName} · ` : ''}{row.units || 0} units{row.pricePerUnit ? ` @ ${formatCurrency(row.pricePerUnit)}` : ''}
              </p>
            </>
          ) : (
            <>
              <p className="text-sm" style={{ color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {row.description || row.narration}
              </p>
              {row.category && (
                <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 1 }}>
                  {formatCategoryDisplay(row.category)}
                </p>
              )}
            </>
          )}
        </div>

        {/* Type control */}
        {isAsset ? (
          <span style={{
            flexShrink: 0, padding: '3px 9px', fontSize: '0.6875rem', fontWeight: 600,
            borderRadius: 'var(--radius-pill)', background: 'var(--color-bg-elevated)', color: typeColor,
          }}>
            {row.type}
          </span>
        ) : (
          <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
            {['income','expense','transfer'].map(t => (
              <button key={t} type="button"
                onClick={() => onChange({ type: t, category: '' })}
                style={{
                  padding: '3px 8px', fontSize: '0.6875rem', fontWeight: 500,
                  borderRadius: 'var(--radius-pill)', border: 'none', cursor: 'pointer',
                  background: row.type === t ? 'var(--color-bg-elevated)' : 'transparent',
                  color: row.type === t ? typeColor : 'var(--color-text-muted)',
                  fontFamily: 'inherit',
                }}
              >
                {t}
              </button>
            ))}
          </div>
        )}

        {/* Amount */}
        <span style={{ flexShrink: 0, fontWeight: 600, fontSize: '0.875rem', color: typeColor, fontVariantNumeric: 'tabular-nums', minWidth: 80, textAlign: 'right' }}>
          {isAsset ? formatCurrency(assetAmount) : `${sign}${formatCurrency(row.amount)}`}
        </span>

        {/* Expand for details */}
        <button type="button" onClick={() => setExpanded(e => !e)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', padding: 2, flexShrink: 0 }}>
          <Pencil size={12} />
        </button>
      </div>

      {/* Expanded detail row */}
      {expanded && (
        <div style={{ padding: '0 14px 14px 14px', display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--color-bg-elevated)' }}>
          {/* Narration (read-only) */}
          <div>
            <p className="label" style={{ marginBottom: 4 }}>Original narration</p>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)', lineHeight: 1.5, fontFamily: 'monospace', wordBreak: 'break-all' }}>
              {row.narration}
            </p>
          </div>

          {/* Category (income/expense only) */}
          {(row.type === 'income' || row.type === 'expense') && (
            <div>
              <p className="label" style={{ marginBottom: 4 }}>Category</p>
              <CategoryPicker
                value={row.category}
                onChange={cat => onChange({ category: cat })}
                transactionType={row.type}
              />
            </div>
          )}

          {/* Asset trade — units & price per unit */}
          {isAsset && (
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <p className="label" style={{ marginBottom: 4 }}>Units</p>
                <input type="number" step="any" min="0" value={row.units ?? ''}
                  onChange={e => onChange({ units: e.target.value })}
                  className="input-field" style={{ fontSize: '0.8125rem' }} placeholder="0" />
              </div>
              <div style={{ flex: 1 }}>
                <p className="label" style={{ marginBottom: 4 }}>Price per unit</p>
                <input type="number" step="any" min="0" value={row.pricePerUnit ?? ''}
                  onChange={e => onChange({ pricePerUnit: e.target.value })}
                  className="input-field" style={{ fontSize: '0.8125rem' }} placeholder="0.00" />
              </div>
            </div>
          )}

          {/* Transfer destination */}
          {row.type === 'transfer' && (
            <div>
              <p className="label" style={{ marginBottom: 4 }}>Transfer to account</p>
              <select
                value={row.toAccount}
                onChange={e => onChange({ toAccount: e.target.value })}
                className="input-field"
                style={{ fontSize: '0.8125rem' }}
              >
                <option value="">Select destination…</option>
                {accounts.filter(a => a._id !== accountId).map(a => (
                  <option key={a._id} value={a._id}>{a.name} ({a.type})</option>
                ))}
              </select>
            </div>
          )}

          {/* Notes */}
          <div>
            <p className="label" style={{ marginBottom: 4 }}>Notes</p>
            <input
              type="text"
              value={row.notes}
              onChange={e => onChange({ notes: e.target.value })}
              className="input-field"
              style={{ fontSize: '0.8125rem' }}
              placeholder="Optional note"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function formatCategoryDisplay(code) {
  if (!code) return '';
  return code.split('/').map(part => {
    const clean = part.replace(/^t[sp]u?_/, '');
    return clean.charAt(0).toUpperCase() + clean.slice(1).replace(/_/g, ' ');
  }).join(' · ');
}

function Checkbox({ checked, indeterminate, onChange }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      style={{
        width: 18, height: 18, borderRadius: 4, flexShrink: 0,
        border: `2px solid ${checked || indeterminate ? 'var(--color-accent)' : 'var(--color-border-hover)'}`,
        background: checked ? 'var(--color-accent)' : indeterminate ? 'var(--color-accent-muted)' : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', padding: 0,
      }}
    >
      {checked && <Check size={11} style={{ color: 'var(--color-bg-primary)', strokeWidth: 3 }} />}
      {indeterminate && !checked && <span style={{ width: 8, height: 2, background: 'var(--color-accent)', borderRadius: 1, display: 'block' }} />}
    </button>
  );
}
