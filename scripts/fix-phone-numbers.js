#!/usr/bin/env node
"use strict";

/**
 * Script pour corriger le formatage des numéros de téléphone existants
 * Usage: node scripts/fix-phone-numbers.js
 */

require("dotenv").config();
const { Pool } = require("pg");

// Import du formateur
const { formatWhatsAppNumber } = require("../utils/phoneFormatter");

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
    console.error("❌ DATABASE_URL non défini");
    process.exit(1);
}

const pool = new Pool({
    connectionString: DATABASE_URL,
});

async function fixPhoneNumbers() {
    const client = await pool.connect();
    
    try {
        console.log("🔍 Recherche des leads avec numéros à formater...");
        
        // Récupérer tous les leads avec un phone non null
        const result = await client.query(`
            SELECT id, name, phone, phone_whatsapp 
            FROM companies 
            WHERE phone IS NOT NULL 
               OR phone_whatsapp IS NOT NULL
            ORDER BY created_at DESC
        `);
        
        console.log(`📊 ${result.rowCount} leads trouvés avec des numéros`);
        
        let updated = 0;
        let skipped = 0;
        let errors = 0;
        
        for (const lead of result.rows) {
            const formatted = formatWhatsAppNumber(lead.phone || lead.phone_whatsapp);
            
            if (formatted && formatted !== lead.phone_whatsapp) {
                try {
                    await client.query(`
                        UPDATE companies 
                        SET phone_whatsapp = $1, updated_at = NOW()
                        WHERE id = $2
                    `, [formatted, lead.id]);
                    
                    console.log(`✅ ${lead.name}: ${lead.phone || lead.phone_whatsapp} → ${formatted}`);
                    updated++;
                } catch (err) {
                    console.error(`❌ Erreur mise à jour ${lead.id}:`, err.message);
                    errors++;
                }
            } else if (!formatted) {
                console.log(`⚠️  ${lead.name}: format non reconnu (${lead.phone || lead.phone_whatsapp})`);
                skipped++;
            } else {
                skipped++;
            }
        }
        
        console.log("\n📊 RÉSULTATS:");
        console.log(`   ✅ Mis à jour: ${updated}`);
        console.log(`   ⏭️  Ignorés: ${skipped}`);
        console.log(`   ❌ Erreurs: ${errors}`);
        
    } catch (error) {
        console.error("❌ Erreur:", error.message);
    } finally {
        client.release();
        await pool.end();
    }
}

fixPhoneNumbers();
