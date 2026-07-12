import { useState } from 'react';
import { Check, ChevronLeft, Sparkles, ArrowRight, Pencil, RotateCcw, AlertCircle } from 'lucide-react';
import { transactionsAPI } from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/utils';
import CategoryPicker from '../forms/CategoryPicker';
import DatePicker, { DateRangePicker } from '../forms/DatePicker';
import TypePicker from '../forms/TypePicker';
import MarketSearch from '../market/MarketSearch';
import Modal from '../ui/Modal';
import { accountOptions } from '../../lib/accountPickerOptions';

const TODAY = new Date().toISOString().split('T')[0];

const TYPE_PILL_COLOR = {
  income: 'var(--color-success)',
  expense: 'var(--color-danger)',
  transfer: 'var(--color-chart-warm)',
};

function toDateInput(iso) {
  return iso ? iso.split('T')[0] : new Date().toISOString().split('T')[0];
}

export default function TransactionReview({ data, accounts, accountId, onBack, onDone }) {
  const { transactions: raw, bankName, accountName, aiParsed } = data;

  const today = new Date().toISOString().split('T')[0];

  const [rows, setRows] = useState(() =>
    raw
      // Never import future-dated transactions (a statement can't contain them;
      // usually a mis-parsed year). The server rejects them too.
      .filter(tx => toDateInput(tx.date) <= today)
      .map(tx => ({
        ...tx,
        selected:   true,
        type:       tx.type,
        category:   tx.suggestedCategory || '',
        date:       toDateInput(tx.date),
        notes:      tx.notes || '',
        toAccount:  '',
        editing:    false,
        // Whether the trade settles against the account's cash. A buy is tracked
        // independently of cash by default (the money usually left a different
        // account); a sell's proceeds land in this one. Same default as the manual
        // asset form — overridable per row below.
        usesCashBalance: tx.type === 'sell',
      }))
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState('');
  const [done, setDone]             = useState(false);
  const [importedCount, setImportedCount] = useState(0);

  // Date-range filter — defaults to the full range of parsed (non-future) transactions.
  const parsedDates = raw.map(tx => toDateInput(tx.date)).filter(d => d && d <= today).sort();
  const fullFrom = parsedDates[0] || '';
  const fullTo   = parsedDates[parsedDates.length - 1] || '';
  const [rangeFrom, setRangeFrom] = useState(fullFrom);
  const [rangeTo,   setRangeTo]   = useState(fullTo);
  const inRange = r => (!rangeFrom || r.date >= rangeFrom) && (!rangeTo || r.date <= rangeTo);

  const visibleRows  = rows.filter(inRange);
  const selected     = visibleRows.filter(r => r.selected);

  // In / Out = value entering or leaving the SYSTEM because of this statement.
  //
  //   income                     → in
  //   expense                    → out
  //   buy  NOT settled in cash   → in   (the asset arrived; no cash of ours paid for
  //                                      it, so value came from outside the system)
  //   sell NOT settled in cash   → out  (the asset left and its proceeds went outside)
  //   buy / sell settled in cash → nothing (cash and asset just swap places INSIDE
  //                                      the system — the net position is unchanged)
  const tradeValue = (r) => (Number(r.units) || 0) * (Number(r.pricePerUnit) || 0);
  const externalTrade = (r) => (r.usesCashBalance ? 0 : tradeValue(r));

  const totalIncome = selected.reduce((s, r) =>
    s + (r.type === 'income' ? r.amount : r.type === 'buy' ? externalTrade(r) : 0), 0);
  const totalExpense = selected.reduce((s, r) =>
    s + (r.type === 'expense' ? r.amount : r.type === 'sell' ? externalTrade(r) : 0), 0);

  function patch(id, changes) {
    setRows(rs => rs.map(r => r.id === id ? { ...r, ...changes } : r));
    // If a row's date is edited outside the active filter window, widen the
    // window so the row it belongs to doesn't silently drop out of view.
    if (changes.date) {
      if (rangeFrom && changes.date < rangeFrom) setRangeFrom(changes.date);
      if (rangeTo && changes.date > rangeTo)     setRangeTo(changes.date);
    }
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
          payload.usesCashBalance = !!row.usesCashBalance;
          // A foreign-quoted asset's price is NATIVE — without this the server
          // would book a USD figure as rupees.
          if (row.currency && row.currency !== 'INR') payload.currency = row.currency;
        } else {
          payload.amount   = row.amount;
          payload.category = row.category || undefined;
          // Original bank narration — used server-side to learn this user's
          // categorization habits (not persisted on the transaction).
          payload.narration = row.narration || row.description || undefined;
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, minWidth: 0, flex: 1, minHeight: 0 }}>

      {/* Header summary — source identity + selected totals on one recessed strip */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        marginBottom: 14, flexWrap: 'wrap', flexShrink: 0,
        padding: '12px 16px', borderRadius: 'var(--radius)',
        background: 'var(--color-bg-input)', border: '1px solid var(--color-border)',
        boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.22)',
      }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-primary)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {bankName}{accountName ? ` · ${accountName}` : ''}
          </p>
          {/* Editable date-range filter — "from – to" with an edit affordance */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
            <DateRangePicker
              value={{ from: rangeFrom, to: rangeTo }}
              onChange={({ from, to }) => { setRangeFrom(from || fullFrom); setRangeTo(to || fullTo); }}
              min={fullFrom}
              max={TODAY}
              trigger={({ open, toggle }) => (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={toggle}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                    fontSize: '0.75rem', fontFamily: 'var(--font-mono)',
                    color: open || isFiltered ? 'var(--color-accent)' : 'var(--color-text-muted)',
                  }}
                >
                  <span>{formatDate(rangeFrom)} – {formatDate(rangeTo)}</span>
                  <Pencil size={11} style={{ opacity: open ? 1 : 0.7 }} />
                </span>
              )}
            />
            {isFiltered && (
              <button type="button" title="Reset range" aria-label="Reset range"
                onClick={() => { setRangeFrom(fullFrom); setRangeTo(fullTo); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'inline-flex', padding: 0 }}>
                <RotateCcw size={12} />
              </button>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 20, textAlign: 'right', flexShrink: 0 }}>
          <div>
            <p style={{ fontSize: '0.625rem', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 3 }}>In</p>
            <p className="figure" style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-success)' }}>+{formatCurrency(totalIncome)}</p>
          </div>
          <div>
            <p style={{ fontSize: '0.625rem', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 3 }}>Out</p>
            <p className="figure" style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-danger)' }}>−{formatCurrency(totalExpense)}</p>
          </div>
        </div>
      </div>

      {/* Select all row — the AI-generated badge rides along here as a pill rather
          than a full-width banner, which cost a whole row of vertical space. The
          caution it carried lives on as its tooltip. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', marginBottom: 4, flexShrink: 0 }}>
        <Checkbox
          checked={allSelected}
          indeterminate={!allSelected && !noneSelected}
          onChange={v => toggleAll(v)}
        />
        <span className="text-xs" style={{ color: 'var(--color-text-muted)', flex: 1 }}>
          {selected.length} of {visibleRows.length} selected{isFiltered ? ` · ${rows.length - visibleRows.length} outside range` : ''}
        </span>
        {aiParsed && (
          <span
            title="Parsed by AI — check dates, amounts and categories before importing."
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0,
              padding: '3px 8px', borderRadius: 999,
              fontSize: '0.625rem', fontWeight: 600, letterSpacing: '0.04em',
              color: 'var(--color-accent)',
              background: 'var(--color-accent-muted)',
              border: '1px solid var(--color-accent-dim)',
              cursor: 'default',
            }}>
            <Sparkles size={10} /> AI-generated
          </span>
        )}
        <button type="button" onClick={onBack}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: 4 }}>
          <ChevronLeft size={12} /> Upload different file
        </button>
      </div>

      {/* Transaction rows — the only scrollable region; the modal itself stays fixed */}
      <div style={{
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius)',
        overflow: 'hidden',
        flex: '1 1 auto',
        minHeight: 180,
        maxHeight: 'min(42vh, 380px)',
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
        <p className="text-xs" style={{ color: 'var(--color-danger)', marginTop: 12, flexShrink: 0 }}>{error}</p>
      )}

      {/* Import button */}
      <button
        type="button"
        onClick={handleImport}
        disabled={submitting || !selected.length}
        className="btn-primary"
        style={{ width: '100%', padding: '11px 18px', marginTop: 16, flexShrink: 0 }}
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
  const [pickerOpen, setPickerOpen] = useState(false);   // Find-an-asset dialog

  const isAsset = row.type === 'buy' || row.type === 'sell';
  const typeColor = {
    income:   'var(--color-success)',
    expense:  'var(--color-danger)',
    transfer: 'var(--color-chart-warm)',
    buy:      'var(--color-success)',
    sell:     'var(--color-danger)',
  }[row.type] || 'var(--color-text-secondary)';

  const sign = row.type === 'income' ? '+' : row.type === 'expense' ? '−' : '';
  const assetAmount = (Number(row.units) || 0) * (Number(row.pricePerUnit) || 0);

  // A short flag when the row needs manual input before it can import.
  // The symbol flags come from the server's symbolResolver: an asset it could not
  // match to a real ticker, or one it matched by name where the traded NAV did not
  // line up (usually a fund plan Yahoo does not list) — both need a human look.
  const needsReview =
    (row.type === 'transfer' && !row.toAccount) ? 'Needs account'
    : (isAsset && !(Number(row.units) > 0 && Number(row.pricePerUnit) > 0)) ? 'Needs price'
    : row.symbolUnresolved ? 'Unknown ticker'
    : row.symbolAmbiguous ? 'Check ticker'
    : null;

  return (
    <div style={{
      borderBottom: isLast ? 'none' : '1px solid var(--color-border-subtle)',
      opacity: row.selected ? 1 : 0.4,
      transition: 'opacity 0.15s',
    }}>
      {/* Collapsed row — clean, scannable. A colored rail marks the type. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px 11px 0', minWidth: 0 }}>
        {/* Type rail */}
        <span style={{ width: 3, alignSelf: 'stretch', background: typeColor, borderRadius: '0 2px 2px 0', flexShrink: 0, opacity: row.selected ? 1 : 0.5 }} />
        <div style={{ paddingLeft: 3 }}><Checkbox tone="plain" checked={row.selected} onChange={v => onChange({ selected: v })} /></div>

        {/* Description + meta */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={{ fontSize: '0.625rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: typeColor, flexShrink: 0 }}>
              {row.type}
            </span>
            <p className="text-sm" style={{ color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
              {isAsset ? (row.assetName || row.assetSymbol || 'Asset') : (row.description || row.narration)}
            </p>
            {needsReview && (
              <span className="badge" style={{ flexShrink: 0, gap: 4, background: 'var(--color-chart-warm)', color: '#1A1408', fontWeight: 600 }}>
                <AlertCircle size={10} /> {needsReview}
              </span>
            )}
          </div>
          <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <span className="figure">{row.date}</span>
            {/* The resolved ticker rides on the detail line — it is the reference,
                not the identity, and for a fund it is an opaque Morningstar code. */}
            {isAsset && row.assetSymbol && <> · <span className="figure">{row.assetSymbol}</span></>}
            {isAsset
              ? ` · ${row.units || 0} units${row.pricePerUnit ? ` @ ${formatCurrency(row.pricePerUnit)}` : ''}`
              : (row.category ? ` · ${formatCategoryDisplay(row.category)}` : '')}
          </p>
        </div>

        {/* Amount */}
        <span className="figure" style={{ flexShrink: 0, fontWeight: 600, fontSize: '0.9375rem', color: typeColor, minWidth: 84, textAlign: 'right' }}>
          {isAsset ? formatCurrency(assetAmount) : `${sign}${formatCurrency(row.amount)}`}
        </span>

        {/* Edit */}
        <button type="button" onClick={() => setExpanded(e => !e)}
          className="btn-icon btn-icon-sm" title="Edit details" aria-label="Edit details"
          style={{ flexShrink: 0, ...(expanded ? { borderColor: 'var(--color-accent)', color: 'var(--color-accent)' } : null) }}>
          <Pencil size={14} />
        </button>
      </div>

      {/* Expanded editor */}
      {expanded && (
        <div style={{ padding: '4px 16px 16px 22px', display: 'flex', flexDirection: 'column', gap: 12, background: 'var(--color-bg-input)', borderTop: '1px solid var(--color-border-subtle)' }}>
          {/* Cash — type + date */}
          {!isAsset && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, paddingTop: 12 }}>
              <div className="field">
                <label className="label">Type</label>
                {/* The pill row fills the field's remaining height, so it lines up
                    with the DatePicker's input beside it whatever that measures. */}
                <div style={{ display: 'flex', gap: 4, flex: 1 }}>
                  {['income','expense','transfer'].map(t => {
                    const c = TYPE_PILL_COLOR[t];
                    const on = row.type === t;
                    return (
                      <button key={t} type="button" onClick={() => onChange({ type: t, category: '' })}
                        style={{
                          flex: 1, padding: '0 4px', fontSize: '0.6875rem', fontWeight: 600, textTransform: 'capitalize',
                          borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontFamily: 'inherit',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          border: `1px solid ${on ? c : 'var(--color-border)'}`,
                          background: on ? `color-mix(in srgb, ${c} 15%, transparent)` : 'var(--color-bg-elevated)',
                          color: on ? c : 'var(--color-text-muted)',
                        }}>
                        {t}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="field">
                <label className="label">Date</label>
                <DatePicker value={row.date} onChange={v => onChange({ date: v })} max={TODAY} />
              </div>
            </div>
          )}

          {/* Asset — the figures first (date, units, price), then what it is.
              Two compact rows; picking a different instrument opens the full
              Find-an-asset dialog rather than cramming a search box in here. */}
          {isAsset && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr 1fr', gap: 12, paddingTop: 12 }}>
                <div className="field">
                  <label className="label">Date</label>
                  <DatePicker value={row.date} onChange={v => onChange({ date: v })} max={TODAY} />
                </div>
                <div className="field">
                  <label className="label">Units</label>
                  <input type="number" step="any" min="0" value={row.units ?? ''}
                    onChange={e => onChange({ units: e.target.value })}
                    className="input-field" style={{ fontFamily: 'var(--font-mono)' }} placeholder="0" />
                </div>
                <div className="field">
                  <label className="label">
                    Price
                    <span style={{ marginLeft: 4, color: 'var(--color-accent)', fontWeight: 600 }}>
                      {row.currency && row.currency !== 'INR' ? `(${row.currency})` : ''}
                    </span>
                  </label>
                  <input type="number" step="any" min="0" value={row.pricePerUnit ?? ''}
                    onChange={e => onChange({ pricePerUnit: e.target.value })}
                    className="input-field" style={{ fontFamily: 'var(--font-mono)' }} placeholder="0.00" />
                </div>
              </div>

              {/* Same grid as the row above, so the columns line up exactly: Asset
                  spans Date+Units, Note sits under Price. `minWidth: 0` is what pins
                  them — a grid item defaults to min-width:auto, so a long fund name
                  would otherwise force its column wider and crush Note. */}
              <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr 1fr', gap: 12, alignItems: 'start' }}>
                <div className="field" style={{ minWidth: 0, gridColumn: 'span 2' }}>
                  <label className="label">Asset</label>
                  <button type="button" onClick={() => setPickerOpen(true)}
                    className="input-field"
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                      cursor: 'pointer', textAlign: 'left', minWidth: 0,
                    }}>
                    <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                      {/* A long plan name wraps to a second line inside the fixed
                          column rather than stretching it. */}
                      <span style={{
                        lineHeight: 1.3,
                        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                        overflow: 'hidden', overflowWrap: 'anywhere',
                      }}>
                        {row.assetName || row.assetSymbol || 'Choose an asset'}
                      </span>
                      {row.assetSymbol && (
                        <span className="figure" style={{ color: 'var(--color-text-muted)', fontSize: '0.6875rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {row.assetSymbol}
                        </span>
                      )}
                    </span>
                    <span style={{ flexShrink: 0, color: 'var(--color-accent)', fontSize: '0.75rem' }}>Change</span>
                  </button>
                </div>
                <div className="field" style={{ minWidth: 0 }}>
                  <label className="label">Note</label>
                  <input type="text" value={row.notes} onChange={e => onChange({ notes: e.target.value })}
                    className="input-field" placeholder="Optional" />
                </div>
              </div>

              {/* Settle against cash — off for a buy, on for a sell, the same
                  convention as the manual asset form. Drives the In/Out totals.
                  Checkbox is itself a <button>, so the label is a span beside it
                  rather than a wrapping button (which would nest buttons). */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, alignSelf: 'flex-start' }}>
                <Checkbox tone="plain" checked={!!row.usesCashBalance}
                  onChange={v => onChange({ usesCashBalance: v })} />
                <span onClick={() => onChange({ usesCashBalance: !row.usesCashBalance })}
                  className="text-xs" style={{ color: 'var(--color-text-secondary)', cursor: 'pointer' }}>
                  Settle against account cash{' '}
                  <span style={{ color: 'var(--color-text-muted)' }}>
                    ({row.type === 'buy' ? 'deduct cost' : 'add proceeds'})
                  </span>
                </span>
              </div>
            </>
          )}

          {/* Category / destination + Note — one row */}
          {!isAsset && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignItems: 'start' }}>
              {row.type === 'transfer' ? (
                <div className="field">
                  <label className="label">Transfer to account</label>
                  <TypePicker
                    options={accountOptions(accounts.filter(a => a._id !== accountId))}
                    value={row.toAccount}
                    onChange={v => onChange({ toAccount: v })}
                    placeholder="Select destination…"
                    searchable={accounts.length > 7}
                  />
                </div>
              ) : (
                <div className="field">
                  <label className="label">Category</label>
                  <CategoryPicker value={row.category} onChange={cat => onChange({ category: cat })} transactionType={row.type} />
                </div>
              )}
              <div className="field">
                <label className="label">Note</label>
                <input type="text" value={row.notes} onChange={e => onChange({ notes: e.target.value })}
                  className="input-field" placeholder="Optional" />
              </div>
            </div>
          )}

          {/* Narration (read-only) */}
          {row.narration && (
            <p className="text-xs" style={{ color: 'var(--color-text-muted)', lineHeight: 1.5, fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>
              {row.narration}
            </p>
          )}
        </div>
      )}

      {/* Re-pick the instrument in the full Find-an-asset dialog — the same one the
          Add-asset flow uses — so the search has room to breathe instead of being
          wedged into the row. */}
      <Modal open={pickerOpen} onClose={() => setPickerOpen(false)}
        align="top" wide
        className="modal-fade-down"
        eyebrow="Import"
        title="Find an asset"
        subtitle="Search stocks, ETFs, crypto and mutual funds — pick the one this row should book against.">
        <MarketSearch
          autoFocus
          onSelect={(sec) => {
            onChange({
              assetSymbol: sec.symbol,
              assetName:   sec.name,
              assetType:   sec.type,
              currency:    sec.currency && sec.currency !== 'INR' ? sec.currency : undefined,
              // The user has chosen outright — the resolver's doubts no longer apply.
              symbolUnresolved: false,
              symbolAmbiguous:  false,
            });
            setPickerOpen(false);
          }}
        />
      </Modal>
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

function Checkbox({ checked, indeterminate, onChange, tone = 'accent' }) {
  // 'accent' — the master select-all: gilt, filled when checked (the primary
  // control). 'plain' — per-row: when checked it stays an outlined square with
  // just a white tick (no filled background), so rows read lighter than the
  // master. Unchecked states are an empty square with a greyish border.
  const isPlain = tone === 'plain';
  const on = tone === 'accent'
    ? { line: 'var(--color-accent)', fill: 'var(--color-accent)', tick: 'var(--color-bg-primary)' }
    : { line: 'var(--color-text-primary)', fill: 'var(--color-text-primary)', tick: 'var(--color-bg-primary)' };
  const active = checked || indeterminate;
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      style={{
        width: 18, height: 18, borderRadius: 4, flexShrink: 0,
        border: active
          ? `2px solid ${isPlain ? 'var(--color-text-muted)' : on.line}`
          : `2px solid ${isPlain ? 'var(--color-border)' : 'var(--color-border-hover)'}`,
        background: checked
          ? (isPlain ? 'transparent' : on.fill)
          : indeterminate ? 'var(--color-accent-muted)' : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', padding: 0,
      }}
    >
      {checked && <Check size={12} style={{ color: isPlain ? on.line : on.tick, strokeWidth: 3 }} />}
      {indeterminate && !checked && <span style={{ width: 8, height: 2, background: on.line, borderRadius: 1, display: 'block' }} />}
    </button>
  );
}
