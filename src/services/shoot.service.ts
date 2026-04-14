import { prisma } from "../config/db";
import { ShootStatus, UserRole } from "@prisma/client";

// ── List ──────────────────────────────────────────────────────────────────────

export async function listShoots(params: {
  status?: ShootStatus;
  from?: string;
  to?: string;
  page: number;
  limit: number;
  requesterId: string;
  requesterRole: string;
}) {
  const { status, from, to, page, limit, requesterId, requesterRole } = params;

  const where: any = {
    ...(status && { status }),
    ...(from && { date: { gte: new Date(from) } }),
    ...(to && { endDate: { lte: new Date(to) } }),
  };

  // CREW sees only their own shoots
  if (requesterRole === UserRole.CREW) {
    where.crew = { some: { userId: requesterId } };
  }

  const [items, total] = await Promise.all([
    prisma.shoot.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { date: "asc" },
      select: {
        id: true, name: true, date: true, endDate: true, location: true,
        status: true, createdAt: true,
        _count: { select: { equipment: true, crew: true } },
      },
    }),
    prisma.shoot.count({ where }),
  ]);

  return { items, total, page, limit, pages: Math.ceil(total / limit) };
}

// ── Create ────────────────────────────────────────────────────────────────────

export async function createShoot(data: {
  name: string;
  date: string;
  endDate: string;
  location: string;
  templateId?: string;
}) {
  const date = new Date(data.date);
  const endDate = new Date(data.endDate);

  if (endDate <= date) {
    throw Object.assign(new Error("endDate must be after date."), { statusCode: 400, code: "INVALID_DATE" });
  }

  // Auto-populate from template if provided
  const templateEquipment = data.templateId
    ? await prisma.templateEquipment.findMany({
        where: { templateId: data.templateId },
        select: { equipmentId: true },
      })
    : [];

  const shoot = await prisma.shoot.create({
    data: {
      name: data.name,
      date,
      endDate,
      location: data.location,
      templateId: data.templateId,
      equipment: {
        create: templateEquipment.map((te) => ({ equipmentId: te.equipmentId })),
      },
    },
    select: {
      id: true, name: true, date: true, endDate: true, location: true,
      status: true, templateId: true, createdAt: true,
      equipment: { select: { equipmentId: true } },
    },
  });

  return shoot;
}

// ── Get one ───────────────────────────────────────────────────────────────────

export async function getShoot(id: string, requesterId: string, requesterRole: string) {
  const shoot = await prisma.shoot.findUnique({
    where: { id },
    select: {
      id: true, name: true, date: true, endDate: true, location: true,
      status: true, templateId: true, createdAt: true,
      equipment: {
        select: { equipment: { select: { id: true, name: true, category: true, status: true } } },
      },
      crew: {
        select: { user: { select: { id: true, name: true, role: true, email: true } } },
      },
    },
  });

  if (!shoot) throw Object.assign(new Error("Shoot not found."), { statusCode: 404, code: "NOT_FOUND" });

  // CREW can only view shoots they're assigned to
  if (requesterRole === UserRole.CREW) {
    const isCrew = shoot.crew.some((c) => c.user.id === requesterId);
    if (!isCrew) throw Object.assign(new Error("Forbidden."), { statusCode: 403, code: "FORBIDDEN" });
  }

  return shoot;
}

// ── Update ────────────────────────────────────────────────────────────────────

export async function updateShoot(id: string, data: {
  name?: string;
  date?: string;
  endDate?: string;
  location?: string;
  status?: ShootStatus;
}) {
  const updateData: any = {};
  if (data.name) updateData.name = data.name;
  if (data.location) updateData.location = data.location;
  if (data.status) updateData.status = data.status;
  if (data.date) updateData.date = new Date(data.date);
  if (data.endDate) updateData.endDate = new Date(data.endDate);

  return prisma.shoot.update({
    where: { id },
    data: updateData,
    select: { id: true, name: true, date: true, endDate: true, location: true, status: true },
  });
}

// ── Cancel ────────────────────────────────────────────────────────────────────

export async function cancelShoot(id: string) {
  return prisma.shoot.update({
    where: { id },
    data: {
      status: ShootStatus.CANCELLED,
      equipment: { deleteMany: {} },
    },
    select: { id: true, status: true },
  });
}

// ── Equipment assignment ──────────────────────────────────────────────────────

export async function assignEquipment(shootId: string, equipmentId: string) {
  const equipment = await prisma.equipment.findUnique({ where: { id: equipmentId } });
  if (!equipment || equipment.status !== "AVAILABLE") {
    throw Object.assign(
      new Error("Equipment is not available."),
      { statusCode: 409, code: "NOT_AVAILABLE" }
    );
  }

  // Overlap conflict check
  const shoot = await prisma.shoot.findUnique({ where: { id: shootId }, select: { date: true, endDate: true } });
  if (!shoot) throw Object.assign(new Error("Shoot not found."), { statusCode: 404, code: "NOT_FOUND" });

  const overlap = await prisma.shootEquipment.findFirst({
    where: {
      equipmentId,
      shoot: {
        status: { not: ShootStatus.CANCELLED },
        date: { lt: shoot.endDate },
        endDate: { gt: shoot.date },
        NOT: { id: shootId },
      },
    },
  });

  if (overlap) {
    throw Object.assign(
      new Error("Equipment already assigned to an overlapping shoot."),
      { statusCode: 409, code: "SCHEDULE_CONFLICT" }
    );
  }

  return prisma.shootEquipment.create({
    data: { shootId, equipmentId },
    select: { shootId: true, equipmentId: true },
  });
}

export async function removeEquipment(shootId: string, equipmentId: string) {
  await prisma.shootEquipment.delete({ where: { shootId_equipmentId: { shootId, equipmentId } } });
}

// ── Crew assignment ───────────────────────────────────────────────────────────

export async function assignCrew(shootId: string, userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isActive: true } });
  if (!user?.isActive) {
    throw Object.assign(new Error("User not found or inactive."), { statusCode: 404, code: "NOT_FOUND" });
  }

  return prisma.shootCrew.create({
    data: { shootId, userId },
    select: { shootId: true, userId: true },
  });
}

export async function removeCrew(shootId: string, userId: string) {
  await prisma.shootCrew.delete({ where: { shootId_userId: { shootId, userId } } });
}
