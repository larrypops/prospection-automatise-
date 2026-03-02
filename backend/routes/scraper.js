"use strict";
const express = require("express");
const axios   = require("axios");
const router  = express.Router();

const scraperAxios = axios.create({
    baseURL: process.env.SCRAPER_URL || "http://scraper:5000",
    headers: { "X-API-Key": process.env.SCRAPER_API_KEY || "" },
    timeout: 30000,
});

// ── Google Maps ───────────────────────────────────────────
router.post("/google-maps", async (req, res) => {
    try { res.json((await scraperAxios.post("/api/scrape/google-maps", req.body)).data); }
    catch (e) { res.status(e.response?.status || 500).json({ error: e.message }); }
});

// ── Facebook Pages ────────────────────────────────────────
router.post("/facebook", async (req, res) => {
    try { res.json((await scraperAxios.post("/api/scrape/facebook", req.body)).data); }
    catch (e) { res.status(e.response?.status || 500).json({ error: e.message }); }
});

// ── Meta Ads Library ─────────────────────────────────────
// Body: { query, location, country_code, max_results }
// Exemple: { "query": "restaurant", "location": "Cameroun", "country_code": "CM", "max_results": 50 }
router.post("/meta-ads", async (req, res) => {
    try { res.json((await scraperAxios.post("/api/scrape/meta-ads", req.body)).data); }
    catch (e) { res.status(e.response?.status || 500).json({ error: e.message }); }
});

// ── PagesJaunes Cameroun ─────────────────────────────────
// Body: { query, location, category, max_results }
// category optionnel: "restaurants","hotels","ecoles","boutiques","salons","garages"...
// Exemple: { "location": "douala", "category": "ecoles", "max_results": 500 }
router.post("/pagesjaunes", async (req, res) => {
    try { res.json((await scraperAxios.post("/api/scrape/pagesjaunes", req.body)).data); }
    catch (e) { res.status(e.response?.status || 500).json({ error: e.message }); }
});

// ── Statut d'un job ───────────────────────────────────────
router.get("/status/:jobId", async (req, res) => {
    try { res.json((await scraperAxios.get(`/api/scrape/status/${req.params.jobId}`)).data); }
    catch (e) { res.status(e.response?.status || 500).json({ error: e.message }); }
});

// ── Liste de tous les jobs ────────────────────────────────
router.get("/jobs", async (req, res) => {
    try { res.json((await scraperAxios.get("/api/scrape/jobs")).data); }
    catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;