/**
 * The Apex connector: a remote MCP server (Streamable HTTP, stateless) at `/mcp`, behind
 * OAuth (`mcpAuthService`). Users add it in Claude or ChatGPT and ask there, on their own
 * subscription. It serves the assistant's own read-only tools, so answers match the app.
 *
 * Also the signed-in API for the consent page and the list of connected apps (`/api/mcp`).
 */

const express = require('express');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } = require('@modelcontextprotocol/sdk/server/auth/router.js');
const { requireBearerAuth } = require('@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js');
const mongoose = require('mongoose');
const { protect } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');
const { notFound } = require('../utils/httpError');
const { TOOLS, runTool } = require('../services/assistantTools');
const { POLICY } = require('../services/assistantService');
const mcpAuth = require('../services/mcpAuthService');

const INSTRUCTIONS = `Apex is the user's portfolio and money tracker (India). These tools read their complete financial picture: net worth, accounts, holdings, performance, transactions, cashflow, goals and a measured behaviour profile, plus research on any listed instrument. Start with get_overview for context. Quote Apex's figures as given; never estimate one a tool can provide. Money is INR; write lakh/crore for large sums.

${POLICY}`;

const publicUrl = () => new URL(process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 5000}`);

function buildServer(userId) {
  const server = new Server({ name: 'apex', title: 'Apex', version: '1.0.0' }, { capabilities: { tools: {} }, instructions: INSTRUCTIONS });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map(t => ({
      name: t.name, title: t.label, description: t.description, inputSchema: t.schema,
      annotations: { readOnlyHint: true, openWorldHint: false, title: t.label },
    })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const r = await runTool(userId, req.params.name, req.params.arguments || {}, { live: false });
    return { content: [{ type: 'text', text: r.content }], isError: !r.ok };
  });
  return server;
}

/** Mounts the OAuth endpoints (at the root, as the spec requires) and `/mcp`. */
function mountMcp(app) {
  const base = publicUrl();
  const mcpUrl = new URL('/mcp', base);
  app.use(mcpAuthRouter({
    provider: mcpAuth.provider,
    issuerUrl: base,
    resourceServerUrl: mcpUrl,
    scopesSupported: [mcpAuth.SCOPE],
    resourceName: 'Apex',
  }));

  const bearer = requireBearerAuth({ verifier: mcpAuth.provider, resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpUrl) });

  // Stateless: a fresh server per request, bound to the token's user.
  app.post('/mcp', bearer, async (req, res) => {
    const server = buildServer(req.auth.extra.userId);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => { transport.close(); server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      console.error('[mcp]', e);
      if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
    }
  });
  const notAllowed = (req, res) => res.status(405).set('Allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null });
  app.get('/mcp', notAllowed);
  app.delete('/mcp', notAllowed);
}

// ── Signed-in API: the consent page and connected apps ──
const router = express.Router();
router.use(protect);

// @route GET /api/mcp/connector — the URL to paste into Claude or ChatGPT.
router.get('/connector', (req, res) => res.json({ url: new URL('/mcp', publicUrl()).toString() }));

// @route GET /api/mcp/requests/:id — who is asking for access.
router.get('/requests/:id', asyncHandler(async (req, res) => {
  const r = await mcpAuth.pendingRequest(String(req.params.id));
  if (!r) throw notFound('This request has expired. Start the connection again from the app.');
  res.json(r);
}));

// @route POST /api/mcp/requests/:id — { approve } → { redirect }
router.post('/requests/:id', asyncHandler(async (req, res) => {
  const redirect = await mcpAuth.decide(String(req.params.id), req.user._id, req.body.approve === true);
  if (!redirect) throw notFound('This request has expired. Start the connection again from the app.');
  res.json({ redirect });
}));

// @route GET /api/mcp/grants — apps with access.
router.get('/grants', asyncHandler(async (req, res) => res.json(await mcpAuth.listGrants(req.user._id))));

// @route DELETE /api/mcp/grants/:id — revoke immediately.
router.delete('/grants/:id', asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw notFound('Not found');
  await mcpAuth.revokeGrant(req.user._id, req.params.id);
  res.json({ ok: true });
}));

module.exports = { mountMcp, router };
