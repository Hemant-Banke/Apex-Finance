import { createContext, useContext, useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, AlertCircle, CheckCircle2 } from 'lucide-react';

const Ctx = createContext(null);

let nextId = 0;

function ToastItem({ item, onDismiss }) {
  const isError = item.type === 'error';
  return (
    <div style={{
      pointerEvents: 'all',
      display: 'flex',
      alignItems: 'flex-start',
      gap: 10,
      background: 'var(--color-bg-elevated)',
      border: '1px solid var(--color-border)',
      borderLeft: isError
        ? '3px solid var(--color-danger)'
        : '3px solid var(--color-success)',
      borderRadius: 'var(--radius-sm)',
      padding: '12px 14px',
      minWidth: 280,
      maxWidth: 380,
      boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
      animation: 'toast-in 0.2s ease',
    }}>
      {isError
        ? <AlertCircle size={15} style={{ color: 'var(--color-danger)', flexShrink: 0, marginTop: 1 }} />
        : <CheckCircle2 size={15} style={{ color: 'var(--color-success)', flexShrink: 0, marginTop: 1 }} />
      }
      <p style={{ flex: 1, fontSize: 13, color: 'var(--color-text-primary)', lineHeight: 1.5 }}>
        {item.msg}
      </p>
      <button
        onClick={onDismiss}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--color-text-muted)', padding: 2, flexShrink: 0,
          display: 'flex', alignItems: 'center',
        }}
      >
        <X size={13} />
      </button>
    </div>
  );
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef({});

  const dismiss = useCallback((id) => {
    clearTimeout(timers.current[id]);
    delete timers.current[id];
    setToasts(t => t.filter(x => x.id !== id));
  }, []);

  const add = useCallback((msg, type = 'error', duration = 4500) => {
    const id = ++nextId;
    setToasts(t => [...t.slice(-3), { id, msg, type }]);
    timers.current[id] = setTimeout(() => dismiss(id), duration);
  }, [dismiss]);

  const toast = {
    error:   (msg) => add(msg, 'error'),
    success: (msg) => add(msg, 'success'),
  };

  return (
    <Ctx.Provider value={toast}>
      {children}
      {createPortal(
        <div style={{
          position: 'fixed', bottom: 24, right: 24,
          zIndex: 9999, display: 'flex', flexDirection: 'column',
          gap: 8, pointerEvents: 'none',
        }}>
          {toasts.map(item => (
            <ToastItem key={item.id} item={item} onDismiss={() => dismiss(item.id)} />
          ))}
        </div>,
        document.body
      )}
    </Ctx.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
