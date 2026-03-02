"use strict";
const express = require("express");
const { query } = require("../utils/db");
const router = express.Router();

router.get("/", async (req, res) => {
    try {
        const { channel, type } = req.query;
        const cond=["is_active=true"], p=[]; let i=1;
        if (channel) { cond.push(`channel=$${i++}`); p.push(channel); }
        if (type)    { cond.push(`type=$${i++}`);    p.push(type); }
        const r = await query(`SELECT * FROM message_templates WHERE ${cond.join(" AND ")} ORDER BY type, name`, p);
        res.json(r.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/:id", async (req, res) => {
    try {
        const r = await query("SELECT * FROM message_templates WHERE id=$1", [req.params.id]);
        if (!r.rows[0]) return res.status(404).json({ error: "Non trouvé" });
        res.json(r.rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/", async (req, res) => {
    try {
        const { name, channel="whatsapp", type="first_contact", subject, body, variables=[] } = req.body;
        if (!name||!body) return res.status(400).json({ error: "name et body requis" });
        const r = await query(`INSERT INTO message_templates (name,channel,type,subject,body,variables) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
                              [name,channel,type,subject,body,variables]);
        res.status(201).json(r.rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put("/:id", async (req, res) => {
    try {
        const { name, body, is_active } = req.body;
        const r = await query(`UPDATE message_templates SET name=COALESCE($2,name), body=COALESCE($3,body), is_active=COALESCE($4,is_active) WHERE id=$1 RETURNING *`,
                              [req.params.id, name, body, is_active]);
        res.json(r.rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Preview avec remplacement variables {{var}}
router.post("/:id/preview", async (req, res) => {
    try {
        const r = await query("SELECT body FROM message_templates WHERE id=$1", [req.params.id]);
        if (!r.rows[0]) return res.status(404).json({ error: "Non trouvé" });
        let body = r.rows[0].body;
        for (const [k,v] of Object.entries(req.body||{})) {
            body = body.replaceAll(`{{${k}}}`, v);
        }
        res.json({ preview: body });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
