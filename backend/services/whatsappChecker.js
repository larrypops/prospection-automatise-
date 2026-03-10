"use strict";
const axios  = require("axios");
const { query } = require("../utils/db");
const logger = require("../utils/logger");

const WAHA_URL     = process.env.WAHA_URL     || "http://waha:3000";
const WAHA_API_KEY = process.env.WAHA_API_KEY || "";

/**
 * Vérifie si un numéro de téléphone a WhatsApp via l'API WAHA
 * @param {string} phone - Numéro de téléphone (format: +237XXXXXXXXX)
 * @returns {Promise<{hasWhatsapp: boolean|null, verifiedPhone: string|null}>}
 */
async function checkWhatsAppNumber(phone) {
    try {
        if (!phone) {
            return { hasWhatsapp: null, verifiedPhone: null };
        }

        // Normaliser le numéro (enlever espaces, tirets, etc.)
        const normalizedPhone = phone.replace(/[\s\-\.]/g, "");
        
        // Vérifier que le numéro commence par +
        const formattedPhone = normalizedPhone.startsWith("+") 
            ? normalizedPhone 
            : `+${normalizedPhone}`;

        logger.info(`🔍 Vérification WhatsApp pour: ${formattedPhone}`);

        // Appel API WAHA pour vérifier si le numéro existe sur WhatsApp
        // WAHA API: POST /api/default/contacts/check-exists
        const response = await axios({
            method: "GET",
            url: `${WAHA_URL}/api/contacts/check-exists?phone=${formattedPhone.replace("+", "")}&session=default`,
            headers: { 
                "X-Api-Key": WAHA_API_KEY,
                "Content-Type": "application/json"
            },
            timeout: 30000,
        });

        // Analyser la réponse WAHA
        // La réponse typique: { "numberExists": true, "chatId": "237XXXXXXXX@c.us" }
        const result = response.data;
        
        if (result && result.numberExists === true) {
            logger.info(`✅ WhatsApp trouvé pour: ${formattedPhone}`);
            return { 
                hasWhatsapp: true, 
                verifiedPhone: formattedPhone 
            };
        } else {
            logger.info(`❌ Pas de WhatsApp pour: ${formattedPhone}`);
            return { 
                hasWhatsapp: false, 
                verifiedPhone: null 
            };
        }

    } catch (error) {
        // Si l'erreur est 404 ou indique que le numéro n'existe pas
        if (error.response?.status === 404 || 
            error.response?.data?.message?.includes("not found") ||
            error.response?.data?.message?.includes("does not exist")) {
            logger.info(`❌ Numéro non trouvé sur WhatsApp: ${phone}`);
            return { hasWhatsapp: false, verifiedPhone: null };
        }
        
        logger.error(`❌ Erreur vérification WhatsApp pour ${phone}:`, error.message);
        return { hasWhatsapp: null, verifiedPhone: null };
    }
}

/**
 * Met à jour une entreprise avec le statut WhatsApp
 * @param {string} companyId - ID de l'entreprise
 * @param {boolean} hasWhatsapp - Statut WhatsApp
 * @param {string|null} verifiedPhone - Numéro WhatsApp vérifié
 */
async function updateCompanyWhatsAppStatus(companyId, hasWhatsapp, verifiedPhone = null) {
    try {
        const updateFields = ["has_whatsapp = $2"];
        const params = [companyId, hasWhatsapp];
        let paramIndex = 3;

        // Si WhatsApp trouvé, mettre à jour phone_whatsapp aussi
        if (hasWhatsapp === true && verifiedPhone) {
            updateFields.push(`phone_whatsapp = $${paramIndex}`);
            params.push(verifiedPhone);
            paramIndex++;
        }

        const sql = `
            UPDATE companies 
            SET ${updateFields.join(", ")}, updated_at = NOW()
            WHERE id = $1
            RETURNING id, name, has_whatsapp, phone_whatsapp
        `;

        const result = await query(sql, params);
        
        if (result.rows[0]) {
            logger.info(`✅ Entreprise ${result.rows[0].name} mise à jour: has_whatsapp=${hasWhatsapp}`);
        }
        
        return result.rows[0];
    } catch (error) {
        logger.error(`❌ Erreur mise à jour entreprise ${companyId}:`, error.message);
        throw error;
    }
}

/**
 * Vérifie WhatsApp pour une entreprise et met à jour la DB
 * @param {string} companyId - ID de l'entreprise
 * @param {string} phone - Numéro de téléphone
 */
async function verifyAndUpdateCompany(companyId, phone) {
    try {
        // Vérifier si déjà vérifié
        const existing = await query(
            "SELECT has_whatsapp FROM companies WHERE id = $1",
            [companyId]
        );
        
        if (existing.rows[0]?.has_whatsapp === true) {
            logger.info(`⏩ Entreprise ${companyId} déjà vérifiée`);
            return existing.rows[0];
        }

        // Vérifier WhatsApp
        const checkResult = await checkWhatsAppNumber(phone);
        
        // Mettre à jour la DB
        return await updateCompanyWhatsAppStatus(
            companyId, 
            checkResult.hasWhatsapp, 
            checkResult.verifiedPhone
        );
    } catch (error) {
        logger.error(`❌ Erreur vérification entreprise ${companyId}:`, error.message);
        throw error;
    }
}

/**
 * Vérifie WhatsApp pour toutes les entreprises non vérifiées
 * (fonction utilitaire pour vérification en masse)
 */
async function verifyAllPendingCompanies() {
    try {
        const pending = await query(`
            SELECT id, phone, phone_whatsapp 
            FROM companies 
            WHERE (has_whatsapp IS NULL OR has_whatsapp = false) 
              AND (phone IS NOT NULL OR phone_whatsapp IS NOT NULL)
            LIMIT 100
        `);

        logger.info(`🔄 Vérification de ${pending.rows.length} entreprises en attente...`);

        for (const company of pending.rows) {
            const phone = company.phone_whatsapp || company.phone;
            if (phone) {
                await verifyAndUpdateCompany(company.id, phone);
                // Petit délai pour ne pas surcharger l'API
                await new Promise(r => setTimeout(r, 1000));
            }
        }

        logger.info(`✅ Vérification en masse terminée`);
    } catch (error) {
        logger.error(`❌ Erreur vérification en masse:`, error.message);
    }
}

module.exports = {
    checkWhatsAppNumber,
    updateCompanyWhatsAppStatus,
    verifyAndUpdateCompany,
    verifyAllPendingCompanies,
};
