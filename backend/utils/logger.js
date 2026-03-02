"use strict";
const winston = require("winston");

module.exports = winston.createLogger({
    level: process.env.LOG_LEVEL || "info",
    format: winston.format.combine(
        winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
        winston.format.errors({ stack: true }),
        winston.format.json()
    ),
    transports: [
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.printf(({ timestamp, level, message }) =>
                    `${timestamp} [${level}]: ${message}`)
            )
        }),
        new winston.transports.File({ filename: "/tmp/backend-error.log", level: "error", maxsize: 5e6, maxFiles: 3 }),
        new winston.transports.File({ filename: "/tmp/backend.log", maxsize: 10e6, maxFiles: 5 }),
    ],
});
