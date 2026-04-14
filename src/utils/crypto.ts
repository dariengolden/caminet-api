import crypto from "crypto";
import { env } from "../config/env";

const ALGORITHM = "aes-256-gcm";
// Derive a 32-byte key from the HMAC_TAG_SECRET
const KEY = crypto.scryptSync(env.HMAC_TAG_SECRET, "caminet-mfa-salt", 32);

/** Encrypt a plaintext string — returns "iv:tag:ciphertext" (all hex) */
export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

/** Decrypt a string produced by encrypt() */
export function decrypt(ciphertext: string): string {
  const [ivHex, tagHex, encHex] = ciphertext.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const encrypted = Buffer.from(encHex, "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted).toString("utf8") + decipher.final("utf8");
}

/** Produce an HMAC-SHA256 hex signature for a tag payload */
export function signHmac(payload: string): string {
  return crypto.createHmac("sha256", env.HMAC_TAG_SECRET).update(payload).digest("hex");
}

/** Constant-time HMAC verification */
export function verifyHmac(payload: string, signature: string): boolean {
  const expected = signHmac(payload);
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"));
  } catch {
    return false;
  }
}
