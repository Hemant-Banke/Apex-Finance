const express = require('express');
const { protect } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');
const economy = require('../services/economyService');
const world = require('../services/worldEconomyService');

// India's economy as a whole (the Economy page); read from the MacroPoint cache, never from upstream.
const router = express.Router();
router.use(protect);

// @route GET /api/economy/headline — growth, policy rate, 10Y yield, rupee, reserves, current account.
router.get('/headline', asyncHandler(async (req, res) => res.json(await economy.getHeadline())));

// @route GET /api/economy/external — quarterly and monthly BoP, weekly reserves, the rupee, monthly FPI flows.
router.get('/external', asyncHandler(async (req, res) => res.json(await economy.getExternal())));

// @route GET /api/economy/domestic — fund flows, bank deposits/credit and credit by sector, liquidity, money supply.
router.get('/domestic', asyncHandler(async (req, res) => res.json(await economy.getDomestic())));

// @route GET /api/economy/production — output by industry and GDP by spending each quarter, saving by sector each year.
router.get('/production', asyncHandler(async (req, res) => res.json(await economy.getProduction())));

// @route GET /api/economy/world — IMF and World Bank figures for India's peers, and who adds the world's growth.
router.get('/world', asyncHandler(async (req, res) => res.json(await world.getWorld())));

// @route GET /api/economy/markets — each country's stock market in US dollars, US yields and the dollar.
router.get('/markets', asyncHandler(async (req, res) => res.json(await world.getMarkets())));

// @route GET /api/economy/story — the page's findings in plain sentences, each derived from the series above.
router.get('/story', asyncHandler(async (req, res) => res.json(await economy.getStory())));

module.exports = router;
