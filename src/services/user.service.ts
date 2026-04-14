import bcrypt from "bcrypt";
import { prisma } from "../config/db";
import { sendWelcomeEmail } from "../utils/email";
import { UserRole } from "@prisma/client";

// ── List ──────────────────────────────────────────────────────────────────────

export async function listUsers(params: {
  role?: UserRole;
  isActive?: boolean;
  page: number;
  limit: number;
}) {
  const { role, isActive, page, limit } = params;
  const where = {
    ...(role !== undefined && { role }),
    ...(isActive !== undefined && { isActive }),
  };

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: "desc" },
      select: {
        id: true, name: true, email: true, role: true,
        mfaEnabled: true, isActive: true, createdAt: true,
      },
    }),
    prisma.user.count({ where }),
  ]);

  return { users, total, page, limit, pages: Math.ceil(total / limit) };
}

// ── Create ────────────────────────────────────────────────────────────────────

export async function createUser(data: {
  name: string;
  email: string;
  password: string;
  role: UserRole;
}) {
  const existing = await prisma.user.findUnique({ where: { email: data.email } });
  if (existing) {
    throw Object.assign(new Error("Email already in use."), { statusCode: 409, code: "EMAIL_CONFLICT" });
  }

  const passwordHash = await bcrypt.hash(data.password, 12);

  const user = await prisma.user.create({
    data: { name: data.name, email: data.email, passwordHash, role: data.role },
    select: { id: true, name: true, email: true, role: true, mfaEnabled: true, isActive: true, createdAt: true },
  });

  // Non-blocking — don't fail user creation if email errors
  sendWelcomeEmail(data.email, data.name, data.password).catch(() => {});

  return user;
}

// ── Get one ───────────────────────────────────────────────────────────────────

export async function getUser(id: string) {
  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, name: true, email: true, role: true, mfaEnabled: true, isActive: true, createdAt: true },
  });
  if (!user) throw Object.assign(new Error("User not found."), { statusCode: 404, code: "NOT_FOUND" });
  return user;
}

// ── Update ────────────────────────────────────────────────────────────────────

export async function updateUser(
  id: string,
  requesterId: string,
  data: { name?: string; email?: string; role?: UserRole }
) {
  // Cannot self-demote
  if (data.role && id === requesterId) {
    throw Object.assign(new Error("Cannot change your own role."), { statusCode: 403, code: "SELF_DEMOTE" });
  }

  if (data.email) {
    const conflict = await prisma.user.findFirst({ where: { email: data.email, NOT: { id } } });
    if (conflict) throw Object.assign(new Error("Email already in use."), { statusCode: 409, code: "EMAIL_CONFLICT" });
  }

  return prisma.user.update({
    where: { id },
    data,
    select: { id: true, name: true, email: true, role: true, mfaEnabled: true, isActive: true, createdAt: true },
  });
}

// ── Deactivate (soft delete) ──────────────────────────────────────────────────

export async function deactivateUser(id: string, requesterId: string) {
  if (id === requesterId) {
    throw Object.assign(new Error("Cannot deactivate your own account."), { statusCode: 403, code: "SELF_DEACTIVATE" });
  }

  // Invalidate all refresh tokens
  await prisma.refreshToken.deleteMany({ where: { userId: id } });

  return prisma.user.update({
    where: { id },
    data: { isActive: false, deactivatedAt: new Date() },
    select: { id: true, isActive: true, deactivatedAt: true },
  });
}

// ── Reset MFA ─────────────────────────────────────────────────────────────────

export async function resetMfa(id: string) {
  return prisma.user.update({
    where: { id },
    data: { mfaEnabled: false, mfaSecret: null },
    select: { id: true, mfaEnabled: true },
  });
}

// ── Update FCM token ──────────────────────────────────────────────────────────

export async function updateFcmToken(id: string, fcmToken: string) {
  await prisma.user.update({ where: { id }, data: { fcmToken } });
}
