"use strict";
const { Pool } = require("pg");
const logger   = require("./logger");

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});

pool.on("error", err => logger.error("PG pool error:", err));

async function query(text, params) {
    const t = Date.now();
    try {
        const r = await pool.query(text, params);
        const d = Date.now() - t;
        if (d > 1000) logger.warn(`Slow query ${d}ms: ${text.slice(0,80)}`);
        return r;
    } catch (e) {
        logger.error(`DB Error: ${e.message} | ${text.slice(0,100)}`);
        throw e;
    }
}

async function withTransaction(fn) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const r = await fn(client);
        await client.query("COMMIT");
        return r;
    } catch (e) {
        await client.query("ROLLBACK");
        throw e;
    } finally {
        client.release();
    }
}

module.exports = { pool, query, withTransaction };
