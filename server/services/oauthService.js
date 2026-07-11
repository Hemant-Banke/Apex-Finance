/**
 * oauthService — verifies third-party identity tokens (Google, Apple) and
 * normalizes them to a common profile shape:
 *   { provider, providerId, email, emailVerified, name, avatar }
 *
 * Nothing here touches the DB — the auth route decides how to find/create the
 * user. Verification is cryptographic (Google's tokeninfo / Apple's JWKS), so a
 * forged token can never mint a session.
 */
const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');

// ── Google ──────────────────────────────────────────────────────────────────
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

async function verifyGoogleToken(idToken) {
  if (!GOOGLE_CLIENT_ID) throw new Error('Google sign-in is not configured');
  const ticket = await googleClient.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID });
  const p = ticket.getPayload();
  if (!p?.sub) throw new Error('Invalid Google token');
  return {
    provider: 'google',
    providerId: p.sub,
    email: p.email,
    emailVerified: !!p.email_verified,
    name: p.name || (p.email ? p.email.split('@')[0] : 'Apex User'),
    avatar: p.picture || undefined,
  };
}

// ── Apple ───────────────────────────────────────────────────────────────────
// Apple audiences (Services IDs) — comma-separated to allow web + native.
const APPLE_CLIENT_IDS = (process.env.APPLE_CLIENT_ID || '')
  .split(',').map(s => s.trim()).filter(Boolean);

const appleJwks = jwksClient({
  jwksUri: 'https://appleid.apple.com/auth/keys',
  cache: true,
  cacheMaxage: 24 * 60 * 60 * 1000, // Apple rotates keys rarely
  rateLimit: true,
});

function appleSigningKey(header, callback) {
  appleJwks.getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    callback(null, key.getPublicKey());
  });
}

/**
 * @param idToken  the Apple `id_token` from the client
 * @param profile  optional `{ name, email }` Apple sends only on first consent
 */
function verifyAppleToken(idToken, profile = {}) {
  if (!APPLE_CLIENT_IDS.length) return Promise.reject(new Error('Apple sign-in is not configured'));
  return new Promise((resolve, reject) => {
    jwt.verify(
      idToken,
      appleSigningKey,
      { algorithms: ['RS256'], issuer: 'https://appleid.apple.com', audience: APPLE_CLIENT_IDS },
      (err, payload) => {
        if (err) return reject(new Error('Invalid Apple token'));
        if (!payload?.sub) return reject(new Error('Invalid Apple token'));
        // Apple only returns email in the token on the first authorization; the
        // display name never comes in the token, only in the one-time `user` blob.
        const email = payload.email || profile.email;
        const fullName = profile.name && (profile.name.firstName || profile.name.lastName)
          ? [profile.name.firstName, profile.name.lastName].filter(Boolean).join(' ')
          : null;
        resolve({
          provider: 'apple',
          providerId: payload.sub,
          email,
          emailVerified: payload.email_verified === true || payload.email_verified === 'true',
          name: fullName || (email ? email.split('@')[0] : 'Apex User'),
          avatar: undefined,
        });
      }
    );
  });
}

module.exports = { verifyGoogleToken, verifyAppleToken };
