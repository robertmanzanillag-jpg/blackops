import assert from "node:assert/strict";
import test from "node:test";
import { scheduleBlackRoomMetricoolPost, BlackRoomMetricoolUncertainError } from "../server/blackroom-metricool-bridge";
import { BlackRoomPublicationBlockedError, strictBlackRoomEnabled, retainBlackRoomAttempt } from "../server/blackroom-publication-guard";
import { normalizeRemoteControlState, readExistingBlackRoomRemoteControl } from "../server/blackroom-remote-control";
import { ensureDefaultAutomations, getExistingAutomations, recordScheduledAutomationRun } from "../server/automation-registry";
import { createMetricoolAnalyticsScheduler, getMetricoolAnalyticsSyncConfig, type MetricoolAnalyticsSyncResult } from "../server/metricool-analytics-sync";
import { fakeStorage } from "./fixtures/containment-storage";
import { getHandlers, scheduleHandler, cleanupUploads, workerFailure, workerVerifyOnly } from "containment-handlers";
import { markBlackRoomNetworkBlocked, type BlackRoomLedgerEntry } from "../server/blackroom-local-worker";
import type { AutomationDefinition } from "@shared/schema";

// Never use process.env for test authorization/credentials, or a real transport.
globalThis.fetch = async () => { throw new Error("real fetch forbidden"); };
const clock = () => new Date("2026-10-08T10:00:00Z");
const input = {
  jobId: "fixture-job", caption: "Fixture caption", publicationDateTime: "2026-10-09T06:00:00",
  sourceVideoId: "abc123xyz01", durationSeconds: 30, videoFormat: "vertical" as const,
  mediaUrl: "https://fixture.invalid/video.mp4", timezone: "America/New_York",
};
const control = () => ({ desiredEnabled: true, queue: { enabled: true, jobs: [{ id: input.jobId, status: "processing" }] } });
function envFixture(authorized?: string, approval?: string) {
  let credentials = 0;
  const env: NodeJS.ProcessEnv = {
    BLACKROOM_METRICOOL_BRIDGE_PUBLISH_AUTHORIZED: authorized,
    METRICOOL_REQUIRE_APPROVAL_FOR_PUBLISH: approval,
  };
  for (const key of ["METRICOOL_USER_TOKEN", "METRICOOL_USER_ID"]) {
    Object.defineProperty(env, key, { get() { credentials++; return "fixture-only"; } });
  }
  return { env, credentials: () => credentials };
}
function postReceipt() {
  return Response.json([{ id: "fixture-receipt", text: input.caption,
    publicationDate: { dateTime: input.publicationDateTime }, providers: [{ network: "tiktok" }] }]);
}
const succeeded = () => Response.json({ jsonrpc: "2.0", result: { content: [{ type: "text", text: "Scheduled" }], isError: false } });
const definition = (status: string) => ({
  id: "fixture-definition", ownerUserId: "fixture-owner", status,
  metadata: { key: "metricool-daily-analytics-sync" },
}) as AutomationDefinition;

test("strict desiredEnabled never enables strings, absent or malformed values", () => {
  for (const value of [false, undefined, null, "false", "true", "", 1, {}, []]) {
    assert.equal(strictBlackRoomEnabled(value), false);
    assert.equal(normalizeRemoteControlState({ desiredEnabled: value }).desiredEnabled, false);
  }
  assert.equal(normalizeRemoteControlState({ desiredEnabled: true }).desiredEnabled, true);
});

for (const [name, authorized, approval, snapshot] of [
  ["missing", undefined, "false", control()],
  ["disabled", "false", "false", control()],
  ["malformed authorization", "TRUE", "false", control()],
  ["approval required", "true", "true", control()],
  ["approval missing", "true", undefined, control()],
  ["malformed approval", "true", "FALSE", control()],
  ["control off", "true", "false", { ...control(), desiredEnabled: false }],
  ["string-false", "true", "false", { ...control(), desiredEnabled: "false" }],
  ["string-true", "true", "false", { ...control(), desiredEnabled: "true" }],
  ["queue off", "true", "false", { ...control(), queue: { ...control().queue, enabled: false } }],
  ["job missing", "true", "false", { ...control(), queue: { enabled: true, jobs: [] } }],
  ["job held", "true", "false", { ...control(), queue: { enabled: true, jobs: [{ id: input.jobId, status: "held" }] } }],
] as const) {
  test(`bridge ${name}: zero credentials and zero provider IO, including verifyOnly`, async () => {
    const fixture = envFixture(authorized, approval);
    for (const verifyOnly of [false, true]) {
      let calls = 0;
      await assert.rejects(scheduleBlackRoomMetricoolPost(input, {
        env: fixture.env, now: clock, readPublicationControl: async () => snapshot, verifyOnly,
        fetch: async () => { calls++; throw new Error("forbidden"); },
      }), BlackRoomPublicationBlockedError);
      assert.equal(calls, 0);
    }
    assert.equal(fixture.credentials(), 0);
  });
}

test("missing/unavailable authoritative state fails before credentials", async () => {
  const fixture = envFixture("true", "false");
  await assert.rejects(scheduleBlackRoomMetricoolPost(input, { env: fixture.env }), /authoritative_control_missing/);
  await assert.rejects(scheduleBlackRoomMetricoolPost(input, {
    env: fixture.env, readPublicationControl: async () => { throw new Error("fixture storage unavailable"); },
  }), /authoritative_control_unavailable/);
  assert.equal(fixture.credentials(), 0);
});

test("explicitly allowed bridge uses only fake transport and preserves payload", async () => {
  const fixture = envFixture("true", "false");
  const calls: string[] = [];
  const result = await scheduleBlackRoomMetricoolPost(input, {
    env: fixture.env, now: clock, readPublicationControl: async () => control(), networks: ["tiktok"],
    fetch: async (_url, init) => {
      calls.push(init?.method || "GET");
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        assert.equal(body.params.name, "createScheduledPost");
        assert.equal(body.params.arguments.mediaFiles[0].download_url, input.mediaUrl);
        return succeeded();
      }
      return calls.length === 1 ? Response.json([]) : postReceipt();
    },
  });
  assert.deepEqual(calls, ["GET", "POST", "GET"]);
  assert.deepEqual(result.platformReceipts, { tiktok: "fixture-receipt" });
  assert.equal(fixture.credentials(), 2);
});

test("pause before POST does not submit or reset an intent", async () => {
  const fixture = envFixture("true", "false");
  let paused = false, posts = 0;
  await assert.rejects(scheduleBlackRoomMetricoolPost(input, {
    env: fixture.env, now: clock, readPublicationControl: async () => ({ ...control(), desiredEnabled: !paused }),
    fetch: async (_url, init) => { if (init?.method === "POST") posts++; paused = true; return Response.json([]); },
  }), error => error instanceof BlackRoomPublicationBlockedError && retainBlackRoomAttempt(error));
  assert.equal(posts, 0);
});

test("pause during retry keeps uncertainty and suppresses second POST", async () => {
  const fixture = envFixture("true", "false");
  let paused = false, posts = 0;
  await assert.rejects(scheduleBlackRoomMetricoolPost(input, {
    env: fixture.env, now: clock, readPublicationControl: async () => ({ ...control(), desiredEnabled: !paused }),
    wait: async () => { paused = true; },
    fetch: async (_url, init) => {
      if (init?.method !== "POST") return Response.json([]);
      posts++;
      return Response.json({ result: { isError: true, content: [{ type: "text", text: "Failed to normalize media" }] } });
    },
  }), error => error instanceof BlackRoomMetricoolUncertainError && retainBlackRoomAttempt(error));
  assert.equal(posts, 1);
});

test("possible acceptance then pause suppresses confirmation IO", async () => {
  const fixture = envFixture("true", "false");
  let paused = false;
  const calls: string[] = [];
  await assert.rejects(scheduleBlackRoomMetricoolPost(input, {
    env: fixture.env, now: clock, readPublicationControl: async () => ({ ...control(), desiredEnabled: !paused }),
    fetch: async (_url, init) => {
      calls.push(init?.method || "GET");
      if (init?.method === "POST") { paused = true; return succeeded(); }
      return Response.json([]);
    },
  }), BlackRoomMetricoolUncertainError);
  assert.deepEqual(calls, ["GET", "POST"]);
});

test("passive existing-state reader performs no initialization or writes", async () => {
  let reads = 0;
  assert.equal(await readExistingBlackRoomRemoteControl(async () => { reads++; return null; }), null);
  assert.equal((await readExistingBlackRoomRemoteControl(async () => { reads++; return { desiredEnabled: "true" }; }))?.desiredEnabled, false);
  await assert.rejects(readExistingBlackRoomRemoteControl(async () => { reads++; throw new Error("fixture missing table"); }), /missing table/);
  assert.equal(reads, 3);
});

test("repeated compatibility initialization never changes existing definitions", async () => {
  fakeStorage.definitions = [definition("paused"), { ...definition("disabled"), id: "disabled" }];
  fakeStorage.writes = 0;
  const before = structuredClone(fakeStorage.definitions);
  for (let i = 0; i < 3; i++) assert.deepEqual(await ensureDefaultAutomations("fixture-owner"), before);
  assert.deepEqual(fakeStorage.definitions, before);
  assert.equal(fakeStorage.writes, 0);
  fakeStorage.definitions = [];
  assert.deepEqual(await ensureDefaultAutomations("fixture-owner"), []);
  assert.equal(fakeStorage.writes, 0);
});

function responseFixture() {
  return { statusCode: 200, body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; } };
}

test("actual GET callbacks read only and cannot initialize defaults", async () => {
  fakeStorage.definitions = [definition("paused")];
  fakeStorage.writes = 0;
  const handlers = getHandlers(fakeStorage, getExistingAutomations, () => "fixture-owner");
  for (let i = 0; i < 3; i++) {
    for (const handler of Object.values(handlers)) {
      const res = responseFixture();
      await handler({ query: {} }, res);
      assert.equal(res.statusCode, 200);
    }
  }
  assert.equal(fakeStorage.writes, 0);
  assert.equal(fakeStorage.definitions[0].status, "paused");
});

test("run recording never registers a missing definition or updates a paused one", async () => {
  fakeStorage.definitions = [];
  fakeStorage.runs = [];
  assert.equal(await recordScheduledAutomationRun("fixture-owner", "metricool-daily-analytics-sync", clock(), { status: "skipped", resultSummary: "fixture" }), null);
  assert.equal(fakeStorage.runs.length, 0);
  fakeStorage.definitions = [definition("paused")];
  await recordScheduledAutomationRun("fixture-owner", "metricool-daily-analytics-sync", clock(), { status: "skipped", resultSummary: "fixture" });
  assert.equal(fakeStorage.definitions[0].status, "paused");
  assert.equal(fakeStorage.writes, 0);
  assert.equal(fakeStorage.runs.length, 1);
});

for (const status of ["paused", "disabled", "failed", "missing"]) {
  test(`analytics ${status}: no sync, credentials or fabricated execution`, async () => {
    let sync = 0, records = 0;
    const scheduler = createMetricoolAnalyticsScheduler({
      env: {}, now: clock, getUserIds: async () => ["fixture-owner"],
      getAutomations: async () => status === "missing" ? [] : [definition(status)],
      sync: async () => { sync++; throw new Error("forbidden sync"); },
      recordRun: async () => { records++; throw new Error("forbidden recording"); },
    });
    assert.equal(await scheduler.runNow(), "skipped");
    assert.equal(sync, 0);
    assert.equal(records, 0);
    assert.equal(scheduler.status().runCount, 0);
    assert.equal(scheduler.status().lastStartedAt, null);
  });
}

test("active analytics retains config, executes injected sync and records only active owners", async () => {
  let sync = 0;
  const recorded: string[] = [];
  const env = { METRICOOL_ANALYTICS_SYNC_ENABLED: "true", METRICOOL_ANALYTICS_SYNC_HOUR: "6", METRICOOL_ANALYTICS_SYNC_MINUTE: "45" };
  assert.equal(getMetricoolAnalyticsSyncConfig(env).hour, 6);
  const result = { status: "completed", metricsRecorded: 4, postsSeen: 1, duplicatesSkipped: 0,
    unmatchedSkipped: 0, source: "metricool", lastError: null } as MetricoolAnalyticsSyncResult;
  const scheduler = createMetricoolAnalyticsScheduler({
    env, now: clock, getUserIds: async () => ["active", "paused"],
    setTimeout: () => ({}), clearTimeout: () => {},
    getAutomations: async owner => [definition(owner === "active" ? "active" : "paused")],
    sync: async () => { sync++; return result; },
    recordRun: async owner => { recorded.push(owner); return null; },
  });
  assert.equal(await scheduler.runNow(), "completed");
  assert.equal(sync, 1);
  assert.deepEqual(recorded, ["active"]);
  assert.equal(scheduler.status().completedCount, 1);
});

test("actual endpoint keeps uploads and intent when blocked or uncertain", async () => {
  for (const error of [new BlackRoomPublicationBlockedError("fixture pause"), new BlackRoomMetricoolUncertainError("fixture pending", { tiktok: "existing" })]) {
    let removed = 0, mutations = 0;
    const handler = scheduleHandler({
      hasValidBlackRoomRemoteToken: () => true,
      blackRoomUploads: new Map([["fixture-upload", { ready: true, reservationId: "fixture-reservation" }]]),
      scheduleBlackRoomMetricoolPost: async () => { throw error; },
      removeBlackRoomUpload: async () => { removed++; },
      mutateBlackRoomRemoteControl: async () => { mutations++; },
    });
    const res = responseFixture();
    await handler({ get: () => "fixture.invalid", protocol: "https", body: {
      uploadId: "fixture-upload", reservationId: "fixture-reservation", network: "tiktok",
    } }, res);
    assert.equal(removed, 0);
    assert.equal(mutations, 0);
    assert.equal(res.statusCode, error instanceof BlackRoomPublicationBlockedError ? 423 : 409);
    assert.ok(retainBlackRoomAttempt(res.body as { uncertain?: boolean; retainAttempt?: boolean }));
    if (error instanceof BlackRoomMetricoolUncertainError) assert.deepEqual((res.body as { platformReceipts: unknown }).platformReceipts, { tiktok: "existing" });
  }
});

test("retained and in-flight uploads survive TTL cleanup, ordinary expired ones do not", () => {
  const uploads = new Map([
    ["retained", { expiresAt: 0, retainForReconciliation: true }],
    ["expired", { expiresAt: 0, retainForReconciliation: false }],
  ]);
  const removed: string[] = [];
  cleanupUploads({ blackRoomUploads: uploads, removeBlackRoomUpload: (id: string) => { removed.push(id); uploads.delete(id); } }, clock().getTime());
  assert.deepEqual(removed, ["expired"]);
  assert.ok(uploads.has("retained"));
});

test("confirmed receipt survives failed auxiliary persistence and remains successful", async () => {
  const upload = { ready: true, reservationId: "fixture-reservation", expiresAt: 0, retainForReconciliation: false };
  let removed = 0;
  const receipt = { metricoolId: "existing", platformReceipts: { tiktok: "existing" }, verified: true };
  const handler = scheduleHandler({
    hasValidBlackRoomRemoteToken: () => true, blackRoomUploads: new Map([["fixture-upload", upload]]),
    scheduleBlackRoomMetricoolPost: async () => receipt,
    mutateBlackRoomRemoteControl: async () => { throw new Error("fixture auxiliary failure"); },
    removeBlackRoomUpload: async () => { removed++; },
  });
  const res = responseFixture();
  await handler({ get: () => "fixture.invalid", protocol: "https", body: {
    uploadId: "fixture-upload", reservationId: "fixture-reservation", network: "tiktok",
  } }, res);
  assert.equal(res.statusCode, 201);
  assert.deepEqual((res.body as { receipt: unknown }).receipt, receipt);
  assert.equal(removed, 0);
  assert.equal(upload.retainForReconciliation, true);
});

test("missing identifier after fake POST remains uncertain, never a definite rejection", async () => {
  const fixture = envFixture("true", "false");
  let gets = 0, posts = 0;
  await assert.rejects(scheduleBlackRoomMetricoolPost(input, {
    env: fixture.env, now: clock, readPublicationControl: async () => control(), networks: ["tiktok"],
    fetch: async (_url, init) => {
      if (init?.method === "POST") { posts++; return succeeded(); }
      gets++;
      if (gets === 1) return Response.json([]);
      return Response.json([{ text: input.caption, publicationDate: { dateTime: input.publicationDateTime }, providers: [{ network: "tiktok" }] }]);
    },
  }), BlackRoomMetricoolUncertainError);
  assert.equal(posts, 1);
});

test("partial receipts survive a pause before another network", async () => {
  const fixture = envFixture("true", "false");
  let paused = false, posts = 0;
  await assert.rejects(scheduleBlackRoomMetricoolPost(input, {
    env: fixture.env, now: clock, readPublicationControl: async () => ({ ...control(), desiredEnabled: !paused }),
    networks: ["tiktok", "facebook"],
    fetch: async (_url, init) => { if (init?.method === "POST") posts++; paused = true; return postReceipt(); },
  }), error => error instanceof BlackRoomMetricoolUncertainError
    && error.platformReceipts.tiktok === "fixture-receipt");
  assert.equal(posts, 0);
});

test("actual worker persists acknowledged no-POST veto without reset; explicit resume may dispatch", async () => {
  const entry = { reservationId: "fixture-reservation", status: "reserved", networkAttempts: { tiktok: "uncertain" },
    networkReceipts: { facebook: "already-confirmed" } } as BlackRoomLedgerEntry;
  const commands: string[][] = [];
  const runNpm = async (args: string[]) => {
    commands.push(args);
    assert.ok(args.includes("--network-blocked"));
    markBlackRoomNetworkBlocked(entry, "tiktok", clock());
  };
  await assert.rejects(workerFailure(new BlackRoomPublicationBlockedError("fixture"), false, entry, "tiktok", runNpm));
  assert.equal(commands.length, 1);
  assert.equal(entry.networkAttempts.tiktok, "blocked");
  assert.equal(entry.networkReceipts.facebook, "already-confirmed");
  assert.equal(workerVerifyOnly(entry, "tiktok"), false);
  const fixture = envFixture("true", "false");
  let posts = 0, gets = 0;
  await scheduleBlackRoomMetricoolPost(input, {
    env: fixture.env, now: clock, readPublicationControl: async () => control(),
    networks: ["tiktok"], verifyOnly: workerVerifyOnly(entry, "tiktok"),
    fetch: async (_url, init) => {
      if (init?.method === "POST") { posts++; return succeeded(); }
      return ++gets === 1 ? Response.json([]) : postReceipt();
    },
  });
  assert.equal(posts, 1);
});

test("actual worker never downgrades earlier uncertainty on a verification veto or transport loss", async () => {
  for (const [verifyOnly, error] of [[true, new BlackRoomPublicationBlockedError("fixture")], [false, new Error("fixture transport loss")]] as const) {
    const entry = { reservationId: "fixture-reservation", networkAttempts: { tiktok: "uncertain" },
      networkReceipts: { facebook: "existing" } } as BlackRoomLedgerEntry;
    let commands = 0;
    await assert.rejects(workerFailure(error, verifyOnly, entry, "tiktok", async () => { commands++; }));
    assert.equal(commands, 0);
    assert.equal(workerVerifyOnly(entry, "tiktok"), true);
    assert.equal(entry.networkReceipts.facebook, "existing");
  }
});

test("active definition preserves existing daily frequency/config with fake clock and timers", async () => {
  let current = clock(), tick: (() => void) | undefined, delay = 0, canceled = 0, sync = 0;
  const fakeTimer = {};
  const scheduler = createMetricoolAnalyticsScheduler({
    env: { METRICOOL_ANALYTICS_SYNC_ENABLED: "true", METRICOOL_ANALYTICS_SYNC_HOUR: "6", METRICOOL_ANALYTICS_SYNC_MINUTE: "45" },
    now: () => current, getUserIds: async () => ["fixture-owner"], getAutomations: async () => [definition("active")],
    setInterval: (callback, milliseconds) => { tick = callback; delay = milliseconds; return fakeTimer; },
    clearInterval: handle => { assert.equal(handle, fakeTimer); canceled++; },
    setTimeout: () => fakeTimer, clearTimeout: () => {},
    log: () => {}, logError: () => {},
    sync: async () => { sync++; return { status: "completed", metricsRecorded: 0 } as MetricoolAnalyticsSyncResult; },
    recordRun: async () => null,
  });
  scheduler.start();
  assert.equal(delay, 60_000);
  assert.equal(sync, 0);
  current = new Date("2026-10-08T11:00:00Z");
  tick?.();
  for (let i = 0; i < 15; i++) await Promise.resolve();
  assert.equal(sync, 1);
  tick?.();
  for (let i = 0; i < 15; i++) await Promise.resolve();
  assert.equal(sync, 1);
  scheduler.stop();
  assert.equal(canceled, 1);
});
