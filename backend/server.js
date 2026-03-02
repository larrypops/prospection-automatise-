"use strict";
require("dotenv").config();
const express    = require("express");
const cors       = require("cors");
const helmet     = require("helmet");
const morgan     = require("morgan");
const rateLimit  = require("express-rate-limit");
const logger     = require("./utils/logger");
const { startDBListener } = require("./services/dbListener");

const app  = express();
const PORT = process.env.PORT || 4000;

// ── Démarrer l'écouteur PostgreSQL pour WhatsApp auto-check ──
startDBListener().catch(err => logger.error("Erreur démarrage listener:", err));

// ── Middlewares ───────────────────────────────────────────
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({
    origin: [
        "https://api.lumoradata.com",
        "https://dashboard.lumoradata.com",
        "http://localhost:3000",
        "http://localhost:3001",
    ],
    credentials: true,
}));
app.use(express.json({ limit: "10mb" }));
app.use(morgan("combined", { stream: { write: m => logger.info(m.trim()) } }));
app.use("/api/", rateLimit({ windowMs: 15 * 60 * 1000, max: 500 }));

// ── Routes ────────────────────────────────────────────────
app.use("/api/companies",  require("./routes/companies"));
app.use("/api/messages",   require("./routes/messages"));
app.use("/api/campaigns",  require("./routes/campaigns"));
app.use("/api/templates",  require("./routes/templates"));
app.use("/api/whatsapp",   require("./routes/whatsapp"));
app.use("/api/scraper",    require("./routes/scraper"));
app.use("/api/stats",      require("./routes/stats"));
app.use("/api/auth",       require("./routes/auth"));
app.use("/api/config",     require("./routes/config"));

// ── Health ────────────────────────────────────────────────
app.get("/health", async (req, res) => {
    const { pool } = require("./utils/db");
    let db = false;
    try { await pool.query("SELECT 1"); db = true; } catch {}
    res.json({ status: db ? "ok" : "degraded", db, uptime: process.uptime(), ts: new Date().toISOString() });
});

// ── 404 / Erreur globale ──────────────────────────────────
app.use((req, res) => res.status(404).json({ error: "Route introuvable" }));
app.use((err, req, res, next) => {
    logger.error(err.message, { stack: err.stack });
    res.status(err.status || 500).json({
        error: process.env.NODE_ENV === "production" ? "Erreur serveur" : err.message
    });
});

app.listen(PORT, "0.0.0.0", () => logger.info(`✅ Backend démarré port ${PORT}`));
process.on("unhandledRejection", r => logger.error("unhandledRejection:", r));
module.exports = app;
