import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { accountsAPI } from '../lib/api';
import { formatCurrency, compactIfLarge } from '../lib/utils';
import { ACCOUNT_TYPE_OPTIONS } from '../lib/accountPickerOptions';
import { accountTypeLabel } from '../lib/constants';
import Modal from '../components/ui/Modal';
import TypePicker from '../components/forms/TypePicker';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Spinner from '../components/ui/Spinner';
import {
  Plus, Wallet, TrendingUp, Shield, CreditCard,
  Landmark, Briefcase, ChevronRight,
} from 'lucide-react';
import { useToast } from '../context/ToastContext';

const iconMap = { bank: Landmark, brokerage: TrendingUp, retirement: Shield, debt: CreditCard, wallet: Wallet, other: Briefcase };

const EMPTY_FORM = { name: '', type: 'bank', description: '', initialBalance: '0' };

/**
 * One account.
 *
 * The balance alone hides the thing that matters about an account: how much of it is
 * CASH sitting idle versus assets actually at work. The split bar says that at a glance,
 * and the share-of-total says how much of the picture this one account carries.
 *
 * Balances print exactly as stored — a debt account holds a negative balance of its own,
 * so nothing is negated for display.
 */
function AccountRow({ acc, first, share, onEdit }) {
  const Icon = iconMap[acc.type] || Briefcase;
  const negative = acc.balance < 0;

  const cash   = acc.cashBalance  ?? 0;
  const assets = acc.assetBalance ?? 0;
  // Split only reads on a positive account holding both — a debt has no asset side.
  const gross     = Math.abs(cash) + Math.abs(assets);
  const showSplit = !acc.isDebt && gross > 0 && assets > 0;
  const cashPct   = gross ? (Math.abs(cash) / gross) * 100 : 0;

  return (
    <Link to={`/accounts/${acc._id}`} className="data-row group"
      style={{ textDecoration: 'none', borderTop: first ? 'none' : '1px solid var(--color-border-subtle)', alignItems: 'stretch' }}>
      <div className="flex items-center gap-4" style={{ flex: 1, minWidth: 0 }}>
        <div className="flex-shrink-0" style={{
          width: 38, height: 38, borderRadius: 10,
          background: 'var(--color-bg-elevated)',
          border: '1px solid var(--color-border-subtle)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon size={16} style={{ color: 'var(--color-text-secondary)' }} strokeWidth={1.5} />
        </div>

        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium truncate" style={{ color: 'var(--color-text-primary)' }}>{acc.name}</p>
            {acc.isDebt && <Badge variant="danger">Debt</Badge>}
          </div>
          <p className="text-xs truncate" style={{ color: 'var(--color-text-muted)', marginTop: 2 }}>
            {accountTypeLabel(acc.type)}
            {acc.description && ` · ${acc.description}`}
          </p>

          {showSplit && (
            <div style={{ marginTop: 8, maxWidth: 260 }}>
              <div style={{ display: 'flex', gap: 2, height: 3, borderRadius: 99, overflow: 'hidden' }}>
                <div style={{ width: `${cashPct}%`, background: 'var(--color-text-muted)', opacity: 0.5 }} />
                <div style={{ width: `${100 - cashPct}%`, background: 'var(--color-accent)' }} />
              </div>
              <p className="figure text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 5 }}>
                {compactIfLarge(cash)} cash · {compactIfLarge(assets)} in assets
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3" style={{ flexShrink: 0 }}>
        <div style={{ textAlign: 'right' }}>
          <p className="figure text-sm" style={{
            fontWeight: 500,
            color: negative ? 'var(--color-danger)' : 'var(--color-text-primary)',
          }}>
            {formatCurrency(acc.balance)}
          </p>
          {share != null && (
            <p className="figure text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 2 }}>
              {share.toFixed(0)}% of total
            </p>
          )}
        </div>
        <button onClick={(e) => onEdit(acc, e)}
          className="text-xs opacity-0 group-hover:!opacity-100 transition-opacity"
          style={{ color: 'var(--color-text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px' }}>
          Edit
        </button>
        <ChevronRight size={14} style={{ color: 'var(--color-text-muted)', opacity: 0 }}
          className="group-hover:!opacity-100 transition-opacity" />
      </div>
    </Link>
  );
}

/** A headline figure in the summary strip. */
function Figure({ label, value, accent }) {
  return (
    <div>
      <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{label}</p>
      <p className="figure" style={{ fontSize: '1.0625rem', fontWeight: 500, marginTop: 5, color: accent || 'var(--color-text-primary)' }}>
        {value}
      </p>
    </div>
  );
}

export default function Accounts() {
  const toast = useToast();
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { load(); }, []);
  const load = async () => {
    try {
      const res = await accountsAPI.getAll();
      setAccounts(res.data);
    }
    catch (e) { toast.error(e.response?.data?.message || 'Failed to load accounts'); }
    finally { setLoading(false); }
  };

  const openNew = () => { setEditing(null); setForm(EMPTY_FORM); setError(''); setModal(true); };
  const openEdit = (acc, e) => {
    e.preventDefault();
    setEditing(acc);
    setForm({ name: acc.name, type: acc.type, description: acc.description || '', initialBalance: '' });
    setError('');
    setModal(true);
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (editing) {
        await accountsAPI.update(editing._id, { name: form.name, type: form.type, description: form.description });
      } else {
        await accountsAPI.create(form);
      }
      setModal(false);
      load();
    } catch (err) {
      setError(err.response?.data?.message || err.response?.data?.errors?.[0]?.msg || 'Failed to save account');
    } finally { setSaving(false); }
  };

  const del = async (id) => {
    if (!confirm('Delete this account and all its transactions?')) return;
    try { await accountsAPI.delete(id); load(); }
    catch (e) { toast.error(e.response?.data?.message || 'Failed to delete account'); }
  };

  const isDebt = form.type === 'debt';

  // Debt balances are stored negative, so the net position is a plain sum — liabilities
  // pull it down on their own, with no sign forced here.
  const assetAccounts = accounts.filter(a => !a.isDebt);
  const debtAccounts  = accounts.filter(a => a.isDebt);

  const total     = accounts.reduce((s, a) => s + a.balance, 0);
  const assetsSum = assetAccounts.reduce((s, a) => s + a.balance, 0);
  const debtTotal = debtAccounts.reduce((s, a) => s + a.balance, 0);
  const cashSum   = assetAccounts.reduce((s, a) => s + (a.cashBalance ?? 0), 0);
  const investSum = assetAccounts.reduce((s, a) => s + (a.assetBalance ?? 0), 0);

  if (loading) return <Spinner />;

  return (
    <div className="animate-in" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* Header — the net position in the ledger numeral */}
      <div className="flex items-center justify-between" style={{ gap: 16 }}>
        <div>
          <p className="eyebrow" style={{ marginBottom: 12 }}>Accounts · Net position</p>
          <h1 className="display-number" style={{ color: total < 0 ? 'var(--color-danger)' : 'var(--color-text-primary)' }}>
            {compactIfLarge(total)}
          </h1>
          <p className="text-sm mt-2" style={{ color: 'var(--color-text-muted)' }}>
            {accounts.length} account{accounts.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center" style={{ gap: 16 }}>
          <Button variant="gold" icon={Plus} onClick={openNew}>New account</Button>
        </div>
      </div>

      {/* What the net position is made of — the sum on its own says nothing about
          how much is liquid, how much is at work, and how much is owed. */}
      {accounts.length > 0 && (
        <Card compact>
          {/* "Investments" is the MARKET value of the assets held, not what was paid for
              them — cost basis lives on Analytics, where it sits next to the P&L that
              gives it meaning. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 20 }}>
            <Figure label="Cash" value={compactIfLarge(cashSum)} />
            <Figure label="Investments" value={compactIfLarge(investSum)} />
            <Figure label="Assets" value={compactIfLarge(assetsSum)} />
            <Figure
              label="Liabilities"
              value={compactIfLarge(debtTotal)}
              accent={debtTotal < 0 ? 'var(--color-danger)' : undefined}
            />
          </div>
        </Card>
      )}

      {accounts.length > 0 ? (
        <>
          {assetAccounts.length > 0 && (
            <Card flush>
              {assetAccounts.map((acc, i) => (
                <AccountRow
                  key={acc._id}
                  acc={acc}
                  first={i === 0}
                  share={assetsSum > 0 ? (acc.balance / assetsSum) * 100 : null}
                  onEdit={openEdit}
                />
              ))}
            </Card>
          )}

          {debtAccounts.length > 0 && (
            <div>
              <div className="flex items-baseline justify-between" style={{ marginBottom: 12 }}>
                <p className="eyebrow">Liabilities</p>
                <span className="figure text-sm" style={{ fontWeight: 500, color: 'var(--color-danger)' }}>
                  {formatCurrency(debtTotal)}
                </span>
              </div>
              <Card flush>
                {debtAccounts.map((acc, i) => (
                  <AccountRow key={acc._id} acc={acc} first={i === 0} onEdit={openEdit} />
                ))}
              </Card>
            </div>
          )}
        </>
      ) : (
        <Card className="flex flex-col items-center justify-center" style={{ padding: '64px 24px' }}>
          <Wallet size={28} style={{ color: 'var(--color-text-muted)', opacity: 0.3, marginBottom: 12 }} />
          <p className="text-sm" style={{ color: 'var(--color-text-muted)', marginBottom: 16 }}>No accounts yet</p>
          <Button variant="gold" onClick={openNew}>Create your first account</Button>
        </Card>
      )}

      {/* Modal */}
      <Modal open={modal} onClose={() => setModal(false)}
        eyebrow={editing ? 'Edit' : 'New'}
        title={editing ? 'Edit account' : 'Create account'}
        subtitle={editing ? undefined : 'A container for cash and assets — bank, brokerage, wallet, or debt.'}
        icon={Plus}>
        <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div>
            <label className="label block" style={{ marginBottom: 8 }}>Name</label>
            <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
              className="input-field" placeholder="e.g., HDFC Savings" required autoFocus />
          </div>
          <div>
            <label className="label block" style={{ marginBottom: 8 }}>Type</label>
            <TypePicker
              options={ACCOUNT_TYPE_OPTIONS}
              value={form.type}
              onChange={v => setForm({ ...form, type: v })}
              placeholder="Select account type"
            />
          </div>
          <div>
            <label className="label block" style={{ marginBottom: 8 }}>Description</label>
            <input type="text" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
              className="input-field" placeholder="Optional note" />
          </div>

          {!editing && (
            <div>
              <label className="label block" style={{ marginBottom: 8 }}>Opening balance</label>
              <input type="number" step="any" {...(isDebt ? {} : { min: '0' })}
                value={form.initialBalance}
                onChange={e => setForm({ ...form, initialBalance: e.target.value })}
                className="input-field"
                placeholder={isDebt ? 'e.g. -50000 for ₹50,000 owed' : 'Starting cash balance'} />
              <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 6 }}>
                {isDebt
                  ? 'Enter what you owe as a negative amount — a debt simply holds a negative balance.'
                  : 'Records the current cash in this account as an opening adjustment.'}
              </p>
            </div>
          )}

          {error && <p className="text-xs" style={{ color: 'var(--color-danger)' }}>{error}</p>}

          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <Button type="submit" disabled={saving} style={{ flex: 1 }}>
              {saving ? 'Saving...' : (editing ? 'Save changes' : 'Create account')}
            </Button>
            {editing && (
              <Button type="button" variant="danger" onClick={() => { del(editing._id); setModal(false); }}>
                Delete
              </Button>
            )}
          </div>
        </form>
      </Modal>
    </div>
  );
}
