"use strict";
const express = require("express");
const { query } = require("../utils/db");
const router = express.Router();

router.get("/dashboard", async (req, res) => {
    try {
        const [overview, daily, campaigns, funnel, cities] = await Promise.all([
            query("SELECT * FROM vw_dashboard_stats"),
            query("SELECT date,messages_sent,messages_delivered,messages_read,messages_replied,leads_scraped FROM daily_stats WHERE date>=CURRENT_DATE-INTERVAL '30 days' ORDER BY date"),
            query("SELECT * FROM vw_campaign_performance ORDER BY sent DESC LIMIT 10"),
            query("SELECT status, COUNT(*) AS count FROM companies GROUP BY status ORDER BY count DESC"),
            query("SELECT city, COUNT(*) AS count FROM companies WHERE city IS NOT NULL GROUP BY city ORDER BY count DESC LIMIT 10"),
        ]);
        res.json({ overview: overview.rows[0], daily_chart: daily.rows,
                   campaigns: campaigns.rows, funnel: funnel.rows, top_cities: cities.rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/whatsapp", async (req, res) => {
    try {
        const r = await query("SELECT *, (daily_limit-daily_sent) AS remaining_today FROM whatsapp_numbers ORDER BY is_active DESC");
        res.json(r.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/scraping", async (req, res) => {
    try {
        const [recent, bySource] = await Promise.all([
            query("SELECT * FROM scrape_jobs ORDER BY created_at DESC LIMIT 20"),
            query("SELECT source, COUNT(*) AS jobs, SUM(leads_found) AS total_leads, SUM(leads_new) AS new_leads FROM scrape_jobs WHERE status='done' GROUP BY source"),
        ]);
        res.json({ recent_jobs: recent.rows, by_source: bySource.rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
