"use strict";
const { execSync } = require("child_process");
const logger = require("../logger");

const DATABASE_URL = process.env.DATABASE_URL || "";

/**
 * Job d'enrichissement email — visite les sites web des companies
 * et extrait les adresses email pour mettre à jour la DB
 */
async function emailEnrichmentJob() {
    logger.info("═══════════════════════════════════════════════════════════");
    logger.info("  EMAIL ENRICHMENT — Démarrage spider");
    logger.info("═══════════════════════════════════════════════════════════");

    try {
        const cmd = [
            "scrapy crawl email_enrichment",
            "-a batch_size=100",
            `-s DATABASE_URL="${DATABASE_URL}"`,
            `-s DOWNLOAD_HANDLERS='{}'`,
            `-s LOG_FILE=""`,
            `-L INFO`,
        ].join(" ");

        logger.info(`Commande: ${cmd}`);

        execSync(cmd, {
            cwd: "/app",
            stdio: "inherit",
            timeout: 3600000, // 1h max
            env: { ...process.env },
        });

        logger.info("Spider email_enrichment terminé");

    } catch (error) {
        logger.error("Erreur job email_enrichment:", error.message);
        throw error;
    }
}

module.exports = emailEnrichmentJob;