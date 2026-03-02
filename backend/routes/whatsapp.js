"use strict";
const express   = require("express");
const router    = express.Router();
const axios     = require("axios");
const { query } = require("../utils/db");
const logger    = require("../utils/logger");

const WAHA_URL     = process.env.WAHA_URL     || "http://waha:3000";
const WAHA_API_KEY = process.env.WAHA_API_KEY || "";

const delay = (minS, maxS) =>
    new Promise(r => setTimeout(r, (Math.random() * (maxS - minS) + minS) * 1000));

async function waha(method, path, data) {
    return axios({
        method, url: `${WAHA_URL}/api/${path}`, data,
        headers: { "X-Api-Key": WAHA_API_KEY }, timeout: 30000,
    });
}

// ── GET /api/whatsapp/numbers ──────────────────────────────
router.get("/numbers", async (req, res) => {
    try {
        const r = await query(`
            SELECT *, (daily_limit - daily_sent) AS remaining_today
            FROM whatsapp_numbers ORDER BY is_active DESC, warmup_day ASC
        `);
        res.json(r.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/whatsapp/numbers ─────────────────────────────
router.post("/numbers", async (req, res) => {
    try {
        const { number, session_name, daily_limit = 20 } = req.body;
        if (!number || !session_name)
            return res.status(400).json({ error: "number et session_name requis" });
        const r = await query(`
            INSERT INTO whatsapp_numbers (number, session_name, daily_limit, warmup_limit)
            VALUES ($1, $2, $3, $3) RETURNING *
        `, [number, session_name, daily_limit]);
        res.status(201).json(r.rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/whatsapp/session/:name/qr ────────────────────
router.get("/session/:name/qr", async (req, res) => {
    try {
        const r = await waha("GET", `${req.params.name}/auth/qr`);
        res.json(r.data);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/whatsapp/session/:name/status ─────────────────
router.get("/session/:name/status", async (req, res) => {
    try {
        const r = await waha("GET", `sessions/${req.params.name}`);
        res.json(r.data);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/whatsapp/session/start ──────────────────────
router.post("/session/start", async (req, res) => {
    try {
        const { session_name } = req.body;
        const r = await waha("POST", "sessions", {
            name: session_name,
            config: {
                webhooks: [{
                    url:    `http://prospection-backend:4000/api/whatsapp/webhook`,
                    events: ["message", "message.ack", "session.status"],
                }],
            },
        });
        res.json({ success: true, session: r.data });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════
// POST /api/whatsapp/send
// Envoie un message WhatsApp et met à jour le statut
// du lead en 'contacted' dans la table companies
// ══════════════════════════════════════════════════════════
router.post("/send", async (req, res) => {
    try {
        const {
            company_id,
            to_number,
            message,
            session_name,
            campaign_id,
            template_id,
            message_type = "first_contact",
            skip_delay   = false,
        } = req.body;

        if (!to_number || !message)
            return res.status(400).json({ error: "to_number et message requis" });

        // 1. Vérifier la limite journalière
        const limitCheck = await _checkLimit(session_name);
        if (!limitCheck.ok) {
            return res.status(429).json({
                error:       "Limite journalière atteinte",
                daily_limit: limitCheck.limit,
                daily_sent:  limitCheck.sent,
            });
        }

        // 2. Délai aléatoire anti-ban
        if (!skip_delay) {
            const mn = parseInt(process.env.WA_MIN_DELAY || "30");
            const mx = parseInt(process.env.WA_MAX_DELAY || "120");
            logger.info(`Anti-ban: attente ${mn}-${mx}s avant envoi à ${to_number}`);
            await delay(mn, mx);
        }

        const chatId = to_number.replace("+", "") + "@c.us";

        // 3. Créer l'entrée message en DB (status: queued)
        const msgR = await query(`
            INSERT INTO messages
                (company_id, campaign_id, template_id, channel,
                 from_number, to_number, body, type, status, queued_at)
            VALUES ($1, $2, $3, 'whatsapp', $4, $5, $6, $7, 'queued', NOW())
            RETURNING id
        `, [company_id, campaign_id, template_id, session_name, to_number, message, message_type]);
        const msgId = msgR.rows[0].id;

        // 4. Envoyer via WAHA
        try {
            const waR = await waha("POST", "sendText", {
                session: session_name || "default",
                chatId,
                text: message,
            });
            const wahaId = waR.data?.id;

            // 5. Mise à jour message → sent
            await query(
                `UPDATE messages SET status = 'sent', waha_message_id = $1, sent_at = NOW() WHERE id = $2`,
                [wahaId, msgId]
            );

            // 6. Incrémenter compteur session
            await _incrCounter(session_name);

            // 7. ✅ Mettre à jour le statut du lead: new/qualified → contacted
            if (company_id) {
                await _updateLeadStatus(company_id, to_number, session_name, message_type);
            }

            logger.info(`✅ Message envoyé → ${to_number} via ${session_name || "default"} | company_id=${company_id}`);
            res.json({
                success:         true,
                message_id:      msgId,
                waha_message_id: wahaId,
                status:          "sent",
                lead_status:     "contacted",
            });

        } catch (waErr) {
            const errMsg = waErr.response?.data?.message || waErr.message;
            await query(
                `UPDATE messages SET status = 'failed', error_message = $1, failed_at = NOW() WHERE id = $2`,
                [errMsg.slice(0, 500), msgId]
            );
            logger.error(`❌ Erreur WAHA: ${errMsg}`);
            res.status(500).json({ success: false, error: errMsg, message_id: msgId });
        }

    } catch (e) {
        logger.error("POST /whatsapp/send:", e);
        res.status(500).json({ error: e.message });
    }
});

// ══════════════════════════════════════════════════════════
// POST /api/whatsapp/webhook
// Reçoit les événements WAHA (ack, réponse entrante)
// et met à jour messages + companies
// ══════════════════════════════════════════════════════════
router.post("/webhook", async (req, res) => {
    const { event, payload } = req.body;
    
    // Log immédiat de l'événement reçu pour debugging
    logger.info(`📥 Webhook WAHA reçu: event=${event}, payload=${JSON.stringify(payload || {}).substring(0, 200)}`);
    
    // Répondre immédiatement 200 OK pour éviter les retries WAHA
    res.json({ ok: true, received: true, event });
    
    // Traitement asynchrone après réponse
    try {
        // Vérification du payload
        if (!event || !payload) {
            logger.warn("⚠️ Webhook WAHA: payload invalide", req.body);
            return;
        }

        // Mise à jour statut message selon ACK WhatsApp
        if (event === "message.ack" && payload?.id) {
            const statusMap = { 1: "sent", 2: "delivered", 3: "read" };
            const ack = payload.ack;
            const s = statusMap[ack];
            
            logger.info(`📨 ACK reçu: message_id=${payload.id}, ack=${ack}, status=${s || 'unknown'}`);
            
            if (s) {
                const result = await query(`
                    UPDATE messages SET
                        status       = $1,
                        delivered_at = CASE WHEN $1 = 'delivered' THEN NOW() ELSE delivered_at END,
                        read_at      = CASE WHEN $1 = 'read'      THEN NOW() ELSE read_at      END
                    WHERE waha_message_id = $2
                    RETURNING id, status
                `, [s, payload.id]);
                
                if (result.rowCount > 0) {
                    logger.info(`✅ Message ${payload.id} mis à jour: ${s}`);
                } else {
                    logger.warn(`⚠️ Message ${payload.id} non trouvé en DB`);
                }
            } else {
                logger.warn(`⚠️ ACK inconnu: ${ack} pour message ${payload.id}`);
            }
        }

        // Message entrant = le prospect répond → statut 'replied'
        if (event === "message" && payload?.fromMe === false) {
            const from = "+" + (payload.from || "").replace("@c.us", "");
            const body = payload.body || "(média)";
            
            logger.info(`📩 Message entrant de ${from}: "${body.substring(0, 100)}"`);

            // Mettre à jour le lead: contacted → replied
            const leadResult = await query(`
                UPDATE companies SET
                    status          = 'replied',
                    last_replied_at = NOW(),
                    updated_at      = NOW()
                WHERE phone_whatsapp = $1
                  AND status         = 'contacted'
                RETURNING id, name
            `, [from]);

            if (leadResult.rowCount > 0) {
                logger.info(`✅ Lead ${leadResult.rows[0].name} (${leadResult.rows[0].id}) mis à jour: contacted → replied`);
            } else {
                logger.warn(`⚠️ Aucun lead trouvé avec phone_whatsapp=${from} et status=contacted`);
            }

            // Mettre à jour le dernier message envoyé à ce numéro
            const msgResult = await query(`
                UPDATE messages SET status = 'replied', replied_at = NOW()
                WHERE id = (
                    SELECT id FROM messages
                    WHERE to_number = $1
                      AND status IN ('sent', 'delivered', 'read')
                    ORDER BY sent_at DESC
                    LIMIT 1
                )
                RETURNING id
            `, [from]);

            if (msgResult.rowCount > 0) {
                logger.info(`✅ Message ${msgResult.rows[0].id} mis à jour: replied`);
            }
        }
        
        // Événement de changement de statut de session
        if (event === "session.status") {
            logger.info(`🔄 Session status: ${payload.session} → ${payload.status}`);
        }

    } catch (e) { 
        logger.error("❌ Webhook processing error:", e);
    }
});

// ── Helpers ───────────────────────────────────────────────

async function _checkLimit(sessionName) {
    if (!sessionName) return { ok: true, limit: 20, sent: 0 };
    const r = await query(
        "SELECT daily_sent, daily_limit FROM whatsapp_numbers WHERE session_name = $1",
        [sessionName]
    );
    if (!r.rows[0]) return { ok: true, limit: 20, sent: 0 };
    return {
        ok:    r.rows[0].daily_sent < r.rows[0].daily_limit,
        limit: r.rows[0].daily_limit,
        sent:  r.rows[0].daily_sent,
    };
}

async function _incrCounter(sessionName) {
    if (!sessionName) return;
    await query(`
        UPDATE whatsapp_numbers SET
            daily_sent  = daily_sent + 1,
            total_sent  = total_sent + 1,
            last_sent_at = NOW()
        WHERE session_name = $1
    `, [sessionName]);
}

/**
 * Met à jour le lead après envoi d'un message WhatsApp :
 * - Status: new | qualified → contacted
 * - last_contacted_at = NOW()
 * - followup_count ++
 * - assigned_wa_number = numéro utilisé
 * - next_followup_at = calculé selon le type de message
 */
async function _updateLeadStatus(companyId, phone, sessionName, msgType) {
    const followupDelays = {
        first_contact: "3 days",
        followup_1:    "5 days",
        followup_2:    "7 days",
        followup_3:    null,
        reactivation:  "14 days",
    };
    const nextDelay = followupDelays[msgType] ?? null;

    await query(`
        UPDATE companies SET
            status             = CASE
                                    WHEN status IN ('new', 'qualified', 'enriched')
                                    THEN 'contacted'::lead_status
                                    ELSE status
                                 END,
            last_contacted_at  = NOW(),
            followup_count     = followup_count + 1,
            assigned_wa_number = $2,
            next_followup_at   = CASE
                                    WHEN $3::text IS NOT NULL
                                    THEN NOW() + $3::interval
                                    ELSE NULL
                                 END,
            updated_at         = NOW()
        WHERE id = $1
    `, [companyId, sessionName, nextDelay]);

    logger.info(`📋 Lead ${companyId} → statut: contacted | next_followup: ${nextDelay || "aucun"}`);
}

module.exports = router;