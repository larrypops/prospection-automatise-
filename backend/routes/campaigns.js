"use strict";
const express = require("express");
const { query } = require("../utils/db");
const router = express.Router();

router.get("/", async (req, res) => {
    try {
        const r = await query(`
            SELECT c.*, (SELECT COUNT(*) FROM companies co WHERE co.campaign_id=c.id) AS leads_count,
            (SELECT COUNT(*) FROM messages m WHERE m.campaign_id=c.id AND m.status='sent') AS messages_sent
            FROM campaigns c ORDER BY created_at DESC
        `);
        res.json(r.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post("/", async (req, res) => {
    try {
        const { name, description, target_category, target_city, target_region,
                daily_limit=20, min_delay_sec=30, max_delay_sec=120 } = req.body;
        if (!name) return res.status(400).json({ error: "name requis" });
        const r = await query(`INSERT INTO campaigns (name,description,target_category,target_city,target_region,daily_limit,min_delay_sec,max_delay_sec) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [name,description,target_category,target_city,target_region,daily_limit,min_delay_sec,max_delay_sec]);
        res.status(201).json(r.rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
});
router.put("/:id", async (req, res) => {
    try {
        const allowed = ["name","description","daily_limit","min_delay_sec","max_delay_sec","is_active","template_id"];
        const fields = Object.keys(req.body).filter(k=>allowed.includes(k));
        if (!fields.length) return res.status(400).json({ error: "Aucun champ valide" });
        const set = fields.map((f,i)=>f+"=$"+(i+2)).join(",");
        const r = await query(`UPDATE campaigns SET ${set} WHERE id=$1 RETURNING *`,[req.params.id,...fields.map(f=>req.body[f])]);
        res.json(r.rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
});
module.exports = router;
