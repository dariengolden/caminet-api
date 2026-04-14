import { prisma } from "../config/db";
import { verifyHmac } from "../utils/crypto";
import { EquipmentStatus, SyncStatus, TransactionType } from "@prisma/client";
import { notifyAdminsAndPics } from "./notification.service";

interface SyncItem {
  clientId: string;
  equipmentId: string;
  type: TransactionType;
  timestamp: string;
  location?: string;
}

export async function batchSync(userId: string, items: SyncItem[]) {
  const results: Array<{ clientId: string; status: "synced" | "conflict"; conflictNote?: string }> = [];

  for (const item of items) {
    // 1. Idempotency — already synced
    const existing = await prisma.transaction.findUnique({ where: { clientId: item.clientId } });
    if (existing) {
      results.push({ clientId: item.clientId, status: existing.syncStatus === SyncStatus.CONFLICT ? "conflict" : "synced" });
      continue;
    }

    // 2. Verify equipment exists
    const equipment = await prisma.equipment.findUnique({ where: { id: item.equipmentId } });
    if (!equipment) {
      results.push({ clientId: item.clientId, status: "conflict", conflictNote: "Equipment not found." });
      continue;
    }

    // 3. Order enforcement — no double check-out
    const lastTx = await prisma.transaction.findFirst({
      where: { equipmentId: item.equipmentId },
      orderBy: { timestamp: "desc" },
    });

    let syncStatus: SyncStatus = SyncStatus.SYNCED;
    let conflictNote: string | undefined;

    if (item.type === TransactionType.CHECK_OUT && lastTx?.type === TransactionType.CHECK_OUT) {
      syncStatus = SyncStatus.CONFLICT;
      conflictNote = "Double check-out detected — equipment already checked out.";
    }

    if (item.type === TransactionType.CHECK_IN && (!lastTx || lastTx.type === TransactionType.CHECK_IN)) {
      syncStatus = SyncStatus.CONFLICT;
      conflictNote = "Check-in without a prior check-out.";
    }

    // 4. Atomic: insert transaction + update equipment status
    const newStatus =
      item.type === TransactionType.CHECK_OUT ? EquipmentStatus.IN_USE : EquipmentStatus.AVAILABLE;

    await prisma.$transaction([
      prisma.transaction.create({
        data: {
          clientId: item.clientId,
          userId,
          equipmentId: item.equipmentId,
          type: item.type,
          timestamp: new Date(item.timestamp),
          syncStatus,
          location: item.location,
          conflictNote,
        },
      }),
      // Only update status if not a conflict
      ...(syncStatus === SyncStatus.SYNCED
        ? [prisma.equipment.update({
            where: { id: item.equipmentId },
            data: { status: newStatus, lastCheckedById: userId },
          })]
        : []),
    ]);

    // 5. Notify admins on conflict
    if (syncStatus === SyncStatus.CONFLICT) {
      notifyAdminsAndPics(
        "SYNC_CONFLICT",
        `Sync conflict on ${equipment.name}: ${conflictNote}`
      ).catch(() => {});
    }

    results.push({ clientId: item.clientId, status: syncStatus === SyncStatus.CONFLICT ? "conflict" : "synced", conflictNote });
  }

  return results;
}

export async function listTransactions(params: {
  userId?: string;
  equipmentId?: string;
  type?: TransactionType;
  from?: string;
  to?: string;
  page: number;
  limit: number;
  requesterId: string;
  requesterRole: string;
}) {
  const { requesterId, requesterRole, page, limit } = params;

  const where: any = {
    ...(params.equipmentId && { equipmentId: params.equipmentId }),
    ...(params.type && { type: params.type }),
    ...(params.from && { timestamp: { gte: new Date(params.from) } }),
    ...(params.to && { timestamp: { lte: new Date(params.to) } }),
  };

  // CREW can only see their own
  if (requesterRole === "CREW") {
    where.userId = requesterId;
  } else if (params.userId) {
    where.userId = params.userId;
  }

  const [items, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { timestamp: "desc" },
      select: {
        id: true, clientId: true, type: true, timestamp: true, syncStatus: true,
        location: true, conflictNote: true, syncedAt: true,
        user: { select: { id: true, name: true } },
        equipment: { select: { id: true, name: true, category: true } },
      },
    }),
    prisma.transaction.count({ where }),
  ]);

  return { items, total, page, limit, pages: Math.ceil(total / limit) };
}

export async function getTransaction(id: string) {
  const tx = await prisma.transaction.findUnique({
    where: { id },
    select: {
      id: true, clientId: true, type: true, timestamp: true, syncStatus: true,
      location: true, conflictNote: true, syncedAt: true,
      user: { select: { id: true, name: true, role: true } },
      equipment: { select: { id: true, name: true, category: true, status: true } },
    },
  });
  if (!tx) throw Object.assign(new Error("Transaction not found."), { statusCode: 404, code: "NOT_FOUND" });
  return tx;
}

export async function listConflicts(page: number, limit: number) {
  const where = { syncStatus: SyncStatus.CONFLICT };
  const [items, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { timestamp: "desc" },
      select: {
        id: true, clientId: true, type: true, timestamp: true, conflictNote: true,
        user: { select: { id: true, name: true } },
        equipment: { select: { id: true, name: true } },
      },
    }),
    prisma.transaction.count({ where }),
  ]);
  return { items, total, page, limit, pages: Math.ceil(total / limit) };
}

export async function resolveConflict(id: string, conflictNote: string) {
  return prisma.transaction.update({
    where: { id },
    data: { syncStatus: SyncStatus.SYNCED, conflictNote },
    select: { id: true, syncStatus: true, conflictNote: true },
  });
}
