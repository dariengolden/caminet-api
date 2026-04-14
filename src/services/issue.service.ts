import { prisma } from "../config/db";
import { IssueStatus, IssueType, EquipmentStatus } from "@prisma/client";
import { notifyAdminsAndPics } from "./notification.service";

// ── List ──────────────────────────────────────────────────────────────────────

export async function listIssues(params: {
  status?: IssueStatus;
  equipmentId?: string;
  from?: string;
  to?: string;
  page: number;
  limit: number;
  requesterId: string;
  requesterRole: string;
}) {
  const { status, equipmentId, from, to, page, limit, requesterId, requesterRole } = params;

  const where: any = {
    ...(status && { status }),
    ...(equipmentId && { equipmentId }),
    ...(from && { createdAt: { gte: new Date(from) } }),
    ...(to && { createdAt: { lte: new Date(to) } }),
  };

  // CREW sees only their own reports
  if (requesterRole === "CREW") {
    where.reportedById = requesterId;
  }

  const [items, total] = await Promise.all([
    prisma.issueReport.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: "desc" },
      select: {
        id: true, issueType: true, description: true, status: true,
        photoUrl: true, createdAt: true, updatedAt: true,
        equipment: { select: { id: true, name: true, category: true } },
        reportedBy: { select: { id: true, name: true } },
      },
    }),
    prisma.issueReport.count({ where }),
  ]);

  return { items, total, page, limit, pages: Math.ceil(total / limit) };
}

// ── Create ────────────────────────────────────────────────────────────────────

export async function createIssue(data: {
  equipmentId: string;
  reportedById: string;
  issueType: IssueType;
  description: string;
  photoUrl?: string;
}) {
  const equipment = await prisma.equipment.findUnique({
    where: { id: data.equipmentId },
    select: { id: true, name: true, isActive: true },
  });
  if (!equipment || !equipment.isActive) {
    throw Object.assign(new Error("Equipment not found."), { statusCode: 404, code: "NOT_FOUND" });
  }

  // Atomically create issue + set equipment status to REPORTED
  const [issue] = await prisma.$transaction([
    prisma.issueReport.create({
      data: {
        equipmentId: data.equipmentId,
        reportedById: data.reportedById,
        issueType: data.issueType,
        description: data.description,
        photoUrl: data.photoUrl,
      },
      select: {
        id: true, issueType: true, description: true, status: true,
        photoUrl: true, createdAt: true,
        equipment: { select: { id: true, name: true } },
        reportedBy: { select: { id: true, name: true } },
      },
    }),
    prisma.equipment.update({
      where: { id: data.equipmentId },
      data: { status: EquipmentStatus.REPORTED },
    }),
  ]);

  // Push notification to all ADMIN + PIC (non-blocking)
  notifyAdminsAndPics(
    "ISSUE_REPORTED",
    `Issue reported on ${equipment.name}: ${data.issueType}`,
    { equipmentId: data.equipmentId, issueId: issue.id }
  ).catch(() => {});

  return issue;
}

// ── Get one ───────────────────────────────────────────────────────────────────

export async function getIssue(id: string) {
  const issue = await prisma.issueReport.findUnique({
    where: { id },
    select: {
      id: true, issueType: true, description: true, status: true,
      photoUrl: true, resolvedNote: true, createdAt: true, updatedAt: true,
      equipment: { select: { id: true, name: true, category: true, status: true } },
      reportedBy: { select: { id: true, name: true, role: true } },
    },
  });
  if (!issue) throw Object.assign(new Error("Issue not found."), { statusCode: 404, code: "NOT_FOUND" });
  return issue;
}

// ── Acknowledge ───────────────────────────────────────────────────────────────

export async function acknowledgeIssue(id: string, setMaintenance: boolean) {
  const updates: any[] = [
    prisma.issueReport.update({
      where: { id },
      data: { status: IssueStatus.ACKNOWLEDGED },
      select: { id: true, status: true, equipmentId: true },
    }),
  ];

  if (setMaintenance) {
    const issue = await prisma.issueReport.findUnique({ where: { id }, select: { equipmentId: true } });
    if (issue) {
      updates.push(
        prisma.equipment.update({
          where: { id: issue.equipmentId },
          data: { status: EquipmentStatus.UNDER_MAINTENANCE },
        })
      );
    }
  }

  const [updated] = await prisma.$transaction(updates);
  return updated;
}

// ── Resolve ───────────────────────────────────────────────────────────────────

export async function resolveIssue(
  id: string,
  resolvedNote: string,
  equipmentStatus: EquipmentStatus
) {
  const issue = await prisma.issueReport.findUnique({ where: { id }, select: { equipmentId: true } });
  if (!issue) throw Object.assign(new Error("Issue not found."), { statusCode: 404, code: "NOT_FOUND" });

  const [updated] = await prisma.$transaction([
    prisma.issueReport.update({
      where: { id },
      data: { status: IssueStatus.RESOLVED, resolvedNote },
      select: { id: true, status: true, resolvedNote: true },
    }),
    prisma.equipment.update({
      where: { id: issue.equipmentId },
      data: {
        status: equipmentStatus,
        ...(equipmentStatus === EquipmentStatus.RETIRED && {
          isActive: false,
          deactivatedAt: new Date(),
        }),
      },
    }),
  ]);

  return updated;
}
