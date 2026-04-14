import type { FastifyLoggerOptions } from "fastify";
import type { PinoLoggerOptions } from "fastify/types/logger";
import { env } from "./env";

// Fields that must never appear in logs — tokens, credentials, secrets
const REDACTED_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "req.body.password",
  "req.body.passwordHash",
  "req.body.mfaSecret",
  "req.body.code",           // MFA codes
  "req.body.refreshToken",
  "res.headers['set-cookie']",
  "*.password",
  "*.passwordHash",
  "*.mfaSecret",
  "*.refreshToken",
  "*.accessToken",
];

const developmentLogger: FastifyLoggerOptions & PinoLoggerOptions = {
  transport: {
    target: "pino-pretty",
    options: {
      colorize: true,
      translateTime: "HH:MM:ss",
      ignore: "pid,hostname",
    },
  },
  redact: { paths: REDACTED_PATHS, censor: "[REDACTED]" },
  level: "debug",
};

const productionLogger: FastifyLoggerOptions & PinoLoggerOptions = {
  // JSON output — structured for log aggregation (Render, Datadog, etc.)
  redact: { paths: REDACTED_PATHS, censor: "[REDACTED]" },
  level: "info",
  // Include request id in every log line for traceability
  serializers: {
    req(request) {
      return {
        method: request.method,
        url: request.url,
        hostname: request.hostname,
        remoteAddress: request.ip,
        // Do not log full headers in production — may contain auth tokens
      };
    },
    res(reply) {
      return {
        statusCode: reply.statusCode,
      };
    },
  },
};

const testLogger = false as const; // silent during tests

export const loggerConfig =
  env.NODE_ENV === "production"
    ? productionLogger
    : env.NODE_ENV === "test"
    ? testLogger
    : developmentLogger;
