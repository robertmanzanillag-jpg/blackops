import { eq, sql } from "drizzle-orm";
import { strictBlackRoomEnabled } from "./blackroom-publication-guard";
import { blackRoomRemoteControl } from "@shared/schema";
import type { BlackRoomRemoteCommand } from "./blackroom-chat";
import type { BlackRoomPublicationExperiment } from "./blackroom-growth-ceo";
import { captureLearningSnapshots, type LearningObservation, type LearningSnapshot } from "./blackroom-learning-observations";
import { canonicalLearningPostId } from "./blackroom-verified-learning";

export const BLACKROOM_REMOTE_ONLINE_WINDOW_MS = 90_000;
const BLACKROOM_REMOTE_CONTROL_ID = "blackroom-primary";
let initializationPromise: Promise<void> | undefined;

export interface BlackRoomRemoteDeviceStatus {
  deviceId: string;
  seenAt: string;
  queue: Record<string, unknown>;
  worker: Record<string, unknown>;
  lastError: string | null;
  appliedGeneration: number;
}

export interface BlackRoomActivityEvent {
  id: string;
  createdAt: string;
  stage: string;
  level: "info" | "success" | "error";
  message: string;
}

export type BlackRoomAnalyticsNetwork = "tiktok" | "facebook" | "youtube";

export interface BlackRoomImportedAnalyticsSample {
  id: string;
  views: number;
  observedAt?: string;
  learningReference?: string;
  publishedAt?: string;
  durationSeconds?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  reach?: number;
  impressions?: number;
  averageWatchSeconds?: number;
  completionRate?: number;
  engagementRate?: number;
}

export interface BlackRoomAnalyticsImport {
  samples: BlackRoomImportedAnalyticsSample[];
  sourceFiles: string[];
  importedAt: string;
}

export interface BlackRoomRemoteControlState {
  version: 1;
  desiredEnabled: boolean;
  weeks: number;
  generation: number;
  updatedAt: string;
  device: BlackRoomRemoteDeviceStatus | null;
  commands: BlackRoomRemoteCommand[];
  chatHistory: Array<{ id: string; role: "user" | "assistant"; text: string; createdAt: string }>;
  analyticsImports: Partial<Record<BlackRoomAnalyticsNetwork, BlackRoomAnalyticsImport>>;
  learningSnapshots?: LearningSnapshot[];
  publicationExperiments: BlackRoomPublicationExperiment[];
}

export function createBlackRoomRemoteControlState(now = new Date()): BlackRoomRemoteControlState {
  return {
    version: 1,
    desiredEnabled: false,
    weeks: 2,
    generation: 0,
    updatedAt: now.toISOString(),
    device: null,
    commands: [],
    chatHistory: [],
    analyticsImports: {},
    learningSnapshots: [],
    publicationExperiments: [],
  };
}

export function recordBlackRoomPublicationExperiment(
  state: BlackRoomRemoteControlState,
  experiment: BlackRoomPublicationExperiment,
): BlackRoomRemoteControlState {
  const strategy = ["drop_first", "instant_drop", "build_then_drop", "crowd_reaction_first", "context_open_loop"].includes(String(experiment.creativeStrategy))
    ? experiment.creativeStrategy : "drop_first";
  const finite = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : undefined;
  const normalized: BlackRoomPublicationExperiment = {
    metricoolId: String(experiment.metricoolId || "").trim(),
    platformPostId: String(experiment.platformPostId || "").trim().slice(0, 500),
    platformPostIdSource: experiment.platformPostIdSource === "reference" ? "reference" : "receipt",
    learningDecisionIds: String(experiment.learningDecisionIds || "").slice(0, 300),
    allocationMode: experiment.allocationMode === "exploit" ? "exploit" : "explore",
    learningTestId: String(experiment.learningTestId || "").trim().slice(0, 100),
    learningReference: /^BR-[a-f0-9]{12}$/.test(String(experiment.learningReference || "")) ? experiment.learningReference : undefined,
    reservationId: String(experiment.reservationId || "").trim(),
    network: String(experiment.network || "").trim(),
    creativeStrategy: strategy as BlackRoomPublicationExperiment["creativeStrategy"],
    durationSeconds: Math.max(0, Math.round(Number(experiment.durationSeconds || 0))),
    format: experiment.format === "horizontal" ? "horizontal" : "vertical",
    language: experiment.language === "es" ? "es" : "en",
    slot: String(experiment.slot || "").slice(0, 20),
    publishedAt: String(experiment.publishedAt || "").slice(0, 40),
    dj: String(experiment.dj || "unknown").slice(0, 100),
    sourceVideoId: String(experiment.sourceVideoId || "").slice(0, 200),
    sourceVideoTitle: String(experiment.sourceVideoTitle || "").slice(0, 300),
    ...(finite(experiment.segmentStartSeconds) !== undefined ? { segmentStartSeconds: finite(experiment.segmentStartSeconds) } : {}),
    ...(finite(experiment.segmentEndSeconds) !== undefined ? { segmentEndSeconds: finite(experiment.segmentEndSeconds) } : {}),
    ...(finite(experiment.dropOffsetSeconds) !== undefined ? { dropOffsetSeconds: finite(experiment.dropOffsetSeconds) } : {}),
    hookFamily: String(experiment.hookFamily || strategy).slice(0, 100),
    captionVariant: String(experiment.captionVariant || "legacy").slice(0, 100),
    creativeArmId: String(experiment.creativeArmId || `${experiment.network}:${strategy}:${experiment.language}:${experiment.format}:${experiment.durationSeconds}`).slice(0, 240),
  };
  if (!normalized.metricoolId || !normalized.reservationId || !normalized.network) return state;
  const existingIndex = state.publicationExperiments.findIndex((item) =>
    item.network === normalized.network && item.metricoolId === normalized.metricoolId);
  if (existingIndex >= 0) {
    if (!normalized.platformPostId) normalized.platformPostIdSource = state.publicationExperiments[existingIndex].platformPostIdSource;
    normalized.platformPostId ||= state.publicationExperiments[existingIndex].platformPostId;
    state.publicationExperiments[existingIndex] = normalized;
  }
  else state.publicationExperiments.push(normalized);
  state.publicationExperiments = state.publicationExperiments.slice(-2_000);
  return state;
}

/** A short unique campaign reference is included in new captions/exports. This
 * joins the scheduler receipt to the published platform ID without guessing
 * from time, DJ names, titles or a truncated video duration. */
export function reconcileBlackRoomPublishedIdentities(state: BlackRoomRemoteControlState): void {
  // Recompute derived joins: a later export can reveal an ambiguous reference.
  // Published receipt identities remain authoritative and are never erased here.
  for (const experiment of state.publicationExperiments) {
    if (experiment.platformPostIdSource === "reference") experiment.platformPostId = undefined;
  }
  for (const network of ["tiktok", "facebook", "youtube"] as const) {
    const references = new Map<string, Set<string>>();
    for (const sample of state.analyticsImports[network]?.samples || []) {
      if (!sample.learningReference) continue;
      const id = canonicalLearningPostId(network, sample.id);
      if (!id) continue;
      const ids = references.get(sample.learningReference) || new Set();
      ids.add(id); references.set(sample.learningReference, ids);
    }
    for (const [reference, ids] of references) {
      const experiments = state.publicationExperiments.filter((experiment) => experiment.network === network && experiment.learningReference === reference);
      if (ids.size !== 1 || experiments.length !== 1) continue;
      const id = [...ids][0];
      const experiment = experiments[0];
      if (!experiment.platformPostId) {
        experiment.platformPostId = id;
        experiment.platformPostIdSource = "reference";
      }
    }
  }
}

function normalizeImportedAnalyticsSample(value: unknown): BlackRoomImportedAnalyticsSample | null {
  const sample = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const id = String(sample.id || "").trim().slice(0, 500);
  if (sample.views === null || sample.views === undefined || sample.views === "" || typeof sample.views === "boolean") return null;
  const views = Math.floor(Number(sample.views));
  if (!id || !Number.isSafeInteger(views) || views < 0) return null;
  const rawPublishedAt = String(sample.publishedAt || "").trim();
  const publishedAt = rawPublishedAt && Number.isFinite(new Date(rawPublishedAt).getTime())
    ? rawPublishedAt.slice(0, 40)
    : undefined;
  const observedAt = typeof sample.observedAt === "string" && /(?:Z|[+-]\d{2}:\d{2})$/.test(sample.observedAt)
    && Number.isFinite(Date.parse(sample.observedAt)) ? sample.observedAt : undefined;
  const rawDuration = Math.round(Number(sample.durationSeconds));
  const durationSeconds = Number.isSafeInteger(rawDuration) && rawDuration > 0 && rawDuration <= 86_400
    ? rawDuration
    : undefined;
  const optionalMetric = (name: string, maximum = Number.MAX_SAFE_INTEGER) => {
    if (sample[name] === null || sample[name] === undefined || sample[name] === "" || typeof sample[name] === "boolean") return undefined;
    const number = Number(sample[name]);
    return Number.isFinite(number) && number >= 0 && number <= maximum ? number : undefined;
  };
  return {
    id, views,
    ...(observedAt ? { observedAt } : {}),
    ...(/^BR-[a-f0-9]{12}$/.test(String(sample.learningReference || "")) ? { learningReference: String(sample.learningReference) } : {}),
    ...(publishedAt ? { publishedAt } : {}),
    ...(durationSeconds ? { durationSeconds } : {}),
    ...Object.fromEntries([
      ["likes", optionalMetric("likes")], ["comments", optionalMetric("comments")],
      ["shares", optionalMetric("shares")], ["reach", optionalMetric("reach")],
      ["impressions", optionalMetric("impressions")], ["averageWatchSeconds", optionalMetric("averageWatchSeconds", 86_400)],
      ["completionRate", optionalMetric("completionRate", 1)], ["engagementRate", optionalMetric("engagementRate", 1)],
    ].filter((entry): entry is [string, number] => entry[1] !== undefined)),
  };
}

function normalizeAnalyticsImports(value: unknown): BlackRoomRemoteControlState["analyticsImports"] {
  const imports = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return Object.fromEntries((["tiktok", "facebook", "youtube"] as BlackRoomAnalyticsNetwork[]).flatMap((network) => {
    const raw = imports[network] && typeof imports[network] === "object"
      ? imports[network] as Record<string, unknown>
      : null;
    if (!raw) return [];
    const samples = Array.isArray(raw.samples)
      ? raw.samples.map(normalizeImportedAnalyticsSample).filter((sample): sample is BlackRoomImportedAnalyticsSample => Boolean(sample)).slice(-10_000)
      : [];
    const sourceFiles = Array.isArray(raw.sourceFiles)
      ? [...new Set(raw.sourceFiles.map((file) => String(file || "").trim().slice(0, 240)).filter(Boolean))].slice(-100)
      : [];
    const importedAt = String(raw.importedAt || "");
    return [[network, {
      samples,
      sourceFiles,
      importedAt: Number.isFinite(new Date(importedAt).getTime()) ? importedAt : new Date(0).toISOString(),
    }]];
  })) as BlackRoomRemoteControlState["analyticsImports"];
}

export function upsertBlackRoomAnalyticsImports(
  state: BlackRoomRemoteControlState,
  imports: Array<{ network: BlackRoomAnalyticsNetwork; sourceFiles?: string[]; samples: unknown[] }>,
  now = new Date(),
): Record<BlackRoomAnalyticsNetwork, number> {
  const totals = { tiktok: 0, facebook: 0, youtube: 0 };
  for (const input of imports) {
    const current = state.analyticsImports[input.network];
    const observations: LearningObservation[] = [];
    const byId = new Map((current?.samples || []).map((sample) => [sample.id, sample]));
    for (const value of input.samples.slice(0, 2_000)) {
      const sample = normalizeImportedAnalyticsSample(value);
      if (!sample) continue;
      if (sample.observedAt && Date.parse(sample.observedAt) > now.getTime()) continue;
      const existing = byId.get(sample.id);
      // An old export or un-timestamped replay must not replace a known newer observation.
      if (!existing?.observedAt || (sample.observedAt && Date.parse(sample.observedAt) >= Date.parse(existing.observedAt))) {
        byId.set(sample.id, sample);
      }
      if (sample.observedAt && sample.publishedAt) {
        const observation: LearningObservation = { ...sample, network: input.network, postId: sample.id,
          publishedAt: sample.publishedAt, observedAt: sample.observedAt };
        observations.push(observation);
      }
    }
    state.learningSnapshots = captureLearningSnapshots(state.learningSnapshots || [], observations, now).slice(-30_000);
    const samples = [...byId.values()]
      .sort((left, right) => String(left.publishedAt || "").localeCompare(String(right.publishedAt || "")))
      .slice(-10_000);
    const sourceFiles = [...new Set([
      ...(current?.sourceFiles || []),
      ...(input.sourceFiles || []).map((file) => String(file || "").split(/[\\/]/).pop() || ""),
    ].map((file) => file.trim().slice(0, 240)).filter(Boolean))].slice(-100);
    state.analyticsImports[input.network] = { samples, sourceFiles, importedAt: now.toISOString() };
    totals[input.network] = samples.length;
  }
  state.updatedAt = now.toISOString();
  reconcileBlackRoomPublishedIdentities(state);
  return totals;
}

export function setBlackRoomRemoteCommand(
  state: BlackRoomRemoteControlState,
  enabled: boolean,
  weeks = state.weeks,
  now = new Date(),
): BlackRoomRemoteControlState {
  state.desiredEnabled = enabled;
  state.weeks = Math.max(2, Math.min(4, Math.floor(Number.isFinite(weeks) ? weeks : 2)));
  state.generation += 1;
  state.updatedAt = now.toISOString();
  return state;
}

export function recordBlackRoomRemoteHeartbeat(
  state: BlackRoomRemoteControlState,
  input: Omit<BlackRoomRemoteDeviceStatus, "seenAt">,
  now = new Date(),
): BlackRoomRemoteControlState {
  const worker = input.worker && typeof input.worker === "object" ? input.worker as Record<string, unknown> : {};
  const activity = Array.isArray(worker.activity) ? worker.activity.slice(-80).map((item, index) => {
    const event = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const createdAt = String(event.createdAt || now.toISOString());
    return {
      id: String(event.id || `${createdAt}-${index}`).slice(0, 160),
      createdAt: Number.isFinite(new Date(createdAt).getTime()) ? createdAt : now.toISOString(),
      stage: String(event.stage || "sistema").slice(0, 80),
      level: (["info", "success", "error"].includes(String(event.level)) ? String(event.level) : "info") as BlackRoomActivityEvent["level"],
      message: String(event.message || "").trim().slice(0, 1_000),
    };
  }).filter((event) => event.message) : [];
  state.device = {
    deviceId: String(input.deviceId || "blackroom-mac").slice(0, 100),
    seenAt: now.toISOString(),
    queue: input.queue && typeof input.queue === "object" ? input.queue : {},
    worker: { ...worker, activity },
    lastError: input.lastError ? String(input.lastError).slice(0, 1_000) : null,
    appliedGeneration: Math.max(0, Math.floor(Number(input.appliedGeneration || 0))),
  };
  return state;
}

export function appendBlackRoomRemoteCommand(
  state: BlackRoomRemoteControlState,
  input: { message: string; reply: string; command: BlackRoomRemoteCommand | null },
  now = new Date(),
): BlackRoomRemoteControlState {
  const createdAt = now.toISOString();
  state.chatHistory.push(
    { id: `${createdAt}-user`, role: "user", text: input.message.slice(0, 1_000), createdAt },
    { id: `${createdAt}-assistant`, role: "assistant", text: input.reply.slice(0, 2_000), createdAt },
  );
  state.chatHistory = state.chatHistory.slice(-40);
  if (input.command) {
    state.commands.push(input.command);
    state.commands = state.commands.slice(-100);
    state.generation += 1;
    state.updatedAt = createdAt;
  }
  return state;
}

export function appendBlackRoomCeoCommand(
  state: BlackRoomRemoteControlState,
  command: Extract<BlackRoomRemoteCommand, { type: "ceo_schedule" }>,
): BlackRoomRemoteControlState {
  if (state.commands.some((item) => item.id === command.id)) return state;
  state.commands.push(command);
  state.commands = state.commands.slice(-100);
  state.generation += 1;
  state.updatedAt = command.createdAt;
  return state;
}

export function appendBlackRoomWorkNowCommand(
  state: BlackRoomRemoteControlState,
  now = new Date(),
): BlackRoomRemoteControlState {
  const createdAt = now.toISOString();
  state.commands.push({ id: `work-now-${createdAt}`, type: "work_now", createdAt });
  state.commands = state.commands.slice(-100);
  state.generation += 1;
  state.updatedAt = createdAt;
  return state;
}

export function isBlackRoomRemoteDeviceOnline(state: BlackRoomRemoteControlState, now = new Date()): boolean {
  if (!state.device?.seenAt) return false;
  const seenAt = new Date(state.device.seenAt).getTime();
  return Number.isFinite(seenAt) && now.getTime() - seenAt <= BLACKROOM_REMOTE_ONLINE_WINDOW_MS;
}

export function normalizeRemoteControlState(value: unknown): BlackRoomRemoteControlState {
  const parsed = value && typeof value === "object" ? value as Partial<BlackRoomRemoteControlState> : {};
  const normalized: BlackRoomRemoteControlState = {
    ...createBlackRoomRemoteControlState(),
    ...parsed,
    version: 1,
    desiredEnabled: strictBlackRoomEnabled(parsed.desiredEnabled),
    weeks: Math.max(2, Math.min(4, Math.floor(Number(parsed.weeks || 2)))),
    generation: Math.max(0, Math.floor(Number(parsed.generation || 0))),
    device: parsed.device || null,
    commands: Array.isArray(parsed.commands) ? parsed.commands.slice(-100) : [],
    chatHistory: Array.isArray(parsed.chatHistory) ? parsed.chatHistory.slice(-40) : [],
    analyticsImports: normalizeAnalyticsImports(parsed.analyticsImports),
    learningSnapshots: captureLearningSnapshots(Array.isArray(parsed.learningSnapshots) ? parsed.learningSnapshots.slice(-30_000) : [], [], new Date()),
    publicationExperiments: [],
  };
  if (Array.isArray(parsed.publicationExperiments)) {
    for (const experiment of parsed.publicationExperiments.slice(-2_000)) {
      recordBlackRoomPublicationExperiment(normalized, experiment as BlackRoomPublicationExperiment);
    }
  }
  reconcileBlackRoomPublishedIdentities(normalized);
  return normalized;
}

async function database() {
  return (await import("./db")).db;
}

export async function initializeBlackRoomRemoteControlPersistence(): Promise<void> {
  initializationPromise ??= database().then((db) => db.execute(sql`
      CREATE TABLE IF NOT EXISTS blackroom_remote_control (
        id varchar PRIMARY KEY,
        data jsonb NOT NULL,
        revision integer NOT NULL DEFAULT 1,
        updated_at timestamp NOT NULL DEFAULT now()
      )
    `)).then(() => undefined).catch((error) => {
      initializationPromise = undefined;
      throw error;
    });
  await initializationPromise;
}

export async function readBlackRoomRemoteControl(): Promise<BlackRoomRemoteControlState> {
  await initializeBlackRoomRemoteControlPersistence();
  const db = await database();
  const [row] = await db.select().from(blackRoomRemoteControl).where(eq(blackRoomRemoteControl.id, BLACKROOM_REMOTE_CONTROL_ID));
  return row ? normalizeRemoteControlState(row.data) : createBlackRoomRemoteControlState();
}

/** Existing state only. Never initializes a table or creates a default row.
 * A missing table rejects; a missing row returns null. Neither authorizes work.
 */
export async function readExistingBlackRoomRemoteControl(
  readRow: () => Promise<unknown> = async () => {
    const db = await database();
    const [row] = await db.select().from(blackRoomRemoteControl).where(eq(blackRoomRemoteControl.id, BLACKROOM_REMOTE_CONTROL_ID));
    return row?.data ?? null;
  },
): Promise<BlackRoomRemoteControlState | null> {
  const data = await readRow();
  return data == null ? null : normalizeRemoteControlState(data);
}

export async function mutateBlackRoomRemoteControl(
  mutation: (state: BlackRoomRemoteControlState) => void,
): Promise<BlackRoomRemoteControlState> {
  await initializeBlackRoomRemoteControlPersistence();
  const db = await database();
  return db.transaction(async (tx) => {
    let [row] = await tx.select().from(blackRoomRemoteControl)
      .where(eq(blackRoomRemoteControl.id, BLACKROOM_REMOTE_CONTROL_ID)).for("update");
    if (!row) {
      await tx.insert(blackRoomRemoteControl).values({
        id: BLACKROOM_REMOTE_CONTROL_ID,
        data: createBlackRoomRemoteControlState(),
      }).onConflictDoNothing();
      [row] = await tx.select().from(blackRoomRemoteControl)
        .where(eq(blackRoomRemoteControl.id, BLACKROOM_REMOTE_CONTROL_ID)).for("update");
    }
    if (!row) throw new Error("BlackRoom remote control row could not be initialized");
    const state = normalizeRemoteControlState(row.data);
    mutation(state);
    await tx.update(blackRoomRemoteControl).set({
      data: state,
      revision: row.revision + 1,
      updatedAt: new Date(),
    }).where(eq(blackRoomRemoteControl.id, BLACKROOM_REMOTE_CONTROL_ID));
    return state;
  });
}
