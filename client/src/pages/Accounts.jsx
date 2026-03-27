import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { accountsAPI } from '../lib/api';
import { formatCurrency, ACCOUNT_TYPES } from '../lib/utils';
import Modal from '../components/ui/Modal';
import {
  Plus, Wallet, TrendingUp, Shield, CreditCard,
  Landmark, Briefcase, ChevronRight
} from 'lucide-react';

const iconMap = { bank: Landmark, brokerage: TrendingUp, retirement: Shield, debt: CreditCard, wallet: Wallet, other: Briefcase };

const EMPTY_FORM = { name: '', type: 'bank', description: '', initialBalance: '' };

export default function Accounts() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { load(); }, []);
  const load = async () => {
    try { setAccounts((await accountsAPI.getAll()).data); } catch(e) { console.error(e); }
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
    try { await accountsAPI.delete(id); load(); } catch(e) { console.error(e); }
  };

  const isDebt = form.type === 'debt';
  const total = accounts.reduce((s, a) => s + (a.isDebt ? -Math.abs(a.balance) : a.balance), 0);

  if (loading) return <div className="flex items-center justify-center" style={{ height: '60vh' }}><div className="spinner" /></div>;

  return (
    <div className="animate-in" style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <p className="heading-sm mb-2">Accounts</p>
          <h1 className="display-number">{formatCurrency(total)}</h1>
          <p className="text-sm mt-2" style={{ color: 'var(--color-text-muted)' }}>
            {accounts.length} account{accounts.length !== 1 ? 's' : ''}
          </p>
        </div>
        <button onClick={openNew} className="btn-primary"><Plus size={15} /> New account</button>
      </div>

      {/* Account list */}
      {accounts.length > 0 ? (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {accounts.map((acc, i) => {
            const Icon = iconMap[acc.type] || Briefcase;
            return (
              <div key={acc._id} style={{ position: 'relative' }}>
                <Link to={`/accounts/${acc._id}`} className="data-row group"
                  style={{ textDecoration: 'none', borderTop: i > 0 ? '1px solid var(--color-border-subtle)' : 'none' }}>
                  <div className="flex items-center gap-4" style={{ flex: 1, minWidth: 0 }}>
                    <div className="flex-shrink-0" style={{
                      width: 36, height: 36, borderRadius: 10,
                      background: 'var(--color-bg-elevated)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}>
                      <Icon size={16} style={{ color: 'var(--color-text-secondary)' }} strokeWidth={1.5} />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>{acc.name}</p>
                      <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 2 }}>
                        {acc.type.charAt(0).toUpperCase() + acc.type.slice(1)}
                        {acc.description && ` · ${acc.description}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-sm font-semibold tabular-nums ${acc.isDebt ? 'text-[var(--color-danger)]' : ''}`}
                      style={!acc.isDebt ? { color: 'var(--color-text-primary)' } : {}}>
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
        </div>
      ) : (
        <div className="card flex flex-col items-center justify-center" style={{ padding: '64px 24px' }}>
          <Wallet size={28} style={{ color: 'var(--color-text-muted)', opacity: 0.3, marginBottom: 12 }} />
          <p className="text-sm" style={{ color: 'var(--color-text-muted)', marginBottom: 16 }}>No accounts yet</p>
          <button onClick={openNew} className="btn-primary text-xs">Create your first account</button>
        </div>
      )}

      {/* Modal */}
      <Modal open={modal} onClose={() => setModal(false)} title={editing ? 'Edit account' : 'New account'}>
        <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div>
            <label className="label block" style={{ marginBottom: 8 }}>Name</label>
            <input type="text" value={form.name} onChange={e => setForm({...form, name: e.target.value})}
              className="input-field" placeholder="e.g., HDFC Savings" required autoFocus />
          </div>
          <div>
            <label className="label block" style={{ marginBottom: 8 }}>Type</label>
            <select value={form.type} onChange={e => setForm({...form, type: e.target.value})} className="input-field">
              {ACCOUNT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
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
            <button type="submit" disabled={saving} className="btn-primary" style={{ flex: 1 }}>
              {saving ? 'Saving...' : (editing ? 'Save changes' : 'Create account')}
            </button>
            {editing && (
              <button type="button" onClick={() => { del(editing._id); setModal(false); }}
                className="btn-ghost" style={{ color: 'var(--color-danger)' }}>Delete</button>
            )}
          </div>
        </form>
      </Modal>
    </div>
  );
}
