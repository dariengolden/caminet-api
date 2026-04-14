import fp from "fastify-plugin";
import fastifyJwt from "@fastify/jwt";
import { env } from "../config/env";

/**
 * Registers @fastify/jwt with RS256 (asymmetric).
 * Using fp() so the jwt decorator is visible across all encapsulation scopes.
 */
export default fp(async (app) => {
  await app.register(fastifyJwt, {
    secret: {
      private: env.JWT_PRIVATE_KEY.replace(/\\n/g, "\n"),
      public: env.JWT_PUBLIC_KEY.replace(/\\n/g, "\n"),
    },
    sign: {
      algorithm: "RS256",
    },
    verify: {
      algorithms: ["RS256"],
    },
    formatUser: (payload: any) => ({
      id: payload.sub,
      role: payload.role,
    }),
  });
});
