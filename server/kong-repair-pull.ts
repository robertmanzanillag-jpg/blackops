import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { getCouncilStore } from "./agent-council-store";
import { getSystemUserId } from "./user-context";
import { canonicalRepairJson, kongRepairPayloadSchema, repairKey, KONG_REPAIR_REPOSITORY, type createKongRepairBridge, type RepairStore } from "./kong-repair-bridge";
import { getKongRepairBridge } from "./kong-repair-runtime";
export const KONG_REPAIR_PULL_INTERVAL_MS = 15 * 60000;
export const KONG_REPAIR_PULL_STARTUP_RETRY_MS = [1000, 5000] as const;
/** Only failures before any source HTTP read/repair dispatch are retryable. */
export class RepairPullInitializationError extends Error {
  constructor() { super("REPAIR_PULL_INITIALIZATION_UNCONFIRMED"); this.name = "RepairPullInitializationError"; }
}
const sourceSchema = z.object({ version: z.literal(1), company: z.literal("kong"), repository: z.literal(KONG_REPAIR_REPOSITORY), observedAt: z.string().datetime(), total: z.number().int().nonnegative(),
  requests: z.array(z.object({ key: z.string(), payloadSha256: z.string().regex(/^[a-f0-9]{64}$/), payload: kongRepairPayloadSchema }).strict()).max(100) }).strict();
const stateSchema = z.object({ version: z.literal(1), lastStartedAt: z.string().datetime().nullable(), lastSuccessfulSourceReadAt: z.string().datetime().nullable(),
  lastHttpStatus: z.number().int().min(100).max(599).nullable(), sourceTotal: z.number().int().nonnegative(), returned: z.number().int().nonnegative(), newlyQueued: z.number().int().nonnegative(),
  errorCode: z.enum(["NONE", "NOT_CONFIGURED", "SOURCE_HTTP_FAILED", "SOURCE_INVALID", "PERSISTENCE_UNCONFIRMED"]) }).strict();
const namespace = (owner: string) => JSON.stringify(["kong-repair-pull-v1", owner]);
const empty = () => ({ version: 1 as const, lastStartedAt: null, lastSuccessfulSourceReadAt: null, lastHttpStatus: null, sourceTotal: 0, returned: 0, newlyQueued: 0, errorCode: "NOT_CONFIGURED" as const });
export async function readRepairPullStatus(store: RepairStore, owner: string, now: number) {
  const raw = await store.read(namespace(owner)), state = raw ? stateSchema.parse(JSON.parse(raw)) : empty();
  const age = state.lastSuccessfulSourceReadAt ? now - Date.parse(state.lastSuccessfulSourceReadAt) : Infinity;
  return { ...state, sourceConnected: age >= 0 && age <= 2 * KONG_REPAIR_PULL_INTERVAL_MS && state.lastHttpStatus === 200 && state.errorCode === "NONE", cadenceMs: KONG_REPAIR_PULL_INTERVAL_MS };
}
/** Same fixed origin, path and read-only credential already used by Office KONG.
 * The token never authorizes a source write; the HTTP read never marks a task. */
export async function pullRepairSources(options: { bridge: ReturnType<typeof createKongRepairBridge>; store: RepairStore; owner: string; token?: string;
  handoffEnabled: boolean; now: () => number; fetch?: typeof fetch }) {
  let state: z.infer<typeof stateSchema> = { ...empty(), lastStartedAt: new Date(options.now()).toISOString() };
  const persist = () => options.store.transact(namespace(options.owner), async () => JSON.stringify(stateSchema.parse(state)));
  try {
    const previous = await options.store.read(namespace(options.owner));
    if (previous) state = { ...stateSchema.parse(JSON.parse(previous)), lastStartedAt: state.lastStartedAt };
    state.lastHttpStatus = null;
    await persist();
  } catch { throw new RepairPullInitializationError(); }
  let sourceValidated = false;
  try {
    if (!options.token || options.token.length < 32 || /[\x00-\x20\x7f]/.test(options.token)) { state.errorCode = "NOT_CONFIGURED"; await persist(); return state; }
    const response = await (options.fetch || fetch)("https://kongnightlife.com/api/admin/ceo/operations", { method: "GET", redirect: "error", signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${options.token}`, "Cache-Control": "no-cache" } });
    state.lastHttpStatus = response.status;
    if (!response.ok) { state.errorCode = "SOURCE_HTTP_FAILED"; await persist(); return state; }
    const reader = response.body?.getReader(); if (!reader) throw Error();
    let text = "", bytes = 0; const decoder = new TextDecoder();
    while (true) { const part = await reader.read(); if (part.done) break; bytes += part.value.length; if (bytes > 524288) { await reader.cancel(); throw Error(); } text += decoder.decode(part.value, { stream: true }); }
    text += decoder.decode();
    const source = sourceSchema.parse(JSON.parse(text).softwareRepairs), age = options.now() - Date.parse(source.observedAt);
    if (age < -30000 || age > 120000 || source.total < source.requests.length || new Set(source.requests.map(request => request.key)).size !== source.requests.length) throw Error();
    for (const request of source.requests) if (request.key !== repairKey(request.payload) || request.payloadSha256 !== createHash("sha256").update(canonicalRepairJson(request.payload)).digest("hex")) throw Error();
    sourceValidated = true;
    state.lastSuccessfulSourceReadAt = new Date(options.now()).toISOString(); state.sourceTotal = source.total; state.returned = source.requests.length; state.newlyQueued = 0; state.errorCode = "NONE";
    await persist();
    const prior = (await options.bridge.view()).entries;
    for (const request of source.requests) {
      if (state.newlyQueued >= 10) break;
      const existing = prior.find(entry => entry.key === request.key);
      if (existing) continue;
      const at = new Date(options.now()).toISOString();
      await options.bridge.receive({ schemaVersion: "1", eventType: "software_repair_request", eventId: randomUUID(), correlationId: `${request.payload.sourceTaskId}:${request.payload.generation}`,
        taskId: request.payload.sourceTaskId, issuedAt: at, expiresAt: new Date(options.now() + 300000).toISOString(), nonce: randomUUID(), idempotencyKey: request.key, payload: request.payload });
      state.newlyQueued++;
    }
    if (options.handoffEnabled) for (const entry of (await options.bridge.view()).entries.filter(entry => ["queued", "blocked_handoff_capacity", "blocked_no_github"].includes(entry.status)).slice(0, 10)) await options.bridge.dispatch(entry.key).catch(() => undefined);
    // GET-only mode must still observe the real maker and verification chain.
    // Refresh is limited to an exact, currently reported source and only after
    // the GitHub exclusion fence proves the old attempt was never claimed.
    const current = (await options.bridge.view()).entries;
    for (const request of source.requests.filter(request => current.some(entry => entry.key === request.key && entry.issueUrl)).slice(0, 3))
      await options.bridge.sync(request.key, options.handoffEnabled).catch(() => undefined);
    for (const entry of (await options.bridge.view()).entries.filter(entry => entry.status === "verified" && entry.githubClosure?.state !== "closed").slice(0, 3))
      await options.bridge.reconcileClosure(entry.key).catch(() => undefined);
    await persist(); return state;
  } catch {
    state.errorCode = sourceValidated ? "PERSISTENCE_UNCONFIRMED" : "SOURCE_INVALID";
    await persist(); return state;
  }
}
let inFlight: Promise<unknown> | undefined;
let lastInitializationFailureAt: string | undefined;
export async function pullConfiguredRepairSources() {
  if (process.env.KONG_REPAIR_PULL_ENABLED !== "true") return { code: "REPAIR_PULL_DISABLED" };
  return inFlight ||= (async () => {
    try {
      let bridge: Awaited<ReturnType<typeof getKongRepairBridge>>, store: Awaited<ReturnType<typeof getCouncilStore>>, owner: string;
      try {
        bridge = await getKongRepairBridge();
        if (!bridge) return { code: "REPAIR_BRIDGE_DISABLED" };
        store = await getCouncilStore(); owner = getSystemUserId();
      }
      catch { throw new RepairPullInitializationError(); }
      const result = await pullRepairSources({ bridge, store, owner, token: process.env.KONG_OFFICE_READ_TOKEN,
        handoffEnabled: process.env.KONG_REPAIR_HANDOFF_ENABLED === "true" && /^[a-f0-9]{40}$/.test(process.env.KONG_REPAIR_CHECKER_ENGINE_COMMIT || ""), now: Date.now });
      lastInitializationFailureAt = undefined;
      return result;
    } catch (error) {
      if (error instanceof RepairPullInitializationError) lastInitializationFailureAt = new Date().toISOString();
      throw error;
    }
  })().finally(() => { inFlight = undefined; });
}
export function createRepairPullLoop(options: { enabled: boolean; run: () => Promise<unknown>; setInterval: (run: () => void, ms: number) => unknown; clearInterval: (id: unknown) => void; waitBeforeRetry?: (ms: number) => Promise<void> }) {
  if (!options.enabled) return () => {};
  let active = false, stopped = false;
  const run = async () => {
    for (let attempt = 0; !stopped; attempt++) {
      try { await options.run(); return; }
      catch (error) {
        if (!(error instanceof RepairPullInitializationError) || attempt >= KONG_REPAIR_PULL_STARTUP_RETRY_MS.length || stopped) return;
        await (options.waitBeforeRetry || (ms => new Promise<void>(resolve => setTimeout(resolve, ms))))(KONG_REPAIR_PULL_STARTUP_RETRY_MS[attempt]);
      }
    }
  };
  const tick = () => { if (active || stopped) return; active = true; void run().catch(() => undefined).finally(() => { active = false; }); };
  const timer = options.setInterval(tick, KONG_REPAIR_PULL_INTERVAL_MS); tick();
  return () => { stopped = true; options.clearInterval(timer); };
}
let stopLoop: (() => void) | undefined;
export function startConfiguredRepairPull() {
  if (stopLoop || process.env.KONG_REPAIR_PULL_ENABLED !== "true") return;
  stopLoop = createRepairPullLoop({ enabled: true, run: pullConfiguredRepairSources,
    setInterval: (run, ms) => { const timer = setInterval(run, ms); timer.unref(); return timer; }, clearInterval: id => clearInterval(id as ReturnType<typeof setInterval>) });
  process.once("SIGTERM", stopLoop); process.once("SIGINT", stopLoop);
}
export async function configuredRepairPullStatus() {
  const state = await readRepairPullStatus(await getCouncilStore(), getSystemUserId(), Date.now());
  return { ...state, ...(lastInitializationFailureAt ? { sourceConnected: false, errorCode: "PERSISTENCE_UNCONFIRMED" as const, lastInitializationFailureAt } : {}), enabled: process.env.KONG_REPAIR_PULL_ENABLED === "true",
    readCredentialConfigured: (process.env.KONG_OFFICE_READ_TOKEN?.length || 0) >= 32 };
}
