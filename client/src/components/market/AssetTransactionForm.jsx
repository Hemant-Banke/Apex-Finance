import { useState, useEffect } from 'react';
import { marketAPI, transactionsAPI } from '../../lib/api';
import { formatCurrency, ASSET_TYPES } from '../../lib/utils';
import { ArrowLeft, ArrowRight, RotateCcw } from 'lucide-react';

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

const TYPE_LABEL = {
  stock: 'Stock', etf: 'ETF', crypto: 'Crypto', mutual_fund: 'Mutual Fund',
  bond: 'Bond', commodity: 'Commodity', gold: 'Gold', fd: 'Fixed Deposit',
  epf_nps: 'EPF / NPS', other: 'Other'
};

// Symbols that use manual entry (no price API lookup)
const MANUAL_PREFIXES = ['REAL-', 'FIXED-', 'EPF-', 'PHYS-', 'PRIVATE-', 'UNLISTED-', 'OTHER-'];
function isManualSymbol(symbol) {
  return MANUAL_PREFIXES.some(p => (symbol || '').startsWith(p));
}

/**
 * AssetTransactionForm
 *
 * Create mode:  pass security + accounts + defaultAccountId + onBack + onSuccess
 * Edit mode:    pass transaction + accounts + onSuccess  (security derived from tx)
 */
export default function AssetTransactionForm({
  security: securityProp,
  transaction,          // present in edit mode
  accounts = [],
  defaultAccountId,
  onBack,
  onSuccess
}) {
  const isEdit = !!transaction;

  // Derive security from the existing transaction in edit mode
  const security = isEdit
    ? {
        symbol:   transaction.assetSymbol,
        name:     transaction.assetName || transaction.assetSymbol,
        type:     transaction.assetType || 'other',
        isManual: isManualSymbol(transaction.assetSymbol)
      }
    : securityProp;

  const isManual       = !!security?.isManual;
  const nonDebtAccounts = accounts.filter(a => !a.isDebt);

  // Resolve the account ID from a populated or raw transaction account field
  const txAccountId = isEdit
    ? (transaction.account?._id || transaction.account || '')
    : '';

  const [txType,       setTxType]       = useState(isEdit ? transaction.type : 'buy');
  const [date,         setDate]         = useState(isEdit ? transaction.date?.split?.('T')[0] ?? todayStr() : todayStr());
  const [units,        setUnits]        = useState(isEdit ? String(transaction.units ?? '') : '');
  const [price,        setPrice]        = useState(isEdit ? String(transaction.pricePerUnit ?? '') : '');
  const [priceSource,  setPriceSource]  = useState(isEdit ? 'manual' : '');
  const [priceLoading, setPriceLoading] = useState(false);
  const [priceError,   setPriceError]   = useState('');
  const [accountId,    setAccountId]    = useState(txAccountId || defaultAccountId || nonDebtAccounts[0]?._id || '');
  const [notes,        setNotes]        = useState(isEdit ? (transaction.notes || '') : '');
  const [saving,       setSaving]       = useState(false);
  const [error,        setError]        = useState('');

  // Manual asset custom name & type (only relevant in create mode with manual security)
  const [customName, setCustomName] = useState('');
  const [assetType,  setAssetType]  = useState(security?.type || 'other');

  const totalAmount = units && price ? parseFloat(units) * parseFloat(price) : null;

  // Auto-fetch price when date changes (listed assets, create mode only)
  useEffect(() => {
    // In edit mode, don't auto-fetch — preserve existing pricePerUnit
    if (isEdit || isManual || !date || !security?.symbol) return;
    let cancelled = false;
    setPriceLoading(true);
    setPriceError('');
    setPriceSource('');

    marketAPI.price(security.symbol, date)
      .then(r => {
        if (!cancelled) { setPrice(String(r.data.price)); setPriceSource('auto'); }
      })
      .catch(() => {
        if (!cancelled) { setPriceError('Price unavailable — enter manually'); setPriceSource('manual'); }
      })
      .finally(() => { if (!cancelled) setPriceLoading(false); });

    return () => { cancelled = true; };
  }, [date, security?.symbol, isManual, isEdit]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!accountId)       { setError('Select an account'); return; }
    if (!units || !price) { setError('Units and price are required'); return; }
    if (!isEdit && isManual && !customName.trim()) { setError('Enter an asset name'); return; }

    const sym  = isEdit ? security.symbol
               : isManual ? customName.trim().toUpperCase().replace(/\s+/g, '-')
               : security.symbol;
    const name = isEdit ? security.name
               : isManual ? customName.trim()
               : security.name;

    setSaving(true);
    try {
      const data = {
        type:         txType,
        units:        parseFloat(units),
        pricePerUnit: parseFloat(price),
        assetSymbol:  sym,
        assetName:    name,
        assetType:    isEdit ? security.type : (isManual ? assetType : security.type),
        date,
        notes:        notes || undefined
      };

      if (isEdit) {
        await transactionsAPI.update(transaction._id, data);
      } else {
        await transactionsAPI.create({ ...data, account: accountId });
      }
      onSuccess?.();
    } catch (err) {
      setError(err.response?.data?.message || err.response?.data?.errors?.[0]?.msg || 'Failed to save transaction');
    } finally {
      setSaving(false);
    }
  };

  if (!security) return null;

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Security header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {onBack && !isEdit && (
          <button type="button" onClick={onBack}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', padding: 4, display: 'flex', alignItems: 'center' }}>
            <ArrowLeft size={16} />
          </button>
        )}
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>
              {isManual && !isEdit ? (customName || security.name) : security.symbol}
            </span>
            <span style={{ fontSize: '0.6875rem', fontWeight: 500, color: 'var(--color-text-muted)', background: 'var(--color-bg-elevated)', padding: '2px 6px', borderRadius: 4 }}>
              {TYPE_LABEL[isEdit ? security.type : (isManual ? assetType : security.type)] || 'Asset'}
            </span>
          </div>
          {!isManual && (
            <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>{security.name}</span>
          )}
        </div>
      </div>

      {/* Manual asset: custom name + type (create mode only) */}
      {isManual && !isEdit && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label className="label block" style={{ marginBottom: 6 }}>Asset Name</label>
            <input type="text" value={customName} onChange={e => setCustomName(e.target.value)}
              className="input-field" placeholder="e.g. Mumbai Apartment, HDFC FD 2024" required />
          </div>
          <div>
            <label className="label block" style={{ marginBottom: 6 }}>Asset Type</label>
            <select value={assetType} onChange={e => setAssetType(e.target.value)} className="input-field">
              {ASSET_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
        </div>
      )}

      {/* Buy / Sell toggle */}
      <div>
        <label className="label block" style={{ marginBottom: 8 }}>Transaction</label>
        <div className="pill-group">
          {['buy', 'sell'].map(t => (
            <button key={t} type="button" onClick={() => setTxType(t)}
              className={`pill-item ${txType === t ? 'active' : ''}`}>
              {t === 'buy' ? 'Buy' : 'Sell'}
            </button>
          ))}
        </div>
      </div>

      {/* Account (create mode only; in edit mode account is fixed) */}
      {!isEdit && (
        <div>
          <label className="label block" style={{ marginBottom: 6 }}>Account</label>
          <select value={accountId} onChange={e => setAccountId(e.target.value)} className="input-field" required>
            <option value="">Select account</option>
            {nonDebtAccounts.map(a => (
              <option key={a._id} value={a._id}>{a.name} ({a.type})</option>
            ))}
          </select>
        </div>
      )}

      {/* Date */}
      <div>
        <label className="label block" style={{ marginBottom: 6 }}>Date</label>
        <input type="date" value={date} onChange={e => setDate(e.target.value)}
          className="input-field" max={todayStr()} />
      </div>

      {/* Units */}
      <div>
        <label className="label block" style={{ marginBottom: 6 }}>Units / Quantity</label>
        <input type="number" step="any" min="0.000001" value={units}
          onChange={e => setUnits(e.target.value)}
          className="input-field" placeholder="0.00" required />
      </div>

      {/* Price per unit */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <label className="label">Price per unit</label>
          {priceSource === 'auto' && !isManual && !isEdit && (
            <span style={{ fontSize: '0.6875rem', color: 'var(--color-accent)', display: 'flex', alignItems: 'center', gap: 4 }}>
              Auto-filled ·{' '}
              <button type="button" onClick={() => setPriceSource('manual')}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: '0.6875rem', padding: 0, fontFamily: 'inherit' }}>
                Override
              </button>
            </span>
          )}
          {priceSource === 'manual' && !isManual && !isEdit && (
            <button type="button"
              onClick={() => { setPriceSource(''); setDate(d => d); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: '0.6875rem', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 3 }}>
              <RotateCcw size={10} /> Refetch
            </button>
          )}
        </div>
        {priceLoading ? (
          <div className="input-field" style={{ color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
            <span style={{ fontSize: '0.875rem' }}>Fetching price…</span>
          </div>
        ) : (
          <>
            <input type="number" step="any" min="0" value={price}
              onChange={e => { setPrice(e.target.value); if (!isEdit) setPriceSource('manual'); }}
              className="input-field" placeholder="0.00" required
              style={priceSource === 'auto' ? { color: 'var(--color-accent)' } : undefined}
            />
            {priceError && (
              <p style={{ marginTop: 4, fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{priceError}</p>
            )}
          </>
        )}
      </div>

      {/* Total amount */}
      {totalAmount !== null && (
        <div style={{ padding: '12px 16px', background: 'var(--color-bg-elevated)', borderRadius: 'var(--radius-sm)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
            {txType === 'buy' ? 'Total cost' : 'Total proceeds'}
          </span>
          <span style={{ fontSize: '0.9375rem', fontWeight: 600, color: txType === 'buy' ? 'var(--color-accent)' : 'var(--color-success)' }}>
            {formatCurrency(totalAmount)}
          </span>
        </div>
      )}

      {/* Notes */}
      <div>
        <label className="label block" style={{ marginBottom: 6 }}>Notes</label>
        <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
          className="input-field" placeholder="Optional" />
      </div>

      {error && <p style={{ fontSize: '0.8125rem', color: 'var(--color-danger)' }}>{error}</p>}

      <button type="submit" disabled={saving} className="btn-primary"
        style={{ width: '100%', padding: '11px 18px', marginTop: 4 }}>
        {saving
          ? <div className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
          : <><span>{isEdit ? 'Save changes' : (txType === 'buy' ? 'Record Purchase' : 'Record Sale')}</span><ArrowRight size={15} /></>
        }
      </button>
    </form>
  );
}
