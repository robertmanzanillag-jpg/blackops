import { createHash } from "node:crypto";
import { z } from "zod";
import { CLAUDE_CODE_FOOTER, redactForGithub, type MirrorStore } from "./kong-mirror-lab";

/**
 * "Equipo de mejoras KONG": deterministic scouts ($0, no AI) that read the KONG evidence BlackOps already
 * reads and propose improvements. Code proposals become ONE GitHub issue each in kong-nightlife asking
 * @codex for a PR (label mirror-lab) so the Mirror Lab tests it and the result arrives as a card.
 * Never-auto areas are only reported as "requiere decisión de Robert". No count caps: only dedupe,
 * the off switch KONG_IMPROVEMENT_SCOUTS_ENABLED and the monthly mirror-lab spend budget.
 */
export const KONG_IMPROVEMENT_REPOSITORY = "robertmanzanillag-jpg/kong-nightlife";
export const KONG_MIRROR_WORKFLOW = "kong-mirror-lab.yml";
export const SCOUT_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const DEFAULT_MIRROR_RUN_MINUTES = 45;

export const kongProductionBranch = (env: NodeJS.ProcessEnv = process.env) =>
  /^[A-Za-z0-9._\/-]{1,200}$/.test(env.KONG_PRODUCTION_BRANCH || "") ? env.KONG_PRODUCTION_BRANCH! : "claude/genre-fixes-570";
export const scoutsEnabled = (env: NodeJS.ProcessEnv = process.env) => env.KONG_IMPROVEMENT_SCOUTS_ENABLED === "true";

// ---- Mirror-lab GitHub Actions spend (estimate, always counted from $0) ----
export function resolveMirrorRunBudgetUsd(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.KONG_MIRROR_MONTHLY_USD;
  if (raw === undefined || raw.trim() === "") return 20;
  const value = Number(raw);
  if (!Number.isFinite(value)) return 0; // unreadable value: fail closed (no new runs requested)
  return Math.min(500, Math.max(0, value));
}
export function resolveMirrorUsdPerMinute(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.KONG_MIRROR_USD_PER_MINUTE;
  const value = raw === undefined || raw.trim() === "" ? 0.008 : Number(raw);
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.008;
}
export type MirrorWorkflowRun = { id: number; status: string | null; runStartedAt: string | null; updatedAt: string | null; createdAt: string };
const round = (value: number) => Math.round(value * 100) / 100;
export function estimateMirrorSpend(runs: MirrorWorkflowRun[], now: number, env: NodeJS.ProcessEnv = process.env) {
  const rate = resolveMirrorUsdPerMinute(env), budgetUsd = resolveMirrorRunBudgetUsd(env);
  const date = new Date(now), monthStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1), nextMonth = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
  const minutesOf = (run: MirrorWorkflowRun) => {
    const start = Date.parse(run.runStartedAt || ""), end = Date.parse(run.updatedAt || "");
    if (run.status === "completed" && Number.isFinite(start) && Number.isFinite(end) && end >= start) return { minutes: Math.max(1, Math.ceil((end - start) / 60000)), measured: true };
    return { minutes: DEFAULT_MIRROR_RUN_MINUTES, measured: false };
  };
  const month = runs.filter(run => { const at = Date.parse(run.runStartedAt || run.createdAt); return at >= monthStart && at < nextMonth; });
  const sized = month.map(minutesOf), measured = sized.filter(row => row.measured);
  const spentUsd = round(sized.reduce((sum, row) => sum + row.minutes, 0) * rate);
  const perRunMinutes = measured.length ? Math.ceil(measured.reduce((sum, row) => sum + row.minutes, 0) / measured.length) : DEFAULT_MIRROR_RUN_MINUTES;
  const perRunUsd = round(perRunMinutes * rate);
  const paused = budgetUsd <= 0 || spentUsd + perRunUsd > budgetUsd;
  return { estimate: true as const, budgetUsd, spentUsd, perRunUsd, perRunMinutes, runsThisMonth: month.length, usdPerMinute: rate, paused,
    resumesAt: new Date(nextMonth).toISOString(),
    label: `Pruebas del mes: $${spentUsd.toFixed(2)} de $${budgetUsd} (estimado)`,
    pausedLabel: paused ? "En pausa por presupuesto hasta el 1 del próximo mes" : null };
}
export type MirrorSpendEstimate = ReturnType<typeof estimateMirrorSpend>;

// ---- Proposals ----
// Fail closed: stems and plurals in Spanish and English ("authentication", "migraciones", "notifications" ...).
export const NEVER_AUTO: Array<{ area: string; pattern: RegExp }> = [
  { area: "pagos/Stripe", pattern: /\b(stripe|pag(o|os|ar|ado|ados)|payments?|payouts?|checkout|cobr\w*|factur\w*|invoices?|refunds?|reembols\w*|billing|charges?|credit cards?|tarjetas? de credito)\b/ },
  { area: "auth/permisos", pattern: /\b(auth(?!or)\w*|autentica\w*|autoriza\w*|log ?ins?|log ?outs?|sign ?(in|up|on|out)|sesion(es)?|sessions?|passwords?|contrasenas?|permisos?|permissions?|rol|roles?|oauth|2fa|mfa|tokens?|credenciales?|credentials?|admin access)\b/ },
  { area: "precios", pattern: /\b(precios?|pricing|prices?|tarifas?|suscripcion(es)?|subscriptions?|descuentos?|discounts?|cupon(es)?|coupons?)\b/ },
  { area: "mensajes a usuarios", pattern: /\b(whatsapp|telegram|sms|e-?mails?|correos?|push|notificacion(es)?|notifications?|newsletters?|mensajeria|mensajes? a (los )?usuarios|messages? to users|user messag\w*)\b/ },
  { area: "esquema de BD/borrados", pattern: /\b(schemas?|esquemas?|migracion(es)?|migrations?|drop table|alter table|delet\w*|borr\w*|eliminar datos|truncate)\b/ },
  { area: "legal", pattern: /\b(legal|privacidad|privacy|terminos|terms|gdpr|ccpa|consentimiento|consent|cookies?|copyright|licencias?|licenses?)\b/ },
];
const fold = (value: string) => value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
export function neverAutoArea(text: string): string | null {
  const folded = fold(text);
  return NEVER_AUTO.find(rule => rule.pattern.test(folded))?.area || null;
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const norm = (value: string) => fold(value).replace(/\d+/g, "#").replace(/\s+/g, " ").trim().slice(0, 200);
export const slugify = (value: string, key: string) => `${fold(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "mejora"}-${key.slice(0, 6)}`;

export type KongImprovementProposal = {
  key: string; slug: string; source: string; title: string; problem: string; evidence: string[]; change: string; benefit: string;
  risk: "bajo" | "medio" | "alto"; kind: "code" | "decision"; neverAutoArea: string | null;
};
type SnapshotAgent = { id: string; name: string; blocker?: string | null; issues?: string[]; nextAction?: string; coverage?: { configurationNotices?: string[] } };
type SnapshotCategory = { category: string; recordedFailure?: boolean; attemptsSinceSuccess?: number; issues?: string[] };
export type ScoutInputs = {
  agents: SnapshotAgent[];
  cities: Array<{ id: string; name: string; categories: SnapshotCategory[] }>;
  repairs: Array<{ key: string; status: string; summary: string }>;
  lessons: Array<{ key: string; label: string; subject?: string }>;
};

/** Deterministic, $0. The same signal always yields the same key, so open items are never re-proposed. */
export function deriveKongImprovementProposals(input: ScoutInputs): KongImprovementProposal[] {
  const out = new Map<string, KongImprovementProposal>();
  const add = (source: string, signal: string, base: Omit<KongImprovementProposal, "key" | "slug" | "source" | "kind" | "neverAutoArea">) => {
    const key = `kong-mejora:${hash([source, norm(signal)]).slice(0, 24)}`;
    if (out.has(key)) return;
    const area = neverAutoArea(`${base.title} ${base.problem} ${base.change} ${base.evidence.join(" ")}`);
    out.set(key, { ...base, key, slug: slugify(base.title, key.split(":")[1]), source, kind: area ? "decision" : "code", neverAutoArea: area,
      risk: area ? "alto" : base.risk, change: area ? `Requiere decisión de Robert (${area}): ${base.change}` : base.change });
  };
  for (const agent of input.agents.slice(0, 200)) {
    if (agent.blocker && agent.blocker.trim()) add("bloqueo", `${agent.id}:${agent.blocker}`, {
      title: `Desbloquear ${agent.name}`.slice(0, 120), problem: `El agente ${agent.name} está bloqueado: ${agent.blocker.slice(0, 300)}`,
      evidence: [`${agent.name}: ${agent.blocker.slice(0, 300)}`, ...(agent.nextAction ? [`Siguiente acción registrada: ${agent.nextAction.slice(0, 200)}`] : [])],
      change: "Corregir la causa del bloqueo en KONG y añadir una prueba que lo cubra.", benefit: `${agent.name} vuelve a trabajar sin intervención manual.`, risk: "medio" });
    for (const notice of agent.coverage?.configurationNotices || []) if (/g[eé]nero|genre/i.test(notice)) add("generos", notice, {
      title: `Cobertura de géneros: ${notice.slice(0, 80)}`, problem: `Aviso de cobertura de géneros en ${agent.name}: ${notice.slice(0, 300)}`, evidence: [`${agent.name}: ${notice.slice(0, 300)}`],
      change: "Completar el mapeo/cobertura de géneros indicado y añadir prueba de cobertura.", benefit: "Más eventos clasificados por género para los usuarios.", risk: "bajo" });
  }
  const repeated = new Map<string, { text: string; agents: string[] }>();
  for (const agent of input.agents) for (const issue of agent.issues || []) {
    const id = norm(issue); if (!id) continue;
    const row = repeated.get(id) || { text: issue, agents: [] };
    if (!row.agents.includes(agent.name)) row.agents.push(agent.name);
    repeated.set(id, row);
  }
  for (const row of repeated.values()) if (row.agents.length >= 2) add("repetido", row.text, {
    title: `Problema repetido: ${row.text.slice(0, 90)}`, problem: `${row.agents.length} agentes reportan lo mismo: ${row.text.slice(0, 300)}`, evidence: row.agents.slice(0, 8).map(name => `${name}: ${row.text.slice(0, 200)}`),
    change: "Arreglar la causa común una sola vez (no en cada agente) con prueba de regresión.", benefit: `Quita el mismo problema a ${row.agents.length} agentes.`, risk: "medio" });
  const failing = new Map<string, string[]>();
  for (const city of input.cities.slice(0, 200)) for (const category of city.categories || [])
    if (category.recordedFailure || (category.attemptsSinceSuccess || 0) >= 3) failing.set(category.category, [...(failing.get(category.category) || []), city.name]);
  for (const [category, cities] of failing) add("ciudades", category, {
    title: `Trabajo "${category}" falla en ciudades`, problem: `El trabajo de ${category} registra fallos en ${cities.length} ciudad(es).`, evidence: cities.slice(0, 10).map(name => `${name}: fallo registrado en ${category}`),
    change: `Revisar el job de ${category}, hacerlo tolerante al fallo detectado y añadir prueba.`, benefit: "Datos frescos en todas las ciudades.", risk: "medio" });
  for (const repair of input.repairs.slice(0, 100)) if (/^blocked_|maker_failed|held_stale_base/.test(repair.status)) add("reparacion", repair.key, {
    title: `Reparación KONG atascada: ${repair.summary.slice(0, 80)}`, problem: `La reparación ${repair.key.slice(0, 30)} está en estado ${repair.status}.`, evidence: [repair.summary.slice(0, 300)],
    change: "Tomar la reparación atascada como mejora pequeña con prueba de regresión.", benefit: "Cierra un error real reportado por KONG.", risk: "medio" });
  for (const lesson of input.lessons.slice(0, 50)) if (/kong/i.test(`${lesson.label} ${lesson.subject || ""}`)) add("academia", lesson.key, {
    title: `Aplicar lección de la Academia: ${lesson.label.slice(0, 80)}`, problem: `Lección aprobada en la Academia que KONG aún no aplica: ${lesson.label.slice(0, 300)}`, evidence: [`Academia: ${lesson.label.slice(0, 300)}`],
    change: "Convertir la lección en una regla o prueba en KONG.", benefit: "Lo aprendido queda en el código, no solo en la oficina.", risk: "bajo" });
  return [...out.values()];
}

export function buildImprovementIssue(proposal: KongImprovementProposal, productionBranch: string) {
  const branch = `improve/${proposal.slug}`;
  const body = [
    `Improvement key: ${proposal.key}`,
    "Detected by the BlackOps \"Equipo de mejoras KONG\" scouts (deterministic, $0).",
    "",
    `**Problem (evidence from KONG operations):** ${redactForGithub(proposal.problem)}`,
    ...proposal.evidence.map(line => `- ${redactForGithub(line)}`),
    "",
    `**Proposed change:** ${redactForGithub(proposal.change)}`,
    `**Expected benefit:** ${redactForGithub(proposal.benefit)}`,
    `**Risk class:** ${proposal.risk}`,
    "",
    "@codex Please implement this improvement:",
    `1. Create a branch named \`${branch}\` from \`${productionBranch}\`.`,
    "2. Keep the change small and scoped; add or update tests and keep all checks green.",
    "3. Do not touch payments/Stripe, auth/permissions, pricing, user messaging, database schema/deletes or legal pages.",
    `4. Open a pull request against \`${productionBranch}\` with the label \`mirror-lab\` and include \`Improvement key: ${proposal.key}\` in the PR body, so the KONG mirror lab tests it automatically.`,
    "5. Do not merge or deploy; the owner approves from BlackOps.",
  ].join("\n") + CLAUDE_CODE_FOOTER;
  return { title: `[improve] ${proposal.title}`.slice(0, 200), body, labels: ["improve"], branch };
}

const ledgerEntry = z.object({
  key: z.string(), slug: z.string(), source: z.string(), title: z.string(), problem: z.string(), evidence: z.array(z.string()), change: z.string(), benefit: z.string(),
  risk: z.enum(["bajo", "medio", "alto"]), kind: z.enum(["code", "decision"]), neverAutoArea: z.string().nullable(), generation: z.number().int().positive(),
  status: z.enum(["decision", "proposed", "building", "testing", "ready", "merged", "closed"]),
  issueUrl: z.string().nullable(), issueNumber: z.number().nullable(), prNumber: z.number().nullable(), createdAt: z.string(), lastSeenAt: z.string(), pausedByBudget: z.boolean().optional(),
}).strict();
const ledgerSchema = z.object({ version: z.literal(1), lastRunAt: z.string().nullable(), lastError: z.string().nullable(), lastBudget: z.any().optional(), entries: z.array(ledgerEntry) }).strict();
export type ScoutLedgerEntry = z.infer<typeof ledgerEntry>;

export interface ScoutGithub {
  createIssue(repo: string, issue: { title: string; body: string; labels: string[] }): Promise<{ number: number; url: string }>;
  findPullByBranch(repo: string, branch: string): Promise<{ number: number; state: string; merged: boolean } | null>;
  listMirrorRuns(repo: string, workflow: string, sinceIso: string): Promise<MirrorWorkflowRun[]>;
}

export function createKongImprovementScouts(options: { owner: string; store: MirrorStore; now: () => number; env?: NodeJS.ProcessEnv; github: ScoutGithub;
  readInputs: () => Promise<ScoutInputs>; mirrorStatusFor: (prNumber: number) => Promise<string | null> }) {
  const env = options.env || process.env;
  const namespace = JSON.stringify(["kong-improvement-scouts-v1", options.owner]);
  const parse = (raw: string | null) => raw ? ledgerSchema.parse(JSON.parse(raw)) : { version: 1 as const, lastRunAt: null, lastError: null, entries: [] as ScoutLedgerEntry[] };
  const iso = () => new Date(options.now()).toISOString();
  const save = (change: (ledger: ReturnType<typeof parse>) => void) => options.store.transact(namespace, async raw => { const ledger = parse(raw); change(ledger); return JSON.stringify(ledgerSchema.parse(ledger)); });

  async function mirrorBudget() {
    const date = new Date(options.now()), since = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString();
    let runs: MirrorWorkflowRun[] = [], readable = true;
    try { runs = await options.github.listMirrorRuns(KONG_IMPROVEMENT_REPOSITORY, KONG_MIRROR_WORKFLOW, since); } catch { readable = false; }
    const estimate = estimateMirrorSpend(runs, options.now(), env);
    // Unreadable run history: assume the worst for NEW scout requests (Robert's own requests are never blocked).
    return readable ? { ...estimate, runsReadable: true } : { ...estimate, paused: true, runsReadable: false, pausedLabel: "En pausa: no pude leer el gasto de las pruebas en GitHub" };
  }

  async function run(input: { force?: boolean } = {}) {
    const ledger = parse(await options.store.read(namespace));
    if (!input.force && ledger.lastRunAt && options.now() - Date.parse(ledger.lastRunAt) < SCOUT_INTERVAL_MS) return { ran: false as const, reason: "cadence" };
    let proposals: KongImprovementProposal[] = [], error: string | null = null;
    try { proposals = deriveKongImprovementProposals(await options.readInputs()); } catch { error = "No se pudo leer la evidencia de KONG"; }
    const budget = await mirrorBudget();
    const branch = kongProductionBranch(env);
    let opened = 0, pausedByBudget = 0;
    const known = new Map(ledger.entries.map(entry => [entry.key, entry]));
    for (const proposal of proposals) {
      const prior = known.get(proposal.key);
      // Dedupe: a key is proposed once. A merged or closed PR is final for that signal (a merge is not live until
      // Robert republishes KONG, and a closed PR is his "no"), so it never reopens an issue every 6 h.
      if (prior) { prior.lastSeenAt = iso(); if (!(prior.status === "proposed" && proposal.kind === "code")) continue; }
      const entry: ScoutLedgerEntry = prior || { ...proposal, generation: 1, status: proposal.kind === "decision" ? "decision" : "proposed",
        issueUrl: null, issueNumber: null, prNumber: null, createdAt: iso(), lastSeenAt: iso() };
      if (!prior) known.set(entry.key, entry);
      if (entry.kind !== "code" || entry.status !== "proposed") continue;
      if (budget.paused) { entry.pausedByBudget = true; pausedByBudget++; continue; }
      try {
        const issue = await options.github.createIssue(KONG_IMPROVEMENT_REPOSITORY, buildImprovementIssue(proposal, branch));
        entry.issueUrl = issue.url; entry.issueNumber = issue.number; entry.status = "building"; entry.pausedByBudget = false; opened++;
      } catch { entry.status = "proposed"; }
    }
    // Track progress: issue → PR (en pruebas) → card (lista) → merged.
    for (const entry of known.values()) {
      if (!["building", "testing", "ready"].includes(entry.status)) continue;
      try {
        const pull = await options.github.findPullByBranch(KONG_IMPROVEMENT_REPOSITORY, `improve/${entry.slug}`);
        if (!pull) continue;
        entry.prNumber = pull.number;
        if (pull.merged) entry.status = "merged";
        else if (pull.state !== "open") entry.status = "closed";
        else entry.status = (await options.mirrorStatusFor(pull.number)) === "carded" ? "ready" : "testing";
      } catch { /* keep the previous status */ }
    }
    await save(next => { next.entries = [...known.values()]; next.lastRunAt = iso(); next.lastError = error; next.lastBudget = budget; });
    return { ran: true as const, proposals: proposals.length, opened, pausedByBudget, budget };
  }

  async function view() {
    const ledger = parse(await options.store.read(namespace));
    const count = (status: string) => ledger.entries.filter(entry => entry.status === status).length;
    return {
      enabled: scoutsEnabled(env), lastRunAt: ledger.lastRunAt, lastError: ledger.lastError, intervalHours: SCOUT_INTERVAL_MS / 3600000, productionBranch: kongProductionBranch(env),
      counts: { open: ledger.entries.filter(entry => !["merged", "closed"].includes(entry.status)).length, building: count("building"), testing: count("testing"), ready: count("ready"),
        decisions: count("decision"), proposed: count("proposed"), merged: count("merged") },
      proposals: [...ledger.entries].sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt)).slice(0, 40),
    };
  }
  return { run, view, mirrorBudget };
}

/** Same style as the KONG repair pull loop: env-gated, unref'd interval, persisted cadence guard. */
let stopScoutLoop: (() => void) | undefined;
export function startScoutLoop(run: () => Promise<unknown>, env: NodeJS.ProcessEnv = process.env) {
  if (stopScoutLoop || !scoutsEnabled(env)) return;
  const tick = () => { run().catch(() => undefined); };
  const first = setTimeout(tick, 60_000); first.unref();
  const timer = setInterval(tick, SCOUT_INTERVAL_MS); timer.unref();
  stopScoutLoop = () => { clearTimeout(first); clearInterval(timer); stopScoutLoop = undefined; };
}
