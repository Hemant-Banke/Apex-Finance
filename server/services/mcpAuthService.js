/**
 * mcpAuthService — the OAuth 2.1 authorization server behind the Apex connector, implementing
 * the MCP SDK's `OAuthServerProvider`. Claude / ChatGPT register themselves (dynamic client
 * registration), send the user to Apex's consent page, and receive tokens scoped to that user.
 * PKCE is checked by the SDK; only hashes of codes and tokens are stored.
 */

const crypto = require('crypto');
const McpClient = require('../models/McpClient');
const McpGrant = require('../models/McpGrant');
const { InvalidGrantError, InvalidTokenError } = require('@modelcontextprotocol/sdk/server/auth/errors.js');

const SCOPE = 'apex:read';
const REQUEST_TTL_MS = 10 * 60 * 1000;
const CODE_TTL_MS = 5 * 60 * 1000;
const ACCESS_TTL_MS = 60 * 60 * 1000;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const appUrl = () => (process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/+$/, '');
const random = () => crypto.randomBytes(32).toString('base64url');
const hash = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

const clientsStore = {
  async getClient(clientId) {
    const doc = await McpClient.findOne({ clientId }).lean();
    return doc?.info;
  },
  async registerClient(client) {
    const info = { ...client, client_id: crypto.randomUUID(), client_id_issued_at: Math.floor(Date.now() / 1000) };
    await McpClient.create({ clientId: info.client_id, info });
    return info;
  },
};

// A redirect back to the app that asked, carrying the result.
function redirectWith(uri, params) {
  const url = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
  return url.toString();
}

async function issueTokens(grant) {
  const access = random(), refresh = random();
  grant.accessHash = hash(access);
  grant.accessExpires = new Date(Date.now() + ACCESS_TTL_MS);
  grant.refreshHash = hash(refresh);
  grant.refreshExpires = new Date(Date.now() + REFRESH_TTL_MS);
  grant.codeHash = undefined;
  grant.codeExpires = undefined;
  grant.status = 'active';
  grant.expiresAt = grant.refreshExpires;   // an unused grant ages out with its refresh token
  await grant.save();
  return {
    access_token: access, token_type: 'bearer', expires_in: ACCESS_TTL_MS / 1000,
    refresh_token: refresh, scope: (grant.scopes.length ? grant.scopes : [SCOPE]).join(' '),
  };
}

const provider = {
  clientsStore,

  // Park the request and send the user to Apex to approve it while signed in.
  async authorize(client, params, res) {
    const requestId = random();
    await McpGrant.create({
      requestId, clientId: client.client_id, clientName: client.client_name || 'An app',
      redirectUri: params.redirectUri, state: params.state, scopes: params.scopes || [],
      resource: params.resource?.toString(), codeChallenge: params.codeChallenge,
      expiresAt: new Date(Date.now() + REQUEST_TTL_MS),
    });
    res.redirect(`${appUrl()}/connect/authorize?request=${encodeURIComponent(requestId)}`);
  },

  async challengeForAuthorizationCode(client, code) {
    const grant = await McpGrant.findOne({ codeHash: hash(code), clientId: client.client_id, status: 'approved' }).lean();
    if (!grant || grant.codeExpires < new Date()) throw new InvalidGrantError('Invalid or expired authorization code');
    return grant.codeChallenge;
  },

  async exchangeAuthorizationCode(client, code, _verifier, redirectUri) {
    const grant = await McpGrant.findOne({ codeHash: hash(code), clientId: client.client_id, status: 'approved' });
    if (!grant || grant.codeExpires < new Date()) throw new InvalidGrantError('Invalid or expired authorization code');
    if (redirectUri && redirectUri !== grant.redirectUri) throw new InvalidGrantError('redirect_uri does not match');
    return issueTokens(grant);
  },

  // Refresh tokens rotate: the old one stops working the moment a new pair is issued.
  async exchangeRefreshToken(client, refreshToken) {
    const grant = await McpGrant.findOne({ refreshHash: hash(refreshToken), clientId: client.client_id, status: 'active' });
    if (!grant || grant.refreshExpires < new Date()) throw new InvalidGrantError('Invalid or expired refresh token');
    return issueTokens(grant);
  },

  async verifyAccessToken(token) {
    const grant = await McpGrant.findOne({ accessHash: hash(token), status: 'active' }).lean();
    if (!grant || grant.accessExpires < new Date()) throw new InvalidTokenError('Invalid or expired token');
    McpGrant.updateOne({ _id: grant._id }, { lastUsedAt: new Date() }).catch(() => {});
    return {
      token, clientId: grant.clientId, scopes: grant.scopes.length ? grant.scopes : [SCOPE],
      expiresAt: Math.floor(grant.accessExpires.getTime() / 1000),
      extra: { userId: String(grant.user) },
    };
  },

  async revokeToken(client, { token }) {
    const h = hash(token);
    await McpGrant.updateOne({ clientId: client.client_id, $or: [{ accessHash: h }, { refreshHash: h }] }, { status: 'revoked' });
  },
};

/** What the consent page shows: who is asking, and where the answer goes. */
async function pendingRequest(requestId) {
  const g = await McpGrant.findOne({ requestId, status: 'pending' }).lean();
  if (!g || g.expiresAt < new Date()) return null;
  return { clientName: g.clientName, redirectHost: new URL(g.redirectUri).host };
}

/** The user's answer. Returns the URL to send the browser to. */
async function decide(requestId, userId, approve) {
  const grant = await McpGrant.findOne({ requestId, status: 'pending' });
  if (!grant || grant.expiresAt < new Date()) return null;
  if (!approve) {
    await grant.deleteOne();
    return redirectWith(grant.redirectUri, { error: 'access_denied', state: grant.state });
  }
  const code = random();
  grant.user = userId;
  grant.status = 'approved';
  grant.requestId = undefined;
  grant.codeHash = hash(code);
  grant.codeExpires = new Date(Date.now() + CODE_TTL_MS);
  grant.expiresAt = grant.codeExpires;
  await grant.save();
  return redirectWith(grant.redirectUri, { code, state: grant.state });
}

const listGrants = (userId) => McpGrant.find({ user: userId, status: 'active' })
  .select('clientName createdAt lastUsedAt').sort({ createdAt: -1 }).lean();

const revokeGrant = (userId, id) => McpGrant.updateOne({ _id: id, user: userId }, { status: 'revoked', expiresAt: new Date() });

module.exports = { provider, SCOPE, pendingRequest, decide, listGrants, revokeGrant };
