import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";
import { registerRoutes } from "../server/routes";

const ENV_KEYS = [
  "NODE_ENV",
  "DEFAULT_USER_ID",
  "ALLOW_DEV_USER_FALLBACK",
  "CLIPPERS_LOCAL_NEWS_WORKSPACE",
  "METRICOOL_USER_TOKEN",
  "METRICOOL_USER_ID",
  "METRICOOL_MIAMI_NEWS_BLOG_ID",
  "METRICOOL_NY_NEWS_BLOG_ID",
] as const;

const envSnapshot = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
let workspaceDir = "";
let forbiddenWorkspaceDir = "";
let server: Server;
let baseUrl = "";

test.before(async () => {
  workspaceDir = await mkdtemp(path.join(os.tmpdir(), "local-news-routes-"));
  forbiddenWorkspaceDir = path.join(os.tmpdir(), `local-news-forbidden-${process.pid}-${Date.now()}`);
  process.env.NODE_ENV = "test";
  process.env.DEFAULT_USER_ID = "mock-user-123";
  process.env.ALLOW_DEV_USER_FALLBACK = "true";
  process.env.CLIPPERS_LOCAL_NEWS_WORKSPACE = workspaceDir;
  delete process.env.METRICOOL_USER_TOKEN;
  delete process.env.METRICOOL_USER_ID;
  delete process.env.METRICOOL_MIAMI_NEWS_BLOG_ID;
  delete process.env.METRICOOL_NY_NEWS_BLOG_ID;

  const app = express();
  app.use(express.json());
  server = createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.after(async () => {
  if (server?.listening) {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  await rm(workspaceDir, { recursive: true, force: true });
  await rm(forbiddenWorkspaceDir, { recursive: true, force: true });
  for (const key of ENV_KEYS) {
    const value = envSnapshot[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

async function request(method: "GET" | "POST", route: string, body?: unknown) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { response, json: await response.json() as any };
}

const event = {
  sourceEventId: "route-event-1",
  source: "NWS Miami",
  sourceUrl: "https://weather.gov/example",
  lane: "miami-news",
  title: "Flood Watch",
  description: "Heavy rain is possible.",
  location: "Miami-Dade",
  severity: "Moderate",
  urgency: "Expected",
};

test("GET status is uncached and POST bootstrap returns the real workspace status", async () => {
  const status = await request("GET", "/api/clippers/local-news/status");
  assert.equal(status.response.status, 200);
  assert.equal(status.response.headers.get("cache-control"), "no-store");
  assert.equal(status.json.workspaceDir, workspaceDir);
  assert.equal(status.json.bootstrapped, false);
  assert.equal(status.json.scheduler.enabled, true);
  assert.equal(status.json.scheduler.started, false);
  assert.equal(status.json.deliveryPolicy.paused, true);
  assert.equal(status.json.metricool.status, "blocked");
  assert.equal(status.json.metricool.platforms.facebook.ready, false);
  assert.equal(status.json.metricool.platforms.x.ready, false);

  const bootstrap = await request("POST", "/api/clippers/local-news/bootstrap", {});
  assert.equal(bootstrap.response.status, 200);
  assert.equal(bootstrap.json.workspaceDir, workspaceDir);
  assert.equal(bootstrap.json.bootstrapped, true);
});

test("malformed public payloads return 400 validation responses", async () => {
  const cases = [
    ["/api/clippers/local-news/run-cycle", { events: "not-an-array" }],
    ["/api/clippers/local-news/ingest-events", {}],
    ["/api/clippers/local-news/record-metrics", { metrics: [{ lane: "miami-news", platform: "x", impressions: -1 }] }],
  ] as const;

  for (const [route, body] of cases) {
    const result = await request("POST", route, body);
    assert.equal(result.response.status, 400, route);
    assert.match(result.json.error, /^Invalid clippers local news/);
    assert.ok(Array.isArray(result.json.details));
  }
});

test("public handlers strip internal options and manual runs expose blocked Metricool delivery", async () => {
  const internalOptions = {
    workspaceDir: forbiddenWorkspaceDir,
    now: "definitely-not-a-date",
    fetch: "not-a-function",
    env: {
      CLIPPERS_LOCAL_NEWS_WORKSPACE: forbiddenWorkspaceDir,
      METRICOOL_USER_TOKEN: "request-injected-token",
      METRICOOL_USER_ID: "request-injected-user",
    },
  };

  const cycle = await request("POST", "/api/clippers/local-news/run-cycle", {
    ...internalOptions,
    events: [],
    resolveMissing: false,
  });
  assert.equal(cycle.response.status, 200);
  assert.equal(cycle.json.status.workspaceDir, workspaceDir);
  assert.equal(cycle.json.metricoolDelivery.status, "paused");
  assert.equal(cycle.json.cycleExecution, "completed");
  assert.equal(cycle.json.status.deliveryPolicy.paused, true);
  assert.equal(cycle.json.status.deliverySummary.publicationConfirmed, 0);

  const ingest = await request("POST", "/api/clippers/local-news/ingest-events", {
    ...internalOptions,
    events: [event],
    resolveMissing: false,
    snapshotLanes: ["miami-news"],
  });
  assert.equal(ingest.response.status, 200);
  assert.equal(ingest.json.status.workspaceDir, workspaceDir);

  const metrics = await request("POST", "/api/clippers/local-news/record-metrics", {
    ...internalOptions,
    metrics: [{ lane: "miami-news", platform: "x", impressions: 12 }],
  });
  assert.equal(metrics.response.status, 200);
  assert.equal(metrics.json.status.workspaceDir, workspaceDir);
  await assert.rejects(stat(forbiddenWorkspaceDir), (error: NodeJS.ErrnoException) => error.code === "ENOENT");
});
