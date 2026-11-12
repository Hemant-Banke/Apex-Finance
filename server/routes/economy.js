const express = require('express');
const { protect } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');
const economy = require('../services/economyService');

// India's economy as a whole (the Economy page); read from the MacroPoint cache, never from upstream.
const router = express.Router();
router.use(protect);

// @route GET /api/economy/headline — growth, policy rate, 10Y yield, rupee, reserves, current account.
router.get('/headline', asyncHandler(async (req, res) => res.json(await economy.getHeadline())));

// @route GET /api/economy/external — quarterly and monthly BoP, weekly reserves, the rupee, monthly FPI flows.
router.get('/external', asyncHandler(async (req, res) => res.json(await economy.getExternal())));

// @route GET /api/economy/domestic — fund flows, bank deposits/credit and credit by sector, liquidity, money supply.
router.get('/domestic', asyncHandler(async (req, res) => res.json(await economy.getDomestic())));

// @route GET /api/economy/story — the page's findings in plain sentences, each derived from the series above.
router.get('/story', asyncHandler(async (req, res) => res.json(await economy.getStory())));

module.exports = router;
