/**
 * Diagnostic: prints the current valid TOTP code for the chronos admin.
 * Run with: npx tsx prisma/debug-mfa.ts
 */
import { PrismaClient } from "@prisma/client";
import * as OTPAuth from "otpauth";
import { decrypt } from "../src/utils/crypto";

const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findUnique({
    where: { email: "chronos@35stripes.com" },
    select: { mfaSecret: true, mfaEnabled: true },
  });

  if (!user) { console.error("User not found."); process.exit(1); }
  if (!user.mfaSecret) { console.error("No MFA secret stored."); process.exit(1); }

  const rawSecret = decrypt(user.mfaSecret);
  const totp = new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(rawSecret),
    algorithm: "SHA1",
    digits: 6,
    period: 30,
  });

  console.log(`Raw base32 secret : ${rawSecret}`);
  console.log(`Current TOTP code : ${totp.generate()}`);
  console.log(`(valid for the next ${30 - (Math.floor(Date.now() / 1000) % 30)}s)`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
