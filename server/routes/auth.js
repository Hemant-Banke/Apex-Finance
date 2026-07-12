const express = require('express');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const { protect } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');
const { HttpError, badRequest } = require('../utils/httpError');
const { verifyGoogleToken, verifyAppleToken } = require('../services/oauthService');

const router = express.Router();

const generateToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRE });

// Standard auth payload (shared by the password + OAuth flows).
const sessionResponse = (user) => ({
  _id:      user._id,
  name:     user.name,
  email:    user.email,
  currency: user.currency,
  avatar:   user.avatar,
  token:    generateToken(user._id),
});

/** 400 carrying express-validator's field errors, when any rule failed. */
function assertValid(req) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) throw new HttpError(400, 'Validation failed', { errors: errors.array() });
}

/**
 * Resolve a verified OAuth profile to a user: match by the provider's id, else link to
 * an existing account with the same email, else create a fresh account.
 */
async function findOrCreateOAuthUser(profile) {
  const idField = profile.provider === 'google' ? 'googleId' : 'appleId';

  let user = await User.findOne({ [idField]: profile.providerId });
  if (user) return user;

  if (profile.email) {
    user = await User.findOne({ email: profile.email });
    if (user) {
      user[idField] = profile.providerId;
      if (!user.avatar && profile.avatar) user.avatar = profile.avatar;
      await user.save();
      return user;
    }
  }

  if (!profile.email) {
    throw new HttpError(401, `No email provided by ${profile.provider}; cannot create an account`);
  }

  return User.create({
    name:         profile.name,
    email:        profile.email,
    authProvider: profile.provider,
    [idField]:    profile.providerId,
    avatar:       profile.avatar,
  });
}

/**
 * Verify a provider's token and sign in. Google and Apple are the same flow with a
 * different verifier: anything the verifier rejects is a 401 — the credential did not
 * check out — while a missing token is the caller's mistake and keeps its own status.
 */
const oauthLogin = (provider, verify) => asyncHandler(async (req, res) => {
  let profile;
  try {
    profile = await verify(req.body);
  } catch (err) {
    if (err.status) throw err;
    console.error(`${provider} auth error:`, err.message);
    throw new HttpError(401, err.message || `${provider} sign-in failed`);
  }

  res.json(sessionResponse(await findOrCreateOAuthUser(profile)));
});

// @route   POST /api/auth/register
router.post('/register', [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email').isEmail().withMessage('Please include a valid email'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
], asyncHandler(async (req, res) => {
  assertValid(req);

  const { name, email, password } = req.body;
  if (await User.findOne({ email })) throw badRequest('User already exists');

  res.status(201).json(sessionResponse(await User.create({ name, email, password })));
}));

// @route   POST /api/auth/login
//
// The `code` lets the client route a first-time visitor straight to register with the
// email they typed, rather than dead-ending on an error. It does make login an
// account-existence oracle — a deliberate trade for the one-step flow.
router.post('/login', [
  body('email').isEmail().withMessage('Please include a valid email'),
  body('password').exists().withMessage('Password is required'),
], asyncHandler(async (req, res) => {
  assertValid(req);

  const { email, password } = req.body;
  const user = await User.findOne({ email }).select('+password');

  if (!user) {
    throw new HttpError(401, 'No account with that email', { code: 'NO_ACCOUNT' });
  }
  // An OAuth-only account has no password hash to compare against.
  if (!user.password) {
    throw new HttpError(401,
      `This email is registered with ${user.authProvider}. Continue with ${user.authProvider} instead.`,
      { code: 'OAUTH_ONLY' });
  }
  if (!await user.matchPassword(password)) {
    throw new HttpError(401, 'Incorrect password', { code: 'BAD_PASSWORD' });
  }

  res.json(sessionResponse(user));
}));

// @route   POST /api/auth/google  — verify a Google ID token, issue a session
router.post('/google', oauthLogin('Google', ({ credential }) => {
  if (!credential) throw badRequest('Missing Google credential');
  return verifyGoogleToken(credential);
}));

// @route   POST /api/auth/apple  — verify an Apple id_token, issue a session
router.post('/apple', oauthLogin('Apple', ({ id_token, user }) => {
  if (!id_token) throw badRequest('Missing Apple token');
  return verifyAppleToken(id_token, user || {});
}));

// @route   GET /api/auth/me
router.get('/me', protect, (req, res) => res.json(req.user));

module.exports = router;
