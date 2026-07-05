import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { accountsAPI, transactionsAPI } from '../lib/api';
import {
  formatCurrency, formatDate, getTransactionColor, getTransactionSign, getTransactionName
} from '../lib/utils';
import Modal from '../components/ui/Modal';
import ConfirmModal from '../components/ui/ConfirmModal';
import TransactionForm from '../components/forms/TransactionForm';
import MarketSearch from '../components/market/MarketSearch';
import AssetTransactionForm from '../components/market/AssetTransactionForm';
import HoldingsDonut from '../components/charts/HoldingsDonut';
import PriceGrapher from '../components/charts/PriceGrapher';
import AssetPricePanel from '../components/charts/AssetPricePanel';
import {
  ArrowLeft, Plus, Pencil, X, TrendingUp, Shield, CreditCard,
  Landmark, Wallet, Briefcase, Package, BarChart2
} from 'lucide-react';
import { useToast } from '../context/ToastContext';

const SKIP_DELETE_KEY = 'apex_skip_tx_delete';

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

  const delTx = async (txId) => {
    try { await transactionsAPI.delete(txId); load(); setChartKey(k => k + 1); }
    catch (e) { toast.error(e.response?.data?.message || 'Failed to delete transaction'); }
  };

  const handleDeleteClick = (tx) => {
    if (localStorage.getItem(SKIP_DELETE_KEY) === 'true') {
      delTx(tx._id);
    } else {
      setDeleteTx(tx);
    }
  };

  const closeAssetModal = () => { setAssetModal(false); setSelectedSecurity(null); };

  // Fetch function for PriceGrapher — stable ref, uses account id from closure
  const fetchDailyBalance = useCallback(
    (days) => accountsAPI.getDaily(id, days).then(res => res.data),
    [id]
  );

  // Balance breakdown (non-debt accounts)
  const totalInvested = account?.holdings?.filter(h => h.qty > 0).reduce((s, h) => s + h.totalInvested, 0) || 0;
  const totalValue    = (account?.balance || 0) + totalInvested;

  if (loading) return (
    <div className="flex items-center justify-center" style={{ height: '60vh' }}>
      <div className="spinner" />
    </div>
  );
  if (!account) return (
    <div className="text-center" style={{ paddingTop: '20vh' }}>
      <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Account not found</p>
      <Link to="/accounts" className="text-sm mt-3 inline-block" style={{ color: 'var(--color-accent)' }}>← Back</Link>
    </div>
  );

  const Icon = iconMap[account.type] || Briefcase;

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
            <h1 className="heading-lg">{account.name}</h1>
            <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
              {account.type.charAt(0).toUpperCase() + account.type.slice(1)}
              {account.description && ` · ${account.description}`}
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {!account.isDebt && (
            <button onClick={() => { setSelectedSecurity(null); setAssetModal(true); }} className="btn-ghost">
              <BarChart2 size={15} /> Add Asset
            </button>
          )}
          <button onClick={openModal} className="btn-primary">
            <Plus size={15} /> Add transaction
          </button>
        </div>
      </div>

      {/* Balance */}
      {account.isDebt ? (
        <div className="card">
          <p className="heading-sm mb-3">Outstanding Balance</p>
          <p className="display-number text-[var(--color-danger)]">
            −{formatCurrency(Math.abs(account.balance))}
          </p>
        </div>
      ) : (
        <div className="card" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 0 }}>
          <div style={{ paddingRight: 24, borderRight: '1px solid var(--color-border-subtle)' }}>
            <p className="label" style={{ marginBottom: 8 }}>Cash</p>
            <p className="text-xl font-semibold tabular-nums" style={{ color: 'var(--color-text-primary)' }}>
              {formatCurrency(account.balance)}
            </p>
          </div>
          <div style={{ padding: '0 24px', borderRight: '1px solid var(--color-border-subtle)' }}>
            <p className="label" style={{ marginBottom: 8 }}>Assets (book value)</p>
            <p className="text-xl font-semibold tabular-nums" style={{ color: 'var(--color-text-primary)' }}>
              {formatCurrency(totalInvested)}
            </p>
          </div>
          <div style={{ paddingLeft: 24 }}>
            <p className="label" style={{ marginBottom: 8 }}>Total Value</p>
            <p className="text-xl font-semibold tabular-nums" style={{ color: 'var(--color-accent)' }}>
              {formatCurrency(totalValue)}
            </p>
          </div>
        </div>
      )}

      {/* Account Balance History */}
      <PriceGrapher
        fetchData={fetchDailyBalance}
        title="Cash Balance"
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
              <div key={h.symbol} className="data-row"
                style={{ borderTop: i > 0 ? '1px solid var(--color-border-subtle)' : 'none' }}>
                <div className="flex items-center gap-3">
                  <Package size={15} style={{ color: 'var(--color-text-muted)' }} />
                  <div>
                    <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>{h.symbol}</p>
                    <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 2 }}>
                      {h.name} · {h.qty} units · avg {formatCurrency(h.avgCostPerUnit)} · {h.type?.replace('_', ' ')}
                    </p>
                  </div>
                </div>
                <span className="text-sm font-semibold tabular-nums" style={{ color: 'var(--color-text-primary)' }}>
                  {formatCurrency(h.totalInvested)}
                </span>
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
            {txns.map((tx, i) => (
              <div key={tx._id} className="data-row group"
                style={{ borderTop: i > 0 ? '1px solid var(--color-border-subtle)' : 'none' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <p className="text-sm" style={{ color: 'var(--color-text-primary)' }}>
                    {getTransactionName(tx)}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 2 }}>
                    {tx.type} · {formatDate(tx.date)}
                    {tx.toAccount && ` → ${tx.toAccount.name}`}
                  </p>
                </div>
                <span className={`text-sm font-semibold tabular-nums ${getTransactionColor(tx.type)}`}
                  style={{ marginLeft: 16 }}>
                  {getTransactionSign(tx.type)}{formatCurrency(tx.amount)}
                </span>
                <button onClick={() => openEdit(tx)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ marginLeft: 8, color: 'var(--color-text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
                  <Pencil size={13} />
                </button>
                <button onClick={() => handleDeleteClick(tx)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ marginLeft: 2, color: 'var(--color-text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="card flex items-center justify-center" style={{ padding: '48px 24px' }}>
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>No transactions in this account</p>
          </div>
        )}
      </div>

      {/* Add Transaction Modal */}
      <Modal open={modal} onClose={closeModal} title="New transaction">
        <TransactionForm
          accountId={id}
          account={account}
          allAccounts={allAccounts}
          onSuccess={() => { closeModal(); load(); setChartKey(k => k + 1); }}
        />
      </Modal>

      {/* Edit Transaction Modal — AssetTransactionForm for buy/sell */}
      <Modal open={!!editTx} onClose={() => setEditTx(null)}
        title={['buy','sell'].includes(editTx?.type) ? `Edit ${editTx?.type} — ${editTx?.assetSymbol}` : 'Edit transaction'}
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
        onConfirm={() => delTx(deleteTx._id)}
        title="Delete transaction"
        message={`Delete this ${deleteTx?.type} transaction of ${deleteTx ? formatCurrency(deleteTx.amount) : ''}? This action cannot be undone.`}
        skipKey={SKIP_DELETE_KEY}
      />

      {/* Add Asset Modal — MarketSearch → AssetTransactionForm */}
      <Modal open={assetModal} onClose={closeAssetModal}
        title={selectedSecurity ? (selectedSecurity.isManual ? selectedSecurity.name : selectedSecurity.symbol) : 'Add Asset'}
        wide>
        {!selectedSecurity ? (
          <MarketSearch inline onSelect={sec => setSelectedSecurity(sec)} />
        ) : (
          <AssetTransactionForm
            security={selectedSecurity}
            accounts={[account, ...allAccounts]}
            defaultAccountId={id}
            onBack={() => setSelectedSecurity(null)}
            onSuccess={() => { closeAssetModal(); load(); setChartKey(k => k + 1); }}
          />
        )}
      </Modal>
    </div>
  );
}
