import bcrypt from "bcrypt";
import * as OTPAuth from "otpauth";
import crypto from "crypto";
import { prisma } from "../config/db";
import { encrypt, decrypt } from "../utils/crypto";
import { env } from "../config/env";
import type { FastifyInstance } from "fastify";
import { UserRole } from "@prisma/client";

// ── Token helpers ─────────────────────────────────────────────────────────────

function parseDuration(str: string): number {
  const unit = str.slice(-1);
  const val = parseInt(str.slice(0, -1), 10);
  if (unit === "m") return val * 60 * 1000;
  if (unit === "h") return val * 60 * 60 * 1000;
  if (unit === "d") return val * 24 * 60 * 60 * 1000;
  return val * 1000;
}

/** Issue a short-lived temp JWT (5 min) for the MFA challenge step. */
function signTempToken(app: FastifyInstance, userId: string): string {
  return app.jwt.sign({ sub: userId, type: "mfa-temp" }, { expiresIn: "5m" });
}

/** Issue the full access JWT (15 min by default). */
function signAccessToken(app: FastifyInstance, userId: string, role: UserRole): string {
  return app.jwt.sign({ sub: userId, role, type: "access" }, { expiresIn: env.JWT_ACCESS_EXPIRES });
}

/** Create a cryptographically random refresh token and store its bcrypt hash in DB. */
async function issueRefreshToken(
  userId: string,
  deviceInfo?: string
): Promise<string> {
  const raw = crypto.randomBytes(48).toString("hex");
  const tokenHash = await bcrypt.hash(raw, 10);
  const expiresAt = new Date(Date.now() + parseDuration(env.JWT_REFRESH_EXPIRES));

  await prisma.refreshToken.create({
    data: { userId, tokenHash, deviceInfo, expiresAt },
  });

  return raw;
}

// ── Auth operations ───────────────────────────────────────────────────────────

/**
 * 3.1 — Login
 * Returns { mfaRequired: true, tempToken } when MFA is enabled,
 * or a full { accessToken, refreshToken } pair when MFA is disabled.
 */
export async function login(
  app: FastifyInstance,
  email: string,
  password: string,
  deviceInfo?: string
) {
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user || !user.isActive) {
    throw Object.assign(new Error("Invalid credentials."), { statusCode: 401, code: "INVALID_CREDENTIALS" });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    throw Object.assign(new Error("Invalid credentials."), { statusCode: 401, code: "INVALID_CREDENTIALS" });
  }

  if (user.mfaEnabled) {
    return { mfaRequired: true, tempToken: signTempToken(app, user.id) };
  }

  const accessToken = signAccessToken(app, user.id, user.role);
  const refreshToken = await issueRefreshToken(user.id, deviceInfo);
  return { mfaRequired: false, accessToken, refreshToken, role: user.role };
}

/**
 * 3.2 — MFA Verify
 * Verifies the TOTP code against the user's stored secret.
 * On success issues the full token pair.
 */
export async function verifyMfa(
  app: FastifyInstance,
  tempToken: string,
  code: string,
  deviceInfo?: string
) {
  let payload: { sub: string; type: string };
  try {
    payload = app.jwt.verify<{ sub: string; type: string }>(tempToken);
  } catch {
    throw Object.assign(new Error("Temp token invalid or expired."), { statusCode: 401, code: "INVALID_TEMP_TOKEN" });
  }

  if (payload.type !== "mfa-temp") {
    throw Object.assign(new Error("Temp token invalid or expired."), { statusCode: 401, code: "INVALID_TEMP_TOKEN" });
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user || !user.mfaSecret || !user.isActive) {
    throw Object.assign(new Error("MFA not configured."), { statusCode: 400, code: "MFA_NOT_CONFIGURED" });
  }

  const secret = OTPAuth.Secret.fromBase32(decrypt(user.mfaSecret));
  const totp = new OTPAuth.TOTP({ issuer: env.TOTP_ISSUER, secret, algorithm: "SHA1", digits: 6, period: 30 });

  // delta: allow 1 window drift (±30s)
  const delta = totp.validate({ token: code, window: 1 });
  if (delta === null) {
    throw Object.assign(new Error("Invalid MFA code."), { statusCode: 401, code: "INVALID_MFA_CODE" });
  }

  const accessToken = signAccessToken(app, user.id, user.role);
  const refreshToken = await issueRefreshToken(user.id, deviceInfo);
  return { accessToken, refreshToken, role: user.role };
}

/**
 * 3.3 — MFA Setup
 * Generates a new TOTP secret without persisting it.
 * The iOS app renders the otpauthUrl as a QR code.
 */
export async function setupMfa(userId: string, email: string) {
  const totp = new OTPAuth.TOTP({
    issuer: env.TOTP_ISSUER,
    label: email,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
  });

  return {
    secret: totp.secret.base32,
    otpauthUrl: totp.toString(),
  };
}

/**
 * 3.4 — MFA Confirm
 * Verifies the first TOTP code, then persists the encrypted secret.
 */
export async function confirmMfa(userId: string, secret: string, code: string) {
  const totpSecret = OTPAuth.Secret.fromBase32(secret);
  const totp = new OTPAuth.TOTP({ issuer: env.TOTP_ISSUER, secret: totpSecret, algorithm: "SHA1", digits: 6, period: 30 });

  const delta = totp.validate({ token: code, window: 1 });
  if (delta === null) {
    throw Object.assign(new Error("Invalid MFA code — setup failed."), { statusCode: 400, code: "INVALID_MFA_CODE" });
  }

  await prisma.user.update({
    where: { id: userId },
    data: { mfaSecret: encrypt(secret), mfaEnabled: true },
  });
}

/**
 * 3.5 — Refresh
 * Finds a matching hashed refresh token, rotates it (delete + issue new pair).
 */
export async function refreshTokens(app: FastifyInstance, rawToken: string, deviceInfo?: string) {
  // Find candidate tokens for rotation (we must check all non-expired ones)
  const stored = await prisma.refreshToken.findMany({
    where: { expiresAt: { gt: new Date() } },
    include: { user: { select: { id: true, role: true, isActive: true } } },
  });

  let matched: (typeof stored)[0] | undefined;
  for (const row of stored) {
    if (await bcrypt.compare(rawToken, row.tokenHash)) {
      matched = row;
      break;
    }
  }

  if (!matched || !matched.user.isActive) {
    throw Object.assign(new Error("Refresh token invalid or expired."), { statusCode: 401, code: "INVALID_REFRESH_TOKEN" });
  }

  // Rotate: delete old, issue new
  await prisma.refreshToken.delete({ where: { id: matched.id } });
  const accessToken = signAccessToken(app, matched.user.id, matched.user.role);
  const newRefreshToken = await issueRefreshToken(matched.user.id, deviceInfo ?? matched.deviceInfo ?? undefined);

  return { accessToken, refreshToken: newRefreshToken };
}

/**
 * 3.6 — Logout
 * Deletes the refresh token from DB (invalidates the session server-side).
 */
export async function logout(rawToken: string) {
  const stored = await prisma.refreshToken.findMany({
    where: { expiresAt: { gt: new Date() } },
  });

  for (const row of stored) {
    if (await bcrypt.compare(rawToken, row.tokenHash)) {
      await prisma.refreshToken.delete({ where: { id: row.id } });
      return;
    }
  }
  // Silently succeed even if token not found (already logged out)
}
