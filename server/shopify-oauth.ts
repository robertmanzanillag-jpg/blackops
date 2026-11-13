import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { chmod, readFile, writeFile } from "fs/promises";
import path from "path";
import type { Request } from "express";
import { hasRealValue } from "./ceo-doctor-cli";

const SHOPIFY_TOKEN_PATH = "/admin/oauth/access_token";
const DEFAULT_SHOPIFY_SCOPES = "read_products,write_products";

interface PendingShopifyAuth {
  shop: string;
  redirectUri: string;
  createdAt: number;
}

interface ShopifyTokenResponse {
  access_token: string;
  scope?: string;
}

const pendingAuth = new Map<string, PendingShopifyAuth>();

function getFirstEnvValue(names: string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (hasRealValue(value)) return value!.trim();
  }
  return "";
}

function normalizeShopDomain(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/^https?:\/\//, "").replace(/^admin\.shopify\.com\/store\//, "").replace(/\/.*$/, "");
}

export function isValidShopifyShopDomain(value: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(value);
}

function getShopifyClientConfig() {
  const clientId = getFirstEnvValue(["SHOPIFY_APP_CLIENT_ID", "SHOPIFY_CLIENT_ID"]);
  const clientSecret = getFirstEnvValue(["SHOPIFY_APP_CLIENT_SECRET", "SHOPIFY_CLIENT_SECRET"]);

  if (!clientId || !clientSecret) {
    throw new Error("Shopify OAuth is not configured. Add SHOPIFY_APP_CLIENT_ID and SHOPIFY_APP_CLIENT_SECRET.");
  }

  return { clientId, clientSecret };
}

export function hasShopifyOAuthClientConfig(): boolean {
  return Boolean(
    getFirstEnvValue(["SHOPIFY_APP_CLIENT_ID", "SHOPIFY_CLIENT_ID"]) &&
    getFirstEnvValue(["SHOPIFY_APP_CLIENT_SECRET", "SHOPIFY_CLIENT_SECRET"])
  );
}

export function resolveShopifyRedirectUri(req: Request): string {
  if (hasRealValue(process.env.SHOPIFY_OAUTH_REDIRECT_URI)) return process.env.SHOPIFY_OAUTH_REDIRECT_URI!;

  const publicAppUrl = [process.env.PUBLIC_APP_URL, process.env.PUBLIC_BASE_URL, process.env.EXPO_PUBLIC_DOMAIN].find(hasRealValue);
  if (publicAppUrl) {
    const origin = publicAppUrl!.startsWith("http") ? publicAppUrl! : `https://${publicAppUrl}`;
    return `${origin.replace(/\/$/, "")}/api/shopify/oauth/callback`;
  }

  const host = req.get("host") || "localhost:5000";
  const protocol = host.includes("replit") || host.includes(".app") ? "https" : req.protocol;
  return `${protocol}://${host}/api/shopify/oauth/callback`;
}

function getShopifyScopes(): string {
  return hasRealValue(process.env.SHOPIFY_OAUTH_SCOPES) ? process.env.SHOPIFY_OAUTH_SCOPES! : DEFAULT_SHOPIFY_SCOPES;
}

function getHmacMessage(query: Record<string, unknown>) {
  const pairs = Object.entries(query)
    .filter(([key]) => key !== "hmac" && key !== "signature")
    .flatMap(([key, rawValue]) => {
      const values = Array.isArray(rawValue) ? rawValue : [rawValue];
      return values
        .filter((value): value is string => typeof value === "string")
        .map((value) => `${key}=${value}`);
    })
    .sort();
  return pairs.join("&");
}

export function verifyShopifyHmac(query: Record<string, unknown>, secret: string): boolean {
  const received = typeof query.hmac === "string" ? query.hmac : "";
  if (!received || !secret) return false;

  const digest = createHmac("sha256", secret).update(getHmacMessage(query)).digest("hex");
  const receivedBuffer = Buffer.from(received, "utf8");
  const digestBuffer = Buffer.from(digest, "utf8");
  return receivedBuffer.length === digestBuffer.length && timingSafeEqual(receivedBuffer, digestBuffer);
}

export function createShopifyAuthorizationUrl(params: {
  shop: string;
  req: Request;
  verifyInstallHmac?: boolean;
}) {
  const shop = normalizeShopDomain(params.shop);
  if (!isValidShopifyShopDomain(shop)) {
    throw new Error("Invalid Shopify shop domain. Use a value like store-name.myshopify.com.");
  }

  const { clientId, clientSecret } = getShopifyClientConfig();
  if (params.verifyInstallHmac && !verifyShopifyHmac(params.req.query, clientSecret)) {
    throw new Error("Shopify install request failed HMAC verification.");
  }

  const state = randomBytes(48).toString("base64url");
  const redirectUri = resolveShopifyRedirectUri(params.req);
  pendingAuth.set(state, { shop, redirectUri, createdAt: Date.now() });

  const query = new URLSearchParams({
    client_id: clientId,
    scope: getShopifyScopes(),
    redirect_uri: redirectUri,
    state,
  });

  return `https://${shop}/admin/oauth/authorize?${query.toString()}`;
}

async function requestShopifyToken(shop: string, body: URLSearchParams): Promise<ShopifyTokenResponse> {
  const response = await fetch(`https://${shop}${SHOPIFY_TOKEN_PATH}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const text = await response.text();
  const parsed = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(parsed.error_description || parsed.error || `Shopify token request failed (${response.status})`);
  }

  return parsed as ShopifyTokenResponse;
}

function upsertEnvLine(raw: string, envVar: string, value: string): string {
  const nextLine = `${envVar}=${value}`;
  const lines = raw.split(/\r?\n/);
  let replaced = false;
  const nextLines = lines.map((line) => {
    const key = line.split("=", 1)[0]?.trim();
    if (key !== envVar) return line;
    replaced = true;
    return nextLine;
  });
  if (!replaced) {
    if (nextLines.length && nextLines[nextLines.length - 1] !== "") nextLines.push("");
    nextLines.push(nextLine);
  }
  return nextLines.join("\n").replace(/\n{3,}/g, "\n\n");
}

async function saveShopifyEnv(shop: string, token: string) {
  const envFilePath = path.resolve(process.env.SHOPIFY_OAUTH_ENV_PATH || path.join(process.cwd(), "CEO_ASSISTANT_ENV"));
  let next = await readFile(envFilePath, "utf8").catch(() => "");
  next = upsertEnvLine(next, "SHOPIFY_SHOP_DOMAIN", shop);
  next = upsertEnvLine(next, "SHOPIFY_ADMIN_ACCESS_TOKEN", token);
  next = upsertEnvLine(next, "SHOPIFY_API_VERSION", process.env.SHOPIFY_API_VERSION || "2026-04");
  await writeFile(envFilePath, next, { mode: 0o600 });
  await chmod(envFilePath, 0o600).catch(() => undefined);

  process.env.SHOPIFY_SHOP_DOMAIN = shop;
  process.env.SHOPIFY_ADMIN_ACCESS_TOKEN = token;
  process.env.SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-04";

  return envFilePath;
}

export async function exchangeShopifyAuthorizationCode(params: {
  code: string;
  state: string;
  shop: string;
  query: Record<string, unknown>;
}) {
  const pending = pendingAuth.get(params.state);
  if (!pending) {
    throw new Error("Shopify OAuth state expired. Start the Shopify connection again.");
  }

  pendingAuth.delete(params.state);
  const shop = normalizeShopDomain(params.shop);
  if (shop !== pending.shop || !isValidShopifyShopDomain(shop)) {
    throw new Error("Shopify OAuth shop mismatch.");
  }

  const { clientId, clientSecret } = getShopifyClientConfig();
  if (!verifyShopifyHmac(params.query, clientSecret)) {
    throw new Error("Shopify OAuth callback failed HMAC verification.");
  }

  const token = await requestShopifyToken(shop, new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code: params.code,
  }));

  const envFilePath = await saveShopifyEnv(shop, token.access_token);
  return { shop, scope: token.scope || getShopifyScopes(), envFilePath };
}

export function getShopifyOAuthStatus() {
  const shopDomain = normalizeShopDomain(process.env.SHOPIFY_SHOP_DOMAIN);
  const envTokenConfigured = hasRealValue(process.env.SHOPIFY_ADMIN_ACCESS_TOKEN);
  return {
    configured: hasShopifyOAuthClientConfig() || Boolean(shopDomain && envTokenConfigured),
    connected: Boolean(shopDomain && envTokenConfigured),
    shopDomain: shopDomain || null,
    apiVersion: process.env.SHOPIFY_API_VERSION || "2026-04",
    oauthConfigured: hasShopifyOAuthClientConfig(),
    redirectUri: hasRealValue(process.env.SHOPIFY_OAUTH_REDIRECT_URI) ? process.env.SHOPIFY_OAUTH_REDIRECT_URI : null,
    scopes: getShopifyScopes(),
  };
}
