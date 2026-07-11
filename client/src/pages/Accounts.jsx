import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { accountsAPI } from '../lib/api';
import { formatCurrency, compactIfLarge } from '../lib/utils';
import { ACCOUNT_TYPE_OPTIONS } from '../lib/accountPickerOptions';
import Modal from '../components/ui/Modal';
import TypePicker from '../components/forms/TypePicker';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import {
  Plus, Wallet, TrendingUp, Shield, CreditCard,
  Landmark, Briefcase, ChevronRight
} from 'lucide-react';
import { useToast } from '../context/ToastContext';

const iconMap = { bank: Landmark, brokerage: TrendingUp, retirement: Shield, debt: CreditCard, wallet: Wallet, other: Briefcase };

const EMPTY_FORM = { name: '', type: 'bank', description: '', initialBalance: '' };

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
    try { setAccounts((await accountsAPI.getAll()).data); }
    catch(e) { toast.error(e.response?.data?.message || 'Failed to load accounts'); }
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
    } catch(err) {
      const msg = err.response?.data?.message || err.response?.data?.errors?.[0]?.msg || 'Failed to save account';
      setError(msg);
    } finally { setSaving(false); }
  };

  const del = async (id) => {
    if (!confirm('Delete this account and all its transactions?')) return;
    try { await accountsAPI.delete(id); load(); }
    catch(e) { toast.error(e.response?.data?.message || 'Failed to delete account'); }
  };

  const isDebt = form.type === 'debt';
  const total = accounts.reduce((s, a) => s + (a.isDebt ? -Math.abs(a.balance) : a.balance), 0);

  if (loading) return <div className="flex items-center justify-center" style={{ height: '60vh' }}><div className="spinner" /></div>;

  return (
    <div className="animate-in" style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
      {/* Header — total net position in the ledger numeral */}
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
        <Button variant="gold" icon={Plus} onClick={openNew}>New account</Button>
      </div>

      {/* Account list */}
      {accounts.length > 0 ? (
        <Card flush>
          {accounts.map((acc, i) => {
            const Icon = iconMap[acc.type] || Briefcase;
            return (
              <div key={acc._id} style={{ position: 'relative' }}>
                <Link to={`/accounts/${acc._id}`} className="data-row group"
                  style={{ textDecoration: 'none', borderTop: i > 0 ? '1px solid var(--color-border-subtle)' : 'none' }}>
                  <div className="flex items-center gap-4" style={{ flex: 1, minWidth: 0 }}>
                    <div className="flex-shrink-0" style={{
                      width: 38, height: 38, borderRadius: 10,
                      background: 'var(--color-bg-elevated)',
                      border: '1px solid var(--color-border-subtle)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}>
                      <Icon size={16} style={{ color: 'var(--color-text-secondary)' }} strokeWidth={1.5} />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>{acc.name}</p>
                        {acc.isDebt && <Badge variant="danger">Debt</Badge>}
                      </div>
                      <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 2 }}>
                        {acc.type.charAt(0).toUpperCase() + acc.type.slice(1)}
                        {acc.description && ` · ${acc.description}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`figure text-sm ${acc.isDebt ? 'text-[var(--color-danger)]' : ''}`}
                      style={{ fontWeight: 500, ...(acc.isDebt ? {} : { color: 'var(--color-text-primary)' }) }}>
                      {acc.isDebt ? '−' : ''}{formatCurrency(Math.abs(acc.balance))}
                    </span>
                    <button onClick={(e) => openEdit(acc, e)}
                      className="text-xs opacity-0 group-hover:!opacity-100 transition-opacity"
                      style={{ color: 'var(--color-text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px' }}>
                      Edit
                    </button>
                    <ChevronRight size={14} style={{ color: 'var(--color-text-muted)', opacity: 0 }}
                      className="group-hover:!opacity-100 transition-opacity" />
                  </div>
                </Link>
              </div>
            );
          })}
        </Card>
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
            <input type="text" value={form.name} onChange={e => setForm({...form, name: e.target.value})}
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
            <input type="text" value={form.description} onChange={e => setForm({...form, description: e.target.value})}
              className="input-field" placeholder="Optional note" />
          </div>

          {/* Initial balance — only on creation */}
          {!editing && (
            <div>
              <label className="label block" style={{ marginBottom: 8 }}>
                {isDebt ? 'Current debt amount' : 'Opening balance'}
              </label>
              <input type="number" step="any" min="0" value={form.initialBalance}
                onChange={e => setForm({...form, initialBalance: e.target.value})}
                className="input-field"
                placeholder={isDebt ? 'Amount you currently owe' : 'Starting cash balance'} />
              <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 6 }}>
                {isDebt
                  ? 'Records how much debt this account starts with.'
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
