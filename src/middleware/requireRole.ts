import type { FastifyRequest, FastifyReply } from "fastify";
import type { UserRole } from "@prisma/client";
import type { AuthUser } from "../plugins/auth.plugin";

// Ensure request.user is typed correctly in this middleware
type AuthenticatedRequest = FastifyRequest & { user: AuthUser };

/**
 * requireRole(...roles) — preHandler factory.
 * Use after authenticate: both must appear in the route's preHandler array.
 *
 * Example:
 *   preHandler: [app.authenticate, requireRole("ADMIN", "PIC")]
 */
export function requireRole(...roles: UserRole[]) {
  return async function (request: FastifyRequest, reply: FastifyReply) {
    const user = request.user as AuthUser;
    if (!roles.includes(user?.role)) {
      return reply.status(403).send({
        success: false,
        error: "Forbidden — insufficient role.",
        code: "FORBIDDEN",
      });
    }
  };
}
