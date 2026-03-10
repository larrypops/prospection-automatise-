"use strict";
require("dotenv").config();
const cron   = require("node-cron");
const logger = require("./logger");
const axios  = require("axios");

const scrapingJob           = require("./jobs/scraping");
const sendingJob            = require("./jobs/sending");
const followupJob           = require("./jobs/followup");
const emailSendingJob       = require("./jobs/email_sending");
const emailEnrichmentJob    = require("./jobs/email_enrichment");
const emailVerifyJob        = require("./jobs/email_verify");

const BACKEND_URL = process.env.BACKEND_URL || "http://prospection-backend:4000";

// Flags pour éviter les chevauchements
const runningJobs = {
    scraping:         false,
    sending:          false,
    followup:         false,
    emailSending:     false,
    emailEnrichment:  false,
    emailVerify:      false,
};

/**
 * Wrapper pour exécuter un job avec gestion des erreurs et logging
 */
async function runJob(name, jobFunc, isRunningFlag) {
    if (runningJobs[isRunningFlag]) {
        logger.warn(`Job ${name} déjà en cours, skipping...`);
        return;
    }

    runningJobs[isRunningFlag] = true;
    const startTime = Date.now();
    logger.info(`Démarrage du job: ${name}`);

    try {
        await jobFunc();
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        logger.info(`Job ${name} terminé en ${duration}s`);
    } catch (error) {
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        logger.error(`Job ${name} échoué après ${duration}s: ${error.message}`);
    } finally {
        runningJobs[isRunningFlag] = false;
    }
}

/**
 * Vérifie la connexion au backend
 */
async function checkBackendHealth() {
    try {
        const response = await axios.get(`${BACKEND_URL}/health`, { timeout: 5000 });
        if (response.data.status === "ok") {
            logger.info("Backend connecté");
            return true;
        }
    } catch (error) {
        logger.error("Backend non accessible:", error.message);
        return false;
    }
}

/**
 * Reset des compteurs email chaque matin
 */
async function resetEmailCounters() {
    try {
        await axios.post(`${BACKEND_URL}/api/email/reset-daily`, {}, { timeout: 10000 });
        logger.info("Compteurs email remis à zéro");
    } catch (error) {
        logger.error("Erreur reset compteurs email:", error.message);
    }
}

/**
 * Initialise et démarre les crons
 */
async function startScheduler() {
    logger.info("═══════════════════════════════════════════════════════════");
    logger.info("  SCHEDULER DÉMARRÉ");
    logger.info("═══════════════════════════════════════════════════════════");

    const isBackendOk = await checkBackendHealth();
    if (!isBackendOk) {
        logger.warn("Backend non disponible, les jobs risquent d'échouer");
    }

    // Cron 1: Scraping (3h du matin, lun-sam)
    cron.schedule("0 3 * * 1-6", async () => {
        await runJob("scraping", scrapingJob, "scraping");
    });
    logger.info("Cron scraping programmé: 3h00 du matin (lun-sam)");

    // Cron 2: Email enrichment (6h du matin, lun-sam) — après scraping
    cron.schedule("0 6 * * 1-6", async () => {
        await runJob("emailEnrichment", emailEnrichmentJob, "emailEnrichment");
    });
    logger.info("Cron email enrichment programmé: 6h00 du matin (lun-sam)");

    // Cron 3: Email verify (7h du matin, lun-sam) — après enrichissement
    cron.schedule("0 7 * * 1-6", async () => {
        await runJob("emailVerify", emailVerifyJob, "emailVerify");
    });
    logger.info("Cron email verify programmé: 7h00 du matin (lun-sam)");

    // Cron 2: Reset compteurs email (7h55, lun-sam) — avant les envois
    cron.schedule("55 7 * * 1-6", async () => {
        await resetEmailCounters();
    });
    logger.info("Cron reset email programmé: 7h55 du matin (lun-sam)");

    // Cron 3: Envoi WhatsApp (8h du matin, lun-sam)
    cron.schedule("0 8 * * 1-6", async () => {
        await runJob("sending", sendingJob, "sending");
    });
    logger.info("Cron sending WhatsApp programmé: 8h00 du matin (lun-sam)");

    // Cron 4: Envoi Email (9h du matin, lun-sam) — après WhatsApp
    cron.schedule("0 9 * * 1-6", async () => {
        await runJob("emailSending", emailSendingJob, "emailSending");
    });
    logger.info("Cron sending Email programmé: 9h00 du matin (lun-sam)");

    // Cron 5: Follow-up (10h du matin, lun-sam)
    cron.schedule("0 10 * * 1-6", async () => {
        await runJob("followup", followupJob, "followup");
    });
    logger.info("Cron followup programmé: 10h00 du matin (lun-sam)");

    logger.info("═══════════════════════════════════════════════════════════");
    logger.info("  En attente des crons...");
    logger.info("═══════════════════════════════════════════════════════════");
}

// Gestion des signaux pour arrêt propre
process.on("SIGTERM", () => {
    logger.info("SIGTERM reçu, arrêt du scheduler...");
    process.exit(0);
});

process.on("SIGINT", () => {
    logger.info("SIGINT reçu, arrêt du scheduler...");
    process.exit(0);
});

// Démarrer le scheduler
startScheduler().catch((error) => {
    logger.error("Erreur fatale au démarrage du scheduler:", error);
    process.exit(1);
});