"use strict";
const axios = require("axios");
const logger = require("../logger");

const BACKEND_URL = process.env.BACKEND_URL || "http://prospection-backend:4000";

// Liste des catégories
const CATEGORIES = [
    "École privée", "École bilingue", "École maternelle", "Collège privé", "Lycée privé", "Université privée", "Institut supérieur", "Centre de formation",
"Supermarché", "Supérette", "Grossiste alimentaire", "Dépôt de boissons", "Quincaillerie", "Matériaux de construction", "Boutique téléphones", "Électroménager", "Vêtements", "Distribution",
"Hôtel", "Résidence hôtelière", "Boulangerie", "Pâtisserie", "Lounge bar",
"Construction", "BTP", "Promoteur immobilier", "Agence immobilière", "Bureau d’études techniques", "Travaux publics",
"Garage", "Concessionnaire", "Pièces détachées", "Atelier mécanique",
"Société", "SARL", "Groupe", "Holding", "Services", "Industrie",
"Start-up", "PME", "Micro-entreprise", "Commerçant", "Artisan", "Prestataire de services", "Consultant", "Agence communication", "Agence digitale", "Agence marketing", "Développeur logiciel", "Freelance", "Auto-entrepreneur",
"Logistique", "Transporteur", "Livraison", "Événementiel", "Organisateur événements", "Traiteur",
"Coiffeur", "Esthéticien", "Salon beauté", "Spa", "Photographie", "Agence voyages", "Tour-opérateur", "Location véhicules",
"Coaching", "Recrutement", "Cabinet RH", "Sécurité", "Nettoyage", "Maintenance",
"Production audiovisuelle", "Design", "Studio création", "Architecture", "Ingénierie environnementale",
"Services éducatifs", "Loisirs", "Transport", "Réparation automobile", "Conseil stratégique", "Fabrication meubles", "Menuiserie", "Électricité", "Plomberie", "Rénovation", "Décoration", "Nettoyage industriel"
];

// Villes disponibles
const CITIES = [
    "Yaoundé, Cameroun",
    "Douala, Cameroun",
];

/**
 * Mélange aléatoirement un tableau (Fisher-Yates shuffle)
 */
function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

/**
 * Attend un certain nombre de millisecondes
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Lance un job de scraping et attend sa complétion
 */
async function launchScraperJob(endpoint, payload, jobName) {
    const timeoutMs = 30 * 60 * 1000; // 30 minutes timeout
    const pollIntervalMs = 2 * 60 * 1000; // 2 minutes polling

    try {
        logger.info(`Lancement ${jobName}: ${payload.query} à ${payload.location}`);
        const response = await axios.post(`${BACKEND_URL}${endpoint}`, payload, {
            timeout: 30000,
            headers: { "Content-Type": "application/json" }
        });

        const jobId = response.data.job_id;
        if (!jobId) {
            throw new Error("Pas de job_id retourné");
        }

        logger.info(`Job ${jobName} démarré (ID: ${jobId})`);

        // Polling du statut
        let isDone = false;
        let attempts = 0;
        const maxAttempts = Math.ceil(timeoutMs / pollIntervalMs);

        while (!isDone && attempts < maxAttempts) {
            await sleep(pollIntervalMs);
            attempts++;

            try {
                const statusResponse = await axios.get(
                    `${BACKEND_URL}/api/scraper/status/${jobId}`,
                    { timeout: 10000 }
                );

                const { status, items_scraped, error_message, duration_sec } = statusResponse.data;

                if (status === "done") {
                    isDone = true;
                    logger.info(`${jobName} terminé: ${items_scraped} leads en ${duration_sec}s`);
                    return { success: true, items_scraped };
                } else if (status === "failed") {
                    isDone = true;
                    logger.error(`${jobName} échoué: ${error_message}`);
                    return { success: false, error: error_message };
                } else {
                    logger.info(`${jobName} toujours en cours (tentative ${attempts}/${maxAttempts})`);
                }
            } catch (pollError) {
                logger.warn(`Erreur polling ${jobName}: ${pollError.message}`);
            }
        }

        if (!isDone) {
            logger.error(`Timeout ${jobName} après ${timeoutMs / 60000} minutes`);
            return { success: false, error: "Timeout" };
        }

    } catch (error) {
        logger.error(`Erreur lancement ${jobName}: ${error.message}`);
        return { success: false, error: error.message };
    }
}

/**
 * Job principal de scraping
 */
async function scrapingJob() {
    logger.info("═══════════════════════════════════════════════════════════");
    logger.info("  DÉBUT DU SCRAPING");
    logger.info("═══════════════════════════════════════════════════════════");

    // 1. Mélanger et sélectionner 10 catégories
    const shuffledCategories = shuffleArray(CATEGORIES);
    const selectedCategories = shuffledCategories.slice(0, 10);
    logger.info(`Catégories sélectionnées: ${selectedCategories.join(", ")}`);

    // 2. Sélectionner les 5 premières pour Google Maps + Meta Ads
    const categoriesForJobs = selectedCategories.slice(0, 5);

    let totalSuccess = 0;
    let totalFailed = 0;

    // 3. Lancer les jobs en séquence
    for (const category of categoriesForJobs) {
        // Choisir une ville aléatoire
        const city = CITIES[Math.floor(Math.random() * CITIES.length)];

        // Job Google Maps
        const googleMapsResult = await launchScraperJob(
            "/api/scraper/google-maps",
            {
                query: category,
                location: city,
                max_results: 250
            },
            `Google Maps: ${category}`
        );

        if (googleMapsResult.success) {
            totalSuccess++;
        } else {
            totalFailed++;
        }

        // Attendre 30 secondes entre les jobs
        logger.info("Pause de 30s avant le prochain job...");
        await sleep(30000);

        // Job Meta Ads
        logger.info(`Lancement Meta Ads pour: ${category}`);

        const metaAdsResult = await launchScraperJob(
            "/api/scraper/meta-ads",
            {
                query: category,
                location: city,
                country_code: "CM",
                max_results: 150
            },
            `Meta Ads: ${category}`
        );

        if (metaAdsResult.success) {
            totalSuccess++;
        } else {
            totalFailed++;
        }

        // Attendre 30 secondes
        logger.info("Pause de 30s avant le prochain job...");
        await sleep(30000);
    }   // ← fin du for (corrigé — accolade en trop supprimée)

    logger.info("═══════════════════════════════════════════════════════════");
    logger.info(`  RÉSULTATS SCRAPING: ${totalSuccess} succès, ${totalFailed} échecs`);
    logger.info("═══════════════════════════════════════════════════════════");

    // 4. Lancer la vérification WhatsApp automatique
    logger.info("Lancement vérification WhatsApp automatique...");
    try {
        const verifyResponse = await axios.post(
            `${BACKEND_URL}/api/companies/bulk/check-whatsapp`,
            {},
            { timeout: 10000 }
        );
        if (verifyResponse.data.success) {
            logger.info("Vérification WhatsApp démarrée en arrière-plan");
            logger.info("Les leads seront vérifiés progressivement avant l'envoi");
        }
    } catch (verifyError) {
        logger.warn(`Erreur lancement vérification WhatsApp: ${verifyError.message}`);
    }
}   // ← fin de scrapingJob

module.exports = scrapingJob;   // ← replacé ici, en dehors de la fonction