import { createHash, createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { z } from "zod";

export const KONG_REPAIR_REPOSITORY = "robertmanzanillag-jpg/kong-nightlife" as const;
const id = z.string().regex(/^[A-Za-z0-9_.:-]{1,200}$/), sha = z.string().regex(/^[a-f0-9]{40}$/);
const evidenceSchema = z.object({ route: z.string().max(200).optional(), httpMethod: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]).optional(),
  httpStatus: z.number().int().min(100).max(599).optional(), errorClass: z.string().max(40), errorCode: z.union([
    z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/), z.string().length(5).regex(/^[0-9]{2}[A-Z0-9]{3}$/),
  ]).optional(), message: z.string().max(600),
  locations: z.array(z.object({ filePath: z.string().regex(/^(?:server|client|shared)\/[A-Za-z0-9_./-]+\.(?:tsx?|jsx?|mjs|cjs)$/).refine(value => !value.includes("..") && !/(?:node_modules|credentials|secrets|\.env)/i.test(value)), lineNumber: z.number().int().min(1).max(100000), columnNumber: z.number().int().min(1).max(100000).optional() }).strict()).max(3) }).strict();
export const kongRepairPayloadSchema = z.object({ company: z.literal("kong"), repository: z.literal(KONG_REPAIR_REPOSITORY),
  sourceTaskId: id, errorId: id, fingerprint: z.string().regex(/^[a-f0-9]{64}$/), generation: z.number().int().positive(),
  summary: z.string().trim().min(1).max(500), evidence: evidenceSchema.optional(), regressionScenario: z.enum(["api_ready_contract", "unsupported"]).optional(), reportedAt: z.string().datetime() }).strict();
export type KongRepairPayload = z.infer<typeof kongRepairPayloadSchema>;
const envelopeSchema = z.object({ schemaVersion: z.literal("1"), eventType: z.literal("software_repair_request"),
  eventId: id, correlationId: id, taskId: id, issuedAt: z.string().datetime(), expiresAt: z.string().datetime(),
  nonce: z.string().min(16).max(200), idempotencyKey: z.string().min(1).max(250), payload: kongRepairPayloadSchema }).strict();
export type RepairEnvelope = z.infer<typeof envelopeSchema>;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export function canonicalRepairJson(value: unknown): string {
  if (value === null || ["string", "boolean", "number"].includes(typeof value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalRepairJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalRepairJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  throw Error("REPAIR_INVALID_ENVELOPE");
}
export const repairKey = (payload: KongRepairPayload) => `kong-repair:${hash(canonicalRepairJson([payload.repository, payload.company, payload.sourceTaskId, payload.errorId, payload.fingerprint, payload.generation]))}`;
export function verifyRepairEnvelope(raw: unknown, signature: unknown, secret: string | undefined, now: number): RepairEnvelope {
  if (!secret || secret.length < 32) throw Error("REPAIR_NOT_CONFIGURED");
  if (!Buffer.isBuffer(raw) || raw.length > 16384 || !raw.length || typeof signature !== "string") throw Error("REPAIR_INVALID_ENVELOPE");
  const expected = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw Error("REPAIR_INVALID_SIGNATURE");
  let envelope: RepairEnvelope;
  try { envelope = envelopeSchema.parse(JSON.parse(raw.toString("utf8"))); } catch { throw Error("REPAIR_INVALID_ENVELOPE"); }
  const issued = Date.parse(envelope.issuedAt), expires = Date.parse(envelope.expiresAt);
  if (!Number.isFinite(now) || issued > now + 30000 || expires <= now || expires <= issued || expires - issued > 600000 ||
    envelope.taskId !== envelope.payload.sourceTaskId || envelope.idempotencyKey !== repairKey(envelope.payload) || canonicalRepairJson(envelope) !== raw.toString("utf8")) throw Error("REPAIR_INVALID_ENVELOPE");
  return envelope;
}
const status = z.enum(["queued", "blocked_insufficient_evidence", "blocked_operational_condition", "blocked_handoff_capacity", "blocked_no_github", "dispatch_unknown", "handoff_created", "maker_claimed", "maker_running", "maker_unknown", "maker_failed", "held_stale_base", "superseded_unclaimed", "awaiting_checker", "awaiting_independent_review", "awaiting_qareview", "awaiting_deployment", "verified"]);
const workerPayload = z.object({ workerId: id, key: z.string().optional(), fence: z.string().uuid().optional(),
  prNumber: z.number().int().positive().optional(), headSha: sha.optional(),
  reasonCode: z.enum(["CLI_UNAVAILABLE", "CLI_FAILED", "VALIDATION_FAILED", "ACK_UNKNOWN", "ABORTED"]).optional() }).strict();
const workerEnvelopeSchema = envelopeSchema.extend({ eventType: z.enum(["software_repair_worker_claim", "software_repair_worker_started", "software_repair_worker_complete", "software_repair_worker_failed"]), payload: workerPayload });
export type WorkerEnvelope = z.infer<typeof workerEnvelopeSchema>;
export function verifyWorkerEnvelope(raw: unknown, signature: unknown, secret: string | undefined, now: number): WorkerEnvelope {
  if (!secret || secret.length < 32) throw Error("REPAIR_NOT_CONFIGURED");
  if (!Buffer.isBuffer(raw) || !raw.length || raw.length > 16384 || typeof signature !== "string") throw Error("REPAIR_INVALID_ENVELOPE");
  const expected = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw Error("REPAIR_INVALID_SIGNATURE");
  const request = workerEnvelopeSchema.parse(JSON.parse(raw.toString("utf8")));
  const issued = Date.parse(request.issuedAt), expires = Date.parse(request.expiresAt);
  if (canonicalRepairJson(request) !== raw.toString("utf8") || request.taskId !== request.payload.workerId || issued > now + 30000 || expires <= now || expires <= issued || expires - issued > 600000) throw Error("REPAIR_INVALID_ENVELOPE");
  return request;
}
const makerSchema = z.object({ workerId: id, fence: z.string().uuid(), claimedAt: z.string().datetime(), expiresAt: z.string().datetime(), startedAt: z.string().datetime().optional(), headSha: sha.optional() }).strict();
const entrySchema = z.object({ key: z.string(), payload: kongRepairPayloadSchema, payloadHash: z.string(), eventId: id, nonce: z.string(),
  status, githubClosure: z.object({ state: z.enum(["pending", "unknown", "closed"]), beforeState: z.enum(["open", "closed"]).optional(), proofCommentUrl: z.string().optional(), confirmedAt: z.string().datetime().optional() }).strict().optional(), handoffStartedAt: z.string().datetime().optional(), engineSourceCommit: sha.optional(), approvedBaseSha: sha.optional(), sourceDigest: z.string().regex(/^[a-f0-9]{64}$/).optional(), supersessionRef: z.string().optional(), githubClaimRef: z.string().optional(), verifiedRegressionRunId: z.number().int().positive().optional(), maker: makerSchema.optional(), receivedAt: z.string().datetime(), issueUrl: z.string().optional(), prNumber: z.number().int().positive().optional(),
  verifiedHeadSha: sha.optional(), verifiedDeploymentSha: sha.optional(), verifiedAt: z.string().datetime().optional() }).strict();
const journalSchema = z.object({ version: z.literal(1), ownerKey: z.string().regex(/^[a-f0-9]{64}$/), entries: z.array(entrySchema).max(1000), deliveryReceipts: z.array(z.object({ eventId: id, nonce: z.string(), key: z.string(), payloadHash: z.string() }).strict()).max(5000).default([]), workerReceipts: z.array(z.object({ eventId: id, nonce: z.string(), requestHash: z.string(), idempotencyKey: z.string(), key: z.string().nullable() }).strict()).max(5000).default([]) }).strict();
export type RepairJournal = z.infer<typeof journalSchema>;
export type RepairEntry = RepairJournal["entries"][number];
export type RepairProof = { repository: typeof KONG_REPAIR_REPOSITORY; headSha: string; mergeSha: string | null; merged: boolean;
  maker: string; checker: string | null; checkerHeadSha: string | null; checksPassed: boolean; appQaPassed: boolean;
  deployedSha: string | null; deploymentReady: boolean; regressionPassed: boolean; regressionRunId?: number; observedAt: number };
export interface RepairStore { read(owner: string): Promise<string | null>; transact(owner: string, change: (raw: string | null) => Promise<string>): Promise<string> }
const namespace = (owner: string) => JSON.stringify(["kong-software-repairs-v1", owner]);
function parseJournal(raw: string | null, owner: string): RepairJournal {
  const journal = raw === null ? { version: 1 as const, ownerKey: hash(owner), entries: [], deliveryReceipts: [], workerReceipts: [] } : journalSchema.parse(JSON.parse(raw));
  if (journal.ownerKey !== hash(owner) || new Set(journal.entries.map(entry => entry.key)).size !== journal.entries.length ||
    new Set(journal.entries.map(entry => entry.eventId)).size !== journal.entries.length || new Set(journal.entries.map(entry => entry.nonce)).size !== journal.entries.length) throw Error("REPAIR_JOURNAL_INVALID");
  for (const entry of journal.entries) if (entry.key !== repairKey(entry.payload) || entry.payloadHash !== hash(canonicalRepairJson(entry.payload))) throw Error("REPAIR_JOURNAL_INVALID");
  return journal;
}
/** The subscription handoff has no paid provider dependency. All external actions
 * run outside the transaction. Ambiguous issue creation is permanently fenced. */
export function createKongRepairBridge(options: { owner: string; store: RepairStore; now: () => number;
  prepareHandoff?: (entry: RepairEntry) => Promise<() => Promise<{ repository: string; issueUrl: string; approvedBaseSha?: string; sourceDigest?: string; engineSourceCommit?: string }>>;
  createHandoff: (entry: RepairEntry) => Promise<{ repository: string; issueUrl: string; approvedBaseSha?: string; sourceDigest?: string; engineSourceCommit?: string }>;
  prepareCloseHandoff?: (entry: RepairEntry) => Promise<(allowCommentCreate: boolean) => Promise<{ closed: boolean; beforeState: "open" | "closed"; proofCommentUrl?: string }>>;
  readGithubMaker?: (entry: RepairEntry, allowRefresh?: boolean) => Promise<{ claimed: boolean; ref: string; prNumber?: number; state?: "maker_failed" | "maker_unknown" | "held_stale_base" | "superseded_unclaimed" }>;
  readProof: (entry: RepairEntry, prNumber: number) => Promise<RepairProof>;
  readPaidState: () => Promise<"available" | "blocked_unknown_credit" | "unavailable">;
}) {
  const { owner, store, now } = options;
  if (!owner.trim()) throw Error("REPAIR_OWNER_REQUIRED");
  const mutate = (change: (journal: RepairJournal) => void) => store.transact(namespace(owner), async raw => {
    const journal = parseJournal(raw, owner); change(journal); return JSON.stringify(parseJournal(JSON.stringify(journal), owner));
  });
  async function receive(envelope: RepairEnvelope) {
    envelope = envelopeSchema.parse(envelope);
    if (envelope.idempotencyKey !== repairKey(envelope.payload) || envelope.taskId !== envelope.payload.sourceTaskId) throw Error("REPAIR_INVALID_ENVELOPE");
    const key = repairKey(envelope.payload), payloadHash = hash(canonicalRepairJson(envelope.payload));
    const raw = await mutate(journal => {
      const prior = journal.entries.find(entry => entry.key === key);
      if (prior && prior.payloadHash !== payloadHash) throw Error("REPAIR_IDEMPOTENCY_CONFLICT");
      const delivery = journal.deliveryReceipts.find(row => row.eventId === envelope.eventId || row.nonce === envelope.nonce);
      if (delivery && (delivery.key !== key || delivery.payloadHash !== payloadHash || delivery.eventId !== envelope.eventId || delivery.nonce !== envelope.nonce)) throw Error("REPAIR_REPLAY_CONFLICT");
      if (!delivery) {
        if (journal.deliveryReceipts.length >= 5000) throw Error("REPAIR_JOURNAL_CAPACITY");
        journal.deliveryReceipts.push({ eventId: envelope.eventId, nonce: envelope.nonce, key, payloadHash });
      }
      if (prior) return;
      if (journal.entries.some(entry => entry.nonce === envelope.nonce || entry.eventId === envelope.eventId)) throw Error("REPAIR_REPLAY_CONFLICT");
      if (journal.entries.length >= 1000) throw Error("REPAIR_JOURNAL_CAPACITY");
      journal.entries.push({ key, payload: structuredClone(envelope.payload), payloadHash, eventId: envelope.eventId, nonce: envelope.nonce,
        status: "queued", receivedAt: new Date(now()).toISOString() });
    });
    return parseJournal(raw, owner).entries.find(entry => entry.key === key)!;
  }
  async function dispatch(key: string) {
    let prepared: (() => Promise<{ repository: string; issueUrl: string; approvedBaseSha?: string; sourceDigest?: string; engineSourceCommit?: string }>) | undefined;
    if (options.prepareHandoff) {
      const candidate = parseJournal(await store.read(namespace(owner)), owner).entries.find(entry => entry.key === key);
      if (!candidate) throw Error("REPAIR_NOT_FOUND");
      if (["queued", "blocked_handoff_capacity", "blocked_no_github"].includes(candidate.status)) {
        try { prepared = await options.prepareHandoff(structuredClone(candidate)); }
        catch {
          const saved = await mutate(journal => { const entry = journal.entries.find(item => item.key === key)!; if (["queued", "blocked_handoff_capacity", "blocked_no_github"].includes(entry.status)) entry.status = "blocked_no_github"; });
          return parseJournal(saved, owner).entries.find(item => item.key === key)!;
        }
      }
    }
    let claimed: RepairEntry | undefined;
    const raw = await mutate(journal => {
      claimed = undefined; const entry = journal.entries.find(entry => entry.key === key);
      if (!entry) throw Error("REPAIR_NOT_FOUND");
      if (!["queued", "blocked_handoff_capacity", "blocked_no_github"].includes(entry.status)) return;
      const outstanding = journal.entries.filter(item => item.status === "dispatch_unknown" || (item.issueUrl && !["verified", "superseded_unclaimed"].includes(item.status))).length;
      const day = new Date(now()).toISOString().slice(0, 10);
      const startedToday = journal.entries.filter(item => item.handoffStartedAt?.slice(0, 10) === day).length;
      if (outstanding >= 3 || startedToday >= 3) { entry.status = "blocked_handoff_capacity"; return; }
      const evidence = entry.payload.evidence;
      const operationalCodes = new Set(["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ECONNABORTED", "UPSTREAM_QUOTA_EXCEEDED", "QUOTA_EXCEEDED", "RATE_LIMITED", "INVALID_API_KEY", "MISSING_API_KEY", "AUTHENTICATION_FAILED", "STARTUP_PENDING", "SERVICE_UNAVAILABLE", "42P01", "42703", "55P03"]);
      if (evidence && (operationalCodes.has(evidence.errorCode || "") || (evidence.route === "/api/ready" && evidence.httpStatus === 503 && evidence.errorClass === "Error" && !evidence.errorCode))) { entry.status = "blocked_operational_condition"; return; }
      if (!entry.payload.evidence || entry.payload.evidence.errorClass === "UNKNOWN" || !entry.payload.evidence.message.trim() || !entry.payload.evidence.locations.length || Buffer.byteLength(JSON.stringify(entry.payload.evidence)) > 4096) { entry.status = "blocked_insufficient_evidence"; return; }
      entry.status = "dispatch_unknown"; entry.handoffStartedAt = new Date(now()).toISOString(); claimed = structuredClone(entry);
    });
    if (!claimed) return parseJournal(raw, owner).entries.find(entry => entry.key === key)!;
    const handoff = prepared ? await prepared() : await options.createHandoff(claimed);
    if (handoff.repository !== KONG_REPAIR_REPOSITORY || !/^https:\/\/github\.com\/robertmanzanillag-jpg\/kong-nightlife\/issues\/[1-9][0-9]*$/.test(handoff.issueUrl)) throw Error("REPAIR_HANDOFF_UNVERIFIED");
    const saved = await mutate(journal => {
      const entry = journal.entries.find(entry => entry.key === key)!;
      if (entry.status !== "dispatch_unknown") throw Error("REPAIR_STATE_CHANGED");
      entry.status = "handoff_created"; entry.issueUrl = handoff.issueUrl;
      if (handoff.approvedBaseSha) entry.approvedBaseSha = sha.parse(handoff.approvedBaseSha);
      if (handoff.sourceDigest) entry.sourceDigest = handoff.sourceDigest;
      if (handoff.engineSourceCommit) entry.engineSourceCommit = sha.parse(handoff.engineSourceCommit);
    });
    return parseJournal(saved, owner).entries.find(entry => entry.key === key)!;
  }
  async function reconcileClosure(key: string) {
    let entry = parseJournal(await store.read(namespace(owner)), owner).entries.find(item => item.key === key);
    if (!entry || entry.status !== "verified" || entry.githubClosure?.state === "closed" || !options.prepareCloseHandoff) return entry;
    let publish: Awaited<ReturnType<NonNullable<typeof options.prepareCloseHandoff>>>;
    try { publish = await options.prepareCloseHandoff(structuredClone(entry)); }
    catch {
      await mutate(journal => { const current = journal.entries.find(item => item.key === key)!; if (!current.githubClosure) current.githubClosure = { state: "pending" }; });
      return parseJournal(await store.read(namespace(owner)), owner).entries.find(item => item.key === key);
    }
    let mayCreateComment = false;
    await mutate(journal => {
      const current = journal.entries.find(item => item.key === key)!;
      if (current.status !== "verified") throw Error("REPAIR_STATE_CHANGED");
      mayCreateComment = !current.githubClosure || current.githubClosure.state === "pending";
      if (mayCreateComment) current.githubClosure = { state: "unknown" };
    });
    try {
      const result = await publish(mayCreateComment);
      await mutate(journal => {
        const current = journal.entries.find(item => item.key === key)!;
        if (current.status !== "verified") throw Error("REPAIR_STATE_CHANGED");
        current.githubClosure = result.closed ? { state: "closed", beforeState: result.beforeState, proofCommentUrl: result.proofCommentUrl, confirmedAt: new Date(now()).toISOString() } : { state: "unknown", beforeState: result.beforeState };
      });
    } catch { /* The code remains verified; delivery is explicitly unconfirmed. */ }
    return parseJournal(await store.read(namespace(owner)), owner).entries.find(item => item.key === key);
  }
  async function check(key: string, prNumber: number) {
    const entry = parseJournal(await store.read(namespace(owner)), owner).entries.find(entry => entry.key === key);
    if (!entry || !entry.issueUrl || !Number.isSafeInteger(prNumber) || prNumber < 1 || (entry.prNumber && entry.prNumber !== prNumber)) throw Error("REPAIR_CHECK_NOT_ELIGIBLE");
    const proof = await options.readProof(structuredClone(entry), prNumber), age = now() - proof.observedAt;
    if (proof.repository !== KONG_REPAIR_REPOSITORY || !sha.safeParse(proof.headSha).success || age < 0 || age > 60000) throw Error("REPAIR_PROOF_INVALID");
    const independent = !!proof.checker && proof.checker !== proof.maker && proof.checkerHeadSha === proof.headSha;
    const checked = independent && proof.checksPassed;
    const verified = entry.payload.regressionScenario === "api_ready_contract" && checked && proof.appQaPassed && proof.merged && !!proof.mergeSha && sha.safeParse(proof.mergeSha).success && proof.deployedSha === proof.mergeSha && proof.deploymentReady && proof.regressionPassed;
    const saved = await mutate(journal => {
      const current = journal.entries.find(item => item.key === key)!;
      if (current.payloadHash !== entry.payloadHash || current.issueUrl !== entry.issueUrl || (current.prNumber && current.prNumber !== prNumber)) throw Error("REPAIR_STATE_CHANGED");
      // A changed head or unavailable evidence revokes readiness; no callback can
      // supply a SHA or create a verified state without a fresh trusted read.
      current.prNumber = prNumber; current.status = verified ? "verified" : !independent ? "awaiting_independent_review" : !proof.checksPassed ? "awaiting_checker" : !proof.appQaPassed ? "awaiting_qareview" : "awaiting_deployment";
      const priorVerifiedAt = current.verifiedHeadSha === proof.headSha && current.verifiedDeploymentSha === proof.deployedSha && current.verifiedRegressionRunId === proof.regressionRunId ? current.verifiedAt : undefined;
      if (!verified || !priorVerifiedAt) delete current.githubClosure;
      delete current.verifiedAt; delete current.verifiedHeadSha; delete current.verifiedDeploymentSha; delete current.verifiedRegressionRunId;
      if (verified) { current.verifiedHeadSha = proof.headSha; current.verifiedDeploymentSha = proof.deployedSha!; current.verifiedAt = priorVerifiedAt || new Date(now()).toISOString(); if (proof.regressionRunId) current.verifiedRegressionRunId = proof.regressionRunId; }
    });
    if (verified) return (await reconcileClosure(key))!;
    return parseJournal(saved, owner).entries.find(item => item.key === key)!;
  }
  async function worker(request: WorkerEnvelope) {
    request = workerEnvelopeSchema.parse(request);
    const requestHash = hash(canonicalRepairJson(request));
    const before = parseJournal(await store.read(namespace(owner)), owner);
    const prior = before.workerReceipts.find(row => row.eventId === request.eventId || row.nonce === request.nonce || row.idempotencyKey === request.idempotencyKey);
    if (prior) {
      if (prior.requestHash !== requestHash) throw Error("REPAIR_WORKER_REPLAY_CONFLICT");
      const entry = before.entries.find(entry => entry.key === prior.key);
      if (request.eventType === "software_repair_worker_claim" && entry?.maker && Date.parse(entry.maker.expiresAt) <= now()) throw Error("REPAIR_WORKER_LEASE_EXPIRED");
      return entry || null;
    }
    let completedProof: RepairProof | undefined;
    if (request.eventType === "software_repair_worker_complete") {
      const entry = before.entries.find(entry => entry.key === request.payload.key);
      if (!entry?.maker || entry.maker.workerId !== request.payload.workerId || entry.maker.fence !== request.payload.fence || Date.parse(entry.maker.expiresAt) <= now() || !request.payload.prNumber || !request.payload.headSha) throw Error("REPAIR_WORKER_FENCE_INVALID");
      completedProof = await options.readProof(structuredClone(entry), request.payload.prNumber);
      if (completedProof.repository !== KONG_REPAIR_REPOSITORY || completedProof.headSha !== request.payload.headSha || now() - completedProof.observedAt < 0 || now() - completedProof.observedAt > 60000) throw Error("REPAIR_WORKER_PR_UNVERIFIED");
    }
    const saved = await mutate(journal => {
      const already = journal.workerReceipts.find(row => row.eventId === request.eventId || row.nonce === request.nonce || row.idempotencyKey === request.idempotencyKey);
      if (already) { if (already.requestHash !== requestHash) throw Error("REPAIR_WORKER_REPLAY_CONFLICT"); return; }
      if (journal.workerReceipts.length >= 5000) throw Error("REPAIR_JOURNAL_CAPACITY");
      for (const entry of journal.entries) if (entry.maker && ["maker_claimed", "maker_running"].includes(entry.status) && Date.parse(entry.maker.expiresAt) <= now()) entry.status = "maker_unknown";
      let entry: RepairEntry | undefined;
      if (request.eventType === "software_repair_worker_claim") {
        entry = journal.entries.some(item => item.maker?.workerId === request.payload.workerId && ["maker_claimed", "maker_running"].includes(item.status)) ? undefined : journal.entries.find(item => item.status === "handoff_created" && !item.maker);
        if (entry) { entry.status = "maker_claimed"; entry.maker = { workerId: request.payload.workerId, fence: randomUUID(), claimedAt: new Date(now()).toISOString(), expiresAt: new Date(now() + 3600000).toISOString() }; }
      } else {
        entry = journal.entries.find(item => item.key === request.payload.key);
        if (!entry?.maker || entry.maker.workerId !== request.payload.workerId || entry.maker.fence !== request.payload.fence || Date.parse(entry.maker.expiresAt) <= now() || !["maker_claimed", "maker_running"].includes(entry.status)) throw Error("REPAIR_WORKER_FENCE_INVALID");
        if (request.eventType === "software_repair_worker_started") { entry.status = "maker_running"; entry.maker.startedAt ||= new Date(now()).toISOString(); }
        else if (request.eventType === "software_repair_worker_complete") { if (!completedProof) throw Error("REPAIR_WORKER_PR_UNVERIFIED"); entry.status = "awaiting_checker"; entry.prNumber = request.payload.prNumber; entry.maker.headSha = request.payload.headSha; }
        else { if (!request.payload.reasonCode) throw Error("REPAIR_WORKER_REASON_REQUIRED"); entry.status = request.payload.reasonCode === "ACK_UNKNOWN" ? "maker_unknown" : "maker_failed"; }
      }
      journal.workerReceipts.push({ eventId: request.eventId, nonce: request.nonce, idempotencyKey: request.idempotencyKey, requestHash, key: entry?.key || null });
    });
    const journal = parseJournal(saved, owner), receipt = journal.workerReceipts.find(row => row.eventId === request.eventId)!;
    return journal.entries.find(entry => entry.key === receipt.key) || null;
  }
  async function sync(key?: string, sourceStillPresent = false) {
    const entries = parseJournal(await store.read(namespace(owner)), owner).entries.filter(entry => entry.issueUrl && (!key || entry.key === key)).slice(-10);
    for (const entry of entries) {
      const observed = options.readGithubMaker ? await options.readGithubMaker(structuredClone(entry), sourceStillPresent) : undefined;
      if ((observed?.claimed || observed?.state === "superseded_unclaimed") && !entry.maker) await mutate(journal => {
        const current = journal.entries.find(item => item.key === entry.key)!;
        if (["handoff_created", "maker_claimed", "maker_failed", "maker_unknown", "held_stale_base"].includes(current.status)) { if (observed.state === "superseded_unclaimed") current.supersessionRef = observed.ref; else current.githubClaimRef = observed.ref; current.status = observed.state || "maker_claimed"; }
      });
      if (observed?.prNumber || entry.prNumber) await check(entry.key, observed?.prNumber || entry.prNumber!);
    }
    return parseJournal(await store.read(namespace(owner)), owner).entries.filter(entry => !key || entry.key === key);
  }
  return { receive, dispatch, check, worker, sync, reconcileClosure, async view() {
    const journal = parseJournal(await store.read(namespace(owner)), owner);
    return { entries: journal.entries, subscriptionProviderCalls: false,
      makerConsumer: journal.entries.some(entry => entry.maker || entry.githubClaimRef) ? "worker_seen" : "pending_no_maker",
      paidExecution: await options.readPaidState().catch(() => "unavailable" as const) };
  } };
}

const statusEnvelopeSchema = envelopeSchema.extend({ eventType: z.literal("software_repair_status"), payload: z.object({ company: z.literal("kong"), repository: z.literal(KONG_REPAIR_REPOSITORY), key: z.string().regex(/^kong-repair:[a-f0-9]{64}$/), sourceTaskId: id, sourceStillPresent: z.boolean(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).strict() });
export function verifyRepairStatus(raw: unknown, signature: unknown, secret: string | undefined, now: number) {
  if (!secret || secret.length < 32 || !Buffer.isBuffer(raw) || !raw.length || raw.length > 16384 || typeof signature !== "string") throw Error("REPAIR_INVALID_STATUS_REQUEST");
  const expected = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw Error("REPAIR_INVALID_SIGNATURE");
  const request = statusEnvelopeSchema.parse(JSON.parse(raw.toString("utf8"))), issued = Date.parse(request.issuedAt), expires = Date.parse(request.expiresAt);
  if (canonicalRepairJson(request) !== raw.toString("utf8") || request.taskId !== request.payload.sourceTaskId || request.correlationId !== request.taskId || !Number.isFinite(now) || issued > now + 30000 || expires <= now || expires <= issued || expires - issued > 600000) throw Error("REPAIR_INVALID_STATUS_REQUEST");
  return request;
}
export function signVerifiedRepair(entry: RepairEntry, secret: string, now: number) {
  if (entry.status !== "verified" || entry.payload.regressionScenario !== "api_ready_contract" || !entry.verifiedHeadSha || !entry.verifiedDeploymentSha || !entry.verifiedRegressionRunId || !entry.engineSourceCommit || !entry.approvedBaseSha || !entry.sourceDigest || !entry.prNumber || !entry.verifiedAt || secret.length < 32) return null;
  const payload = { company: "kong", repository: KONG_REPAIR_REPOSITORY, key: entry.key, sourceTaskId: entry.payload.sourceTaskId,
    errorId: entry.payload.errorId, generation: entry.payload.generation, prNumber: entry.prNumber, headSha: entry.verifiedHeadSha, deploymentSha: entry.verifiedDeploymentSha,
    regressionRunId: entry.verifiedRegressionRunId, regressionScenario: entry.payload.regressionScenario, approvedBaseSha: entry.approvedBaseSha, sourceDigest: entry.sourceDigest, engineSourceCommit: entry.engineSourceCommit, verifiedAt: entry.verifiedAt };
  const stableId = hash(canonicalRepairJson(payload));
  const envelope = { schemaVersion: "1", eventType: "software_repair_verified", eventId: stableId, correlationId: `${entry.payload.sourceTaskId}:${entry.payload.generation}`,
    taskId: entry.payload.sourceTaskId, nonce: stableId, idempotencyKey: `${entry.key}:verified:${entry.verifiedDeploymentSha}`,
    issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 300000).toISOString(), payload };
  const rawBody = canonicalRepairJson(envelope);
  return { rawBody, signature: `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}` };
}
