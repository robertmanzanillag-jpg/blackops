#!/usr/bin/env node

import { createHash, randomBytes as cryptoRandomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";

const YOUTUBE_UPLOAD_SCOPE = "https://www.googleapis.com/auth/youtube.upload";
const YOUTUBE_READONLY_SCOPE = "https://www.googleapis.com/auth/youtube.readonly";
const REQUIRED_YOUTUBE_SCOPES = Object.freeze([YOUTUBE_UPLOAD_SCOPE, YOUTUBE_READONLY_SCOPE]);
const OFFICIAL_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const LEGACY_OFFICIAL_AUTH_URL = "https://accounts.google.com/o/oauth2/auth";
const OFFICIAL_TOKEN_URL = "https://oauth2.googleapis.com/token";
const CHANNELS_URL = "https://www.googleapis.com/youtube/v3/channels?part=id&mine=true";
const CALLBACK_PATH = "/oauth/callback";
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{20,30}$/;
const SAFE_ENV_VALUE = /^[A-Za-z0-9._~+\/=:-]+$/;

export const DEFAULT_CHANNELS = Object.freeze({
  motivation_es: "UC31lPi3c0ritooHLqvmNMEg",
  motivation_en: "UCKsOxLz4eyw47DMhb4aSaBA",
  sleep: "UCS-xy72lGNTh51p2aICHxcw",
});

const LANES = Object.freeze([
  { lane: "motivation_es", suffix: "ES" },
  { lane: "motivation_en", suffix: "EN" },
  { lane: "sleep", suffix: "SLEEP" },
]);

const clean = (value) => String(value ?? "").trim();
const base64url = (value) => Buffer.from(value).toString("base64url");

function fixedError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

async function readOwnerOnlyRegularJson(filePath) {
  const absolute = path.resolve(filePath);
  const info = await lstat(absolute).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink()) throw fixedError("oauth_client_file_missing_or_unsafe");
  if (typeof process.getuid === "function" && info.uid !== process.getuid()) throw fixedError("oauth_client_file_not_owned_by_current_user");
  if ((info.mode & 0o077) !== 0) throw fixedError("oauth_client_file_must_be_owner_only_0600");
  const parsed = await readFile(absolute, "utf8").then(JSON.parse).catch(() => null);
  if (!parsed) throw fixedError("oauth_client_file_invalid");
  return parsed;
}

export function parseDesktopOAuthClient(document) {
  const installed = document?.installed;
  const clientId = clean(installed?.client_id);
  const clientSecret = clean(installed?.client_secret);
  const authUri = clean(installed?.auth_uri);
  const tokenUri = clean(installed?.token_uri);
  const redirects = Array.isArray(installed?.redirect_uris) ? installed.redirect_uris.map(clean) : [];
  if (!clientId || !clientSecret) throw fixedError("desktop_oauth_client_missing_fields");
  if (!/^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/.test(clientId)) throw fixedError("desktop_oauth_client_id_invalid");
  if (![OFFICIAL_AUTH_URL, LEGACY_OFFICIAL_AUTH_URL].includes(authUri) || tokenUri !== OFFICIAL_TOKEN_URL) {
    throw fixedError("desktop_oauth_client_endpoint_not_official");
  }
  if (!redirects.some((uri) => uri === "http://localhost" || uri === "http://127.0.0.1")) {
    throw fixedError("desktop_oauth_client_loopback_redirect_missing");
  }
  if (![clientId, clientSecret].every((value) => SAFE_ENV_VALUE.test(value))) throw fixedError("desktop_oauth_client_value_unsafe");
  // Google still downloads some Desktop clients with its legacy official
  // authorization URL. Accept that trusted input, but always send the browser
  // through Google's current v2 endpoint.
  return { clientId, clientSecret, authUri: OFFICIAL_AUTH_URL, tokenUri };
}

function normalizedChannels(channels = {}) {
  const result = {};
  for (const { lane } of LANES) {
    const channelId = clean(channels[lane]);
    if (!CHANNEL_ID.test(channelId)) throw fixedError(`expected_channel_id_invalid_${lane}`);
    result[lane] = channelId;
  }
  if (new Set(Object.values(result)).size !== LANES.length) throw fixedError("expected_channel_ids_must_be_distinct");
  return result;
}

function defaultOpenBrowser(url) {
  const child = spawn("open", [url], { stdio: "ignore", detached: true });
  child.unref();
}

async function responseJson(response) {
  try { return await response.json(); } catch { return null; }
}

async function exchangeAuthorizationCode({ client, code, verifier, redirectUri, fetcher }) {
  const response = await fetcher(client.tokenUri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });
  const payload = await responseJson(response);
  if (!response.ok) throw fixedError("oauth_code_exchange_failed");
  const accessToken = clean(payload?.access_token);
  const refreshToken = clean(payload?.refresh_token);
  if (!accessToken || !refreshToken || !SAFE_ENV_VALUE.test(refreshToken)) throw fixedError("oauth_offline_tokens_missing_or_unsafe");
  const granted = clean(payload?.scope).split(/\s+/).filter(Boolean);
  if (!REQUIRED_YOUTUBE_SCOPES.every((scope) => granted.includes(scope))) {
    throw fixedError("youtube_required_scopes_not_granted");
  }
  return { accessToken, refreshToken };
}

async function verifyAuthenticatedChannel({ accessToken, expectedChannelId, fetcher }) {
  const response = await fetcher(CHANNELS_URL, { headers: { authorization: `Bearer ${accessToken}` } });
  const payload = await responseJson(response);
  if (!response.ok || !Array.isArray(payload?.items)) throw fixedError("youtube_channel_verification_failed");
  const ids = payload.items.map((item) => clean(item?.id)).filter(Boolean);
  if (ids.length !== 1 || ids[0] !== expectedChannelId) throw fixedError("authenticated_youtube_channel_mismatch");
}

async function authorizeLane({ client, expectedChannelId, lane, fetcher, openBrowser, randomBytes, timeoutMs }) {
  const state = base64url(randomBytes(32));
  const verifier = base64url(randomBytes(64));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  let resolveCallback;
  let rejectCallback;
  const callback = new Promise((resolve, reject) => { resolveCallback = resolve; rejectCallback = reject; });
  let settled = false;
  const server = createServer((request, response) => {
    try {
      const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
      if (request.method !== "GET" || requestUrl.pathname !== CALLBACK_PATH) {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
        response.end("Not found");
        return;
      }
      const returnedState = clean(requestUrl.searchParams.get("state"));
      const code = clean(requestUrl.searchParams.get("code"));
      const oauthError = clean(requestUrl.searchParams.get("error"));
      if (settled) {
        response.writeHead(409, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
        response.end("Authorization already received. You may close this tab.");
        return;
      }
      settled = true;
      if (oauthError) rejectCallback(fixedError("oauth_authorization_denied"));
      else if (returnedState !== state) rejectCallback(fixedError("oauth_state_mismatch"));
      else if (!code) rejectCallback(fixedError("oauth_authorization_code_missing"));
      else resolveCallback(code);
      response.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
      response.end("Authorization received. You may close this tab and return to the terminal.");
    } catch {
      if (!settled) { settled = true; rejectCallback(fixedError("oauth_callback_invalid")); }
      response.writeHead(400, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
      response.end("Authorization callback was invalid.");
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", () => reject(fixedError("oauth_loopback_server_failed")));
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw fixedError("oauth_loopback_server_failed");
  }
  const redirectUri = `http://127.0.0.1:${address.port}${CALLBACK_PATH}`;
  const authorization = new URL(client.authUri);
  authorization.search = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: REQUIRED_YOUTUBE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  const timer = setTimeout(() => {
    if (!settled) { settled = true; rejectCallback(fixedError("oauth_callback_timeout")); }
  }, timeoutMs);
  timer.unref?.();
  try {
    await openBrowser(authorization.href, { lane, expectedChannelId });
    const code = await callback;
    const tokens = await exchangeAuthorizationCode({ client, code, verifier, redirectUri, fetcher });
    await verifyAuthenticatedChannel({ accessToken: tokens.accessToken, expectedChannelId, fetcher });
    return tokens.refreshToken;
  } finally {
    clearTimeout(timer);
    await new Promise((resolve) => server.close(resolve));
  }
}

function envDocument({ client, channels, refreshTokens }) {
  const rows = [
    "# Generated by clippers-youtube-oauth-bootstrap.mjs. Owner-only OAuth material.",
    "# Uploads remain private unless a separately reviewed item and global authorization allow public publishing.",
  ];
  for (const { lane, suffix } of LANES) {
    const values = {
      [`CLIPPERS_YOUTUBE_${suffix}_CHANNEL_ID`]: channels[lane],
      [`CLIPPERS_YOUTUBE_${suffix}_CLIENT_ID`]: client.clientId,
      [`CLIPPERS_YOUTUBE_${suffix}_CLIENT_SECRET`]: client.clientSecret,
      [`CLIPPERS_YOUTUBE_${suffix}_REFRESH_TOKEN`]: refreshTokens[lane],
    };
    for (const [key, value] of Object.entries(values)) {
      if (!SAFE_ENV_VALUE.test(clean(value))) throw fixedError("selected_env_value_unsafe");
      rows.push(`${key}='${value}'`);
    }
  }
  rows.push("CLIPPERS_YOUTUBE_PUBLISH_AUTHORIZED=false", "");
  return rows.join("\n");
}

async function atomicOwnerOnlyWrite(filePath, content) {
  const absolute = path.resolve(filePath);
  await mkdir(path.dirname(absolute), { recursive: true, mode: 0o700 });
  const existing = await lstat(absolute).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (existing?.isSymbolicLink() || (existing && !existing.isFile())) throw fixedError("selected_env_output_unsafe");
  const temporary = `${absolute}.${process.pid}.${Date.now()}.tmp`;
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporary, absolute);
  } finally {
    await handle?.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
  }
}

export async function runYouTubeOAuthBootstrap(options = {}) {
  const credentialsFile = options.credentialsFile;
  const outputFile = options.outputFile;
  if (!credentialsFile) throw fixedError("oauth_client_file_required");
  if (!outputFile && !options.dryRun) throw fixedError("selected_env_output_required");
  const client = parseDesktopOAuthClient(await (options.readClient || readOwnerOnlyRegularJson)(credentialsFile));
  const channels = normalizedChannels(options.channels || DEFAULT_CHANNELS);
  const resultBase = { status: "ready", lanes: LANES.map(({ lane }) => ({ lane, expectedChannelId: channels[lane] })), publishAuthorized: false, apiCostUsd: 0, paidSpendAllowed: false };
  if (options.dryRun) return { ...resultBase, dryRun: true, networkUsed: false, outputWritten: false };
  const authorize = options.authorizeLane || authorizeLane;
  const refreshTokens = {};
  for (const { lane } of LANES) {
    refreshTokens[lane] = await authorize({
      client,
      expectedChannelId: channels[lane],
      lane,
      fetcher: options.fetcher || fetch,
      openBrowser: options.openBrowser || defaultOpenBrowser,
      randomBytes: options.randomBytes || cryptoRandomBytes,
      timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS,
    });
  }
  await (options.writeSelectedEnv || atomicOwnerOnlyWrite)(outputFile, envDocument({ client, channels, refreshTokens }));
  return { ...resultBase, status: "completed", dryRun: false, networkUsed: true, outputWritten: true, outputFile: path.resolve(outputFile) };
}

function cliValue(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runYouTubeOAuthBootstrap({
    credentialsFile: cliValue("credentials"),
    outputFile: cliValue("output"),
    dryRun: process.argv.includes("--dry-run"),
    channels: {
      motivation_es: cliValue("es-channel") || DEFAULT_CHANNELS.motivation_es,
      motivation_en: cliValue("en-channel") || DEFAULT_CHANNELS.motivation_en,
      sleep: cliValue("sleep-channel") || DEFAULT_CHANNELS.sleep,
    },
    openBrowser: async (url, { lane, expectedChannelId }) => {
      process.stdout.write(`Authorize ${lane} for expected channel ${expectedChannelId} in the opened browser.\n`);
      defaultOpenBrowser(url);
    },
  }).then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch((error) => {
    const candidate = clean(error?.code);
    const blocker = /^[a-z][a-z0-9_]{2,99}$/.test(candidate) ? candidate : "oauth_bootstrap_failed";
    process.stdout.write(`${JSON.stringify({ status: "blocked", blocker, publishAuthorized: false, apiCostUsd: 0 }, null, 2)}\n`);
    process.exitCode = 1;
  });
}
