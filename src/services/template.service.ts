import { prisma } from "../config/db";

export async function listTemplates() {
  return prisma.eventTemplate.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true, name: true, description: true, createdAt: true,
      createdBy: { select: { id: true, name: true } },
      _count: { select: { equipment: true } },
    },
  });
}

export async function createTemplate(data: {
  name: string;
  description?: string;
  equipmentIds: string[];
  createdById: string;
}) {
  // Validate all equipment exists and is active
  const found = await prisma.equipment.findMany({
    where: { id: { in: data.equipmentIds }, isActive: true },
    select: { id: true },
  });
  if (found.length !== data.equipmentIds.length) {
    throw Object.assign(new Error("One or more equipment IDs not found or inactive."), { statusCode: 400, code: "INVALID_EQUIPMENT" });
  }

  return prisma.eventTemplate.create({
    data: {
      name: data.name,
      description: data.description,
      createdById: data.createdById,
      equipment: {
        create: data.equipmentIds.map((equipmentId) => ({ equipmentId })),
      },
    },
    select: {
      id: true, name: true, description: true, createdAt: true,
      equipment: { select: { equipment: { select: { id: true, name: true, category: true } } } },
    },
  });
}

export async function getTemplate(id: string) {
  const template = await prisma.eventTemplate.findUnique({
    where: { id },
    select: {
      id: true, name: true, description: true, createdAt: true,
      createdBy: { select: { id: true, name: true } },
      equipment: { select: { equipment: { select: { id: true, name: true, category: true, status: true } } } },
    },
  });
  if (!template) throw Object.assign(new Error("Template not found."), { statusCode: 404, code: "NOT_FOUND" });
  return template;
}

export async function updateTemplate(id: string, data: {
  name?: string;
  description?: string;
  equipmentIds?: string[];
}) {
  if (data.equipmentIds) {
    const found = await prisma.equipment.findMany({
      where: { id: { in: data.equipmentIds }, isActive: true },
      select: { id: true },
    });
    if (found.length !== data.equipmentIds.length) {
      throw Object.assign(new Error("One or more equipment IDs not found or inactive."), { statusCode: 400, code: "INVALID_EQUIPMENT" });
    }
  }

  return prisma.eventTemplate.update({
    where: { id },
    data: {
      ...(data.name && { name: data.name }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.equipmentIds && {
        equipment: {
          deleteMany: {},
          create: data.equipmentIds.map((equipmentId) => ({ equipmentId })),
        },
      }),
    },
    select: {
      id: true, name: true, description: true,
      equipment: { select: { equipment: { select: { id: true, name: true } } } },
    },
  });
}

export async function deleteTemplate(id: string) {
  // Check if referenced by future shoots
  const futureShoots = await prisma.shoot.findMany({
    where: { templateId: id, date: { gt: new Date() }, status: { not: "CANCELLED" } },
    select: { id: true, name: true, date: true },
  });

  if (futureShoots.length > 0) {
    throw Object.assign(
      new Error("Template is referenced by upcoming shoots."),
      { statusCode: 409, code: "TEMPLATE_IN_USE", data: futureShoots }
    );
  }

  await prisma.eventTemplate.delete({ where: { id } });
}
