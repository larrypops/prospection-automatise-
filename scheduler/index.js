"use strict";
require("dotenv").config();
const cron = require("node-cron");
const logger = require("./logger");

const scrapingJob = require("./jobs/scraping");
const sendingJob = require("./jobs/sending");
const followupJob = require("./jobs/followup");

const BACKEND_URL = process.env.BACKEND_URL || "http://prospection-backend:4000";

// Flags pour éviter les chevauchements
const runningJobs = {
    scraping: false,
    sending: false,
    followup: false,
};

/**
 * Wrapper pour exécuter un job avec gestion des erreurs et logging
 */
async function runJob(name, jobFunc, isRunningFlag) {
    if (runningJobs[isRunningFlag]) {
        logger.warn(`⚠️  Job ${name} déjà en cours, skipping...`);
        return;
    }

    runningJobs[isRunningFlag] = true;
    const startTime = Date.now();
    logger.info(`🚀 Démarrage du job: ${name}`);

    try {
        await jobFunc();
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        logger.info(`✅ Job ${name} terminé en ${duration}s`);
    } catch (error) {
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        logger.error(`❌ Job ${name} échoué après ${duration}s:`, error.message);
    } finally {
        runningJobs[isRunningFlag] = false;
    }
}

/**
 * Vérifie la connexion au backend
 */
async function checkBackendHealth() {
    try {
        const axios = require("axios");
        const response = await axios.get(`${BACKEND_URL}/health`, { timeout: 5000 });
        if (response.data.status === "ok") {
            logger.info("✅ Backend connecté");
            return true;
        }
    } catch (error) {
        logger.error("❌ Backend non accessible:", error.message);
        return false;
    }
}

/**
 * Initialise et démarre les crons
 */
async function startScheduler() {
    logger.info("═══════════════════════════════════════════════════════════");
    logger.info("  🕐 SCHEDULER DÉMARRÉ");
    logger.info("═══════════════════════════════════════════════════════════");

    // Vérifier le backend
    const isBackendOk = await checkBackendHealth();
    if (!isBackendOk) {
        logger.warn("⚠️  Backend non disponible, les jobs risquent d'échouer");
    }

    // Cron 1: Scraping (3h du matin, lun-sam)
    cron.schedule("0 3 * * 1-6", async () => {
        await runJob("scraping", scrapingJob, "scraping");
    });
    logger.info("📅 Cron scraping programmé: 3h00 du matin (lun-sam)");

    // Cron 2: Envoi WhatsApp (8h du matin, lun-sam)
    cron.schedule("0 8 * * 1-6", async () => {
        await runJob("sending", sendingJob, "sending");
    });
    logger.info("📅 Cron sending programmé: 8h00 du matin (lun-sam)");

    // Cron 3: Follow-up (10h du matin, lun-sam)
    cron.schedule("0 10 * * 1-6", async () => {
        await runJob("followup", followupJob, "followup");
    });
    logger.info("📅 Cron followup programmé: 10h00 du matin (lun-sam)");

    logger.info("═══════════════════════════════════════════════════════════");
    logger.info("  ⏳ En attente des crons...");
    logger.info("═══════════════════════════════════════════════════════════");
}

// Gestion des signaux pour arrêt propre
process.on("SIGTERM", () => {
    logger.info("🛑 SIGTERM reçu, arrêt du scheduler...");
    process.exit(0);
});

process.on("SIGINT", () => {
    logger.info("🛑 SIGINT reçu, arrêt du scheduler...");
    process.exit(0);
});

// Démarrer le scheduler
startScheduler().catch((error) => {
    logger.error("❌ Erreur fatale au démarrage du scheduler:", error);
    process.exit(1);
});
