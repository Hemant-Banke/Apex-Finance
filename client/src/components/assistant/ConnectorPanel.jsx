import { useEffect, useState } from 'react';
import { Copy, Check, Plug, X } from 'lucide-react';
import Card from '../ui/Card';
import ConfirmModal from '../ui/ConfirmModal';
import { mcpAPI } from '../../lib/api';
import { useToast } from '../../context/ToastContext';
import { formatDate } from '../../lib/utils';

const STEPS = [
  ['Claude', 'Settings › Connectors › Add custom connector, then paste the URL.'],
  ['ChatGPT', 'Settings › Apps & Connectors › Create (with developer mode on), then paste the URL.'],
];

/** The Apex connector: ask about your money inside Claude or ChatGPT, on that subscription. */
export default function ConnectorPanel() {
  const toast = useToast();
  const [url, setUrl] = useState('');
  const [grants, setGrants] = useState([]);
  const [copied, setCopied] = useState(false);
  const [toRevoke, setToRevoke] = useState(null);

  const load = () => mcpAPI.grants().then(r => setGrants(r.data)).catch(() => {});
  useEffect(() => {
    mcpAPI.connector().then(r => setUrl(r.data.url)).catch(() => {});
    load();
  }, []);

  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1600); }
    catch { toast.error('Could not copy'); }
  };
  const revoke = async (g) => {
    try { await mcpAPI.revoke(g._id); setToRevoke(null); toast.success('Access revoked'); load(); }
    catch (e) { toast.error(e.response?.data?.message || 'Could not revoke'); }
  };

  return (
    <Card>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <Plug size={16} style={{ color: 'var(--color-text-muted)', marginTop: 3, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>Use Apex inside Claude or ChatGPT</p>
          <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 4, lineHeight: 1.55 }}>
            Have a Claude or ChatGPT subscription? Add Apex as a connector and ask there. It runs on that plan, with no API key.
            The connector is read-only and asks you to approve access.
          </p>

          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <input className="input-field figure" readOnly value={url} onFocus={e => e.target.select()} style={{ flex: 1, fontSize: '0.8125rem' }} />
            <button type="button" className="btn-ghost" onClick={copy} disabled={!url} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {copied ? <Check size={14} /> : <Copy size={14} />}{copied ? 'Copied' : 'Copy'}
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
            {STEPS.map(([app, how]) => (
              <p key={app} className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                <span style={{ color: 'var(--color-text-secondary)', fontWeight: 500 }}>{app}:</span> {how}
              </p>
            ))}
          </div>

          {grants.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <p className="col-head" style={{ marginBottom: 6 }}>Apps with access</p>
              {grants.map(g => (
                <div key={g._id} className="text-sm" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderTop: '1px solid var(--color-border-subtle)' }}>
                  <span style={{ flex: 1, color: 'var(--color-text-secondary)' }}>{g.clientName}</span>
                  <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    {g.lastUsedAt ? `last used ${formatDate(g.lastUsedAt)}` : `since ${formatDate(g.createdAt)}`}
                  </span>
                  <button type="button" title="Revoke" aria-label={`Revoke ${g.clientName}`} onClick={() => setToRevoke(g)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', padding: 4 }}>
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <ConfirmModal open={!!toRevoke} onClose={() => setToRevoke(null)} onConfirm={() => revoke(toRevoke)}
        title="Revoke access" message={`${toRevoke?.clientName || 'This app'} will no longer be able to read your Apex data. You can connect it again later.`} />
    </Card>
  );
}
