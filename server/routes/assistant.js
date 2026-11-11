const express = require('express');
const mongoose = require('mongoose');
const { protect } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');
const { badRequest, notFound } = require('../utils/httpError');
const AiConnection = require('../models/AiConnection');
const Conversation = require('../models/AssistantConversation');
const { PROVIDERS, listModels } = require('../lib/aiProviders');
const { runTurn } = require('../services/assistantService');
const { seal, open, hint } = require('../utils/secretBox');

const router = express.Router();
router.use(protect);

const validId = (id) => mongoose.Types.ObjectId.isValid(id);

// The client never sees a key, only its last four characters.
const publicConnection = (c) => ({
  _id: c._id, provider: c.provider, label: c.label || PROVIDERS[c.provider]?.label, baseUrl: c.baseUrl || null,
  model: c.model, modelName: c.modelName || null, keyHint: c.keyHint, isDefault: c.isDefault, lastError: c.lastError, lastUsedAt: c.lastUsedAt,
});

async function ownConnection(req) {
  if (!validId(req.params.id)) throw notFound('Connection not found');
  const conn = await AiConnection.findOne({ _id: req.params.id, user: req.user._id });
  if (!conn) throw notFound('Connection not found');
  return conn;
}

function checkProvider(body) {
  if (!PROVIDERS[body.provider]) throw badRequest('Choose an AI provider');
  if (PROVIDERS[body.provider].custom && !body.baseUrl) throw badRequest('Enter the endpoint URL');
}

// @route GET /api/assistant/providers
router.get('/providers', (req, res) => {
  res.json(Object.entries(PROVIDERS).map(([id, p]) => ({ id, label: p.label, keyUrl: p.keyUrl || null, custom: !!p.custom, defaultModel: p.defaultModel || null })));
});

// @route GET /api/assistant/connections
router.get('/connections', asyncHandler(async (req, res) => {
  const rows = await AiConnection.find({ user: req.user._id }).sort({ isDefault: -1, createdAt: 1 });
  res.json(rows.map(publicConnection));
}));

// @route POST /api/assistant/connections/models — check a key and list its models (a saved key when `connectionId` is given).
router.post('/connections/models', asyncHandler(async (req, res) => {
  let conn = req.body, apiKey = req.body.apiKey;
  if (req.body.connectionId) {
    if (!validId(req.body.connectionId)) throw notFound('Connection not found');
    const saved = await AiConnection.findOne({ _id: req.body.connectionId, user: req.user._id });
    if (!saved) throw notFound('Connection not found');
    conn = saved; apiKey = open(saved.key);
  } else {
    checkProvider(conn);
    if (!apiKey?.trim()) throw badRequest('Enter the API key');
  }
  res.json(await listModels(conn, apiKey.trim()));
}));

// @route POST /api/assistant/connections — the key is verified before it is stored.
router.post('/connections', asyncHandler(async (req, res) => {
  const { provider, apiKey, baseUrl, model, label, modelName } = req.body;
  checkProvider(req.body);
  if (!apiKey?.trim()) throw badRequest('Enter the API key');
  if (!model?.trim()) throw badRequest('Choose a model');
  await listModels({ provider, baseUrl }, apiKey.trim());
  const first = !(await AiConnection.exists({ user: req.user._id }));
  const conn = await AiConnection.create({
    user: req.user._id, provider, baseUrl: PROVIDERS[provider].custom ? baseUrl.trim() : undefined,
    model: model.trim(), modelName: modelName?.trim() || undefined, label: label?.trim() || undefined,
    key: seal(apiKey.trim()), keyHint: hint(apiKey.trim()), isDefault: first,
  });
  res.status(201).json(publicConnection(conn));
}));

// @route PATCH /api/assistant/connections/:id — model, label, default, or a new key.
router.patch('/connections/:id', asyncHandler(async (req, res) => {
  const conn = await ownConnection(req);
  const { model, modelName, label, isDefault, apiKey } = req.body;
  if (apiKey?.trim()) {
    await listModels(conn, apiKey.trim());
    conn.key = seal(apiKey.trim());
    conn.keyHint = hint(apiKey.trim());
    conn.lastError = null;
  }
  if (model?.trim() && model.trim() !== conn.model) {
    conn.model = model.trim();
    conn.modelName = modelName?.trim() || undefined;
  }
  if (label !== undefined) conn.label = label?.trim() || undefined;
  if (isDefault === true) {
    await AiConnection.updateMany({ user: req.user._id, _id: { $ne: conn._id } }, { isDefault: false });
    conn.isDefault = true;
  }
  await conn.save();
  res.json(publicConnection(conn));
}));

// @route DELETE /api/assistant/connections/:id
router.delete('/connections/:id', asyncHandler(async (req, res) => {
  const conn = await ownConnection(req);
  await conn.deleteOne();
  if (conn.isDefault) {
    const next = await AiConnection.findOne({ user: req.user._id }).sort({ createdAt: 1 });
    if (next) { next.isDefault = true; await next.save(); }
  }
  res.json({ ok: true });
}));

// @route GET /api/assistant/conversations
router.get('/conversations', asyncHandler(async (req, res) => {
  res.json(await Conversation.find({ user: req.user._id }).sort({ updatedAt: -1 }).limit(100).select('title updatedAt createdAt').lean());
}));

// @route GET /api/assistant/conversations/:id — the visible messages only.
router.get('/conversations/:id', asyncHandler(async (req, res) => {
  if (!validId(req.params.id)) throw notFound('Conversation not found');
  const conv = await Conversation.findOne({ _id: req.params.id, user: req.user._id }).select('title messages usage updatedAt').lean();
  if (!conv) throw notFound('Conversation not found');
  res.json(conv);
}));

// @route PATCH /api/assistant/conversations/:id — rename.
router.patch('/conversations/:id', asyncHandler(async (req, res) => {
  if (!validId(req.params.id)) throw notFound('Conversation not found');
  const title = String(req.body.title || '').trim().slice(0, 80);
  if (!title) throw badRequest('Give it a title');
  const conv = await Conversation.findOneAndUpdate({ _id: req.params.id, user: req.user._id }, { title }, { new: true }).select('title updatedAt').lean();
  if (!conv) throw notFound('Conversation not found');
  res.json(conv);
}));

// @route DELETE /api/assistant/conversations/:id
router.delete('/conversations/:id', asyncHandler(async (req, res) => {
  if (!validId(req.params.id)) throw notFound('Conversation not found');
  await Conversation.deleteOne({ _id: req.params.id, user: req.user._id });
  res.json({ ok: true });
}));

// One answer at a time per user: a second tab must not run two loops on one key.
const running = new Set();

// @route POST /api/assistant/chat — streams Server-Sent Events: conversation, text, tool, done, error.
router.post('/chat', asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { conversationId, connectionId, message } = req.body;
  if (conversationId && !validId(conversationId)) throw notFound('Conversation not found');
  if (connectionId && !validId(connectionId)) throw notFound('Connection not found');
  if (running.has(String(userId))) throw badRequest('Another answer is still being written');

  running.add(String(userId));
  const abort = new AbortController();
  res.on('close', () => { if (!res.writableEnded) abort.abort(); });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const emit = (ev) => {
    if (res.writableEnded) return;
    res.write(`data: ${JSON.stringify(ev)}\n\n`);
    res.flush?.();   // compression buffers otherwise
  };

  try {
    await runTurn({ userId, conversationId, connectionId, message, live: req.body.live === true, emit, signal: abort.signal });
  } catch (e) {
    emit({ type: 'error', message: e.status && e.status < 500 ? e.message : 'The assistant could not answer right now.' });
    if (!(e.status && e.status < 500)) console.error('[assistant chat]', e);
  } finally {
    running.delete(String(userId));
    res.end();
  }
}));

module.exports = router;
