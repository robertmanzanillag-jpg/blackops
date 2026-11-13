import { type Express, type Request, type Response } from "express";
import { buildBlackRoomOfficeOperations } from "./blackroom-office-operations";
import { blackRoomLearningPanelHtml, blackRoomLearningPanelScript } from "./blackroom-learning-panel";
import { canonicalLearningPostId } from "./blackroom-verified-learning";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, stat, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { BLACKROOM_QUEUE_PATH, pauseBlackRoomAgent, readBlackRoomQueue, startBlackRoomAgent, summarizeBlackRoomQueue, withBlackRoomQueueLock, writeBlackRoomQueue } from "./blackroom-daily-queue";
import {
  isBlackRoomRemoteDeviceOnline,
  mutateBlackRoomRemoteControl,
  appendBlackRoomCeoCommand,
  appendBlackRoomWorkNowCommand,
  readBlackRoomRemoteControl,
  readExistingBlackRoomRemoteControl,
  recordBlackRoomPublicationExperiment,
  recordBlackRoomRemoteHeartbeat,
  setBlackRoomRemoteCommand,
  upsertBlackRoomAnalyticsImports,
  type BlackRoomAnalyticsNetwork,
  type BlackRoomRemoteControlState,
} from "./blackroom-remote-control";
import { executeBlackRoomChatMessage } from "./blackroom-chat-service";
import { BlackRoomMetricoolUncertainError, scheduleBlackRoomMetricoolPost, type BlackRoomMetricoolReceipt } from "./blackroom-metricool-bridge";
import { BlackRoomPublicationBlockedError } from "./blackroom-publication-guard";
import { BLACKROOM_CEO_DAILY_POSTS, BLACKROOM_CEO_MAX_DAILY_POSTS, BLACKROOM_CEO_REFRESH_MS, buildBlackRoomLearningSlots, collectBlackRoomMetricoolAnalytics, planBlackRoomCampaignPosts } from "./blackroom-growth-ceo";
import { getCurrentUserId } from "./user-context";
import { isConfiguredSingleUserOwner } from "./single-user-owner";

const BLACKROOM_UPLOAD_MAX_BYTES = 500 * 1024 * 1024;
const BLACKROOM_UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024;
const BLACKROOM_UPLOAD_TTL_MS = 30 * 60_000;
const blackRoomUploadDir = path.join(os.tmpdir(), "blackroom-metricool-uploads");
type BlackRoomUpload = {
  filePath: string;
  reservationId: string;
  expiresAt: number;
  ready: boolean;
  retainForReconciliation?: boolean;
  totalBytes?: number;
  totalChunks?: number;
  nextChunk?: number;
  chunkSizes?: number[];
};
const blackRoomUploads = new Map<string, BlackRoomUpload>();
let blackRoomCeoRefreshPromise: Promise<void> | null = null;
let blackRoomCeoRefreshPendingForce = false;
export const BLACKROOM_PUBLIC_MEDIA_PATHS = ["/api/blackroom-agent/media/:uploadId.mp4", "/api/blackroom-agent/media/:uploadId"] as const;

function addUtcDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function blackRoomLocalDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

async function refreshBlackRoomCeoOnce(force: boolean): Promise<void> {
    const current = await readBlackRoomRemoteControl();
    const previous = [...current.commands].reverse().find((command) => command.type === "ceo_schedule");
    if (!force && previous && Date.now() - new Date(previous.createdAt).getTime() < BLACKROOM_CEO_REFRESH_MS) return;
    const analytics = await collectBlackRoomMetricoolAnalytics({
      previous: previous?.analytics,
      importedSamplesByNetwork: Object.fromEntries(Object.entries(current.analyticsImports || {})
        .map(([network, imported]) => [network, imported?.samples || []])),
      publicationExperiments: current.publicationExperiments,
      learningSnapshots: current.learningSnapshots || [],
    });
    const today = blackRoomLocalDate(new Date());
    const currentTarget = Number((current.device?.queue as any)?.postsPerDay || BLACKROOM_CEO_DAILY_POSTS);
    const manualTarget = Math.max(BLACKROOM_CEO_DAILY_POSTS, Math.min(BLACKROOM_CEO_MAX_DAILY_POSTS, Math.floor(currentTarget)));
    const postsByDate = Object.fromEntries(Array.from({ length: 14 }, (_, dayIndex) => {
      const targetDate = addUtcDays(today, dayIndex + 1);
      return [targetDate, manualTarget > BLACKROOM_CEO_DAILY_POSTS ? manualTarget : planBlackRoomCampaignPosts({ dayIndex, analytics })];
    }));
    const slotsByDate = Object.fromEntries(Array.from({ length: 14 }, (_, dayIndex) => {
      const targetDate = addUtcDays(today, dayIndex + 1);
      return [targetDate, buildBlackRoomLearningSlots({
        dayIndex,
        posts: postsByDate[targetDate],
        sampleCount: analytics.comparableSampleCount,
        recommendedTimes: analytics.recommendedTimes,
      })];
    }));
    await mutateBlackRoomRemoteControl((state) => appendBlackRoomCeoCommand(state, {
      id: `blackroom-ceo-${randomUUID()}`,
      type: "ceo_schedule",
      slotsByDate,
      postsByDate,
      analytics,
      createdAt: analytics.lastCheckedAt,
    }));
}

async function refreshBlackRoomCeo(force = false): Promise<void> {
  if (blackRoomCeoRefreshPromise) {
    if (force) blackRoomCeoRefreshPendingForce = true;
    return blackRoomCeoRefreshPromise;
  }
  blackRoomCeoRefreshPromise = (async () => {
    let nextForce = force;
    do {
      blackRoomCeoRefreshPendingForce = false;
      await refreshBlackRoomCeoOnce(nextForce);
      nextForce = true;
    } while (blackRoomCeoRefreshPendingForce);
  })().finally(() => { blackRoomCeoRefreshPromise = null; });
  return blackRoomCeoRefreshPromise;
}

async function removeBlackRoomUpload(uploadId: string): Promise<void> {
  const upload = blackRoomUploads.get(uploadId);
  if (!upload) return;
  blackRoomUploads.delete(uploadId);
  await unlink(upload.filePath).catch(() => undefined);
}

function cleanupExpiredBlackRoomUploads(now = Date.now()): void {
  for (const [uploadId, upload] of blackRoomUploads) {
    if (!upload.retainForReconciliation && upload.expiresAt <= now) void removeBlackRoomUpload(uploadId);
  }
}

async function receiveBlackRoomUpload(request: NodeJS.ReadableStream, filePath: string): Promise<number> {
  let bytes = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > BLACKROOM_UPLOAD_MAX_BYTES) {
        const error = new Error("BlackRoom upload exceeds Metricool's 500 MB limit") as Error & { status?: number };
        error.status = 413;
        callback(error);
        return;
      }
      callback(null, chunk);
    },
  });
  await pipeline(request, limiter, createWriteStream(filePath, { flags: "wx" }));
  return bytes;
}

async function receiveBlackRoomUploadChunk(request: NodeJS.ReadableStream, filePath: string): Promise<number> {
  let bytes = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > BLACKROOM_UPLOAD_CHUNK_BYTES) {
        const error = new Error("BlackRoom upload chunk exceeds 4 MB") as Error & { status?: number };
        error.status = 413;
        callback(error);
        return;
      }
      callback(null, chunk);
    },
  });
  await pipeline(request, limiter, createWriteStream(filePath, { flags: "wx" }));
  return bytes;
}

export function parseBlackRoomMediaRange(value: string | undefined, size: number): { start: number; end: number } | null | false {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || size <= 0) return false;
  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return false;
  if (!rawStart) {
    const suffixLength = Number(rawEnd);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return false;
    return { start: Math.max(0, size - suffixLength), end: size - 1 };
  }
  const start = Number(rawStart);
  const requestedEnd = rawEnd ? Number(rawEnd) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start < 0 || start >= size || requestedEnd < start) return false;
  return { start, end: Math.min(requestedEnd, size - 1) };
}

export function blackRoomMediaHeaders(
  uploadId: string,
  size: number,
  range: { start: number; end: number } | null,
  method = "GET",
): Record<string, string> {
  const start = range?.start ?? 0;
  const end = range?.end ?? size - 1;
  return {
    "Accept-Ranges": "bytes",
    "Content-Type": "video/mp4",
    "Content-Disposition": `inline; filename="blackroom-${uploadId}.mp4"`,
    "Cache-Control": "public, max-age=300",
    // Replit's deployment proxy rejects large, length-delimited responses even
    // though byte-range requests work. Stream full GETs with chunked encoding;
    // retain Content-Length for HEAD probes and explicit ranges.
    ...((range || method === "HEAD") ? { "Content-Length": String(end - start + 1) } : {}),
    ...(range ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}),
  };
}

async function serveBlackRoomMedia(req: Request, res: Response): Promise<void> {
  cleanupExpiredBlackRoomUploads();
  const upload = blackRoomUploads.get(String(req.params.uploadId || ""));
  if (!upload?.ready) { res.status(404).end(); return; }
  const info = await stat(upload.filePath).catch(() => null);
  if (!info?.isFile()) {
    await removeBlackRoomUpload(String(req.params.uploadId || ""));
    res.status(404).end();
    return;
  }
  const range = parseBlackRoomMediaRange(req.get("range"), info.size);
  if (range === false) {
    res.status(416).set("Content-Range", `bytes */${info.size}`).end();
    return;
  }
  const start = range?.start ?? 0;
  const end = range?.end ?? info.size - 1;
  const status = range ? 206 : 200;
  res.status(status).set(blackRoomMediaHeaders(String(req.params.uploadId || ""), info.size, range, req.method));
  if (req.method === "HEAD") { res.end(); return; }
  try {
    await pipeline(createReadStream(upload.filePath, { start, end }), res);
  } catch {
    if (!res.headersSent) res.status(500).end();
  }
}

export function hasValidBlackRoomRemoteToken(authorization: string | undefined, configuredToken = process.env.BLACKROOM_REMOTE_CONTROL_TOKEN): boolean {
  const token = String(configuredToken || "").trim();
  if (token.length < 32 || /replace|example|your[-_ ]?token/i.test(token)) return false;
  const supplied = String(authorization || "").replace(/^Bearer\s+/i, "").trim();
  const expectedBuffer = Buffer.from(token);
  const suppliedBuffer = Buffer.from(supplied);
  return suppliedBuffer.length === expectedBuffer.length && timingSafeEqual(suppliedBuffer, expectedBuffer);
}

export function summarizeBlackRoomAnalyticsImports(state: BlackRoomRemoteControlState) {
  return Object.fromEntries(Object.entries(state.analyticsImports || {}).map(([network, imported]) => [
    network,
    {
      sampleCount: imported?.samples.length || 0,
      sourceFiles: imported?.sourceFiles || [],
      importedAt: imported?.importedAt || null,
      observedAt: (imported?.samples || []).map((sample) => sample.observedAt)
        .filter((stamp): stamp is string => Boolean(stamp) && Date.parse(stamp!) <= Date.now())
        .sort((a, b) => Date.parse(b) - Date.parse(a))[0] || null,
      snapshotCoverage: Object.fromEntries([24, 72, 168].map((hours) => [hours,
        (state.learningSnapshots || []).filter((snapshot) => snapshot.network === network && snapshot.windowHours === hours).length])),
      exactAttributed: (imported?.samples || []).filter((sample) => {
        const id = canonicalLearningPostId(network as "tiktok" | "facebook" | "youtube", sample.id);
        return id && state.publicationExperiments.filter((experiment) => experiment.network === network
          && canonicalLearningPostId(network as "tiktok" | "facebook" | "youtube", experiment.platformPostId || "") === id).length === 1;
      }).length,
    },
  ]));
}

function remoteView(state: BlackRoomRemoteControlState) {
  const analyticsImports = summarizeBlackRoomAnalyticsImports(state);
  const { learningSnapshots, ...view } = state;
  return { ...view, analyticsImports, learningSnapshotCount: learningSnapshots?.length || 0, online: isBlackRoomRemoteDeviceOnline(state) };
}

function blackRoomCounter(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
}

function withBlackRoomProgressFallback(
  queue: ReturnType<typeof summarizeBlackRoomQueue> | Record<string, any>,
): ReturnType<typeof summarizeBlackRoomQueue> {
  const totals = queue.totals || {};
  const pendingBatches = blackRoomCounter(totals.queued) + blackRoomCounter(totals.processing) + blackRoomCounter(totals.retry);
  return {
    ...queue,
    progress: queue.progress || {
      remainingPosts: pendingBatches * Math.max(1, blackRoomCounter(queue.postsPerDay) || 5),
      remainingBatches: pendingBatches,
      remainingDays: pendingBatches,
      remainingCalendarDays: pendingBatches,
      estimatedFinishDate: null,
    },
  } as ReturnType<typeof summarizeBlackRoomQueue>;
}

export function resolveBlackRoomPanelAgent(
  localQueue: ReturnType<typeof summarizeBlackRoomQueue>,
  remoteQueue: Record<string, any> | undefined,
  remoteOnline: boolean,
) {
  if (remoteOnline && remoteQueue?.totals) return withBlackRoomProgressFallback(remoteQueue);
  if (!remoteQueue?.delivery) return withBlackRoomProgressFallback(localQueue);
  const scheduled = blackRoomCounter(remoteQueue.delivery.scheduled);
  const completed = blackRoomCounter(remoteQueue.delivery.completed);
  return withBlackRoomProgressFallback({
    ...localQueue,
    totals: { ...localQueue.totals, scheduled, completed },
    delivery: {
      scheduled,
      completed,
      confirmed: blackRoomCounter(remoteQueue.delivery.confirmed),
    },
  });
}

export async function readBlackRoomPanelQueue(
  remoteQueue: Record<string, any> | undefined,
  readQueue: typeof readBlackRoomQueue = readBlackRoomQueue,
) {
  try {
    return summarizeBlackRoomQueue(await readQueue());
  } catch (error) {
    if (remoteQueue?.totals) return remoteQueue as ReturnType<typeof summarizeBlackRoomQueue>;
    throw error;
  }
}

export async function hasBlackRoomChatAccess(req: Request): Promise<boolean> {
  return isConfiguredSingleUserOwner(getCurrentUserId(req));
}

/**
 * Owner or an active partner ("socio"). Only the videos agent status read and its chat use this;
 * start/pause/work-now/analytics stay owner-only (hasBlackRoomChatAccess).
 */
export async function hasBlackRoomPartnerAccess(req: Request): Promise<boolean> {
  const { resolveOwnerOrPartner } = await import("./workspace-access");
  return Boolean(await resolveOwnerOrPartner(getCurrentUserId(req)));
}

const blackRoomPageTemplate = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BlackRoom Content Agent</title><style>
.agent-progress{margin-top:14px;border:1px solid #10b98144;background:#052e2429;border-radius:14px;padding:15px}.agent-progress-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}.agent-progress-status{display:flex;align-items:center;gap:9px;font-weight:700;color:#a7f3d0}.live-dot{width:10px;height:10px;border-radius:50%;background:#34d399;box-shadow:0 0 0 0 #34d39988;animation:pulse 1.8s infinite}.agent-progress.offline .live-dot,.agent-progress.paused .live-dot{background:#71717a;box-shadow:none;animation:none}.agent-progress.offline .agent-progress-status,.agent-progress.paused .agent-progress-status{color:#a1a1aa}.progress-track{height:14px;overflow:hidden;border-radius:999px;background:#18181b;border:1px solid #ffffff12}.progress-fill{height:100%;width:0;border-radius:inherit;background:linear-gradient(90deg,#06b6d4,#34d399);transition:width .5s ease;position:relative}.agent-progress.processing .progress-fill:after,.agent-progress.waiting .progress-fill:after{content:"";position:absolute;inset:0;background:linear-gradient(110deg,transparent 20%,#ffffff70 45%,transparent 70%);animation:work 1.4s linear infinite}.agent-progress.waiting .progress-fill:after{opacity:.45;animation-duration:2.8s}.progress-detail{margin-top:9px;color:#a1a1aa;font-size:12px}.agent-progress-action{margin-top:12px;width:100%}@keyframes pulse{70%{box-shadow:0 0 0 8px #34d39900}}@keyframes work{from{transform:translateX(-100%)}to{transform:translateX(100%)}}@media(prefers-reduced-motion:reduce){.live-dot,.agent-progress.processing .progress-fill:after,.agent-progress.waiting .progress-fill:after{animation:none}.progress-fill{transition:none}}@media(max-width:720px){.agent-progress-head{align-items:flex-start;flex-direction:column}}
:root{color-scheme:dark;font-family:Inter,system-ui;background:#020203;color:#fff}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at top,#12313a,#07070a 38%,#000);min-height:100vh}.wrap{max-width:1050px;margin:auto;padding:42px 20px}.eyebrow{color:#67e8f9;font-size:12px;letter-spacing:.18em;text-transform:uppercase}h1{font-size:40px;margin:10px 0}.muted{color:#a1a1aa}.card{border:1px solid #ffffff1c;border-radius:18px;background:#09090be8;padding:24px}.top,.controls{display:flex;gap:16px;align-items:center;justify-content:space-between}.badge{border:1px solid #fbbf2444;background:#fbbf2414;color:#fde68a;border-radius:999px;padding:7px 12px}.badge.on{border-color:#6ee7b744;background:#10b98118;color:#a7f3d0}.controls{justify-content:flex-start;margin-top:22px;flex-wrap:wrap}select,button{height:44px;border-radius:10px;border:1px solid #ffffff24;background:#18181b;color:#fff;padding:0 15px}button{cursor:pointer;font-weight:700}.play{background:#a7f3d0;color:#052e24;border:0}.pause{color:#fde68a}.stats{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-top:20px}.progress-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:10px}.stat,.info{border:1px solid #ffffff14;background:#0007;border-radius:12px;padding:15px}.stat small{display:block;color:#71717a;text-transform:uppercase;font-size:10px}.stat strong{font-size:25px}.progress-stats .stat strong{font-size:20px}.info{margin-top:14px;font-size:13px;color:#a1a1aa}.channel{color:#67e8f9}.workspace{margin-top:22px;border-top:1px solid #ffffff14;padding-top:20px}.tabs{display:flex;gap:8px;flex-wrap:wrap}.tab[aria-selected=true]{background:#164e63;border-color:#67e8f966;color:#ecfeff}.panel{padding-top:14px}.panel[hidden]{display:none}.activity{display:flex;flex-direction:column;gap:9px;max-height:360px;overflow:auto;margin-top:12px}.event{border:1px solid #ffffff14;border-radius:12px;background:#111114;padding:11px 12px}.event.success{border-color:#10b98144}.event.error{border-color:#ef444466;background:#450a0a55}.event-head{display:flex;justify-content:space-between;gap:12px;color:#71717a;font-size:11px;text-transform:uppercase}.event p{margin:6px 0 0;color:#d4d4d8;font-size:14px}.messages{display:flex;flex-direction:column;gap:9px;max-height:280px;overflow:auto;margin:12px 0}.msg{max-width:82%;padding:10px 12px;border-radius:12px;background:#18181b;color:#d4d4d8;font-size:14px}.msg.user{align-self:flex-end;background:#164e63;color:#ecfeff}.composer{display:flex;gap:8px}.composer input{flex:1;min-width:0;height:44px;border-radius:10px;border:1px solid #ffffff24;background:#050507;color:#fff;padding:0 13px}@media(max-width:720px){h1{font-size:30px}.top{align-items:flex-start;flex-direction:column}.stats,.progress-stats{grid-template-columns:repeat(2,1fr)}.composer{flex-direction:column}}
</style></head><body><main class="wrap"><div class="eyebrow">BlackRoom · TikTok + Facebook + YouTube Shorts</div><div class="top"><div><h1>BlackRoom Content Agent</h1><p class="muted">YouTube → edición → Metricool → TikTok + Facebook + YouTube Shorts</p></div><div><a class="channel" href="https://www.youtube.com/@blackroom_us" target="_blank">Canal oficial ↗</a> · <a class="channel" href="https://www.facebook.com/profile.php?id=61568193332044" target="_blank">Facebook principal ↗</a></div></div><section class="card"><div class="top"><div><h2>Control del agente</h2><p class="muted">Cantidad flexible, 5 DJs, videos sin repetir, drops y cortes verticales/horizontales.</p></div><span id="badge" class="badge">Cargando…</span></div><div class="controls"><label><span class="muted">Duración de campaña</span><br><select id="weeks" aria-label="Duración de campaña"><option value="1">1 semana</option><option value="2" selected>2 semanas</option><option value="3">3 semanas</option><option value="4">4 semanas</option></select></label><button id="play" class="play">▶ Iniciar agente</button><button id="pause" class="pause" hidden>Ⅱ Pausar agente</button><button id="refresh">↻ Actualizar</button></div><div class="stats"><div class="stat"><small>En cola</small><strong id="queued">0</strong></div><div class="stat"><small>Procesando</small><strong id="processing">0</strong></div><div class="stat"><small>Reintentos</small><strong id="retry">0</strong></div><div class="stat"><small>Agendados</small><strong id="scheduled">0</strong></div><div class="stat"><small>Completados</small><strong id="completed">0</strong></div></div><div class="progress-stats" aria-label="Progreso restante"><div class="stat"><small>Posts por preparar</small><strong id="remainingPosts">0</strong></div><div class="stat"><small>Días/lotes pendientes</small><strong id="remainingBatches">0</strong></div><div class="stat"><small>Tiempo estimado para terminar</small><strong id="remainingTime">Calculando…</strong></div></div><div id="device" class="info">Buscando la Mac…</div><div id="experiment" class="info">Experimento 15s · 30s · 60s · 2m · 5m · 10m</div><div id="next" class="info">Leyendo cola…</div><p class="info">TikTok y Facebook reciben todos los formatos elegibles. YouTube recibe únicamente videos verticales elegibles como Shorts; nunca se envían videos horizontales o largos a YouTube. Facebook enlaza el video completo y la página principal. Los archivos se borran solo después de confirmar todos los destinos requeridos.</p><div class="workspace"><div class="tabs" role="tablist" aria-label="Panel de seguimiento"><button id="activityTab" class="tab" role="tab" aria-selected="true" aria-controls="activityPanel">Actividad en vivo</button><button id="chatTab" class="tab" role="tab" aria-selected="false" aria-controls="chatPanel">Chat y órdenes</button></div><section id="activityPanel" class="panel" role="tabpanel" aria-labelledby="activityTab"><h2>Qué está haciendo ahora</h2><p id="activityNow" class="muted">Esperando el primer reporte de la Mac…</p><div id="activity" class="activity" aria-live="polite"></div></section><section id="chatPanel" class="panel" role="tabpanel" aria-labelledby="chatTab" hidden><h2>Habla con el agente</h2><p class="muted">Ejemplos: “sube 3 videos más hoy”, “sube 12 por día” o pega una URL de YouTube.</p><div id="messages" class="messages"></div><form id="chatForm" class="composer"><input id="chatInput" aria-label="Orden para BlackRoom" maxlength="1000" placeholder="Escribe una orden para BlackRoom…"><button id="chatSend" type="submit" class="play">Enviar</button></form></section></div></section></main><script>
const byId=id=>document.getElementById(id),els={badge:byId('badge'),weeks:byId('weeks'),play:byId('play'),pause:byId('pause'),refresh:byId('refresh'),workNow:byId('workNow'),remainingPosts:byId('remainingPosts'),remainingBatches:byId('remainingBatches'),remainingTime:byId('remainingTime'),agentProgress:byId('agentProgress'),progressStatus:byId('progressStatus'),progressPercent:byId('progressPercent'),progressTrack:byId('progressTrack'),progressFill:byId('progressFill'),progressDetail:byId('progressDetail'),device:byId('device'),experiment:byId('experiment'),next:byId('next'),activityTab:byId('activityTab'),chatTab:byId('chatTab'),activityPanel:byId('activityPanel'),chatPanel:byId('chatPanel'),activityNow:byId('activityNow'),activity:byId('activity'),messages:byId('messages'),chatForm:byId('chatForm'),chatInput:byId('chatInput'),chatSend:byId('chatSend')},ids=['queued','processing','retry','scheduled','completed'],durations=[15,30,60,120,300,600],labels={15:'15s',30:'30s',60:'60s',120:'2m',300:'5m',600:'10m'};let mutationBusy=false,requestGeneration=0,renderedActivityIds=new Set();els.activity.setAttribute('role','log');els.activity.setAttribute('aria-relevant','additions');els.activity.setAttribute('aria-atomic','false');async function req(path,opt={}){const r=await fetch(path,{credentials:'same-origin',...opt}),contentType=r.headers.get('content-type')||'',d=contentType.includes('application/json')?await r.json():{};if(!r.ok){if(r.status===401)throw new Error('Tu sesión expiró. Abre BlackOps, inicia sesión y vuelve a este panel.');throw new Error(d.error||('Error HTTP '+r.status))}return d}function renderChat(history=[]){els.messages.replaceChildren(...history.map(item=>{const node=document.createElement('div');node.className='msg '+item.role;node.textContent=item.text;return node}));els.messages.scrollTop=els.messages.scrollHeight}function activityNode(item){const node=document.createElement('article'),head=document.createElement('div'),stage=document.createElement('span'),time=document.createElement('time'),message=document.createElement('p');node.dataset.eventId=item.id||item.createdAt||item.message;node.className='event '+(item.level||'info');head.className='event-head';stage.textContent=item.stage||'sistema';time.dateTime=item.createdAt||'';time.textContent=item.createdAt?new Date(item.createdAt).toLocaleTimeString('es-US',{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'';message.textContent=item.message||'';head.append(stage,time);node.append(head,message);return node}function renderActivity(history=[]){const currentIds=new Set(history.map(item=>item.id||item.createdAt||item.message).filter(Boolean));for(const node of els.activity.querySelectorAll('[data-event-id]'))if(!currentIds.has(node.dataset.eventId))node.remove();const additions=history.filter(item=>{const id=item.id||item.createdAt||item.message;return id&&!renderedActivityIds.has(id)});if(history.length){els.activity.querySelector('[data-empty]')?.remove();for(const item of additions)els.activity.prepend(activityNode(item))}else if(!els.activity.querySelector('[data-empty]')){const empty=document.createElement('p');empty.dataset.empty='true';empty.className='muted';empty.textContent='Aún no hay eventos. El primer trabajo aparecerá aquí automáticamente.';els.activity.append(empty)}renderedActivityIds=currentIds}function selectTab(name,moveFocus=false){const activity=name==='activity',selected=activity?els.activityTab:els.chatTab;els.activityTab.setAttribute('aria-selected',String(activity));els.chatTab.setAttribute('aria-selected',String(!activity));els.activityTab.tabIndex=activity?0:-1;els.chatTab.tabIndex=activity?-1:0;els.activityPanel.hidden=!activity;els.chatPanel.hidden=activity;if(moveFocus)selected.focus()}function lastSignalText(remote){const seenAt=remote.device?.seenAt,time=seenAt?new Date(seenAt).getTime():NaN;if(!Number.isFinite(time))return 'sin señal todavía';const seconds=Math.max(0,Math.floor((Date.now()-time)/1000));if(seconds<60)return 'última señal hace '+seconds+'s';const minutes=Math.floor(seconds/60);return 'última señal hace '+minutes+'m'}function remainingTimeLabel(progress,enabled,online){if(!progress?.remainingPosts)return 'Todo preparado';if(!enabled)return 'Pausado';const days=Math.max(1,Number(progress.remainingCalendarDays||progress.remainingDays)||1),date=progress.estimatedFinishDate?new Date(progress.estimatedFinishDate+'T12:00:00').toLocaleDateString('es-US',{month:'short',day:'numeric'}):'';return (online?'':'Al encender · ')+days+' día'+(days===1?'':'s')+(date?' · hasta '+date:'')}function renderProgress(s,remote,desired,workerRunning,remainingPosts){const scheduled=Math.max(0,Number(s.totals?.scheduled)||0),total=scheduled+remainingPosts,percent=remainingPosts===0?100:total?Math.min(99,Math.max(0,Math.round(scheduled/total*100))):0,signal=lastSignalText(remote),status=workerRunning?'Procesando un video ahora':desired&&remote.online?'Activo · esperando el próximo lote':desired?'Activo · se reanuda al encender la Mac':'Agente pausado',mode=workerRunning?'processing':desired&&remote.online?'waiting':desired?'offline':'paused',generationSynced=Number(remote.device?.appliedGeneration||0)>=Number(remote.generation||0);els.agentProgress.className='agent-progress '+mode;els.progressStatus.lastElementChild.textContent=status;els.progressPercent.textContent=percent+'%';els.progressTrack.setAttribute('aria-valuenow',String(percent));els.progressTrack.setAttribute('aria-valuetext',scheduled+' de '+total+' posts preparados');els.progressFill.style.width=percent+'%';els.progressDetail.textContent=remainingPosts?'Agenda preparada: '+scheduled+'/'+total+' posts · faltan '+remainingPosts+' · '+signal:'Todos los posts de esta cola están preparados · '+signal;els.workNow.hidden=!(desired&&remote.online&&generationSynced&&!workerRunning&&remainingPosts>0)}function render(d){const s=d.agent,remote=d.remote||{},worker=remote.device?.worker||{},desired=Boolean(remote.desiredEnabled),workerRunning=Boolean(worker.running||worker.workerPid||worker.pid),synced=remote.online&&Number(remote.device?.appliedGeneration||0)>=Number(remote.generation||0)&&Boolean(s.enabled)===desired&&(desired||!workerRunning),working=desired&&synced,pausing=!desired&&remote.online&&!synced,historyComplete=Object.values(s.analytics?.historyCompleteByNetwork||{}).filter(Boolean).length,attribution=Object.values(s.analytics?.attributionByNetwork||{}),attributed=attribution.reduce((sum,item)=>sum+(item.matchedRecords||0),0),measured=attribution.reduce((sum,item)=>sum+(item.totalRecords||0),0),learning=Object.entries(s.analytics?.networkConfidence||{}).map(([network,state])=>network+': '+(state==='learning'?'aprendiendo':'recolectando')).join(' · '),pendingBatches=(s.totals.queued||0)+(s.totals.processing||0)+(s.totals.retry||0),remainingPosts=s.progress?.remainingPosts??pendingBatches*(s.postsPerDay||5),remainingBatches=s.progress?.remainingBatches??pendingBatches;els.badge.textContent=working?'Trabajando de verdad':desired?'Orden en cola':pausing?'Pausando…':'Pausado';els.badge.className='badge'+(working?' on':'');els.play.hidden=desired||pausing;els.pause.hidden=!desired;els.weeks.disabled=desired||pausing||mutationBusy;ids.forEach(id=>byId(id).textContent=s.totals[id]||0);els.remainingPosts.textContent=remainingPosts;els.remainingBatches.textContent=remainingBatches;els.remainingTime.textContent=remainingTimeLabel({...s.progress,remainingPosts,remainingDays:s.progress?.remainingDays??remainingBatches,remainingCalendarDays:s.progress?.remainingCalendarDays??remainingBatches},desired,remote.online);renderProgress(s,remote,desired,workerRunning,remainingPosts);els.device.textContent=synced?(workerRunning?'● Mac conectada · trabajador activo':'● Mac conectada · esperando próximo trabajo'):remote.online?'◌ Mac conectada · aplicando orden…':'○ Mac desconectada · la orden quedará en cola hasta que se encienda';els.activityNow.textContent=workerRunning?'Procesando un trabajo ahora mismo. Revisa el evento más reciente abajo.':desired&&remote.online?'Mac conectada y esperando el siguiente trabajo disponible.':desired?'El agente está activado, pero la Mac está desconectada.':'El agente está pausado.';els.experiment.textContent='Objetivo: '+(s.postsPerDay||10)+'/día · '+durations.map(x=>labels[x]+': '+(s.durationSamples[x]||0)).join(' · ')+' · técnica CEO: '+(s.analytics?.creativeStrategy||'drop_first')+' · mediana TikTok: '+(s.analytics?.tiktokMedianViews||0)+' · historial: '+(s.analytics?.sampleCount||0)+' posts · atribuidos: '+attributed+'/'+measured+' · '+historyComplete+'/3 redes completas'+(learning?' · '+learning:'')+' · '+s.usedSourceVideos+' videos únicos'+(s.pendingPrioritySources?' · '+s.pendingPrioritySources+' URL prioritaria':'');els.next.textContent=s.nextJob?'Próximo lote: '+s.nextJob.targetDate+' · '+s.nextJob.status+(s.nextJob.lastError?' · último reintento registrado':''):'Pulsa Iniciar agente para comenzar.';renderActivity(worker.activity||[]);renderChat(remote.chatHistory)}function disableActions(value){els.play.disabled=value;els.pause.disabled=value;els.refresh.disabled=value;els.workNow.disabled=value;els.chatInput.disabled=value;els.chatSend.disabled=value}async function refreshStatus(){if(mutationBusy)return;const generation=++requestGeneration;try{const data=await req('/api/blackroom-agent');if(generation===requestGeneration)render(data)}catch(error){if(generation===requestGeneration)els.next.textContent=error.message}}async function mutate(path,opt){if(mutationBusy)return;mutationBusy=true;disableActions(true);const generation=++requestGeneration;try{const data=await req(path,opt);if(generation===requestGeneration)render(data)}catch(error){if(generation===requestGeneration)els.next.textContent=error.message}finally{mutationBusy=false;disableActions(false)}}els.activityTab.onclick=()=>selectTab('activity');els.chatTab.onclick=()=>selectTab('chat');for(const tab of [els.activityTab,els.chatTab])tab.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const activity=event.key==='Home'||(event.key==='ArrowLeft'&&tab===els.chatTab)||(event.key==='ArrowRight'&&tab===els.chatTab);selectTab(activity?'activity':'chat',true)});els.play.onclick=()=>mutate('/api/blackroom-agent/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({weeks:Number(els.weeks.value)})});els.pause.onclick=()=>mutate('/api/blackroom-agent/pause',{method:'POST'});els.workNow.onclick=()=>mutate('/api/blackroom-agent/work-now',{method:'POST'});els.refresh.onclick=()=>refreshStatus();els.chatForm.onsubmit=async e=>{e.preventDefault();const message=els.chatInput.value.trim();if(!message||mutationBusy)return;mutationBusy=true;disableActions(true);const generation=++requestGeneration;els.next.textContent='Enviando orden…';try{const d=await req('/api/blackroom-agent/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message})});if(generation===requestGeneration){els.chatInput.value='';renderChat(d.remote.chatHistory);els.next.textContent=d.reply}}catch(error){if(generation===requestGeneration)els.next.textContent=error.message}finally{mutationBusy=false;disableActions(false);els.chatInput.focus()}};selectTab('activity');refreshStatus();setInterval(()=>refreshStatus(),5000);
</script></body></html>`;

export const blackRoomPage = blackRoomPageTemplate
  .replace('function render(d){', blackRoomLearningPanelScript + 'function render(d){renderLearning(d);')
  .replace('<div id="device" class="info">', blackRoomLearningPanelHtml + '<div id="device" class="info">')
  .replace('<option value="1">1 semana</option>', '')
  .replace('videos sin repetir', 'segmentos sin repetir ni solapar')
  .replace('<div id="device" class="info">', '<section id="agentProgress" class="agent-progress" aria-label="Progreso del agente"><div class="agent-progress-head"><div id="progressStatus" class="agent-progress-status"><span class="live-dot" aria-hidden="true"></span><span>Comprobando actividad…</span></div><strong id="progressPercent">0%</strong></div><div id="progressTrack" class="progress-track" role="progressbar" aria-label="Posts preparados" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div id="progressFill" class="progress-fill"></div></div><div id="progressDetail" class="progress-detail">Calculando el progreso de la campaña…</div><button id="workNow" class="play agent-progress-action" type="button" hidden>▶ Trabajar ahora</button></section><div id="device" class="info">');

export function registerBlackRoomControlRoutes(app: Express): void {
  app.get("/blackroom", async (req, res) => {
    try {
      if (!await hasBlackRoomChatAccess(req)) return res.status(403).type("text").send("BlackRoom está disponible solo para el owner.");
      res.type("html").set("Cache-Control", "no-store").send(blackRoomPage);
    } catch (error: any) {
      const status = Number(error?.status) === 401 ? 401 : 500;
      res.status(status).type("text").send(status === 401 ? "Tu sesión expiró. Inicia sesión nuevamente." : "No se pudo abrir BlackRoom.");
    }
  });
  app.get("/api/blackroom-agent", async (req, res) => {
    try {
      if (!await hasBlackRoomChatAccess(req) && !await hasBlackRoomPartnerAccess(req)) return res.status(403).json({ error: "Solo Robert y sus socios pueden ver el agente de BlackRoom." });
      const remote = await readBlackRoomRemoteControl();
      const remoteQueue = remote.device?.queue as Record<string, any> | undefined;
      const localQueue = await readBlackRoomPanelQueue(remoteQueue);
      res.json({ agent: resolveBlackRoomPanelAgent(localQueue, remoteQueue, isBlackRoomRemoteDeviceOnline(remote)), remote: remoteView(remote), operations: buildBlackRoomOfficeOperations(remote) });
    }
    catch (error: any) { res.status(500).json({ error: error.message || "Failed to read BlackRoom agent" }); }
  });
  app.post("/api/blackroom-agent/analytics/refresh", async (req, res) => {
    try {
      if (!await hasBlackRoomChatAccess(req)) return res.status(403).json({ error: "Solo el owner puede actualizar los analytics de BlackRoom." });
      await refreshBlackRoomCeo(true);
      const remote = await readBlackRoomRemoteControl();
      res.json({ remote: remoteView(remote) });
    } catch (error: any) { res.status(502).json({ error: error.message || "No pude actualizar los analytics de Metricool" }); }
  });
  app.post("/api/blackroom-agent/analytics/import", async (req, res) => {
    if (!hasValidBlackRoomRemoteToken(req.get("authorization"))) {
      return res.status(401).json({ error: "Invalid BlackRoom device token" });
    }
    const imports = Array.isArray(req.body?.imports) ? req.body.imports : [];
    if (!imports.length || imports.length > 6) {
      return res.status(400).json({ error: "Send between one and six Metricool CSV imports" });
    }
    const acceptedNetworks = new Set<BlackRoomAnalyticsNetwork>(["tiktok", "facebook", "youtube"]);
    const normalized = imports.map((input: any) => ({
      network: String(input?.network || "") as BlackRoomAnalyticsNetwork,
      sourceFiles: Array.isArray(input?.sourceFiles) ? input.sourceFiles.slice(0, 20) : [],
      samples: Array.isArray(input?.samples) ? input.samples : [],
    }));
    if (normalized.some((input: { network: BlackRoomAnalyticsNetwork; samples: unknown[] }) =>
      !acceptedNetworks.has(input.network) || input.samples.length > 2_000)) {
      return res.status(400).json({ error: "Invalid network or too many CSV samples" });
    }
    try {
      let totals = { tiktok: 0, facebook: 0, youtube: 0 };
      await mutateBlackRoomRemoteControl((state) => {
        totals = upsertBlackRoomAnalyticsImports(state, normalized);
      });
      res.status(202).json({ accepted: true, totals });
      void refreshBlackRoomCeo(true).catch((error) => {
        console.error("[blackroom-ceo] CSV analytics refresh failed:", error instanceof Error ? error.message : error);
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to import Metricool CSV analytics" });
    }
  });
  app.post("/api/blackroom-agent/start", async (req, res) => {
    try {
      if (!await hasBlackRoomChatAccess(req)) return res.status(403).json({ error: "Solo el owner puede iniciar el agente de BlackRoom." });
      const state = await withBlackRoomQueueLock(BLACKROOM_QUEUE_PATH, async () => {
        const current = await readBlackRoomQueue();
        startBlackRoomAgent(current, Number(req.body?.weeks || 2));
        await writeBlackRoomQueue(current);
        return current;
      });
      const remote = await mutateBlackRoomRemoteControl((current) => setBlackRoomRemoteCommand(current, true, Number(req.body?.weeks || 2)));
      res.json({ agent: summarizeBlackRoomQueue(state), remote: remoteView(remote) });
      void refreshBlackRoomCeo().catch((error) => console.error("[blackroom-ceo] analytics refresh failed:", error instanceof Error ? error.message : error));
    } catch (error: any) { res.status(500).json({ error: error.message || "Failed to start BlackRoom agent" }); }
  });
  app.post("/api/blackroom-agent/pause", async (req, res) => {
    try {
      if (!await hasBlackRoomChatAccess(req)) return res.status(403).json({ error: "Solo el owner puede pausar el agente de BlackRoom." });
      const state = await withBlackRoomQueueLock(BLACKROOM_QUEUE_PATH, async () => {
        const current = await readBlackRoomQueue();
        pauseBlackRoomAgent(current);
        await writeBlackRoomQueue(current);
        return current;
      });
      const remote = await mutateBlackRoomRemoteControl((current) => setBlackRoomRemoteCommand(current, false));
      res.json({ agent: summarizeBlackRoomQueue(state), remote: remoteView(remote) });
    } catch (error: any) { res.status(500).json({ error: error.message || "Failed to pause BlackRoom agent" }); }
  });
  app.post("/api/blackroom-agent/work-now", async (req, res) => {
    try {
      if (!await hasBlackRoomChatAccess(req)) return res.status(403).json({ error: "Solo el owner puede adelantar el próximo lote de BlackRoom." });
      const remote = await mutateBlackRoomRemoteControl((current) => appendBlackRoomWorkNowCommand(current));
      res.json({ agent: summarizeBlackRoomQueue(await readBlackRoomQueue()), remote: remoteView(remote) });
    } catch (error: any) { res.status(500).json({ error: error.message || "Failed to start the next BlackRoom batch" }); }
  });
  app.post("/api/blackroom-agent/chat", async (req, res) => {
    try {
      const message = String(req.body?.message || "").trim();
      if (!message || message.length > 1_000) return res.status(400).json({ error: "Escribe un mensaje de hasta 1,000 caracteres." });
      const isOwner = await hasBlackRoomChatAccess(req);
      if (!isOwner && !await hasBlackRoomPartnerAccess(req)) return res.status(403).json({ error: "Solo Robert y sus socios pueden hablar con el agente de BlackRoom." });
      // Partners cannot start/pause the agent or add posts from the chat (Publicador approval stays the only path).
      const result = await executeBlackRoomChatMessage(message, { actorRole: isOwner ? "owner" : "partner" });
      res.json({ reply: result.reply, command: result.command, remote: remoteView(result.remote) });
    } catch (error: any) { res.status(500).json({ error: error.message || "No pude procesar la orden de BlackRoom" }); }
  });
  app.get("/api/blackroom-agent/remote", async (req, res) => {
    if (!hasValidBlackRoomRemoteToken(req.get("authorization"))) return res.status(401).json({ error: "Invalid BlackRoom device token" });
    try { res.json({ control: remoteView(await readBlackRoomRemoteControl()) }); }
    catch (error: any) { res.status(500).json({ error: error.message || "Failed to read remote command" }); }
  });
  app.post("/api/blackroom-agent/remote", async (req, res) => {
    if (!hasValidBlackRoomRemoteToken(req.get("authorization"))) return res.status(401).json({ error: "Invalid BlackRoom device token" });
    try {
      const remote = await mutateBlackRoomRemoteControl((current) => {
        recordBlackRoomRemoteHeartbeat(current, {
          deviceId: req.body?.deviceId,
          queue: req.body?.queue,
          worker: req.body?.worker,
          lastError: req.body?.lastError,
          appliedGeneration: req.body?.appliedGeneration,
        });
        if (Array.isArray(req.body?.publicationExperiments)) {
          req.body.publicationExperiments.slice(-2_000)
            .forEach((experiment: any) => recordBlackRoomPublicationExperiment(current, experiment));
        }
      });
      res.json({ control: remoteView(remote) });
    } catch (error: any) { res.status(500).json({ error: error.message || "Failed to record device heartbeat" }); }
  });
  app.put("/api/blackroom-agent/media/:reservationId", async (req, res) => {
    if (!hasValidBlackRoomRemoteToken(req.get("authorization"))) return res.status(401).json({ error: "Invalid BlackRoom device token" });
    const reservationId = String(req.params.reservationId || "").trim();
    if (!reservationId || reservationId.length > 300 || !req.is("application/octet-stream")) {
      return res.status(400).json({ error: "A reservation id and MP4 body are required" });
    }
    const declaredSize = Number(req.get("content-length") || 0);
    if (declaredSize > BLACKROOM_UPLOAD_MAX_BYTES) return res.status(413).json({ error: "BlackRoom upload exceeds Metricool's 500 MB limit" });
    cleanupExpiredBlackRoomUploads();
    const uploadId = randomUUID();
    const filePath = path.join(blackRoomUploadDir, `${uploadId}.mp4`);
    try {
      await mkdir(blackRoomUploadDir, { recursive: true });
      const bytes = await receiveBlackRoomUpload(req, filePath);
      if (bytes === 0) { await unlink(filePath).catch(() => undefined); return res.status(400).json({ error: "MP4 body is empty" }); }
      blackRoomUploads.set(uploadId, { filePath, reservationId, expiresAt: Date.now() + BLACKROOM_UPLOAD_TTL_MS, ready: true });
      const publicOrigin = `${req.protocol}://${req.get("host")}`;
      res.status(201).json({ uploadId, mediaUrl: `${publicOrigin}/api/blackroom-agent/media/${uploadId}.mp4` });
    } catch (error: any) {
      await unlink(filePath).catch(() => undefined);
      res.status(error?.status || 500).json({ error: error?.message || "BlackRoom upload failed" });
    }
  });
  app.post("/api/blackroom-agent/media/chunked", async (req, res) => {
    if (!hasValidBlackRoomRemoteToken(req.get("authorization"))) return res.status(401).json({ error: "Invalid BlackRoom device token" });
    const reservationId = String(req.body?.reservationId || "").trim();
    const totalBytes = Number(req.body?.totalBytes);
    const totalChunks = Number(req.body?.totalChunks);
    const expectedChunks = Math.ceil(totalBytes / BLACKROOM_UPLOAD_CHUNK_BYTES);
    if (!reservationId || reservationId.length > 300 || !Number.isSafeInteger(totalBytes) || totalBytes <= 0 || totalBytes > BLACKROOM_UPLOAD_MAX_BYTES || !Number.isSafeInteger(totalChunks) || totalChunks !== expectedChunks) {
      return res.status(400).json({ error: "Valid reservationId, totalBytes, and 4 MB chunk count are required" });
    }
    cleanupExpiredBlackRoomUploads();
    const uploadId = randomUUID();
    const filePath = path.join(blackRoomUploadDir, `${uploadId}.mp4`);
    try {
      await mkdir(blackRoomUploadDir, { recursive: true });
      await writeFile(filePath, Buffer.alloc(0), { flag: "wx" });
      blackRoomUploads.set(uploadId, {
        filePath, reservationId, totalBytes, totalChunks, nextChunk: 0, chunkSizes: [], ready: false,
        expiresAt: Date.now() + BLACKROOM_UPLOAD_TTL_MS,
      });
      res.status(201).json({ uploadId, chunkBytes: BLACKROOM_UPLOAD_CHUNK_BYTES });
    } catch (error: any) {
      await unlink(filePath).catch(() => undefined);
      res.status(500).json({ error: error?.message || "BlackRoom chunked upload initialization failed" });
    }
  });
  app.put("/api/blackroom-agent/media/chunked/:uploadId/:index", async (req, res) => {
    if (!hasValidBlackRoomRemoteToken(req.get("authorization"))) return res.status(401).json({ error: "Invalid BlackRoom device token" });
    const uploadId = String(req.params.uploadId || "");
    const index = Number(req.params.index);
    const upload = blackRoomUploads.get(uploadId);
    const declaredSize = Number(req.get("content-length") || 0);
    if (!upload || upload.ready) return res.status(404).json({ error: "BlackRoom chunked upload not found" });
    if (!req.is("application/octet-stream") || !Number.isSafeInteger(index) || index < 0 || index >= Number(upload.totalChunks) || !Number.isSafeInteger(declaredSize) || declaredSize <= 0 || declaredSize > BLACKROOM_UPLOAD_CHUNK_BYTES) {
      return res.status(400).json({ error: "A valid 4 MB upload chunk is required" });
    }
    if (index < Number(upload.nextChunk)) {
      if (upload.chunkSizes?.[index] === declaredSize) return res.json({ uploadId, index, accepted: true, duplicate: true });
      return res.status(409).json({ error: "BlackRoom upload chunk conflicts with an accepted chunk" });
    }
    if (index !== upload.nextChunk) return res.status(409).json({ error: "BlackRoom upload chunks must arrive in order" });
    const partPath = `${upload.filePath}.${index}.part`;
    try {
      const bytes = await receiveBlackRoomUploadChunk(req, partPath);
      if (bytes !== declaredSize || Number(upload.totalBytes) < (upload.chunkSizes || []).reduce((sum, size) => sum + size, 0) + bytes) {
        await unlink(partPath).catch(() => undefined);
        return res.status(400).json({ error: "BlackRoom upload chunk size does not match its declaration" });
      }
      await pipeline(createReadStream(partPath), createWriteStream(upload.filePath, { flags: "a" }));
      await unlink(partPath).catch(() => undefined);
      upload.chunkSizes?.push(bytes);
      upload.nextChunk = index + 1;
      upload.expiresAt = Date.now() + BLACKROOM_UPLOAD_TTL_MS;
      res.status(201).json({ uploadId, index, accepted: true });
    } catch (error: any) {
      await unlink(partPath).catch(() => undefined);
      res.status(error?.status || 500).json({ error: error?.message || "BlackRoom upload chunk failed" });
    }
  });
  app.post("/api/blackroom-agent/media/chunked/:uploadId/complete", async (req, res) => {
    if (!hasValidBlackRoomRemoteToken(req.get("authorization"))) return res.status(401).json({ error: "Invalid BlackRoom device token" });
    const uploadId = String(req.params.uploadId || "");
    const upload = blackRoomUploads.get(uploadId);
    if (!upload || upload.ready) return res.status(404).json({ error: "BlackRoom chunked upload not found" });
    const info = await stat(upload.filePath).catch(() => null);
    if (!info?.isFile() || upload.nextChunk !== upload.totalChunks || info.size !== upload.totalBytes) {
      return res.status(409).json({ error: "BlackRoom chunked upload is incomplete" });
    }
    upload.ready = true;
    upload.expiresAt = Date.now() + BLACKROOM_UPLOAD_TTL_MS;
    const publicOrigin = `${req.protocol}://${req.get("host")}`;
    res.json({ uploadId, mediaUrl: `${publicOrigin}/api/blackroom-agent/media/${uploadId}.mp4` });
  });
  // Register the extension-specific route first; the generic parameter route
  // would otherwise capture `.mp4` as part of the upload id.
  for (const mediaPath of BLACKROOM_PUBLIC_MEDIA_PATHS) {
    app.get(mediaPath, serveBlackRoomMedia);
    app.head(mediaPath, serveBlackRoomMedia);
  }
  app.post("/api/blackroom-agent/metricool/schedule", async (req, res) => {
    if (!hasValidBlackRoomRemoteToken(req.get("authorization"))) return res.status(401).json({ error: "Invalid BlackRoom device token" });
    const uploadId = String(req.body?.uploadId || "");
    const reservationId = String(req.body?.reservationId || "");
    const verifyOnly = req.body?.verifyOnly === true;
    const network = String(req.body?.network || "");
    if (!['tiktok', 'facebook', 'youtube'].includes(network)) return res.status(400).json({ error: "Invalid BlackRoom Metricool network" });
    const upload = verifyOnly ? null : blackRoomUploads.get(uploadId);
    if (!verifyOnly && (!upload?.ready || upload.reservationId !== reservationId)) return res.status(404).json({ error: "BlackRoom upload not found" });
    // Pin before IO, including in-flight requests. Release only after a receipt.
    if (upload) upload.retainForReconciliation = true;
    let confirmedReceipt: BlackRoomMetricoolReceipt | undefined;
    try {
      const publicOrigin = `${req.protocol}://${req.get("host")}`;
      const receipt = await scheduleBlackRoomMetricoolPost({
        caption: String(req.body?.caption || ""),
        jobId: String(req.body?.jobId || ""),
        language: req.body?.language === "es" ? "es" : "en",
        sourceVideoId: String(req.body?.sourceVideoId || ""),
        durationSeconds: Number(req.body?.durationSeconds),
        videoFormat: req.body?.videoFormat === "horizontal" ? "horizontal" : "vertical",
        creativeStrategy: req.body?.creativeStrategy,
        publicationDateTime: String(req.body?.publicationDateTime || ""),
        timezone: String(req.body?.timezone || "America/New_York"),
        mediaUrl: verifyOnly ? "https://localhost.invalid/blackroom-verification-only.mp4" : `${publicOrigin}/api/blackroom-agent/media/${uploadId}.mp4`,
      }, { verifyOnly, networks: [network as "tiktok" | "facebook" | "youtube"],
        readPublicationControl: async () => ({
          desiredEnabled: (await readExistingBlackRoomRemoteControl())?.desiredEnabled,
          queue: await readBlackRoomQueue(),
        }),
      });
      confirmedReceipt = receipt;
      const receiptId = String(receipt.platformReceipts?.[network as "tiktok" | "facebook" | "youtube"] || receipt.metricoolId || "").trim();
      if (receiptId) {
        await mutateBlackRoomRemoteControl((state) => recordBlackRoomPublicationExperiment(state, {
          metricoolId: receiptId,
          reservationId,
          network,
          creativeStrategy: ["drop_first", "instant_drop", "build_then_drop"].includes(String(req.body?.creativeStrategy))
            ? req.body.creativeStrategy : "drop_first",
          durationSeconds: Number(req.body?.durationSeconds),
          format: req.body?.videoFormat === "horizontal" ? "horizontal" : "vertical",
          language: req.body?.language === "es" ? "es" : "en",
          slot: String(req.body?.publicationDateTime || "").slice(11, 16),
          publishedAt: String(req.body?.publicationDateTime || ""),
          dj: String(req.body?.dj || "unknown").slice(0, 120),
          sourceVideoId: String(req.body?.sourceVideoId || "").slice(0, 120),
        }));
      }
      if (!verifyOnly) await removeBlackRoomUpload(uploadId);
      res.status(201).json({ receipt });
    } catch (error: any) {
      // Auxiliary persistence/cleanup cannot turn a confirmed receipt into a
      // rejection: doing so would instruct the device to publish it again.
      if (confirmedReceipt) {
        res.status(201).json({ receipt: confirmedReceipt, warning: "Publication verified; auxiliary persistence or cleanup pending" });
        return;
      }
      const uncertain = error instanceof BlackRoomMetricoolUncertainError || error?.uncertain === true;
      const blocked = error instanceof BlackRoomPublicationBlockedError;
      if (!verifyOnly && !uncertain && !blocked) await removeBlackRoomUpload(uploadId);
      res.status(uncertain ? 409 : blocked ? 423 : 502).json({
        error: error.message || "Metricool scheduling failed", uncertain,
        ...(uncertain ? { platformReceipts: error.platformReceipts || {} } : {}),
        ...(blocked ? { blocked: true, retainAttempt: true, definitelyNotSubmitted: true } : {}),
      });
    }
  });
  const ceoTimer = setInterval(() => {
    void refreshBlackRoomCeo().catch((error) => console.error("[blackroom-ceo] analytics refresh failed:", error instanceof Error ? error.message : error));
  }, 60 * 60_000);
  ceoTimer.unref();
}
