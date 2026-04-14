import nodemailer from "nodemailer";
import { env } from "../config/env";

const transporter = nodemailer.createTransport({
  host: env.EMAIL_HOST,
  port: env.EMAIL_PORT,
  secure: false,
  auth: env.EMAIL_USER ? { user: env.EMAIL_USER, pass: env.EMAIL_PASS } : undefined,
});

export async function sendWelcomeEmail(to: string, name: string, tempPassword: string) {
  if (!env.EMAIL_USER) return; // skip if email not configured
  await transporter.sendMail({
    from: env.EMAIL_FROM,
    to,
    subject: "Welcome to Caminet — 35 Stripes Film & Production",
    text: [
      `Hi ${name},`,
      "",
      "Your Caminet account has been created.",
      `Email:    ${to}`,
      `Password: ${tempPassword}`,
      "",
      "Please log in and change your password immediately.",
      "",
      "— 35 Stripes Film & Production",
    ].join("\n"),
  });
}
