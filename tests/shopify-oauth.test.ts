import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { afterEach, beforeEach } from "node:test";
import {
  createShopifyAuthorizationUrl,
  exchangeShopifyAuthorizationCode,
  getShopifyOAuthStatus,
  isValidShopifyShopDomain,
  verifyShopifyHmac,
} from "../server/shopify-oauth";

const originalEnv = { ...process.env };
const originalFetch = global.fetch;

function mockReq(overrides: { query?: Record<string, unknown>; host?: string; protocol?: string } = {}) {
  return {
    query: overrides.query || {},
    protocol: overrides.protocol || "https",
    get(name: string) {
      if (name.toLowerCase() === "host") return overrides.host || "robplanner.replit.app";
      return undefined;
    },
  } as any;
}

function signedQuery(values: Record<string, string>, secret: string) {
  const message = Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join("&");
  return {
    ...values,
    hmac: createHmac("sha256", secret).update(message).digest("hex"),
  };
}

beforeEach(() => {
  process.env = { ...originalEnv };
  process.env.SHOPIFY_APP_CLIENT_ID = "shopify-client-id";
  process.env.SHOPIFY_APP_CLIENT_SECRET = "shopify-client-secret";
  process.env.PUBLIC_APP_URL = "https://robplanner.replit.app";
  process.env.SHOPIFY_OAUTH_SCOPES = "read_products,write_products";
  delete process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  delete process.env.SHOPIFY_SHOP_DOMAIN;
});

afterEach(() => {
  process.env = { ...originalEnv };
  global.fetch = originalFetch;
});

test("validates Shopify shop domains", () => {
  assert.equal(isValidShopifyShopDomain("une5m2-ru.myshopify.com"), true);
  assert.equal(isValidShopifyShopDomain("https://une5m2-ru.myshopify.com"), false);
  assert.equal(isValidShopifyShopDomain("bad.example.com"), false);
});

test("creates Shopify authorization URL without exposing client secret", () => {
  const url = new URL(createShopifyAuthorizationUrl({
    shop: "https://une5m2-ru.myshopify.com/",
    req: mockReq(),
  }));

  assert.equal(url.origin, "https://une5m2-ru.myshopify.com");
  assert.equal(url.pathname, "/admin/oauth/authorize");
  assert.equal(url.searchParams.get("client_id"), "shopify-client-id");
  assert.equal(url.searchParams.get("scope"), "read_products,write_products");
  assert.equal(url.searchParams.get("redirect_uri"), "https://robplanner.replit.app/api/shopify/oauth/callback");
  assert.equal(url.toString().includes("shopify-client-secret"), false);
  assert.ok(url.searchParams.get("state"));
});

test("verifies Shopify HMAC from sorted query parameters", () => {
  const query = signedQuery({
    code: "authorization-code",
    shop: "une5m2-ru.myshopify.com",
    state: "state-value",
    timestamp: "1781785204",
  }, "shopify-client-secret");

  assert.equal(verifyShopifyHmac(query, "shopify-client-secret"), true);
  assert.equal(verifyShopifyHmac({ ...query, shop: "evil.myshopify.com" }, "shopify-client-secret"), false);
});

test("exchanges Shopify authorization code and stores env values without returning token", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "shopify-oauth-"));
  const envPath = path.join(tempDir, "CEO_ASSISTANT_ENV");
  process.env.SHOPIFY_OAUTH_ENV_PATH = envPath;

  const authUrl = new URL(createShopifyAuthorizationUrl({
    shop: "une5m2-ru.myshopify.com",
    req: mockReq(),
  }));
  const state = authUrl.searchParams.get("state")!;
  const query = signedQuery({
    code: "authorization-code",
    shop: "une5m2-ru.myshopify.com",
    state,
    timestamp: "1781785204",
  }, "shopify-client-secret");

  let requestedUrl = "";
  global.fetch = (async (url, init) => {
    requestedUrl = String(url);
    assert.equal((init as RequestInit).method, "POST");
    return new Response(JSON.stringify({
      access_token: "shpat_secret_token",
      scope: "read_products,write_products",
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  const result = await exchangeShopifyAuthorizationCode({
    code: "authorization-code",
    state,
    shop: "une5m2-ru.myshopify.com",
    query,
  });

  assert.equal(requestedUrl, "https://une5m2-ru.myshopify.com/admin/oauth/access_token");
  assert.equal(result.shop, "une5m2-ru.myshopify.com");
  assert.equal(JSON.stringify(result).includes("shpat_secret_token"), false);
  assert.equal(process.env.SHOPIFY_SHOP_DOMAIN, "une5m2-ru.myshopify.com");
  assert.equal(process.env.SHOPIFY_ADMIN_ACCESS_TOKEN, "shpat_secret_token");

  const env = await readFile(envPath, "utf8");
  assert.match(env, /SHOPIFY_SHOP_DOMAIN=une5m2-ru\.myshopify\.com/);
  assert.match(env, /SHOPIFY_ADMIN_ACCESS_TOKEN=shpat_secret_token/);
  assert.equal(getShopifyOAuthStatus().connected, true);

  await rm(tempDir, { recursive: true, force: true });
});
