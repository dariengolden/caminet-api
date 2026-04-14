import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { IssueStatus, IssueType, EquipmentStatus } from "@prisma/client";
import { requireRole } from "../middleware/requireRole";
import * as issueService from "../services/issue.service";
import { uploadIssuePhoto } from "../utils/cloudinary";

export async function issueRoutes(app: FastifyInstance) {
  const ADMIN_PIC = requireRole("ADMIN", "PIC");
  const ALL_ROLES = requireRole("ADMIN", "PIC", "CREW");

  // ── 9.1 GET /issues ─────────────────────────────────────────────────────────
  app.get("/", {
    preHandler: [app.authenticate, ALL_ROLES],
    schema: {
      tags: ["Issues"], summary: "List issue reports", security: [{ bearerAuth: [] }],
      querystring: {
        type: "object",
        properties: {
          status: { type: "string", enum: Object.values(IssueStatus) },
          equipmentId: { type: "string" },
          from: { type: "string" }, to: { type: "string" },
          page: { type: "integer", default: 1 }, limit: { type: "integer", default: 20 },
        },
      },
    },
  }, async (request, reply) => {
    const q = request.query as any;
    const result = await issueService.listIssues({
      status: q.status, equipmentId: q.equipmentId,
      from: q.from, to: q.to,
      page: q.page ?? 1, limit: Math.min(q.limit ?? 20, 100),
      requesterId: request.user.id, requesterRole: request.user.role,
    });
    return reply.send({ success: true, data: result });
  });

  // ── 9.2 POST /issues ────────────────────────────────────────────────────────
  // Accepts multipart/form-data for optional photo upload
  app.post("/", {
    preHandler: [app.authenticate, ALL_ROLES],
    schema: {
      tags: ["Issues"],
      summary: "Submit an issue report (multipart — include photo field for optional image)",
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    let equipmentId: string;
    let issueType: IssueType;
    let description: string;
    let photoUrl: string | undefined;

    // Handle both multipart (with photo) and plain JSON
    const contentType = request.headers["content-type"] ?? "";

    if (contentType.includes("multipart")) {
      const parts = (request as any).parts();
      const fields: Record<string, string> = {};

      for await (const part of parts) {
        if (part.type === "file" && part.fieldname === "photo") {
          const chunks: Buffer[] = [];
          for await (const chunk of part.file) chunks.push(chunk);
          const buffer = Buffer.concat(chunks);
          if (buffer.length > 0) {
            const filename = `issue-${Date.now()}`;
            photoUrl = await uploadIssuePhoto(buffer, filename);
          }
        } else if (part.type === "field") {
          fields[part.fieldname] = part.value as string;
        }
      }

      equipmentId = fields.equipmentId;
      issueType = fields.issueType as IssueType;
      description = fields.description;
    } else {
      const body = z.object({
        equipmentId: z.string().uuid(),
        issueType: z.nativeEnum(IssueType),
        description: z.string().min(10),
      }).parse(request.body);

      equipmentId = body.equipmentId;
      issueType = body.issueType;
      description = body.description;
    }

    // Validate parsed fields
    const parsed = z.object({
      equipmentId: z.string().uuid(),
      issueType: z.nativeEnum(IssueType),
      description: z.string().min(10),
    }).parse({ equipmentId, issueType, description });

    try {
      const issue = await issueService.createIssue({
        ...parsed,
        reportedById: request.user.id,
        photoUrl,
      });
      return reply.status(201).send({ success: true, data: issue });
    } catch (err: any) {
      return reply.status(err.statusCode ?? 500).send({ success: false, error: err.message, code: err.code });
    }
  });

  // ── 9.3 GET /issues/:id ─────────────────────────────────────────────────────
  app.get("/:id", {
    preHandler: [app.authenticate, ALL_ROLES],
    schema: {
      tags: ["Issues"], summary: "Get issue detail", security: [{ bearerAuth: [] }],
      params: { type: "object", properties: { id: { type: "string" } } },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const issue = await issueService.getIssue(id);
      return reply.send({ success: true, data: issue });
    } catch (err: any) {
      return reply.status(err.statusCode ?? 500).send({ success: false, error: err.message, code: err.code });
    }
  });

  // ── 9.4 PATCH /issues/:id/acknowledge ──────────────────────────────────────
  app.patch("/:id/acknowledge", {
    preHandler: [app.authenticate, ADMIN_PIC],
    schema: {
      tags: ["Issues"], summary: "Acknowledge an issue (ADMIN/PIC only)", security: [{ bearerAuth: [] }],
      params: { type: "object", properties: { id: { type: "string" } } },
      body: {
        type: "object",
        properties: { setMaintenance: { type: "boolean", default: false } },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { setMaintenance } = z.object({
      setMaintenance: z.boolean().default(false),
    }).parse(request.body ?? {});

    const result = await issueService.acknowledgeIssue(id, setMaintenance);
    return reply.send({ success: true, data: result });
  });

  // ── 9.5 PATCH /issues/:id/resolve ──────────────────────────────────────────
  app.patch("/:id/resolve", {
    preHandler: [app.authenticate, ADMIN_PIC],
    schema: {
      tags: ["Issues"], summary: "Resolve an issue (ADMIN/PIC only)", security: [{ bearerAuth: [] }],
      params: { type: "object", properties: { id: { type: "string" } } },
      body: {
        type: "object",
        required: ["resolvedNote", "equipmentStatus"],
        properties: {
          resolvedNote: { type: "string" },
          equipmentStatus: {
            type: "string",
            enum: [EquipmentStatus.AVAILABLE, EquipmentStatus.RETIRED, EquipmentStatus.UNDER_MAINTENANCE],
          },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z.object({
      resolvedNote: z.string().min(1),
      equipmentStatus: z.enum([
        EquipmentStatus.AVAILABLE,
        EquipmentStatus.RETIRED,
        EquipmentStatus.UNDER_MAINTENANCE,
      ]),
    }).parse(request.body);

    try {
      const result = await issueService.resolveIssue(id, body.resolvedNote, body.equipmentStatus);
      return reply.send({ success: true, data: result });
    } catch (err: any) {
      return reply.status(err.statusCode ?? 500).send({ success: false, error: err.message, code: err.code });
    }
  });
}
