import type { FastifyInstance } from "fastify";
import * as notifService from "../services/notification.service";

export async function notificationRoutes(app: FastifyInstance) {
  // ── 10.1 GET /notifications ─────────────────────────────────────────────────
  app.get("/", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["Notifications"], summary: "List notifications for the authenticated user",
      security: [{ bearerAuth: [] }],
      querystring: {
        type: "object",
        properties: {
          isRead: { type: "boolean" },
          page: { type: "integer", default: 1 },
          limit: { type: "integer", default: 20 },
        },
      },
    },
  }, async (request, reply) => {
    const q = request.query as any;
    const result = await notifService.listNotifications(
      request.user.id,
      q.isRead,
      q.page ?? 1,
      Math.min(q.limit ?? 20, 100)
    );
    return reply.send({ success: true, data: result });
  });

  // ── 10.3 PATCH /notifications/read-all ─────────────────────────────────────
  // Declared before /:id to avoid conflict
  app.patch("/read-all", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["Notifications"], summary: "Mark all notifications as read",
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    await notifService.markAllRead(request.user.id);
    return reply.send({ success: true, data: { marked: true } });
  });

  // ── 10.2 PATCH /notifications/:id/read ─────────────────────────────────────
  app.patch("/:id/read", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["Notifications"], summary: "Mark a single notification as read",
      security: [{ bearerAuth: [] }],
      params: { type: "object", properties: { id: { type: "string" } } },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await notifService.markRead(id, request.user.id);
    return reply.send({ success: true, data: { marked: true } });
  });
}
