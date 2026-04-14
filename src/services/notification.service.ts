import { prisma } from "../config/db";
import { NotificationType, UserRole } from "@prisma/client";

// ── Core create ───────────────────────────────────────────────────────────────

export async function createNotification(
  userId: string,
  type: NotificationType,
  message: string,
  metadata?: object
) {
  return prisma.notification.create({
    data: { userId, type, message, metadata: metadata as any },
    select: { id: true, type: true, message: true, createdAt: true },
  });
}

// ── Broadcast to a role ───────────────────────────────────────────────────────

export async function broadcastToRole(
  role: UserRole,
  type: NotificationType,
  message: string,
  metadata?: object
) {
  const users = await prisma.user.findMany({
    where: { role, isActive: true },
    select: { id: true, fcmToken: true },
  });

  await Promise.all(
    users.map((u) => createNotification(u.id, type, message, metadata))
  );
}

// ── Notify all ADMIN + PIC ────────────────────────────────────────────────────

export async function notifyAdminsAndPics(type: NotificationType, message: string, metadata?: object) {
  await Promise.all([
    broadcastToRole(UserRole.ADMIN, type, message, metadata),
    broadcastToRole(UserRole.PIC, type, message, metadata),
  ]);
}

// ── List for user ─────────────────────────────────────────────────────────────

export async function listNotifications(userId: string, isRead?: boolean, page = 1, limit = 20) {
  const where = { userId, ...(isRead !== undefined && { isRead }) };
  const [items, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: "desc" },
      select: { id: true, type: true, message: true, isRead: true, metadata: true, createdAt: true },
    }),
    prisma.notification.count({ where }),
  ]);
  return { items, total, page, limit, pages: Math.ceil(total / limit) };
}

export async function markRead(id: string, userId: string) {
  return prisma.notification.updateMany({
    where: { id, userId },
    data: { isRead: true },
  });
}

export async function markAllRead(userId: string) {
  return prisma.notification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true },
  });
}
