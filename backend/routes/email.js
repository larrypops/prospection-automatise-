"use strict";
const express = require("express");
const axios   = require("axios");
const router  = express.Router();
const { query } = require("../utils/db");
const logger    = require("../utils/logger");

const BREVO_API_KEY = process.env.BREVO_API_KEY || "";
const BREVO_URL     = "https://api.brevo.com/v3/smtp/email";


// ── Template HTML minimaliste ────────────────────────────────────────────────

const LOGO_URL = process.env.LOGO_URL || "https://sender.lumoradata.com/logo.png";

function buildEmailHtml(leadName) {
    return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;font-size:15px;color:#222;max-width:560px;">

  <div style="text-align:center;padding:24px 0 20px;">
    <img src="${LOGO_URL}" alt="Lumora Data" width="240" style="display:block;margin:0 auto;">
  </div>

  <div style="border-top:1px solid #ddd;padding-top:24px;">

  Bonjour,<br><br>

  Je suis <b>Larry Mbili</b>, fondateur de Lumora Data.<br><br>

  On aide des entreprises comme <b>${leadName}</b> à automatiser leur gestion
  et à intégrer l'IA dans leurs processus — pour que les tâches chronophages
  se fassent seules et que vous pilotiez votre activité depuis votre téléphone
  en temps réel.<br><br>

  Nos clients récupèrent 2 à 3 heures par jour et prennent leurs décisions
  sur de vrais chiffres.<br><br>

  Je serais ravi d'échanger 20 minutes par appel avec vous cette semaine et vous présenter une démo.<br><br>

  Bonne journée,<br>
  <b>Larry Mbili</b><br>
  CEO &amp; Fondateur, Lumora Data<br>
  <a href="mailto:larrymbili@lumoradata.com">larrymbili@lumoradata.com</a><br>
  <a href="https://lumoradata.com">lumoradata.com</a>

  </div>
</body></html>`;
}

function buildEmailText(leadName) {
    return `Bonjour,

Je suis Larry Mbili, fondateur de Lumora Data.

On aide des entreprises comme ${leadName} à automatiser leur gestion et intégrer l'IA dans leurs processus — pour que les tâches chronophages se fassent seules et que vous pilotiez votre activité depuis votre téléphone en temps réel.

Nos clients récupèrent 2 à 3 heures par jour et prennent leurs décisions sur de vrais chiffres.

Je serais ravi d'échanger 20 minutes avec vous cette semaine.

Bonne journée,
Larry Mbili
CEO & Fondateur, Lumora Data
lumoradata.com
larrymbili@lumoradata.com`;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function _getAvailableSender() {
    const r = await query(`
        SELECT id, email, name, daily_sent, daily_limit
        FROM email_senders
        WHERE is_active = true
          AND daily_sent < daily_limit
        ORDER BY daily_sent ASC
        LIMIT 1
    `);
    return r.rows[0] || null;
}

async function _incrSenderCounter(senderId) {
    await query(`
        UPDATE email_senders SET
            daily_sent   = daily_sent + 1,
            total_sent   = total_sent + 1,
            last_sent_at = NOW()
        WHERE id = $1
    `, [senderId]);
}

// ── Routes ───────────────────────────────────────────────────────────────────

router.get("/senders", async (req, res) => {
    try {
        const r = await query(`
            SELECT *, (daily_limit - daily_sent) AS remaining_today
            FROM email_senders ORDER BY is_active DESC, daily_sent ASC
        `);
        res.json(r.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/senders", async (req, res) => {
    try {
        const { email, name = "Larry Mbili", daily_limit = 20 } = req.body;
        if (!email) return res.status(400).json({ error: "email requis" });
        const r = await query(`
            INSERT INTO email_senders (email, name, daily_limit)
            VALUES ($1, $2, $3)
            ON CONFLICT (email) DO UPDATE SET name = $2, daily_limit = $3
            RETURNING *
        `, [email, name, daily_limit]);
        res.status(201).json(r.rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/reset-daily", async (req, res) => {
    try {
        await query(`UPDATE email_senders SET daily_sent = 0, last_reset_at = NOW() WHERE is_active = true`);
        logger.info("Email senders: compteurs remis à zéro");
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════
// POST /api/email/send
// ══════════════════════════════════════════════════════════
router.post("/send", async (req, res) => {
    try {
        const { company_id, to_email, to_name, message_type = "first_contact" } = req.body;
        if (!to_email) return res.status(400).json({ error: "to_email requis" });

        const sender = await _getAvailableSender();
        if (!sender) return res.status(429).json({ error: "Limite journalière atteinte pour tous les senders" });

        const subject  = `${to_name || "Bonjour"} — une question rapide`;
        const htmlBody = buildEmailHtml(to_name || "votre entreprise");
        const textBody = buildEmailText(to_name || "votre entreprise");

        const msgR = await query(`
            INSERT INTO messages (company_id, channel, from_number, to_number, body, type, status, queued_at)
            VALUES ($1, 'email', $2, $3, $4, $5, 'queued', NOW())
            RETURNING id
        `, [company_id, sender.email, to_email, textBody, message_type]);
        const msgId = msgR.rows[0].id;

        try {
            const brevoRes = await axios.post(BREVO_URL, {
                sender:      { name: sender.name, email: sender.email },
                to:          [{ email: to_email, name: to_name || "" }],
                replyTo:     { email: "larrymbili@lumoradata.com", name: "Larry Mbili" },
                subject,
                htmlContent: htmlBody,
                textContent: textBody,
            }, {
                headers: { "api-key": BREVO_API_KEY, "Content-Type": "application/json" },
                timeout: 15000,
            });

            const brevoId = brevoRes.data?.messageId;

            await query(`UPDATE messages SET status='sent', waha_message_id=$1, sent_at=NOW() WHERE id=$2`, [brevoId, msgId]);
            await _incrSenderCounter(sender.id);

            if (company_id) {
                await query(`
                    UPDATE companies SET
                        status            = CASE WHEN status IN ('new','qualified','enriched') THEN 'contacted'::lead_status ELSE status END,
                        last_contacted_at = NOW(),
                        followup_count    = followup_count + 1,
                        next_followup_at  = NOW() + INTERVAL '3 days',
                        updated_at        = NOW()
                    WHERE id = $1
                `, [company_id]);
            }

            logger.info(`Email envoyé → ${to_email} via ${sender.email}`);
            res.json({ success: true, message_id: msgId, brevo_id: brevoId, sender: sender.email });

        } catch (brevoErr) {
            const errMsg = brevoErr.response?.data?.message || brevoErr.message;
            await query(`UPDATE messages SET status='failed', error_message=$1, failed_at=NOW() WHERE id=$2`, [errMsg.slice(0, 500), msgId]);
            logger.error(`Erreur Brevo: ${errMsg}`);
            res.status(500).json({ success: false, error: errMsg, message_id: msgId });
        }

    } catch (e) {
        logger.error("POST /email/send:", e);
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;