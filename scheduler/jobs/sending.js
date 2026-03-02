"use strict";
const axios = require("axios");
const logger = require("../logger");

const BACKEND_URL = process.env.BACKEND_URL || "http://prospection-backend:4000";
const WA_MIN_DELAY = parseInt(process.env.WA_MIN_DELAY) || 30;
const WA_MAX_DELAY = parseInt(process.env.WA_MAX_DELAY) || 120;
const DAILY_LIMIT = parseInt(process.env.DAILY_LIMIT) || 20;

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
    return `Bonjour, je suis Larry Mbili de Lumora Data. Je vous contacte car j'analyse actuellement les entreprises comme ${leadName} afin de les aider à mettre en place des systèmes automatisés de gestion et de suivi financier.

Beaucoup d'établissements manquent de visibilité claire sur leurs performances, leurs flux et leur rentabilité.

Est-ce que vous disposez déjà d'un système automatisé pour piloter votre activité et suivre vos chiffres en temps réel ?`;
}

/**
 * Job d'envoi WhatsApp first contact
 */
async function sendingJob() {
    logger.info("═══════════════════════════════════════════════════════════");
    logger.info("  📤 DÉBUT ENVOI WHATSAPP (First Contact)");
    logger.info("═══════════════════════════════════════════════════════════");

    try {
        // 1. Récupérer les leads avec WhatsApp
        logger.info(`🔍 Récupération des leads avec WhatsApp (limite: ${DAILY_LIMIT})...`);
        const response = await axios.get(
            `${BACKEND_URL}/api/companies/new?limit=${DAILY_LIMIT}&has_whatsapp=true`,
            { timeout: 30000 }
        );

        const leads = response.data.data;
        
        if (!leads || leads.length === 0) {
            logger.info("ℹ️  Aucun nouveau lead à contacter");
            return;
        }

        logger.info(`📋 ${leads.length} leads à contacter`);

        let successCount = 0;
        let errorCount = 0;
        let limitReached = false;

        // 2. Envoyer à chaque lead
        for (const lead of leads) {
            if (limitReached) {
                logger.warn("🚫 Limite journalière atteinte, arrêt des envois");
                break;
            }

            const message = buildMessage(lead.name);

            try {
                logger.info(`📤 Envoi à ${lead.name} (${lead.phone_whatsapp})...`);

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
                    successCount++;
                    logger.info(`✅ Envoyé à ${lead.name} (${lead.phone_whatsapp})`);
                } else {
                    errorCount++;
                    logger.error(`❌ Échec envoi à ${lead.name}: ${sendResponse.data.error}`);
                }

            } catch (error) {
                // Gestion erreur 429 (limite atteinte)
                if (error.response && error.response.status === 429) {
                    logger.warn("🚫 Limite journalière atteinte (429)");
                    limitReached = true;
                    break;
                }

                errorCount++;
                logger.error(`❌ Erreur envoi à ${lead.name}:`, error.message);
                
                // Continuer avec le lead suivant
                continue;
            }

            // Délai aléatoire avant le prochain envoi (si ce n'est pas le dernier)
            if (lead !== leads[leads.length - 1] && !limitReached) {
                const delay = getRandomDelay();
                logger.info(`⏳ Attente ${(delay / 1000).toFixed(0)}s avant le prochain envoi...`);
                await sleep(delay);
            }
        }

        logger.info("═══════════════════════════════════════════════════════════");
        logger.info(`  📊 RÉSULTATS: ${successCount} succès, ${errorCount} échecs`);
        logger.info("═══════════════════════════════════════════════════════════");

    } catch (error) {
        logger.error("❌ Erreur job sending:", error.message);
        throw error;
    }
}

module.exports = sendingJob;
