"use strict";
const axios = require("axios");
const logger = require("../logger");

const BACKEND_URL = process.env.BACKEND_URL || "http://prospection-backend:4000";
const WA_MIN_DELAY = parseInt(process.env.WA_MIN_DELAY) || 30;
const WA_MAX_DELAY = parseInt(process.env.WA_MAX_DELAY) || 120;
const DAILY_LIMIT  = parseInt(process.env.DAILY_LIMIT)  || 80;

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
 * Construit le message personnalisé pour un lead
 */
function buildMessage(leadName) {
    return `Bonjour,

Je suis Larry Mbili, fondateur de Lumora Data.

On aide des entreprises comme ${leadName} à automatiser leur gestion et intégrer l'IA dans leurs processus — pour que les tâches chronophages se fassent seules et que vous pilotiez votre activité depuis votre téléphone en temps réel.

Nos clients récupèrent 2 à 3 heures par jour et prennent leurs décisions sur de vrais chiffres.

Je serais ravi d'échanger 20 minutes avec vous par appel cette semaine et vous présenter une démo.

Bonne journée,
Larry`;
}

/**
 * Job d'envoi WhatsApp first contact
 */
async function sendingJob() {
    logger.info("═══════════════════════════════════════════════════════════");
    logger.info("  DÉBUT ENVOI WHATSAPP (First Contact)");
    logger.info(`  Limite journalière : ${DAILY_LIMIT} messages`);
    logger.info("═══════════════════════════════════════════════════════════");

    try {
        // 1. Récupérer les leads avec WhatsApp (on prend plus que la limite pour avoir du choix)
        logger.info(`Récupération des leads avec WhatsApp (limite: ${DAILY_LIMIT})...`);
        const response = await axios.get(
            `${BACKEND_URL}/api/companies/new?limit=${DAILY_LIMIT}&has_whatsapp=true`,
            { timeout: 30000 }
        );

        const leads = response.data.data;

        if (!leads || leads.length === 0) {
            logger.info("Aucun nouveau lead à contacter");
            return;
        }

        logger.info(`${leads.length} leads récupérés`);

        let successCount = 0;
        let errorCount   = 0;
        let limitReached = false;

        // 2. Envoyer à chaque lead
        for (const lead of leads) {

            // ← Vérifier la limite AVANT chaque envoi
            if (successCount >= DAILY_LIMIT) {
                logger.warn(`Limite journalière atteinte (${DAILY_LIMIT} envois réussis)`);
                limitReached = true;
                break;
            }

            if (limitReached) break;

            const message = buildMessage(lead.name);

            try {
                logger.info(`Envoi à ${lead.name} (${lead.phone_whatsapp})...`);

                const sendResponse = await axios.post(
                    `${BACKEND_URL}/api/whatsapp/send`,
                    {
                        company_id: lead.id,
                        to_number:  lead.phone_whatsapp,
                        message:    message,
                        skip_delay: true,
                    },
                    { timeout: 60000 }
                );

                if (sendResponse.data.success) {
                    successCount++;
                    logger.info(`[${successCount}/${DAILY_LIMIT}] Envoyé à ${lead.name} (${lead.phone_whatsapp})`);
                } else {
                    errorCount++;
                    logger.error(`Échec envoi à ${lead.name}: ${sendResponse.data.error}`);
                }

            } catch (error) {
                // Limite atteinte côté WAHA
                if (error.response && error.response.status === 429) {
                    logger.warn("Limite journalière atteinte côté WhatsApp (429)");
                    limitReached = true;
                    break;
                }

                errorCount++;
                logger.error(`Erreur envoi à ${lead.name}: ${error.message}`);
                continue;
            }

            // Délai aléatoire avant le prochain envoi
            if (!limitReached && lead !== leads[leads.length - 1]) {
                const delay = getRandomDelay();
                logger.info(`Pause ${(delay / 1000).toFixed(0)}s avant le prochain envoi...`);
                await sleep(delay);
            }
        }

        logger.info("═══════════════════════════════════════════════════════════");
        logger.info(`  RÉSULTATS: ${successCount} envoyés, ${errorCount} échecs`);
        logger.info(`  Limite utilisée: ${successCount}/${DAILY_LIMIT}`);
        logger.info("═══════════════════════════════════════════════════════════");

    } catch (error) {
        logger.error("Erreur job sending:", error.message);
        throw error;
    }
}

module.exports = sendingJob;