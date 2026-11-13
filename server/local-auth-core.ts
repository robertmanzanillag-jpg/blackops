import { randomBytes, timingSafeEqual, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import type { User } from "@shared/schema";

const scrypt = promisify(scryptCallback);
const PASSWORD_PREFIX = "scrypt";
const SCRYPT_KEY_LENGTH = 64;

export function sanitizeAuthUser(user: User): { id: string; username: string } {
  return {
    id: user.id,
    username: user.username,
  };
}

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function isLocalAuthEnabled(): boolean {
  if (process.env.LOCAL_AUTH_ENABLED === "true") return true;
  if (process.env.LOCAL_AUTH_ENABLED === "false") return false;
  if (process.env.NODE_ENV === "production" && process.env.SESSION_SECRET) return true;
  return ["development", "test"].includes(process.env.NODE_ENV || "");
}

export function isLocalAuthRegistrationAllowed(): boolean {
  if (process.env.ALLOW_LOCAL_AUTH_REGISTRATION === "true") return true;
  if (process.env.ALLOW_LOCAL_AUTH_REGISTRATION === "false") return false;
  return ["development", "test"].includes(process.env.NODE_ENV || "");
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = await scrypt(password, salt, SCRYPT_KEY_LENGTH) as Buffer;
  return `${PASSWORD_PREFIX}$${salt}$${derivedKey.toString("hex")}`;
}

export async function verifyPassword(password: string, storedPassword: string): Promise<boolean> {
  const [prefix, salt, hash] = storedPassword.split("$");
  if (prefix !== PASSWORD_PREFIX || !salt || !hash) return false;

  const expected = Buffer.from(hash, "hex");
  const actual = await scrypt(password, salt, expected.length) as Buffer;
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
