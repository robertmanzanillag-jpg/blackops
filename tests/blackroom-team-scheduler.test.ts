import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BLACKROOM_SCHEDULED_JOBS, createBlackRoomTeamScheduler, dueBlackRoomJobs } from "../server/blackroom-team/scheduler";
import { BLACKROOM_TEAM_IDS, type BlackRoomTeamAgentId, type BlackRoomTeamAgentModule } from "../shared/blackroom-team";

const NOW = new Date("2026-11-12T12:00:00Z");

function stubModules(calls: string[], failing: string[] = []) {
  const modules = {} as Record<BlackRoomTeamAgentId, BlackRoomTeamAgentModule>;
  for (const id of BLACKROOM_TEAM_IDS) {
    const handler = async (_ctx: unknown, input: Record<string, unknown>) => {
      calls.push(`${id}:${JSON.stringify(input)}`);
      if (failing.includes(id)) throw new Error("boom");
      return { ok: true, summary: `${id} listo` };
    };
    modules[id] = {
      id,
      getStatus: async () => ({ id, state: "available", label: "", summary: "", needs: [], lastRunAt: null }),
      run: (ctx, input = {}) => handler(ctx, input),
      actions: { "daily-report": handler, approve: handler, schedule: handler },
    };
  }
  return modules;
}

async function withDir(fn: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "br-sched-"));
  try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

test("first tick runs every enabled job once, in order, with the CEO brief last; nothing posts or approves", async () => {
  await withDir(async (dataDir) => {
    const calls: string[] = [];
    const scheduler = createBlackRoomTeamScheduler({ env: {}, now: () => NOW, dataDir, ownerUserId: () => "robert", context: { modules: stubModules(calls) }, log: () => undefined });
    const ran = await scheduler.tick();
    assert.deepEqual(ran, ["analytics-daily", "website-check", "competition-scan", "publisher-approved", "ceo-brief"]);
    assert.equal(calls.length, 5);
    assert.ok(calls.every((call) => !/approve|schedule/.test(call)), "the scheduler never calls approve or schedule actions");
    assert.ok(calls[0].startsWith("blackroom-analytics:"));
    assert.ok(calls.at(-1)!.startsWith("blackroom-ceo:"));
    const saved = JSON.parse(await readFile(path.join(dataDir, "scheduler.json"), "utf8"));
    assert.equal(saved.jobs["analytics-daily"].lastOk, true);
  });
});

test("jobs do not rerun before their interval, and survive a restart through the saved state", async () => {
  await withDir(async (dataDir) => {
    const calls: string[] = [];
    let now = NOW;
    const make = () => createBlackRoomTeamScheduler({ env: {}, now: () => now, dataDir, context: { modules: stubModules(calls) }, log: () => undefined });
    await make().tick();
    calls.length = 0;
    now = new Date(NOW.getTime() + 20 * 60_000);
    assert.deepEqual(await make().tick(), ["publisher-approved"], "only the 15-minute job is due after 20 minutes");
    now = new Date(NOW.getTime() + 7 * 60 * 60_000);
    assert.deepEqual(await make().tick(), ["analytics-daily", "website-check", "publisher-approved"]);
  });
});

test("render jobs only run with BLACKROOM_SCRIPTS_RENDER_ENABLED=true, and the scheduler can be turned off", async () => {
  const state = { version: 1 as const, jobs: {} };
  assert.ok(!dueBlackRoomJobs(state, NOW, {}).some((job) => job.id === "scripts-edits"));
  assert.ok(dueBlackRoomJobs(state, NOW, { BLACKROOM_SCRIPTS_RENDER_ENABLED: "true" }).some((job) => job.id === "scripts-edits"));
  await withDir(async (dataDir) => {
    const calls: string[] = [];
    const scheduler = createBlackRoomTeamScheduler({ env: { BLACKROOM_TEAM_SCHEDULER_ENABLED: "false" }, now: () => NOW, dataDir, context: { modules: stubModules(calls) }, log: () => undefined });
    assert.deepEqual(await scheduler.tick(), []);
    assert.equal(calls.length, 0);
  });
});

test("a failing agent is recorded and does not stop the others; a busy agent is skipped", async () => {
  await withDir(async (dataDir) => {
    const calls: string[] = [];
    const running = new Set<string>(["blackroom-website"]);
    const scheduler = createBlackRoomTeamScheduler({ env: {}, now: () => NOW, dataDir, running, context: { modules: stubModules(calls, ["blackroom-analytics"]) }, log: () => undefined });
    const ran = await scheduler.tick();
    assert.ok(!ran.includes("website-check"), "busy agent skipped");
    assert.ok(ran.includes("analytics-daily") && ran.includes("ceo-brief"));
    const saved = JSON.parse(await readFile(path.join(dataDir, "scheduler.json"), "utf8"));
    assert.equal(saved.jobs["analytics-daily"].lastOk, false);
    assert.match(saved.jobs["analytics-daily"].lastSummary, /boom/);
    assert.equal(running.size, 1, "the busy set is restored");
  });
});

test("every scheduled job targets a real Black Room agent", () => {
  for (const job of BLACKROOM_SCHEDULED_JOBS) assert.ok((BLACKROOM_TEAM_IDS as readonly string[]).includes(job.agentId), job.id);
});
