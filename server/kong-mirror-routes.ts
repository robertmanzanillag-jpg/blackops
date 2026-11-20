import type { Express, Request } from "express";
import { createKongMirrorLab, createMirrorSummarizer, createMirrorAiBudget, MirrorError, KONG_MIRROR_ACTION_TYPE, type MirrorCards, type MirrorGithub, type MirrorStore, type MirrorCard, type MirrorAiCall } from "./kong-mirror-lab";
import { createMirrorChat, type MirrorChatGithub, type MirrorChatProvider } from "./kong-mirror-chat";
import { createKongImprovementScouts, startScoutLoop, type ScoutGithub, type ScoutInputs } from "./kong-improvement-scouts";
import { lessonFromMergedImprovement, type KongImprovementLesson } from "@shared/kong-improvement-academy";
import { getAuthenticatedCurrentUserId, getSystemUserId } from "./user-context";
import { officeSameOrigin } from "./office-routes";
import { effectiveCommitStatusesPass } from "./kong-repair-proof";

type Lab = ReturnType<typeof createKongMirrorLab>;
type Chat = ReturnType<typeof createMirrorChat>;
type Scouts = ReturnType<typeof createKongImprovementScouts>;
type Budget = ReturnType<typeof createMirrorAiBudget>;
export const KONG_MIRROR_REPORT_PATH = "/api/integrations/kong/mirror-reports";

/** Trust Center rows for this kind. Writes go through storage + pending_action_events + audit log, like the generic routes. */
export function createStorageMirrorCards(userId: string): MirrorCards {
  const deps = async () => ({ storage: (await import("./storage")).storage, trust: await import("./trust-policy") });
  const event = async (id: string, actorId: string, eventType: "approved" | "executed" | "failed" | "rejected" | "edited", previousStatus: string, nextStatus: string, note: string | null, metadata: Record<string, unknown> | null) => {
    const { storage } = await deps();
    await storage.createPendingActionEvent({ pendingActionId: id, userId, actorType: actorId === "system" ? "system" : "user", actorId,
      eventType, previousStatus: previousStatus as never, nextStatus: nextStatus as never, note, metadata });
  };
  const audit = async (id: string, actorId: string, actionType: string, status: "succeeded" | "failed" | "blocked", metadata: Record<string, unknown>) => {
    const { trust } = await deps();
    await trust.writeAuditLog({ userId, actorType: "user", actorId, origin: "web", actionType, resourceType: "pending_action", resourceId: id, pendingActionId: id,
      metadata, status, executionMode: "user_requested" });
  };
  return {
    async create(card: MirrorCard) {
      const { trust } = await deps();
      const action = await trust.createPendingActionForApproval({ userId, actorType: "webhook", actorId: "kong-mirror-lab", origin: "github", executionMode: "webhook",
        actionType: KONG_MIRROR_ACTION_TYPE, resourceType: "kong_mirror_report", resourceId: card.key, scope: "github",
        title: `${card.approvable ? (card.warn ? "Mejora KONG (con avisos)" : "Mejora KONG") : "KONG: mejora que falló"} · ${card.title}`.slice(0, 240),
        description: card.approvable
          ? `El equipo de pruebas del Mirror Lab revisó el PR #${card.prNumber}. ${card.whyDoIt.narrative}`.slice(0, 900)
          : `Informativo: el PR #${card.prNumber} falló en el Mirror Lab. ${card.failReasons.join(" ")}`.slice(0, 900),
        input: { reportKey: card.key, card }, proposedChanges: { merge: card.approvable, repo: card.repo, prNumber: card.prNumber, headSha: card.headSha },
        metadata: { reportKey: card.key, overall: card.overall } });
      return { id: action.id };
    },
    async findByKey(key) {
      const { storage } = await deps();
      const found = (await storage.getPendingActions(userId)).find(action => action.actionType === KONG_MIRROR_ACTION_TYPE && action.resourceId === key);
      return found ? { id: found.id, status: found.status } : null;
    },
    async get(id) {
      const { storage } = await deps();
      const found = await storage.getPendingAction(id);
      return found && found.userId === userId && found.actionType === KONG_MIRROR_ACTION_TYPE ? { id: found.id, status: found.status } : null;
    },
    async note(id, note, metadata) {
      const { storage } = await deps();
      const current = await storage.getPendingAction(id);
      if (current) await event(id, "system", "edited", current.status, current.status, note, metadata || null);
    },
    async approved(id, actorId) {
      const { storage } = await deps();
      const current = await storage.getPendingAction(id);
      await storage.updatePendingAction(id, { status: "approved", approvedBy: actorId, approvedAt: new Date(), approvalReason: "Aprobado por Robert tras verificar SHA y checks" });
      await event(id, actorId, "approved", current?.status || "pending", "approved", "SHA y checks verificados", null);
      await audit(id, actorId, "pending_action.approve", "succeeded", { kind: KONG_MIRROR_ACTION_TYPE });
    },
    async executed(id, actorId, result) {
      const { storage } = await deps();
      await storage.updatePendingAction(id, { status: "executed", executionResult: result as never, executedAt: new Date() });
      await event(id, actorId, "executed", "approved", "executed", String(result.message || "Merge hecho"), result);
      await audit(id, actorId, KONG_MIRROR_ACTION_TYPE, "succeeded", result);
    },
    async reopen(id, actorId, note) {
      const { storage } = await deps();
      await storage.updatePendingAction(id, { status: "pending", approvedBy: null, approvedAt: null });
      await event(id, actorId, "failed", "approved", "pending", note, null);
      await audit(id, actorId, KONG_MIRROR_ACTION_TYPE, "failed", { note });
    },
    async rejected(id, actorId, note) {
      const { storage } = await deps();
      const current = await storage.getPendingAction(id);
      await storage.updatePendingAction(id, { status: "rejected", rejectionReason: note });
      await event(id, actorId, "rejected", current?.status || "pending", "rejected", note, null);
      await audit(id, actorId, "pending_action.reject", "succeeded", { kind: KONG_MIRROR_ACTION_TYPE, note });
    },
    async closed(id, note) {
      const { storage } = await deps();
      const current = await storage.getPendingAction(id);
      if (!current || !["pending", "edited", "snoozed"].includes(current.status)) return;
      await storage.updatePendingAction(id, { status: "cancelled", rejectionReason: note });
      await event(id, "system", "edited", current.status, "cancelled", note, null);
    },
  };
}

/** Uses the same GitHub client as the KONG repair bridge (GITHUB_TOKEN / GH_TOKEN, else the Replit GitHub connector). */
export function createOctokitMirrorGithub(): MirrorGithub {
  const client = async () => (await import("./github-client")).getGitHubClient();
  const split = (repo: string) => { const [owner, name] = repo.split("/"); return { owner, repo: name }; };
  return {
    async readPull(repo, prNumber) {
      const github = await client();
      const pr = (await github.pulls.get({ ...split(repo), pull_number: prNumber })).data;
      return { state: pr.state, merged: !!pr.merged, headSha: pr.head.sha, baseRepo: pr.base.repo?.full_name || "", baseRef: pr.base.ref, mergeable: pr.mergeable ?? null };
    },
    async readChecks(repo, sha) {
      const github = await client();
      const [checks, statuses] = await Promise.all([
        github.paginate(github.checks.listForRef, { ...split(repo), ref: sha, filter: "latest", per_page: 100 }),
        github.paginate(github.repos.listCommitStatusesForRef, { ...split(repo), ref: sha, per_page: 100 }),
      ]);
      const ok = new Set(["success", "neutral", "skipped"]);
      const bad = checks.filter(check => check.head_sha !== sha || check.status !== "completed" || !ok.has(check.conclusion || ""));
      const statusesOk = statuses.length === 0 || effectiveCommitStatusesPass(statuses);
      const passed = checks.length > 0 && bad.length === 0 && statusesOk;
      const summary = checks.length === 0 ? "sin checks registrados" : bad.length ? `${bad.length} check(s) sin éxito: ${bad.slice(0, 3).map(check => check.name).join(", ")}` : statusesOk ? "todo en verde" : "un estado de commit no está en verde";
      return { passed, summary };
    },
    async merge(repo, prNumber, sha, title) {
      const github = await client();
      const method = ["merge", "squash", "rebase"].includes(process.env.KONG_MIRROR_MERGE_METHOD || "") ? process.env.KONG_MIRROR_MERGE_METHOD as "merge" | "squash" | "rebase" : "squash";
      // `sha` makes GitHub refuse the merge if the head moved after our checks.
      const result = (await github.pulls.merge({ ...split(repo), pull_number: prNumber, sha, merge_method: method, commit_title: `${title} (#${prNumber})`.slice(0, 250) })).data;
      return { merged: !!result.merged, sha: result.sha || null, message: result.message };
    },
    async comment(repo, prNumber, body) {
      const github = await client();
      const created = (await github.issues.createComment({ ...split(repo), issue_number: prNumber, body })).data;
      return { url: created.html_url || null };
    },
  };
}

export function createOctokitChatGithub(): MirrorChatGithub {
  const client = async () => (await import("./github-client")).getGitHubClient();
  const split = (repo: string) => { const [owner, name] = repo.split("/"); return { owner, repo: name }; };
  return {
    async readPullContext(repo, prNumber) {
      const github = await client();
      const [pr, comments, files] = await Promise.all([
        github.pulls.get({ ...split(repo), pull_number: prNumber }).then(result => result.data),
        github.issues.listComments({ ...split(repo), issue_number: prNumber, per_page: 50 }).then(result => result.data),
        github.pulls.listFiles({ ...split(repo), pull_number: prNumber, per_page: 60 }).then(result => result.data),
      ]);
      return { title: pr.title, body: pr.body || "", comments: comments.map(comment => ({ author: comment.user?.login || "?", body: comment.body || "" })),
        files: files.map(file => ({ filename: file.filename, status: file.status, additions: file.additions, deletions: file.deletions, patch: file.patch || "" })) };
    },
  };
}

export function createOctokitScoutGithub(): ScoutGithub {
  const client = async () => (await import("./github-client")).getGitHubClient();
  const split = (repo: string) => { const [owner, name] = repo.split("/"); return { owner, repo: name }; };
  return {
    async createIssue(repo, issue) {
      const github = await client();
      const created = (await github.issues.create({ ...split(repo), title: issue.title, body: issue.body, labels: issue.labels })).data;
      return { number: created.number, url: created.html_url };
    },
    async findPullByBranch(repo, branch) {
      const github = await client();
      const [owner] = repo.split("/");
      const pulls = (await github.pulls.list({ ...split(repo), head: `${owner}:${branch}`, state: "all", per_page: 5 })).data;
      const pull = pulls[0];
      return pull ? { number: pull.number, state: pull.state, merged: !!pull.merged_at } : null;
    },
    async listMirrorRuns(repo, workflow, sinceIso) {
      const github = await client();
      try {
        const runs = await github.paginate(github.actions.listWorkflowRuns, { ...split(repo), workflow_id: workflow, created: `>=${sinceIso.slice(0, 10)}`, per_page: 100 });
        return runs.map(run => ({ id: run.id, status: run.status, runStartedAt: run.run_started_at || null, updatedAt: run.updated_at || null, createdAt: run.created_at }));
      } catch (error) {
        if ((error as { status?: number }).status === 404) return []; // workflow not created yet: no runs, no spend
        throw error;
      }
    },
  };
}

async function recordSpend(usd: number, meta: Record<string, unknown>) {
  const { recordAiApiCostEvent } = await import("./ai-cost-notifications");
  await recordAiApiCostEvent({ userId: getSystemUserId(), provider: meta.provider === "openai" ? "openai" : "gemini", model: String(meta.model || "desconocido"),
    operation: `Mirror Lab KONG (${String(meta.operation || "IA")})`, estimatedCostUsd: usd, metadata: meta });
}

/** Cheap-first: Gemini flash-lite; if it is unpriced/unavailable, a priced cheap OpenAI model. Both counted in one cap. */
export async function createMirrorProviders(): Promise<MirrorChatProvider[]> {
  const { getGeminiChatModel } = await import("./gemini-client");
  const gemini = getGeminiChatModel({ hasImage: false });
  const openaiModel = /^[A-Za-z0-9._-]{1,60}$/.test(process.env.BLACKOPS_MIRROR_OPENAI_MODEL || "") ? process.env.BLACKOPS_MIRROR_OPENAI_MODEL! : "gpt-5.4-mini";
  return [
    { name: "gemini", model: gemini, generate: async (prompt, maxOutputTokens): Promise<MirrorAiCall> => {
      const { getGeminiClient } = await import("./gemini-client");
      const client = await getGeminiClient();
      const result = await client.models.generateContent({ model: gemini, contents: [{ role: "user", parts: [{ text: prompt }] }], config: { maxOutputTokens, temperature: 0.2 } });
      const usage = (result as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } }).usageMetadata || {};
      return { text: result.text || "", inputTokens: usage.promptTokenCount, outputTokens: usage.candidatesTokenCount };
    } },
    { name: "openai", model: openaiModel, generate: async (prompt, maxOutputTokens): Promise<MirrorAiCall> => {
      const { getOpenAIClient } = await import("./openai-client");
      const result = await getOpenAIClient().chat.completions.create({ model: openaiModel, messages: [{ role: "user", content: prompt }], max_completion_tokens: maxOutputTokens });
      return { text: result.choices[0]?.message?.content || "", inputTokens: result.usage?.prompt_tokens, outputTokens: result.usage?.completion_tokens };
    } },
  ];
}

async function createRuntime() {
  const store = await (await import("./agent-council-store")).getCouncilStore();
  const { estimateTokenApiCostUsd } = await import("./ai-cost-notifications");
  const owner = getSystemUserId();
  const price = (provider: string, model: string, inputTokens: number, outputTokens: number) =>
    estimateTokenApiCostUsd({ provider: provider === "openai" ? "openai" : "gemini", model, inputTokens, outputTokens });
  const budget = createMirrorAiBudget({ owner, store, now: Date.now, onSpend: recordSpend });
  const providers = await createMirrorProviders();
  const summaryGenerate = async (prompt: string, maxOutputTokens: number): Promise<MirrorAiCall> => {
    let last: unknown;
    for (const provider of providers) {
      try { return { ...(await provider.generate(prompt, maxOutputTokens)), provider: provider.name, model: provider.model }; }
      catch (error) { last = error; if (!(await import("./kong-mirror-lab")).isMirrorPreflightError(error)) throw error; }
    }
    throw last instanceof Error ? last : new Error("MIRROR_NO_PROVIDER");
  };
  const summarizer = createMirrorSummarizer({ budget, generate: summaryGenerate,
    estimateUsd: call => {
      const used = providers.find(provider => provider.model === call.model);
      return used ? price(used.name, used.model, call.inputTokens, call.outputTokens) : Math.max(...providers.map(provider => price(provider.name, provider.model, call.inputTokens, call.outputTokens)));
    } });
  const academyNamespace = JSON.stringify(["kong-improvement-academy-v1", owner]);
  const lab = createKongMirrorLab({ owner, store, now: Date.now, cards: createStorageMirrorCards(owner), github: createOctokitMirrorGithub(),
    summarize: report => summarizer.summarize(report),
    onMerged: async (entry, card) => {
      const lesson = lessonFromMergedImprovement({ prNumber: entry.prNumber, headSha: entry.headSha, title: entry.title, agents: card?.agents || [], mergedAt: new Date().toISOString() });
      await store.transact(academyNamespace, async raw => {
        const lessons: KongImprovementLesson[] = raw ? JSON.parse(raw).lessons || [] : [];
        if (!lessons.some(item => item.id === lesson.id)) lessons.unshift(lesson);
        return JSON.stringify({ version: 1, lessons: lessons.slice(0, 500) });
      });
    } });
  const chat = createMirrorChat({ owner, store, now: Date.now, budget, providers, estimateUsd: price, github: createOctokitChatGithub(), lab });
  const scouts = createKongImprovementScouts({ owner, store, now: Date.now, github: createOctokitScoutGithub(),
    mirrorStatusFor: async prNumber => (await lab.list()).find(row => row.prNumber === prNumber)?.status || null,
    readInputs: async (): Promise<ScoutInputs> => {
      const { runOfficeKongReadOnly } = await import("./office-kong");
      const kong = await runOfficeKongReadOnly();
      const repairs = await (async () => {
        const bridge = await (await import("./kong-repair-runtime")).getKongRepairBridge().catch(() => undefined);
        return bridge ? (await bridge.view()).entries.map(entry => ({ key: entry.key, status: entry.status, summary: entry.payload.summary })) : [];
      })().catch(() => []);
      const lessons = await (async () => (await (await import("./agent-council")).getAgentCouncil().load()).lessons.map(lesson => ({ key: lesson.key, label: lesson.label, subject: lesson.subject })))().catch(() => []);
      return { agents: kong.evidence.agents.map(agent => ({ id: agent.id, name: agent.name, blocker: agent.blocker, issues: agent.issues, nextAction: agent.nextAction, coverage: agent.coverage })),
        cities: kong.evidence.cities.map(city => ({ id: city.id, name: city.name, categories: city.categories })), repairs, lessons };
    } });
  const academy = async () => { const raw = await store.read(academyNamespace); return raw ? (JSON.parse(raw).lessons || []) as KongImprovementLesson[] : []; };
  return { lab, budget, chat, scouts, academy };
}

let runtime: ReturnType<typeof createRuntime> | undefined;
function getRuntime() {
  return runtime ||= createRuntime().catch(error => { runtime = undefined; throw error; });
}

/** Month-to-date Mirror Lab AI spend (summary + chat) for /api/ai-spend/monthly. */
export async function readKongMirrorSummarySpend() {
  const spend = await (await getRuntime()).budget.monthSpend();
  return { id: "kong_mirror_ai", label: `IA Mirror Lab KONG (tope $${spend.capUsd})`, amountUsd: spend.spentUsd, count: spend.calls, kind: "estimated" as const };
}

export type MirrorRouteRuntime = { lab: Lab; chat?: Chat; scouts?: Scouts; budget?: Budget; academy?: () => Promise<KongImprovementLesson[]> };
export function registerKongMirrorRoutes(app: Express, options: { resolve?: () => Promise<Lab>; runtime?: () => Promise<MirrorRouteRuntime>; owner?: (req: Request) => boolean; secret?: () => string | undefined; sameOrigin?: (req: Request) => boolean } = {}) {
  const full: () => Promise<MirrorRouteRuntime> = options.runtime || (options.resolve ? async () => ({ lab: await options.resolve!() }) : getRuntime);
  const resolve = async () => (await full()).lab;
  if (!options.runtime && !options.resolve && process.env.KONG_IMPROVEMENT_SCOUTS_ENABLED === "true") startScoutLoop(async () => (await getRuntime()).scouts.run());
  let budgetCache: { at: number; value: unknown } | undefined;
  const mirrorBudget = async () => {
    const rt = await full();
    if (!rt.scouts) return null;
    if (budgetCache && Date.now() - budgetCache.at < 5 * 60_000) return budgetCache.value;
    const value = await rt.scouts.mirrorBudget().catch(() => null);
    budgetCache = { at: Date.now(), value };
    return value;
  };
  const owner = options.owner || ((req: Request) => { const id = getAuthenticatedCurrentUserId(req); return !!id && id === getSystemUserId(); });
  const secret = options.secret || (() => process.env.KONG_MIRROR_REPORT_HMAC_SECRET);
  const sameOrigin = options.sameOrigin || officeSameOrigin;
  const actor = (req: Request) => getAuthenticatedCurrentUserId(req) || "owner";

  app.post(KONG_MIRROR_REPORT_PATH, async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const raw = Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.isBuffer(req.body) ? req.body : undefined;
      const lab = await resolve();
      const result = await lab.receive(raw, req.get("x-kong-mirror-signature"), req.get("x-kong-mirror-timestamp"), secret());
      return res.status(result.duplicate ? 200 : 202).json(result);
    } catch (error) {
      if (error instanceof MirrorError) return res.status(error.status).json({ accepted: false, code: error.code, ...(error.code === "MIRROR_REPLAY" ? { alreadyRecorded: true } : {}) });
      return res.status(503).json({ accepted: false, code: "MIRROR_UNAVAILABLE" });
    }
  });

  app.get("/api/kong-mirror/reports", async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!owner(req)) return res.status(403).json({ code: "MIRROR_OWNER_REQUIRED" });
    try {
      const rt = await full();
      const reports = await rt.lab.list();
      const [aiBudget, scouts, academy, mirror] = await Promise.all([
        rt.budget ? rt.budget.monthSpend().catch(() => null) : null, rt.scouts ? rt.scouts.view().catch(() => null) : null,
        rt.academy ? rt.academy().catch(() => []) : [], mirrorBudget()]);
      return res.json({ reports, pendingCount: reports.filter(report => report.status === "carded" && ["pending", "edited", "snoozed"].includes(report.pendingStatus || "")).length,
        aiBudget, mirrorBudget: mirror, scouts, academy: academy.slice(0, 30) });
    } catch { return res.status(503).json({ code: "MIRROR_UNAVAILABLE" }); }
  });

  app.get("/api/kong-mirror/images/:imageKey", async (req, res) => {
    if (!owner(req)) return res.status(403).end();
    try {
      const image = await (await resolve()).image(String(req.params.imageKey || ""));
      if (!image) return res.status(404).end();
      res.set({ "Content-Type": image.mime, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'" });
      return res.end(image.bytes);
    } catch { return res.status(503).end(); }
  });

  app.post("/api/kong-mirror/:key/:decision", async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!owner(req) || !sameOrigin(req)) return res.status(403).json({ code: "MIRROR_OWNER_REQUIRED", message: "Solo Robert puede decidir sobre esta mejora." });
    const key = String(req.params.key || "");
    if (!/^kong-mirror:[a-f0-9]{64}$/.test(key)) return res.status(404).json({ code: "MIRROR_NOT_FOUND" });
    try {
      const lab = await resolve();
      if (req.params.decision === "approve") {
        if (req.body?.confirm !== true) return res.status(400).json({ code: "MIRROR_CONFIRM_REQUIRED", message: "Confirma el merge con un segundo clic." });
        const result = await lab.approve(key, { actorId: actor(req), headSha: req.body?.headSha });
        return result.ok ? res.json(result) : res.status(result.status).json(result);
      }
      if (req.params.decision === "reject") {
        const result = await lab.reject(key, { actorId: actor(req), note: req.body?.note });
        return result.ok ? res.json(result) : res.status(result.status).json(result);
      }
      if (req.params.decision === "chat") {
        const rt = await full();
        if (!rt.chat) return res.status(503).json({ code: "MIRROR_CHAT_UNAVAILABLE", message: "El chat no está disponible." });
        const result = await rt.chat.ask(key, { message: req.body?.message });
        return result.ok ? res.json({ ...result, thread: await rt.chat.thread(key) }) : res.status(result.status).json(result);
      }
      if (req.params.decision === "change-request") {
        const result = await lab.requestChange(key, { actorId: actor(req), text: req.body?.text, idempotencyKey: req.body?.idempotencyKey });
        if (!result.ok) return res.status(result.status).json(result);
        // Robert's own requests are never blocked by the mirror budget; he just sees the estimate.
        const budget = await mirrorBudget() as { paused?: boolean; label?: string; perRunUsd?: number } | null;
        const warning = budget ? `${budget.label}. Cada nueva prueba cuesta ~$${budget.perRunUsd} (estimado)${budget.paused ? ". Ya superaste el presupuesto del mes; esta prueba igual se hará porque la pediste tú." : "."}` : null;
        return res.json({ ...result, mirrorBudget: budget, warning });
      }
      return res.status(404).json({ code: "MIRROR_NOT_FOUND" });
    } catch { return res.status(503).json({ code: "MIRROR_UNAVAILABLE", message: "No se pudo completar. No se fusionó nada." }); }
  });

  app.get("/api/kong-mirror/:key/chat", async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!owner(req)) return res.status(403).json({ code: "MIRROR_OWNER_REQUIRED" });
    const key = String(req.params.key || "");
    if (!/^kong-mirror:[a-f0-9]{64}$/.test(key)) return res.status(404).json({ code: "MIRROR_NOT_FOUND" });
    try {
      const rt = await full();
      return res.json({ thread: rt.chat ? await rt.chat.thread(key) : [] });
    } catch { return res.status(503).json({ code: "MIRROR_UNAVAILABLE" }); }
  });
}
