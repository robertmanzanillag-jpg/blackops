import { randomBytes } from "crypto";
import type { Request } from "express";
import { hasRealValue } from "./ceo-doctor-cli";
import { hasConnectedReplitGoogleConnector, hasReplitGoogleConnectorEnv } from "./google-calendar";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const DEFAULT_GOOGLE_DRIVE_SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
].join(" ");

const GOOGLE_DRIVE_CLIENT_ID_ENV_VARS = [
  "GOOGLE_DRIVE_CLIENT_ID",
  "GOOGLE_DRIVE_OAUTH_CLIENT_ID",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_ID",
  "YOUTUBE_CLIENT_ID",
  "YOUTUBE_OAUTH_CLIENT_ID",
];

const GOOGLE_DRIVE_CLIENT_SECRET_ENV_VARS = [
  "GOOGLE_DRIVE_CLIENT_SECRET",
  "GOOGLE_DRIVE_OAUTH_CLIENT_SECRET",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "YOUTUBE_CLIENT_SECRET",
  "YOUTUBE_OAUTH_CLIENT_SECRET",
];

const GOOGLE_DRIVE_REFRESH_TOKEN_ENV_VARS = [
  "GOOGLE_DRIVE_REFRESH_TOKEN",
  "GOOGLE_REFRESH_TOKEN",
  "GOOGLE_OAUTH_REFRESH_TOKEN",
  "YOUTUBE_REFRESH_TOKEN",
];

interface PendingGoogleDriveAuth {
  userId: string;
  redirectUri: string;
  createdAt: number;
}

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  token_type?: string;
}

const pendingAuth = new Map<string, PendingGoogleDriveAuth>();

async function getOAuth2ClientConstructor() {
  return (await import("google-auth-library/build/src/auth/oauth2client.js")).OAuth2Client;
}

async function getStorage() {
  return (await import("./storage")).storage;
}

async function getStorageForStatus() {
  return Promise.race([
    getStorage(),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Storage status lookup timed out.")), 500)),
  ]);
}

function getFirstEnvValue(names: string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (hasRealValue(value)) return value;
  }
  return "";
}

function getGoogleDriveClientConfig() {
  const clientId = getFirstEnvValue(GOOGLE_DRIVE_CLIENT_ID_ENV_VARS);
  const clientSecret = getFirstEnvValue(GOOGLE_DRIVE_CLIENT_SECRET_ENV_VARS);

  if (!clientId || !clientSecret) {
    throw new Error("Google Drive OAuth is not configured. Add GOOGLE_CLIENT_ID/GOOGLE_OAUTH_CLIENT_ID and GOOGLE_CLIENT_SECRET/GOOGLE_OAUTH_CLIENT_SECRET.");
  }

  return { clientId, clientSecret };
}

export function hasGoogleDriveOAuthClientConfig(): boolean {
  return Boolean(
    getFirstEnvValue(GOOGLE_DRIVE_CLIENT_ID_ENV_VARS) &&
    getFirstEnvValue(GOOGLE_DRIVE_CLIENT_SECRET_ENV_VARS)
  );
}

export function getGoogleDriveRefreshTokenFromEnv(): string {
  return getFirstEnvValue(GOOGLE_DRIVE_REFRESH_TOKEN_ENV_VARS);
}

export function resolveGoogleDriveRedirectUri(req: Request): string {
  if (hasRealValue(process.env.GOOGLE_DRIVE_REDIRECT_URI)) return process.env.GOOGLE_DRIVE_REDIRECT_URI;

  const publicAppUrl = [process.env.PUBLIC_APP_URL, process.env.EXPO_PUBLIC_DOMAIN].find(hasRealValue);
  if (publicAppUrl) {
    const origin = publicAppUrl.startsWith("http") ? publicAppUrl : `https://${publicAppUrl}`;
    return `${origin.replace(/\/$/, "")}/api/google-drive/oauth/callback`;
  }

  const host = req.get("host") || "localhost:5000";
  const protocol = host.includes("replit") || host.includes(".app") ? "https" : req.protocol;
  return `${protocol}://${host}/api/google-drive/oauth/callback`;
}

export function createGoogleDriveAuthorizationUrl(userId: string, req: Request): string {
  const { clientId } = getGoogleDriveClientConfig();
  const state = randomBytes(48).toString("base64url");
  const redirectUri = resolveGoogleDriveRedirectUri(req);
  const scope = hasRealValue(process.env.GOOGLE_DRIVE_SCOPES) ? process.env.GOOGLE_DRIVE_SCOPES : DEFAULT_GOOGLE_DRIVE_SCOPES;

  pendingAuth.set(state, {
    userId,
    redirectUri,
    createdAt: Date.now(),
  });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope,
    state,
    access_type: "offline",
    prompt: "consent",
  });

  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

async function requestGoogleToken(body: URLSearchParams): Promise<GoogleTokenResponse> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const text = await response.text();
  const parsed = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(parsed.error_description || parsed.error || `Google token request failed (${response.status})`);
  }

  return parsed as GoogleTokenResponse;
}

async function saveTokenResponse(userId: string, token: GoogleTokenResponse, existingRefreshToken?: string | null) {
  const refreshToken = token.refresh_token || existingRefreshToken;
  if (!refreshToken) {
    throw new Error("Google did not return a refresh token. Reconnect Google Drive and approve offline access.");
  }

  const expiresAt = new Date(Date.now() + Math.max(token.expires_in - 60, 60) * 1000);
  const storage = await getStorage();
  await storage.saveGoogleDriveOAuthToken(userId, {
    userId,
    accessToken: token.access_token,
    refreshToken,
    scope: token.scope || null,
    expiresAt,
  });
}

export async function exchangeGoogleDriveAuthorizationCode(params: {
  code: string;
  state: string;
}): Promise<{ userId: string; scope?: string }> {
  const pending = pendingAuth.get(params.state);
  if (!pending) {
    throw new Error("Google Drive OAuth state expired. Start the Drive connection again.");
  }

  pendingAuth.delete(params.state);
  const { clientId, clientSecret } = getGoogleDriveClientConfig();
  const token = await requestGoogleToken(new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code: params.code,
    grant_type: "authorization_code",
    redirect_uri: pending.redirectUri,
  }));

  await saveTokenResponse(pending.userId, token);
  return { userId: pending.userId, scope: token.scope };
}

export async function getGoogleDriveOAuthClient(userId: string) {
  const { clientId, clientSecret } = getGoogleDriveClientConfig();
  const OAuth2Client = await getOAuth2ClientConstructor();
  const oauth2Client = new OAuth2Client(clientId, clientSecret);

  const envRefreshToken = getGoogleDriveRefreshTokenFromEnv();
  if (envRefreshToken) {
    oauth2Client.setCredentials({
      refresh_token: envRefreshToken,
    });
    return oauth2Client;
  }

  const storage = await getStorage();
  const existing = await storage.getGoogleDriveOAuthToken(userId);
  if (!existing) {
    throw new Error("Google Drive is not connected. Open /api/google-drive/auth to connect Drive.");
  }

  if (existing.expiresAt.getTime() > Date.now() + 60_000) {
    oauth2Client.setCredentials({
      access_token: existing.accessToken,
      refresh_token: existing.refreshToken,
      expiry_date: existing.expiresAt.getTime(),
    });
    return oauth2Client;
  }

  const token = await requestGoogleToken(new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: existing.refreshToken,
  }));
  await saveTokenResponse(userId, token, existing.refreshToken);

  oauth2Client.setCredentials({
    access_token: token.access_token,
    refresh_token: token.refresh_token || existing.refreshToken,
    expiry_date: Date.now() + token.expires_in * 1000,
  });
  return oauth2Client;
}

export async function getGoogleDriveOAuthStatus(userId: string) {
  const envConnected = Boolean(getGoogleDriveRefreshTokenFromEnv());
  const replitConnectorAvailable = hasReplitGoogleConnectorEnv();
  const replitConnectorConnected = !envConnected && replitConnectorAvailable
    ? await hasConnectedReplitGoogleConnector()
    : false;
  const configured = Boolean(envConnected || replitConnectorAvailable || hasGoogleDriveOAuthClientConfig());
  let token = null;
  let storageError: string | null = null;

  const localStorageAvailable = hasRealValue(process.env.DATABASE_URL);
  if (!envConnected && !replitConnectorAvailable && hasGoogleDriveOAuthClientConfig() && localStorageAvailable) {
    try {
      const storage = await getStorageForStatus();
      token = await storage.getGoogleDriveOAuthToken(userId);
    } catch (error: any) {
      storageError = error.message || "No se pudo leer el token de Google Drive.";
    }
  }

  return {
    configured,
    connected: Boolean(envConnected || replitConnectorConnected || token),
    provider: envConnected ? "env_refresh_token" : replitConnectorConnected ? "replit_connector" : token ? "local_oauth" : null,
    expiresAt: token?.expiresAt || null,
    scope: token?.scope || (hasRealValue(process.env.GOOGLE_DRIVE_SCOPES) ? process.env.GOOGLE_DRIVE_SCOPES : DEFAULT_GOOGLE_DRIVE_SCOPES),
    redirectUri: hasRealValue(process.env.GOOGLE_DRIVE_REDIRECT_URI) ? process.env.GOOGLE_DRIVE_REDIRECT_URI : null,
    storageError,
  };
}
