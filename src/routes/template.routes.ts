import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireRole } from "../middleware/requireRole";
import * as templateService from "../services/template.service";

export async function templateRoutes(app: FastifyInstance) {
  const ADMIN_PIC = requireRole("ADMIN", "PIC");

  // ── 8.1 GET /templates ──────────────────────────────────────────────────────
  app.get("/", {
    preHandler: [app.authenticate, ADMIN_PIC],
    schema: { tags: ["Templates"], summary: "List all templates", security: [{ bearerAuth: [] }] },
  }, async (_request, reply) => {
    const templates = await templateService.listTemplates();
    return reply.send({ success: true, data: templates });
  });

  // ── 8.2 POST /templates ─────────────────────────────────────────────────────
  app.post("/", {
    preHandler: [app.authenticate, ADMIN_PIC],
    schema: {
      tags: ["Templates"], summary: "Create an event template", security: [{ bearerAuth: [] }],
      body: {
        type: "object", required: ["name", "equipmentIds"],
        properties: {
          name: { type: "string" }, description: { type: "string" },
          equipmentIds: { type: "array", items: { type: "string" } },
        },
      },
    },
  }, async (request, reply) => {
    const body = z.object({
      name: z.string().min(1),
      description: z.string().optional(),
      equipmentIds: z.array(z.string().uuid()).min(1),
    }).parse(request.body);

    try {
      const template = await templateService.createTemplate({ ...body, createdById: request.user.id });
      return reply.status(201).send({ success: true, data: template });
    } catch (err: any) {
      return reply.status(err.statusCode ?? 500).send({ success: false, error: err.message, code: err.code });
    }
  });

  // ── 8.3 GET /templates/:id ──────────────────────────────────────────────────
  app.get("/:id", {
    preHandler: [app.authenticate, ADMIN_PIC],
    schema: {
      tags: ["Templates"], summary: "Get template detail", security: [{ bearerAuth: [] }],
      params: { type: "object", properties: { id: { type: "string" } } },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const template = await templateService.getTemplate(id);
      return reply.send({ success: true, data: template });
    } catch (err: any) {
      return reply.status(err.statusCode ?? 500).send({ success: false, error: err.message, code: err.code });
    }
  });

  // ── 8.4 PATCH /templates/:id ────────────────────────────────────────────────
  app.patch("/:id", {
    preHandler: [app.authenticate, ADMIN_PIC],
    schema: {
      tags: ["Templates"], summary: "Update a template", security: [{ bearerAuth: [] }],
      params: { type: "object", properties: { id: { type: "string" } } },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z.object({
      name: z.string().min(1).optional(),
      description: z.string().optional(),
      equipmentIds: z.array(z.string().uuid()).optional(),
    }).parse(request.body);

    try {
      const template = await templateService.updateTemplate(id, body);
      return reply.send({ success: true, data: template });
    } catch (err: any) {
      return reply.status(err.statusCode ?? 500).send({ success: false, error: err.message, code: err.code });
    }
  });

  // ── 8.5 DELETE /templates/:id ───────────────────────────────────────────────
  app.delete("/:id", {
    preHandler: [app.authenticate, ADMIN_PIC],
    schema: {
      tags: ["Templates"], summary: "Delete a template (rejected if used by future shoots)",
      security: [{ bearerAuth: [] }],
      params: { type: "object", properties: { id: { type: "string" } } },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      await templateService.deleteTemplate(id);
      return reply.send({ success: true, data: { deleted: true } });
    } catch (err: any) {
      return reply.status(err.statusCode ?? 500).send({
        success: false, error: err.message, code: err.code,
        ...(err.data && { data: err.data }),
      });
    }
  });
}
