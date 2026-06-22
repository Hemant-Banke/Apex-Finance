import { useState, useRef } from 'react';
import { Upload, FileText, Image, Lock, AlertCircle } from 'lucide-react';
import { importAPI } from '../../lib/api';

const ACCEPT = '.pdf,.html,.htm,.png,.jpg,.jpeg,.webp';

export default function StatementUpload({ accounts, onParsed }) {
  const [file, setFile]           = useState(null);
  const [accountId, setAccountId] = useState(accounts[0]?._id || '');
  const [password, setPassword]   = useState('');
  const [needsPw, setNeedsPw]     = useState(false);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');
  const [dragOver, setDragOver]   = useState(false);
  const inputRef = useRef(null);

  const isImage = file && /\.(png|jpe?g|webp)$/i.test(file.name);
  const isPdf   = file && /\.pdf$/i.test(file.name);
  const isHtml  = file && /\.html?$/i.test(file.name);

  function handleFile(f) {
    if (!f) return;
    setFile(f);
    setError('');
    setNeedsPw(false);
    setPassword('');
  }

  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }

  async function handleParse() {
    if (!file) return;
    if (!accountId) { setError('Please select an account'); return; }
    setLoading(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (password) fd.append('password', password);

      const res = await importAPI.parse(fd);
      const data = res.data;
      if (!data.transactions?.length) {
        setError('No transactions found in this file. Please check the file and try again.');
        return;
      }
      onParsed({ ...data, accountId });
    } catch (err) {
      const resp = err.response?.data;
      if (resp?.needsPassword) {
        setNeedsPw(true);
        setError('This PDF is password-protected. Enter the password below.');
      } else {
        setError(resp?.message || 'Failed to parse file. Please try a different file.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Account selector */}
      <div>
        <label className="label block" style={{ marginBottom: 8 }}>Import into account</label>
        <select
          value={accountId}
          onChange={e => setAccountId(e.target.value)}
          className="input-field"
        >
          <option value="">Select account…</option>
          {accounts.filter(a => !a.isDebt).map(a => (
            <option key={a._id} value={a._id}>{a.name} ({a.type})</option>
          ))}
        </select>
      </div>

      {/* Drop zone */}
      <div
        onClick={() => !file && inputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        style={{
          border: `2px dashed ${dragOver ? 'var(--color-accent)' : file ? 'var(--color-border-hover)' : 'var(--color-border)'}`,
          borderRadius: 'var(--radius)',
          padding: '32px 24px',
          textAlign: 'center',
          cursor: file ? 'default' : 'pointer',
          background: dragOver ? 'var(--color-accent-dim)' : 'var(--color-bg-elevated)',
          transition: 'all 0.2s',
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          style={{ display: 'none' }}
          onChange={e => handleFile(e.target.files[0])}
        />

        {file ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            {isImage ? <Image size={28} style={{ color: 'var(--color-accent)' }} />
             : <FileText size={28} style={{ color: 'var(--color-accent)' }} />}
            <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>{file.name}</p>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {(file.size / 1024).toFixed(0)} KB
              {isImage && ' · Screenshot / photo'}
              {isPdf   && ' · PDF bank statement'}
              {isHtml  && ' · UPI HTML export'}
            </p>
            <button
              type="button"
              onClick={e => { e.stopPropagation(); setFile(null); setNeedsPw(false); setPassword(''); setError(''); }}
              style={{ marginTop: 4, fontSize: '0.75rem', color: 'var(--color-text-muted)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
            >
              Choose a different file
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            <Upload size={28} style={{ color: 'var(--color-text-muted)', opacity: 0.5 }} />
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
                Drop your bank statement here
              </p>
              <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 4 }}>
                PDF · HTML (UPI) · Screenshot (PNG/JPG) · up to 20 MB
              </p>
            </div>
            <button type="button" className="btn-ghost" style={{ marginTop: 4, fontSize: '0.8125rem' }}>
              Browse file
            </button>
          </div>
        )}
      </div>

      {/* Password input for locked PDFs */}
      {(needsPw || isPdf) && (
        <div>
          <label className="label block" style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Lock size={11} /> PDF password
            {!needsPw && <span style={{ fontWeight: 400, color: 'var(--color-text-muted)', marginLeft: 4 }}>(if protected)</span>}
          </label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="input-field"
            placeholder={needsPw ? 'Required — enter PDF password' : 'Leave blank if not password protected'}
            autoFocus={needsPw}
          />
          {isPdf && (
            <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 6 }}>
              Your password is used only to unlock this file and is never stored.
            </p>
          )}
        </div>
      )}

      {/* Image note */}
      {isImage && (
        <div style={{ display: 'flex', gap: 8, padding: '10px 14px', borderRadius: 'var(--radius-sm)', background: 'var(--color-accent-muted)', border: '1px solid var(--color-accent-dim)' }}>
          <AlertCircle size={14} style={{ color: 'var(--color-accent)', flexShrink: 0, marginTop: 1 }} />
          <p className="text-xs" style={{ color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
            Screenshots are parsed using AI. Requires <code style={{ fontFamily: 'monospace', color: 'var(--color-accent)' }}>ANTHROPIC_API_KEY</code> on the server.
          </p>
        </div>
      )}

      {/* Error */}
      {error && (
        <p className="text-xs" style={{ color: 'var(--color-danger)' }}>{error}</p>
      )}

      {/* Parse button */}
      <button
        type="button"
        onClick={handleParse}
        disabled={!file || !accountId || loading}
        className="btn-primary"
        style={{ width: '100%', padding: '11px 18px' }}
      >
        {loading ? (
          <><div className="spinner" style={{ width: 15, height: 15, borderWidth: 2 }} />
          <span>Parsing{isImage ? ' with AI' : ''}…</span></>
        ) : (
          <><Upload size={14} /><span>Parse transactions</span></>
        )}
      </button>
    </div>
  );
}
