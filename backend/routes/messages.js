"use strict";
const express = require("express");
const { query } = require("../utils/db");
const router = express.Router();

router.get("/", async (req, res) => {
    try {
        const { company_id, status, campaign_id, limit=100, page=1 } = req.query;
        const cond=[], p=[]; let i=1;
        if (company_id) { cond.push(`m.company_id=$${i++}`); p.push(company_id); }
        if (status)     { cond.push(`m.status=$${i++}`);     p.push(status); }
        if (campaign_id){ cond.push(`m.campaign_id=$${i++}`);p.push(campaign_id); }
        const where = cond.length ? `WHERE ${cond.join(" AND ")}` : "";
        const r = await query(`
            SELECT m.*, c.name AS company_name, c.city
            FROM messages m LEFT JOIN companies c ON c.id=m.company_id
            ${where} ORDER BY m.created_at DESC LIMIT $${i} OFFSET $${i+1}
        `, [...p, +limit, (+page-1)*+limit]);
        res.json({ data: r.rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
