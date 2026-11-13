import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DEFAULT_CHANNELS, parseDesktopOAuthClient, runYouTubeOAuthBootstrap } from "../script/clippers-youtube-oauth-bootstrap.mjs";

const fakeClient = {
  installed: {
    client_id: "client-id.apps.googleusercontent.com",
    client_secret: "fake-client-secret",
    auth_uri: "https://accounts.google.com/o/oauth2/v2/auth",
    token_uri: "https://oauth2.googleapis.com/token",
    redirect_uris: ["http://localhost"],
  },
};

const uploadScope = "https://www.googleapis.com/auth/youtube.upload";
const readonlyScope = "https://www.googleapis.com/auth/youtube.readonly";
const requiredScopes = `${uploadScope} ${readonlyScope}`;

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "youtube-oauth-bootstrap-"));
  const credentialsFile = path.join(root, "desktop-client.json");
  const outputFile = path.join(root, "youtube-selected.env");
  await writeFile(credentialsFile, `${JSON.stringify(fakeClient)}\n`, { mode: 0o600 });
  await chmod(credentialsFile, 0o600);
  return { root, credentialsFile, outputFile };
}

test("accepts only the official installed desktop OAuth shape", () => {
  assert.equal(parseDesktopOAuthClient(fakeClient).clientId, fakeClient.installed.client_id);
  assert.equal(parseDesktopOAuthClient({
    installed: { ...fakeClient.installed, auth_uri: "https://accounts.google.com/o/oauth2/auth" },
  }).authUri, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.throws(() => parseDesktopOAuthClient({ web: fakeClient.installed }), /desktop_oauth_client_missing_fields/);
  assert.throws(() => parseDesktopOAuthClient({ installed: { ...fakeClient.installed, client_id: "not-a-google-client" } }), /client_id_invalid/);
  assert.throws(() => parseDesktopOAuthClient({ installed: { ...fakeClient.installed, auth_uri: "https://attacker.invalid/auth" } }), /endpoint_not_official/);
  assert.throws(() => parseDesktopOAuthClient({ installed: { ...fakeClient.installed, token_uri: "https://attacker.invalid/token" } }), /endpoint_not_official/);
});

test("dry-run validates all lanes without network or output", async () => {
  const f = await fixture();
  let fetchCalls = 0;
  try {
    const result = await runYouTubeOAuthBootstrap({
      credentialsFile: f.credentialsFile,
      outputFile: f.outputFile,
      dryRun: true,
      fetcher: async () => { fetchCalls += 1; throw new Error("must not fetch"); },
      openBrowser: async () => assert.fail("must not open browser"),
    });
    assert.equal(result.status, "ready");
    assert.equal(result.networkUsed, false);
    assert.equal(result.outputWritten, false);
    assert.equal(result.publishAuthorized, false);
    assert.equal(result.apiCostUsd, 0);
    assert.equal(result.paidSpendAllowed, false);
    assert.equal(fetchCalls, 0);
    await assert.rejects(readFile(f.outputFile), /ENOENT/);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("authorizes lanes sequentially and writes compatible owner-only env with public publishing disabled", async () => {
  const f = await fixture();
  const order = [];
  let active = 0;
  try {
    const result = await runYouTubeOAuthBootstrap({
      credentialsFile: f.credentialsFile,
      outputFile: f.outputFile,
      authorizeLane: async ({ lane, expectedChannelId }) => {
        assert.equal(active, 0);
        active += 1;
        order.push(`${lane}:${expectedChannelId}`);
        await Promise.resolve();
        active -= 1;
        return `fake-refresh-${lane}`;
      },
    });
    assert.equal(result.status, "completed");
    assert.equal(result.publishAuthorized, false);
    assert.equal(result.apiCostUsd, 0);
    assert.equal(result.paidSpendAllowed, false);
    assert.deepEqual(order, [
      `motivation_es:${DEFAULT_CHANNELS.motivation_es}`,
      `motivation_en:${DEFAULT_CHANNELS.motivation_en}`,
      `sleep:${DEFAULT_CHANNELS.sleep}`,
    ]);
    const raw = await readFile(f.outputFile, "utf8");
    assert.match(raw, /CLIPPERS_YOUTUBE_ES_CHANNEL_ID='UC31lPi3c0ritooHLqvmNMEg'/);
    assert.match(raw, /CLIPPERS_YOUTUBE_EN_REFRESH_TOKEN='fake-refresh-motivation_en'/);
    assert.match(raw, /CLIPPERS_YOUTUBE_SLEEP_REFRESH_TOKEN='fake-refresh-sleep'/);
    assert.match(raw, /CLIPPERS_YOUTUBE_PUBLISH_AUTHORIZED=false/);
    assert.equal((await lstat(f.outputFile)).mode & 0o777, 0o600);
    assert.doesNotMatch(JSON.stringify(result), /fake-client-secret|fake-refresh/);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("does not write a partial env when a later lane fails", async () => {
  const f = await fixture();
  try {
    await assert.rejects(runYouTubeOAuthBootstrap({
      credentialsFile: f.credentialsFile,
      outputFile: f.outputFile,
      authorizeLane: async ({ lane }) => {
        if (lane === "motivation_en") throw new Error("authenticated_youtube_channel_mismatch");
        return `fake-refresh-${lane}`;
      },
    }), /authenticated_youtube_channel_mismatch/);
    await assert.rejects(readFile(f.outputFile), /ENOENT/);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("real loopback flow uses PKCE/state, offline consent and verifies the exact channel", async () => {
  const f = await fixture();
  const seen = { token: null, channel: null, auth: null };
  try {
    await writeFile(f.credentialsFile, `${JSON.stringify({
      installed: { ...fakeClient.installed, auth_uri: "https://accounts.google.com/o/oauth2/auth" },
    })}\n`, { mode: 0o600 });
    const result = await runYouTubeOAuthBootstrap({
      credentialsFile: f.credentialsFile,
      outputFile: f.outputFile,
      channels: DEFAULT_CHANNELS,
      randomBytes: (size) => Buffer.alloc(size, 7),
      openBrowser: async (href, { expectedChannelId }) => {
        const auth = new URL(href);
        seen.auth = auth;
        const callback = new URL(auth.searchParams.get("redirect_uri"));
        callback.searchParams.set("state", auth.searchParams.get("state"));
        callback.searchParams.set("code", `fake-code-${expectedChannelId}`);
        await new Promise((resolve, reject) => http.get(callback, (response) => {
          response.resume();
          response.on("end", resolve);
        }).on("error", reject));
      },
      fetcher: async (url, init = {}) => {
        if (url === fakeClient.installed.token_uri) {
          const body = new URLSearchParams(init.body);
          seen.token = body;
          const channel = body.get("code").slice("fake-code-".length);
          return new Response(JSON.stringify({ access_token: `fake-access-${channel}`, refresh_token: `fake-refresh-${channel}`, scope: requiredScopes }), { status: 200 });
        }
        seen.channel = { url, authorization: init.headers.authorization };
        const channel = init.headers.authorization.slice("Bearer fake-access-".length);
        return new Response(JSON.stringify({ items: [{ id: channel }] }), { status: 200 });
      },
    });
    assert.equal(result.status, "completed");
    assert.equal(seen.auth.searchParams.get("access_type"), "offline");
    assert.equal(seen.auth.searchParams.get("prompt"), "consent");
    assert.equal(seen.auth.origin + seen.auth.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
    assert.equal(seen.auth.searchParams.get("scope"), requiredScopes);
    assert.equal(seen.auth.searchParams.get("code_challenge_method"), "S256");
    assert.ok(seen.auth.searchParams.get("state"));
    assert.ok(seen.auth.searchParams.get("code_challenge"));
    assert.ok(seen.token.get("code_verifier"));
    assert.match(seen.channel.url, /channels\?part=id&mine=true/);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("fails closed without output when Google omits either required scope", async () => {
  for (const grantedScope of [uploadScope, readonlyScope, ""]) {
    const f = await fixture();
    try {
      await assert.rejects(runYouTubeOAuthBootstrap({
        credentialsFile: f.credentialsFile,
        outputFile: f.outputFile,
        randomBytes: (size) => Buffer.alloc(size, 9),
        openBrowser: async (href) => {
          const auth = new URL(href);
          const callback = new URL(auth.searchParams.get("redirect_uri"));
          callback.searchParams.set("state", auth.searchParams.get("state"));
          callback.searchParams.set("code", "fake-code");
          await new Promise((resolve, reject) => http.get(callback, (response) => {
            response.resume();
            response.on("end", resolve);
          }).on("error", reject));
        },
        fetcher: async (url) => {
          assert.equal(url, fakeClient.installed.token_uri);
          return new Response(JSON.stringify({
            access_token: "fake-access",
            refresh_token: "fake-refresh",
            scope: grantedScope,
          }), { status: 200 });
        },
      }), /youtube_required_scopes_not_granted/);
      await assert.rejects(readFile(f.outputFile), /ENOENT/);
    } finally { await rm(f.root, { recursive: true, force: true }); }
  }
});

test("rejects permissive credential files before any OAuth work", async () => {
  const f = await fixture();
  try {
    await chmod(f.credentialsFile, 0o644);
    await assert.rejects(runYouTubeOAuthBootstrap({ credentialsFile: f.credentialsFile, outputFile: f.outputFile, dryRun: true }), /owner_only_0600/);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("CLI dry-run output never prints OAuth client material", async () => {
  const f = await fixture();
  try {
    const result = spawnSync(process.execPath, [
      path.resolve("script/clippers-youtube-oauth-bootstrap.mjs"),
      "--credentials", f.credentialsFile,
      "--output", f.outputFile,
      "--dry-run",
    ], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.status, "ready");
    assert.equal(report.networkUsed, false);
    assert.doesNotMatch(result.stdout, /fake-client-secret|client-id\.apps\.googleusercontent\.com/);
    assert.equal(result.stderr, "");
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
