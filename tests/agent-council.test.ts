import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  LESSON_STREAK,
  SCOUT_WATCHLIST,
  applyApprovedProposal,
  applyLessons,
  diffScoutReleases,
  emptyCouncilState,
  finishCycle,
  mergeDebates,
  parseCouncilState,
  pruneProposals,
  runCrossChecks,
  type CouncilProposal,
  type CouncilSignals,
} from "../shared/agent-council";
import { createAgentCouncil, readSkillDocs, writeFileAtomic, type CouncilDeps } from "../server/agent-council";
import { readFile } from "node:fs/promises";

const NOW = Date.parse("2026-11-04T12:00:00Z");
const HOUR = 3_600_000;
const base = (extra: Partial<CouncilSignals> = {}): CouncilSignals => ({ now: NOW, ...extra });
const rules = (signals: CouncilSignals) => runCrossChecks(signals).map((finding) => finding.ruleId).sort();

test("clean signals produce no debates", () => {
  assert.deepEqual(
    runCrossChecks(base({
      clippers: { status: "completed", configurationBlockers: [], failedStage: null },
      dropshipping: { launchReadiness: { status: "ready_for_test_order" }, snapshot: { profitGuard: { status: "ok", canSpendUsd: 0 } } },
      automationRuns: [{ status: "success", startedAt: new Date(NOW - HOUR).toISOString() }],
      appProjects: [{ id: "a", name: "Kong", status: "healthy" }],
      appIncidents: [],
      marketing: { clients: [{ name: "Kong", status: "ready", handoff: { status: "ready" } }] },
      skills: [{ name: "qa-gate", path: ".claude/skills/qa-gate/SKILL.md", description: "x", truncatedInChat: false, bodyChars: 500, missingPaths: [] }],
      skillsListedInClaudeMd: ["qa-gate"],
    })),
    []
  );
});

test("App QA catches Clippers claiming 'completed' with blockers", () => {
  const [finding] = runCrossChecks(base({ clippers: { status: "completed", configurationBlockers: ["metricool_user_token_missing"], nextAction: { message: "Conectar Metricool" } } }));
  assert.equal(finding.reviewer, "app-qa");
  assert.equal(finding.subject, "clippers");
  assert.equal(finding.defense, "Conectar Metricool");
  // Clippers' own status already says "needs-setup" for blockers, so the CEO confirms instead of escalating.
  assert.equal(finding.verdict, "confirmado");
  assert.deepEqual(rules(base({ clippers: { status: "never_run", configurationBlockers: ["x"] } })), []);
  assert.deepEqual(rules(base({ clippers: { status: "running", configurationBlockers: ["left over from last report"] } })), [], "running shows the previous report's blockers");
});

test("healthy Dropshipping with no money collected yet is not flagged (canSpendUsd is 0 until a sale)", () => {
  assert.deepEqual(rules(base({ dropshipping: { launchReadiness: { status: "ready_for_test_order" }, snapshot: { profitGuard: { status: "ok", canSpendUsd: 0 } } } })), []);
});

test("CEO reviews automations: failures in 24 h and approvals stuck > 48 h", () => {
  const runs = [
    { status: "failed", automationId: "metricool", errorMessage: "token", startedAt: new Date(NOW - 2 * HOUR).toISOString() },
    { status: "failed", automationId: "old", startedAt: new Date(NOW - 40 * HOUR).toISOString() },
    { status: "pending_approval", automationId: "post", startedAt: new Date(NOW - 50 * HOUR).toISOString() },
  ];
  const findings = runCrossChecks(base({ automationRuns: runs }));
  assert.deepEqual(findings.map((f) => f.ruleId).sort(), ["automations-failed-runs", "automations-stuck-approvals"]);
  assert.equal(findings.find((f) => f.ruleId === "automations-failed-runs")!.claim, "1 corrida(s) fallaron en las ultimas 24 h.");
});

test("database rows with Date objects are read correctly (not only ISO strings)", () => {
  const runs = [
    { status: "failed", automationId: "metricool", errorMessage: "token FAKEtokenFAKEtokenFAKEtoken12345 vencido", startedAt: new Date(NOW - HOUR) },
    { status: "pending_approval", automationId: "post", startedAt: new Date(NOW - 50 * HOUR) },
  ];
  const findings = runCrossChecks(base({ automationRuns: runs }));
  assert.deepEqual(findings.map((f) => f.ruleId).sort(), ["automations-failed-runs", "automations-stuck-approvals"]);
  const evidence = findings.find((f) => f.ruleId === "automations-failed-runs")!.evidence.join(" ");
  assert.match(evidence, /\[redactado\]/, "token-like strings never reach the state file or Trust Center");
  assert.doesNotMatch(evidence, /FAKEtoken/);
  const uuid = "3f2b8c1e-9a4d-4c7e-8f10-2b3c4d5e6f70";
  const withId = runCrossChecks(base({ automationRuns: [{ status: "failed", automationId: uuid, errorMessage: `run ${uuid} failed`, startedAt: new Date(NOW - HOUR) }] }));
  assert.match(withId[0].evidence[0], new RegExp(`^${uuid}: run ${uuid} failed$`), "record ids stay readable");
});

test("Cybersecurity cross-checks app status against incidents", () => {
  const ids = rules(base({
    appProjects: [
      { id: "a", name: "Kong", status: "down" },
      { id: "b", name: "BR", status: "healthy" },
      { id: "c", name: "New", status: "unknown" },
      { id: "d", name: "Down with incident", status: "down" },
    ],
    appIncidents: [
      { appProjectId: "b", status: "open", severity: "critical" },
      { appProjectId: "d", status: "investigating", severity: "high" },
    ],
  }));
  assert.deepEqual(ids, ["app-down-without-incident", "app-healthy-with-critical", "apps-without-health-evidence"]);
  const down = runCrossChecks(base({ appProjects: [{ id: "a", name: "Kong", status: "down" }], appIncidents: [] }))[0];
  assert.deepEqual(down.evidence, ["Kong: caida"]);
});

test("Claude Reviewer verifies skill documents and CLAUDE.md promises", () => {
  const ids = rules(base({
    skills: [
      { name: "long", path: "p/long", description: "x", truncatedInChat: true, bodyChars: 2000, missingPaths: [] },
      { name: "nodesc", path: "p/nodesc", description: "", truncatedInChat: false, bodyChars: 100, missingPaths: ["docs/gone.md"] },
    ],
    skillsListedInClaudeMd: ["long", "nodesc", "ghost"],
  }));
  assert.deepEqual(ids, ["claude-md-missing-skills", "skill-missing-paths:nodesc", "skill-no-description:nodesc", "skills-truncated"]);
});

test("debates keep a streak across cycles and resolve when the problem disappears", () => {
  const finding = runCrossChecks(base({ appProjects: [{ id: "a", name: "Kong", status: "down" }] }));
  let state = emptyCouncilState();
  for (let i = 0; i < 3; i++) state = finishCycle(state, { findings: finding, statuses: {}, now: NOW + i * HOUR });
  assert.equal(state.debates[0].streak, 3);
  assert.equal(state.debates[0].firstSeen, new Date(NOW).toISOString());
  const merged = mergeDebates(state.debates, [], NOW + 5 * HOUR);
  assert.equal(merged.active.length, 0);
  assert.equal(merged.resolved[0].resolvedAt, new Date(NOW + 5 * HOUR).toISOString());
});

test("repeated escalations become ONE lesson proposal; approval changes how the agent is shown", () => {
  const findings = runCrossChecks(base({ appProjects: [{ id: "a", name: "Kong", status: "down" }], appIncidents: [] }));
  let state = emptyCouncilState();
  for (let i = 0; i < LESSON_STREAK + 3; i++) state = finishCycle(state, { findings, statuses: {}, now: NOW + i * HOUR });
  const lessons = state.proposals.filter((p) => p.kind === "lesson");
  assert.equal(lessons.length, 1, "no duplicate proposals across cycles");
  assert.equal(Object.keys(applyLessons(state.debates, state.lessons)).length, 0, "nothing changes before approval");
  state = applyApprovedProposal(state, lessons[0].key, NOW + 10 * HOUR);
  assert.equal(state.lessons.length, 1);
  assert.match(applyLessons(state.debates, state.lessons).control.label, /Requiere atencion/);
  state = applyApprovedProposal(state, lessons[0].key, NOW + 11 * HOUR);
  assert.equal(state.lessons.length, 1, "approving twice does not duplicate the lesson");
  for (let i = 0; i < 3; i++) state = finishCycle(state, { findings, statuses: {}, now: NOW + (12 + i) * HOUR });
  assert.equal(state.proposals.filter((p) => p.kind === "lesson").length, 1, "learned lessons are not proposed again");
});

test("all truncated skills become ONE grouped skill_update proposal with a PR-first brief", () => {
  const skill = (name: string) => ({ name, path: `.claude/skills/${name}/SKILL.md`, description: "x", truncatedInChat: true, bodyChars: 2000, missingPaths: [] });
  const findings = runCrossChecks(base({ skills: [skill("a"), skill("b"), skill("c")] }));
  assert.equal(findings.length, 1);
  let state = finishCycle(emptyCouncilState(), { findings, statuses: {}, now: NOW });
  state = finishCycle(state, { findings, statuses: {}, now: NOW + HOUR });
  const updates = state.proposals.filter((p) => p.kind === "skill_update");
  assert.equal(updates.length, 1);
  assert.match(updates[0].handoffBrief, /PR-first/);
  assert.match(updates[0].handoffBrief, /\.claude\/skills\/b\/SKILL\.md/);
});

test("agent factory: the CEO proposes helpers only for agents stuck > 7 days, max 2 open", () => {
  let state = emptyCouncilState();
  const stuck = { state: "needs-setup" as const, label: "Falta config" };
  const statuses = { clippers: stuck, revenue: stuck, radio: stuck, portfolio: stuck };
  state = finishCycle(state, { findings: [], statuses, now: NOW });
  state = finishCycle(state, { findings: [], statuses, now: NOW + 3 * 24 * HOUR });
  assert.equal(state.proposals.filter((p) => p.kind === "new_agent").length, 0, "no hiring before 7 days");
  state = finishCycle(state, { findings: [], statuses, now: NOW + 8 * 24 * HOUR, agentNames: { clippers: "Clippers" } });
  const hires = state.proposals.filter((p) => p.kind === "new_agent");
  assert.equal(hires.length, 2, "never more than 2 open hiring proposals");
  assert.ok(hires.some((p) => p.title === "Contratar asistente de configuracion para Clippers"));
  assert.equal(finishCycle(state, { findings: [], statuses, now: NOW + 9 * 24 * HOUR }).proposals.filter((p) => p.kind === "new_agent").length, 2);
});

test("rejected proposals wait 30 days from the rejection, then come back once with the same key", () => {
  const findings = runCrossChecks(base({ skills: [{ name: "long", path: "p", description: "x", truncatedInChat: true, bodyChars: 2000, missingPaths: [] }] }));
  let state = finishCycle(emptyCouncilState(), { findings, statuses: {}, now: NOW });
  const rejectedAt = new Date(NOW + 10 * 24 * HOUR).toISOString();
  state = { ...state, proposals: state.proposals.map((p) => ({ ...p, status: "rejected" as const, closedAt: rejectedAt })) };
  assert.equal(finishCycle(state, { findings, statuses: {}, now: NOW + 35 * 24 * HOUR }).proposals.length, 1, "cooldown counts from the rejection");
  const back = finishCycle(state, { findings, statuses: {}, now: NOW + 41 * 24 * HOUR }).proposals;
  assert.equal(back.length, 1, "old rejected entry is replaced, keys stay unique");
  assert.equal(back[0].status, "pending_submit");
});

test("pruning never drops open proposals", () => {
  const make = (i: number, status: CouncilProposal["status"]): CouncilProposal => ({ key: `k${i}`, kind: "skill_update", owner: "x", title: "t", description: "d", evidence: [], handoffBrief: "", createdAt: "", status });
  const pruned = pruneProposals([...Array.from({ length: 70 }, (_, i) => make(i, "applied")), make(99, "submitted")]);
  assert.equal(pruned.length, 60);
  assert.ok(pruned.some((p) => p.key === "k99"));
});

test("skills scout: baseline first, then exactly one proposal per new release", () => {
  const repo = SCOUT_WATCHLIST[0].repo;
  const first = diffScoutReleases({}, [{ repo, tag: "v1", url: "u1", publishedAt: null }], [], NOW);
  assert.equal(first.proposals.length, 0);
  assert.equal(first.lastSeen[repo], "v1");
  const same = diffScoutReleases(first.lastSeen, [{ repo, tag: "v1", url: "u1", publishedAt: null }], [], NOW);
  assert.equal(same.proposals.length, 0);
  const next = diffScoutReleases(first.lastSeen, [{ repo, tag: "v2", url: "u2", publishedAt: null }, { repo: "not/watched", tag: "x", url: "", publishedAt: null }], [], NOW);
  assert.equal(next.proposals.length, 1);
  assert.match(next.proposals[0].handoffBrief, /suscripcion/);
  assert.equal(diffScoutReleases(first.lastSeen, [{ repo, tag: "v2", url: "u2", publishedAt: null }], next.proposals, NOW).proposals.length, 0, "no duplicate");
});

test("corrupt or foreign state files fall back to an empty state", () => {
  assert.deepEqual(parseCouncilState("{not json"), emptyCouncilState());
  assert.deepEqual(parseCouncilState(JSON.stringify({ version: 2 })), emptyCouncilState());
  const saved = { ...emptyCouncilState(), cycles: 4 };
  assert.equal(parseCouncilState(JSON.stringify(saved)).cycles, 4);
});

function fakeDeps(overrides: Partial<CouncilDeps> = {}) {
  let stored: string | null = null;
  let clock = NOW;
  const submitted: CouncilProposal[] = [];
  const pending = new Map<string, string>();
  let collectCalls = 0;
  const deps: CouncilDeps = {
    now: () => clock,
    userId: () => "owner",
    readState: async () => stored,
    writeState: async (raw) => { stored = raw; },
    collect: async () => {
      collectCalls++;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { skills: [{ name: "long", path: "p", description: "x", truncatedInChat: true, bodyChars: 2000, missingPaths: [] }] };
    },
    submitProposal: async (_user, proposal) => {
      submitted.push(proposal);
      const id = `pa-${submitted.length}`;
      pending.set(id, "pending");
      return id;
    },
    getPendingActionStatus: async (id) => pending.get(id) || null,
    fetchLatestRelease: async () => ({ tag: "v1", url: "u", publishedAt: null }),
    log: () => undefined,
    ...overrides,
  };
  return {
    deps,
    submitted,
    pending,
    tick: (ms: number) => { clock += ms; },
    collectCalls: () => collectCalls,
    stored: () => stored,
  };
}

test("council IO: concurrent triggers share one run, proposals are submitted once and approvals sync back", async () => {
  const fake = fakeDeps();
  const council = createAgentCouncil(fake.deps);
  await Promise.all([council.runCycle(), council.runCycle(), council.runCycle()]);
  assert.equal(fake.collectCalls(), 1, "scheduler + manual button never duplicate a cycle");
  assert.equal(fake.submitted.length, 1);
  fake.tick(HOUR);
  await council.runCycle();
  assert.equal(fake.submitted.length, 1, "same proposal is not submitted twice");
  fake.pending.set("pa-1", "approved");
  fake.tick(HOUR);
  const state = await council.runCycle();
  assert.equal(state.proposals[0].status, "applied");
  assert.equal((await council.view()).costUsd, 0);
  assert.equal(parseCouncilState(fake.stored()).cycles, 3, "state persisted");
});

test("council IO: Trust Center outage keeps proposals for retry; collect failures are recorded, not thrown", async () => {
  let fail = true;
  const fake = fakeDeps({ submitProposal: async () => { if (fail) throw new Error("db down"); return "pa-x"; } });
  const council = createAgentCouncil(fake.deps);
  let state = await council.runCycle();
  assert.equal(state.proposals[0].status, "not_submitted");
  fail = false;
  fake.tick(HOUR);
  state = await council.runCycle();
  assert.equal(state.proposals[0].status, "submitted");
  const broken = createAgentCouncil(fakeDeps({ collect: async () => { throw new Error("disk"); } }).deps);
  assert.equal((await broken.runCycle()).lastCycleError, "disk");
});

test("council IO: scout runs at most once a day and tolerates GitHub errors", async () => {
  let calls = 0;
  const fake = fakeDeps({ fetchLatestRelease: async (repo) => { calls++; if (repo.startsWith("openai")) throw new Error("GitHub 403"); return { tag: "v1", url: "u", publishedAt: null }; } });
  const council = createAgentCouncil(fake.deps);
  await Promise.all([council.runScout(), council.runScout()]);
  assert.equal(calls, SCOUT_WATCHLIST.length, "concurrent scout triggers share one run");
  await council.runScout();
  assert.equal(calls, SCOUT_WATCHLIST.length, "skipped within 24 h");
  const state = await council.load();
  assert.match(state.scout.error || "", /GitHub 403/);
  assert.equal(state.scout.latest.length, SCOUT_WATCHLIST.length - 1);
});

test("skill document reader flags real truncation and missing files", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "council-"));
  await mkdir(path.join(root, ".claude/skills/short"), { recursive: true });
  await mkdir(path.join(root, ".claude/skills/long"), { recursive: true });
  await mkdir(path.join(root, "docs"), { recursive: true });
  await writeFile(path.join(root, "docs/here.md"), "x");
  await writeFile(path.join(root, ".claude/skills/short/SKILL.md"), "---\ndescription: short one\n---\n## Purpose\nSee `docs/here.md` and `docs/gone.md`.\n");
  await writeFile(path.join(root, ".claude/skills/long/SKILL.md"), `---\ndescription: long\n---\n## Purpose\n${"palabra ".repeat(400)}\n`);
  await writeFile(path.join(root, "CLAUDE.md"), "- `/short` for x\n- `/long` for y\n- `/ghost` for z\n");
  const docs = await readSkillDocs(root);
  const byName = Object.fromEntries(docs.skills.map((skill) => [skill.name, skill]));
  assert.equal(byName.short.truncatedInChat, false);
  assert.deepEqual(byName.short.missingPaths, ["docs/gone.md"]);
  assert.equal(byName.long.truncatedInChat, true);
  assert.deepEqual(docs.listedInClaudeMd.sort(), ["ghost", "long", "short"]);
});

test("council IO: a cycle and the scout running together never overwrite each other", async () => {
  const fake = fakeDeps({ fetchLatestRelease: async () => { await new Promise((r) => setTimeout(r, 5)); return { tag: "v1", url: "u", publishedAt: null }; } });
  const council = createAgentCouncil(fake.deps);
  await Promise.all([council.runCycle(), council.runScout()]);
  const state = parseCouncilState(fake.stored());
  assert.equal(state.cycles, 1);
  assert.ok(state.scout.lastRunAt, "scout result kept");
  assert.equal(Object.keys(state.scout.lastSeen).length, SCOUT_WATCHLIST.length);
});

test("council IO: writes are serialized (never two at once)", async () => {
  let active = 0;
  let maxActive = 0;
  const fake = fakeDeps({
    writeState: async () => { active++; maxActive = Math.max(maxActive, active); await new Promise((r) => setTimeout(r, 10)); active--; },
  });
  const council = createAgentCouncil(fake.deps);
  await Promise.all([council.runCycle(), council.runScout()]);
  await assert.rejects(council.approveFromTrustCenter("does-not-exist"), /no encontrada/);
  assert.equal(maxActive, 1);
});

test("council IO: approving an unknown proposal fails loudly; cancelled/failed Trust Center actions close the proposal", async () => {
  const fake = fakeDeps();
  const council = createAgentCouncil(fake.deps);
  await council.runCycle();
  await assert.rejects(council.approveFromTrustCenter("ghost"), /no encontrada/);
  fake.pending.set("pa-1", "cancelled");
  fake.tick(HOUR);
  const state = await council.runCycle();
  assert.equal(state.proposals[0].status, "rejected");
  assert.ok(state.proposals[0].closedAt);
});

test("atomic file writes: 50 concurrent writes all succeed and the file is always valid JSON", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "council-write-"));
  const file = path.join(dir, "state.json");
  const payloads = Array.from({ length: 50 }, (_, i) => JSON.stringify({ ...emptyCouncilState(), cycles: i }));
  const results = await Promise.allSettled(payloads.map((raw) => writeFileAtomic(file, raw)));
  assert.equal(results.filter((r) => r.status === "rejected").length, 0);
  const saved = parseCouncilState(await readFile(file, "utf8"));
  assert.ok(saved.cycles >= 0 && saved.cycles < 50);
  assert.equal(saved.cycles, 49, "the last submitted state must be the final replacement");
  assert.deepEqual(await readdir(dir), ["state.json"], "successful replacements leave no temporary files");
});

test("polling readers never observe missing or partial JSON during concurrent replacements", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "council-read-write-"));
  const file = path.join(dir, "state.json");
  await writeFileAtomic(file, JSON.stringify({ value: -1 }));
  let done = false;
  let reads = 0;
  const reader = (async () => {
    while (!done) {
      const value = JSON.parse(await readFile(file, "utf8"));
      assert.equal(typeof value.value, "number");
      reads++;
      // Polling leaves the handle closed between reads. A Windows process that
      // continuously reopens/locks a file can legitimately exhaust bounded
      // replacement retries; writers must report that lock instead of deleting.
      await new Promise(resolve => setTimeout(resolve, 2));
    }
  })();
  try {
    await Promise.all(Array.from({ length: 50 }, (_, value) => writeFileAtomic(file, JSON.stringify({ value }))));
  } finally { done = true; await reader; }
  assert.ok(reads > 0);
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { value: 49 });
});

test("failed atomic replacement cleans its temporary file and does not poison later writes", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "council-write-recovery-"));
  const file = path.join(dir, "state.json");
  await mkdir(file); // A directory is an intentionally invalid file destination.
  await assert.rejects(writeFileAtomic(file, JSON.stringify({ value: 1 })));
  assert.deepEqual(await readdir(dir), ["state.json"]);
  await rmdir(file);
  await writeFileAtomic(file, JSON.stringify({ value: 2 }));
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { value: 2 });
  assert.deepEqual(await readdir(dir), ["state.json"]);
});

test("company over 4 days: repairs stay bounded, never for exempt agents, mechanic is not ranked", async () => {
  const fake = fakeDeps({
    collect: async () => ({}),
    collectStatuses: async () => ({
      revenue: { state: "needs-setup", label: "Falta Stripe" },
      clippers: { state: "error", label: "Worker con error" },
      radio: { state: "offline", label: "Sin conexion" },
      legal: { state: "error", label: "GitHub fallo" },
      dropshipping: { state: "error", label: "Proveedor caido" },
      code: { state: "working", label: "GitHub conectado" },
    }),
    loadCurriculum: async () => [],
  });
  const council = createAgentCouncil(fake.deps);
  let state = await council.runCycle();
  for (let i = 0; i < 400; i++) {
    fake.tick(15 * 60_000);
    state = await council.runCycle();
  }
  const repairs = state.proposals.filter((proposal) => proposal.kind === "repair");
  const open = repairs.filter((proposal) => ["pending_submit", "submitted", "not_submitted", "approved"].includes(proposal.status));
  assert.ok(open.length <= 3, `open repairs: ${open.length}`);
  assert.ok(repairs.every((proposal) => !proposal.key.startsWith("repair:kong:") && !proposal.key.startsWith("repair:mechanic")));
  assert.equal(new Set(open.map((proposal) => proposal.key.split("#")[0])).size, open.length, "one open repair per agent");
  assert.equal(state.company.careers.revenue.firedCount, 0, "waiting on a key is not a firing offense");
  assert.equal(state.company.careers.mechanic, undefined);
  const view = await council.view();
  assert.ok(!view.leaderboard.some((row) => row.agentId === "mechanic" || row.agentId.startsWith("kong:")));
});

// ---------- Supervisor: integrations, shared storage, evidence ----------

import { CouncilStateConflict, OrderEvidenceError, MIN_CYCLE_GAP_MS, CYCLE_WATCHDOG_MS } from "../server/agent-council";
import { effectiveIntegrations, parseIntegrationOverrides } from "../shared/agent-integrations";

function sharedStore() {
  let raw: string | null = null;
  let revision: number | null = null;
  let writes = 0;
  return {
    writes: () => writes,
    raw: () => raw,
    store: {
      read: async () => ({ raw, revision }),
      write: async (next: string, expected: number | null) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        if (expected !== revision) throw new CouncilStateConflict("state conflict");
        raw = next;
        revision = (revision ?? 0) + 1;
        writes++;
        return revision;
      },
    },
  };
}

test("paused, external and not-built agents are never penalized, fired or repaired (4 days)", async () => {
  const fake = fakeDeps({
    collect: async () => ({}),
    collectStatuses: async () => ({
      "blackroom-videos": { state: "offline", label: "Cola vacia" },
      "kong-videos": { state: "offline", label: "Sin videos nuevos en 48 h" },
      "news:miami-news": { state: "error", label: "Ciudad sin datos" },
      radio: { state: "working", label: "Programando" },
    }),
    loadCurriculum: async () => [],
    integrations: () => effectiveIntegrations({ "blackroom-videos": "pausada" }),
  });
  const council = createAgentCouncil(fake.deps);
  let state = await council.runCycle();
  for (let i = 0; i < 400; i++) {
    fake.tick(15 * 60_000);
    state = await council.runCycle();
  }
  assert.equal(state.company.careers["blackroom-videos"], undefined, "paused lane is not scored");
  assert.equal(state.company.careers["kong-videos"], undefined, "external KONG publisher is not scored");
  assert.ok(!state.proposals.some((proposal) => /blackroom-videos|kong-videos/.test(proposal.key)));
  assert.equal(state.company.careers["news:miami-news"].firedCount,0,"missing city data is not a failed execution and cannot retire a holder");
  assert.equal(state.company.careers.radio.points,0,"repeated readiness without distinct work does not earn points");
  assert.match(state.lastStatuses["kong-videos"].label, /Externa/);
  const view = await council.view();
  assert.equal(view.integrations["blackroom-videos"].mode, "pausada");
  assert.ok(!view.leaderboard.some((row) => row.agentId === "kong-videos"));
});

test("overrides switch an agent back to active without a code change", () => {
  const integrations = effectiveIntegrations(parseIntegrationOverrides("blackroom-videos=activa, kong-videos=nope,radio=pausada"));
  assert.equal(integrations["blackroom-videos"].mode, "activa");
  assert.equal(integrations["kong-videos"].mode, "externa", "invalid modes are ignored");
  assert.equal(integrations.radio.mode, "pausada");
});

test("two instances on shared storage: one round per window, no lost writes", async () => {
  const shared = sharedStore();
  const a = fakeDeps({ versioned: shared.store, collect: async () => ({}) });
  const b = fakeDeps({ versioned: shared.store, collect: async () => ({}) });
  const first = createAgentCouncil(a.deps);
  const second = createAgentCouncil(b.deps);
  await Promise.all([first.runCycle(), second.runCycle()]);
  assert.equal(parseCouncilState(shared.raw()).cycles, 1, "the second instance skips the round");
  // An order placed on one instance is seen by the other.
  await first.placeOrder("Revisa la radio");
  assert.equal((await second.view()).company.orders.length, 1);
  // Concurrent writes from both instances are retried on top of each other, not overwritten.
  await Promise.all([first.placeOrder("Orden A"), second.placeOrder("Orden B")]);
  assert.equal((await first.view()).company.orders.length, 3);
  a.tick(MIN_CYCLE_GAP_MS + 1000);
  b.tick(MIN_CYCLE_GAP_MS + 1000);
  await second.runCycle();
  assert.equal(parseCouncilState(shared.raw()).cycles, 2);
});

test("order evidence is verified on the server: wrong owner, failed run or reused run are rejected", async () => {
  const runs: Record<string, { id: string; status: string; summary: string | null; at: string | null }> = {
    good: { id: "good", status: "success", summary: "Radio publicada", at: null },
    bad: { id: "bad", status: "failed", summary: null, at: null },
  };
  const fake = fakeDeps({ collect: async () => ({}), verifyRun: async (_user, id) => runs[id] || null });
  const council = createAgentCouncil(fake.deps);
  await council.placeOrder("Orden 1");
  await council.placeOrder("Orden 2");
  const [o2, o1] = (await council.view()).company.orders;
  await assert.rejects(council.finishOrder(o1.id, "missing"), OrderEvidenceError);
  await assert.rejects(council.finishOrder(o1.id, "bad"), /fallo|failed/);
  const done = await council.finishOrder(o1.id, "good");
  assert.equal(done.company.orders.find((order) => order.id === o1.id)?.closedBy, "evidencia");
  await assert.rejects(council.finishOrder(o2.id, "good"), /ya cerro otra orden/);
});

test("single publisher: the supervisor never imports or calls publishing code", async () => {
  const files = ["server/agent-council.ts", "server/agent-council-routes.ts", "shared/agent-company.ts", "shared/agent-integrations.ts", "shared/agent-live-status.ts", "shared/agent-council.ts", "shared/kong-supervisor.ts", "server/kong-supervisor-conversation.ts", "server/kong-supervisor-routes.ts", "shared/kong-operations.ts", "server/kong-operations.ts", "server/kong-operations-routes.ts"];
  for (const file of files) {
    const source = await readFile(path.join(process.cwd(), file), "utf8");
    const imports = [...source.matchAll(/(?:from\s+|import\()\s*["']([^"']+)["']/g)].map((match) => match[1]);
    for (const spec of imports) assert.doesNotMatch(spec, /metricool|publish|social|tiktok|facebook|instagram|youtube|scheduler|kong-cloud|kong-production|media-store|drive/i, `${file} imports ${spec}`);
    assert.doesNotMatch(source, /\b(publish\w*|schedulePost\w*|uploadToDrive\w*|postTo\w*)\s*\(/, `${file} calls a publishing function`);
  }
});

test("two instances never send the same proposal to the Trust Center twice", async () => {
  const shared = sharedStore();
  const submitted: string[] = [];
  const collect = async () => ({ skills: [{ name: "long", path: "p", description: "x", truncatedInChat: true, bodyChars: 2000, missingPaths: [] }] });
  const submitProposal = async (_user: string, proposal: CouncilProposal) => {
    submitted.push(proposal.key);
    await new Promise((resolve) => setTimeout(resolve, 15));
    return `pa-${submitted.length}`;
  };
  const a = fakeDeps({ versioned: shared.store, collect, submitProposal });
  const b = fakeDeps({ versioned: shared.store, collect, submitProposal });
  const first = createAgentCouncil(a.deps);
  const second = createAgentCouncil(b.deps);
  await Promise.all([first.runCycle(), second.runCycle(), first.placeOrder("Orden durante la ronda"), second.placeOrder("Otra orden")]);
  assert.deepEqual(submitted, ["skill:skills-truncated"]);
  const state = parseCouncilState(shared.raw());
  assert.equal(state.proposals[0].status, "submitted");
  assert.equal(state.proposals[0].pendingActionId, "pa-1", "the id that was created is the one saved");
  assert.equal(state.company.orders.length, 2, "orders placed meanwhile are kept");
  // Next round (after the gap) reads the saved id and does not submit again.
  a.tick(MIN_CYCLE_GAP_MS + 1000);
  await first.runCycle();
  assert.deepEqual(submitted, ["skill:skills-truncated"]);
});

test("the public council view never carries the owner-only KONG conversation", async () => {
  const council = createAgentCouncil(fakeDeps({ collect: async () => ({}) }).deps);
  await council.updateKongSupervision(async (current) => ({
    ...current,
    messages: [{ id: "r1-user", requestId: "request-0001", agentId: "kong-supervisor", at: new Date(NOW).toISOString(), role: "user", text: "privado" }],
  }));
  const view = await council.view();
  assert.equal((view.kongSupervision as { messages?: unknown }).messages, undefined);
  assert.ok(Array.isArray(view.kongSupervision.records));
  assert.equal((await council.readKongSupervision()).messages.length, 1, "the owner route still reads it");
  assert.doesNotMatch(JSON.stringify(view), /privado/);
});

test("a hung read never freezes the council: the round fails with a clear error and the next one runs", async () => {
  let calls = 0;
  const fake = fakeDeps({
    collectTimeoutMs: 50,
    // First round: the source never answers (what froze production at round 44).
    collect: () => (++calls === 1 ? new Promise(() => undefined) : Promise.resolve({})),
  });
  const council = createAgentCouncil(fake.deps);
  const first = await council.runCycle();
  assert.match(first.lastCycleError || "", /sin respuesta/);
  fake.tick(MIN_CYCLE_GAP_MS + 1000);
  const second = await council.runCycle();
  assert.equal(second.lastCycleError, null);
  assert.equal(second.cycles, 1);
});

test("watchdog: a round stuck past the limit no longer blocks a new one", async () => {
  let release: () => void = () => undefined;
  let calls = 0;
  const fake = fakeDeps({
    collectTimeoutMs: 60 * 60_000,
    collect: () => (++calls === 1 ? new Promise((resolve) => { release = () => resolve({}); }) : Promise.resolve({})),
  });
  const council = createAgentCouncil(fake.deps);
  const stuck = council.runCycle();
  await new Promise((resolve) => setTimeout(resolve, 5));
  fake.tick(CYCLE_WATCHDOG_MS + 1000);
  const fresh = await council.runCycle();
  assert.equal(fresh.cycles, 1, "a new round ran while the old one was stuck");
  release();
  await stuck;
});

test("agent factory: recurring blocked orders become one 'hire a specialist' proposal for Robert", async () => {
  const fake = fakeDeps({ collect: async () => ({}), collectStatuses: async () => ({ clippers: { state: "error", label: "Worker con error" } }) });
  const council = createAgentCouncil(fake.deps);
  await council.runCycle();
  for (let i = 0; i < 3; i++) await council.placeOrder(`Sube el video ${i} de Black Room`);
  fake.tick(MIN_CYCLE_GAP_MS + 1000);
  const state = await council.runCycle();
  const specialists = state.proposals.filter((proposal) => proposal.key.startsWith("new_agent:specialist-"));
  assert.deepEqual(specialists.map((proposal) => proposal.key), ["new_agent:specialist-video"]);
  assert.equal(specialists[0].status, "submitted", "it goes to the Trust Center, Robert decides");
  fake.tick(MIN_CYCLE_GAP_MS + 1000);
  const again = await council.runCycle();
  assert.equal(again.proposals.filter((proposal) => proposal.key.startsWith("new_agent:specialist-")).length, 1, "never proposed twice");
});

test("durable council rejects corrupt persisted state without replacing it", async () => {
  let raw = '{"version":9}'; let writes=0;
  const fake=fakeDeps({readState:async()=>raw,transactState:async update=>{ const next=await update(raw);writes++;raw=next;return next; }});
  const council=createAgentCouncil(fake.deps);
  await assert.rejects(council.load(),/incompatible/);
  await assert.rejects(council.placeOrder("review"),/incompatible/);
  assert.equal(writes,0);
});
test("separate durable council replicas apply one company tick per cadence", async () => {
  let raw:string|null=null;let serial=Promise.resolve();
  const transactState=async(update:(value:string|null)=>Promise<string>)=>{
    let result="";
    const task=serial.then(async()=>{result=await update(raw);raw=result;});serial=task.catch(()=>{});await task;return result;
  };
  const fake=fakeDeps({readState:async()=>raw,transactState});
  const first=createAgentCouncil(fake.deps);const second=createAgentCouncil(fake.deps);
  await Promise.all([first.runCycle(),second.runCycle()]);
  assert.equal((await second.load()).cycles,1);
});
