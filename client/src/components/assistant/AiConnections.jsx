import { useEffect, useState } from 'react';
import { Sparkles, Plus, Pencil, Trash2, Star } from 'lucide-react';
import Card from '../ui/Card';
import Button from '../ui/Button';
import Badge from '../ui/Badge';
import Spinner from '../ui/Spinner';
import GardenEmpty from '../ui/GardenEmpty';
import ConfirmModal from '../ui/ConfirmModal';
import ConnectAiModal from './ConnectAiModal';
import ConnectorPanel from './ConnectorPanel';
import ProviderLogo from './ProviderLogo';
import { assistantAPI } from '../../lib/api';
import { useToast } from '../../context/ToastContext';
import { formatDate } from '../../lib/utils';

const iconButton = { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', padding: 6 };

/** The user's AI connections: add, edit, choose the default, remove. */
export default function AiConnections() {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [editing, setEditing] = useState(null);   // null | 'new' | a connection
  const [toDelete, setToDelete] = useState(null);

  const load = () => assistantAPI.connections().then(r => setRows(r.data)).catch(() => setRows([]));
  useEffect(() => { load(); }, []);

  const makeDefault = async (c) => {
    try { await assistantAPI.updateConnection(c._id, { isDefault: true }); load(); }
    catch (e) { toast.error(e.response?.data?.message || 'Could not update'); }
  };
  const remove = async (c) => {
    try { await assistantAPI.disconnect(c._id); toast.success('Disconnected'); setToDelete(null); load(); }
    catch (e) { toast.error(e.response?.data?.message || 'Could not remove'); }
  };

  if (!rows) return <Spinner height={200} />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {rows.length ? (
        <Card flush>
          {rows.map((c, i) => (
            <div key={c._id} className="data-row" style={{ borderTop: i > 0 ? '1px solid var(--color-border-subtle)' : 'none', cursor: 'default' }}>
              <div className="flex items-center gap-3" style={{ flex: 1, minWidth: 0 }}>
                <ProviderLogo provider={c.provider} size={34} />
                <div style={{ minWidth: 0 }}>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>{c.label}</p>
                    {c.isDefault && <Badge variant="default">Default</Badge>}
                  </div>
                  <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 2 }}>
                    {c.modelName || c.model} · key <span className="figure">{c.keyHint}</span>
                    {c.lastUsedAt && <> · last used {formatDate(c.lastUsedAt)}</>}
                  </p>
                  {c.lastError && <p className="text-xs" style={{ color: 'var(--color-danger)', marginTop: 2 }}>{c.lastError}</p>}
                </div>
              </div>
              <div className="flex items-center gap-1" style={{ flexShrink: 0 }}>
                {!c.isDefault && (
                  <button type="button" style={iconButton} title="Make default" aria-label="Make default" onClick={() => makeDefault(c)}>
                    <Star size={14} />
                  </button>
                )}
                <button type="button" style={iconButton} title="Edit" aria-label="Edit" onClick={() => setEditing(c)}><Pencil size={14} /></button>
                <button type="button" style={iconButton} title="Remove" aria-label="Remove" onClick={() => setToDelete(c)}><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
        </Card>
      ) : (
        <GardenEmpty compact icon={Sparkles} title="No AI connected"
          text="Connect Claude, ChatGPT, Gemini or an open model with your own API key to use the assistant." />
      )}

      <div>
        <Button variant="secondary" icon={Plus} onClick={() => setEditing('new')}>Connect a provider</Button>
      </div>

      <ConnectorPanel />

      <ConnectAiModal open={!!editing} existing={editing === 'new' ? null : editing}
        onClose={() => setEditing(null)} onSaved={load} />
      <ConfirmModal open={!!toDelete} onClose={() => setToDelete(null)} onConfirm={() => remove(toDelete)}
        title="Disconnect provider"
        message="The saved key is deleted from Apex. Your conversations stay; continue them with another connection." />
    </div>
  );
}
