import { useState, useEffect } from 'react';
import { transactionsAPI, accountsAPI } from '../lib/api';
import {
  formatCurrency, formatDate, getTransactionColor, getTransactionSign, getTransactionName, TRANSACTION_TYPES
} from '../lib/utils';
import Modal from '../components/ui/Modal';
import ConfirmModal from '../components/ui/ConfirmModal';
import TransactionForm from '../components/forms/TransactionForm';
import AssetTransactionForm from '../components/market/AssetTransactionForm';
import { Filter, ArrowLeftRight, X, Pencil, ChevronLeft, ChevronRight, Upload } from 'lucide-react';
import { useToast } from '../context/ToastContext';
import ImportModal from '../components/import/ImportModal';

const SKIP_DELETE_KEY = 'apex_skip_tx_delete';

export default function Transactions() {
  const toast = useToast();
  const [txns, setTxns] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ account: '', type: '', page: 1 });
  const [showFilter, setShowFilter] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editTx, setEditTx] = useState(null);
  const [deleteTx, setDeleteTx] = useState(null);
  const limit = 25;

  useEffect(() => { accountsAPI.getAll().then(r => setAccounts(r.data)).catch(() => {}); }, []);
  useEffect(() => { loadTxns(); }, [filters]);

  const loadTxns = async () => {
    // Only the first load blanks to a spinner; later refetches keep the list
    // visible and let the global top progress bar indicate activity.
    try {
      const p = { limit, page: filters.page };
      if (filters.account) p.account = filters.account;
      if (filters.type) p.type = filters.type;
      const r = await transactionsAPI.getAll(p);
      setTxns(r.data.transactions);
      setTotal(r.data.total);
    } catch(e) { toast.error(e.response?.data?.message || 'Failed to load transactions'); }
    finally { setLoading(false); }
  };

  const del = async (id) => {
    try { await transactionsAPI.delete(id); loadTxns(); }
    catch(e) { toast.error(e.response?.data?.message || 'Failed to delete transaction'); }
  };

  const pages = Math.ceil(total / limit);
  const hasFilters = filters.account || filters.type;

  return (
    <div className="animate-in" style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <p className="heading-sm mb-2">Transactions</p>
          <h1 className="heading-lg">{total} total</h1>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setShowImport(true)} className="btn-ghost">
            <Upload size={14} /> Import
          </button>
          <button onClick={() => setShowFilter(!showFilter)}
            className={`btn-ghost ${showFilter ? '!border-[var(--color-border-hover)]' : ''}`}>
            <Filter size={14} /> Filter
          </button>
        </div>
      </div>

      {/* Filter bar */}
      {showFilter && (
        <div className="card card-compact animate-in" style={{ display: 'flex', alignItems: 'end', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 160 }}>
            <label className="label block" style={{ marginBottom: 6 }}>Account</label>
            <select value={filters.account} onChange={e => setFilters({...filters, account: e.target.value, page: 1})} className="input-field" style={{ fontSize: '0.8125rem' }}>
              <option value="">All accounts</option>
              {accounts.map(a => <option key={a._id} value={a._id}>{a.name}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 140 }}>
            <label className="label block" style={{ marginBottom: 6 }}>Type</label>
            <select value={filters.type} onChange={e => setFilters({...filters, type: e.target.value, page: 1})} className="input-field" style={{ fontSize: '0.8125rem' }}>
              <option value="">All types</option>
              {TRANSACTION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          {hasFilters && (
            <button onClick={() => setFilters({ account: '', type: '', page: 1 })}
              className="text-xs font-medium" style={{ color: 'var(--color-text-muted)', background: 'none', border: 'none', cursor: 'pointer', paddingBottom: 10 }}>
              Clear filters
            </button>
          )}
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center" style={{ padding: '80px 0' }}><div className="spinner" /></div>
      ) : txns.length > 0 ? (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {txns.map((tx, i) => (
            <div key={tx._id} className="data-row group"
              style={{ borderTop: i > 0 ? '1px solid var(--color-border-subtle)' : 'none' }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
                  {getTransactionName(tx)}
                </p>
                <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 3 }}>
                  {tx.account?.name} · {formatDate(tx.date)}
                  {tx.assetSymbol && ` · ${tx.assetSymbol} · ${tx.units} units`}
                </p>
              </div>
              <span className="badge badge-default" style={{ marginRight: 12 }}>
                {tx.type}
              </span>
              <span className={`text-sm font-semibold tabular-nums ${getTransactionColor(tx.type)}`}>
                {getTransactionSign(tx.type)}{formatCurrency(tx.amount)}
              </span>
              <button onClick={() => setEditTx(tx)}
                className="opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ marginLeft: 8, color: 'var(--color-text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
                <Pencil size={13} />
              </button>
              <button onClick={() => {
                if (localStorage.getItem(SKIP_DELETE_KEY) === 'true') { del(tx._id); }
                else setDeleteTx(tx);
              }}
                className="opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ marginLeft: 4, color: 'var(--color-text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
                <X size={13} />
              </button>
            </div>
          ))}

          {/* Pagination */}
          {pages > 1 && (
            <div className="flex items-center justify-center gap-2" style={{ padding: '16px 20px', borderTop: '1px solid var(--color-border-subtle)' }}>
              <button disabled={filters.page <= 1}
                onClick={() => setFilters({...filters, page: filters.page - 1})}
                className="btn-ghost" style={{ padding: '6px 8px', opacity: filters.page <= 1 ? 0.3 : 1 }}>
                <ChevronLeft size={14} />
              </button>
              <span className="text-xs tabular-nums" style={{ color: 'var(--color-text-muted)', padding: '0 8px' }}>
                {filters.page} / {pages}
              </span>
              <button disabled={filters.page >= pages}
                onClick={() => setFilters({...filters, page: filters.page + 1})}
                className="btn-ghost" style={{ padding: '6px 8px', opacity: filters.page >= pages ? 0.3 : 1 }}>
                <ChevronRight size={14} />
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="card flex flex-col items-center justify-center" style={{ padding: '64px 24px' }}>
          <ArrowLeftRight size={24} style={{ color: 'var(--color-text-muted)', opacity: 0.3, marginBottom: 12 }} />
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            {hasFilters ? 'No matching transactions' : 'No transactions yet'}
          </p>
        </div>
      )}

      {/* Import statement modal */}
      <ImportModal
        open={showImport}
        onClose={() => setShowImport(false)}
        accounts={accounts}
        onSuccess={() => { setShowImport(false); loadTxns(); }}
      />

      {/* Edit Modal — AssetTransactionForm for buy/sell, TransactionForm for everything else */}
      <Modal open={!!editTx} onClose={() => setEditTx(null)}
        title={['buy','sell'].includes(editTx?.type) ? `Edit ${editTx?.type} — ${editTx?.assetSymbol}` : 'Edit transaction'}
        wide={['buy','sell'].includes(editTx?.type)}>
        {editTx && (['buy','sell'].includes(editTx.type) ? (
          <AssetTransactionForm
            key={editTx._id}
            transaction={editTx}
            accounts={accounts}
            onSuccess={() => { setEditTx(null); loadTxns(); }}
          />
        ) : (
          <TransactionForm
            key={editTx._id}
            transaction={editTx}
            allAccounts={accounts.filter(a => a._id !== editTx?.account?._id)}
            onSuccess={() => { setEditTx(null); loadTxns(); }}
          />
        ))}
      </Modal>

      {/* Delete Confirm Modal */}
      <ConfirmModal
        open={!!deleteTx}
        onClose={() => setDeleteTx(null)}
        onConfirm={() => del(deleteTx._id)}
        title="Delete transaction"
        message={`Delete this ${deleteTx?.type} transaction of ${deleteTx ? formatCurrency(deleteTx.amount) : ''}? This action cannot be undone.`}
        skipKey={SKIP_DELETE_KEY}
      />
    </div>
  );
}
