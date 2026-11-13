import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { BlackRoomTeamMemberId, BlackRoomTeamStatus } from "../shared/blackroom-team";
import { createBlackRoomTeamContext, getBlackRoomTeamStatus, BLACKROOM_TEAM_MODULES } from "../server/blackroom-team";
import ceoDefault, {
  blackRoomCeoQueuePath,
  buildBlackRoomCeoBrief,
  createBlackRoomCeoAgent,
  formatBlackRoomCeoBriefText,
  type BlackRoomCeoBrief,
} from "../server/blackroom-team/blackroom-ceo";

const NOW = new Date("2026-11-12T15:00:00Z");
const noFetch = (async () => { throw new Error("la red no debe usarse"); }) as unknown as typeof fetch;

function status(id: BlackRoomTeamMemberId, state: BlackRoomTeamStatus["state"], extra: Partial<BlackRoomTeamStatus> = {}): BlackRoomTeamStatus {
  return { id, state, label: `${id} ${state}`, summary: `resumen ${id}`, needs: [], lastRunAt: null, ...extra };
}

async function withDir<T>(work: (dataDir: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(path.join(os.tmpdir(), "br-ceo-"));
  try {
    return await work(path.join(root, "team"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** Context with fake teammates: the CEO reads them through ctx.readTeammateStatus. */
function fakeContext(dataDir: string, team: Partial<Record<BlackRoomTeamMemberId, BlackRoomTeamStatus | null>>, env: Record<string, string> = {}, now = NOW) {
  const base = createBlackRoomTeamContext("blackroom-ceo", { dataDir, env, fetch: noFetch, now: () => now, userId: "robert" });
  const reads: string[] = [];
  return { ctx: { ...base, async readTeammateStatus(id: BlackRoomTeamMemberId) { reads.push(id); return team[id] ?? null; } }, reads };
}

const HEALTHY_TEAM: Partial<Record<BlackRoomTeamMemberId, BlackRoomTeamStatus>> = {
  "blackroom-analytics": status("blackroom-analytics", "working", { lastRunAt: "2026-11-12T10:00:00Z" }),
  "blackroom-competition": status("blackroom-competition", "available"),
  "blackroom-publisher": status("blackroom-publisher", "available", { pendingApprovals: 3 }),
  "blackroom-scripts": status("blackroom-scripts", "available"),
  "blackroom-website": status("blackroom-website", "blocked", { needs: ["BLACKROOM_WEBSITE_URL"] }),
  "blackroom-videos": status("blackroom-videos", "available"),
  radio: status("radio", "idle"),
};

test("happy path: run reads every teammate, builds and stores the brief, then reports working", async () => {
  await withDir(async (dataDir) => {
    let telegramCalls = 0;
    const agent = createBlackRoomCeoAgent({
      readGrowthAnalytics: async () => ({ sampleCount: 40, comparableSampleCount: 30, confidence: "learning", recommendedTimes: ["21:00"], creativeStrategy: "drop_first", creativeReason: "ok", reason: "ok", networkMedianViews: {}, networkLowViewRate: {} } as never),
      sendTelegramSummary: async () => { telegramCalls++; return { sent: true, note: "x" }; },
    });
    const { ctx, reads } = fakeContext(dataDir, HEALTHY_TEAM);
    assert.equal((await agent.getStatus(ctx)).state, "available");

    const result = await agent.run(ctx, {});
    assert.equal(result.ok, true);
    assert.equal(result.needsApproval, undefined, "the CEO creates no outward approvals of its own");
    const brief = result.report as BlackRoomCeoBrief;
    assert.deepEqual(reads.sort(), ["blackroom-analytics", "blackroom-competition", "blackroom-publisher", "blackroom-scripts", "blackroom-videos", "blackroom-website", "radio"]);
    assert.equal(brief.members.length, 7);
    assert.deepEqual(brief.counts, { working: 1, available: 4, blocked: 1, idle: 1, unreachable: 0, pendingApprovals: 3 });
    assert.deepEqual(brief.approvalsForRobert.map((item) => [item.agentId, item.pending]), [["blackroom-publisher", 3]]);
    assert.match(brief.priorities[0], /Robert: revisar 3/);
    assert.ok(brief.priorities.some((item) => /Website Black Room: BLACKROOM_WEBSITE_URL/.test(item)));
    assert.ok(brief.delegations.some((item) => item.agentId === "robert" && /BLACKROOM_WEBSITE_URL/.test(item.task)));
    const publisherTask = brief.delegations.find((item) => item.agentId === "blackroom-publisher")!.task;
    assert.match(publisherTask, /dry-run/);
    assert.match(publisherTask, /aprobacion de Robert/);
    assert.equal(brief.strategy.source, "growth-ceo");
    assert.equal(brief.strategy.slots.length, brief.strategy.postsToday);
    assert.ok(!brief.delegations.some((item) => item.agentId === "blackroom-website"), "blocked agents get no work, Robert gets the setup task");
    assert.equal(brief.telegram.sent, false);
    assert.equal(telegramCalls, 0, "Telegram is off without BLACKROOM_CEO_TELEGRAM=true");
    assert.match(formatBlackRoomCeoBriefText(brief), /Esperando tu aprobacion/);

    const stored = JSON.parse(await readFile(path.join(dataDir, "blackroom-ceo.json"), "utf8"));
    assert.equal(stored.lastRunAt, NOW.toISOString());
    assert.equal(stored.briefs.length, 1);

    const after = await agent.getStatus(ctx);
    assert.equal(after.state, "working");
    assert.equal(after.lastRunAt, NOW.toISOString());
    assert.equal(after.metrics?.por_aprobar_robert, 3);

    // Evidence goes stale after 26h.
    const later = fakeContext(dataDir, HEALTHY_TEAM, {}, new Date(NOW.getTime() + 27 * 3600_000)).ctx;
    const stale = await agent.getStatus(later);
    assert.equal(stale.state, "available");
    assert.equal(stale.label, "Brief vencido");

    assert.equal((await agent.actions!.latest(ctx, {})).ok, true);
    assert.equal(((await agent.actions!.history(ctx, {})).report as unknown[]).length, 1);
    assert.equal(((await agent.actions!.escalations(ctx, {})).report as unknown[]).length, 1);
  });
});

test("reuses the growth CEO queue analytics from clippers_workspace/blackroom/agent/queue.json", async () => {
  await withDir(async (dataDir) => {
    const queuePath = blackRoomCeoQueuePath(dataDir);
    assert.equal(queuePath, path.join(path.dirname(dataDir), "agent", "queue.json"));
    await mkdir(path.dirname(queuePath), { recursive: true });
    await writeFile(queuePath, JSON.stringify({ analytics: { sampleCount: 2, comparableSampleCount: 2, confidence: "collecting", recommendedTimes: [], creativeStrategy: "drop_first", reason: "recolectando", networkErrors: { tiktok: "401" } } }));
    const { ctx } = fakeContext(dataDir, HEALTHY_TEAM);
    const brief = (await ceoDefault.run(ctx, {})).report as BlackRoomCeoBrief;
    assert.equal(brief.strategy.source, "growth-ceo");
    assert.equal(brief.strategy.postsToday, 5);
    assert.ok(brief.risks.some((risk) => /tiktok/.test(risk)));
    assert.ok(brief.risks.some((risk) => /recolectando/.test(risk)));
  });
});

test("blocked path: unreadable teammates and missing analytics are risks, never fake progress", async () => {
  await withDir(async (dataDir) => {
    const agent = createBlackRoomCeoAgent({ readGrowthAnalytics: async () => { throw new Error("queue corrupta"); } });
    const { ctx } = fakeContext(dataDir, {
      "blackroom-analytics": status("blackroom-analytics", "blocked", { needs: ["METRICOOL_USER_TOKEN"] }),
      "blackroom-publisher": status("blackroom-publisher", "working", { lastRunAt: "2026-11-01T00:00:00Z" }),
    });
    const brief = (await agent.run(ctx, {})).report as BlackRoomCeoBrief;
    assert.equal(brief.counts.unreachable, 5);
    assert.equal(brief.counts.blocked, 1);
    assert.equal(brief.strategy.source, "sin-datos");
    assert.equal(brief.strategy.postsToday, 5);
    assert.ok(brief.risks.some((risk) => /queue corrupta/.test(risk)));
    assert.ok(brief.risks.some((risk) => /Publicador Black Room dice que trabaja/.test(risk)));
    assert.ok(brief.priorities.some((item) => /METRICOOL_USER_TOKEN/.test(item)));
    assert.ok(!brief.members.find((member) => member.id === "blackroom-publisher")!.ranRecently);

    const allDown = buildBlackRoomCeoBrief({ now: NOW, statuses: {}, analytics: null });
    assert.ok(allDown.risks.some((risk) => /Ningun agente/.test(risk)));
  });
});

test("a corrupt state file reports blocked with the exact need", async () => {
  await withDir(async (dataDir) => {
    await mkdir(dataDir, { recursive: true });
    await writeFile(path.join(dataDir, "blackroom-ceo.json"), "{no es json");
    const { ctx } = fakeContext(dataDir, {});
    const result = await ceoDefault.getStatus(ctx);
    assert.equal(result.state, "blocked");
    assert.match(result.needs[0], /blackroom-ceo\.json/);
  });
});

test("safety: no approve/publish actions, no network, Telegram only with the opt-in flag", async () => {
  assert.deepEqual(Object.keys(ceoDefault.actions || {}).sort(), ["brief", "escalations", "history", "latest"]);
  for (const forbidden of ["approve", "reject", "publish", "post"]) assert.equal(Object.hasOwn(ceoDefault.actions!, forbidden), false);

  await withDir(async (dataDir) => {
    const sent: string[] = [];
    const agent = createBlackRoomCeoAgent({ readGrowthAnalytics: async () => null, sendTelegramSummary: async (_ctx, text) => { sent.push(text); return { sent: true, note: "enviado" }; } });
    // The default context fetch throws: any network use would fail the run.
    const off = await agent.run(fakeContext(dataDir, HEALTHY_TEAM).ctx, {});
    assert.equal(off.ok, true);
    assert.equal(sent.length, 0);
    assert.match((off.report as BlackRoomCeoBrief).telegram.note, /desactivado/);

    const dry = await agent.run(fakeContext(dataDir, HEALTHY_TEAM, { BLACKROOM_CEO_TELEGRAM: "true" }).ctx, { dryRun: true });
    assert.equal(sent.length, 0);
    assert.match((dry.report as BlackRoomCeoBrief).telegram.note, /dry-run/);

    const on = await agent.run(fakeContext(dataDir, HEALTHY_TEAM, { BLACKROOM_CEO_TELEGRAM: "true" }).ctx, {});
    assert.equal(sent.length, 1);
    assert.equal((on.report as BlackRoomCeoBrief).telegram.sent, true);
    assert.match(sent[0], /brief del CEO/);

    // A failing Telegram send never fails the brief.
    const failing = createBlackRoomCeoAgent({ readGrowthAnalytics: async () => null, sendTelegramSummary: async () => { throw new Error("telegram caido"); } });
    const failed = await failing.run(fakeContext(dataDir, HEALTHY_TEAM, { BLACKROOM_CEO_TELEGRAM: "true" }).ctx, {});
    assert.equal(failed.ok, true);
    assert.match((failed.report as BlackRoomCeoBrief).telegram.note, /telegram caido/);
  });

  // Default Telegram sender without a token skips without touching storage or the network.
  await withDir(async (dataDir) => {
    const { ctx } = fakeContext(dataDir, HEALTHY_TEAM, { BLACKROOM_CEO_TELEGRAM: "true" });
    const result = await ceoDefault.run(ctx, {});
    assert.match((result.report as BlackRoomCeoBrief).telegram.note, /TELEGRAM_BOT_TOKEN/);
  });
});

test("through the real registry, offline with no credentials, the CEO is not working", async () => {
  await withDir(async (dataDir) => {
    const result = await getBlackRoomTeamStatus("blackroom-ceo", { dataDir, env: {}, fetch: noFetch, now: () => NOW, readLegacyMember: async () => null, modules: BLACKROOM_TEAM_MODULES });
    assert.equal(result.id, "blackroom-ceo");
    assert.notEqual(result.state, "working");
  });
});
