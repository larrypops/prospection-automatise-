"use strict";
const express = require("express");
const { query } = require("../utils/db");
const router = express.Router();

router.get("/", async (req, res) => {
    try {
        const r = await query("SELECT * FROM system_config ORDER BY key");
        res.json(r.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put("/:key", async (req, res) => {
    try {
        const r = await query(`
            INSERT INTO system_config (key, value, description, updated_at)
            VALUES ($1, $2::jsonb, $3, NOW())
            ON CONFLICT (key) DO UPDATE SET value=$2::jsonb, updated_at=NOW() RETURNING *
        `, [req.params.key, JSON.stringify(req.body.value), req.body.description]);
        res.json(r.rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
