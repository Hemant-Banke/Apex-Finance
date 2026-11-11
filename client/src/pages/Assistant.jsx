import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Sparkles, Plus, ArrowUp, Square, Check, AlertCircle, Trash2, Settings2 } from 'lucide-react';
import SectionHeader from '../components/ui/SectionHeader';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Spinner from '../components/ui/Spinner';
import GardenEmpty from '../components/ui/GardenEmpty';
import ConfirmModal from '../components/ui/ConfirmModal';
import TypePicker from '../components/forms/TypePicker';
import { PageBar } from '../components/layout/TopBar';
import Markdown from '../components/assistant/Markdown';
import ConnectAiModal from '../components/assistant/ConnectAiModal';
import AiConnections from '../components/assistant/AiConnections';
import ConnectorPanel from '../components/assistant/ConnectorPanel';
import ProviderLogo from '../components/assistant/ProviderLogo';
import ThinkingLine from '../components/assistant/ThinkingLine';
import Modal from '../components/ui/Modal';
import { assistantAPI } from '../lib/api';
import { useToast } from '../context/ToastContext';

const SUGGESTIONS = [
  'How am I doing this year?',
  'What actually drove my returns over the last 12 months?',
  'Where is my money going each month, and what changed?',
  'Am I taking more risk than I should?',
  'Which of my habits are costing me money?',
  'Am I on track for my goals?',
];

const CHOICE_KEY = 'apex_assistant_connection';
const readChoice = () => { try { return localStorage.getItem(CHOICE_KEY); } catch { return null; } };
const saveChoice = (id) => { try { localStorage.setItem(CHOICE_KEY, id); } catch { /* per-device convenience */ } };

export default function Assistant() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const activeId = params.get('c');

  const [connections, setConnections] = useState(null);
  const [connectionId, setConnectionId] = useState(readChoice());
  const [convs, setConvs] = useState([]);
  const [messages, setMessages] = useState([]);
  const [loadingConv, setLoadingConv] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [draft, setDraft] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [managing, setManaging] = useState(false);
  const [toDelete, setToDelete] = useState(null);

  const abortRef = useRef(null);
  const scrollRef = useRef(null);
  const stickRef = useRef(true);
  const inputRef = useRef(null);
  // The conversation this page just created, so loading its id does not wipe the streamed reply.
  const createdRef = useRef(null);

  const loadConnections = useCallback(() => assistantAPI.connections()
    .then(r => setConnections(r.data)).catch(() => setConnections([])), []);
  const loadConvs = useCallback(() => assistantAPI.conversations()
    .then(r => setConvs(r.data)).catch(() => {}), []);

  useEffect(() => { loadConnections(); loadConvs(); }, [loadConnections, loadConvs]);

  // The chosen connection, else the default one.
  const connection = useMemo(() => {
    if (!connections?.length) return null;
    return connections.find(c => c._id === connectionId) || connections.find(c => c.isDefault) || connections[0];
  }, [connections, connectionId]);

  useEffect(() => {
    if (!activeId) { setMessages([]); return; }
    if (createdRef.current === activeId) return;
    let alive = true;
    setLoadingConv(true);
    assistantAPI.conversation(activeId)
      .then(r => { if (alive) setMessages(r.data.messages); })
      .catch(() => { if (alive) { setMessages([]); setParams({}, { replace: true }); } })
      .finally(() => alive && setLoadingConv(false));
    return () => { alive = false; };
  }, [activeId, setParams]);

  // Follow the answer as it streams, unless the reader has scrolled up.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);
  const onScroll = () => {
    const el = scrollRef.current;
    if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const updateLast = (fn) => setMessages(ms => {
    const out = [...ms];
    out[out.length - 1] = fn({ ...out[out.length - 1] });
    return out;
  });

  const send = async (text) => {
    const message = (text ?? draft).trim();
    if (!message || streaming || !connection) return;
    setDraft('');
    stickRef.current = true;
    setMessages(ms => [...ms, { role: 'user', text: message }, { role: 'assistant', text: '', tools: [], pending: true }]);
    setStreaming(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      await assistantAPI.chat({ conversationId: activeId || undefined, connectionId: connection._id, message }, (ev) => {
        if (ev.type === 'conversation' && ev.id !== activeId) {
          createdRef.current = ev.id;
          setParams({ c: ev.id }, { replace: true });
          setConvs(cs => [{ _id: ev.id, title: ev.title }, ...cs.filter(c => c._id !== ev.id)]);
        } else if (ev.type === 'text') {
          updateLast(m => ({ ...m, text: m.text + ev.delta }));
        } else if (ev.type === 'tool') {
          updateLast(m => {
            const tools = [...(m.tools || [])];
            const i = tools.findIndex(t => t.id === ev.id);
            const row = { id: ev.id, label: ev.label, status: ev.status };
            if (i >= 0) tools[i] = row; else tools.push(row);
            return { ...m, tools };
          });
        } else if (ev.type === 'done') {
          updateLast(m => ({ ...m, pending: false, error: ev.error || null }));
        } else if (ev.type === 'error') {
          updateLast(m => ({ ...m, pending: false, error: ev.message }));
        }
      }, ctrl.signal);
    } catch (e) {
      updateLast(m => ({ ...m, pending: false, error: ctrl.signal.aborted ? 'Stopped.' : e.message }));
    } finally {
      setStreaming(false);
      abortRef.current = null;
      updateLast(m => ({ ...m, pending: false }));
      loadConvs();
      loadConnections();
      inputRef.current?.focus();
    }
  };

  const newChat = () => {
    if (streaming) return;
    createdRef.current = null;
    setParams({}, { replace: false });
    setMessages([]);
    inputRef.current?.focus();
  };

  const removeConv = async (c) => {
    try {
      await assistantAPI.deleteConversation(c._id);
      setToDelete(null);
      if (c._id === activeId) newChat();
      loadConvs();
    } catch (e) { toast.error(e.response?.data?.message || 'Could not delete'); }
  };

  const chooseConnection = (id) => { setConnectionId(id); saveChoice(id); };

  // Every model each connection's key can use, asked of the provider once per visit.
  const [modelsByConn, setModelsByConn] = useState({});
  useEffect(() => {
    for (const c of connections || []) {
      if (modelsByConn[c._id]) continue;
      setModelsByConn(m => ({ ...m, [c._id]: [] }));
      assistantAPI.models({ connectionId: c._id })
        .then(r => setModelsByConn(m => ({ ...m, [c._id]: r.data })))
        .catch(() => {});
    }
  }, [connections, modelsByConn]);

  // One list of models across connections; picking one switches that connection to it.
  const modelOptions = useMemo(() => (connections || []).flatMap(c => {
    const listed = modelsByConn[c._id] || [];
    const models = listed.some(m => m.id === c.model) ? listed : [{ id: c.model, name: c.modelName || c.model }, ...listed];
    return models.map(m => ({
      value: `${c._id}|${m.id}`, label: m.name,
      sublabel: (connections.length > 1 ? `${c.label} · ` : '') + m.id,
      icon: <ProviderLogo provider={c.provider} size={18} />,
    }));
  }), [connections, modelsByConn]);

  const chooseModel = async (value) => {
    const [id, model] = value.split('|');
    chooseConnection(id);
    const c = connections.find(x => x._id === id);
    if (!c || c.model === model) return;
    const modelName = (modelsByConn[id] || []).find(m => m.id === model)?.name;
    setConnections(cs => cs.map(x => (x._id === id ? { ...x, model, modelName } : x)));
    try { await assistantAPI.updateConnection(id, { model, modelName }); }
    catch (e) { toast.error(e.response?.data?.message || 'Could not switch model'); loadConnections(); }
  };

  const actions = connections?.length ? (
    <>
      <div className="topbar-picker" style={{ width: 210 }}>
        <TypePicker options={modelOptions} value={connection ? `${connection._id}|${connection.model}` : null}
          onChange={chooseModel} searchable showIcon disabled={streaming} />
      </div>
      <Button variant="icon" circular icon={Settings2} title="AI connections" aria-label="AI connections" onClick={() => setManaging(true)} />
      <Button variant="secondary" icon={Plus} onClick={newChat} disabled={streaming}>New chat</Button>
    </>
  ) : null;

  return (
    <div className="animate-in" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <PageBar actions={actions} />
      <SectionHeader title="Ask about your money"
        sub="An assistant that sees your whole financial picture — holdings, trades, spending, goals and habits — running on your own AI account" />

      {connections === null ? <Spinner height="50vh" /> : !connections.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <GardenEmpty icon={Sparkles} title="Connect your AI to begin"
          text="Use your own Claude, ChatGPT, Gemini or open-model API key. Usage is billed by your provider; your key is encrypted and never shown again.">
          <div style={{ marginTop: 18 }}>
            <Button variant="gold" icon={Sparkles} onClick={() => setConnecting(true)}>Connect a provider</Button>
          </div>
        </GardenEmpty>
        <ConnectorPanel />
        </div>
      ) : (
        <div className="chat-layout">
          <Card flush className="chat-history">
            <p className="col-head" style={{ padding: '16px 16px 8px' }}>Conversations</p>
            <div style={{ overflowY: 'auto', flex: 1, padding: '0 8px 8px' }}>
              {!convs.length && <p className="text-xs" style={{ color: 'var(--color-text-muted)', padding: '6px 8px' }}>Your conversations will appear here.</p>}
              {convs.map(c => (
                <div key={c._id} className={`chat-conv${c._id === activeId ? ' is-active' : ''}`}
                  onClick={() => { if (!streaming && c._id !== activeId) { createdRef.current = null; setParams({ c: c._id }); } }}>
                  <span className="chat-conv-title">{c.title}</span>
                  <button type="button" className="chat-conv-delete" title="Delete" aria-label="Delete conversation"
                    onClick={(e) => { e.stopPropagation(); setToDelete(c); }}>
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          </Card>

          <Card flush className="chat-main">
            <div ref={scrollRef} onScroll={onScroll} className="chat-scroll">
              {loadingConv ? <Spinner height={240} /> : !messages.length ? (
                <div className="chat-welcome">
                  <Sparkles size={22} style={{ color: 'var(--color-accent)' }} strokeWidth={1.5} />
                  <p className="heading-lg" style={{ marginTop: 12 }}>What would you like to know?</p>
                  <p className="text-sm" style={{ color: 'var(--color-text-muted)', marginTop: 6, maxWidth: 460, textAlign: 'center' }}>
                    Ask about performance, spending, risk, a holding, or a decision you are weighing.
                  </p>
                  <div className="chat-suggestions">
                    {SUGGESTIONS.map(s => <button key={s} type="button" className="chat-suggestion" onClick={() => send(s)}>{s}</button>)}
                  </div>
                </div>
              ) : (
                <div className="chat-thread">
                  {messages.map((m, i) => m.role === 'user'
                    ? <div key={i} className="chat-user"><p>{m.text}</p></div>
                    : <AssistantMessage key={i} m={m} />)}
                </div>
              )}
            </div>

            <div className="chat-composer">
              <textarea ref={inputRef} rows={1} value={draft} placeholder={`Ask ${connection?.modelName || connection?.model || 'the assistant'}…`}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}
                onInput={e => { e.target.style.height = 'auto'; e.target.style.height = `${Math.min(e.target.scrollHeight, 180)}px`; }} />
              {streaming
                ? <button type="button" className="chat-send" title="Stop" aria-label="Stop" onClick={() => abortRef.current?.abort()}><Square size={13} fill="currentColor" /></button>
                : <button type="button" className="chat-send" title="Send" aria-label="Send" disabled={!draft.trim()} onClick={() => send()}><ArrowUp size={16} /></button>}
            </div>
            <p className="chat-footnote">Answers come from your Apex data and may be wrong. Not advice from a SEBI-registered investment adviser.</p>
          </Card>
        </div>
      )}

      <ConnectAiModal open={connecting} onClose={() => setConnecting(false)} onSaved={loadConnections} />
      <Modal open={managing} onClose={() => { setManaging(false); loadConnections(); }} title="AI connections" eyebrow="Assistant" maxWidth={620}>
        <AiConnections />
      </Modal>
      <ConfirmModal open={!!toDelete} onClose={() => setToDelete(null)} onConfirm={() => removeConv(toDelete)}
        title="Delete conversation" message={`"${toDelete?.title || 'Untitled'}" will be removed from your conversations. This can't be undone.`} />
    </div>
  );
}

function AssistantMessage({ m }) {
  // Shown until the first words arrive, tools included.
  const waiting = m.pending && !m.text;
  return (
    <div className="chat-assistant">
      {(m.tools || []).length > 0 && (
        <div className="chat-tools">
          {m.tools.map((t, i) => (
            <span key={t.id || i} className="chat-tool">
              {t.status === 'start' ? <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} />
                : t.status === 'failed' || t.ok === false ? <AlertCircle size={11} /> : <Check size={11} />}
              {t.label}
            </span>
          ))}
        </div>
      )}
      {waiting && <ThinkingLine />}
      {m.text && <Markdown text={m.text} />}
      {m.pending && m.text && <span className="chat-caret" />}
      {m.error && <p className="chat-error"><AlertCircle size={13} /> {m.error}</p>}
    </div>
  );
}
