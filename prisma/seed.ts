import { PrismaClient, UserRole, EquipmentCategory, EquipmentCondition, EquipmentStatus } from "@prisma/client";
import bcrypt from "bcrypt";
import * as OTPAuth from "otpauth";
import { encrypt } from "../src/utils/crypto";

const prisma = new PrismaClient();

// Helper to expand quantity items into individual records
function expand(
  name: string,
  qty: number,
  category: EquipmentCategory,
  location: string,
  tags: string[] = [],
  condition: EquipmentCondition = EquipmentCondition.GOOD
) {
  return Array.from({ length: qty }, (_, i) => ({
    name: qty > 1 ? `${name} #${i + 1}` : name,
    category,
    condition,
    status: EquipmentStatus.AVAILABLE,
    location,
    tags,
  }));
}

async function main() {
  console.log("🌱 Seeding database...");

  // ── Clear all users ───────────────────────────────────────────────────────
  await prisma.user.deleteMany({});
  console.log("🗑️  All existing users removed.");

  // ── Admin user: Chronos ───────────────────────────────────────────────────
  const passwordHash = await bcrypt.hash("$3Vnthd#2544", 12);

  const totp = new OTPAuth.TOTP({
    issuer: "Caminet",
    label: "chronos@35stripes.com",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
  });
  const mfaSecret = totp.secret.base32;

  const admin = await prisma.user.create({
    data: {
      name: "Chronos",
      email: "chronos@35stripes.com",
      passwordHash,
      role: UserRole.ADMIN,
      mfaEnabled: true,
      mfaSecret: encrypt(mfaSecret), // stored AES-256-GCM encrypted
    },
  });

  console.log(`✅ Admin created: ${admin.name} (${admin.email})`);
  console.log(`   MFA Secret (add to authenticator app): ${mfaSecret}`);
  console.log(`   Password: $3Vnthd#2544`);
  console.log(`   ⚠️  Change password on first login.\n`);

  // ── Equipment — 35 Stripes Films & Productions ────────────────────────────
  const STORE = "35 Stripes Equipment Room";

  const equipment = [
    // ── Cameras ──────────────────────────────────────────────────────────────
    ...expand("Sony A6400",  1, EquipmentCategory.CAMERA, STORE, ["sony", "mirrorless"]),
    ...expand("Sony F65",    1, EquipmentCategory.CAMERA, STORE, ["sony", "cinema"]),
    ...expand("Sony A7 IV",  1, EquipmentCategory.CAMERA, STORE, ["sony", "mirrorless", "full-frame"]),

    // ── Lenses ───────────────────────────────────────────────────────────────
    ...expand("Sony 55mm f/1.8",          1, EquipmentCategory.LENS, STORE, ["sony", "prime"]),
    ...expand("Sony 16-50mm f/4",         1, EquipmentCategory.LENS, STORE, ["sony", "zoom"]),
    ...expand("Canon 70-200mm f/2.8",     1, EquipmentCategory.LENS, STORE, ["canon", "zoom", "telephoto"]),
    ...expand("Sony 24-70mm f/4",         1, EquipmentCategory.LENS, STORE, ["sony", "zoom"]),
    ...expand("Sony 85mm f/1.8",          1, EquipmentCategory.LENS, STORE, ["sony", "prime", "portrait"]),
    ...expand("Sony 25mm f/1.8",          1, EquipmentCategory.LENS, STORE, ["sony", "prime"]),
    ...expand("Voigtlander 50mm f/0.8",   1, EquipmentCategory.LENS, STORE, ["voigtlander", "prime", "manual"]),

    // ── Memory Cards ─────────────────────────────────────────────────────────
    ...expand("SD Card 128GB", 2, EquipmentCategory.STORAGE, STORE, ["sd-card", "128gb"]),
    ...expand("SD Card 64GB",  4, EquipmentCategory.STORAGE, STORE, ["sd-card", "64gb"]),
    ...expand("SD Card 32GB",  1, EquipmentCategory.STORAGE, STORE, ["sd-card", "32gb"]),

    // ── Batteries & Chargers ─────────────────────────────────────────────────
    ...expand("Sony Z Battery",       5, EquipmentCategory.ACCESSORIES, STORE, ["battery", "sony-z"]),
    ...expand("Sony Z Charger",       1, EquipmentCategory.ACCESSORIES, STORE, ["charger", "sony-z"]),
    ...expand("Sony W Battery",       3, EquipmentCategory.ACCESSORIES, STORE, ["battery", "sony-w"]),
    ...expand("Sony W Charger",       1, EquipmentCategory.ACCESSORIES, STORE, ["charger", "sony-w"]),
    ...expand("LED Battery",          4, EquipmentCategory.ACCESSORIES, STORE, ["battery", "led"]),
    ...expand("LED Charger",          2, EquipmentCategory.ACCESSORIES, STORE, ["charger", "led"]),
    ...expand("Drone Battery",        2, EquipmentCategory.ACCESSORIES, STORE, ["battery", "drone"]),
    ...expand("Drone Charger",        1, EquipmentCategory.ACCESSORIES, STORE, ["charger", "drone"]),
    ...expand("Double A Batteries",   1, EquipmentCategory.ACCESSORIES, STORE, ["battery", "aa"]),
    ...expand("Double A Charger",     3, EquipmentCategory.ACCESSORIES, STORE, ["charger", "aa"]),
    ...expand("Extension 4-Socket",   1, EquipmentCategory.ACCESSORIES, STORE, ["power", "extension"]),
    ...expand("Extension 2-Socket",   1, EquipmentCategory.ACCESSORIES, STORE, ["power", "extension"]),

    // ── Sound / Audio ─────────────────────────────────────────────────────────
    ...expand("Zoom H5N Recorder",      1, EquipmentCategory.AUDIO, STORE, ["recorder", "zoom"]),
    ...expand("Wireless Receiver",      1, EquipmentCategory.AUDIO, STORE, ["wireless", "receiver"]),
    ...expand("Wireless Transmitter",   2, EquipmentCategory.AUDIO, STORE, ["wireless", "transmitter"]),
    ...expand("Wireless Power Bank",    1, EquipmentCategory.AUDIO, STORE, ["wireless", "power-bank"]),
    ...expand("Wireless Earphone",      1, EquipmentCategory.AUDIO, STORE, ["wireless", "earphone"]),
    ...expand("XLR Connector",          2, EquipmentCategory.AUDIO, STORE, ["xlr", "connector"]),
    ...expand("XLR Cable",              1, EquipmentCategory.AUDIO, STORE, ["xlr", "cable"]),
    ...expand("2G Wireless Mic",        1, EquipmentCategory.AUDIO, STORE, ["wireless", "mic"]),
    ...expand("Sennheiser G4x",         3, EquipmentCategory.AUDIO, STORE, ["sennheiser", "wireless", "lavalier"]),
    ...expand("Lavalier Mic",           3, EquipmentCategory.AUDIO, STORE, ["lavalier", "mic"]),
    ...expand("Rode NTG4+ Shotgun Mic", 1, EquipmentCategory.AUDIO, STORE, ["rode", "shotgun", "mic"]),
    ...expand("Boom Pole",              1, EquipmentCategory.AUDIO, STORE, ["boom", "pole"]),
    ...expand("Audio Mixer",            1, EquipmentCategory.AUDIO, STORE, ["mixer", "audio"]),
    ...expand("Room Mic",               1, EquipmentCategory.AUDIO, STORE, ["mic", "room"]),

    // ── Lighting & Modifiers ─────────────────────────────────────────────────
    ...expand("LED 900 H4",           1, EquipmentCategory.LIGHTING, STORE, ["led", "continuous"]),
    ...expand("Aputure 1200D",        1, EquipmentCategory.LIGHTING, STORE, ["aputure", "led", "continuous"]),
    ...expand("NanLite 720",          1, EquipmentCategory.LIGHTING, STORE, ["nanlite", "led", "continuous"]),
    ...expand("Fresnel Tube",         1, EquipmentCategory.LIGHTING, STORE, ["fresnel", "modifier"]),
    ...expand("LED Panel",            1, EquipmentCategory.LIGHTING, STORE, ["led", "panel"]),
    ...expand("Projector",            1, EquipmentCategory.LIGHTING, STORE, ["projector"]),
    ...expand("Godox 600",            1, EquipmentCategory.LIGHTING, STORE, ["godox", "strobe", "600"]),
    ...expand("Godox 400",            2, EquipmentCategory.LIGHTING, STORE, ["godox", "strobe", "400"]),
    ...expand("Rectangle Softbox",   1, EquipmentCategory.LIGHTING, STORE, ["softbox", "modifier"]),
    ...expand("Lantern Softbox",      1, EquipmentCategory.LIGHTING, STORE, ["lantern", "modifier"]),
    ...expand("Flash & Trigger",      1, EquipmentCategory.LIGHTING, STORE, ["flash", "trigger"]),
    ...expand("Aputure Mic",          1, EquipmentCategory.AUDIO,    STORE, ["aputure", "mic"]),
    ...expand("Falcon Eyes",          1, EquipmentCategory.LIGHTING, STORE, ["falcon-eyes", "led"]),
    ...expand("Godox Diffuser",       1, EquipmentCategory.LIGHTING, STORE, ["godox", "diffuser", "modifier"]),

    // ── Support / Grip ────────────────────────────────────────────────────────
    ...expand("Tripod Manfrotto",      3, EquipmentCategory.GRIP, STORE, ["tripod", "manfrotto"]),
    ...expand("Monopod",               2, EquipmentCategory.GRIP, STORE, ["monopod"]),
    ...expand("DJI RS3 Gimbal",        1, EquipmentCategory.GRIP, STORE, ["gimbal", "dji", "stabiliser"]),
    ...expand("Base Plate",            4, EquipmentCategory.GRIP, STORE, ["base-plate", "rig"]),
    ...expand("Walkie Talkie",         3, EquipmentCategory.ACCESSORIES, STORE, ["walkie-talkie", "comms"]),
    ...expand("Camera Straps",         1, EquipmentCategory.ACCESSORIES, STORE, ["strap", "camera"]),
    ...expand("Type-C Charger (Gimbal)", 1, EquipmentCategory.ACCESSORIES, STORE, ["charger", "usb-c", "gimbal"]),
    ...expand("Filter",                1, EquipmentCategory.LENS,        STORE, ["filter"]),
    ...expand("Fast Charger",          1, EquipmentCategory.ACCESSORIES, STORE, ["charger", "fast"]),
    ...expand("Small Camera Bag",      1, EquipmentCategory.ACCESSORIES, STORE, ["bag", "camera"]),
    ...expand("Lightstand",            1, EquipmentCategory.GRIP, STORE, ["lightstand", "stand"]),
    ...expand("Backdrop",              1, EquipmentCategory.GRIP, STORE, ["backdrop", "background"]),
    ...expand("Drone SD Card",         1, EquipmentCategory.STORAGE,     STORE, ["sd-card", "drone"]),
  ];

  let created = 0;
  for (const item of equipment) {
    await prisma.equipment.create({ data: item });
    created++;
  }

  console.log(`✅ ${created} equipment items seeded.`);
  console.log("\n🎉 Database seeded successfully.");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
