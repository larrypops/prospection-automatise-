"use strict";
const axios  = require("axios");
const logger = require("../logger");
const { Pool } = require("pg");

const DATABASE_URL      = process.env.DATABASE_URL || "";
const CHECK_EMAIL_URL   = "http://109.199.118.183:8081/v0/check_email";
const VERIFY_BATCH_SIZE = parseInt(process.env.EMAIL_VERIFY_BATCH || "50");
const VERIFY_DELAY_MS   = 2000; // 2s entre chaque vérification

const pool = new Pool({ connectionString: DATABASE_URL });

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Vérifie un email via check_email API
 * Retourne true si is_reachable === "safe", false sinon
 */
async function checkEmail(email) {
    try {
        const res = await axios.post(CHECK_EMAIL_URL, { to_email: email }, { timeout: 15000 });
        const reachable = res.data?.is_reachable;
        return reachable === "safe";
    } catch (err) {
        logger.warn(`Erreur vérification ${email}: ${err.message}`);
        return null; // null = erreur réseau, on ne met pas à jour
    }
}

/**
 * Job de vérification des emails des companies
 */
async function emailVerifyJob() {
    logger.info("═══════════════════════════════════════════════════════════");
    logger.info("  EMAIL VERIFY — Démarrage vérification");
    logger.info("═══════════════════════════════════════════════════════════");

    let verified = 0, invalid = 0, errors = 0;

    try {
        // Récupérer les companies avec email non encore vérifiés
        const result = await pool.query(`
            SELECT id, name, email
            FROM companies
            WHERE email IS NOT NULL
              AND email != ''
              AND email_verified IS NULL
            ORDER BY created_at DESC
            LIMIT $1
        `, [VERIFY_BATCH_SIZE]);

        const companies = result.rows;

        if (companies.length === 0) {
            logger.info("Aucun email à vérifier");
            return;
        }

        logger.info(`${companies.length} emails à vérifier (batch: ${VERIFY_BATCH_SIZE})`);

        for (const company of companies) {
            logger.info(`Vérification: ${company.email} (${company.name})...`);

            const isValid = await checkEmail(company.email);

            if (isValid === null) {
                // Erreur réseau — on skip
                errors++;
                logger.warn(`⚠️  Skip ${company.email} (erreur réseau)`);
            } else if (isValid) {
                await pool.query(
                    `UPDATE companies SET email_verified = true, updated_at = NOW() WHERE id = $1`,
                    [company.id]
                );
                verified++;
                logger.info(`✅ [${verified}] ${company.email} — VALID`);
            } else {
                await pool.query(
                    `UPDATE companies SET email_verified = false, updated_at = NOW() WHERE id = $1`,
                    [company.id]
                );
                invalid++;
                logger.info(`❌ ${company.email} — INVALID`);
            }

            await sleep(VERIFY_DELAY_MS);
        }

        logger.info("═══════════════════════════════════════════════════════════");
        logger.info(`  RÉSULTATS: ✅ ${verified} valides · ❌ ${invalid} invalides · ⚠️  ${errors} erreurs`);
        logger.info("═══════════════════════════════════════════════════════════");

    } catch (err) {
        logger.error("Erreur job email_verify:", err.message);
        throw err;
    }
}

module.exports = emailVerifyJob;