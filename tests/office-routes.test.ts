import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { randomUUID } from "node:crypto";
import { registerOfficeRoutes } from "../server/office-routes";
import { createSignedLocalAuthCookieValue } from "../server/user-context";

test("execution HTTP endpoints require authenticated owner, origin, and strict task data", async t => {
  const saved = { ...process.env };
  Object.assign(process.env, { NODE_ENV: "test", DEFAULT_USER_ID: "office-owner", SESSION_SECRET: "office-test-only-signing-secret", ALLOW_DEV_USER_FALLBACK: "true" });
  t.after(() => { for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env, saved); });
  const app = express(); app.use(express.json());
  let submissions = 0;
  let historyReads = 0;
  let directoryReads = 0;
  let snapshotReads = 0;
  let directReads = 0;
  let clock = Date.now();
  let failSnapshot = false;
  const checkedAt = new Date(clock).toISOString();
  const snapshot = { text: "KONG fixture", completedAt: checkedAt, evidence: { generatedAt: checkedAt, agents: [], cities: [], citySnapshotCheckedAt: checkedAt, cityAgentsEnabled: true, cityCoverageComplete: false } };
  delete process.env.OFFICE_WORKER_ENABLED;
  registerOfficeRoutes(app, { runtime: {
    list: async (owner) => { assert.equal(owner,"office-owner"); historyReads++; return [{id:"persisted-run",kind:"claude_review",status:"completed"}] as any; },
    submit: async (_owner, task: any) => { submissions++; return { id: "accepted-id", ...task, status: "accepted", createdAt: new Date().toISOString() } as any; },
  }, directoryReader: async () => { directoryReads++; return [{ id: "buenos-aires", name: "Buenos Aires", countryCode: "AR", timeZone: "America/Argentina/Buenos_Aires", currency: "ARS" }]; },
  now: () => clock, snapshotReader: async () => { snapshotReads++; if (failSnapshot) throw new Error("fixture upstream error"); return snapshot; },
  analyzeRadio: async userId => {
    assert.equal(userId, "office-owner");
    directReads++;
    return { totalEvents: 2, eventsWithEmptySlots: 1, slotsToFill: [], upcomingEvents: [] };
  }, loadPullRequest: async prUrl => { directReads++; return { prUrl, headSha: "a".repeat(40), diffSha256: "b".repeat(64), diff: "private fixture" }; } });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  process.env.PUBLIC_APP_URL = base;
  const cookie = (id: string) => `blackops.uid=${createSignedLocalAuthCookieValue(id)}`;
  const task = { kind: "claude_chat", key: randomUUID(), message: "Hello" };
  assert.equal((await fetch(`${base}/api/agents-office/cities`)).status, 401);
  assert.equal(directoryReads, 0);
  const directoryResponse = await fetch(`${base}/api/agents-office/cities`, { headers: { cookie: cookie("office-owner") } });
  assert.equal(directoryResponse.status, 200);
  assert.equal((await directoryResponse.json())[0].id, "buenos-aires");
  const post = (headers: Record<string,string>, body: unknown = task) => fetch(`${base}/api/agents-office/runs`, {
    method: "POST", headers: { "content-type": "application/json", origin: base, ...headers }, body: JSON.stringify(body),
  });
  assert.equal((await fetch(`${base}/api/agents-office/runs`, { headers: { "x-user-id": "office-owner" } })).status, 401);
  assert.equal((await post({ "x-user-id": "office-owner" })).status, 401);
  assert.equal((await post({ cookie: cookie("someone-else") })).status, 403);
  assert.equal((await post({ cookie: cookie("office-owner"), origin: "https://untrusted.example" })).status, 403);
  assert.equal((await post({ cookie: cookie("office-owner"), origin: "" })).status, 403);
  assert.equal((await post({ cookie: cookie("office-owner") }, { ...task, command: "arbitrary-shell", sessionId: "forged" })).status, 400);
  assert.equal(submissions, 0);
  assert.equal((await post({ cookie: cookie("office-owner") })).status, 202);
  assert.equal(submissions, 1);
  assert.equal((await fetch(`${base}/api/agents-office/runs`, { headers: { cookie: cookie("office-owner") } })).headers.get("cache-control"), "no-store");
  process.env.OFFICE_WORKER_ENABLED = "false";
  const ownerHeaders = { cookie: cookie("office-owner") };
  const contact = (body: unknown, headers: Record<string, string> = ownerHeaders) => fetch(`${base}/api/agents-office/contact-action`, {
    method: "POST", headers: { "content-type": "application/json", origin: base, ...headers }, body: JSON.stringify(body),
  });
  assert.equal((await contact({ action: "radio_analysis" }, {})).status, 401);
  assert.equal((await contact({ action: "radio_analysis" }, { ...ownerHeaders, origin: "https://untrusted.example" })).status, 403);
  assert.equal((await contact({ action: "github_pull_request", prUrl: "https://untrusted.example" })).status, 400);
  assert.equal(directReads, 0);
  assert.match((await (await contact({ action: "radio_analysis" })).json()).summary, /2 eventos.*1 tienen/);
  const prReceipt = await (await contact({ action: "github_pull_request", prUrl: "https://github.com/owner/repo/pull/12" })).json();
  assert.equal(prReceipt.agentId, "github");
  assert.match(prReceipt.summary, /aaaaaaaaaa/);
  assert.doesNotMatch(JSON.stringify(prReceipt), /private fixture/);
  assert.equal(directReads, 2);
  const readSnapshot = (headers: Record<string, string> = ownerHeaders) => fetch(`${base}/api/agents-office/kong-snapshot`, { headers });
  assert.equal((await readSnapshot({})).status, 401);
  assert.equal((await readSnapshot({ cookie: cookie("someone-else") })).status, 403);
  assert.equal(snapshotReads, 0);
  const results = await Promise.all([readSnapshot(), readSnapshot()]);
  for (const result of results) {
    assert.equal(result.status, 200);
    assert.equal(result.headers.get("cache-control"), "no-store");
    assert.deepEqual(await result.json(), { ...snapshot, collaboration: { verified: false, observedAt: checkedAt, totalFindings: 0, exchanges: [] } });
  }
  assert.equal(snapshotReads, 1);
  clock += 45_001;
  failSnapshot = true;
  assert.equal((await readSnapshot()).status, 503);
  assert.equal((await readSnapshot()).headers.get("retry-after"), "30");
  assert.equal(snapshotReads, 2);
  clock += 30_000;
  failSnapshot = false;
  assert.equal((await readSnapshot()).status, 200);
  assert.equal(snapshotReads, 3);
  assert.deepEqual(await (await fetch(`${base}/api/agents-office/runs`, { headers: ownerHeaders })).json(), [{id:"persisted-run",kind:"claude_review",status:"completed"}]);
  assert.equal(historyReads, 2);
  assert.equal((await post(ownerHeaders)).status, 503);
  assert.equal(submissions, 1);
  const connections = await (await fetch(`${base}/api/agents-office/connections`, { headers: ownerHeaders })).json();
  assert.equal(connections.worker.status, "blocked");
});
