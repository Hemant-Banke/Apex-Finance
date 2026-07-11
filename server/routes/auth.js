const express = require('express');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const { protect } = require('../middleware/auth');
const { verifyGoogleToken, verifyAppleToken } = require('../services/oauthService');

const router = express.Router();

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE
  });
};

// Standard auth payload (shared by password + OAuth flows).
const sessionResponse = (user) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  currency: user.currency,
  avatar: user.avatar,
  token: generateToken(user._id)
});

/**
 * Resolve a verified OAuth profile to a user: match by the provider's id, else
 * link to an existing account with the same email, else create a fresh account.
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
    throw new Error(`No email provided by ${profile.provider}; cannot create an account`);
  }
  return User.create({
    name: profile.name,
    email: profile.email,
    authProvider: profile.provider,
    [idField]: profile.providerId,
    avatar: profile.avatar
  });
}

// @route   POST /api/auth/register
router.post('/register', [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email').isEmail().withMessage('Please include a valid email'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, email, password } = req.body;

    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ message: 'User already exists' });
    }

    const user = await User.create({ name, email, password });

    res.status(201).json(sessionResponse(user));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/auth/login
router.post('/login', [
  body('email').isEmail().withMessage('Please include a valid email'),
  body('password').exists().withMessage('Password is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    const user = await User.findOne({ email }).select('+password');
    // `code` lets the client route a first-time visitor straight to register
    // with their email carried over, instead of dead-ending on an error.
    if (!user) {
      return res.status(401).json({ message: 'No account with that email', code: 'NO_ACCOUNT' });
    }

    // OAuth-only accounts have no password hash to compare against.
    if (!user.password) {
      return res.status(401).json({
        message: `This email is registered with ${user.authProvider}. Continue with ${user.authProvider} instead.`,
        code: 'OAUTH_ONLY'
      });
    }

    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Incorrect password', code: 'BAD_PASSWORD' });
    }

    res.json(sessionResponse(user));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/auth/google  — verify a Google ID token, issue a session
router.post('/google', async (req, res) => {
  try {
    const { credential } = req.body;
    if (!credential) return res.status(400).json({ message: 'Missing Google credential' });
    const profile = await verifyGoogleToken(credential);
    const user = await findOrCreateOAuthUser(profile);
    res.json(sessionResponse(user));
  } catch (error) {
    console.error('Google auth error:', error.message);
    res.status(401).json({ message: error.message || 'Google sign-in failed' });
  }
});

// @route   POST /api/auth/apple  — verify an Apple id_token, issue a session
router.post('/apple', async (req, res) => {
  try {
    const { id_token, user: appleUser } = req.body;
    if (!id_token) return res.status(400).json({ message: 'Missing Apple token' });
    const profile = await verifyAppleToken(id_token, appleUser || {});
    const user = await findOrCreateOAuthUser(profile);
    res.json(sessionResponse(user));
  } catch (error) {
    console.error('Apple auth error:', error.message);
    res.status(401).json({ message: error.message || 'Apple sign-in failed' });
  }
});

// @route   GET /api/auth/me
router.get('/me', protect, async (req, res) => {
  res.json(req.user);
});

module.exports = router;
