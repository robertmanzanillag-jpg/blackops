import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { getGoogleAccessToken } from "../server/google-calendar";

const REPLIT_CONNECTOR_ENV_VARS = [
  "REPLIT_CONNECTORS_HOSTNAME",
  "REPL_IDENTITY",
  "WEB_REPL_RENEWAL",
];

function snapshotEnv(names: string[]) {
  return new Map(names.map((name) => [name, process.env[name]]));
}

function restoreEnv(snapshot: Map<string, string | undefined>) {
  for (const [name, value] of snapshot) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

test("Google connector access token skips connector rows without tokens", async () => {
  const snapshot = snapshotEnv(REPLIT_CONNECTOR_ENV_VARS);
  process.env.REPLIT_CONNECTORS_HOSTNAME = "connectors.example.test";
  process.env.REPL_IDENTITY = "test-repl-identity";
  delete process.env.WEB_REPL_RENEWAL;

  const fetchMock = mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
    items: [
      { name: "google-calendar", settings: {} },
      { name: "google-drive", settings: { access_token: "drive-access-token" } },
    ],
  })));

  try {
    assert.equal(await getGoogleAccessToken(), "drive-access-token");
    assert.equal(fetchMock.mock.calls.length, 1);
  } finally {
    fetchMock.mock.restore();
    restoreEnv(snapshot);
  }
});

test("Google connector access token accepts nested OAuth token shapes and prefers Drive", async () => {
  const snapshot = snapshotEnv(REPLIT_CONNECTOR_ENV_VARS);
  process.env.REPLIT_CONNECTORS_HOSTNAME = "connectors-nested.example.test";
  process.env.REPL_IDENTITY = "test-repl-identity";
  delete process.env.WEB_REPL_RENEWAL;

  const fetchMock = mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
    items: [
      { name: "google-calendar", settings: { oauth: { tokens: { accessToken: "calendar-access-token" } } } },
      { name: "google-drive", settings: { connection: { credentials: { accessToken: "drive-access-token" } } } },
    ],
  })));

  try {
    assert.equal(await getGoogleAccessToken(), "drive-access-token");
    assert.equal(fetchMock.mock.calls.length, 1);
  } finally {
    fetchMock.mock.restore();
    restoreEnv(snapshot);
  }
});
