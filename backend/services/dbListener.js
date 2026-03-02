"use strict";
const { pool } = require("../utils/db");
const logger = require("../utils/logger");
const { verifyAndUpdateCompany } = require("./whatsappChecker");

let client = null;

/**
 * Démarre l'écoute des notifications PostgreSQL
 * Écoute le canal 'new_company' pour vérifier WhatsApp automatiquement
 */
async function startDBListener() {
    try {
        if (client) {
            logger.info("📝 Listener DB déjà démarré");
            return;
        }

        client = await pool.connect();
        
        // Écouter le canal 'new_company'
        await client.query("LISTEN new_company");
        
        logger.info("👂 Listener PostgreSQL démarré - Écoute sur 'new_company'");

        // Gestion des notifications
        client.on("notification", async (msg) => {
            try {
                if (msg.channel === "new_company") {
                    const payload = JSON.parse(msg.payload);
                    logger.info(`🔔 Nouvelle entreprise détectée: ${payload.id}`);

                    // Vérifier WhatsApp pour cette entreprise
                    const phone = payload.phone_whatsapp || payload.phone;
                    if (phone) {
                        // Petit délai pour laisser la transaction s'engager
                        setTimeout(async () => {
                            try {
                                await verifyAndUpdateCompany(payload.id, phone);
                            } catch (err) {
                                logger.error(`❌ Erreur vérification WhatsApp pour ${payload.id}:`, err.message);
                            }
                        }, 500);
                    } else {
                        logger.warn(`⚠️ Pas de numéro pour l'entreprise ${payload.id}`);
                    }
                }
            } catch (error) {
                logger.error("❌ Erreur traitement notification:", error.message);
            }
        });

        // Gestion de la reconnexion
        client.on("error", async (err) => {
            logger.error("❌ Erreur client PostgreSQL:", err.message);
            client = null;
            // Reconnexion après 5 secondes
            setTimeout(startDBListener, 5000);
        });

        client.on("end", () => {
            logger.warn("🔌 Connexion PostgreSQL fermée");
            client = null;
            // Reconnexion après 5 secondes
            setTimeout(startDBListener, 5000);
        });

    } catch (error) {
        logger.error("❌ Erreur démarrage listener DB:", error.message);
        client = null;
        // Reconnexion après 5 secondes
        setTimeout(startDBListener, 5000);
    }
}

/**
 * Arrête l'écoute des notifications
 */
async function stopDBListener() {
    if (client) {
        try {
            await client.query("UNLISTEN new_company");
            client.release();
            logger.info("🛑 Listener PostgreSQL arrêté");
        } catch (error) {
            logger.error("❌ Erreur arrêt listener:", error.message);
        } finally {
            client = null;
        }
    }
}

module.exports = {
    startDBListener,
    stopDBListener,
};
