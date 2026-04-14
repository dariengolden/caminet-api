import { prisma } from "../config/db";
import { verifyHmac } from "../utils/crypto";
import { EquipmentCategory, EquipmentCondition, EquipmentStatus } from "@prisma/client";

// ── List ──────────────────────────────────────────────────────────────────────

export async function listEquipment(params: {
  status?: EquipmentStatus;
  category?: EquipmentCategory;
  search?: string;
  showRetired?: boolean;
  page: number;
  limit: number;
}) {
  const { status, category, search, showRetired, page, limit } = params;
  const where: any = {
    isActive: true,
    ...(status && { status }),
    ...(category && { category }),
    ...(!showRetired && { status: { not: EquipmentStatus.RETIRED } }),
    ...(search && { name: { contains: search, mode: "insensitive" } }),
  };

  // status filter overrides the not-RETIRED guard when explicitly requested
  if (status) where.status = status;

  const [items, total] = await Promise.all([
    prisma.equipment.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: "desc" },
      select: {
        id: true, name: true, category: true, status: true, condition: true,
        qrCode: true, rfidTag: true, location: true, tags: true,
        lastCheckedBy: { select: { name: true } },
        createdAt: true,
      },
    }),
    prisma.equipment.count({ where }),
  ]);

  return { items, total, page, limit, pages: Math.ceil(total / limit) };
}

// ── Create ────────────────────────────────────────────────────────────────────

export async function createEquipment(data: {
  name: string;
  category: EquipmentCategory;
  condition: EquipmentCondition;
  location: string;
  tags?: string[];
  qrCode?: string;
  rfidTag?: string;
}) {
  return prisma.equipment.create({
    data: {
      name: data.name,
      category: data.category,
      condition: data.condition,
      location: data.location,
      tags: data.tags ?? [],
      qrCode: data.qrCode,
      rfidTag: data.rfidTag,
    },
    select: {
      id: true, name: true, category: true, status: true, condition: true,
      qrCode: true, rfidTag: true, location: true, tags: true, createdAt: true,
    },
  });
}

// ── Get one ───────────────────────────────────────────────────────────────────

export async function getEquipment(id: string) {
  const item = await prisma.equipment.findUnique({
    where: { id },
    select: {
      id: true, name: true, category: true, status: true, condition: true,
      qrCode: true, rfidTag: true, location: true, tags: true, isActive: true,
      lastCheckedBy: { select: { id: true, name: true } },
      createdAt: true,
      transactions: {
        orderBy: { timestamp: "desc" },
        take: 1,
        select: { type: true, timestamp: true, user: { select: { name: true } } },
      },
      issueReports: {
        where: { status: { not: "RESOLVED" } },
        select: { id: true },
      },
    },
  });

  if (!item) throw Object.assign(new Error("Equipment not found."), { statusCode: 404, code: "NOT_FOUND" });

  return {
    ...item,
    lastTransaction: item.transactions[0] ?? null,
    openIssueCount: item.issueReports.length,
    transactions: undefined,
    issueReports: undefined,
  };
}

// ── Update ────────────────────────────────────────────────────────────────────

export async function updateEquipment(
  id: string,
  data: {
    name?: string;
    category?: EquipmentCategory;
    condition?: EquipmentCondition;
    location?: string;
    tags?: string[];
  }
) {
  return prisma.equipment.update({
    where: { id },
    data,
    select: {
      id: true, name: true, category: true, status: true, condition: true,
      location: true, tags: true,
    },
  });
}

// ── Status update ─────────────────────────────────────────────────────────────

export async function updateEquipmentStatus(id: string, newStatus: EquipmentStatus) {
  const item = await prisma.equipment.findUnique({
    where: { id },
    select: { status: true },
  });
  if (!item) throw Object.assign(new Error("Equipment not found."), { statusCode: 404, code: "NOT_FOUND" });

  // Business rules when setting back to AVAILABLE
  if (newStatus === EquipmentStatus.AVAILABLE) {
    // Cannot set AVAILABLE if assigned to an IN_PROGRESS shoot
    const activeShoot = await prisma.shootEquipment.findFirst({
      where: {
        equipmentId: id,
        shoot: { status: "IN_PROGRESS" },
      },
    });
    if (activeShoot) {
      throw Object.assign(
        new Error("Cannot mark available — equipment is assigned to an in-progress shoot."),
        { statusCode: 409, code: "SHOOT_CONFLICT" }
      );
    }

    // Cannot set AVAILABLE if still checked out
    const lastTx = await prisma.transaction.findFirst({
      where: { equipmentId: id },
      orderBy: { timestamp: "desc" },
    });
    if (lastTx?.type === "CHECK_OUT") {
      throw Object.assign(
        new Error("Cannot mark available — equipment is still checked out."),
        { statusCode: 409, code: "CHECKED_OUT" }
      );
    }
  }

  const updated = await prisma.equipment.update({
    where: { id },
    data: {
      status: newStatus,
      // Soft-delete on RETIRED
      ...(newStatus === EquipmentStatus.RETIRED && {
        isActive: false,
        deactivatedAt: new Date(),
      }),
    },
    select: { id: true, status: true, isActive: true },
  });

  return updated;
}

// ── Deactivate ────────────────────────────────────────────────────────────────

export async function deactivateEquipment(id: string) {
  const lastTx = await prisma.transaction.findFirst({
    where: { equipmentId: id },
    orderBy: { timestamp: "desc" },
  });
  if (lastTx?.type === "CHECK_OUT") {
    throw Object.assign(
      new Error("Cannot deactivate — equipment is currently checked out."),
      { statusCode: 409, code: "CHECKED_OUT" }
    );
  }

  return prisma.equipment.update({
    where: { id },
    data: { isActive: false, deactivatedAt: new Date(), status: EquipmentStatus.RETIRED },
    select: { id: true, isActive: true, deactivatedAt: true },
  });
}

// ── Tag verification ──────────────────────────────────────────────────────────

export async function verifyTag(tagPayload: string, signature: string) {
  const valid = verifyHmac(tagPayload, signature);
  if (!valid) return { valid: false };

  // Try to find equipment by qrCode or rfidTag matching the payload
  const equipment = await prisma.equipment.findFirst({
    where: { OR: [{ qrCode: tagPayload }, { rfidTag: tagPayload }], isActive: true },
    select: { id: true, name: true, status: true },
  });

  return { valid: true, equipment: equipment ?? null };
}
