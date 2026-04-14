import { PrismaClient } from "@prisma/client";
import { env } from "./env";

// Single PrismaClient instance shared across the app (connection pool)
export const prisma = new PrismaClient({
  log:
    env.NODE_ENV === "development"
      ? [
          { emit: "event", level: "query" },
          { emit: "event", level: "warn" },
          { emit: "event", level: "error" },
        ]
      : [
          { emit: "event", level: "warn" },
          { emit: "event", level: "error" },
        ],
});

// Forward Prisma logs into the Node process so they surface in Pino output
if (env.NODE_ENV === "development") {
  prisma.$on("query", (e) => {
    // Only log slow queries in development to avoid noise
    if (e.duration > 100) {
      console.warn(`[Prisma slow query ${e.duration}ms] ${e.query}`);
    }
  });
}

prisma.$on("warn", (e) => console.warn("[Prisma warn]", e.message));
prisma.$on("error", (e) => console.error("[Prisma error]", e.message));
