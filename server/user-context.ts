import type { NextFunction, Request, Response } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { hasRealValue } from "./ceo-doctor-cli";

export const DEFAULT_DEV_USER_ID = "mock-user-123";
export const LOCAL_AUTH_USER_COOKIE_NAME = "blackops.uid";

type RequestWithAuth = Request & {
  user?: { id?: string; userId?: string; sub?: string };
  session?: {
    userId?: string;
    user?: { id?: string; userId?: string; sub?: string };
  };
};

const PUBLIC_API_PATHS = [
  "/api/auth/me",
  "/api/auth/register",
  "/api/auth/login",
  "/api/auth/logout",
  // Partner invitations: the invitee has no account yet. The token is checked in the handler
  // (sha256 hash lookup, single-use, 7-day expiry); see server/workspace-access.ts.
  "/api/workspace/invitations/preview",
  "/api/workspace/invitations/accept",
  "/api/telegram/webhook",
  "/api/stripe/revenue-webhook",
  "/api/google-drive/oauth/callback",
  "/api/canva/oauth/callback",
  "/api/zoho/callback",
  "/api/blackroom-agent/remote",
  "/api/blackroom-agent/analytics/import",
  "/api/blackroom-agent/metricool/schedule",
];

// These device endpoints remain protected by the BlackRoom bearer token in
// their route handlers. They must bypass browser-session auth so the signed
// local worker and Metricool can exchange media without a user cookie.
const PUBLIC_API_PATTERNS: RegExp[] = [
  /^\/api\/blackroom-agent\/media\/[^/]+$/,
  /^\/api\/blackroom-agent\/media\/chunked\/[^/]+\/(?:\d+|complete)$/,
  /^\/api\/public\/local-news(?:\/[^/]+)?$/,
];

function cleanUserId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned.length > 0 ? cleaned : null;
}

function getLocalAuthCookieSecret(): string | null {
  const secret = process.env.SESSION_SECRET?.trim();
  return secret ? secret : null;
}

function signLocalAuthCookiePayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createSignedLocalAuthCookieValue(userId: string): string | null {
  const cleanedUserId = cleanUserId(userId);
  const secret = getLocalAuthCookieSecret();
  if (!cleanedUserId || !secret) return null;

  const payload = Buffer.from(cleanedUserId, "utf8").toString("base64url");
  return `v1.${payload}.${signLocalAuthCookiePayload(payload, secret)}`;
}

function verifySignedLocalAuthCookieValue(value: string): string | null {
  const secret = getLocalAuthCookieSecret();
  if (!secret) return null;

  const [version, payload, signature] = value.split(".");
  if (version !== "v1" || !payload || !signature) return null;

  const expected = signLocalAuthCookiePayload(payload, secret);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
    return null;
  }

  try {
    return cleanUserId(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function readCookieHeader(req: Request): string {
  const directHeader = req.headers?.cookie;
  if (typeof directHeader === "string") return directHeader;
  const header = req.header("cookie");
  return typeof header === "string" ? header : "";
}

function readSignedLocalAuthCookie(req: Request): string | null {
  const cookieHeader = readCookieHeader(req);
  const cookies = cookieHeader.split(";").map((part) => part.trim()).filter(Boolean);
  const prefix = `${LOCAL_AUTH_USER_COOKIE_NAME}=`;
  const rawValue = cookies.find((cookie) => cookie.startsWith(prefix))?.slice(prefix.length);
  if (!rawValue) return null;

  try {
    return verifySignedLocalAuthCookieValue(decodeURIComponent(rawValue));
  } catch {
    return null;
  }
}

export function allowsDevUserFallback(): boolean {
  // Request identity injection is available only to explicitly opted-in tests.
  // The publicly reachable development workflow must require a real session.
  return process.env.NODE_ENV === "test" && process.env.ALLOW_DEV_USER_FALLBACK === "true";
}

export function getAuthenticatedCurrentUserId(req: Request): string | null {
  const authReq = req as RequestWithAuth;

  return (
    cleanUserId(authReq.user?.id) ||
    cleanUserId(authReq.user?.userId) ||
    cleanUserId(authReq.user?.sub) ||
    cleanUserId(authReq.session?.userId) ||
    cleanUserId(authReq.session?.user?.id) ||
    cleanUserId(authReq.session?.user?.userId) ||
    cleanUserId(authReq.session?.user?.sub) ||
    readSignedLocalAuthCookie(req)
  );
}

export function resolveCurrentUserId(req: Request): string | null {
  return getAuthenticatedCurrentUserId(req) ||
    (allowsDevUserFallback() ? cleanUserId(req.header("x-user-id")) || DEFAULT_DEV_USER_ID : null);
}

export function isPublicApiPath(path: string): boolean {
  // Express routing is case-insensitive, so compare lowercased paths.
  const lowered = String(path || "").toLowerCase();
  return PUBLIC_API_PATHS.includes(lowered) || PUBLIC_API_PATTERNS.some((pattern) => pattern.test(lowered));
}

function isApiRequestPath(path: string): boolean {
  // Express 4 matches routes case-insensitively: "/API/x" reaches "/api/x" handlers.
  const raw = String(path || "");
  let decoded = raw;
  try { decoded = decodeURIComponent(raw); } catch { /* keep the raw path */ }
  return raw.toLowerCase().startsWith("/api") || decoded.toLowerCase().startsWith("/api");
}

export function resolveRequestApiPath(req: Request): string {
  const request = req as Request & { originalUrl?: string; baseUrl?: string };
  const rawPath = request.originalUrl || `${request.baseUrl || ""}${req.path || ""}`;
  return rawPath.split("?")[0] || "/";
}

export function isPublicApiRequest(req: Request): boolean {
  return isPublicApiPath(resolveRequestApiPath(req));
}

/**
 * Central place for resolving the active application user.
 *
 * Supports provider-neutral auth state (Passport/Replit/Clerk/Auth.js adapters
 * can populate req.user or req.session). Request fallbacks such as x-user-id and
 * the mock user require NODE_ENV=test and ALLOW_DEV_USER_FALLBACK=true.
 * DEFAULT_USER_ID is reserved for system jobs.
 */
export function getCurrentUserId(req: Request): string {
  const userId = resolveCurrentUserId(req);
  if (!userId) {
    const error = new Error("Authentication required") as Error & { status?: number; statusCode?: number };
    error.status = 401;
    error.statusCode = 401;
    throw error;
  }
  return userId;
}

export function requireAppUser(req: Request, res: Response, next: NextFunction): void {
  if (!isApiRequestPath(req.path)) return next();
  if (isPublicApiRequest(req)) return next();

  const userId = resolveCurrentUserId(req);
  if (!userId) {
    res.status(401).json({
      error: "Authentication required",
      reason: "missing_user_context",
    });
    return;
  }

  next();
}

/**
 * User context for background jobs and connector callbacks that do not receive
 * an Express request. Request-bound APIs should use the authenticated request
 * user; schedulers and webhooks should prefer the owner from their stored
 * subscription/configuration. This fallback is only for explicit single-user
 * system jobs and local/dev data migration.
 */
export function getSystemUserId(): string {
  const configuredUserId = cleanUserId(process.env.DEFAULT_USER_ID);
  if (configuredUserId && hasRealValue(configuredUserId)) return configuredUserId;
  if (allowsDevUserFallback()) return DEFAULT_DEV_USER_ID;

  const error = new Error("DEFAULT_USER_ID is required for system jobs when dev fallback is disabled") as Error & { status?: number; statusCode?: number };
  error.status = 500;
  error.statusCode = 500;
  throw error;
}
