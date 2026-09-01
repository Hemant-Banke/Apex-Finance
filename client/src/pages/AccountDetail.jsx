import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { accountsAPI, transactionsAPI } from '../lib/api';
import { formatCurrency, formatNativeCurrency, formatDate, formatSigned, pnlColor } from '../lib/utils';
import Modal from '../components/ui/Modal';
import Spinner from '../components/ui/Spinner';
import TransactionRow from '../components/transactions/TransactionRow';
import ConfirmModal from '../components/ui/ConfirmModal';
import TransactionForm from '../components/forms/TransactionForm';
import MarketSearch from '../components/market/MarketSearch';
import AssetTransactionForm from '../components/market/AssetTransactionForm';
import HoldingsDonut from '../components/charts/HoldingsDonut';
import SellHoldingModal from '../components/portfolio/SellHoldingModal';
import PriceGrapher from '../components/charts/PriceGrapher';
import AssetPricePanel from '../components/charts/AssetPricePanel';
import ImportModal from '../components/import/ImportModal';
import Button from '../components/ui/Button';
import AssetIcon from '../components/market/AssetIcon';
import { assetTypeLabel } from '../lib/constants';
import { toCreatePayload } from '../lib/undo';
import {
  ArrowLeft, Plus, Pencil, TrendingUp, Shield, CreditCard,
  Landmark, Wallet, Briefcase, Package, BarChart2, Upload
} from 'lucide-react';
import { useToast } from '../context/ToastContext';

const SKIP_DELETE_KEY = 'apex_skip_tx_delete';

// Small pill showing an asset's type in a modal header.
function AssetTypePill({ type }) {
  if (!type) return null;
  return (
    <span style={{
      flexShrink: 0, padding: '3px 9px', borderRadius: 999,
      fontSize: '0.625rem', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
      color: 'var(--color-accent)', background: 'var(--color-accent-dim)',
      border: '1px solid var(--color-accent-dim)', whiteSpace: 'nowrap',
    }}>
      {assetTypeLabel(type)}
    </span>
  );
}

// The asset's ticker, for a modal subtitle — the name carries the title, so the
// symbol reads as the quieter reference line, in the mono figure face.
function AssetTicker({ symbol, exchange }) {
  if (!symbol) return null;
  return (
    <span>
      <span className="figure" style={{ color: 'var(--color-text-secondary)', fontWeight: 600 }}>{symbol}</span>
      {exchange ? <span style={{ color: 'var(--color-text-muted)' }}> · {exchange}</span> : null}
    </span>
  );
}

const iconMap = {
  bank: Landmark, brokerage: TrendingUp, retirement: Shield,
  debt: CreditCard, wallet: Wallet, other: Briefcase
};

export default function AccountDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [account, setAccount]       = useState(null);
  const [txns, setTxns]             = useState([]);
  const [allAccounts, setAllAccounts] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [modal, setModal]           = useState(false);
  const [editTx, setEditTx]         = useState(null);
  const [deleteTx, setDeleteTx]     = useState(null);
  const [chartKey, setChartKey]     = useState(0);
  // Asset buy/sell modal (MarketSearch → AssetTransactionForm)
  const [assetModal, setAssetModal]         = useState(false);
  const [selectedSecurity, setSelectedSecurity] = useState(null);
  const [importOpen, setImportOpen]         = useState(false);
  // Sell-a-holding modal — the holding itself is the open flag.
  const [sellHolding, setSellHolding]       = useState(null);
  // Rename / edit-details modal
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [details, setDetails]         = useState({ name: '', description: '' });
  const [savingDetails, setSavingDetails] = useState(false);

  useEffect(() => { load(); }, [id]);

  const load = async () => {
    try {
      const [a, t] = await Promise.all([
        accountsAPI.getById(id),
        transactionsAPI.getAll({ account: id, limit: 100 })
      ]);
      setAccount(a.data);
      setTxns(t.data.transactions);
    } catch (e) { toast.error(e.response?.data?.message || 'Failed to load account'); }
    finally { setLoading(false); }
  };

  const openModal = async () => {
    try {
      const res = await accountsAPI.getAll();
      setAllAccounts(res.data.filter(a => a._id !== id));
    } catch (e) { toast.error(e.response?.data?.message || 'Failed to load accounts'); }
    setModal(true);
  };

  const closeModal = () => setModal(false);

  const openEdit = async (tx) => {
    if (allAccounts.length === 0) {
      try {
        const res = await accountsAPI.getAll();
        setAllAccounts(res.data.filter(a => a._id !== id));
      } catch (e) { toast.error(e.response?.data?.message || 'Failed to load accounts'); }
    }
    setEditTx(tx);
  };

  // Takes the whole transaction, not just its id: undo posts the document back, and
  // after the delete this page no longer holds it.
  const delTx = async (tx) => {
    const refresh = () => { load(); setChartKey(k => k + 1); };
    try {
      await transactionsAPI.delete(tx._id);
      refresh();
      toast.success('Transaction deleted', {
        action: {
          label: 'Undo',
          onClick: async () => {
            try { await transactionsAPI.create(toCreatePayload(tx)); refresh(); }
            catch (e) { toast.error(e.response?.data?.message || 'Could not restore the transaction'); }
          },
        },
      });
    }
    catch (e) { toast.error(e.response?.data?.message || 'Failed to delete transaction'); }
  };

  const handleDeleteClick = (tx) => {
    if (localStorage.getItem(SKIP_DELETE_KEY) === 'true') {
      delTx(tx);
    } else {
      setDeleteTx(tx);
    }
  };

  const closeAssetModal = () => { setAssetModal(false); setSelectedSecurity(null); };

  const openDetails = () => {
    setDetails({ name: account.name, description: account.description || '' });
    setDetailsOpen(true);
  };

  const saveDetails = async (e) => {
    e.preventDefault();
    setSavingDetails(true);
    try {
      await accountsAPI.update(id, { name: details.name.trim(), description: details.description });
      setDetailsOpen(false);
      load();
      toast.success('Account updated');
    } catch (e) {
      toast.error(e.response?.data?.message || e.response?.data?.errors?.[0]?.msg || 'Failed to update account');
    } finally { setSavingDetails(false); }
  };

  const openImport = async () => {
    if (allAccounts.length === 0) {
      try {
        const res = await accountsAPI.getAll();
        setAllAccounts(res.data.filter(a => a._id !== id));
      } catch (e) { toast.error(e.response?.data?.message || 'Failed to load accounts'); }
    }
    setImportOpen(true);
  };

  // Fetch function for PriceGrapher — stable ref, uses account id from closure.
  // The /daily route returns { date, cashValue, assetValue, totalValue }; the
  // chart plots `value`, so map to the total account balance over time.
  // `growth` is threaded straight through — PriceGrapher only ever passes it when
  // its own Complete/Growth toggle is on.
  const fetchDailyBalance = useCallback(
    (days, growth) => accountsAPI.getDaily(id, days, growth).then(res =>
      res.data.map(d => ({ date: d.date, value: d.totalValue }))
    ),
    [id]
  );

  // Balance breakdown (non-debt accounts). `assetBalance` and `balance` come from the
  // server, already settled at the T-1 close; `totalInvested` is the cost
  // basis, which is what the gain is measured against — not what the account is worth.
  const cashBalance   = account?.cashBalance ?? account?.balance ?? 0;
  const assetValue    = account?.assetBalance ?? 0;
  const totalValue    = account?.balance ?? (cashBalance + assetValue);
  const totalInvested = account?.holdings?.filter(h => h.qty > 0).reduce((s, h) => s + h.totalInvested, 0) || 0;
  const assetPnl      = assetValue - totalInvested;

  if (loading) return <Spinner />;
  if (!account) return (
    <div className="text-center" style={{ paddingTop: '20vh' }}>
      <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Account not found</p>
      <Link to="/accounts" className="text-sm mt-3 inline-block" style={{ color: 'var(--color-accent)' }}>← Back</Link>
    </div>
  );

  const Icon = iconMap[account.type] || Briefcase;
  // Asset-holding accounts (brokerage/retirement) lead with the Add-asset CTA.
  const isAssetAccount = ['brokerage', 'retirement'].includes(account.type);

  return (
    <div className="animate-in" style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>

      {/* Back */}
      <button onClick={() => navigate('/accounts')}
        className="flex items-center gap-1.5 text-xs font-medium group"
        style={{ color: 'var(--color-text-muted)', background: 'none', border: 'none', cursor: 'pointer', alignSelf: 'flex-start' }}>
        <ArrowLeft size={14} className="group-hover:-translate-x-0.5 transition-transform" /> Back to accounts
      </button>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--color-bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon size={20} style={{ color: 'var(--color-text-secondary)' }} strokeWidth={1.5} />
          </div>
          <div>
            <div className="flex items-center gap-2 group">
              <h1 className="heading-lg">{account.name}</h1>
              <button onClick={openDetails} title="Rename account" aria-label="Rename account"
                className="opacity-0 group-hover:!opacity-100 transition-opacity"
                style={{ color: 'var(--color-text-muted)', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', padding: 4 }}>
                <Pencil size={14} />
              </button>
            </div>
            <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
              {account.type.charAt(0).toUpperCase() + account.type.slice(1)}
              {account.description && ` · ${account.description}`}
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Button variant="icon" icon={Upload} onClick={openImport} title="Import transactions" aria-label="Import transactions" />
          {(() => {
            const addTxn   = <Button key="txn" variant={isAssetAccount ? 'secondary' : 'gold'} icon={Plus} onClick={openModal}>Add transaction</Button>;
            const addAsset = <Button key="asset" variant={isAssetAccount ? 'gold' : 'secondary'} icon={BarChart2} onClick={() => { setSelectedSecurity(null); setAssetModal(true); }}>Add asset</Button>;
            // Left → right: import (icon), then secondary, then the gold primary.
            // Asset accounts make Add asset primary; cash accounts make Add transaction primary.
            // Debt accounts hold no assets, so only Add transaction.
            if (account.isDebt) return addTxn;
            return isAssetAccount ? [addTxn, addAsset] : [addAsset, addTxn];
          })()}
        </div>
      </div>

      {/* Balance —  in FULL, to the rupee.
          Everywhere else in the app a figure is a comparison ("₹12.5L in assets" beside
          "₹3.2L cash") and rounding to two significant figures helps the eye. Here it is
          the answer to "how much is in this account", read against a bank app that
          prints every digit. "₹12.53L" cannot be reconciled with ₹12,52,840, and a
          balance you cannot reconcile is a balance you do not trust. */}
      {account.isDebt ? (
        <div className="card">
          <p className="heading-sm mb-3">Outstanding Balance</p>
          {/* Printed as stored — a debt account's balance is already negative. */}
          <p className="figure display-number" style={{
            color: account.balance <= 0 ? 'var(--color-danger)' : 'var(--color-success)',
          }}>
            {formatCurrency(account.balance)}
          </p>
        </div>
      ) : (
        /* Assets are shown at MARKET value (the server's settled T-1 close) with the
           cost basis and the gain beneath — the panel used to print the cost basis and
           call it "Total Value", which is the one thing it is not. */
        <div className="card" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 0 }}>
          <div style={{ paddingRight: 24, borderRight: '1px solid var(--color-border-subtle)' }}>
            <p className="label" style={{ marginBottom: 8 }}>Cash</p>
            <p className="figure" style={{ fontSize: 'clamp(1.05rem, 2.1vw, 1.35rem)', fontWeight: 500, color: 'var(--color-text-primary)' }}>
              {formatCurrency(cashBalance)}
            </p>
          </div>
          <div style={{ padding: '0 24px', borderRight: '1px solid var(--color-border-subtle)' }}>
            <p className="label" style={{ marginBottom: 8 }}>Assets</p>
            <p className="figure" style={{ fontSize: 'clamp(1.05rem, 2.1vw, 1.35rem)', fontWeight: 500, color: 'var(--color-text-primary)' }}>
              {formatCurrency(assetValue)}
            </p>
            {totalInvested > 0 && (
              <p className="figure text-xs" style={{ marginTop: 6, color: 'var(--color-text-muted)' }}>
                {formatCurrency(totalInvested)} invested
                <span style={{ color: pnlColor(assetPnl), marginLeft: 8 }}>
                  {formatSigned(assetPnl)}
                </span>
              </p>
            )}
          </div>
          <div style={{ paddingLeft: 24 }}>
            <p className="label" style={{ marginBottom: 8 }}>Total value</p>
            {/* Full rupees are longer than the compact form was, so the three columns
                give a little size back rather than letting a crore overflow. */}
            <p className="figure" style={{ fontSize: 'clamp(1.05rem, 2.1vw, 1.35rem)', fontWeight: 500, color: 'var(--color-accent)' }}>
              {formatCurrency(totalValue)}
            </p>
          </div>
        </div>
      )}

      {/* Account Balance History */}
      <PriceGrapher
        fetchData={fetchDailyBalance}
        title="Account Balance"
        valueLabel="Balance"
        refreshKey={chartKey}
        height={240}
        defaultRange="6M"
        ranges={[
          { label: '1M',  days: 30  },
          { label: '3M',  days: 90  },
          { label: '6M',  days: 182 },
          { label: '1Y',  days: 365 },
          { label: 'Max', days: null },
        ]}
        emptyText="No transaction history yet"
        // Growth (money-only, deposits/withdrawals removed) only means something for an
        // account that can hold assets — every non-debt account, not just brokerage/
        // retirement (a bank or wallet account can hold assets too, e.g. NEXO Crypto).
        growthCapable={!account.isDebt}
      />

      {/* Holdings Donut */}
      {account.holdings?.length > 0 && (
        <HoldingsDonut holdings={account.holdings} title="Holdings" />
      )}

      {/* Asset Prices */}
      {account.holdings?.length > 0 && !account.isDebt && (
        <AssetPricePanel holdings={account.holdings} title="Asset Prices" height={260} />
      )}

      {/* Holdings */}
      {account.holdings?.length > 0 && (
        <div>
          <p className="heading-sm" style={{ marginBottom: 12 }}>Breakdown</p>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {account.holdings.map((h, i) => (
              <div key={h.symbol} className="data-row group"
                style={{ borderTop: i > 0 ? '1px solid var(--color-border-subtle)' : 'none' }}>
                <div className="flex items-center gap-3">
                  <Package size={15} style={{ color: 'var(--color-text-muted)' }} />
                  <div>
                    <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>{h.name}</p>
                    <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 2 }}>
                      <span className="figure">{h.symbol}</span> · <span className="figure">{h.qty}</span> units · avg{' '}
                      {/* Foreign holding: the average it was actually bought at, in its
                          own currency. The INR cost sits on the right of the row. */}
                      <span className="figure">
                        {h.currency
                          ? formatNativeCurrency(h.avgCostPerUnitNative, h.currency)
                          : formatCurrency(h.avgCostPerUnit)}
                      </span> · {h.type?.replace('_', ' ')}
                    </p>
                  </div>
                </div>
                <div className="flex items-center" style={{ gap: 12, flexShrink: 0 }}>
                  <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
                    <span className="figure text-sm" style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>
                      {formatCurrency(h.totalInvested)}
                    </span>
                    {h.currency && (
                      <span className="figure" style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)' }}>
                        {formatNativeCurrency(h.totalInvestedNative, h.currency)}
                      </span>
                    )}
                  </span>
                  {/* Selling used to mean opening Add asset, searching the market for
                      something already on your own books, and remembering the quantity.
                      It belongs on the holding. Revealed on hover, like every other row
                      action in the app, so the list still reads as figures. */}
                  <button
                    onClick={() => setSellHolding(h)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                    title={`Sell ${h.name}`}
                    style={{
                      background: 'none', cursor: 'pointer', fontFamily: 'inherit',
                      border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)',
                      color: 'var(--color-danger)', fontSize: '0.6875rem', fontWeight: 600,
                      padding: '4px 10px', flexShrink: 0,
                    }}>
                    Sell
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Transactions */}
      <div>
        <p className="heading-sm" style={{ marginBottom: 12 }}>Transactions ({txns.length})</p>
        {txns.length > 0 ? (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {txns.map((tx, i) => {
              // The statement now carries transfers INTO this account as well as out of
              // it, and the two read as opposites from here: one credits, one debits.
              // Everything else in the list belongs to this account outright.
              const incoming = tx.type === 'transfer'
                ? (tx.toAccount?._id || tx.toAccount) === id
                : undefined;
              const counterparty = incoming ? tx.account : tx.toAccount;
              return (
                <TransactionRow
                  key={tx._id}
                  tx={tx}
                  divided={i > 0}
                  incoming={incoming}
                  subtitle={<>
                    {tx.type} · {formatDate(tx.date)}
                    {counterparty?.name && ` ${incoming ? '←' : '→'} ${counterparty.name}`}
                  </>}
                  // An incoming transfer is the OTHER account's transaction — the edit
                  // form is built around `account`, which from here is the DESTINATION,
                  // so it would rewrite the wrong side. This end stays read-only; the
                  // row is editable from the source account (or the Transactions page).
                  onEdit={incoming ? undefined : openEdit}
                  onDelete={incoming ? undefined : handleDeleteClick}
                />
              );
            })}
          </div>
        ) : (
          <div className="card flex items-center justify-center" style={{ padding: '48px 24px' }}>
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>No transactions in this account</p>
          </div>
        )}
      </div>

      {/* Add Transaction Modal */}
      <Modal open={modal} onClose={closeModal} eyebrow={account.name} title="New transaction" icon={Plus}>
        <TransactionForm
          accountId={id}
          account={account}
          allAccounts={allAccounts}
          onSuccess={() => { closeModal(); load(); setChartKey(k => k + 1); }}
        />
      </Modal>

      {/* Edit Transaction Modal — AssetTransactionForm for buy/sell */}
      <Modal open={!!editTx} onClose={() => setEditTx(null)}
        // Buy/Sell moves to the eyebrow now that the asset name owns the title.
        eyebrow={['buy','sell'].includes(editTx?.type)
          ? `Edit ${editTx?.type === 'buy' ? 'purchase' : 'sale'}`
          : 'Edit'}
        title={['buy','sell'].includes(editTx?.type)
          ? (editTx?.assetName || editTx?.assetSymbol)
          : 'Edit transaction'}
        subtitle={['buy','sell'].includes(editTx?.type) ? <AssetTicker symbol={editTx?.assetSymbol} /> : undefined}
        titleSuffix={['buy','sell'].includes(editTx?.type) ? <AssetTypePill type={editTx?.assetType} /> : undefined}
        titlePrefix={['buy','sell'].includes(editTx?.type)
          ? <AssetIcon symbol={editTx.assetSymbol} name={editTx.assetName} type={editTx.assetType} size={40} />
          : undefined}
        wide={['buy','sell'].includes(editTx?.type)}>
        {editTx && (['buy','sell'].includes(editTx.type) ? (
          <AssetTransactionForm
            key={editTx._id}
            transaction={editTx}
            accounts={[account, ...allAccounts]}
            onSuccess={() => { setEditTx(null); load(); setChartKey(k => k + 1); }}
          />
        ) : (
          <TransactionForm
            key={editTx._id}
            transaction={editTx}
            account={account}
            allAccounts={allAccounts}
            onSuccess={() => { setEditTx(null); load(); setChartKey(k => k + 1); }}
          />
        ))}
      </Modal>

      {/* Delete Transaction Confirm Modal */}
      <ConfirmModal
        open={!!deleteTx}
        onClose={() => setDeleteTx(null)}
        onConfirm={() => delTx(deleteTx)}
        title="Delete transaction"
        message={`Delete this ${deleteTx?.type} transaction of ${deleteTx ? formatCurrency(deleteTx.amount) : ''}? This action cannot be undone.`}
        skipKey={SKIP_DELETE_KEY}
      />

      {/* Rename / edit account details */}
      <Modal open={detailsOpen} onClose={() => setDetailsOpen(false)}
        eyebrow="Edit" title="Account details" icon={Pencil}>
        <form onSubmit={saveDetails} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div>
            <label className="label block" style={{ marginBottom: 8 }}>Name</label>
            <input type="text" value={details.name}
              onChange={e => setDetails({ ...details, name: e.target.value })}
              className="input-field" placeholder="e.g., HDFC Savings" required autoFocus />
          </div>
          <div>
            <label className="label block" style={{ marginBottom: 8 }}>Description</label>
            <input type="text" value={details.description}
              onChange={e => setDetails({ ...details, description: e.target.value })}
              className="input-field" placeholder="Optional note" />
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Button type="button" variant="secondary" onClick={() => setDetailsOpen(false)}>Cancel</Button>
            <Button type="submit" variant="gold" disabled={savingDetails || !details.name.trim()}>
              {savingDetails ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Import statement modal — pre-targets this account */}
      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        accounts={[account, ...allAccounts]}
        defaultAccountId={id}
        onSuccess={() => { setImportOpen(false); load(); setChartKey(k => k + 1); }}
      />

      {/* Sell a holding — this account is the only place it can be sold from here */}
      <SellHoldingModal
        holding={sellHolding}
        accounts={[account, ...allAccounts]}
        defaultAccountId={id}
        onClose={() => setSellHolding(null)}
        onSuccess={() => { setSellHolding(null); load(); setChartKey(k => k + 1); }}
      />

      {/* Add Asset Modal — MarketSearch → AssetTransactionForm */}
      <Modal open={assetModal} onClose={closeAssetModal}
        align="top"
        className={selectedSecurity ? undefined : 'modal-fade-down'}
        onBack={selectedSecurity ? () => setSelectedSecurity(null) : undefined}
        eyebrow={selectedSecurity ? 'Record trade' : 'Add asset'}
        title={selectedSecurity ? selectedSecurity.name : 'Find an asset'}
        subtitle={selectedSecurity
          ? (selectedSecurity.isManual ? undefined : <AssetTicker symbol={selectedSecurity.symbol} exchange={selectedSecurity.exchange} />)
          : 'Search stocks, ETFs, crypto, funds — or add a manual holding.'}
        titleSuffix={selectedSecurity ? <AssetTypePill type={selectedSecurity.type} /> : undefined}
        titlePrefix={selectedSecurity ? <AssetIcon symbol={selectedSecurity.symbol} name={selectedSecurity.name} type={selectedSecurity.type} size={40} /> : undefined}
        wide>
        {!selectedSecurity ? (
          <MarketSearch onSelect={sec => setSelectedSecurity(sec)} />
        ) : (
          <AssetTransactionForm
            security={selectedSecurity}
            accounts={[account, ...allAccounts]}
            defaultAccountId={id}
            onSuccess={() => { closeAssetModal(); load(); setChartKey(k => k + 1); }}
          />
        )}
      </Modal>
    </div>
  );
}
