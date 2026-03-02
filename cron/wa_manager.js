#!/usr/bin/env node
/**
 * WhatsApp Manager Cron — lumoradata.com
 * Reset compteurs journaliers + vérification sessions WAHA (port 3005)
 * Cron : 0 0 * * * node /opt/prospection-lumora/cron/wa_manager.js
 */
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const { Pool } = require("pg");
const axios    = require("axios");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
// WAHA accessible depuis l'hôte sur le port 3005
const WAHA_URL = `http://127.0.0.1:${process.env.WAHA_PORT || 3005}`;
const API_KEY  = process.env.WAHA_API_KEY || "";

async function resetDailyCounters() {
    console.log("[CRON] Reset compteurs journaliers...");
    const r = await pool.query(`
        UPDATE whatsapp_numbers SET
            daily_sent     = 0,
            daily_reset_at = CURRENT_DATE,
            warmup_day     = warmup_day + 1,
            daily_limit    = CASE
                WHEN warmup_day + 1 >= 31 THEN 300
                WHEN warmup_day + 1 >= 22 THEN 150
                WHEN warmup_day + 1 >= 15 THEN 80
                WHEN warmup_day + 1 >= 8  THEN 40
                ELSE 20
            END
        WHERE daily_reset_at < CURRENT_DATE AND is_active = true
        RETURNING session_name, warmup_day, daily_limit
    `);
    for (const row of r.rows)
        console.log(`  ✅ ${row.session_name} → jour ${row.warmup_day}, limite ${row.daily_limit}/j`);
    console.log(`  ${r.rowCount} numéro(s) réinitialisé(s)`);
}

async function checkSessions() {
    console.log("[CRON] Vérification sessions WAHA...");
    const { rows } = await pool.query("SELECT * FROM whatsapp_numbers WHERE is_active=true");
    for (const n of rows) {
        try {
            const res = await axios.get(`${WAHA_URL}/api/sessions/${n.session_name}`,
                { headers: { "X-Api-Key": API_KEY }, timeout: 10000 });
            const status = res.data?.status;
            await pool.query(`UPDATE whatsapp_numbers SET last_status=$1, is_banned=$2, updated_at=NOW() WHERE session_name=$3`,
                [status, status==="BANNED"||status==="STOPPED", n.session_name]);
            const icon = status==="WORKING" ? "✅" : "⚠️";
            console.log(`  ${icon} ${n.session_name} (${n.number}): ${status}`);
        } catch (e) {
            console.warn(`  ❓ ${n.session_name}: ${e.message}`);
        }
    }
}

async function initDailyStats() {
    await pool.query("INSERT INTO daily_stats (date) VALUES (CURRENT_DATE) ON CONFLICT DO NOTHING");
    console.log("[CRON] Stats du jour initialisées");
}

(async () => {
    console.log(`\n=== WA Manager — ${new Date().toISOString()} ===`);
    try {
        await resetDailyCounters();
        await checkSessions();
        await initDailyStats();
        console.log("✅ Maintenance terminée\n");
    } catch (e) {
        console.error("❌ Erreur:", e);
        process.exit(1);
    } finally {
        await pool.end();
    }
})();
