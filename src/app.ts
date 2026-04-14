import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { env } from "./config/env";
import { loggerConfig } from "./config/logger";
import { prisma } from "./config/db";
import jwtPlugin from "./plugins/jwt.plugin";
import authPlugin from "./plugins/auth.plugin";
import { authRoutes } from "./routes/auth.routes";
import { userRoutes } from "./routes/user.routes";
import { equipmentRoutes } from "./routes/equipment.routes";
import { syncRoutes, transactionRoutes } from "./routes/sync.routes";
import { shootRoutes } from "./routes/shoot.routes";
import { templateRoutes } from "./routes/template.routes";
import { issueRoutes } from "./routes/issue.routes";
import { notificationRoutes } from "./routes/notification.routes";
import { reportRoutes } from "./routes/report.routes";

export async function buildApp() {
  const app = Fastify({ logger: loggerConfig, genReqId: () => crypto.randomUUID() });

  // ── Security headers ───────────────────────────────────────────────────────
  await app.register(helmet, { contentSecurityPolicy: false });

  // ── Multipart (file uploads) ───────────────────────────────────────────────
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB

  // ── CORS ──────────────────────────────────────────────────────────────────
  await app.register(cors, {
    origin: env.CORS_ORIGIN,
    credentials: true,
  });

  // ── Rate limiting (global baseline; tightened per-route on auth) ───────────
  await app.register(rateLimit, {
    max: 200,
    timeWindow: "1 minute",
    errorResponseBuilder: () => ({
      success: false,
      error: "Too many requests. Please slow down.",
      code: "RATE_LIMITED",
    }),
  });

  // ── OpenAPI / Swagger ─────────────────────────────────────────────────────
  await app.register(swagger, {
    openapi: {
      info: {
        title: "Caminet API",
        description: "Equipment Tracking API for 35 Stripes Film & Production",
        version: "1.0.0",
      },
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
          },
        },
      },
    },
  });

  await app.register(swaggerUi, {
    routePrefix: "/api/v1/docs",
    uiConfig: { docExpansion: "list", deepLinking: true },
  });

  // ── Health check ──────────────────────────────────────────────────────────
  app.get(
    "/health",
    {
      schema: {
        tags: ["System"],
        summary: "Health check — verifies API and database connectivity",
        response: {
          200: {
            type: "object",
            properties: {
              status: { type: "string" },
              timestamp: { type: "string" },
              environment: { type: "string" },
              database: { type: "string" },
            },
          },
          503: {
            type: "object",
            properties: {
              status: { type: "string" },
              error: { type: "string" },
            },
          },
        },
      },
    },
    async (_request, reply) => {
      try {
        // Lightweight DB ping — confirms Supabase connection is alive
        await prisma.$queryRaw`SELECT 1`;

        return reply.send({
          status: "ok",
          timestamp: new Date().toISOString(),
          environment: env.NODE_ENV,
          database: "connected",
        });
      } catch (err) {
        app.log.error({ err }, "Health check: database unreachable");
        return reply.status(503).send({
          status: "error",
          error: "Database unreachable",
        });
      }
    }
  );

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  app.addHook("onClose", async () => {
    await prisma.$disconnect();
    app.log.info("Prisma disconnected");
  });

  // ── Auth plugins (must be before routes) ─────────────────────────────────
  await app.register(jwtPlugin);
  await app.register(authPlugin);

  // ── Routes ────────────────────────────────────────────────────────────────
  await app.register(authRoutes,        { prefix: "/api/v1/auth" });
  await app.register(userRoutes,        { prefix: "/api/v1/users" });
  await app.register(equipmentRoutes,   { prefix: "/api/v1/equipment" });
  await app.register(syncRoutes,        { prefix: "/api/v1/sync" });
  await app.register(transactionRoutes, { prefix: "/api/v1/transactions" });
  await app.register(shootRoutes,       { prefix: "/api/v1/shoots" });
  await app.register(templateRoutes,    { prefix: "/api/v1/templates" });
  await app.register(issueRoutes,        { prefix: "/api/v1/issues" });
  await app.register(notificationRoutes, { prefix: "/api/v1/notifications" });
  await app.register(reportRoutes,       { prefix: "/api/v1/reports" });

  return app;
}
