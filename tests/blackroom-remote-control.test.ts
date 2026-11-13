import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { BLACKROOM_PUBLIC_MEDIA_PATHS, blackRoomMediaHeaders, blackRoomPage, hasBlackRoomChatAccess, hasValidBlackRoomRemoteToken, parseBlackRoomMediaRange, readBlackRoomPanelQueue, registerBlackRoomControlRoutes, resolveBlackRoomPanelAgent, summarizeBlackRoomAnalyticsImports } from "../server/blackroom-control-routes";
import {
  createBlackRoomRemoteControlState,
  isBlackRoomRemoteDeviceOnline,
  recordBlackRoomRemoteHeartbeat,
  recordBlackRoomPublicationExperiment,
  setBlackRoomRemoteCommand,
  appendBlackRoomRemoteCommand,
  appendBlackRoomCeoCommand,
  appendBlackRoomWorkNowCommand,
  upsertBlackRoomAnalyticsImports,
} from "../server/blackroom-remote-control";

test("remote control deduplicates the receipt experiment ledger", () => {
  const state = createBlackRoomRemoteControlState();
  const base = { metricoolId: "tt-1", reservationId: "r1", network: "tiktok", durationSeconds: 30, format: "vertical" as const, language: "en" as const, slot: "18:00", publishedAt: "2026-07-22T18:00:00" };
  recordBlackRoomPublicationExperiment(state, { ...base, creativeStrategy: "instant_drop" });
  recordBlackRoomPublicationExperiment(state, { ...base, creativeStrategy: "build_then_drop" });
  assert.equal(state.publicationExperiments.length, 1);
  assert.equal(state.publicationExperiments[0].creativeStrategy, "build_then_drop");
});
import { isPublicApiPath } from "../server/user-context";
import { DEFAULT_DEV_USER_ID } from "../server/user-context";
import { isConfiguredSingleUserOwner } from "../server/single-user-owner";

test("analytics imports preserve source timestamps and immutable age snapshots", () => {
  const state = createBlackRoomRemoteControlState();
  const now = new Date("2026-09-28T00:00:00Z");
  const base = { id: "real-post", publishedAt: "2026-09-01T00:00:00Z", views: 100, observedAt: "2026-09-02T00:00:00Z" };
  upsertBlackRoomAnalyticsImports(state, [{ network: "tiktok", samples: [base] }], now);
  upsertBlackRoomAnalyticsImports(state, [{ network: "tiktok", samples: [{ ...base, views: 500, observedAt: "2026-09-04T00:00:00Z" }] }], now);
  upsertBlackRoomAnalyticsImports(state, [{ network: "tiktok", samples: [{ ...base, views: 10, observedAt: undefined }] }], now);
  assert.equal(state.analyticsImports.tiktok?.samples[0].views, 500);
  assert.deepEqual(state.learningSnapshots?.map((item) => [item.windowHours, item.views]), [[24, 100], [72, 500]]);
  assert.equal(state.analyticsImports.tiktok?.samples[0].observedAt, "2026-09-04T00:00:00Z");
});

test("legacy imports cannot manufacture snapshots or zero-valued missing metrics", () => {
  const state = createBlackRoomRemoteControlState();
  upsertBlackRoomAnalyticsImports(state, [{ network: "facebook", samples: [
    { id: "missing", views: null }, { id: "empty", views: "" },
    { id: "zero", views: 0, averageWatchSeconds: null, publishedAt: "2026-07-01T00:00:00Z" },
  ] }]);
  assert.equal(state.analyticsImports.facebook?.samples.length, 1);
  assert.equal(state.analyticsImports.facebook?.samples[0].averageWatchSeconds, undefined);
  assert.deepEqual(state.learningSnapshots, []);
});

test("exact references join per network and revoke ambiguous derived identities", () => {
  const state = createBlackRoomRemoteControlState();
  const learningReference = "BR-012345abcdef";
  const base = { metricoolId: "scheduler", reservationId: "clip", network: "youtube", durationSeconds: 15,
    format: "vertical" as const, language: "en" as const, creativeStrategy: "drop_first" as const,
    slot: "12:00", publishedAt: "2026-09-20T12:00:00Z", learningReference };
  recordBlackRoomPublicationExperiment(state, base);
  upsertBlackRoomAnalyticsImports(state, [{ network: "youtube", samples: [{ id: "real-post", views: 20, learningReference }] }]);
  assert.equal(state.publicationExperiments[0].platformPostId, "real-post");
  recordBlackRoomPublicationExperiment(state, base);
  assert.equal(state.publicationExperiments[0].platformPostIdSource, "reference");
  upsertBlackRoomAnalyticsImports(state, [{ network: "facebook", samples: [{ id: "other-network", views: 20, learningReference }] }]);
  assert.equal(state.publicationExperiments[0].platformPostId, "real-post");
  upsertBlackRoomAnalyticsImports(state, [{ network: "youtube", samples: [{ id: "duplicate-post", views: 20, learningReference }] }]);
  assert.equal(state.publicationExperiments[0].platformPostId, undefined);
  recordBlackRoomPublicationExperiment(state, { ...base, platformPostId: "receipt-id" });
  upsertBlackRoomAnalyticsImports(state, []);
  assert.equal(state.publicationExperiments[0].platformPostId, "receipt-id");
});

test("tools page links its BlackRoom card directly to the live panel", () => {
  const toolsPage = readFileSync("client/src/pages/tools.tsx", "utf8");

  assert.match(toolsPage, /<a href="\/blackroom" data-testid="tool-blackroom">/);
  assert.doesNotMatch(toolsPage, /<Link href="\/blackroom">/);
  assert.match(blackRoomPage, /<title>BlackRoom Content Agent<\/title>/);
});

test("remote command increments its monotonic generation", () => {
  const now = new Date("2026-07-21T12:00:00.000Z");
  const state = createBlackRoomRemoteControlState(now);
  setBlackRoomRemoteCommand(state, true, 3, now);
  assert.equal(state.desiredEnabled, true);
  assert.equal(state.weeks, 3);
  assert.equal(state.generation, 1);
});

test("remote control cannot reduce the campaign below two weeks", () => {
  const state = createBlackRoomRemoteControlState();
  setBlackRoomRemoteCommand(state, true, 1);
  assert.equal(state.weeks, 2);
});

test("work-now command advances the generation without adding chat history", () => {
  const now = new Date("2026-08-26T08:30:00.000Z");
  const state = createBlackRoomRemoteControlState(now);
  appendBlackRoomWorkNowCommand(state, now);
  assert.equal(state.generation, 1);
  assert.equal(state.commands.at(-1)?.type, "work_now");
  assert.equal(state.chatHistory.length, 0);
});

test("CSV analytics imports are validated, deduplicated and retained per network", () => {
  const state = createBlackRoomRemoteControlState();
  const totals = upsertBlackRoomAnalyticsImports(state, [{
    network: "tiktok",
    sourceFiles: ["/Users/robert/Downloads/tiktok-posts_range.csv"],
    samples: [
      { id: "post-1", views: 3, publishedAt: "2026-07-27T09:30:00", durationSeconds: 30 },
      { id: "post-1", views: 99, publishedAt: "2026-07-28T09:30:00", durationSeconds: 30 },
      { id: "", views: 100 },
      { id: "negative", views: -1 },
    ],
  }], new Date("2026-07-30T12:00:00.000Z"));
  assert.deepEqual(totals, { tiktok: 1, facebook: 0, youtube: 0 });
  assert.deepEqual(state.analyticsImports.tiktok?.samples, [{
    id: "post-1", views: 99, publishedAt: "2026-07-28T09:30:00", durationSeconds: 30,
  }]);
  assert.deepEqual(state.analyticsImports.tiktok?.sourceFiles, ["tiktok-posts_range.csv"]);
  assert.equal(state.analyticsImports.tiktok?.importedAt, "2026-07-30T12:00:00.000Z");
  assert.deepEqual(summarizeBlackRoomAnalyticsImports(state), {
    tiktok: {
      sampleCount: 1,
      sourceFiles: ["tiktok-posts_range.csv"],
      importedAt: "2026-07-30T12:00:00.000Z",
      observedAt: null,
      snapshotCoverage: { 24: 0, 72: 0, 168: 0 },
      exactAttributed: 0,
    },
  });
  assert.equal("samples" in (summarizeBlackRoomAnalyticsImports(state).tiktok as object), false);
});

test("CEO schedule advances the generation without adding fake chat messages", () => {
  const now = new Date("2026-07-22T12:00:00.000Z");
  const state = createBlackRoomRemoteControlState(now);
  appendBlackRoomCeoCommand(state, {
    id: "ceo-1", type: "ceo_schedule", slotsByDate: { "2026-07-23": ["00:30", "04:00"] }, createdAt: now.toISOString(),
    analytics: {
      sampleCount: 4, comparableSampleCount: 1, lastCheckedAt: now.toISOString(), nextCheckAt: now.toISOString(), confidence: "collecting",
      networkSamples: { tiktok: 2, facebook: 1, youtube: 1 }, recommendedTimes: [], reason: "collecting",
      tiktokMedianViews: 0, tiktokLowViewRate: 0, creativeStrategy: "drop_first",
      creativeStrategyVersion: 0, creativeStrategySampleBaseline: 0, creativeStrategyPostIdsBaseline: [],
      creativeChangedAt: "", creativeReason: "collecting",
    },
  });
  assert.equal(state.generation, 1);
  assert.equal(state.commands.at(-1)?.type, "ceo_schedule");
  assert.equal(state.chatHistory.length, 0);
});

test("BlackRoom shared controls accept only the configured owner", async () => {
  assert.equal(await isConfiguredSingleUserOwner(DEFAULT_DEV_USER_ID), true);
  assert.equal(await isConfiguredSingleUserOwner("not-the-owner"), false);
  const request = (userId: string) => ({
    user: { id: userId },
    headers: {},
    header: (name: string) => name.toLowerCase() === "x-user-id" ? userId : undefined,
  }) as any;
  assert.equal(await hasBlackRoomChatAccess(request(DEFAULT_DEV_USER_ID)), true);
  assert.equal(await hasBlackRoomChatAccess(request("not-the-owner")), false);
  await assert.rejects(hasBlackRoomChatAccess({ headers: {}, header: () => DEFAULT_DEV_USER_ID } as any), /Authentication required/);
});

test("chat command is persisted and advances the remote generation", () => {
  const now = new Date("2026-07-21T12:00:00.000Z");
  const state = createBlackRoomRemoteControlState(now);
  appendBlackRoomRemoteCommand(state, {
    message: "sube 3 videos más hoy",
    reply: "Listo",
    command: { id: "extra-3", type: "extra_posts", posts: 3, targetDate: "2026-07-21", createdAt: now.toISOString() },
  }, now);
  assert.equal(state.generation, 1);
  assert.equal(state.commands.length, 1);
  assert.deepEqual(state.chatHistory.map((message) => message.role), ["user", "assistant"]);
});

test("heartbeat reports the Mac online only inside the freshness window", () => {
  const state = createBlackRoomRemoteControlState();
  recordBlackRoomRemoteHeartbeat(state, {
    deviceId: "blackroom-mac",
    queue: { enabled: true },
    worker: { running: true, activity: [
      { id: "event-1", createdAt: "2026-07-21T12:00:00.000Z", stage: "audio", level: "success", message: "Audio validado." },
      { id: "event-2", createdAt: "invalid", stage: "x".repeat(100), level: "unknown", message: "m".repeat(1_200) },
      { message: "" },
    ] },
    lastError: null,
    appliedGeneration: 3,
  }, new Date("2026-07-21T12:00:00.000Z"));
  assert.equal(isBlackRoomRemoteDeviceOnline(state, new Date("2026-07-21T12:01:00.000Z")), true);
  assert.equal(isBlackRoomRemoteDeviceOnline(state, new Date("2026-07-21T12:02:00.000Z")), false);
  assert.equal(state.device?.appliedGeneration, 3);
  const activity = state.device?.worker.activity as any[];
  assert.equal(activity.length, 2);
  assert.equal(activity[0].message, "Audio validado.");
  assert.equal(activity[1].level, "info");
  assert.equal(activity[1].stage.length, 80);
  assert.equal(activity[1].message.length, 1_000);
  assert.equal(activity[1].createdAt, "2026-07-21T12:00:00.000Z");
});

test("BlackRoom control mutations and panel data are owner-only", () => {
  const source = readFileSync("server/blackroom-control-routes.ts", "utf8");
  for (const signature of [
    'app.get("/blackroom"',
    'app.get("/api/blackroom-agent"',
    'app.post("/api/blackroom-agent/start"',
    'app.post("/api/blackroom-agent/pause"',
    'app.post("/api/blackroom-agent/work-now"',
  ]) {
    const start = source.indexOf(signature);
    const nextRoute = source.indexOf("\n  app.", start + signature.length);
    const route = source.slice(start, nextRoute > start ? nextRoute : undefined);
    assert.ok(start > 0, `${signature} should exist`);
    assert.match(route, /hasBlackRoomChatAccess\(req\)/);
    assert.match(route, /status\(403\)/);
  }
});

test("BlackRoom HTML route returns a controlled 401 when the session expired", async () => {
  const handlers = new Map<string, Function>();
  const app: any = {};
  for (const method of ["get", "post", "put", "head"]) {
    app[method] = (route: string, ...callbacks: Function[]) => {
      handlers.set(`${method.toUpperCase()} ${route}`, callbacks.at(-1)!);
      return app;
    };
  }
  registerBlackRoomControlRoutes(app);
  const response: any = {
    statusCode: 200,
    body: "",
    status(code: number) { this.statusCode = code; return this; },
    type() { return this; },
    set() { return this; },
    send(body: string) { this.body = body; return this; },
  };
  const previousFallback = process.env.ALLOW_DEV_USER_FALLBACK;
  process.env.ALLOW_DEV_USER_FALLBACK = "false";
  try {
    await handlers.get("GET /blackroom")!({ headers: {}, header: () => undefined }, response);
  } finally {
    if (previousFallback === undefined) delete process.env.ALLOW_DEV_USER_FALLBACK;
    else process.env.ALLOW_DEV_USER_FALLBACK = previousFallback;
  }
  assert.equal(response.statusCode, 401);
  assert.match(response.body, /sesión expiró/);
});

test("local worker publishes structured live activity with every heartbeat", () => {
  const worker = readFileSync("script/blackroom-local-worker.ts", "utf8");
  const control = readFileSync("script/blackroom-control-server.mjs", "utf8");

  assert.match(worker, /activity-log\.json/);
  assert.match(worker, /Iniciando descarga, selección del drop y edición/);
  assert.match(worker, /Audio validado/);
  assert.match(worker, /Subiendo y programando/);
  assert.match(worker, /archivo local eliminado/);
  assert.match(control, /workerActivityPath/);
  assert.match(control, /activity: Array\.isArray\(activity\) \? activity\.slice\(-80\) : \[\]/);
  assert.match(control, /syncMetricoolCsvExports/);
  assert.match(control, /\/api\/blackroom-agent\/analytics\/import/);
  assert.match(control, /BLACKROOM_METRICOOL_EXPORT_DIR/);
  assert.match(control, /for \(const remoteCommand of control\.commands\)/);
  assert.match(control, /commands: \[remoteCommand\]/);
});

test("panel keeps last confirmed delivery counters when the Mac goes offline", () => {
  const localQueue = {
    enabled: true, pausedAt: null, updatedAt: "2026-07-22T07:00:00.000Z", timezone: "America/New_York",
    bufferDays: 14, bufferWeeks: 2, postsPerDay: 10, pendingPrioritySources: 0, usedSourceVideos: 0,
    durationSamples: {}, analytics: {}, nextJob: null,
    totals: { queued: 15, processing: 0, retry: 1, scheduled: 0, completed: 0 },
  } as any;
  const remoteQueue = {
    ...localQueue,
    progress: undefined,
    totals: { ...localQueue.totals, scheduled: 3, completed: 1 },
    delivery: { scheduled: 3, completed: 1, confirmed: 4 },
  };

  const online = resolveBlackRoomPanelAgent(localQueue, remoteQueue, true);
  assert.deepEqual(online.progress, {
    remainingPosts: 160,
    remainingBatches: 16,
    remainingDays: 16,
    remainingCalendarDays: 16,
    estimatedFinishDate: null,
  });
  const offline = resolveBlackRoomPanelAgent(localQueue, remoteQueue, false);
  assert.deepEqual(offline.totals, {
    queued: 15, processing: 0, retry: 1, scheduled: 3, completed: 1,
  });
  assert.deepEqual(offline.delivery, remoteQueue.delivery);
  assert.deepEqual(offline.progress, online.progress);
});

test("panel remains available when Replit has no local queue file but the Mac reported one", async () => {
  const remoteQueue = { enabled: true, totals: { queued: 0, processing: 0, retry: 0, scheduled: 8, completed: 9 } } as any;
  const result = await readBlackRoomPanelQueue(remoteQueue, async () => { throw new Error("ENOENT"); });
  assert.equal(result, remoteQueue);
  await assert.rejects(() => readBlackRoomPanelQueue(undefined, async () => { throw new Error("ENOENT"); }), /ENOENT/);
});

test("device authentication rejects missing, short, placeholder, and incorrect tokens", () => {
  const token = "a-secure-blackroom-device-token-1234567890";
  assert.equal(hasValidBlackRoomRemoteToken(`Bearer ${token}`, token), true);
  assert.equal(hasValidBlackRoomRemoteToken(undefined, token), false);
  assert.equal(hasValidBlackRoomRemoteToken("Bearer wrong", token), false);
  assert.equal(hasValidBlackRoomRemoteToken("Bearer your-token", "your-token"), false);
});

test("token-protected BlackRoom bridge paths bypass cookie auth for the local worker", () => {
  assert.equal(isPublicApiPath("/api/blackroom-agent/analytics/import"), true);
  assert.equal(isPublicApiPath("/api/blackroom-agent/analytics/refresh"), false);
  assert.equal(isPublicApiPath("/api/blackroom-agent/metricool/schedule"), true);
  assert.equal(isPublicApiPath("/api/blackroom-agent/media/reservation-1"), true);
  assert.equal(isPublicApiPath("/api/blackroom-agent/media/reservation-1.mp4"), true);
  assert.equal(isPublicApiPath("/api/blackroom-agent/media/chunked/upload-1/0"), true);
  assert.equal(isPublicApiPath("/api/blackroom-agent/media/chunked/upload-1/complete"), true);
  assert.equal(isPublicApiPath("/api/blackroom-agent/media/chunked/upload-1/delete"), false);
  assert.equal(isPublicApiPath("/api/blackroom-agent/media/reservation-1/extra"), false);
});

test("CSV analytics import remains protected by the Mac bearer token", () => {
  const source = readFileSync("server/blackroom-control-routes.ts", "utf8");
  const start = source.indexOf('app.post("/api/blackroom-agent/analytics/import"');
  const nextRoute = source.indexOf("\n  app.", start + 10);
  const route = source.slice(start, nextRoute);
  assert.ok(start > 0);
  assert.match(route, /hasValidBlackRoomRemoteToken\(req\.get\("authorization"\)\)/);
  assert.match(route, /status\(401\)/);
  assert.match(route, /upsertBlackRoomAnalyticsImports/);
  assert.match(route, /refreshBlackRoomCeo\(true\)/);
});

test("an import arriving during a CEO refresh queues one forced follow-up pass", () => {
  const source = readFileSync("server/blackroom-control-routes.ts", "utf8");
  assert.match(source, /let blackRoomCeoRefreshPendingForce = false/);
  assert.match(source, /if \(force\) blackRoomCeoRefreshPendingForce = true/);
  assert.match(source, /do \{[\s\S]*await refreshBlackRoomCeoOnce\(nextForce\)[\s\S]*\} while \(blackRoomCeoRefreshPendingForce\)/);
});

test("public MP4 serving accepts browser and video-probe byte ranges", () => {
  assert.equal(BLACKROOM_PUBLIC_MEDIA_PATHS[0], "/api/blackroom-agent/media/:uploadId.mp4");
  assert.equal(parseBlackRoomMediaRange(undefined, 1_000), null);
  assert.deepEqual(parseBlackRoomMediaRange("bytes=0-99", 1_000), { start: 0, end: 99 });
  assert.deepEqual(parseBlackRoomMediaRange("bytes=900-", 1_000), { start: 900, end: 999 });
  assert.deepEqual(parseBlackRoomMediaRange("bytes=-100", 1_000), { start: 900, end: 999 });
  assert.equal(parseBlackRoomMediaRange("bytes=1000-", 1_000), false);
  assert.equal(parseBlackRoomMediaRange("items=0-1", 1_000), false);
});

test("full MP4 downloads stream through deployment proxies without a fixed response length", () => {
  const fullGet = blackRoomMediaHeaders("upload-1", 92_157_383, null, "GET");
  assert.equal(fullGet["Content-Length"], undefined);
  assert.equal(fullGet["Accept-Ranges"], "bytes");
  assert.equal(fullGet["Content-Type"], "video/mp4");

  const head = blackRoomMediaHeaders("upload-1", 92_157_383, null, "HEAD");
  assert.equal(head["Content-Length"], "92157383");

  const range = blackRoomMediaHeaders("upload-1", 92_157_383, { start: 0, end: 1_048_575 }, "GET");
  assert.equal(range["Content-Length"], "1048576");
  assert.equal(range["Content-Range"], "bytes 0-1048575/92157383");
});

test("offline paused panel keeps Play available so the command can be queued", () => {
  assert.match(blackRoomPage, /pausing=!desired&&remote\.online&&!synced/);
  assert.match(blackRoomPage, /els\.play\.hidden=desired\|\|pausing/);
  const desired = false;
  const remoteOnline = false;
  const synced = false;
  const pausing = !desired && remoteOnline && !synced;
  assert.equal(desired || pausing, false);
  assert.match(blackRoomPage, /let mutationBusy=false,requestGeneration=0/);
  assert.match(blackRoomPage, /async function refreshStatus\(\)\{if\(mutationBusy\)return/);
  assert.match(blackRoomPage, /async function mutate\(path,opt\)\{if\(mutationBusy\)return/);
  assert.match(blackRoomPage, /function disableActions\(value\)/);
  assert.match(blackRoomPage, /els\.pause\.onclick=\(\)=>mutate\('\/api\/blackroom-agent\/pause'/);
  assert.match(blackRoomPage, /if\(!message\|\|mutationBusy\)return/);
  assert.match(blackRoomPage, /generation===requestGeneration/);
});

test("BlackRoom panel exposes the chat controls", () => {
  assert.match(blackRoomPage, /Habla con el agente/);
  assert.match(blackRoomPage, /\/api\/blackroom-agent\/chat/);
  assert.match(blackRoomPage, /sube 3 videos más hoy/);
  assert.match(blackRoomPage, /TikTok \+ Facebook \+ YouTube/);
  assert.match(blackRoomPage, /facebook\.com\/profile\.php\?id=61568193332044/);
  assert.match(blackRoomPage, /confirmar todos los destinos requeridos/);
  assert.match(blackRoomPage, /const byId=id=>document\.getElementById\(id\)/);
  assert.match(blackRoomPage, /Trabajando de verdad/);
  assert.match(blackRoomPage, /Posts por preparar/);
  assert.match(blackRoomPage, /Días\/lotes pendientes/);
  assert.match(blackRoomPage, /Tiempo estimado para terminar/);
  assert.match(blackRoomPage, /id="remainingPosts"/);
  assert.match(blackRoomPage, /id="remainingBatches"/);
  assert.match(blackRoomPage, /id="remainingTime"/);
  assert.match(blackRoomPage, /function remainingTimeLabel/);
  assert.match(blackRoomPage, /remainingCalendarDays/);
  assert.match(blackRoomPage, /Al encender/);
  assert.match(blackRoomPage, /Todo preparado/);
  assert.match(blackRoomPage, /aria-label="Progreso del agente"/);
  assert.match(blackRoomPage, /role="progressbar"/);
  assert.match(blackRoomPage, /id="progressFill"/);
  assert.match(blackRoomPage, /Procesando un video ahora/);
  assert.match(blackRoomPage, /Activo · esperando el próximo lote/);
  assert.match(blackRoomPage, /se reanuda al encender la Mac/);
  assert.match(blackRoomPage, /function lastSignalText/);
  assert.match(blackRoomPage, /última señal hace/);
  assert.match(blackRoomPage, /Agenda preparada:/);
  assert.match(blackRoomPage, /▶ Trabajar ahora/);
  assert.match(blackRoomPage, /\/api\/blackroom-agent\/work-now/);
  assert.match(blackRoomPage, /els\.workNow\.hidden=/);
  assert.match(blackRoomPage, /aria-valuetext/);
  assert.match(blackRoomPage, /prefers-reduced-motion/);
  assert.match(blackRoomPage, /Actividad en vivo/);
  assert.doesNotMatch(blackRoomPage, /1 semana/);
  assert.match(blackRoomPage, /segmentos sin repetir ni solapar/);
  assert.match(blackRoomPage, /Chat y órdenes/);
  assert.match(blackRoomPage, /aria-live="polite"/);
  assert.match(blackRoomPage, /técnica CEO/);
  assert.match(blackRoomPage, /mediana TikTok/);
  assert.match(blackRoomPage, /historial:/);
  assert.match(blackRoomPage, /historyCompleteByNetwork/);
  assert.match(blackRoomPage, /function renderActivity\(history=\[\]\)/);
  assert.match(blackRoomPage, /setAttribute\('role','log'\)/);
  assert.match(blackRoomPage, /aria-relevant','additions/);
  assert.match(blackRoomPage, /renderedActivityIds/);
  assert.match(blackRoomPage, /ArrowLeft','ArrowRight','Home','End/);
  assert.match(blackRoomPage, /tabIndex=activity\?0:-1/);
  assert.match(blackRoomPage, /setInterval\(\(\)=>refreshStatus\(\),5000\)/);
  const scripts = [...blackRoomPage.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  assert.equal(scripts.length, 1);
  for (const script of scripts) assert.doesNotThrow(() => new Function(script));
});
