import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ShootStatus } from "@prisma/client";
import { requireRole } from "../middleware/requireRole";
import * as shootService from "../services/shoot.service";

export async function shootRoutes(app: FastifyInstance) {
  const ADMIN_PIC = requireRole("ADMIN", "PIC");
  const ALL_ROLES = requireRole("ADMIN", "PIC", "CREW");

  // ── 7.1 GET /shoots ─────────────────────────────────────────────────────────
  app.get("/", {
    preHandler: [app.authenticate, ALL_ROLES],
    schema: {
      tags: ["Shoots"], summary: "List shoots", security: [{ bearerAuth: [] }],
      querystring: {
        type: "object",
        properties: {
          status: { type: "string", enum: Object.values(ShootStatus) },
          from: { type: "string" }, to: { type: "string" },
          page: { type: "integer", default: 1 }, limit: { type: "integer", default: 20 },
        },
      },
    },
  }, async (request, reply) => {
    const q = request.query as any;
    const result = await shootService.listShoots({
      status: q.status, from: q.from, to: q.to,
      page: q.page ?? 1, limit: Math.min(q.limit ?? 20, 100),
      requesterId: request.user.id, requesterRole: request.user.role,
    });
    return reply.send({ success: true, data: result });
  });

  // ── 7.2 POST /shoots ────────────────────────────────────────────────────────
  app.post("/", {
    preHandler: [app.authenticate, ADMIN_PIC],
    schema: {
      tags: ["Shoots"], summary: "Create a shoot", security: [{ bearerAuth: [] }],
      body: {
        type: "object", required: ["name", "date", "endDate", "location"],
        properties: {
          name: { type: "string" }, date: { type: "string" }, endDate: { type: "string" },
          location: { type: "string" }, templateId: { type: "string" },
        },
      },
    },
  }, async (request, reply) => {
    const body = z.object({
      name: z.string().min(1),
      date: z.string().datetime(),
      endDate: z.string().datetime(),
      location: z.string().min(1),
      templateId: z.string().uuid().optional(),
    }).parse(request.body);

    try {
      const shoot = await shootService.createShoot(body);
      return reply.status(201).send({ success: true, data: shoot });
    } catch (err: any) {
      return reply.status(err.statusCode ?? 500).send({ success: false, error: err.message, code: err.code });
    }
  });

  // ── 7.3 GET /shoots/:id ─────────────────────────────────────────────────────
  app.get("/:id", {
    preHandler: [app.authenticate, ALL_ROLES],
    schema: {
      tags: ["Shoots"], summary: "Get shoot detail", security: [{ bearerAuth: [] }],
      params: { type: "object", properties: { id: { type: "string" } } },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const shoot = await shootService.getShoot(id, request.user.id, request.user.role);
      return reply.send({ success: true, data: shoot });
    } catch (err: any) {
      return reply.status(err.statusCode ?? 500).send({ success: false, error: err.message, code: err.code });
    }
  });

  // ── 7.4 PATCH /shoots/:id ───────────────────────────────────────────────────
  app.patch("/:id", {
    preHandler: [app.authenticate, ADMIN_PIC],
    schema: {
      tags: ["Shoots"], summary: "Update a shoot", security: [{ bearerAuth: [] }],
      params: { type: "object", properties: { id: { type: "string" } } },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z.object({
      name: z.string().min(1).optional(),
      date: z.string().datetime().optional(),
      endDate: z.string().datetime().optional(),
      location: z.string().min(1).optional(),
      status: z.nativeEnum(ShootStatus).optional(),
    }).parse(request.body);

    const shoot = await shootService.updateShoot(id, body);
    return reply.send({ success: true, data: shoot });
  });

  // ── 7.5 DELETE /shoots/:id ──────────────────────────────────────────────────
  app.delete("/:id", {
    preHandler: [app.authenticate, ADMIN_PIC],
    schema: {
      tags: ["Shoots"], summary: "Cancel a shoot", security: [{ bearerAuth: [] }],
      params: { type: "object", properties: { id: { type: "string" } } },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await shootService.cancelShoot(id);
    return reply.send({ success: true, data: result });
  });

  // ── 7.6 POST /shoots/:id/equipment ─────────────────────────────────────────
  app.post("/:id/equipment", {
    preHandler: [app.authenticate, ADMIN_PIC],
    schema: {
      tags: ["Shoots"], summary: "Assign equipment to a shoot", security: [{ bearerAuth: [] }],
      params: { type: "object", properties: { id: { type: "string" } } },
      body: { type: "object", required: ["equipmentId"], properties: { equipmentId: { type: "string" } } },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { equipmentId } = z.object({ equipmentId: z.string().uuid() }).parse(request.body);
    try {
      const result = await shootService.assignEquipment(id, equipmentId);
      return reply.status(201).send({ success: true, data: result });
    } catch (err: any) {
      return reply.status(err.statusCode ?? 500).send({ success: false, error: err.message, code: err.code });
    }
  });

  // ── 7.7 DELETE /shoots/:id/equipment/:equipmentId ───────────────────────────
  app.delete("/:id/equipment/:equipmentId", {
    preHandler: [app.authenticate, ADMIN_PIC],
    schema: {
      tags: ["Shoots"], summary: "Remove equipment from a shoot", security: [{ bearerAuth: [] }],
      params: { type: "object", properties: { id: { type: "string" }, equipmentId: { type: "string" } } },
    },
  }, async (request, reply) => {
    const { id, equipmentId } = request.params as { id: string; equipmentId: string };
    await shootService.removeEquipment(id, equipmentId);
    return reply.send({ success: true, data: { removed: true } });
  });

  // ── 7.8 POST /shoots/:id/crew ───────────────────────────────────────────────
  app.post("/:id/crew", {
    preHandler: [app.authenticate, ADMIN_PIC],
    schema: {
      tags: ["Shoots"], summary: "Assign a crew member to a shoot", security: [{ bearerAuth: [] }],
      params: { type: "object", properties: { id: { type: "string" } } },
      body: { type: "object", required: ["userId"], properties: { userId: { type: "string" } } },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { userId } = z.object({ userId: z.string().uuid() }).parse(request.body);
    try {
      const result = await shootService.assignCrew(id, userId);
      return reply.status(201).send({ success: true, data: result });
    } catch (err: any) {
      return reply.status(err.statusCode ?? 500).send({ success: false, error: err.message, code: err.code });
    }
  });

  // ── 7.9 DELETE /shoots/:id/crew/:userId ────────────────────────────────────
  app.delete("/:id/crew/:userId", {
    preHandler: [app.authenticate, ADMIN_PIC],
    schema: {
      tags: ["Shoots"], summary: "Remove a crew member from a shoot", security: [{ bearerAuth: [] }],
      params: { type: "object", properties: { id: { type: "string" }, userId: { type: "string" } } },
    },
  }, async (request, reply) => {
    const { id, userId } = request.params as { id: string; userId: string };
    await shootService.removeCrew(id, userId);
    return reply.send({ success: true, data: { removed: true } });
  });
}
