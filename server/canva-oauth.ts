import { createHash, randomBytes } from "crypto";
import type { Request } from "express";
import { hasRealValue } from "./ceo-doctor-cli";
import { storage } from "./storage";

const CANVA_AUTH_URL = "https://www.canva.com/api/oauth/authorize";
const CANVA_TOKEN_URL = "https://api.canva.com/rest/v1/oauth/token";
const DEFAULT_CANVA_SCOPES = [
  "brandtemplate:content:read",
  "brandtemplate:meta:read",
  "design:content:read",
  "design:content:write",
].join(" ");

interface PendingCanvaAuth {
  userId: string;
  codeVerifier: string;
  redirectUri: string;
  createdAt: number;
}

interface CanvaTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope?: string;
}

const pendingAuth = new Map<string, PendingCanvaAuth>();

function getCanvaClientConfig() {
  const clientId = process.env.CANVA_CLIENT_ID;
  const clientSecret = process.env.CANVA_CLIENT_SECRET;

  if (!hasRealValue(clientId) || !hasRealValue(clientSecret)) {
    throw new Error("Canva OAuth is not configured. Add CANVA_CLIENT_ID and CANVA_CLIENT_SECRET.");
  }

  return { clientId, clientSecret };
}

function base64UrlSha256(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function getBasicAuthHeader(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

export function resolveCanvaRedirectUri(req: Request): string {
  if (hasRealValue(process.env.CANVA_REDIRECT_URI)) return process.env.CANVA_REDIRECT_URI;

  const publicAppUrl = [process.env.PUBLIC_APP_URL, process.env.EXPO_PUBLIC_DOMAIN].find(hasRealValue);
  if (publicAppUrl) {
    const origin = publicAppUrl.startsWith("http") ? publicAppUrl : `https://${publicAppUrl}`;
    return `${origin.replace(/\/$/, "")}/api/canva/oauth/callback`;
  }

  const host = req.get("host") || "localhost:5000";
  const protocol = host.includes("replit") || host.includes(".app") ? "https" : req.protocol;
  return `${protocol}://${host}/api/canva/oauth/callback`;
}

export function createCanvaAuthorizationUrl(userId: string, req: Request): string {
  const { clientId } = getCanvaClientConfig();
  const codeVerifier = randomBytes(96).toString("base64url");
  const codeChallenge = base64UrlSha256(codeVerifier);
  const state = randomBytes(48).toString("base64url");
  const redirectUri = resolveCanvaRedirectUri(req);
  const scope = hasRealValue(process.env.CANVA_SCOPES) ? process.env.CANVA_SCOPES : DEFAULT_CANVA_SCOPES;

  pendingAuth.set(state, {
    userId,
    codeVerifier,
    redirectUri,
    createdAt: Date.now(),
  });

  const params = new URLSearchParams({
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    scope,
    response_type: "code",
    client_id: clientId,
    state,
    redirect_uri: redirectUri,
  });

  return `${CANVA_AUTH_URL}?${params.toString()}`;
}

async function requestCanvaToken(body: URLSearchParams): Promise<CanvaTokenResponse> {
  const { clientId, clientSecret } = getCanvaClientConfig();
  const response = await fetch(CANVA_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: getBasicAuthHeader(clientId, clientSecret),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const text = await response.text();
  const parsed = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(parsed.message || `Canva token request failed (${response.status})`);
  }

  return parsed as CanvaTokenResponse;
}

async function saveTokenResponse(userId: string, token: CanvaTokenResponse) {
  const expiresAt = new Date(Date.now() + Math.max(token.expires_in - 60, 60) * 1000);
  await storage.saveCanvaOAuthToken(userId, {
    userId,
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    scope: token.scope || null,
    expiresAt,
  });
}

export async function exchangeCanvaAuthorizationCode(params: {
  code: string;
  state: string;
}): Promise<{ userId: string; scope?: string }> {
  const pending = pendingAuth.get(params.state);
  if (!pending) {
    throw new Error("Canva OAuth state expired. Start the Canva connection again.");
  }

  pendingAuth.delete(params.state);
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code_verifier: pending.codeVerifier,
    code: params.code,
    redirect_uri: pending.redirectUri,
  });

  const token = await requestCanvaToken(body);
  await saveTokenResponse(pending.userId, token);
  return { userId: pending.userId, scope: token.scope };
}

export async function getCanvaAccessToken(userId: string): Promise<string> {
  if (hasRealValue(process.env.CANVA_ACCESS_TOKEN)) return process.env.CANVA_ACCESS_TOKEN;

  const existing = await storage.getCanvaOAuthToken(userId);
  if (!existing) {
    throw new Error("Canva OAuth is not connected. Open /api/canva/auth to connect Canva.");
  }

  if (existing.expiresAt.getTime() > Date.now() + 60_000) {
    return existing.accessToken;
  }

  const token = await requestCanvaToken(new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: existing.refreshToken,
  }));
  await saveTokenResponse(userId, token);
  return token.access_token;
}

export async function getCanvaOAuthStatus(userId: string) {
  const token = await storage.getCanvaOAuthToken(userId);
  const envTokenConfigured = hasRealValue(process.env.CANVA_ACCESS_TOKEN);
  const clientConfigured = hasRealValue(process.env.CANVA_CLIENT_ID)
    && hasRealValue(process.env.CANVA_CLIENT_SECRET);
  return {
    configured: envTokenConfigured || clientConfigured,
    connected: envTokenConfigured || Boolean(token),
    expiresAt: token?.expiresAt || null,
    scope: token?.scope || null,
    redirectUri: hasRealValue(process.env.CANVA_REDIRECT_URI) ? process.env.CANVA_REDIRECT_URI : null,
  };
}
