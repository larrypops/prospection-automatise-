#!/usr/bin/env node
"use strict";
/**
 * init_email_senders.js
 * ---------------------
 * Initialise les email senders dans la DB depuis email_senders.json
 *
 * Usage:
 *   node scripts/init_email_senders.js
 *   node scripts/init_email_senders.js --reset    ← désactive tous les anciens avant d'insérer
 *   node scripts/init_email_senders.js --list     ← affiche les senders actuels en DB
 */

require("dotenv").config();
const { Pool } = require("pg");
const path     = require("path");
const fs       = require("fs");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const SENDERS_FILE = path.resolve(__dirname, "../email_senders.json");
const args         = process.argv.slice(2);
const RESET        = args.includes("--reset");
const LIST_ONLY    = args.includes("--list");

async function list() {
    const r = await pool.query(`
        SELECT email, name, daily_limit, daily_sent,
               (daily_limit - daily_sent) AS remaining_today,
               is_active, total_sent,
               TO_CHAR(last_sent_at, 'DD/MM/YYYY HH24:MI') AS last_sent
        FROM email_senders
        ORDER BY is_active DESC, email ASC
    `);
    if (r.rows.length === 0) {
        console.log("Aucun sender en base.");
        return;
    }
    console.log("\n═══════════════════════════════════════════════════");
    console.log("  EMAIL SENDERS EN BASE");
    console.log("═══════════════════════════════════════════════════");
    r.rows.forEach(s => {
        const status = s.is_active ? "✅ actif" : "❌ inactif";
        console.log(`\n  ${status} — ${s.email}`);
        console.log(`    Nom        : ${s.name}`);
        console.log(`    Limite/jour: ${s.daily_limit}`);
        console.log(`    Envoyés/auj: ${s.daily_sent} (reste: ${s.remaining_today})`);
        console.log(`    Total envoyé: ${s.total_sent}`);
        console.log(`    Dernier envoi: ${s.last_sent || "jamais"}`);
    });
    console.log("\n═══════════════════════════════════════════════════\n");
}

async function init() {
    if (!fs.existsSync(SENDERS_FILE)) {
        console.error(`❌ Fichier introuvable: ${SENDERS_FILE}`);
        process.exit(1);
    }

    let senders;
    try {
        senders = JSON.parse(fs.readFileSync(SENDERS_FILE, "utf8"));
    } catch (e) {
        console.error("❌ Erreur lecture email_senders.json:", e.message);
        process.exit(1);
    }

    if (!Array.isArray(senders) || senders.length === 0) {
        console.error("❌ email_senders.json doit être un tableau non vide");
        process.exit(1);
    }

    console.log(`\n📂 Fichier: ${SENDERS_FILE}`);
    console.log(`📋 ${senders.length} sender(s) trouvé(s)\n`);

    if (RESET) {
        console.log("⚠️  --reset : désactivation de tous les senders existants...");
        await pool.query(`UPDATE email_senders SET is_active = false`);
        console.log("   OK\n");
    }

    let inserted = 0, updated = 0, errors = 0;

    for (const sender of senders) {
        if (!sender.email) {
            console.warn("⚠️  Sender ignoré (pas d'email):", sender);
            errors++;
            continue;
        }

        const name        = sender.name        || "Larry Mbili";
        const daily_limit = sender.daily_limit || 20;

        try {
            const r = await pool.query(`
                INSERT INTO email_senders (email, name, daily_limit, is_active)
                VALUES ($1, $2, $3, true)
                ON CONFLICT (email) DO UPDATE SET
                    name        = EXCLUDED.name,
                    daily_limit = EXCLUDED.daily_limit,
                    is_active   = true
                RETURNING (xmax = 0) AS is_insert
            `, [sender.email, name, daily_limit]);

            if (r.rows[0].is_insert) {
                console.log(`  ✅ Inséré  : ${sender.email} (limite: ${daily_limit}/jour)`);
                inserted++;
            } else {
                console.log(`  🔄 Mis à jour: ${sender.email} (limite: ${daily_limit}/jour)`);
                updated++;
            }
        } catch (e) {
            console.error(`  ❌ Erreur pour ${sender.email}:`, e.message);
            errors++;
        }
    }

    console.log("\n═══════════════════════════════════════════════════");
    console.log(`  RÉSULTATS: ${inserted} insérés · ${updated} mis à jour · ${errors} erreurs`);
    console.log("═══════════════════════════════════════════════════\n");

    // Afficher l'état final
    await list();
}

async function main() {
    try {
        if (LIST_ONLY) {
            await list();
        } else {
            await init();
        }
    } catch (e) {
        console.error("❌ Erreur fatale:", e.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

main();