import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { EquipmentCategory, EquipmentCondition, EquipmentStatus } from "@prisma/client";
import { requireRole } from "../middleware/requireRole";
import * as equipmentService from "../services/equipment.service";

export async function equipmentRoutes(app: FastifyInstance) {
  const ADMIN_PIC = requireRole("ADMIN", "PIC");
  const ALL_ROLES = requireRole("ADMIN", "PIC", "CREW");

  // ── 5.1 GET /equipment ──────────────────────────────────────────────────────
  app.get(
    "/",
    {
      preHandler: [app.authenticate, ALL_ROLES],
      schema: {
        tags: ["Equipment"],
        summary: "List equipment",
        security: [{ bearerAuth: [] }],
        querystring: {
          type: "object",
          properties: {
            status: { type: "string", enum: Object.values(EquipmentStatus) },
            category: { type: "string", enum: Object.values(EquipmentCategory) },
            search: { type: "string" },
            showRetired: { type: "boolean" },
            page: { type: "integer", default: 1 },
            limit: { type: "integer", default: 20 },
          },
        },
      },
    },
    async (request, reply) => {
      const q = request.query as any;
      const result = await equipmentService.listEquipment({
        status: q.status,
        category: q.category,
        search: q.search,
        showRetired: q.showRetired,
        page: q.page ?? 1,
        limit: Math.min(q.limit ?? 20, 100),
      });
      return reply.send({ success: true, data: result });
    }
  );

  // ── 5.7 POST /equipment/verify-tag ─────────────────────────────────────────
  // Declared before /:id to avoid route conflict
  app.post(
    "/verify-tag",
    {
      preHandler: [app.authenticate, ALL_ROLES],
      schema: {
        tags: ["Equipment"],
        summary: "Cryptographically verify a QR/RFID tag signature",
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          required: ["tagPayload", "signature"],
          properties: {
            tagPayload: { type: "string" },
            signature: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const { tagPayload, signature } = z.object({
        tagPayload: z.string().min(1),
        signature: z.string().min(1),
      }).parse(request.body);

      const result = await equipmentService.verifyTag(tagPayload, signature);
      return reply.send({ success: true, data: result });
    }
  );

  // ── 5.2 POST /equipment ─────────────────────────────────────────────────────
  app.post(
    "/",
    {
      preHandler: [app.authenticate, ADMIN_PIC],
      schema: {
        tags: ["Equipment"],
        summary: "Register new equipment",
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          required: ["name", "category", "condition", "location"],
          properties: {
            name: { type: "string" },
            category: { type: "string", enum: Object.values(EquipmentCategory) },
            condition: { type: "string", enum: Object.values(EquipmentCondition) },
            location: { type: "string" },
            tags: { type: "array", items: { type: "string" } },
            qrCode: { type: "string" },
            rfidTag: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const body = z.object({
        name: z.string().min(1),
        category: z.nativeEnum(EquipmentCategory),
        condition: z.nativeEnum(EquipmentCondition),
        location: z.string().min(1),
        tags: z.array(z.string()).optional(),
        qrCode: z.string().optional(),
        rfidTag: z.string().optional(),
      }).parse(request.body);

      try {
        const item = await equipmentService.createEquipment(body);
        return reply.status(201).send({ success: true, data: item });
      } catch (err: any) {
        return reply.status(err.statusCode ?? 500).send({ success: false, error: err.message, code: err.code });
      }
    }
  );

  // ── 5.3 GET /equipment/:id ──────────────────────────────────────────────────
  app.get(
    "/:id",
    {
      preHandler: [app.authenticate, ALL_ROLES],
      schema: {
        tags: ["Equipment"],
        summary: "Get equipment detail",
        security: [{ bearerAuth: [] }],
        params: { type: "object", properties: { id: { type: "string" } } },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        const item = await equipmentService.getEquipment(id);
        return reply.send({ success: true, data: item });
      } catch (err: any) {
        return reply.status(err.statusCode ?? 500).send({ success: false, error: err.message, code: err.code });
      }
    }
  );

  // ── 5.4 PATCH /equipment/:id ────────────────────────────────────────────────
  app.patch(
    "/:id",
    {
      preHandler: [app.authenticate, ADMIN_PIC],
      schema: {
        tags: ["Equipment"],
        summary: "Update equipment fields",
        security: [{ bearerAuth: [] }],
        params: { type: "object", properties: { id: { type: "string" } } },
        body: {
          type: "object",
          properties: {
            name: { type: "string" },
            category: { type: "string", enum: Object.values(EquipmentCategory) },
            condition: { type: "string", enum: Object.values(EquipmentCondition) },
            location: { type: "string" },
            tags: { type: "array", items: { type: "string" } },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = z.object({
        name: z.string().min(1).optional(),
        category: z.nativeEnum(EquipmentCategory).optional(),
        condition: z.nativeEnum(EquipmentCondition).optional(),
        location: z.string().min(1).optional(),
        tags: z.array(z.string()).optional(),
      }).parse(request.body);

      const item = await equipmentService.updateEquipment(id, body);
      return reply.send({ success: true, data: item });
    }
  );

  // ── 5.5 PATCH /equipment/:id/status ────────────────────────────────────────
  app.patch(
    "/:id/status",
    {
      preHandler: [app.authenticate, ADMIN_PIC],
      schema: {
        tags: ["Equipment"],
        summary: "Update equipment status (with business rule enforcement)",
        security: [{ bearerAuth: [] }],
        params: { type: "object", properties: { id: { type: "string" } } },
        body: {
          type: "object",
          required: ["status"],
          properties: { status: { type: "string", enum: Object.values(EquipmentStatus) } },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { status } = z.object({ status: z.nativeEnum(EquipmentStatus) }).parse(request.body);

      try {
        const result = await equipmentService.updateEquipmentStatus(id, status);
        return reply.send({ success: true, data: result });
      } catch (err: any) {
        return reply.status(err.statusCode ?? 500).send({ success: false, error: err.message, code: err.code });
      }
    }
  );

  // ── 5.6 PATCH /equipment/:id/deactivate ────────────────────────────────────
  app.patch(
    "/:id/deactivate",
    {
      preHandler: [app.authenticate, ADMIN_PIC],
      schema: {
        tags: ["Equipment"],
        summary: "Soft-delete equipment",
        security: [{ bearerAuth: [] }],
        params: { type: "object", properties: { id: { type: "string" } } },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        const result = await equipmentService.deactivateEquipment(id);
        return reply.send({ success: true, data: result });
      } catch (err: any) {
        return reply.status(err.statusCode ?? 500).send({ success: false, error: err.message, code: err.code });
      }
    }
  );
}
