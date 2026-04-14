import type { FastifyInstance } from "fastify";
import { z } from "zod";
import * as authService from "../services/auth.service";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const mfaVerifySchema = z.object({
  tempToken: z.string().min(1),
  code: z.string().length(6),
});

const mfaConfirmSchema = z.object({
  secret: z.string().min(1),
  code: z.string().length(6),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

const logoutSchema = z.object({
  refreshToken: z.string().min(1),
});

export async function authRoutes(app: FastifyInstance) {
  // ── 3.1 POST /login ────────────────────────────────────────────────────────
  app.post(
    "/login",
    {
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        tags: ["Auth"],
        summary: "Login with email and password",
        body: {
          type: "object",
          required: ["email", "password"],
          properties: {
            email: { type: "string", format: "email" },
            password: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const body = loginSchema.parse(request.body);
      const deviceInfo = request.headers["user-agent"];

      try {
        const result = await authService.login(app, body.email, body.password, deviceInfo);
        return reply.send({ success: true, data: result });
      } catch (err: any) {
        return reply.status(err.statusCode ?? 500).send({
          success: false,
          error: err.message,
          code: err.code ?? "LOGIN_ERROR",
        });
      }
    }
  );

  // ── 3.2 POST /mfa/verify ───────────────────────────────────────────────────
  app.post(
    "/mfa/verify",
    {
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        tags: ["Auth"],
        summary: "Verify TOTP code and receive full token pair",
        body: {
          type: "object",
          required: ["tempToken", "code"],
          properties: {
            tempToken: { type: "string" },
            code: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const body = mfaVerifySchema.parse(request.body);
      const deviceInfo = request.headers["user-agent"];

      try {
        const result = await authService.verifyMfa(app, body.tempToken, body.code, deviceInfo);
        return reply.send({ success: true, data: result });
      } catch (err: any) {
        return reply.status(err.statusCode ?? 500).send({
          success: false,
          error: err.message,
          code: err.code ?? "MFA_ERROR",
        });
      }
    }
  );

  // ── 3.3 POST /mfa/setup ────────────────────────────────────────────────────
  app.post(
    "/mfa/setup",
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ["Auth"],
        summary: "Generate a new TOTP secret for MFA setup (not yet persisted)",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const user = await import("../config/db").then(({ prisma }) =>
        prisma.user.findUnique({ where: { id: request.user.id }, select: { email: true } })
      );
      if (!user) return reply.status(404).send({ success: false, error: "User not found." });

      const result = await authService.setupMfa(request.user.id, user.email);
      return reply.send({ success: true, data: result });
    }
  );

  // ── 3.4 POST /mfa/confirm ──────────────────────────────────────────────────
  app.post(
    "/mfa/confirm",
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ["Auth"],
        summary: "Confirm MFA setup by verifying the first TOTP code",
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          required: ["secret", "code"],
          properties: {
            secret: { type: "string" },
            code: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const body = mfaConfirmSchema.parse(request.body);

      try {
        await authService.confirmMfa(request.user.id, body.secret, body.code);
        return reply.send({ success: true, data: { mfaEnabled: true } });
      } catch (err: any) {
        return reply.status(err.statusCode ?? 500).send({
          success: false,
          error: err.message,
          code: err.code ?? "MFA_CONFIRM_ERROR",
        });
      }
    }
  );

  // ── 3.5 POST /refresh ──────────────────────────────────────────────────────
  app.post(
    "/refresh",
    {
      schema: {
        tags: ["Auth"],
        summary: "Rotate refresh token and receive a new access + refresh token pair",
        body: {
          type: "object",
          required: ["refreshToken"],
          properties: { refreshToken: { type: "string" } },
        },
      },
    },
    async (request, reply) => {
      const body = refreshSchema.parse(request.body);
      const deviceInfo = request.headers["user-agent"];

      try {
        const result = await authService.refreshTokens(app, body.refreshToken, deviceInfo);
        return reply.send({ success: true, data: result });
      } catch (err: any) {
        return reply.status(err.statusCode ?? 500).send({
          success: false,
          error: err.message,
          code: err.code ?? "REFRESH_ERROR",
        });
      }
    }
  );

  // ── 3.6 POST /logout ───────────────────────────────────────────────────────
  app.post(
    "/logout",
    {
      schema: {
        tags: ["Auth"],
        summary: "Invalidate the refresh token (server-side logout)",
        body: {
          type: "object",
          required: ["refreshToken"],
          properties: { refreshToken: { type: "string" } },
        },
      },
    },
    async (request, reply) => {
      const body = logoutSchema.parse(request.body);
      await authService.logout(body.refreshToken);
      return reply.send({ success: true, data: { loggedOut: true } });
    }
  );
}
