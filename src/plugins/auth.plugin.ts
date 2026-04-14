import fp from "fastify-plugin";
import type { FastifyRequest, FastifyReply } from "fastify";
import type { UserRole } from "@prisma/client";

export interface AuthUser {
  id: string;
  role: UserRole;
}

// Extend @fastify/jwt so request.user is typed as AuthUser everywhere
declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string; role?: UserRole; type: string };
    user: AuthUser;
  }
}

/**
 * authGuard — registers app.authenticate as a reusable preHandler.
 * Must be registered after the jwt plugin.
 */
export default fp(async (app) => {
  app.decorate(
    "authenticate",
    async function (request: FastifyRequest, reply: FastifyReply) {
      try {
        await request.jwtVerify();
      } catch {
        return reply.status(401).send({
          success: false,
          error: "Unauthorised — invalid or expired token.",
          code: "UNAUTHORISED",
        });
      }
    }
  );
});

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
