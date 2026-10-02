import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { transactionsAPI, accountsAPI } from '../lib/api';
import { formatCurrency, compactIfLarge, formatDate, pnlColor } from '../lib/utils';
import { TRANSACTION_TYPES } from '../lib/constants';
import { toCreatePayload } from '../lib/undo';
import Spinner from '../components/ui/Spinner';
import TransactionRow from '../components/transactions/TransactionRow';
import Card from '../components/ui/Card';
import Modal from '../components/ui/Modal';
import ConfirmModal from '../components/ui/ConfirmModal';
import TransactionForm from '../components/forms/TransactionForm';
import AssetTransactionForm from '../components/market/AssetTransactionForm';
import { DateRangePicker } from '../components/forms/DatePicker';
import TypePicker from '../components/forms/TypePicker';
import { accountOptions } from '../lib/accountPickerOptions';
import {
  Filter, ArrowLeftRight, ChevronLeft, ChevronRight, Upload, Search, X,
} from 'lucide-react';
import { useToast } from '../context/ToastContext';
import ImportModal from '../components/import/ImportModal';
import AssetIcon from '../components/market/AssetIcon';

const SKIP_DELETE_KEY = 'apex_skip_tx_delete';
const EMPTY_FILTERS = { account: '', type: '', search: '', startDate: '', endDate: '', page: 1 };

/**
 * What the current filter adds up to.
 *
 * The figure a filtered list owes you is the total of what you filtered — otherwise the
 * user is left adding up a page of rows by eye. Trades sit apart from income and expense
 * on purpose: buying a stock is not spending, and folding it into "out" would report an
 * investment as money gone.
 */
function Item({ label, value, color }) {
  return (
    <div>
      <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{label}</p>
      <p className="figure text-sm" style={{ marginTop: 4, fontWeight: 500, color: color || 'var(--color-text-primary)' }}>
        {compactIfLarge(value)}
      </p>
    </div>
  );
}

function FilterSummary({ summary }) {
  if (!summary?.count) return null;
  const { income, expense, net, invested, divested } = summary;

  return (
    <Card compact>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px 36px', alignItems: 'center' }}>
        <div>
          <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Matching</p>
          <p className="figure text-sm" style={{ marginTop: 4, fontWeight: 500 }}>
            {summary.count} txn{summary.count === 1 ? '' : 's'}
          </p>
        </div>
        <Item label="In"  value={income}  color="var(--color-success)" />
        <Item label="Out" value={expense} color="var(--color-danger)" />
        <Item label="Net" value={net}     color={pnlColor(net)} />
        {(invested > 0 || divested > 0) && <>
          <Item label="Bought" value={invested} />
          <Item label="Sold"   value={divested} />
        </>}
      </div>
    </Card>
  );
}

export default function Transactions() {
  const toast = useToast();
  const [txns, setTxns] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  // An account's page hands off to here for anything past its recent-activity list, so
  // the account filter can arrive in the URL. The filter panel opens with it — a list
  // that silently shows a subset is worse than no filter at all.
  const [searchParams] = useSearchParams();
  const urlAccount = searchParams.get('account') || '';

  const [filters, setFilters] = useState({ ...EMPTY_FILTERS, account: urlAccount });
  const [searchBox, setSearchBox] = useState('');
  const [showFilter, setShowFilter] = useState(!!urlAccount);
  const [showImport, setShowImport] = useState(false);
  const [editTx, setEditTx] = useState(null);
  const [deleteTx, setDeleteTx] = useState(null);
  const limit = 25;

  useEffect(() => { accountsAPI.getAll().then(r => setAccounts(r.data)).catch(() => {}); }, []);
  useEffect(() => { loadTxns(); }, [filters]);

  // Typing must not fire a request per keystroke; the filter (and so the fetch) only
  // moves once the user has paused.
  useEffect(() => {
    const t = setTimeout(() => {
      if (searchBox !== filters.search) setFilters(f => ({ ...f, search: searchBox, page: 1 }));
    }, 300);
    return () => clearTimeout(t);
  }, [searchBox]);

  const loadTxns = async () => {
    // Only the first load blanks to a spinner; later refetches keep the list visible and
    // let the global top progress bar indicate activity.
    try {
      const p = { limit, page: filters.page };
      if (filters.account)   p.account   = filters.account;
      if (filters.type)      p.type      = filters.type;
      if (filters.search)    p.search    = filters.search;
      if (filters.startDate) p.startDate = filters.startDate;
      if (filters.endDate)   p.endDate   = filters.endDate;

      const r = await transactionsAPI.getAll(p);
      setTxns(r.data.transactions);
      setTotal(r.data.total);
      setSummary(r.data.summary);
    } catch (e) { toast.error(e.response?.data?.message || 'Failed to load transactions'); }
    finally { setLoading(false); }
  };

  // Takes the whole transaction, not just its id: undo needs the document, and after
  // the delete the list no longer has it.
  const del = async (tx) => {
    try {
      await transactionsAPI.delete(tx._id);
      loadTxns();
      toast.success('Transaction deleted', {
        action: {
          label: 'Undo',
          onClick: async () => {
            try { await transactionsAPI.create(toCreatePayload(tx)); loadTxns(); }
            catch (e) { toast.error(e.response?.data?.message || 'Could not restore the transaction'); }
          },
        },
      });
    }
    catch (e) { toast.error(e.response?.data?.message || 'Failed to delete transaction'); }
  };

  const set = (patch) => setFilters(f => ({ ...f, ...patch, page: 1 }));
  const clearAll = () => { setSearchBox(''); setFilters(EMPTY_FILTERS); };

  const pages = Math.ceil(total / limit);
  const hasFilters = filters.account || filters.type || filters.search || filters.startDate || filters.endDate;

  return (
    <div className="animate-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Header */}
      <div className="flex items-end justify-between" style={{ gap: 16, flexWrap: 'wrap' }}>
        <div>
          <p className="heading-sm mb-2">Transactions</p>
          <h1 className="heading-lg">{total} {hasFilters ? 'matching' : 'total'}</h1>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* Search sits in the header, not behind the filter panel — it is the control
              reached for most often. */}
          <div style={{ position: 'relative' }}>
            <Search size={13} style={{
              position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
              color: 'var(--color-text-muted)', pointerEvents: 'none',
            }} />
            <input
              type="text"
              value={searchBox}
              onChange={e => setSearchBox(e.target.value)}
              placeholder="Search notes, assets…"
              className="input-field"
              style={{ fontSize: '0.8125rem', paddingLeft: 30, paddingRight: searchBox ? 28 : 12, width: 200 }}
            />
            {searchBox && (
              <button onClick={() => setSearchBox('')}
                style={{
                  position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                  color: 'var(--color-text-muted)', display: 'flex',
                }}>
                <X size={13} />
              </button>
            )}
          </div>
          <button onClick={() => setShowImport(true)} className="btn-ghost">
            <Upload size={14} /> Import
          </button>
          <button onClick={() => setShowFilter(!showFilter)}
            className={`btn-ghost ${showFilter || hasFilters ? '!border-[var(--color-border-hover)]' : ''}`}>
            <Filter size={14} /> Filter
          </button>
        </div>
      </div>

      {/* Filter bar */}
      {showFilter && (
        <Card compact className="animate-in" style={{ display: 'flex', alignItems: 'end', gap: 16, flexWrap: 'wrap' }}>
          {/* The app's own picker, not the browser's. These two were the last native
              <select>s left: they ignore every design token, render the OS menu on top
              of a dark surface, and cannot show the account-type icons or sublabels
              every other account picker in the app shows. `clearable` is what carries
              the old "All accounts" / "All types" option — clearing the filter and
              picking a value are different gestures, and one row in the list was doing
              both jobs. */}
          <div style={{ minWidth: 190 }}>
            <label className="label block" style={{ marginBottom: 6 }}>Account</label>
            <TypePicker
              options={accountOptions(accounts)}
              value={filters.account}
              onChange={v => set({ account: v })}
              placeholder="All accounts"
              searchable={accounts.length > 6}
              clearable
            />
          </div>
          <div style={{ minWidth: 160 }}>
            <label className="label block" style={{ marginBottom: 6 }}>Type</label>
            <TypePicker
              options={TRANSACTION_TYPES}
              value={filters.type}
              onChange={v => set({ type: v })}
              placeholder="All types"
              clearable
            />
          </div>
          <div style={{ minWidth: 200 }}>
            <label className="label block" style={{ marginBottom: 6 }}>Date range</label>
            <DateRangePicker
              value={{ from: filters.startDate, to: filters.endDate }}
              onChange={({ from, to }) => set({ startDate: from || '', endDate: to || '' })}
            />
          </div>
          {hasFilters && (
            <button onClick={clearAll} className="text-xs font-medium"
              style={{ color: 'var(--color-text-muted)', background: 'none', border: 'none', cursor: 'pointer', paddingBottom: 10 }}>
              Clear filters
            </button>
          )}
        </Card>
      )}

      {/* What the filter adds up to */}
      <FilterSummary summary={summary} />

      {/* List */}
      {loading ? (
        <Spinner height={160} />
      ) : txns.length > 0 ? (
        <Card flush>
          {txns.map((tx, i) => {
            // Filtering by an account now returns transfers INTO it as well as out of
            // it, and only then does a transfer have a direction to report. With no
            // account filter the list is account-agnostic, so it names both ends and
            // takes no view on which way the money went.
            const incoming = filters.account && tx.type === 'transfer'
              ? (tx.toAccount?._id || tx.toAccount) === filters.account
              : undefined;
            return (
              <TransactionRow
                key={tx._id}
                tx={tx}
                divided={i > 0}
                incoming={incoming}
                subtitle={<>
                  {tx.account?.name}
                  {tx.type === 'transfer' && tx.toAccount?.name && ` → ${tx.toAccount.name}`}
                  {' · '}{formatDate(tx.date)}
                  {tx.assetSymbol && ` · ${tx.assetSymbol} · ${tx.units} units`}
                  {tx.notes && ` · ${tx.notes}`}
                </>}
                onEdit={setEditTx}
                onDelete={(t) => {
                  if (localStorage.getItem(SKIP_DELETE_KEY) === 'true') del(t);
                  else setDeleteTx(t);
                }}
              />
            );
          })}

          {pages > 1 && (
            <div className="flex items-center justify-center gap-2"
              style={{ padding: '16px 20px', borderTop: '1px solid var(--color-border-subtle)' }}>
              <button disabled={filters.page <= 1}
                onClick={() => setFilters(f => ({ ...f, page: f.page - 1 }))}
                className="btn-ghost" style={{ padding: '6px 8px', opacity: filters.page <= 1 ? 0.3 : 1 }}>
                <ChevronLeft size={14} />
              </button>
              <span className="figure text-xs" style={{ color: 'var(--color-text-muted)', padding: '0 8px' }}>
                {filters.page} / {pages}
              </span>
              <button disabled={filters.page >= pages}
                onClick={() => setFilters(f => ({ ...f, page: f.page + 1 }))}
                className="btn-ghost" style={{ padding: '6px 8px', opacity: filters.page >= pages ? 0.3 : 1 }}>
                <ChevronRight size={14} />
              </button>
            </div>
          )}
        </Card>
      ) : (
        <Card className="flex flex-col items-center justify-center" style={{ padding: '64px 24px' }}>
          <ArrowLeftRight size={24} style={{ color: 'var(--color-text-muted)', opacity: 0.3, marginBottom: 12 }} />
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            {hasFilters ? 'No matching transactions' : 'No transactions yet'}
          </p>
          {hasFilters && (
            <button onClick={clearAll} className="text-xs font-medium"
              style={{ color: 'var(--color-accent)', background: 'none', border: 'none', cursor: 'pointer', marginTop: 12 }}>
              Clear filters
            </button>
          )}
        </Card>
      )}

      <ImportModal
        open={showImport}
        onClose={() => setShowImport(false)}
        accounts={accounts}
        onSuccess={() => { setShowImport(false); loadTxns(); }}
      />

      {/* Edit — AssetTransactionForm for buy/sell, TransactionForm for everything else */}
      <Modal open={!!editTx} onClose={() => setEditTx(null)}
        eyebrow="Edit"
        title={['buy', 'sell'].includes(editTx?.type) ? `${editTx?.type === 'buy' ? 'Buy' : 'Sell'} · ${editTx?.assetSymbol}` : 'Edit transaction'}
        subtitle={['buy', 'sell'].includes(editTx?.type) ? editTx?.assetName : undefined}
        titlePrefix={['buy', 'sell'].includes(editTx?.type)
          ? <AssetIcon symbol={editTx.assetSymbol} type={editTx.assetType} size={40} />
          : undefined}
        wide={['buy', 'sell'].includes(editTx?.type)}>
        {editTx && (['buy', 'sell'].includes(editTx.type) ? (
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

      <ConfirmModal
        open={!!deleteTx}
        onClose={() => setDeleteTx(null)}
        onConfirm={() => del(deleteTx)}
        title="Delete transaction"
        message={`Delete this ${deleteTx?.type} transaction of ${deleteTx ? formatCurrency(deleteTx.amount) : ''}? This action cannot be undone.`}
        skipKey={SKIP_DELETE_KEY}
      />
    </div>
  );
}
