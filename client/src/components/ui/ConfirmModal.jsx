import { useState, useEffect } from 'react';
import Modal from './Modal';

export default function ConfirmModal({
  open, onClose, onConfirm,
  title, message,
  confirmLabel = 'Delete',
  skipKey          // if provided, shows "Don't ask again" checkbox backed by localStorage
}) {
  const [skipFuture, setSkipFuture] = useState(false);

  // Reset checkbox each time modal opens
  useEffect(() => { if (open) setSkipFuture(false); }, [open]);

  const handleConfirm = () => {
    if (skipKey && skipFuture) localStorage.setItem(skipKey, 'true');
    onConfirm();
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={title || 'Confirm'}>
      <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.875rem', lineHeight: 1.6, marginBottom: 24 }}>
        {message}
      </p>

      {skipKey && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={skipFuture}
            onChange={e => setSkipFuture(e.target.checked)}
            style={{ accentColor: 'var(--color-accent)', width: 14, height: 14, cursor: 'pointer' }}
          />
          <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>Don't ask again</span>
        </label>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button onClick={onClose} className="btn-ghost">Cancel</button>
        <button
          onClick={handleConfirm}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: 'var(--color-danger)', color: '#fff',
            fontWeight: 500, fontSize: '0.8125rem',
            padding: '8px 18px', borderRadius: 'var(--radius-sm)',
            border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            transition: 'opacity 0.15s ease'
          }}
          onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
          onMouseLeave={e => e.currentTarget.style.opacity = '1'}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
