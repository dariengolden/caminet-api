import type { FastifyInstance } from "fastify";
import { requireRole } from "../middleware/requireRole";
import * as reportService from "../services/report.service";

export async function reportRoutes(app: FastifyInstance) {
  const ADMIN = requireRole("ADMIN");
  const ADMIN_PIC = requireRole("ADMIN", "PIC");

  const dateQuery = {
    type: "object",
    properties: { from: { type: "string" }, to: { type: "string" } },
  };

  // ── 11.1 GET /reports/usage ─────────────────────────────────────────────────
  app.get("/usage", {
    preHandler: [app.authenticate, ADMIN_PIC],
    schema: {
      tags: ["Reports"], summary: "Equipment usage report (check-in/out counts)",
      security: [{ bearerAuth: [] }], querystring: dateQuery,
    },
  }, async (request, reply) => {
    const { from, to } = request.query as any;
    const data = await reportService.usageReport(from, to);
    return reply.send({ success: true, data });
  });

  // ── 11.4 GET /reports/usage/export ─────────────────────────────────────────
  app.get("/usage/export", {
    preHandler: [app.authenticate, ADMIN],
    schema: {
      tags: ["Reports"], summary: "Export usage report as CSV (ADMIN only)",
      security: [{ bearerAuth: [] }], querystring: dateQuery,
    },
  }, async (request, reply) => {
    const { from, to } = request.query as any;
    const { rows } = await reportService.usageReport(from, to);

    const header = "equipment,category,checkOuts,checkIns\n";
    const csv = rows.map((r: any) =>
      `"${r.equipment?.name ?? ""}","${r.equipment?.category ?? ""}",${r.checkOuts},${r.checkIns}`
    ).join("\n");

    const date = new Date().toISOString().split("T")[0];
    reply.header("Content-Type", "text/csv");
    reply.header("Content-Disposition", `attachment; filename=usage-report-${date}.csv`);
    return reply.send(header + csv);
  });

  // ── 11.2 GET /reports/availability ─────────────────────────────────────────
  app.get("/availability", {
    preHandler: [app.authenticate, ADMIN_PIC],
    schema: {
      tags: ["Reports"],
      summary: "Availability snapshot — counts by status and currently checked-out items",
      security: [{ bearerAuth: [] }],
    },
  }, async (_request, reply) => {
    const data = await reportService.availabilityReport();
    return reply.send({ success: true, data });
  });

  // ── 11.3 GET /reports/accountability ───────────────────────────────────────
  app.get("/accountability", {
    preHandler: [app.authenticate, ADMIN_PIC],
    schema: {
      tags: ["Reports"],
      summary: "Per-user check-out/in summary and currently holding count",
      security: [{ bearerAuth: [] }], querystring: dateQuery,
    },
  }, async (request, reply) => {
    const { from, to } = request.query as any;
    const data = await reportService.accountabilityReport(from, to);
    return reply.send({ success: true, data });
  });
}
