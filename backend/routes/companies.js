"use strict";
const express = require("express");
const { query } = require("../utils/db");
const { formatWhatsAppNumber } = require("../utils/phoneFormatter");
const { verifyAndUpdateCompany, verifyAllPendingCompanies } = require("../services/whatsappChecker");
const router = express.Router();

// ═══════════════════════════════════════════════════════
// GET /api/companies/new
// Leads avec status='new' prêts à être contactés
// Query params: city, category, has_phone, has_whatsapp, limit, page
// ═══════════════════════════════════════════════════════
router.get("/new", async (req, res) => {
    try {
        const { city, category, source, has_phone, has_whatsapp, limit = 50, page = 1 } = req.query;
        const conditions = ["status = 'new'"];
        const params = [];
        let idx = 1;

        if (city)     { conditions.push(`city ILIKE $${idx++}`);     params.push(`%${city}%`); }
        if (category) { conditions.push(`category ILIKE $${idx++}`); params.push(`%${category}%`); }
        if (source)   { conditions.push(`source = $${idx++}`);       params.push(source); }
        if (has_phone === "true") conditions.push("phone_whatsapp IS NOT NULL");
        if (has_whatsapp === "true") conditions.push("has_whatsapp = true");
        if (has_whatsapp === "false") conditions.push("has_whatsapp = false");

        const where = `WHERE ${conditions.join(" AND ")}`;

        const total = +(await query(`SELECT COUNT(*) FROM companies ${where}`, params)).rows[0].count;
        const data  = await query(`
            SELECT
                id, name, category, phone, phone_whatsapp, email,
                website, address, city, region, source, source_url,
                rating, reviews_count, score, tags, created_at
            FROM companies
            ${where}
            ORDER BY score DESC, rating DESC NULLS LAST, created_at DESC
            LIMIT $${idx} OFFSET $${idx + 1}
        `, [...params, +limit, (+page - 1) * +limit]);

        res.json({
            data: data.rows,
            pagination: {
                total,
                page:  +page,
                limit: +limit,
                pages: Math.ceil(total / +limit),
            },
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════
// GET /api/companies
// Liste complète avec tous les filtres
// ═══════════════════════════════════════════════════════
router.get("/", async (req, res) => {
    try {
        const {
            page = 1, limit = 50,
            status, city, category, source, search,
            has_phone, has_whatsapp, min_score, campaign_id,
            sort = "created_at", order = "DESC",
        } = req.query;

        const conditions = [], params = [];
        let idx = 1;

        if (status)      { conditions.push(`status = $${idx++}`);                params.push(status); }
        if (city)        { conditions.push(`city ILIKE $${idx++}`);              params.push(`%${city}%`); }
        if (category)    { conditions.push(`category ILIKE $${idx++}`);          params.push(`%${category}%`); }
        if (source)      { conditions.push(`source = $${idx++}`);                params.push(source); }
        if (search)      { conditions.push(`(name ILIKE $${idx} OR phone ILIKE $${idx} OR phone_whatsapp ILIKE $${idx})`); params.push(`%${search}%`); idx++; }
        if (has_phone === "true") conditions.push("phone_whatsapp IS NOT NULL");
        if (has_whatsapp === "true") conditions.push("has_whatsapp = true");
        if (has_whatsapp === "false") conditions.push("has_whatsapp = false");
        if (min_score)   { conditions.push(`score >= $${idx++}`);                params.push(+min_score); }
        if (campaign_id) { conditions.push(`campaign_id = $${idx++}`);           params.push(campaign_id); }

        const where      = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
        const safe_sort  = ["name","city","score","created_at","last_contacted_at","status","rating"].includes(sort) ? sort : "created_at";
        const safe_order = ["ASC","DESC"].includes(order.toUpperCase()) ? order.toUpperCase() : "DESC";

        const total = +(await query(`SELECT COUNT(*) FROM companies ${where}`, params)).rows[0].count;
        const data  = await query(`
            SELECT c.*,
                (SELECT COUNT(*) FROM messages m WHERE m.company_id = c.id) AS message_count
            FROM companies c
            ${where}
            ORDER BY c.${safe_sort} ${safe_order}
            LIMIT $${idx} OFFSET $${idx + 1}
        `, [...params, +limit, (+page - 1) * +limit]);

        res.json({
            data: data.rows,
            pagination: { total, page: +page, limit: +limit, pages: Math.ceil(total / +limit) },
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════
// GET /api/companies/:id
// ═══════════════════════════════════════════════════════
router.get("/:id", async (req, res) => {
    try {
        const [c, m] = await Promise.all([
            query("SELECT * FROM companies WHERE id = $1", [req.params.id]),
            query("SELECT * FROM messages WHERE company_id = $1 ORDER BY created_at DESC LIMIT 20", [req.params.id]),
        ]);
        if (!c.rows[0]) return res.status(404).json({ error: "Non trouvé" });
        res.json({ ...c.rows[0], messages: m.rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════
// POST /api/companies
// Création manuelle avec dédup intégré
// ═══════════════════════════════════════════════════════
router.post("/", async (req, res) => {
    try {
        const {
            name, category, phone, phone_whatsapp, email, website,
            address, city, region, country = "Cameroun",
            source = "manual", notes, tags = [],
            google_place_id, facebook_page_id,
        } = req.body;

        if (!name) return res.status(400).json({ error: "name requis" });

        // Formater automatiquement le numéro de téléphone
        let formattedPhone = phone;
        let formattedWhatsApp = phone_whatsapp;
        
        // Si phone fourni mais pas phone_whatsapp, formater phone
        if (phone && !phone_whatsapp) {
            formattedWhatsApp = formatWhatsAppNumber(phone);
        }
        // Si phone_whatsapp fourni, s'assurer qu'il est bien formaté
        else if (phone_whatsapp) {
            formattedWhatsApp = formatWhatsAppNumber(phone_whatsapp);
        }

        // Dédup: vérifier si le lead existe déjà (par google_place_id, facebook_page_id, ou phone+name)
        let existing = null;
        if (google_place_id) {
            const r = await query("SELECT id, name FROM companies WHERE google_place_id = $1", [google_place_id]);
            existing = r.rows[0];
        } else if (facebook_page_id) {
            const r = await query("SELECT id, name FROM companies WHERE facebook_page_id = $1", [facebook_page_id]);
            existing = r.rows[0];
        } else if (formattedWhatsApp) {
            const r = await query(
                "SELECT id, name FROM companies WHERE phone_whatsapp = $1 AND LOWER(name) = LOWER($2)",
                [formattedWhatsApp, name]
            );
            existing = r.rows[0];
        }

        if (existing) {
            return res.status(409).json({
                error:    "Doublon détecté",
                existing: existing,
                message:  `Cette entreprise existe déjà (id: ${existing.id})`,
            });
        }

        const r = await query(`
            INSERT INTO companies
                (name, category, phone, phone_whatsapp, email, website,
                 address, city, region, country, source, notes, tags,
                 google_place_id, facebook_page_id)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
            RETURNING *
        `, [name, category, formattedPhone, formattedWhatsApp, email, website,
            address, city, region, country, source, notes, tags,
            google_place_id || null, facebook_page_id || null]);

        res.status(201).json(r.rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════
// PUT /api/companies/bulk/status
// Mise à jour en masse du statut
// ═══════════════════════════════════════════════════════
router.put("/bulk/status", async (req, res) => {
    try {
        const { ids, status } = req.body;
        if (!ids?.length || !status) return res.status(400).json({ error: "ids et status requis" });
        const valid = ["new","enriched","qualified","contacted","replied",
                       "interested","meeting_scheduled","converted",
                       "not_interested","unsubscribed","invalid","archived"];
        if (!valid.includes(status)) return res.status(400).json({ error: `Status invalide. Valeurs: ${valid.join(", ")}` });
        const ph = ids.map((_, i) => `$${i + 2}`).join(",");
        const r  = await query(
            `UPDATE companies SET status = $1::lead_status, updated_at = NOW() WHERE id IN (${ph}) RETURNING id`,
            [status, ...ids]
        );
        res.json({ success: true, updated: r.rowCount });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════
// POST /api/companies/bulk/check-whatsapp
// Vérification WhatsApp en masse pour les entreprises en attente
// ═══════════════════════════════════════════════════════
router.post("/bulk/check-whatsapp", async (req, res) => {
    try {
        // Lancer la vérification en arrière-plan
        verifyAllPendingCompanies();
        
        res.json({
            success: true,
            message: "Vérification WhatsApp en masse démarrée en arrière-plan"
        });
    } catch (e) { 
        res.status(500).json({ error: e.message }); 
    }
});
// ═══════════════════════════════════════════════════════
// POST /api/companies/:id/check-whatsapp
// Vérification manuelle WhatsApp pour une entreprise
// ═══════════════════════════════════════════════════════
router.post("/:id/check-whatsapp", async (req, res) => {
    try {
        const { id } = req.params;
        
        // Récupérer l'entreprise
        const company = await query(
            "SELECT id, name, phone, phone_whatsapp, has_whatsapp FROM companies WHERE id = $1",
            [id]
        );
        
        if (!company.rows[0]) {
            return res.status(404).json({ error: "Entreprise non trouvée" });
        }
        
        const phone = company.rows[0].phone_whatsapp || company.rows[0].phone;
        if (!phone) {
            return res.status(400).json({ error: "Aucun numéro de téléphone disponible" });
        }
        
        // Vérifier WhatsApp
        const result = await verifyAndUpdateCompany(id, phone);
        
        res.json({
            success: true,
            company: result,
            message: result.has_whatsapp === true 
                ? "WhatsApp trouvé et enregistré" 
                : result.has_whatsapp === false 
                    ? "Pas de WhatsApp pour ce numéro" 
                    : "Vérification en cours ou échouée"
        });
    } catch (e) { 
        res.status(500).json({ error: e.message }); 
    }
});
// PUT /api/companies/:id/status
// Mise à jour du statut d'un seul lead
// Utilisé par la route WhatsApp après envoi
// ═══════════════════════════════════════════════════════
router.put("/:id/status", async (req, res) => {
    try {
        const { status, notes } = req.body;
        const valid = ["new","enriched","qualified","contacted","replied",
                       "interested","meeting_scheduled","converted",
                       "not_interested","unsubscribed","invalid","archived"];
        if (!valid.includes(status)) return res.status(400).json({ error: `Status invalide. Valeurs: ${valid.join(", ")}` });

        const r = await query(`
            UPDATE companies SET
                status     = $2::lead_status,
                updated_at = NOW(),
                notes      = CASE WHEN $3::text IS NOT NULL THEN $3 ELSE notes END
            WHERE id = $1
            RETURNING id, name, status, updated_at
        `, [req.params.id, status, notes || null]);

        if (!r.rows[0]) return res.status(404).json({ error: "Non trouvé" });
        res.json({ success: true, company: r.rows[0] });
    } catch (e) { res.status(500).json({ error: e.message }); }
});





// ═══════════════════════════════════════════════════════
// PUT /api/companies/:id
// Mise à jour générale d'un lead
// ═══════════════════════════════════════════════════════
router.put("/:id", async (req, res) => {
    try {
        const allowed = [
            "name","category","phone","phone_whatsapp","email","website",
            "address","city","region","status","score","priority","notes",
            "tags","campaign_id","next_followup_at","assigned_wa_number","has_whatsapp",
        ];
        const fields = Object.keys(req.body).filter(k => allowed.includes(k));
        if (!fields.length) return res.status(400).json({ error: "Aucun champ valide" });

        const set = fields.map((f, i) => `${f} = $${i + 2}`).join(", ");
        const r   = await query(
            `UPDATE companies SET ${set}, updated_at = NOW() WHERE id = $1 RETURNING *`,
            [req.params.id, ...fields.map(f => req.body[f])]
        );
        if (!r.rows[0]) return res.status(404).json({ error: "Non trouvé" });
        res.json(r.rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════
// DELETE /api/companies/:id
// ═══════════════════════════════════════════════════════
router.delete("/:id", async (req, res) => {
    try {
        await query("DELETE FROM companies WHERE id = $1", [req.params.id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;