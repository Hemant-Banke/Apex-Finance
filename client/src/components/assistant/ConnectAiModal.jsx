import { useEffect, useMemo, useState } from 'react';
import { KeyRound, ExternalLink, ShieldCheck } from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import TypePicker from '../forms/TypePicker';
import ProviderLogo from './ProviderLogo';
import { assistantAPI } from '../../lib/api';
import { useToast } from '../../context/ToastContext';

/**
 * Connect an AI provider with the user's own API key, or edit a saved connection (`existing`).
 * The key is checked by listing its models, which also fills the model picker.
 */
export default function ConnectAiModal({ open, onClose, onSaved, existing = null }) {
  const toast = useToast();
  const [providers, setProviders] = useState([]);
  const [provider, setProvider] = useState(existing?.provider || 'anthropic');
  const [baseUrl, setBaseUrl] = useState(existing?.baseUrl || '');
  const [apiKey, setApiKey] = useState('');
  const [models, setModels] = useState(null);
  const [model, setModel] = useState(existing?.model || '');
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setProvider(existing?.provider || 'anthropic');
    setBaseUrl(existing?.baseUrl || '');
    setApiKey(''); setModels(null); setModel(existing?.model || ''); setError('');
    assistantAPI.providers().then(r => setProviders(r.data)).catch(() => {});
    // An existing connection lists its models from the saved key straight away.
    if (existing) {
      assistantAPI.models({ connectionId: existing._id }).then(r => setModels(r.data)).catch(() => setModels([]));
    }
  }, [open, existing]);

  const meta = providers.find(p => p.id === provider);

  const check = async () => {
    setError('');
    if (!apiKey.trim()) { setError('Paste the API key first'); return; }
    setChecking(true);
    try {
      const { data } = await assistantAPI.models({ provider, apiKey: apiKey.trim(), baseUrl: baseUrl.trim() || undefined });
      setModels(data);
      const preferred = data.find(m => m.id === meta?.defaultModel) || data[0];
      if (!model || !data.some(m => m.id === model)) setModel(preferred?.id || '');
      if (!data.length) setError('The key works, but the provider listed no models. Type the model id below.');
    } catch (e) {
      setModels(null);
      setError(e.response?.data?.message || 'Could not check the key');
    } finally { setChecking(false); }
  };

  const save = async () => {
    setError('');
    setSaving(true);
    try {
      const body = { model: model.trim(), modelName: models?.find(m => m.id === model.trim())?.name };
      if (existing) {
        if (apiKey.trim()) body.apiKey = apiKey.trim();
        await assistantAPI.updateConnection(existing._id, body);
      } else {
        await assistantAPI.connect({ ...body, provider, apiKey: apiKey.trim(), baseUrl: baseUrl.trim() || undefined });
      }
      toast.success(existing ? 'Connection updated' : 'Connected');
      onSaved?.();
      onClose();
    } catch (e) {
      setError(e.response?.data?.message || 'Could not save the connection');
    } finally { setSaving(false); }
  };

  const providerOptions = useMemo(() => providers.map(p => ({ value: p.id, label: p.label, icon: <ProviderLogo provider={p.id} size={20} /> })), [providers]);
  const modelOptions = useMemo(() => (models || []).map(m => ({ value: m.id, label: m.name, sublabel: m.name !== m.id ? m.id : undefined, icon: <ProviderLogo provider={existing?.provider || provider} size={18} /> })), [models, provider, existing]);
  const canSave = model.trim() && (existing || (apiKey.trim() && models));

  return (
    <Modal open={open} onClose={onClose} eyebrow="Assistant" maxWidth={520}
      title={existing ? 'Edit connection' : 'Connect your AI'}
      subtitle={existing ? undefined : 'The assistant runs on your own account with the provider, billed to you.'}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {!existing && (
          <div>
            <p className="label" style={{ marginBottom: 6 }}>Provider</p>
            <TypePicker options={providerOptions} value={provider} searchable showIcon
              onChange={(v) => { setProvider(v); setModels(null); setModel(''); setError(''); }} />
          </div>
        )}

        {!existing && meta?.custom && (
          <div>
            <p className="label" style={{ marginBottom: 6 }}>Endpoint (OpenAI-compatible)</p>
            <input className="input-field" placeholder="https://api.example.com/v1" value={baseUrl}
              onChange={e => { setBaseUrl(e.target.value); setModels(null); }} />
          </div>
        )}

        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
            <p className="label">{existing ? `API key (saved ${existing.keyHint}; paste to replace)` : 'API key'}</p>
            {meta?.keyUrl && (
              <a href={meta.keyUrl} target="_blank" rel="noopener noreferrer" className="text-xs"
                style={{ color: 'var(--color-text-muted)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                Get a key <ExternalLink size={11} />
              </a>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="input-field" type="password" autoComplete="off" spellCheck={false}
              placeholder={existing ? 'Leave blank to keep the saved key' : 'Paste your key'}
              value={apiKey} onChange={e => { setApiKey(e.target.value); if (!existing) setModels(null); }}
              onKeyDown={e => { if (e.key === 'Enter' && !existing) check(); }} style={{ flex: 1 }} />
            {!existing && (
              <Button variant="secondary" icon={KeyRound} onClick={check} disabled={checking || !apiKey.trim()}>
                {checking ? 'Checking…' : 'Check'}
              </Button>
            )}
          </div>
        </div>

        {(models || existing) && (
          <div>
            <p className="label" style={{ marginBottom: 6 }}>Model</p>
            {modelOptions.length
              ? <TypePicker options={modelOptions} value={model} onChange={setModel} searchable showIcon placeholder="Choose a model" />
              : <input className="input-field" placeholder="Model id" value={model} onChange={e => setModel(e.target.value)} />}
            <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 6 }}>
              Choose a model that supports tool use. Larger models give better analysis; smaller ones are cheaper and faster.
            </p>
          </div>
        )}

        {error && <p className="text-sm" style={{ color: 'var(--color-danger)' }}>{error}</p>}

        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '12px 14px', borderRadius: 10, background: 'var(--color-bg-input)' }}>
          <ShieldCheck size={15} style={{ color: 'var(--color-text-muted)', flexShrink: 0, marginTop: 2 }} />
          <p className="text-xs" style={{ color: 'var(--color-text-muted)', lineHeight: 1.55 }}>
            Your key is encrypted on Apex's server and never shown again. When you ask a question, the parts of your
            financial data needed to answer it are sent to this provider under your account's terms.
          </p>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="gold" onClick={save} disabled={!canSave || saving}>
            {saving ? 'Saving…' : existing ? 'Save' : 'Connect'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
