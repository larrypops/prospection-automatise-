"use strict";

/**
 * Formate un numéro de téléphone en format WhatsApp international
 * Règles pour le Cameroun (+237):
 * - Supprime tous les espaces, tirets, parenthèses
 * - Format local 6XXXXXXXX ou 2XXXXXXXX ou 3XXXXXXXX → +237XXXXXXXX
 * - Format avec indicatif 00237 → +237
 * - Format déjà avec +237 → garde tel quel
 * 
 * @param {string} phone - Numéro de téléphone brut
 * @returns {string|null} - Numéro formaté ou null si invalide
 */
function formatWhatsAppNumber(phone) {
    if (!phone || typeof phone !== 'string') return null;
    
    // Nettoyage : garder uniquement chiffres et +
    let cleaned = phone.replace(/[^\d+]/g, '');
    
    // Supprime les + en trop
    if (cleaned.includes('+')) {
        cleaned = '+' + cleaned.replace(/\+/g, '');
    }
    
    // 1. Format international complet déjà présent (+237XXXXXXXX)
    if (cleaned.match(/^\+237[6-9]\d{8}$/)) {
        return cleaned;
    }
    
    // 2. Format avec 00237 au début → convertir en +237
    if (cleaned.match(/^00237[6-9]\d{8}$/)) {
        return '+237' + cleaned.substring(5);
    }
    
    // 3. Format avec 237 au début mais sans + → ajouter +
    if (cleaned.match(/^237[6-9]\d{8}$/)) {
        return '+' + cleaned;
    }
    
    // 4. Format local camerounais (commence par 6 ou 2 ou 3 et 9 chiffres)
    if (cleaned.match(/^[623]\d{8}$/)) {
        return '+237' + cleaned;
    }
    
    // 5. Autres formats internationaux (garde tel quel si commence par +)
    if (cleaned.match(/^\+\d{10,15}$/)) {
        return cleaned;
    }
    
    // 6. Format avec 00 au début → remplace par +
    if (cleaned.match(/^00\d{10,15}$/)) {
        return '+' + cleaned.substring(2);
    }
    
    // Si ne correspond à aucun format valide
    return null;
}

/**
 * Formate tous les numéros d'un lead
 * @param {Object} lead - Objet lead avec phone
 * @returns {Object} - Lead avec phone_whatsapp formaté
 */
function formatLeadPhoneNumbers(lead) {
    const result = { ...lead };
    
    // Si phone existe, tente de le formater en phone_whatsapp
    if (lead.phone) {
        const formatted = formatWhatsAppNumber(lead.phone);
        if (formatted) {
            result.phone_whatsapp = formatted;
        }
    }
    
    // Si phone_whatsapp existe déjà, s'assurer qu'il est bien formaté
    if (lead.phone_whatsapp) {
        const formatted = formatWhatsAppNumber(lead.phone_whatsapp);
        if (formatted) {
            result.phone_whatsapp = formatted;
        }
    }
    
    return result;
}

module.exports = {
    formatWhatsAppNumber,
    formatLeadPhoneNumbers
};
