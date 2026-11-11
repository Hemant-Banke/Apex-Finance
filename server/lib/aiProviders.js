/**
 * aiProviders — the assistant's model calls, made with the USER's own key.
 *
 * Two wire formats cover every provider: Anthropic's Messages API (through its SDK) and the
 * OpenAI-compatible Chat Completions API (OpenAI, Gemini, OpenRouter, Groq, … and any custom
 * https endpoint). Each adapter streams one step of the tool loop and returns the provider's
 * own assistant message, which is replayed unchanged on the next step.
 *
 * Distinct from lib/llmService, which uses the APP's key for statement import.
 */

const Anthropic = require('@anthropic-ai/sdk');
const { HttpError, badRequest } = require('../utils/httpError');
const { assertPublicHttps } = require('../utils/safeUrl');

const PROVIDERS = {
  anthropic:  { label: 'Anthropic (Claude)', kind: 'anthropic', defaultModel: 'claude-opus-5-5', keyUrl: 'https://platform.claude.com/settings/keys' },
  openai:     { label: 'OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1', keyUrl: 'https://platform.openai.com/api-keys', usage: true },
  gemini:     { label: 'Google Gemini', kind: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', keyUrl: 'https://aistudio.google.com/apikey' },
  openrouter: { label: 'OpenRouter (open models)', kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1', keyUrl: 'https://openrouter.ai/keys', usage: true },
  groq:       { label: 'Groq', kind: 'openai', baseUrl: 'https://api.groq.com/openai/v1', keyUrl: 'https://console.groq.com/keys' },
  together:   { label: 'Together AI', kind: 'openai', baseUrl: 'https://api.together.xyz/v1', keyUrl: 'https://api.together.ai/settings/api-keys' },
  deepseek:   { label: 'DeepSeek', kind: 'openai', baseUrl: 'https://api.deepseek.com/v1', keyUrl: 'https://platform.deepseek.com/api_keys' },
  mistral:    { label: 'Mistral', kind: 'openai', baseUrl: 'https://api.mistral.ai/v1', keyUrl: 'https://console.mistral.ai/api-keys' },
  xai:        { label: 'xAI (Grok)', kind: 'openai', baseUrl: 'https://api.x.ai/v1', keyUrl: 'https://console.x.ai' },
  custom:     { label: 'Other (OpenAI-compatible)', kind: 'openai', custom: true },
};

// Claude models that take the server-side refusal fallback (`fallbacks: "default"`).
const FALLBACK_MODELS = /^claude-(fable-5-1|opus-5-5|opus-5|sonnet-5-5)$/;
const MAX_TOKENS = 16000;

function providerOf(id) {
  const p = PROVIDERS[id];
  if (!p) throw badRequest('Unknown AI provider');
  return p;
}

async function baseUrlOf(conn) {
  const p = providerOf(conn.provider);
  return p.custom ? assertPublicHttps(conn.baseUrl) : p.baseUrl;
}

// A provider failure the user can act on, phrased for them; anything else stays generic.
function providerError(status, detail) {
  const msg = status === 401 || status === 403 ? 'The AI provider rejected the API key.'
    : status === 429 ? 'The AI provider is rate-limiting this key, or its credit has run out. Try again shortly.'
    : status === 404 ? 'The AI provider does not recognise that model.'
    : status === 400 ? `The AI provider refused the request${detail ? `: ${String(detail).slice(0, 200)}` : '.'}`
    : 'The AI provider is unavailable right now.';
  return new HttpError(424, msg);   // 4xx: the message is the user's to act on
}

// ── Anthropic ───────────────────────────────────────────────────────────────

const anthropicClient = (apiKey) => new Anthropic({ apiKey, maxRetries: 2 });

function fromAnthropicError(e) {
  if (e instanceof Anthropic.APIError) return providerError(e.status, e.error?.error?.message || e.message);
  return e;
}

async function anthropicStep({ apiKey, model, system, messages, tools, onText, signal }) {
  const client = anthropicClient(apiKey);
  const body = {
    model,
    max_tokens: MAX_TOKENS,
    // The fixed instructions are cached; the per-request brief follows the breakpoint.
    system: [
      { type: 'text', text: system.fixed, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: system.brief },
    ],
    tools: tools.map(t => ({ name: t.name, description: t.description, input_schema: t.schema })),
    messages,
  };
  const run = async (params) => {
    const stream = client.beta.messages.stream(params, { signal });
    stream.on('text', (delta) => onText(delta));
    return stream.finalMessage();
  };

  let msg;
  try {
    if (FALLBACK_MODELS.test(model)) {
      try {
        msg = await run({ ...body, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
      } catch (e) {
        // An organisation without the fallback beta gets the plain request instead.
        if (!(e instanceof Anthropic.BadRequestError) || !/fallback/i.test(e.message)) throw e;
        msg = await run(body);
      }
    } else {
      msg = await run(body);
    }
  } catch (e) { throw fromAnthropicError(e); }

  const calls = msg.content.filter(b => b.type === 'tool_use').map(b => ({ id: b.id, name: b.name, args: b.input || {} }));
  const stop = msg.stop_reason === 'refusal' ? 'refusal'
    : msg.stop_reason === 'max_tokens' ? 'length'
    : calls.length ? 'tools' : 'end';
  return {
    append: [{ role: 'assistant', content: msg.content }],
    calls: stop === 'tools' ? calls : [],
    stop,
    usage: { input: (msg.usage?.input_tokens || 0) + (msg.usage?.cache_read_input_tokens || 0) + (msg.usage?.cache_creation_input_tokens || 0), output: msg.usage?.output_tokens || 0 },
  };
}

// ── OpenAI-compatible ───────────────────────────────────────────────────────

async function openaiFetch(url, apiKey, init) {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`, ...(init.headers || {}) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let detail = text;
    try { detail = JSON.parse(text)?.error?.message || text; } catch { /* not JSON */ }
    throw providerError(res.status, detail);
  }
  return res;
}

async function openaiStep(conn, { apiKey, model, system, messages, tools, onText, signal }) {
  const base = await baseUrlOf(conn);
  const res = await openaiFetch(`${base}/chat/completions`, apiKey, {
    method: 'POST',
    signal,
    body: JSON.stringify({
      model,
      stream: true,
      ...(providerOf(conn.provider).usage ? { stream_options: { include_usage: true } } : {}),
      messages: [{ role: 'system', content: `${system.fixed}\n\n${system.brief}` }, ...messages],
      tools: tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.schema } })),
    }),
  });

  let content = '', finish = null, usage = { input: 0, output: 0 };
  const calls = [];   // by index; whole objects kept, since some providers attach fields that must be echoed back
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      let ev;
      try { ev = JSON.parse(data); } catch { continue; }
      if (ev.usage) usage = { input: ev.usage.prompt_tokens || 0, output: ev.usage.completion_tokens || 0 };
      const choice = ev.choices?.[0];
      if (!choice) continue;
      const d = choice.delta || {};
      if (d.content) { content += d.content; onText(d.content); }
      for (const tc of d.tool_calls || []) {
        const i = tc.index ?? calls.length;
        const cur = calls[i] || (calls[i] = { id: '', type: 'function', function: { name: '', arguments: '' } });
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.function.name += tc.function.name;
        if (tc.function?.arguments) cur.function.arguments += tc.function.arguments;
        for (const [k, v] of Object.entries(tc)) if (!['index', 'id', 'type', 'function'].includes(k)) cur[k] = v;
      }
      if (choice.finish_reason) finish = choice.finish_reason;
    }
  }

  const toolCalls = calls.filter(Boolean).map((c, i) => ({ ...c, id: c.id || `call_${i}` }));
  const parsed = toolCalls.map(c => {
    let args = {};
    try { args = c.function.arguments ? JSON.parse(c.function.arguments) : {}; } catch { args = null; }
    return { id: c.id, name: c.function.name, args };
  });
  const stop = finish === 'length' ? 'length' : finish === 'content_filter' ? 'refusal'
    : toolCalls.length ? 'tools' : 'end';
  const assistant = { role: 'assistant', content: content || null };
  if (toolCalls.length) assistant.tool_calls = toolCalls;
  return { append: [assistant], calls: stop === 'tools' ? parsed : [], stop, usage };
}

// ── Shared surface ──────────────────────────────────────────────────────────

/** One model step: streams text through `onText`, returns the native messages to append and any tool calls. */
function runStep(conn, opts) {
  return providerOf(conn.provider).kind === 'anthropic' ? anthropicStep(opts) : openaiStep(conn, opts);
}

/** Tool results in the provider's own shape; Anthropic wants them all in ONE user message. */
function toolResults(kind, results) {
  if (kind === 'anthropic') {
    return [{ role: 'user', content: results.map(r => ({ type: 'tool_result', tool_use_id: r.id, content: r.content, ...(r.isError ? { is_error: true } : {}) })) }];
  }
  return results.map(r => ({ role: 'tool', tool_call_id: r.id, content: r.content }));
}

const userMessage = (_kind, text) => ({ role: 'user', content: text });

/** A transcript rebuilt from what the user saw, for a conversation continued on another model. */
function fromTranscript(kind, messages) {
  return messages.filter(m => m.text).map(m => ({ role: m.role, content: m.text }));
}

/** The models a key can use, newest first where the provider says. Doubles as the key check. */
async function listModels(conn, apiKey) {
  const p = providerOf(conn.provider);
  if (p.kind === 'anthropic') {
    try {
      const out = [];
      for await (const m of anthropicClient(apiKey).models.list({ limit: 100 })) out.push({ id: m.id, name: m.display_name || m.id });
      return out;
    } catch (e) { throw fromAnthropicError(e); }
  }
  const base = await baseUrlOf(conn);
  const res = await openaiFetch(`${base}/models`, apiKey, { method: 'GET' });
  const json = await res.json().catch(() => ({}));
  const rows = Array.isArray(json.data) ? json.data : Array.isArray(json.models) ? json.models : [];
  return rows
    .map(m => ({ id: String(m.id || m.name || '').replace(/^models\//, ''), name: m.name && m.name !== m.id ? String(m.name) : String(m.id || '').replace(/^models\//, ''), created: m.created || 0 }))
    .filter(m => m.id)
    .sort((a, b) => (b.created - a.created) || a.id.localeCompare(b.id))
    .map(({ id, name }) => ({ id, name }));
}

// Storage can drop an empty object; a tool call must always carry its arguments.
function repair(kind, messages) {
  if (kind !== 'anthropic') return [...messages];
  return messages.map(m => (Array.isArray(m.content)
    ? { ...m, content: m.content.map(b => (b.type === 'tool_use' && !b.input ? { ...b, input: {} } : b)) }
    : m));
}

const kindOf = (provider) => providerOf(provider).kind;

module.exports = { PROVIDERS, repair, runStep, toolResults, userMessage, fromTranscript, listModels, kindOf };
