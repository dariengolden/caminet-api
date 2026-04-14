import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { TransactionType } from "@prisma/client";
import { requireRole } from "../middleware/requireRole";
import * as syncService from "../services/sync.service";

export async function syncRoutes(app: FastifyInstance) {
  // ── 6.1 POST /sync/transactions ─────────────────────────────────────────────
  app.post(
    "/transactions",
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ["Sync"],
        summary: "Batch sync offline transactions from the iOS device",
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          required: ["transactions"],
          properties: {
            transactions: {
              type: "array",
              items: {
                type: "object",
                required: ["clientId", "equipmentId", "type", "timestamp"],
                properties: {
                  clientId: { type: "string" },
                  equipmentId: { type: "string" },
                  type: { type: "string", enum: ["CHECK_IN", "CHECK_OUT"] },
                  timestamp: { type: "string" },
                  location: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const body = z.object({
        transactions: z.array(z.object({
          clientId: z.string().uuid(),
          equipmentId: z.string().uuid(),
          type: z.nativeEnum(TransactionType),
          timestamp: z.string().datetime(),
          location: z.string().optional(),
        })),
      }).parse(request.body);

      const results = await syncService.batchSync(request.user.id, body.transactions);
      return reply.send({ success: true, data: { results } });
    }
  );
}

export async function transactionRoutes(app: FastifyInstance) {
  const ADMIN_PIC = requireRole("ADMIN", "PIC");

  // ── 6.2 GET /transactions ───────────────────────────────────────────────────
  app.get(
    "/",
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ["Transactions"],
        summary: "List transactions (CREW sees own only)",
        security: [{ bearerAuth: [] }],
        querystring: {
          type: "object",
          properties: {
            userId: { type: "string" },
            equipmentId: { type: "string" },
            type: { type: "string", enum: Object.values(TransactionType) },
            from: { type: "string" },
            to: { type: "string" },
            page: { type: "integer", default: 1 },
            limit: { type: "integer", default: 20 },
          },
        },
      },
    },
    async (request, reply) => {
      const q = request.query as any;
      const result = await syncService.listTransactions({
        userId: q.userId,
        equipmentId: q.equipmentId,
        type: q.type,
        from: q.from,
        to: q.to,
        page: q.page ?? 1,
        limit: Math.min(q.limit ?? 20, 100),
        requesterId: request.user.id,
        requesterRole: request.user.role,
      });
      return reply.send({ success: true, data: result });
    }
  );

  // ── 6.5 GET /transactions/conflicts ────────────────────────────────────────
  app.get(
    "/conflicts",
    {
      preHandler: [app.authenticate, ADMIN_PIC],
      schema: {
        tags: ["Transactions"],
        summary: "List conflict transactions (ADMIN/PIC only)",
        security: [{ bearerAuth: [] }],
        querystring: {
          type: "object",
          properties: {
            page: { type: "integer", default: 1 },
            limit: { type: "integer", default: 20 },
          },
        },
      },
    },
    async (request, reply) => {
      const q = request.query as any;
      const result = await syncService.listConflicts(q.page ?? 1, Math.min(q.limit ?? 20, 100));
      return reply.send({ success: true, data: result });
    }
  );

  // ── 6.4 GET /transactions/export ────────────────────────────────────────────
  app.get(
    "/export",
    {
      preHandler: [app.authenticate, requireRole("ADMIN")],
      schema: {
        tags: ["Transactions"],
        summary: "Export transactions as CSV (ADMIN only)",
        security: [{ bearerAuth: [] }],
        querystring: {
          type: "object",
          properties: { from: { type: "string" }, to: { type: "string" } },
        },
      },
    },
    async (request, reply) => {
      const q = request.query as any;
      const { items } = await syncService.listTransactions({
        from: q.from,
        to: q.to,
        page: 1,
        limit: 10000,
        requesterId: request.user.id,
        requesterRole: request.user.role,
      });

      const header = "id,type,timestamp,syncStatus,user,equipment,location\n";
      const rows = items.map((t: any) =>
        [t.id, t.type, t.timestamp, t.syncStatus,
         `"${t.user?.name}"`, `"${t.equipment?.name}"`, `"${t.location ?? ""}"`]
          .join(",")
      ).join("\n");

      const date = new Date().toISOString().split("T")[0];
      reply.header("Content-Type", "text/csv");
      reply.header("Content-Disposition", `attachment; filename=transactions-${date}.csv`);
      return reply.send(header + rows);
    }
  );

  // ── 6.3 GET /transactions/:id ───────────────────────────────────────────────
  app.get(
    "/:id",
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ["Transactions"],
        summary: "Get transaction detail",
        security: [{ bearerAuth: [] }],
        params: { type: "object", properties: { id: { type: "string" } } },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        const tx = await syncService.getTransaction(id);
        return reply.send({ success: true, data: tx });
      } catch (err: any) {
        return reply.status(err.statusCode ?? 500).send({ success: false, error: err.message, code: err.code });
      }
    }
  );

  // ── 6.6 PATCH /transactions/:id/resolve-conflict ────────────────────────────
  app.patch(
    "/:id/resolve-conflict",
    {
      preHandler: [app.authenticate, ADMIN_PIC],
      schema: {
        tags: ["Transactions"],
        summary: "Resolve a sync conflict (ADMIN/PIC only)",
        security: [{ bearerAuth: [] }],
        params: { type: "object", properties: { id: { type: "string" } } },
        body: {
          type: "object",
          required: ["conflictNote"],
          properties: { conflictNote: { type: "string" } },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { conflictNote } = z.object({ conflictNote: z.string().min(1) }).parse(request.body);
      const result = await syncService.resolveConflict(id, conflictNote);
      return reply.send({ success: true, data: result });
    }
  );
}
