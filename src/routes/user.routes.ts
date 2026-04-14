import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { UserRole } from "@prisma/client";
import { requireRole } from "../middleware/requireRole";
import * as userService from "../services/user.service";

const passwordSchema = z
  .string()
  .min(8)
  .regex(/[A-Z]/, "Must contain uppercase")
  .regex(/[0-9]/, "Must contain number");

export async function userRoutes(app: FastifyInstance) {
  // ── 4.1 GET /users ──────────────────────────────────────────────────────────
  app.get(
    "/",
    {
      preHandler: [app.authenticate, requireRole("ADMIN")],
      schema: {
        tags: ["Users"],
        summary: "List all users (ADMIN only)",
        security: [{ bearerAuth: [] }],
        querystring: {
          type: "object",
          properties: {
            role: { type: "string", enum: Object.values(UserRole) },
            isActive: { type: "boolean" },
            page: { type: "integer", default: 1 },
            limit: { type: "integer", default: 20 },
          },
        },
      },
    },
    async (request, reply) => {
      const q = request.query as { role?: UserRole; isActive?: boolean; page?: number; limit?: number };
      const result = await userService.listUsers({
        role: q.role,
        isActive: q.isActive,
        page: q.page ?? 1,
        limit: Math.min(q.limit ?? 20, 100),
      });
      return reply.send({ success: true, data: result });
    }
  );

  // ── 4.2 POST /users ─────────────────────────────────────────────────────────
  app.post(
    "/",
    {
      preHandler: [app.authenticate, requireRole("ADMIN")],
      schema: {
        tags: ["Users"],
        summary: "Create a new user (ADMIN only)",
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          required: ["name", "email", "password", "role"],
          properties: {
            name: { type: "string" },
            email: { type: "string", format: "email" },
            password: { type: "string" },
            role: { type: "string", enum: Object.values(UserRole) },
          },
        },
      },
    },
    async (request, reply) => {
      const body = z.object({
        name: z.string().min(1),
        email: z.string().email(),
        password: passwordSchema,
        role: z.nativeEnum(UserRole),
      }).parse(request.body);

      try {
        const user = await userService.createUser(body);
        return reply.status(201).send({ success: true, data: user });
      } catch (err: any) {
        return reply.status(err.statusCode ?? 500).send({ success: false, error: err.message, code: err.code });
      }
    }
  );

  // ── 4.3 GET /users/me ───────────────────────────────────────────────────────
  app.get(
    "/me",
    {
      preHandler: [app.authenticate],
      schema: { tags: ["Users"], summary: "Get own profile", security: [{ bearerAuth: [] }] },
    },
    async (request, reply) => {
      const user = await userService.getUser(request.user.id);
      return reply.send({ success: true, data: user });
    }
  );

  // ── 4.7 PATCH /users/me/fcm-token ──────────────────────────────────────────
  // Declared before /:id to avoid route conflict
  app.patch(
    "/me/fcm-token",
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ["Users"],
        summary: "Update own FCM device token",
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          required: ["fcmToken"],
          properties: { fcmToken: { type: "string" } },
        },
      },
    },
    async (request, reply) => {
      const { fcmToken } = z.object({ fcmToken: z.string().min(1) }).parse(request.body);
      await userService.updateFcmToken(request.user.id, fcmToken);
      return reply.send({ success: true, data: { updated: true } });
    }
  );

  // ── 4.3 GET /users/:id ──────────────────────────────────────────────────────
  app.get(
    "/:id",
    {
      preHandler: [app.authenticate, requireRole("ADMIN")],
      schema: {
        tags: ["Users"],
        summary: "Get a single user (ADMIN only)",
        security: [{ bearerAuth: [] }],
        params: { type: "object", properties: { id: { type: "string" } } },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        const user = await userService.getUser(id);
        return reply.send({ success: true, data: user });
      } catch (err: any) {
        return reply.status(err.statusCode ?? 500).send({ success: false, error: err.message, code: err.code });
      }
    }
  );

  // ── 4.4 PATCH /users/:id ────────────────────────────────────────────────────
  app.patch(
    "/:id",
    {
      preHandler: [app.authenticate, requireRole("ADMIN")],
      schema: {
        tags: ["Users"],
        summary: "Update a user's name, email, or role (ADMIN only)",
        security: [{ bearerAuth: [] }],
        params: { type: "object", properties: { id: { type: "string" } } },
        body: {
          type: "object",
          properties: {
            name: { type: "string" },
            email: { type: "string", format: "email" },
            role: { type: "string", enum: Object.values(UserRole) },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = z.object({
        name: z.string().min(1).optional(),
        email: z.string().email().optional(),
        role: z.nativeEnum(UserRole).optional(),
      }).parse(request.body);

      try {
        const user = await userService.updateUser(id, request.user.id, body);
        return reply.send({ success: true, data: user });
      } catch (err: any) {
        return reply.status(err.statusCode ?? 500).send({ success: false, error: err.message, code: err.code });
      }
    }
  );

  // ── 4.5 PATCH /users/:id/deactivate ────────────────────────────────────────
  app.patch(
    "/:id/deactivate",
    {
      preHandler: [app.authenticate, requireRole("ADMIN")],
      schema: {
        tags: ["Users"],
        summary: "Soft-delete a user (ADMIN only)",
        security: [{ bearerAuth: [] }],
        params: { type: "object", properties: { id: { type: "string" } } },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        const result = await userService.deactivateUser(id, request.user.id);
        return reply.send({ success: true, data: result });
      } catch (err: any) {
        return reply.status(err.statusCode ?? 500).send({ success: false, error: err.message, code: err.code });
      }
    }
  );

  // ── 4.6 PATCH /users/:id/mfa/reset ─────────────────────────────────────────
  app.patch(
    "/:id/mfa/reset",
    {
      preHandler: [app.authenticate, requireRole("ADMIN")],
      schema: {
        tags: ["Users"],
        summary: "Reset a user's MFA (ADMIN only)",
        security: [{ bearerAuth: [] }],
        params: { type: "object", properties: { id: { type: "string" } } },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await userService.resetMfa(id);
      return reply.send({ success: true, data: result });
    }
  );
}
