import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { BlackRoomTeamAgentModule, BlackRoomTeamContext, BlackRoomTeamEnv, BlackRoomTeamStatus } from "../shared/blackroom-team";
import { createBlackRoomTeamStateStore, readBlackRoomTeamState, writeBlackRoomTeamState } from "../server/blackroom-team/state";
import defaultAgent, {
  BLACKROOM_SCRIPTS_RENDER_FLAG,
  createBlackRoomScriptsAgent,
  groundingFromTeammates,
  type BlackRoomEditJob,
  type BlackRoomEditRenderer,
  type BlackRoomScriptsState,
} from "../server/blackroom-team/blackroom-scripts";
import { parseBlackRoomVideoStyleGuide } from "../server/blackroom-team/blackroom-scripts/style-guide";
import { buildBlackRoomVideoScripts, EMPTY_GROUNDING } from "../server/blackroom-team/blackroom-scripts/ideas";
import { readFile } from "node:fs/promises";

const NOW = new Date("2026-11-12T12:00:00Z");
const FUTURE_LOCAL = "2026-11-20T20:00:00";
const YT_ID = "abcdefghijk";
const DRIVE_URL = "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view";

const READY_GUIDE = `# Guia
estado: listo

## Tono
- Cercano y nocturno

## Hooks que funcionan
- Esto no lo viste venir

## Llamados a la accion
- Link en bio para la lista

## Hashtags
- #BlackRoomMiami

## Palabras prohibidas
- gratis
`;

async function setup(options: { env?: BlackRoomTeamEnv; userId?: string | null; now?: Date; teammates?: Record<string, unknown> } = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "br-scripts-"));
  let nowValue = options.now ?? NOW;
  const fetchCalls: string[] = [];
  const ctx: BlackRoomTeamContext = {
    agentId: "blackroom-scripts",
    env: options.env ?? {},
    now: () => nowValue,
    fetch: (async (url: string | URL | Request) => { fetchCalls.push(String(url)); throw new Error("offline"); }) as typeof fetch,
    dataDir,
    userId: options.userId === undefined ? "owner-1" : options.userId,
    state: createBlackRoomTeamStateStore(dataDir, "blackroom-scripts"),
    async readTeammateStatus(id) {
      return (options.teammates?.[id] as BlackRoomTeamStatus | undefined) ?? null;
    },
  };
  return {
    ctx, dataDir, fetchCalls,
    setNow(date: Date) { nowValue = date; },
    cleanup: () => rm(dataDir, { recursive: true, force: true }),
  };
}

function fakePublisher() {
  const added: Record<string, unknown>[] = [];
  const module: BlackRoomTeamAgentModule = {
    id: "blackroom-publisher",
    async getStatus() { throw new Error("not used"); },
    async run() { throw new Error("publisher run must never be called by scripts"); },
    actions: {
      async add(_ctx, input) {
        added.push(input.draft as Record<string, unknown>);
        return { ok: true, summary: "ok", report: { item: { id: `post-${added.length}`, status: "pending", dryRun: true } } };
      },
      async approve() { throw new Error("scripts must never approve a post"); },
      async schedule() { throw new Error("scripts must never schedule a post"); },
    },
  };
  return { module, added };
}

const verticalClip = { kind: "vertical_tiktok", path: "/tmp/out/DJ_30s_vertical_tiktok.mp4", durationSeconds: 30, width: 1080, height: 1920, driveWebViewLink: "https://drive.google.com/file/d/clip123/view" };
const DIRECT_CLIP_URL = "https://drive.usercontent.google.com/download?id=clip123&export=download";
const directVerticalClip = { ...verticalClip, driveWebViewLink: DIRECT_CLIP_URL };
const horizontalClip = { kind: "horizontal_ig", path: "/tmp/out/DJ_60s_horizontal_ig.mp4", durationSeconds: 60, width: 1920, height: 1080, driveWebViewLink: "https://drive.google.com/file/d/clip456/view" };

test("default export is the blackroom-scripts module", () => {
  assert.equal(defaultAgent.id, "blackroom-scripts");
  for (const action of ["ideas", "list", "create-edit-job", "process-edit-job", "retry-edit-job", "cancel-edit-job", "send-to-publisher", "reject", "style-guide"]) {
    assert.equal(typeof defaultAgent.actions?.[action], "function", action);
  }
});

test("empty data dir and env: available (never working), honest about the missing style guide", async () => {
  const env = await setup({ env: {} });
  try {
    const agent = createBlackRoomScriptsAgent({ readStyleGuide: async () => null, render: async () => { throw new Error("no render"); } });
    const status = await agent.getStatus(env.ctx);
    assert.equal(status.state, "available");
    assert.notEqual(status.state, "working");
    assert.deepEqual(status.needs, []);
    assert.equal(status.lastRunAt, null);
    assert.equal(status.metrics?.guiaDeEstilo, "pendiente");
    assert.equal(status.metrics?.render, "simulacion");
    assert.match(status.label, /guia de estilo/);
  } finally { await env.cleanup(); }
});

test("the repo style guide is a placeholder until Robert marks it listo", async () => {
  const placeholder = await readFile(path.resolve("docs/blackroom-video-style.md"), "utf8");
  const parsed = parseBlackRoomVideoStyleGuide(placeholder);
  assert.equal(parsed.present, false);
  assert.equal(parsed.hooks.length, 0, "PENDIENTE lines are ignored");
  const ready = parseBlackRoomVideoStyleGuide(READY_GUIDE);
  assert.equal(ready.present, true);
  assert.deepEqual(ready.hooks, ["Esto no lo viste venir"]);
  assert.deepEqual(ready.hashtags, ["#BlackRoomMiami"]);
  assert.deepEqual(ready.banned, ["gratis"]);
  assert.equal(parseBlackRoomVideoStyleGuide(READY_GUIDE.replace("estado: listo", "estado: plantilla")).present, false);
});

test("scripts are deterministic, cover 15/30/60 s and respect the style guide", () => {
  const guide = parseBlackRoomVideoStyleGuide(READY_GUIDE);
  const request = { count: 3, seed: "2026-11-12", djName: "MYNA", topic: "entrada gratis" };
  const a = buildBlackRoomVideoScripts(request, EMPTY_GROUNDING, guide);
  const b = buildBlackRoomVideoScripts(request, EMPTY_GROUNDING, guide);
  assert.deepEqual(a, b);
  assert.deepEqual(a.map((s) => s.durationSeconds).sort((x, y) => x - y), [15, 30, 60]);
  for (const script of a) {
    assert.equal(script.beats[0].from, 0);
    assert.equal(script.beats[0].part, "hook");
    assert.equal(script.beats.at(-1)!.to, script.durationSeconds);
    assert.equal(script.beats.at(-1)!.part, "cta");
    for (let i = 1; i < script.beats.length; i += 1) assert.equal(script.beats[i].from, script.beats[i - 1].to);
    assert.ok(script.shotList.length >= 3);
    assert.equal(script.cta, "Link en bio para la lista");
    assert.deepEqual(script.hashtags, ["#BlackRoomMiami"]);
    assert.doesNotMatch(script.caption.toLowerCase(), /gratis/, "banned word never reaches the caption");
    assert.equal(script.styleGuideApplied, true);
  }
});

test("ideas are grounded on analytics and competition reports", async () => {
  const analytics = { lastReport: { generatedAt: "2026-11-11T10:00:00Z", recommendations: ["Publica a las 21:00"], networks: { tiktok: { bestDurations: [{ label: "16-30s", samples: 5, medianViews: 900 }, { label: "hasta 15s", samples: 4, medianViews: 300 }], bestHours: [{ label: "21:00", samples: 4, medianViews: 800 }] } } } };
  const competition = { lastReport: { generatedAt: "2026-11-11T09:00:00Z", bestContent: [{ competitor: "Club X", title: "POV entrada al club", url: "https://x", views: 50000, publishedAt: "2026-11-01" }], takeaways: ["Publican 5 veces por semana"], blackroom: { upcomingEvents: [{ name: "Black Room Halloween", startDate: "2026-11-30T22:00:00", url: null, location: "Miami" }] } } };
  const grounding = groundingFromTeammates(analytics, competition);
  assert.equal(grounding.bestDuration, 30);
  assert.equal(grounding.bestHour, "21:00");
  assert.equal(grounding.upcomingEvents[0].name, "Black Room Halloween");
  assert.deepEqual(groundingFromTeammates("garbage", [1, 2]), EMPTY_GROUNDING, "malformed teammate state is ignored");

  const env = await setup({ teammates: { "blackroom-analytics": { id: "blackroom-analytics", state: "available", label: "Reporte listo", summary: "", needs: [], lastRunAt: null } } });
  try {
    const agent = createBlackRoomScriptsAgent({
      readStyleGuide: async () => null,
      readTeammateState: async (_ctx, id) => (id === "blackroom-analytics" ? analytics : competition),
      render: async () => { throw new Error("no render"); },
    });
    const result = await agent.actions!.ideas(env.ctx, { count: 3 });
    assert.equal(result.ok, true);
    const ideas = (result.report as { ideas: Array<{ durationSeconds: number; angle: string; basis: string[]; suggestedPostHour: string; handoffPrompt: string }> }).ideas;
    assert.equal(ideas[0].durationSeconds, 30, "best performing duration first");
    assert.ok(ideas.some((idea) => idea.angle === "Anuncio del proximo evento"));
    assert.ok(ideas.some((idea) => idea.basis.some((line) => /Club X/.test(line))));
    assert.equal(ideas[0].suggestedPostHour, "21:00");
    assert.ok(ideas.every((idea) => idea.handoffPrompt.length <= 900));
    const state = await readBlackRoomTeamState<BlackRoomScriptsState | null>(env.dataDir, "blackroom-scripts", null);
    assert.equal(state?.ideas.length, 3);
    assert.deepEqual(env.fetchCalls, [], "no network");
  } finally { await env.cleanup(); }
});

test("edit job without the render flag: plan only, renderer never called, status blocked with the exact need", async () => {
  const env = await setup({ env: {} });
  let renders = 0;
  const publisher = fakePublisher();
  try {
    const agent = createBlackRoomScriptsAgent({ readStyleGuide: async () => null, readTeammateState: async () => null, render: async () => { renders += 1; return { status: "completed", clips: [verticalClip] }; }, publisher: publisher.module });
    const created = await agent.actions!["create-edit-job"](env.ctx, { driveUrl: DRIVE_URL, djName: "MYNA" });
    assert.equal(created.ok, true);
    const job = (created.report as { job: BlackRoomEditJob }).job;
    assert.equal(job.source.kind, "drive");
    assert.equal(job.plan?.dryRun, true);
    const dup = await agent.actions!["create-edit-job"](env.ctx, { driveUrl: DRIVE_URL });
    assert.match(dup.summary, /ya esta en cola/);

    const run = await agent.run(env.ctx, {});
    assert.equal(renders, 0);
    assert.equal(publisher.added.length, 0);
    assert.match(run.summary, /simulacion/);
    const status = await agent.getStatus(env.ctx);
    assert.equal(status.state, "blocked");
    assert.ok(status.needs.some((need) => need.includes(`${BLACKROOM_SCRIPTS_RENDER_FLAG}=true`)));
  } finally { await env.cleanup(); }
});

test("input validation: folder links, traversal and wrong extensions are refused", async () => {
  const env = await setup();
  try {
    const agent = createBlackRoomScriptsAgent({ readStyleGuide: async () => null, workspaceRoot: env.dataDir, render: async () => { throw new Error("no"); } });
    const create = agent.actions!["create-edit-job"];
    assert.equal((await create(env.ctx, { driveUrl: "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp" })).error, "invalid_drive_link");
    assert.equal((await create(env.ctx, { localPath: "../../etc/passwd.mp4" })).error, "invalid_local_path");
    assert.equal((await create(env.ctx, { localPath: "radio_video_edits/01_originales/../../secret.mp4" })).error, "invalid_local_path");
    assert.equal((await create(env.ctx, { localPath: "radio_video_edits/01_originales/set.txt" })).error, "invalid_local_path");
    assert.equal((await create(env.ctx, {})).error, "invalid_source");
    assert.equal((await create(env.ctx, { driveUrl: DRIVE_URL, localPath: "x.mp4" })).error, "invalid_source");
    assert.equal((await create(env.ctx, { driveUrl: DRIVE_URL, sourceVideoId: "short" })).error, "invalid_source_video_id");
    const ok = await create(env.ctx, { localPath: "radio_video_edits/01_originales/set.mp4" });
    assert.equal(ok.ok, true);
    assert.equal((ok.report as { job: BlackRoomEditJob }).job.source.kind, "local");
  } finally { await env.cleanup(); }
});

test("render enabled: one job per run, vertical clip handed to the publisher as a pending draft only", async () => {
  const env = await setup({ env: { [BLACKROOM_SCRIPTS_RENDER_FLAG]: "true" } });
  const publisher = fakePublisher();
  const rendered: string[] = [];
  const render: BlackRoomEditRenderer = async (job, options) => { rendered.push(`${job.id}:${options.userId}`); return { status: "completed", clips: [directVerticalClip, horizontalClip] }; };
  try {
    const agent = createBlackRoomScriptsAgent({ readStyleGuide: async () => null, readTeammateState: async () => null, render, publisher: publisher.module });
    await agent.actions!["create-edit-job"](env.ctx, { driveUrl: DRIVE_URL, djName: "MYNA", sourceVideoId: YT_ID, publicationDateTime: FUTURE_LOCAL });
    await agent.actions!["create-edit-job"](env.ctx, { driveFileId: "1ZyXwVuTsRqPoNmLk", djName: "OTRO" });
    const run = await agent.run(env.ctx, {});
    assert.equal(run.ok, true);
    assert.equal(rendered.length, 1, "bounded: a single render per run");
    assert.match(rendered[0], /:owner-1$/);
    assert.equal(publisher.added.length, 1, "only the vertical clip");
    const draft = publisher.added[0];
    assert.equal(draft.videoFormat, "vertical");
    assert.equal(draft.mediaUrl, DIRECT_CLIP_URL);
    assert.equal(draft.sourceVideoId, YT_ID);
    assert.equal(draft.source, "blackroom-scripts");
    const state = (await readBlackRoomTeamState<BlackRoomScriptsState | null>(env.dataDir, "blackroom-scripts", null))!;
    assert.equal(state.jobs[0].status, "completed");
    assert.deepEqual(state.jobs[0].publisherItemIds, ["post-1"]);
    assert.equal(state.jobs[1].status, "queued");
    const status = await agent.getStatus(env.ctx);
    assert.equal(status.state, "working", "fresh run is evidence");
    env.setNow(new Date(NOW.getTime() + 30 * 60 * 60_000));
    assert.notEqual((await agent.getStatus(env.ctx)).state, "working", "old evidence is not working");
  } finally { await env.cleanup(); }
});

test("real publisher integration: the clip lands pending + dryRun, nothing is sent", async () => {
  const env = await setup({ env: { [BLACKROOM_SCRIPTS_RENDER_FLAG]: "true" } });
  try {
    const agent = createBlackRoomScriptsAgent({ readStyleGuide: async () => null, readTeammateState: async () => null, render: async () => ({ status: "completed", clips: [directVerticalClip] }) });
    await agent.actions!["create-edit-job"](env.ctx, { driveUrl: DRIVE_URL, djName: "MYNA", sourceVideoId: YT_ID, publicationDateTime: FUTURE_LOCAL });
    await agent.run(env.ctx, {});
    const publisherState = await readBlackRoomTeamState<{ items: Array<{ status: string; dryRun: boolean; dispatch: { state: string } }> } | null>(env.dataDir, "blackroom-publisher", null);
    assert.equal(publisherState?.items.length, 1);
    assert.equal(publisherState!.items[0].status, "pending");
    assert.equal(publisherState!.items[0].dryRun, true);
    assert.equal(publisherState!.items[0].dispatch.state, "none");
    assert.deepEqual(env.fetchCalls, [], "no network call at all");
  } finally { await env.cleanup(); }
});

test("a Drive view link is never sent as mediaUrl; a clip without a YouTube set still reaches the publisher", async () => {
  const env = await setup({ env: { [BLACKROOM_SCRIPTS_RENDER_FLAG]: "true" } });
  const publisher = fakePublisher();
  try {
    const agent = createBlackRoomScriptsAgent({ readStyleGuide: async () => null, readTeammateState: async () => null, render: async () => ({ status: "completed", clips: [verticalClip] }), publisher: publisher.module });
    await agent.actions!["create-edit-job"](env.ctx, { driveUrl: DRIVE_URL, djName: "MYNA", publicationDateTime: FUTURE_LOCAL });
    const run = await agent.run(env.ctx, {});
    assert.equal(publisher.added.length, 0, "the Drive viewer page is not a video");
    const draft = run.needsApproval![0];
    assert.equal((draft.payload as { mediaUrl: string | null }).mediaUrl, null);
    assert.match(draft.summary, /mediaUrl/);
    assert.doesNotMatch(draft.summary, /sourceVideoId/, "the YouTube set is optional");
    const viewLink = await agent.actions!["send-to-publisher"](env.ctx, { id: draft.id, mediaUrl: "https://drive.google.com/file/d/abc/view?usp=sharing" });
    assert.equal(viewLink.error, "missing_fields");
    const sent = await agent.actions!["send-to-publisher"](env.ctx, { id: draft.id, mediaUrl: DIRECT_CLIP_URL });
    assert.equal(sent.ok, true);
    assert.equal(publisher.added.length, 1);
    assert.ok(!publisher.added[0].sourceVideoId);
  } finally { await env.cleanup(); }
});

test("missing publish data: local draft waits for Robert; send-to-publisher validates; reject works", async () => {
  const env = await setup({ env: { [BLACKROOM_SCRIPTS_RENDER_FLAG]: "true" } });
  const publisher = fakePublisher();
  try {
    const agent = createBlackRoomScriptsAgent({ readStyleGuide: async () => null, readTeammateState: async () => null, render: async () => ({ status: "completed", clips: [{ ...verticalClip, driveWebViewLink: null }] }), publisher: publisher.module });
    await agent.actions!["create-edit-job"](env.ctx, { driveUrl: DRIVE_URL, djName: "MYNA" });
    const run = await agent.run(env.ctx, {});
    assert.equal(publisher.added.length, 0);
    assert.equal(run.needsApproval?.length, 1);
    const draft = run.needsApproval![0];
    assert.equal(draft.status, "pending");
    assert.equal(draft.dryRun, true);
    assert.equal((await agent.getStatus(env.ctx)).pendingApprovals, 1);

    const incomplete = await agent.actions!["send-to-publisher"](env.ctx, { id: draft.id, sourceVideoId: YT_ID });
    assert.equal(incomplete.error, "missing_fields");
    assert.equal(publisher.added.length, 0);

    const sent = await agent.actions!["send-to-publisher"](env.ctx, { id: draft.id, mediaUrl: "https://cdn.example.com/clip.mp4", publicationDateTime: FUTURE_LOCAL });
    assert.equal(sent.ok, true);
    assert.equal(publisher.added.length, 1);
    assert.equal(publisher.added[0].mediaUrl, "https://cdn.example.com/clip.mp4");
    assert.equal((await agent.actions!["send-to-publisher"](env.ctx, { id: draft.id })).error, "already_decided");
    assert.equal(publisher.added.length, 1, "never sent twice");

    await agent.actions!["create-edit-job"](env.ctx, { driveFileId: "1ZyXwVuTsRqPoNmLk", djName: "OTRO" });
    const second = await agent.run(env.ctx, {});
    const other = second.needsApproval![0];
    const rejected = await agent.actions!.reject(env.ctx, { id: other.id });
    assert.equal(rejected.ok, true);
    assert.equal((await agent.actions!["send-to-publisher"](env.ctx, { id: other.id, mediaUrl: "https://cdn.example.com/b.mp4", sourceVideoId: YT_ID, publicationDateTime: FUTURE_LOCAL })).error, "already_decided");
    assert.equal(publisher.added.length, 1, "a rejected draft never reaches the publisher");
  } finally { await env.cleanup(); }
});

test("needs DJ name -> blocked, retry with djName requeues; render errors fail the job without handoff", async () => {
  const env = await setup({ env: { [BLACKROOM_SCRIPTS_RENDER_FLAG]: "true" } });
  const publisher = fakePublisher();
  let mode: "dj" | "throw" = "dj";
  try {
    const agent = createBlackRoomScriptsAgent({
      readStyleGuide: async () => null,
      readTeammateState: async () => null,
      publisher: publisher.module,
      render: async () => { if (mode === "throw") throw new Error("ffmpeg no encontrado"); return { status: "needs_dj_name", pendingActionId: "pa-1" }; },
    });
    const created = await agent.actions!["create-edit-job"](env.ctx, { driveUrl: DRIVE_URL });
    const id = (created.report as { job: BlackRoomEditJob }).job.id;
    await agent.run(env.ctx, {});
    const blocked = await agent.getStatus(env.ctx);
    assert.equal(blocked.state, "blocked");
    assert.ok(blocked.needs.some((need) => need.includes(id) && /DJ/.test(need)));
    const retry = await agent.actions!["retry-edit-job"](env.ctx, { id, djName: "MYNA" });
    assert.equal(retry.ok, true);
    mode = "throw";
    const processed = await agent.actions!["process-edit-job"](env.ctx, { id });
    assert.equal(processed.ok, false);
    assert.match(processed.summary, /ffmpeg no encontrado/);
    const state = (await readBlackRoomTeamState<BlackRoomScriptsState | null>(env.dataDir, "blackroom-scripts", null))!;
    assert.equal(state.jobs[0].status, "failed");
    assert.equal(state.jobs[0].djName, "MYNA");
    assert.equal(publisher.added.length, 0);
  } finally { await env.cleanup(); }
});

test("without an owner session the renderer is never called", async () => {
  const env = await setup({ env: { [BLACKROOM_SCRIPTS_RENDER_FLAG]: "true" }, userId: null });
  let renders = 0;
  try {
    const agent = createBlackRoomScriptsAgent({ readStyleGuide: async () => null, readTeammateState: async () => null, render: async () => { renders += 1; return { status: "failed" }; } });
    await agent.actions!["create-edit-job"](env.ctx, { driveUrl: DRIVE_URL });
    const run = await agent.run(env.ctx, {});
    assert.equal(renders, 0);
    assert.equal(run.ok, false);
    assert.match(run.summary, /userId/);
  } finally { await env.cleanup(); }
});

test("a render interrupted by a restart is marked failed, not retried automatically", async () => {
  const env = await setup({ env: { [BLACKROOM_SCRIPTS_RENDER_FLAG]: "true" } });
  let renders = 0;
  try {
    const stale: Partial<BlackRoomEditJob> = {
      id: "edit-old", createdAt: "2026-11-12T00:00:00Z", updatedAt: "2026-11-12T00:00:00Z", source: { kind: "drive", fileId: "1AbCdEfGhIjKlMnOp", url: null },
      djName: null, ideaId: null, sourceVideoId: null, publicationDateTime: null, caption: null, language: "es", notes: "", status: "rendering", attempts: 1,
      startedAt: "2026-11-12T01:00:00Z", finishedAt: null, error: null, pendingActionId: null, plan: null, clips: [], publisherItemIds: [],
    };
    await writeBlackRoomTeamState(env.dataDir, "blackroom-scripts", { version: 1, lastRunAt: null, lastRunSummary: null, ideas: [], ideasGeneratedAt: null, jobs: [stale], drafts: [] });
    const agent = createBlackRoomScriptsAgent({ readStyleGuide: async () => null, readTeammateState: async () => null, render: async () => { renders += 1; return { status: "failed" }; } });
    assert.notEqual((await agent.getStatus(env.ctx)).state, "working");
    await agent.run(env.ctx, {});
    assert.equal(renders, 0);
    const state = (await readBlackRoomTeamState<BlackRoomScriptsState | null>(env.dataDir, "blackroom-scripts", null))!;
    assert.equal(state.jobs[0].status, "failed");
    assert.match(state.jobs[0].error || "", /interrumpio/);
  } finally { await env.cleanup(); }
});
