import { prisma } from "../config/db";

// ── Usage report ──────────────────────────────────────────────────────────────

export async function usageReport(from?: string, to?: string) {
  const dateFilter: any = {};
  if (from) dateFilter.gte = new Date(from);
  if (to)   dateFilter.lte = new Date(to);
  const where = Object.keys(dateFilter).length ? { timestamp: dateFilter } : {};

  // Aggregate check-in/check-out counts per equipment
  const counts = await prisma.transaction.groupBy({
    by: ["equipmentId", "type"],
    where,
    _count: { id: true },
  });

  // Get equipment names
  const equipmentIds = [...new Set(counts.map((c) => c.equipmentId))];
  const equipment = await prisma.equipment.findMany({
    where: { id: { in: equipmentIds } },
    select: { id: true, name: true, category: true },
  });
  const equipMap = Object.fromEntries(equipment.map((e) => [e.id, e]));

  // Build per-equipment summary
  const summaryMap: Record<string, any> = {};
  for (const row of counts) {
    if (!summaryMap[row.equipmentId]) {
      summaryMap[row.equipmentId] = {
        equipment: equipMap[row.equipmentId],
        checkOuts: 0,
        checkIns: 0,
      };
    }
    if (row.type === "CHECK_OUT") summaryMap[row.equipmentId].checkOuts = row._count.id;
    if (row.type === "CHECK_IN")  summaryMap[row.equipmentId].checkIns  = row._count.id;
  }

  const rows = Object.values(summaryMap).sort((a: any, b: any) => b.checkOuts - a.checkOuts);
  return { from, to, rows };
}

// ── Availability snapshot ──────────────────────────────────────────────────────

export async function availabilityReport() {
  // Count by status
  const byCounts = await prisma.equipment.groupBy({
    by: ["status"],
    where: { isActive: true },
    _count: { id: true },
  });

  const statusCounts = Object.fromEntries(byCounts.map((r) => [r.status, r._count.id]));

  // Currently checked-out items — who has them and since when
  const checkedOut = await prisma.transaction.findMany({
    where: {
      type: "CHECK_OUT",
      equipment: { status: "IN_USE", isActive: true },
    },
    orderBy: { timestamp: "desc" },
    distinct: ["equipmentId"],
    select: {
      timestamp: true,
      equipment: { select: { id: true, name: true, category: true } },
      user: { select: { id: true, name: true } },
    },
  });

  return { statusCounts, checkedOut };
}

// ── Accountability report ─────────────────────────────────────────────────────

export async function accountabilityReport(from?: string, to?: string) {
  const dateFilter: any = {};
  if (from) dateFilter.gte = new Date(from);
  if (to)   dateFilter.lte = new Date(to);
  const where = Object.keys(dateFilter).length ? { timestamp: dateFilter } : {};

  const counts = await prisma.transaction.groupBy({
    by: ["userId", "type"],
    where,
    _count: { id: true },
  });

  const userIds = [...new Set(counts.map((c) => c.userId))];
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true, role: true },
  });
  const userMap = Object.fromEntries(users.map((u) => [u.id, u]));

  // Count currently holding (checked out with no subsequent check-in)
  const holdingCounts = await prisma.$queryRaw<Array<{ userId: string; count: bigint }>>`
    SELECT DISTINCT ON (t."equipmentId") t."userId", COUNT(*) OVER (PARTITION BY t."userId") as count
    FROM transactions t
    WHERE t.type = 'CHECK_OUT'
    ORDER BY t."equipmentId", t.timestamp DESC
  `;
  const holdingMap = Object.fromEntries(
    holdingCounts.map((r) => [r.userId, Number(r.count)])
  );

  const summaryMap: Record<string, any> = {};
  for (const row of counts) {
    if (!summaryMap[row.userId]) {
      summaryMap[row.userId] = {
        user: userMap[row.userId],
        checkOuts: 0,
        checkIns: 0,
        currentlyHolding: holdingMap[row.userId] ?? 0,
      };
    }
    if (row.type === "CHECK_OUT") summaryMap[row.userId].checkOuts = row._count.id;
    if (row.type === "CHECK_IN")  summaryMap[row.userId].checkIns  = row._count.id;
  }

  return { from, to, rows: Object.values(summaryMap) };
}
