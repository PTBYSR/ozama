import { NextRequest } from "next/server";
import crypto from "crypto";

const DEFAULT_ADMIN_PASS = "Godisgood123";

export function getAdminPassword(): string {
  return process.env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASS;
}

export function generateAdminToken(password: string): string {
  const secret = process.env.ADMIN_SECRET || "ozama_secret_funding_key_2026";
  return crypto.createHmac("sha256", secret).update(password).digest("hex");
}

export function verifyAdminToken(token: string | null | undefined): boolean {
  if (!token) return false;
  const expected = generateAdminToken(getAdminPassword());
  return token === expected;
}

export function checkAdminRequest(req: NextRequest): boolean {
  const authHeader = req.headers.get("authorization") || "";
  const bearerToken = authHeader.replace(/^Bearer\s+/i, "").trim();

  if (bearerToken && verifyAdminToken(bearerToken)) {
    return true;
  }

  const cookieToken = req.cookies.get("ozama_admin_token")?.value;
  if (cookieToken && verifyAdminToken(cookieToken)) {
    return true;
  }

  return false;
}
