"use strict";
const axios  = require("axios");
const logger = require("../logger");

const BACKEND_URL = process.env.BACKEND_URL || "http://prospection-backend:4000";
const EMAIL_DELAY_MIN = parseInt(process.env.EMAIL_MIN_DELAY) || 60;  // secondes
const EMAIL_DELAY_MAX = parseInt(process.env.EMAIL_MAX_DELAY) || 180; // secondes

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getRandomDelay() {
    return Math.floor(Math.random() * (EMAIL_DELAY_MAX - EMAIL_DELAY_MIN + 1) + EMAIL_DELAY_MIN) * 1000;
}

async function emailSendingJob() {
    logger.info("═══════════════════════════════════════════════════════════");
    logger.info("  DÉBUT ENVOI EMAIL (First Contact)");
    logger.info("═══════════════════════════════════════════════════════════");

    try {
        // 1. Vérifier les senders disponibles
        const sendersRes = await axios.get(`${BACKEND_URL}/api/email/senders`, { timeout: 10000 });
        const senders    = sendersRes.data.filter(s => s.is_active && s.remaining_today > 0);

        if (senders.length === 0) {
            logger.info("Limite journalière atteinte pour tous les senders email — arrêt");
            return;
        }

        const totalAvailable = senders.reduce((sum, s) => sum + s.remaining_today, 0);
        logger.info(`${senders.length} sender(s) disponibles — ${totalAvailable} emails restants aujourd'hui`);

        // 2. Récupérer les leads sans WhatsApp avec un email
        const leadsRes = await axios.get(
            `${BACKEND_URL}/api/companies/new?limit=${totalAvailable}&has_whatsapp=false`,
            { timeout: 30000 }
        );

        const allLeads = leadsRes.data.data || [];

        // Filtrer uniquement ceux qui ont un email vérifié (email_verified = true)
        const leads = allLeads.filter(l => l.email && l.email.includes("@") && l.email_verified === true);

        if (leads.length === 0) {
            logger.info("Aucun lead avec email à contacter");
            return;
        }

        logger.info(`${leads.length} leads avec email trouvés`);

        let successCount = 0;
        let errorCount   = 0;
        let limitReached = false;

        // 3. Envoyer à chaque lead
        for (const lead of leads) {

            if (limitReached) break;

            // Vérifier si on a encore de la capacité
            if (successCount >= totalAvailable) {
                logger.warn("Capacité journalière email atteinte");
                limitReached = true;
                break;
            }

            try {
                logger.info(`Envoi email à ${lead.name} (${lead.email})...`);

                const sendRes = await axios.post(
                    `${BACKEND_URL}/api/email/send`,
                    {
                        company_id:   lead.id,
                        to_email:     lead.email,
                        to_name:      lead.name,
                        message_type: "first_contact",
                    },
                    { timeout: 20000 }
                );

                if (sendRes.data.success) {
                    successCount++;
                    logger.info(`[${successCount}] Envoyé à ${lead.name} (${lead.email}) via ${sendRes.data.sender}`);
                } else {
                    errorCount++;
                    logger.error(`Échec email à ${lead.name}: ${sendRes.data.error}`);
                }

            } catch (error) {
                if (error.response?.status === 429) {
                    logger.warn("Limite journalière email atteinte (429)");
                    limitReached = true;
                    break;
                }
                errorCount++;
                logger.error(`Erreur email à ${lead.name}: ${error.message}`);
                continue;
            }

            // Délai anti-spam entre chaque email
            if (!limitReached && lead !== leads[leads.length - 1]) {
                const delay = getRandomDelay();
                logger.info(`Pause ${(delay / 1000).toFixed(0)}s avant le prochain email...`);
                await sleep(delay);
            }
        }

        logger.info("═══════════════════════════════════════════════════════════");
        logger.info(`  RÉSULTATS EMAIL: ${successCount} envoyés, ${errorCount} échecs`);
        logger.info("═══════════════════════════════════════════════════════════");

    } catch (error) {
        logger.error("Erreur job email sending:", error.message);
        throw error;
    }
}

module.exports = emailSendingJob;