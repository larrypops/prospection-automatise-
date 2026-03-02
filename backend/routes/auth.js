"use strict";
const express = require("express");
const jwt     = require("jsonwebtoken");
const bcrypt  = require("bcryptjs");
const router  = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || "secret";
// Générer un nouveau hash : node -e "require('bcryptjs').hash('VotreMotDePasse',10).then(console.log)"
const DEFAULT_HASH = "$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi"; // "password"

router.post("/login", async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password)
        return res.status(400).json({ error: "username et password requis" });
    if (username !== (process.env.ADMIN_USER || "admin"))
        return res.status(401).json({ error: "Identifiants invalides" });
    const hash = process.env.ADMIN_HASH || DEFAULT_HASH;
    const valid = await bcrypt.compare(password, hash);
    if (!valid) return res.status(401).json({ error: "Identifiants invalides" });
    const token = jwt.sign({ username, role: "admin" }, JWT_SECRET, { expiresIn: "24h" });
    res.json({ token, username, role: "admin" });
});

router.get("/me", (req, res) => {
    const h = req.headers.authorization;
    if (!h?.startsWith("Bearer ")) return res.status(401).json({ error: "Non authentifié" });
    try { res.json(jwt.verify(h.split(" ")[1], JWT_SECRET)); }
    catch { res.status(401).json({ error: "Token invalide ou expiré" }); }
});

module.exports = router;
