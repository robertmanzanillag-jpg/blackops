import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseBlackRoomTeamStatus } from "../shared/blackroom-team";
import { createBlackRoomTeamContext } from "../server/blackroom-team";
import { readBlackRoomTeamState, writeBlackRoomTeamState } from "../server/blackroom-team/state";
import { BlackRoomMetricoolUncertainError, type BlackRoomMetricoolReceipt } from "../server/blackroom-metricool-bridge";
import { BlackRoomPublicationBlockedError } from "../server/blackroom-publication-guard";
import defaultAgent, {
  createBlackRoomPublisherAgent,
  validateBlackRoomPostDraft,
  type BlackRoomPublisherScheduler,
  type BlackRoomPublisherState,
} from "../server/blackroom-team/blackroom-publisher";

const NOW = new Date("2026-11-12T15:00:00Z");
const METRICOOL = { METRICOOL_USER_TOKEN: "tok-real-123", METRICOOL_USER_ID: "42" };
const LIVE = { ...METRICOOL, BLACKROOM_PUBLISHER_LIVE: "true", BLACKROOM_METRICOOL_BRIDGE_PUBLISH_AUTHORIZED: "true", METRICOOL_REQUIRE_APPROVAL_FOR_PUBLISH: "false" };

const DRAFT = {
  caption: "Black Room este sabado: el drop que nadie espera",
  mediaUrl: "https://media.example.org/clip-1.mp4",
  sourceVideoId: "abcdefghijk",
  durationSeconds: 30,
  videoFormat: "vertical",
  language: "es",
  networks: ["tiktok", "facebook"],
  publicationDateTime: "2026-11-14T20:00:00",
};

async function withDir<T>(work: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "br-publisher-"));
  try { return await work(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

function recordingFetch() {
  const calls: string[] = [];
  const fn = (async (url: unknown) => { calls.push(String(url)); throw new Error("la red no debe usarse"); }) as unknown as typeof fetch;
  return { fn, calls };
}

function ctxFor(dataDir: string, env: Record<string, string>, fetchFn: typeof fetch, now = NOW) {
  return createBlackRoomTeamContext("blackroom-publisher", { dataDir, env, fetch: fetchFn, now: () => now, userId: "robert" });
}

function fakeScheduler(impl?: (call: number) => Promise<BlackRoomMetricoolReceipt>) {
  const calls: Array<{ input: Parameters<BlackRoomPublisherScheduler>[0]; options: Parameters<BlackRoomPublisherScheduler>[1] }> = [];
  const schedule: BlackRoomPublisherScheduler = async (input, options) => {
    calls.push({ input, options });
    // The bridge re-reads the authoritative control; it must allow this approved job.
    const control = await options!.readPublicationControl!();
    assert.equal(control.desiredEnabled, true);
    assert.deepEqual(control.queue.jobs, [{ id: input.jobId, status: "processing" }]);
    if (impl) return impl(calls.length);
    return { metricoolId: "mc-1", publicationDateTime: input.publicationDateTime, caption: input.caption, verified: true, platformReceipts: { tiktok: "mc-1", facebook: "mc-2" } };
  };
  return { schedule, calls };
}

async function addAndApprove(agent: ReturnType<typeof createBlackRoomPublisherAgent>, ctx: ReturnType<typeof ctxFor>) {
  const added = await agent.actions!.add(ctx, DRAFT);
  assert.equal(added.ok, true, added.summary);
  const id = (added.report as any).item.id as string;
  const approved = await agent.actions!.approve(ctx, { id });
  assert.equal(approved.ok, true, approved.summary);
  return id;
}

test("blocked: without Metricool credentials the status says exactly what is missing", async () => {
  await withDir(async (dir) => {
    const { fn, calls } = recordingFetch();
    const status = await defaultAgent.getStatus(ctxFor(dir, {}, fn));
    assert.ok(parseBlackRoomTeamStatus(status));
    assert.equal(status.state, "blocked");
    assert.ok(status.needs.some((need) => need.includes("METRICOOL_USER_TOKEN")));
    assert.ok(status.needs.some((need) => need.includes("METRICOOL_USER_ID")));
    assert.ok(status.needs.some((need) => need.includes("BLACKROOM_META_ACCESS_TOKEN")));
    assert.equal(status.lastRunAt, null);
    assert.equal(calls.length, 0);
  });
});

test("available when Metricool is configured and idle; metrics say simulation mode", async () => {
  await withDir(async (dir) => {
    const { fn } = recordingFetch();
    const status = await defaultAgent.getStatus(ctxFor(dir, METRICOOL, fn));
    assert.equal(status.state, "available");
    assert.equal(status.metrics?.modo, "simulacion");
    assert.equal(status.pendingApprovals, 0);
  });
});

test("draft validation rejects bad drafts and ineligible YouTube", () => {
  assert.equal(validateBlackRoomPostDraft(DRAFT, NOW).ok, true);
  const bad = validateBlackRoomPostDraft({ ...DRAFT, caption: "", mediaUrl: "http://x", sourceVideoId: "x", publicationDateTime: "2026-11-12T09:00:00" }, NOW);
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.errors.length, 4);
  const yt = validateBlackRoomPostDraft({ ...DRAFT, videoFormat: "horizontal", networks: ["youtube"] }, NOW);
  assert.equal(yt.ok, false);
  const defaults = validateBlackRoomPostDraft({ ...DRAFT, networks: undefined }, NOW);
  assert.ok(defaults.ok && defaults.draft.networks.includes("youtube"));
});

test("queue: add is idempotent, items start pending + dryRun, and status counts them", async () => {
  await withDir(async (dir) => {
    const { fn } = recordingFetch();
    const agent = createBlackRoomPublisherAgent({ schedule: fakeScheduler().schedule });
    const ctx = ctxFor(dir, METRICOOL, fn);
    const first = await agent.actions!.add(ctx, DRAFT);
    const second = await agent.actions!.add(ctx, { draft: DRAFT });
    assert.equal((first.report as any).item.id, (second.report as any).item.id);
    const item = first.needsApproval![0];
    assert.equal(item.status, "pending");
    assert.equal(item.dryRun, true);
    assert.equal(item.agentId, "blackroom-publisher");
    const state = await readBlackRoomTeamState<BlackRoomPublisherState>(dir, "blackroom-publisher", { version: 1, items: [], lastRunAt: null, lastRunSummary: null });
    assert.equal(state.items.length, 1);
    const status = await agent.getStatus(ctx);
    assert.equal(status.pendingApprovals, 1);
    const invalid = await agent.actions!.add(ctx, { caption: "x" });
    assert.equal(invalid.ok, false);
  });
});

test("safety: run never schedules pending items, even in live mode", async () => {
  await withDir(async (dir) => {
    const { fn, calls: fetchCalls } = recordingFetch();
    const fake = fakeScheduler();
    const agent = createBlackRoomPublisherAgent({ schedule: fake.schedule });
    const ctx = ctxFor(dir, LIVE, fn);
    await agent.actions!.add(ctx, DRAFT);
    const result = await agent.run(ctx);
    assert.equal(fake.calls.length, 0);
    assert.equal(fetchCalls.length, 0);
    assert.equal(result.needsApproval?.length, 1);
    const schedule = await agent.actions!.schedule(ctx, { id: result.needsApproval![0].id });
    assert.equal(schedule.ok, false);
    assert.equal(fake.calls.length, 0);
  });
});

test("safety: approved but without BLACKROOM_PUBLISHER_LIVE only records a dry-run preview (no network, real bridge)", async () => {
  await withDir(async (dir) => {
    const { fn, calls } = recordingFetch();
    // Default module uses the real scheduleBlackRoomMetricoolPost; it must never be reached.
    const env = { ...METRICOOL, BLACKROOM_METRICOOL_BRIDGE_PUBLISH_AUTHORIZED: "true", METRICOOL_REQUIRE_APPROVAL_FOR_PUBLISH: "false" };
    const ctx = ctxFor(dir, env, fn);
    const id = await addAndApprove(defaultAgent as any, ctx);
    const result = await defaultAgent.run(ctx);
    assert.equal(result.ok, true);
    assert.equal(calls.length, 0);
    const listed = await defaultAgent.actions!.list(ctx, {});
    const item = (listed.report as any).items.find((entry: any) => entry.id === id);
    assert.equal(item.dispatch.state, "dry-run");
    assert.equal(item.dryRun, true);
    assert.match(item.dispatch.dryRunPreview.captions.facebook, /youtube\.com\/watch\?v=abcdefghijk/);
    const status = await defaultAgent.getStatus(ctx);
    assert.equal(status.state, "blocked");
    assert.ok(status.needs.some((need) => need.startsWith("BLACKROOM_PUBLISHER_LIVE=true")));
  });
});

test("safety: live flag alone is not enough; the publication guard veto blocks before any IO", async () => {
  await withDir(async (dir) => {
    const { fn, calls } = recordingFetch();
    const fake = fakeScheduler();
    const agent = createBlackRoomPublisherAgent({ schedule: fake.schedule });
    const ctx = ctxFor(dir, { ...METRICOOL, BLACKROOM_PUBLISHER_LIVE: "true" }, fn);
    const id = await addAndApprove(agent, ctx);
    const result = await agent.actions!.schedule(ctx, { id });
    assert.equal(result.ok, false);
    assert.match(result.summary, /bridge_not_authorized/);
    assert.equal(fake.calls.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("happy path: approved + live schedules once through the bridge and persists the receipt", async () => {
  await withDir(async (dir) => {
    const { fn } = recordingFetch();
    const fake = fakeScheduler();
    const agent = createBlackRoomPublisherAgent({ schedule: fake.schedule });
    const ctx = ctxFor(dir, LIVE, fn);
    const id = await addAndApprove(agent, ctx);
    const run = await agent.run(ctx);
    assert.equal(run.ok, true, run.summary);
    assert.equal(fake.calls.length, 1);
    assert.equal(fake.calls[0].input.jobId, id);
    assert.deepEqual(fake.calls[0].options?.networks, ["tiktok", "facebook"]);
    assert.equal(fake.calls[0].options?.fetch, fn);
    // Idempotent: further runs and explicit schedule calls never re-send.
    await agent.run(ctx);
    const again = await agent.actions!.schedule(ctx, { id });
    assert.equal(again.ok, true);
    assert.match(again.summary, /no se vuelve a enviar/);
    assert.equal(fake.calls.length, 1);
    const item = ((await agent.actions!.list(ctx, {})).report as any).items[0];
    assert.equal(item.dispatch.state, "scheduled");
    assert.equal(item.dispatch.receipt.metricoolId, "mc-1");
    assert.equal(item.dryRun, false);
    // Scheduled items are frozen.
    assert.equal((await agent.actions!.reject(ctx, { id })).ok, false);
    assert.equal((await agent.actions!.remove(ctx, { id })).ok, false);
    assert.equal((await agent.actions!.update(ctx, { id, changes: { caption: "otro" } })).ok, false);
    const status = await agent.getStatus(ctx);
    assert.equal(status.state, "working");
    assert.equal(status.lastRunAt, NOW.toISOString());
    assert.equal(status.metrics?.modo, "real");
    // Older than 26h it is no longer "working".
    const later = await agent.getStatus(ctxFor(dir, LIVE, fn, new Date(NOW.getTime() + 27 * 3_600_000)));
    assert.equal(later.state, "available");
  });
});

test("uncertain outcome is never retried automatically; verify reconciles it read-only", async () => {
  await withDir(async (dir) => {
    const { fn } = recordingFetch();
    const fake = fakeScheduler(async (call) => {
      if (call === 1) throw new BlackRoomMetricoolUncertainError("timeout", { tiktok: "mc-1" });
      return { metricoolId: "mc-1", publicationDateTime: DRAFT.publicationDateTime, caption: DRAFT.caption, verified: true, platformReceipts: { tiktok: "mc-1", facebook: "mc-2" } };
    });
    const agent = createBlackRoomPublisherAgent({ schedule: fake.schedule });
    const ctx = ctxFor(dir, LIVE, fn);
    const id = await addAndApprove(agent, ctx);
    const first = await agent.actions!.schedule(ctx, { id });
    assert.equal(first.ok, false);
    assert.equal(first.error, "uncertain");
    let status = await agent.getStatus(ctx);
    assert.equal(status.state, "blocked");
    assert.ok(status.needs[0].includes("verify"));
    await agent.run(ctx);
    assert.equal((await agent.actions!.schedule(ctx, { id })).ok, false);
    assert.equal((await agent.actions!.reject(ctx, { id })).ok, false);
    assert.equal(fake.calls.length, 1);
    const verified = await agent.actions!.verify(ctx, { id });
    assert.equal(verified.ok, true, verified.summary);
    assert.equal(fake.calls.length, 2);
    assert.equal(fake.calls[1].options?.verifyOnly, true);
    status = await agent.getStatus(ctx);
    assert.notEqual(status.state, "blocked");
  });
});

test("a crash mid-dispatch leaves the item frozen as dispatching (no resend)", async () => {
  await withDir(async (dir) => {
    const { fn } = recordingFetch();
    const fake = fakeScheduler();
    const agent = createBlackRoomPublisherAgent({ schedule: fake.schedule });
    const ctx = ctxFor(dir, LIVE, fn);
    const id = await addAndApprove(agent, ctx);
    const state = await readBlackRoomTeamState<BlackRoomPublisherState>(dir, "blackroom-publisher", null as any);
    state.items[0].dispatch.state = "dispatching";
    await writeBlackRoomTeamState(dir, "blackroom-publisher", state);
    await agent.run(ctx);
    assert.equal((await agent.actions!.schedule(ctx, { id })).ok, false);
    assert.equal(fake.calls.length, 0);
    assert.equal((await agent.getStatus(ctx)).state, "blocked");
  });
});

test("guard veto raised inside the bridge keeps the item retryable (definitely not submitted)", async () => {
  await withDir(async (dir) => {
    const { fn } = recordingFetch();
    const fake = fakeScheduler(async (call) => {
      if (call === 1) throw new BlackRoomPublicationBlockedError("control_disabled");
      return { metricoolId: "mc-9", publicationDateTime: DRAFT.publicationDateTime, caption: DRAFT.caption, verified: true, platformReceipts: { tiktok: "mc-9" } };
    });
    const agent = createBlackRoomPublisherAgent({ schedule: fake.schedule });
    const ctx = ctxFor(dir, LIVE, fn);
    const id = await addAndApprove(agent, ctx);
    const first = await agent.actions!.schedule(ctx, { id });
    assert.equal(first.ok, false);
    assert.match(first.summary, /control_disabled/);
    const second = await agent.actions!.schedule(ctx, { id });
    assert.equal(second.ok, true, second.summary);
    assert.equal(fake.calls.length, 2);
  });
});

test("reject stops an approved item; edits require a fresh approval; past-due approvals refused", async () => {
  await withDir(async (dir) => {
    const { fn } = recordingFetch();
    const fake = fakeScheduler();
    const agent = createBlackRoomPublisherAgent({ schedule: fake.schedule });
    const ctx = ctxFor(dir, LIVE, fn);
    const id = await addAndApprove(agent, ctx);
    assert.equal((await agent.actions!.reject(ctx, { id })).ok, true);
    await agent.run(ctx);
    assert.equal(fake.calls.length, 0);

    const added = await agent.actions!.add(ctx, { ...DRAFT, caption: "Otro posteo" });
    const otherId = (added.report as any).item.id;
    await agent.actions!.approve(ctx, { id: otherId });
    const updated = await agent.actions!.update(ctx, { id: otherId, changes: { caption: "Otro posteo editado" } });
    assert.equal(updated.ok, true);
    assert.equal(updated.needsApproval![0].status, "pending");
    await agent.run(ctx);
    assert.equal(fake.calls.length, 0);

    const lateCtx = ctxFor(dir, LIVE, fn, new Date("2026-11-15T12:00:00Z"));
    const late = await agent.actions!.approve(lateCtx, { id: otherId });
    assert.equal(late.ok, false);
    assert.equal(late.error, "past_due");
  });
});

test("Meta channel never posts directly and says what is missing", async () => {
  await withDir(async (dir) => {
    const { fn, calls } = recordingFetch();
    const fake = fakeScheduler();
    const agent = createBlackRoomPublisherAgent({ schedule: fake.schedule });
    const ctx = ctxFor(dir, LIVE, fn);
    const added = await agent.actions!.add(ctx, { ...DRAFT, channel: "meta" });
    const id = (added.report as any).item.id;
    await agent.actions!.approve(ctx, { id });
    const result = await agent.actions!.schedule(ctx, { id });
    assert.equal(result.ok, false);
    assert.match(result.summary, /BLACKROOM_META_ACCESS_TOKEN/);
    assert.equal(fake.calls.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("draft validation: Drive viewer links are refused; the YouTube set is optional", () => {
  for (const viewer of ["https://drive.google.com/file/d/1AbC/view", "https://drive.google.com/file/d/1AbC/view?usp=sharing", "https://docs.google.com/file/d/1AbC/edit", "https://drive.google.com/open?id=1AbC"]) {
    const result = validateBlackRoomPostDraft({ ...DRAFT, mediaUrl: viewer }, NOW);
    assert.equal(result.ok, false, viewer);
    if (!result.ok) assert.ok(result.errors.some((error) => /descarga directa/.test(error)), viewer);
  }
  assert.equal(validateBlackRoomPostDraft({ ...DRAFT, mediaUrl: "https://drive.usercontent.google.com/download?id=1AbC&export=download" }, NOW).ok, true);
  const noSet = validateBlackRoomPostDraft({ ...DRAFT, sourceVideoId: undefined, networks: undefined }, NOW);
  assert.ok(noSet.ok);
  if (noSet.ok) assert.equal(noSet.draft.sourceVideoId, "");
  assert.equal(validateBlackRoomPostDraft({ ...DRAFT, sourceVideoId: "corto" }, NOW).ok, false, "a present id must still be valid");
});

test("a clip without a YouTube set previews captions without the set link", async () => {
  await withDir(async (dir) => {
    const { fn, calls } = recordingFetch();
    const agent = createBlackRoomPublisherAgent();
    const ctx = ctxFor(dir, METRICOOL, fn);
    const added = await agent.actions!.add(ctx, { ...DRAFT, sourceVideoId: "", networks: ["tiktok", "facebook", "youtube"] });
    assert.equal(added.ok, true, added.summary);
    const id = (added.report as any).item.id as string;
    assert.equal((await agent.actions!.approve(ctx, { id })).ok, true);
    await agent.run(ctx);
    const item = ((await agent.actions!.list(ctx, {})).report as any).items[0];
    assert.equal(item.dispatch.state, "dry-run");
    assert.doesNotMatch(item.dispatch.dryRunPreview.captions.facebook, /watch\?v=/);
    assert.doesNotMatch(item.dispatch.dryRunPreview.captions.youtube, /watch\?v=/);
    assert.deepEqual(calls, []);
  });
});

test("concurrent add (e.g. from Scripts) never overwrites a dispatch receipt", async () => {
  await withDir(async (dir) => {
    const { fn } = recordingFetch();
    const ctx = ctxFor(dir, LIVE, fn);
    // A second module instance with its own store, like the Scripts agent uses; its save is slow so
    // an unserialized add would write back a stale copy after the dispatch finished.
    const other = createBlackRoomPublisherAgent();
    const store = ctx.state;
    const slowCtx = { ...ctx, state: { load: store.load, save: async <T>(value: T) => { await new Promise((resolve) => setTimeout(resolve, 60)); await store.save(value); } } };
    let concurrentAdd: Promise<unknown> | null = null;
    const fake = fakeScheduler(async () => {
      concurrentAdd = other.actions!.add(slowCtx, { ...DRAFT, caption: "Otro clip de Scripts" });
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { metricoolId: "mc-1", publicationDateTime: DRAFT.publicationDateTime, caption: DRAFT.caption, verified: true, platformReceipts: { tiktok: "mc-1", facebook: "mc-2" } };
    });
    const agent = createBlackRoomPublisherAgent({ schedule: fake.schedule });
    const id = await addAndApprove(agent, ctx);
    await agent.run(ctx);
    await concurrentAdd;
    const state = (await readBlackRoomTeamState<BlackRoomPublisherState | null>(dir, "blackroom-publisher", null))!;
    assert.equal(state.items.length, 2, "the concurrent add is kept");
    const sent = state.items.find((item) => item.id === id)!;
    assert.equal(sent.dispatch.state, "scheduled");
    assert.equal(sent.dispatch.receipt?.metricoolId, "mc-1", "the receipt survives");
    // A further run never re-sends it.
    await agent.run(ctx);
    assert.equal(fake.calls.length, 1);
  });
});
