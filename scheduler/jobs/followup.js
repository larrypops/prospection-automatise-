"use strict";
const { Pool } = require("pg");
const axios = require("axios");
const logger = require("../logger");

const BACKEND_URL = process.env.BACKEND_URL || "http://prospection-backend:4000";
const DATABASE_URL = process.env.DATABASE_URL;

const WA_MIN_DELAY = parseInt(process.env.WA_MIN_DELAY) || 30;
const WA_MAX_DELAY = parseInt(process.env.WA_MAX_DELAY) || 120;

// Créer le pool PostgreSQL
const pool = new Pool({
    connectionString: DATABASE_URL,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});

/**
 * Génère un délai aléatoire entre min et max secondes
 */
function getRandomDelay() {
    return Math.floor(Math.random() * (WA_MAX_DELAY - WA_MIN_DELAY + 1) + WA_MIN_DELAY) * 1000;
}

/**
 * Attend un certain nombre de millisecondes
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Construit le message de relance selon le followup_count
 */
function buildFollowupMessage(leadName, followupCount) {
    switch (followupCount) {
        case 1:
            return `Bonjour, je reviens vers vous concernant ${leadName}. Avez-vous eu l'occasion de réfléchir à la mise en place d'un système automatisé de suivi financier pour votre activité ?

Je serais ravi d'échanger 10 minutes avec vous pour vous montrer concrètement ce que ça peut changer. 🙏`;

        case 2:
            return `Bonsoir, je comprends que vous êtes occupé(e). Je voulais juste partager que plusieurs entreprises comme ${leadName} ont déjà optimisé leur gestion financière avec nos solutions.

Si ce n'est pas une priorité en ce moment, pas de souci. Mais si vous changez d'avis, je reste disponible. 😊`;

        case 3:
            return `Bonjour, dernier message de ma part concernant l'automatisation financière pour ${leadName}.

Si jamais vous souhaitez découvrir comment piloter vos chiffres en temps réel, vous pouvez me contacter à tout moment. Bonne continuation ! 🚀`;

        default:
            return `Bonjour, je reviens vers vous concernant ${leadName}. Avez-vous eu l'occasion de réfléchir à notre proposition ?`;
    }
}

/**
 * Récupère les leads à relancer
 */
async function getLeadsToFollowUp() {
    const client = await pool.connect();
    try {
        const query = `
            SELECT id, name, phone_whatsapp, city, followup_count, assigned_wa_number
            FROM companies
            WHERE status = 'contacted'
              AND phone_whatsapp IS NOT NULL
              AND next_followup_at <= NOW()
              AND followup_count < 3
            ORDER BY next_followup_at ASC
            LIMIT 10
        `;
        const result = await client.query(query);
        return result.rows;
    } finally {
        client.release();
    }
}

/**
 * Met à jour le lead après envoi
 */
async function updateLeadAfterFollowUp(leadId, currentFollowupCount) {
    const client = await pool.connect();
    try {
        const newFollowupCount = currentFollowupCount + 1;
        const query = `
            UPDATE companies SET
                followup_count = $2,
                last_contacted_at = NOW(),
                next_followup_at = CASE
                    WHEN $2 >= 3 THEN NULL
                    WHEN $2 = 2 THEN NOW() + INTERVAL '4 days'
                    ELSE NOW() + INTERVAL '7 days'
                END,
                status = CASE WHEN $2 >= 3 THEN 'not_interested' ELSE 'contacted' END,
                updated_at = NOW()
            WHERE id = $1
            RETURNING id, followup_count, status
        `;
        const result = await client.query(query, [leadId, newFollowupCount]);
        return result.rows[0];
    } finally {
        client.release();
    }
}

/**
 * Job de follow-up
 */
async function followupJob() {
    logger.info("═══════════════════════════════════════════════════════════");
    logger.info("  🔄 DÉBUT FOLLOW-UP");
    logger.info("═══════════════════════════════════════════════════════════");

    try {
        // 1. Récupérer les leads à relancer
        logger.info("🔍 Récupération des leads à relancer...");
        const leads = await getLeadsToFollowUp();

        if (!leads || leads.length === 0) {
            logger.info("ℹ️  Aucun lead à relancer");
            return;
        }

        logger.info(`📋 ${leads.length} leads à relancer`);

        let successCount = 0;
        let errorCount = 0;

        // 2. Envoyer à chaque lead
        for (const lead of leads) {
            const message = buildFollowupMessage(lead.name, lead.followup_count);

            try {
                logger.info(`📤 Relance ${lead.followup_count + 1}/3 à ${lead.name} (${lead.phone_whatsapp})...`);

                // Envoyer via l'API backend
                const sendResponse = await axios.post(
                    `${BACKEND_URL}/api/whatsapp/send`,
                    {
                        company_id: lead.id,
                        to_number: lead.phone_whatsapp,
                        message: message,
                        skip_delay: true
                    },
                    { timeout: 60000 }
                );

                if (sendResponse.data.success) {
                    // Mettre à jour le lead en DB
                    const updated = await updateLeadAfterFollowUp(lead.id, lead.followup_count);
                    successCount++;
                    logger.info(`✅ Relance ${updated.followup_count}/3 envoyée à ${lead.name} - Statut: ${updated.status}`);
                } else {
                    errorCount++;
                    logger.error(`❌ Échec relance à ${lead.name}: ${sendResponse.data.error}`);
                }

            } catch (error) {
                // Gestion erreur 429 (limite atteinte)
                if (error.response && error.response.status === 429) {
                    logger.warn("🚫 Limite journalière atteinte (429), arrêt des relances");
                    break;
                }

                errorCount++;
                logger.error(`❌ Erreur relance à ${lead.name}:`, error.message);
                
                // Continuer avec le lead suivant
                continue;
            }

            // Délai aléatoire avant le prochain envoi (si ce n'est pas le dernier)
            if (lead !== leads[leads.length - 1]) {
                const delay = getRandomDelay();
                logger.info(`⏳ Attente ${(delay / 1000).toFixed(0)}s avant la prochaine relance...`);
                await sleep(delay);
            }
        }

        logger.info("═══════════════════════════════════════════════════════════");
        logger.info(`  📊 RÉSULTATS: ${successCount} succès, ${errorCount} échecs`);
        logger.info("═══════════════════════════════════════════════════════════");

    } catch (error) {
        logger.error("❌ Erreur job followup:", error.message);
        throw error;
    }
}

// Gestion de la fermeture propre du pool
process.on("SIGTERM", async () => {
    await pool.end();
});

process.on("SIGINT", async () => {
    await pool.end();
});

module.exports = followupJob;
