import { useState, useEffect, useRef } from 'react';
import { marketAPI, transactionsAPI } from '../../lib/api';
import { formatCurrency, ASSET_TYPES } from '../../lib/utils';
import { PURITY_OPTIONS, isPurityAsset, isRateAsset, rateLabel, isManualSymbol } from '../../lib/constants';
import DatePicker from '../forms/DatePicker';
import TypePicker from '../forms/TypePicker';
import { accountOptions } from '../../lib/accountPickerOptions';
import { ArrowRight, RotateCcw, Check, ArrowDownLeft, ArrowUpRight } from 'lucide-react';

function todayStr() {
  return new Date().toISOString().split('T')[0];
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
  // Whether the trade settles against the account's cash balance.
  // Default: buy → false (asset tracked independently), sell → true (proceeds land in cash).
  const [usesCashBalance, setUsesCashBalance] = useState(
    isEdit ? !!transaction.usesCashBalance : false
  );
  const [date,         setDate]         = useState(isEdit ? transaction.date?.split?.('T')[0] ?? todayStr() : todayStr());
  const [units,        setUnits]        = useState(isEdit ? String(transaction.units ?? '') : '');
  const [price,        setPrice]        = useState(isEdit ? String(transaction.pricePerUnit ?? '') : '');
  const [priceSource,  setPriceSource]  = useState(isEdit ? 'manual' : '');
  const [priceLoading, setPriceLoading] = useState(false);
  const [priceError,   setPriceError]   = useState('');
  const [refetchNonce, setRefetchNonce] = useState(0); // bump to re-run auto-fetch
  const didInitRef = useRef(false); // skip the mount fetch in edit mode
  const [accountId,    setAccountId]    = useState(txAccountId || defaultAccountId || nonDebtAccounts[0]?._id || '');
  const [notes,        setNotes]        = useState(isEdit ? (transaction.notes || '') : '');
  const [saving,       setSaving]       = useState(false);
  const [error,        setError]        = useState('');

  // Manual asset custom name & type (only relevant in create mode with manual security)
  const [customName, setCustomName] = useState('');
  const [assetType,  setAssetType]  = useState(security?.type || 'other');

  // Valuation metadata: purity for physical metal, annual rate for unlisted assets.
  const [purity, setPurity] = useState(isEdit ? (transaction.purity || '') : '');
  const [rate,   setRate]   = useState(isEdit ? String(transaction.rate ?? '') : '');

  // Foreign-quoted assets (US stocks, USD crypto): `price` is the NATIVE figure the
  // exchange quotes and what we store; `fxRate` (INR per unit of that currency)
  // converts it for the INR total we book. Both come back from the price endpoint.
  const [currency, setCurrency] = useState(
    isEdit ? (transaction.currency || '') : (securityProp?.currency || '')
  );
  const [fxRate, setFxRate] = useState(isEdit ? (transaction.fxRate ?? null) : null);
  const isForeign = !!currency && currency !== 'INR';

  // The effective type drives which metadata field applies. In create mode a
  // manual asset's type is user-selectable, so it can change under the form.
  const effectiveType = isEdit ? security.type : (isManual ? assetType : security.type);
  const showPurity    = isPurityAsset(effectiveType);
  const showRate      = isRateAsset(effectiveType);

  // Default a metal to its most common purity rather than leaving it blank.
  useEffect(() => {
    if (!showPurity) return;
    const opts = PURITY_OPTIONS[effectiveType] || [];
    if (!opts.some(o => o.value === purity)) {
      setPurity(effectiveType === 'gold' ? '22K' : '999');
    }
  }, [effectiveType, showPurity, purity]);

  // The figure typed in the price field, in its native currency…
  const nativeTotal = units && price ? parseFloat(units) * parseFloat(price) : null;
  // …and what we actually book: always INR. A foreign trade without a rate can't
  // be converted, so we show nothing rather than an INR figure that is really USD.
  const totalAmount = nativeTotal == null
    ? null
    : (isForeign ? (fxRate ? nativeTotal * fxRate : null) : nativeTotal);

  const submitTone  = txType === 'buy' ? 'var(--color-success)' : 'var(--color-danger)';

  // Auto-fetch the market price when the date changes (listed assets). In edit
  // mode we preserve the stored price on the initial mount, then fetch on any
  // later date change like create mode does.
  // Physical metal has no market symbol but IS priceable (INR per gram, by type
  // and purity), so it auto-fetches like a listed asset despite being "manual".
  const canAutoPrice = !isManual || showPurity;

  useEffect(() => {
    if (!canAutoPrice || !date) return;
    if (!showPurity && !security?.symbol) return;
    if (!didInitRef.current) {
      didInitRef.current = true;
      if (isEdit) return; // keep the transaction's stored price on open
    }
    let cancelled = false;
    setPriceLoading(true);
    setPriceError('');
    setPriceSource('');

    const opts = showPurity ? { assetType: effectiveType, purity } : {};

    marketAPI.price(security?.symbol || effectiveType, date, opts)
      .then(r => {
        if (cancelled) return;
        setPrice(String(r.data.price));
        setPriceSource('auto');
        // The quote tells us the asset's real currency and the rate to book it at.
        setCurrency(r.data.currency || '');
        setFxRate(r.data.fxRate ?? null);
      })
      .catch(() => {
        if (!cancelled) { setPriceError('Price unavailable — enter manually'); setPriceSource('manual'); }
      })
      .finally(() => { if (!cancelled) setPriceLoading(false); });

    return () => { cancelled = true; };
  }, [date, security?.symbol, canAutoPrice, showPurity, effectiveType, purity, isEdit, refetchNonce]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!accountId)       { setError('Select an account'); return; }
    if (!units || !price) { setError('Units and price are required'); return; }
    if (isForeign && !fxRate) {
      setError(`Exchange rate for ${currency} is unavailable — cannot convert this trade to INR.`);
      return;
    }
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
        type:            txType,
        units:           parseFloat(units),
        pricePerUnit:    parseFloat(price),
        assetSymbol:     sym,
        assetName:       name,
        assetType:       effectiveType,
        purity:          showPurity ? purity : undefined,
        rate:            showRate && rate !== '' ? parseFloat(rate) : undefined,
        // Native price + its currency; the server books `amount` in INR at the
        // trade date's rate, so it is the one authority on the conversion.
        currency:        isForeign ? currency : undefined,
        usesCashBalance,
        date,
        notes:           notes || undefined
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
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* Manual asset: custom name + type on one row (create mode only) */}
      {isManual && !isEdit && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignItems: 'start' }}>
          <div className="field">
            <label className="label">Asset Name</label>
            <input type="text" value={customName} onChange={e => setCustomName(e.target.value)}
              className="input-field" placeholder="e.g. Mumbai Apartment" required />
          </div>
          <div className="field">
            <label className="label">Asset Type</label>
            <TypePicker options={ASSET_TYPES} value={assetType} onChange={setAssetType} searchable={ASSET_TYPES.length > 6} />
          </div>
        </div>
      )}

      {/* Buy / Sell — a segmented control with clear buy (gold) vs sell (green) states */}
      <div className="field">
        <label className="label">Transaction</label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {[
            { t: 'buy',  label: 'Buy',  Icon: ArrowDownLeft, active: 'var(--color-success)', tint: 'var(--color-success-muted)' },
            { t: 'sell', label: 'Sell', Icon: ArrowUpRight,  active: 'var(--color-danger)',  tint: 'var(--color-danger-muted)' },
          ].map(({ t, label, Icon, active, tint }) => {
            const on = txType === t;
            return (
              <button key={t} type="button"
                onClick={() => { setTxType(t); if (!isEdit) setUsesCashBalance(t === 'sell'); }}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  padding: '11px 12px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                  fontFamily: 'inherit', fontSize: '0.875rem', fontWeight: 600,
                  border: `1px solid ${on ? active : 'var(--color-border)'}`,
                  background: on ? tint : 'var(--color-bg-elevated)',
                  color: on ? active : 'var(--color-text-muted)',
                  boxShadow: on ? `inset 0 0 0 1px ${active}` : 'var(--elev-ring)',
                  transition: 'all 0.15s ease',
                }}>
                <Icon size={16} strokeWidth={2.4} /> {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Account (create mode only; in edit mode account is fixed) */}
      {/* Account + Date — one row when both are shown */}
      <div style={{ display: 'grid', gridTemplateColumns: isEdit ? '1fr' : '1fr 1fr', gap: 12 }}>
        {!isEdit && (
          <div className="field">
            <label className="label">Account</label>
            <TypePicker
              options={accountOptions(nonDebtAccounts)}
              value={accountId}
              onChange={setAccountId}
              placeholder="Select account"
              searchable={nonDebtAccounts.length > 6}
            />
          </div>
        )}
        <div className="field">
          <label className="label">Date</label>
          <DatePicker value={date} onChange={setDate} max={todayStr()} />
        </div>
      </div>

      {/* Valuation metadata — purity for metal, annual rate for unlisted assets.
          Both feed the pricing engine, so they sit above the figures they drive. */}
      {showPurity && (
        <div className="field">
          <label className="label">Purity</label>
          <TypePicker
            options={PURITY_OPTIONS[effectiveType] || []}
            value={purity}
            onChange={setPurity}
            placeholder="Select purity"
          />
          <p style={{ marginTop: 4, fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
            Valued at the live {effectiveType} spot price per gram, scaled to this purity.
          </p>
        </div>
      )}

      {showRate && (
        <div className="field">
          <label className="label">{rateLabel(effectiveType)}</label>
          <input type="number" step="any" min="0" value={rate}
            onChange={e => setRate(e.target.value)}
            className="input-field" placeholder="e.g. 7.1"
            style={{ fontFamily: 'var(--font-mono)' }} />
          <p style={{ marginTop: 4, fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
            This asset has no market quote — its value compounds at this rate from the purchase price.
          </p>
        </div>
      )}

      {/* Units + Price — side by side to keep the form compact */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignItems: 'start' }}>
      {/* Units */}
      <div>
        <label className="label block" style={{ marginBottom: 6 }}>
          {showPurity ? 'Weight (grams)' : 'Units / Quantity'}
        </label>
        <input type="number" step="any" min="0.000001" value={units}
          onChange={e => setUnits(e.target.value)}
          className="input-field" placeholder="0.00" required style={{ fontFamily: 'var(--font-mono)' }} />
      </div>

      {/* Price per unit */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, minHeight: 18 }}>
          <label className="label">
            {showPurity ? 'Price per gram' : 'Price per unit'}
            {isForeign && (
              <span style={{ marginLeft: 5, color: 'var(--color-accent)', fontWeight: 600 }}>({currency})</span>
            )}
          </label>
          {priceSource === 'auto' && canAutoPrice && (
            <span style={{ fontSize: '0.6875rem', color: 'var(--color-accent)', display: 'flex', alignItems: 'center', gap: 4 }}>
              Auto-filled ·{' '}
              <button type="button" onClick={() => setPriceSource('manual')}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: '0.6875rem', padding: 0, fontFamily: 'inherit' }}>
                Override
              </button>
            </span>
          )}
          {priceSource === 'manual' && canAutoPrice && (
            <button type="button"
              onClick={() => setRefetchNonce(n => n + 1)}
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
              onChange={e => { setPrice(e.target.value); setPriceSource('manual'); }}
              className="input-field" placeholder="0.00" required
              style={{ fontFamily: 'var(--font-mono)', ...(priceSource === 'auto' ? { color: 'var(--color-accent)' } : null) }}
            />
            {priceError && (
              <p style={{ marginTop: 4, fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{priceError}</p>
            )}
            {/* Foreign quote — spell out the per-unit INR value and the rate it books at. */}
            {isForeign && !priceError && price && (
              <p style={{ marginTop: 4, fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                {fxRate
                  ? <>≈ <span className="figure" style={{ color: 'var(--color-text-secondary)' }}>
                      {formatCurrency(parseFloat(price) * fxRate)}
                    </span> per unit · 1 {currency} = ₹{fxRate.toFixed(2)}</>
                  : <span style={{ color: 'var(--color-chart-warm)' }}>
                      Exchange rate for {currency} unavailable — cannot convert to INR.
                    </span>}
              </p>
            )}
          </>
        )}
      </div>
      </div>

      {/* Settle against cash — compact single row */}
      <button
        type="button"
        onClick={() => setUsesCashBalance(v => !v)}
        title={txType === 'buy' ? 'Deduct the cost from this account’s cash balance' : 'Add the proceeds to this account’s cash balance'}
        style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0, fontFamily: 'inherit' }}
      >
        <span style={{
          width: 18, height: 18, borderRadius: 4, flexShrink: 0,
          border: `2px solid ${usesCashBalance ? 'var(--color-accent)' : 'var(--color-border-hover)'}`,
          background: usesCashBalance ? 'var(--color-accent)' : 'transparent',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {usesCashBalance && <Check size={11} style={{ color: 'var(--color-bg-primary)', strokeWidth: 3 }} />}
        </span>
        <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-primary)', fontWeight: 500 }}>Settle against account cash</span>
        <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>({txType === 'buy' ? 'deduct cost' : 'add proceeds'})</span>
      </button>

      {/* Notes */}
      <div className="field">
        <label className="label">Note</label>
        <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
          className="input-field" placeholder="Optional" />
      </div>

      {error && <p style={{ fontSize: '0.8125rem', color: 'var(--color-danger)' }}>{error}</p>}

      <button type="submit" disabled={saving} className="btn-primary"
        style={{
          width: '100%', padding: '13px 18px', marginTop: 2, justifyContent: 'space-between',
          background: `color-mix(in srgb, ${submitTone} 68%, #0B0D10)`,
          color: 'var(--color-text-primary)',
          border: `1px solid color-mix(in srgb, ${submitTone} 45%, transparent)`,
          boxShadow: 'none',
        }}>
        {saving ? (
          <div className="spinner" style={{ width: 16, height: 16, borderWidth: 2, margin: '0 auto' }} />
        ) : (
          <>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
              {isEdit ? 'Save changes' : (txType === 'buy' ? 'Record purchase' : 'Record sale')}
              <ArrowRight size={15} />
            </span>
            {totalAmount !== null && (
              <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
                {/* Foreign trade: show what was typed, then what gets booked. */}
                {isForeign && (
                  <span className="figure" style={{ fontSize: '0.75rem', opacity: 0.7 }}>
                    {nativeTotal.toFixed(2)} {currency} →
                  </span>
                )}
                <span className="figure" style={{ fontWeight: 700 }}>
                  {formatCurrency(totalAmount)}
                </span>
              </span>
            )}
          </>
        )}
      </button>
    </form>
  );
}
