import cron from "node-cron";
import { prisma } from "../config/db";
import { broadcastToRole, createNotification } from "../services/notification.service";
import { UserRole, NotificationType } from "@prisma/client";

const OVERDUE_HOURS = 24;
const DEDUP_HOURS = 12;

/**
 * Runs every hour.
 * Finds all CHECK_OUT transactions with no subsequent CHECK_IN where the
 * checkout is older than 24 hours, then notifies relevant users — deduplicating
 * if a notification was already sent within the last 12 hours.
 */
async function checkOverdueReturns() {
  const cutoff = new Date(Date.now() - OVERDUE_HOURS * 60 * 60 * 1000);
  const dedupCutoff = new Date(Date.now() - DEDUP_HOURS * 60 * 60 * 1000);

  // Find the most recent transaction per equipment that is a CHECK_OUT older than cutoff
  const overdueCheckouts = await prisma.$queryRaw<
    Array<{ id: string; userId: string; equipmentId: string; equipmentName: string; timestamp: Date }>
  >`
    SELECT DISTINCT ON (t."equipmentId")
      t.id, t."userId", t."equipmentId",
      e.name AS "equipmentName", t.timestamp
    FROM transactions t
    JOIN equipment e ON e.id = t."equipmentId"
    WHERE t.type = 'CHECK_OUT'
      AND t.timestamp < ${cutoff}
    ORDER BY t."equipmentId", t.timestamp DESC
  `;

  for (const checkout of overdueCheckouts) {
    // Verify there is no CHECK_IN after this CHECK_OUT
    const checkedIn = await prisma.transaction.findFirst({
      where: {
        equipmentId: checkout.equipmentId,
        type: "CHECK_IN",
        timestamp: { gt: checkout.timestamp },
      },
    });
    if (checkedIn) continue;

    // Dedup: skip if already notified within the last 12h for this equipment
    const recentNotif = await prisma.notification.findFirst({
      where: {
        type: NotificationType.OVERDUE_RETURN,
        metadata: { path: ["equipmentId"], equals: checkout.equipmentId },
        createdAt: { gt: dedupCutoff },
      },
    });
    if (recentNotif) continue;

    const message = `Overdue return: ${checkout.equipmentName} has been checked out for over ${OVERDUE_HOURS} hours.`;
    const metadata = { equipmentId: checkout.equipmentId, transactionId: checkout.id };

    // Notify the crew member who checked out
    await createNotification(checkout.userId, NotificationType.OVERDUE_RETURN, message, metadata);

    // Notify all ADMIN and PIC
    await broadcastToRole(UserRole.ADMIN, NotificationType.OVERDUE_RETURN, message, metadata);
    await broadcastToRole(UserRole.PIC,   NotificationType.OVERDUE_RETURN, message, metadata);
  }
}

/** Register the overdue check cron — call once at server startup. */
export function startOverdueJob() {
  cron.schedule("0 * * * *", () => {
    checkOverdueReturns().catch((err) =>
      console.error("[overdue-job] Error:", err)
    );
  });
  console.info("[overdue-job] Scheduled — runs every hour.");
}
