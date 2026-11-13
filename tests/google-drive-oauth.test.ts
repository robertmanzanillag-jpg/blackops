import assert from "node:assert/strict";
import test from "node:test";
import type { Request } from "express";
import { createGoogleDriveAuthorizationUrl, getGoogleDriveOAuthStatus, resolveGoogleDriveRedirectUri } from "../server/google-drive-oauth";

const GOOGLE_DRIVE_ALIAS_ENV_VARS = [
  "GOOGLE_DRIVE_CLIENT_ID",
  "GOOGLE_DRIVE_OAUTH_CLIENT_ID",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_ID",
  "YOUTUBE_CLIENT_ID",
  "YOUTUBE_OAUTH_CLIENT_ID",
  "GOOGLE_DRIVE_CLIENT_SECRET",
  "GOOGLE_DRIVE_OAUTH_CLIENT_SECRET",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "YOUTUBE_CLIENT_SECRET",
  "YOUTUBE_OAUTH_CLIENT_SECRET",
  "GOOGLE_DRIVE_REFRESH_TOKEN",
  "GOOGLE_REFRESH_TOKEN",
  "GOOGLE_OAUTH_REFRESH_TOKEN",
  "YOUTUBE_REFRESH_TOKEN",
  "GOOGLE_DRIVE_REDIRECT_URI",
  "GOOGLE_DRIVE_SCOPES",
  "PUBLIC_APP_URL",
  "EXPO_PUBLIC_DOMAIN",
];

function snapshotEnv(names: string[]) {
  return new Map(names.map((name) => [name, process.env[name]]));
}

function clearEnv(names: string[]) {
  for (const name of names) delete process.env[name];
}

function restoreEnv(snapshot: Map<string, string | undefined>) {
  for (const [name, value] of snapshot) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

function mockRequest(host = "127.0.0.1:5013"): Request {
  return {
    get(name: string) {
      return name.toLowerCase() === "host" ? host : undefined;
    },
    protocol: "http",
  } as Request;
}

test("Google Drive OAuth accepts extended client aliases", async () => {
  const snapshot = snapshotEnv(GOOGLE_DRIVE_ALIAS_ENV_VARS);
  clearEnv(GOOGLE_DRIVE_ALIAS_ENV_VARS);
  process.env.GOOGLE_OAUTH_CLIENT_ID = "google-oauth-client-id";
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "google-oauth-client-secret";

  try {
    const url = new URL(createGoogleDriveAuthorizationUrl("test-user", mockRequest()));
    assert.equal(url.searchParams.get("client_id"), "google-oauth-client-id");
    assert.equal(url.searchParams.get("access_type"), "offline");
    assert.ok(url.searchParams.get("scope")?.includes("https://www.googleapis.com/auth/drive.file"));

    const status = await getGoogleDriveOAuthStatus("test-user");
    assert.equal(status.configured, true);
    assert.equal(status.connected, false);
    assert.equal(JSON.stringify(status).includes("google-oauth-client-secret"), false);
  } finally {
    restoreEnv(snapshot);
  }
});

test("Google Drive OAuth accepts extended refresh token aliases", async () => {
  const snapshot = snapshotEnv(GOOGLE_DRIVE_ALIAS_ENV_VARS);
  clearEnv(GOOGLE_DRIVE_ALIAS_ENV_VARS);
  process.env.YOUTUBE_REFRESH_TOKEN = "youtube-refresh-token";

  try {
    const status = await getGoogleDriveOAuthStatus("test-user");
    assert.equal(status.configured, true);
    assert.equal(status.connected, true);
    assert.equal(status.provider, "env_refresh_token");
    assert.equal(JSON.stringify(status).includes("youtube-refresh-token"), false);
  } finally {
    restoreEnv(snapshot);
  }
});

test("Google Drive OAuth rejects placeholder alias env values", async () => {
  const snapshot = snapshotEnv(GOOGLE_DRIVE_ALIAS_ENV_VARS);
  clearEnv(GOOGLE_DRIVE_ALIAS_ENV_VARS);
  process.env.GOOGLE_OAUTH_CLIENT_ID = "replace-with-google-client-id";
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "your-google-client-secret";
  process.env.YOUTUBE_REFRESH_TOKEN = "replace-with-youtube-refresh-token";

  try {
    assert.throws(
      () => createGoogleDriveAuthorizationUrl("test-user", mockRequest()),
      /Google Drive OAuth is not configured/,
    );

    const status = await getGoogleDriveOAuthStatus("test-user");
    assert.equal(status.configured, false);
    assert.equal(status.connected, false);
    assert.equal(status.provider, null);
  } finally {
    restoreEnv(snapshot);
  }
});

test("Google Drive OAuth ignores placeholder redirect env values", async () => {
  const snapshot = snapshotEnv(GOOGLE_DRIVE_ALIAS_ENV_VARS);
  clearEnv(GOOGLE_DRIVE_ALIAS_ENV_VARS);
  process.env.GOOGLE_OAUTH_CLIENT_ID = "google-oauth-client-id";
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "google-oauth-client-secret";
  process.env.GOOGLE_DRIVE_REDIRECT_URI = "<google-drive-redirect-uri>";
  process.env.PUBLIC_APP_URL = "https://your-domain.example";
  process.env.EXPO_PUBLIC_DOMAIN = "drive-test.example.com";

  try {
    assert.equal(
      resolveGoogleDriveRedirectUri(mockRequest()),
      "https://drive-test.example.com/api/google-drive/oauth/callback",
    );

    const url = new URL(createGoogleDriveAuthorizationUrl("test-user", mockRequest()));
    assert.equal(url.searchParams.get("redirect_uri"), "https://drive-test.example.com/api/google-drive/oauth/callback");

    const status = await getGoogleDriveOAuthStatus("test-user");
    assert.equal(status.redirectUri, null);
  } finally {
    restoreEnv(snapshot);
  }
});

test("Google Drive OAuth ignores placeholder scope env values", async () => {
  const snapshot = snapshotEnv(GOOGLE_DRIVE_ALIAS_ENV_VARS);
  clearEnv(GOOGLE_DRIVE_ALIAS_ENV_VARS);
  process.env.GOOGLE_OAUTH_CLIENT_ID = "google-oauth-client-id";
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "google-oauth-client-secret";
  process.env.GOOGLE_DRIVE_SCOPES = "replace-with-google-drive-scopes";

  try {
    const url = new URL(createGoogleDriveAuthorizationUrl("test-user", mockRequest()));
    assert.equal(url.searchParams.get("scope"), "https://www.googleapis.com/auth/drive.file");

    const status = await getGoogleDriveOAuthStatus("test-user");
    assert.equal(status.scope, "https://www.googleapis.com/auth/drive.file");
  } finally {
    restoreEnv(snapshot);
  }
});
