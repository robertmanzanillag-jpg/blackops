// CEO Black Room: supervises the whole Black Room team (the five new agents plus the existing
// blackroom-videos and radio) and writes a deterministic daily brief: what each agent did or is
// blocked on, priorities, delegations, items waiting for Robert and risks.
//
// Safety: the CEO never approves, posts or publishes anything. Approvals stay in each agent's own
// queue and are escalated to Robert. The optional Telegram summary goes only to Robert's own
// configured chat, and only when BLACKROOM_CEO_TELEGRAM=true (off by default).
// Cost: no LLM. Posting strategy reuses server/blackroom-growth-ceo.ts (campaign planning and
// learning slots) over the analytics the growth CEO already stores in the Black Room queue.
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  BLACKROOM_DEPARTMENT_ORDER,
  BLACKROOM_TEAM_BY_ID,
  BLACKROOM_TEAM_WORKING_FRESH_MS,
  isBlackRoomTeamAgentId,
  type BlackRoomTeamAgentModule,
  type BlackRoomTeamContext,
  type BlackRoomTeamMemberId,
  type BlackRoomTeamRunResult,
  type BlackRoomTeamState,
  type BlackRoomTeamStatus,
} from "@shared/blackroom-team";
import {
  BLACKROOM_CEO_DAILY_POSTS,
  buildBlackRoomLearningSlots,
  planBlackRoomCampaignPosts,
  type BlackRoomCeoAnalytics,
} from "../blackroom-growth-ceo";
import { BLACKROOM_TIMEZONE } from "../blackroom-metricool-bridge";

const ID = "blackroom-ceo" as const;
const MAX_BRIEFS = 14;
const TIMEZONE = BLACKROOM_TIMEZONE;

const LEGACY_NAMES: Record<string, string> = { "blackroom-videos": "Videos Black Room", radio: "Radio" };

export function blackRoomMemberName(id: BlackRoomTeamMemberId): string {
  return isBlackRoomTeamAgentId(id) ? BLACKROOM_TEAM_BY_ID[id].name : LEGACY_NAMES[id] || id;
}

// ---------------------------------------------------------------------------
// Brief model
// ---------------------------------------------------------------------------

export type BlackRoomCeoMemberLine = {
  id: BlackRoomTeamMemberId;
  name: string;
  /** "unreachable" when the teammate status could not be read at all. */
  state: BlackRoomTeamState | "unreachable";
  label: string;
  summary: string;
  needs: string[];
  lastRunAt: string | null;
  /** True only when the agent reports working with a run inside the 26h window. */
  ranRecently: boolean;
  pendingApprovals: number;
};

export type BlackRoomCeoDelegation = { agentId: BlackRoomTeamMemberId | "robert"; name: string; task: string };
export type BlackRoomCeoEscalation = { agentId: BlackRoomTeamMemberId; name: string; pending: number; note: string };

export type BlackRoomCeoStrategy = {
  source: "growth-ceo" | "sin-datos";
  postsToday: number;
  slots: string[];
  creativeStrategy: string | null;
  confidence: string;
  reason: string;
};

export type BlackRoomCeoTelegramResult = { sent: boolean; note: string };

export type BlackRoomCeoBrief = {
  id: string;
  createdAt: string;
  date: string;
  summary: string;
  counts: { working: number; available: number; blocked: number; idle: number; unreachable: number; pendingApprovals: number };
  members: BlackRoomCeoMemberLine[];
  priorities: string[];
  delegations: BlackRoomCeoDelegation[];
  approvalsForRobert: BlackRoomCeoEscalation[];
  risks: string[];
  strategy: BlackRoomCeoStrategy;
  telegram: BlackRoomCeoTelegramResult;
};

export type BlackRoomCeoState = { version: 1; lastRunAt: string | null; briefs: BlackRoomCeoBrief[] };

const EMPTY_STATE: BlackRoomCeoState = { version: 1, lastRunAt: null, briefs: [] };

function normalizeState(raw: unknown): BlackRoomCeoState {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("estado del CEO con formato no valido");
  const body = raw as Partial<BlackRoomCeoState>;
  const briefs = Array.isArray(body.briefs) ? body.briefs.filter((brief) => brief && typeof brief === "object" && typeof brief.createdAt === "string") : [];
  const lastRunAt = typeof body.lastRunAt === "string" && Number.isFinite(Date.parse(body.lastRunAt)) ? body.lastRunAt : null;
  return { version: 1, lastRunAt, briefs: briefs.slice(-MAX_BRIEFS) };
}

function localDate(now: Date): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(now).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function isFresh(lastRunAt: string | null, now: number): boolean {
  const at = lastRunAt ? Date.parse(lastRunAt) : Number.NaN;
  return Number.isFinite(at) && at <= now + 5_000 && now - at <= BLACKROOM_TEAM_WORKING_FRESH_MS;
}

function memberLine(id: BlackRoomTeamMemberId, status: BlackRoomTeamStatus | null, now: number): BlackRoomCeoMemberLine {
  const name = blackRoomMemberName(id);
  if (!status) {
    return { id, name, state: "unreachable", label: "Sin lectura", summary: "No se pudo leer el estado de este agente.", needs: [], lastRunAt: null, ranRecently: false, pendingApprovals: 0 };
  }
  return {
    id,
    name,
    state: status.state,
    label: status.label,
    summary: status.summary,
    needs: status.needs.slice(0, 5),
    lastRunAt: status.lastRunAt,
    ranRecently: status.state === "working" && isFresh(status.lastRunAt, now),
    pendingApprovals: Math.max(0, status.pendingApprovals || 0),
  };
}

/** What each agent should do next when it is not blocked (deterministic, Spanish). */
const NEXT_TASK: Record<BlackRoomTeamMemberId, string> = {
  "blackroom-ceo": "",
  "blackroom-analytics": "Sacar el reporte de redes de hoy: alcance, vistas, interacciones y el mejor post.",
  "blackroom-competition": "Revisar a la competencia: que les funciona mejor, eventos de la semana y sus metricas.",
  "blackroom-publisher": "Preparar los posteos del plan de hoy en borrador (dry-run) para que Robert los apruebe.",
  "blackroom-scripts": "Proponer ideas y guiones para los proximos videos y preparar la edicion de los videos grabados que lleguen.",
  "blackroom-website": "Revisar que el sitio web este en linea, sin errores y con los eventos actualizados.",
  "blackroom-videos": "Mantener la cola de clips al dia segun el plan del CEO de crecimiento.",
  radio: "Confirmar los slots y DJs de la radio de este mes.",
};

export function planBlackRoomCeoStrategy(analytics: BlackRoomCeoAnalytics | null, now: Date): BlackRoomCeoStrategy {
  const dayIndex = Math.floor(new Date(`${localDate(now)}T12:00:00.000Z`).getTime() / 86400_000);
  if (!analytics) {
    const slots = buildBlackRoomLearningSlots({ dayIndex, posts: BLACKROOM_CEO_DAILY_POSTS, sampleCount: 0 });
    return { source: "sin-datos", postsToday: BLACKROOM_CEO_DAILY_POSTS, slots, creativeStrategy: null, confidence: "sin datos", reason: "Todavia no hay analiticas del CEO de crecimiento; se usa el plan base de 5 posteos." };
  }
  const postsToday = planBlackRoomCampaignPosts({ dayIndex, analytics });
  const slots = buildBlackRoomLearningSlots({ dayIndex, posts: postsToday, recommendedTimes: analytics.recommendedTimes || [], sampleCount: analytics.comparableSampleCount ?? analytics.sampleCount });
  return {
    source: "growth-ceo",
    postsToday,
    slots,
    creativeStrategy: analytics.creativeStrategy || null,
    confidence: analytics.confidence === "learning" ? "aprendiendo" : "recolectando",
    reason: String(analytics.creativeReason || analytics.reason || "").slice(0, 240),
  };
}

export function buildBlackRoomCeoBrief(input: {
  now: Date;
  statuses: Partial<Record<BlackRoomTeamMemberId, BlackRoomTeamStatus | null>>;
  analytics: BlackRoomCeoAnalytics | null;
  analyticsError?: string | null;
  telegram?: BlackRoomCeoTelegramResult;
}): BlackRoomCeoBrief {
  const nowMs = input.now.getTime();
  const members = BLACKROOM_DEPARTMENT_ORDER.filter((id) => id !== ID).map((id) => memberLine(id, input.statuses[id] ?? null, nowMs));
  const counts = { working: 0, available: 0, blocked: 0, idle: 0, unreachable: 0, pendingApprovals: 0 };
  for (const member of members) {
    counts[member.state] += 1;
    counts.pendingApprovals += member.pendingApprovals;
  }
  const strategy = planBlackRoomCeoStrategy(input.analytics, input.now);

  const approvalsForRobert: BlackRoomCeoEscalation[] = members.filter((member) => member.pendingApprovals > 0).map((member) => ({
    agentId: member.id,
    name: member.name,
    pending: member.pendingApprovals,
    note: `${member.pendingApprovals} pendiente(s) en la cola de ${member.name}. El CEO no aprueba: decide Robert.`,
  }));

  const delegations: BlackRoomCeoDelegation[] = [];
  const priorities: string[] = [];
  const risks: string[] = [];
  if (approvalsForRobert.length) priorities.push(`Robert: revisar ${counts.pendingApprovals} aprobacion(es) pendiente(s) (${approvalsForRobert.map((item) => item.name).join(", ")}).`);
  for (const member of members) {
    if (member.state === "blocked") {
      const need = member.needs.length ? member.needs.join(", ") : member.label;
      priorities.push(`Desbloquear ${member.name}: ${need}.`);
      delegations.push({ agentId: "robert", name: "Robert", task: `Configurar ${member.name}: ${need}.` });
      continue;
    }
    if (member.state === "unreachable") {
      risks.push(`${member.name}: no se pudo leer su estado.`);
      continue;
    }
    let task = NEXT_TASK[member.id];
    if (member.id === "blackroom-publisher") {
      task = `Preparar ${strategy.postsToday} posteos en borrador (dry-run) para ${strategy.slots.join(", ")}; nada sale sin la aprobacion de Robert.`;
    }
    if (task) delegations.push({ agentId: member.id, name: member.name, task });
    if (member.state === "working" && !member.ranRecently) risks.push(`${member.name} dice que trabaja pero no tiene una ejecucion verificada en las ultimas 26 h.`);
  }
  if (strategy.source === "sin-datos") {
    risks.push(input.analyticsError ? `No se pudieron leer las analiticas del CEO de crecimiento: ${input.analyticsError}` : "Sin analiticas del CEO de crecimiento: la estrategia de posteo usa el plan base.");
  } else {
    priorities.push(`Plan de posteo de hoy: ${strategy.postsToday} posteos (${strategy.slots.join(", ")})${strategy.creativeStrategy ? `, tecnica ${strategy.creativeStrategy}` : ""}.`);
    const networkErrors = Object.entries(input.analytics?.networkErrors || {});
    if (networkErrors.length) risks.push(`Errores leyendo redes en Metricool: ${networkErrors.map(([network, error]) => `${network} (${String(error).slice(0, 60)})`).join("; ")}.`);
    if (strategy.confidence === "recolectando") risks.push("Las analiticas siguen recolectando muestras: las decisiones de horario y volumen aun no son firmes.");
  }
  if (counts.blocked + counts.unreachable === members.length) risks.push("Ningun agente del equipo esta operativo ahora mismo.");

  const summary = [
    `${members.length} agentes: ${counts.working} trabajando, ${counts.available} disponibles, ${counts.blocked} bloqueados${counts.idle ? `, ${counts.idle} en pausa` : ""}${counts.unreachable ? `, ${counts.unreachable} sin lectura` : ""}.`,
    counts.pendingApprovals ? `${counts.pendingApprovals} cosa(s) esperan la aprobacion de Robert.` : "Nada espera aprobacion.",
  ].join(" ");

  return {
    id: `ceo-brief-${input.now.toISOString()}`,
    createdAt: input.now.toISOString(),
    date: localDate(input.now),
    summary,
    counts,
    members,
    priorities: priorities.slice(0, 10),
    delegations,
    approvalsForRobert,
    risks: risks.slice(0, 10),
    strategy,
    telegram: input.telegram ?? { sent: false, note: "Telegram no evaluado." },
  };
}

export function formatBlackRoomCeoBriefText(brief: BlackRoomCeoBrief): string {
  const lines = [`Black Room - brief del CEO (${brief.date})`, brief.summary, ""];
  if (brief.priorities.length) lines.push("Prioridades:", ...brief.priorities.map((item, index) => `${index + 1}. ${item}`), "");
  if (brief.approvalsForRobert.length) lines.push("Esperando tu aprobacion:", ...brief.approvalsForRobert.map((item) => `- ${item.name}: ${item.pending}`), "");
  if (brief.delegations.length) lines.push("Delegaciones:", ...brief.delegations.map((item) => `- ${item.name}: ${item.task}`), "");
  if (brief.risks.length) lines.push("Riesgos:", ...brief.risks.map((item) => `- ${item}`));
  return lines.join("\n").trim();
}

// ---------------------------------------------------------------------------
// Injectable IO
// ---------------------------------------------------------------------------

export type BlackRoomCeoDeps = {
  /** Growth CEO analytics stored in the Black Room queue; null when there is none yet. */
  readGrowthAnalytics(ctx: BlackRoomTeamContext): Promise<BlackRoomCeoAnalytics | null>;
  /** Sends text to Robert's own Telegram chat. Only called after the opt-in flag check. */
  sendTelegramSummary(ctx: BlackRoomTeamContext, text: string): Promise<BlackRoomCeoTelegramResult>;
};

/** Queue written by the Black Room agent: <dataDir>/../agent/queue.json (clippers_workspace/blackroom/agent/queue.json). */
export function blackRoomCeoQueuePath(dataDir: string): string {
  return path.join(path.dirname(dataDir), "agent", "queue.json");
}

const defaultDeps: BlackRoomCeoDeps = {
  async readGrowthAnalytics(ctx) {
    let raw: string;
    try {
      raw = await readFile(blackRoomCeoQueuePath(ctx.dataDir), "utf8");
    } catch (error: any) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
    const analytics = (JSON.parse(raw) as { analytics?: unknown })?.analytics;
    return analytics && typeof analytics === "object" && !Array.isArray(analytics) ? analytics as BlackRoomCeoAnalytics : null;
  },
  async sendTelegramSummary(ctx, text) {
    const { hasRealValue } = await import("../ceo-doctor-cli");
    const token = ctx.env.TELEGRAM_BOT_TOKEN;
    if (!hasRealValue(token)) return { sent: false, note: "Telegram omitido: falta TELEGRAM_BOT_TOKEN." };
    if (!ctx.userId) return { sent: false, note: "Telegram omitido: no hay usuario dueno en esta ejecucion." };
    const { storage } = await import("../storage");
    const config = await storage.getTelegramConfig(ctx.userId);
    if (!config?.enabled || !config.chatId) return { sent: false, note: "Telegram omitido: el chat de Telegram de Robert no esta activo." };
    const { sendTelegramPlainMessageChunks } = await import("../telegram");
    const sent = await sendTelegramPlainMessageChunks(token, config.chatId, text);
    return sent ? { sent: true, note: "Resumen enviado al Telegram de Robert." } : { sent: false, note: "Telegram respondio con error; el brief quedo guardado." };
  },
};

async function maybeSendTelegram(ctx: BlackRoomTeamContext, deps: BlackRoomCeoDeps, brief: BlackRoomCeoBrief, input: Record<string, unknown>): Promise<BlackRoomCeoTelegramResult> {
  if (ctx.env.BLACKROOM_CEO_TELEGRAM?.trim().toLowerCase() !== "true") {
    return { sent: false, note: "Resumen por Telegram desactivado (BLACKROOM_CEO_TELEGRAM=true para activarlo)." };
  }
  if (input.telegram === false || input.dryRun === true) return { sent: false, note: "Telegram omitido en esta ejecucion (dry-run)." };
  try {
    return await deps.sendTelegramSummary(ctx, formatBlackRoomCeoBriefText(brief));
  } catch (error) {
    return { sent: false, note: `Telegram omitido por error: ${error instanceof Error ? error.message.slice(0, 120) : "sin detalle"}` };
  }
}

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

export function createBlackRoomCeoAgent(overrides: Partial<BlackRoomCeoDeps> = {}): BlackRoomTeamAgentModule {
  const deps: BlackRoomCeoDeps = { ...defaultDeps, ...overrides };

  async function loadState(ctx: BlackRoomTeamContext): Promise<BlackRoomCeoState> {
    return normalizeState(await ctx.state.load<unknown>(EMPTY_STATE));
  }

  async function run(ctx: BlackRoomTeamContext, input: Record<string, unknown> = {}): Promise<BlackRoomTeamRunResult> {
    const ids = BLACKROOM_DEPARTMENT_ORDER.filter((id) => id !== ID);
    const reads = await Promise.all(ids.map(async (id) => [id, await ctx.readTeammateStatus(id).catch(() => null)] as const));
    const statuses = Object.fromEntries(reads) as Partial<Record<BlackRoomTeamMemberId, BlackRoomTeamStatus | null>>;
    let analytics: BlackRoomCeoAnalytics | null = null;
    let analyticsError: string | null = null;
    try {
      analytics = await deps.readGrowthAnalytics(ctx);
    } catch (error) {
      analyticsError = error instanceof Error ? error.message.slice(0, 120) : "sin detalle";
    }
    const now = ctx.now();
    const brief = buildBlackRoomCeoBrief({ now, statuses, analytics, analyticsError });
    brief.telegram = await maybeSendTelegram(ctx, deps, brief, input);

    let state: BlackRoomCeoState;
    try {
      state = await loadState(ctx);
    } catch {
      state = { ...EMPTY_STATE, briefs: [] };
    }
    state.briefs = [...state.briefs, brief].slice(-MAX_BRIEFS);
    state.lastRunAt = brief.createdAt;
    await ctx.state.save(state);
    return { ok: true, summary: `Brief del ${brief.date} listo. ${brief.summary} ${brief.telegram.note}`.trim(), report: brief };
  }

  return {
    id: ID,
    async getStatus(ctx) {
      let state: BlackRoomCeoState;
      try {
        state = await loadState(ctx);
      } catch (error) {
        return {
          id: ID,
          state: "blocked",
          label: "Estado ilegible",
          summary: `No se pudo leer el estado del CEO: ${error instanceof Error ? error.message.slice(0, 120) : "sin detalle"}`,
          needs: ["Revisar o borrar clippers_workspace/blackroom/team/blackroom-ceo.json (JSON corrupto)"],
          lastRunAt: null,
        };
      }
      const last = state.briefs[state.briefs.length - 1];
      if (!state.lastRunAt || !last) {
        return { id: ID, state: "available", label: "Listo para el brief", summary: "Todavia no hay brief del equipo; correr el CEO para armar el de hoy.", needs: [], lastRunAt: null };
      }
      const metrics: Record<string, number | string> = {
        bloqueados: last.counts.blocked,
        por_aprobar_robert: last.counts.pendingApprovals,
        delegaciones: last.delegations.length,
        posteos_plan: last.strategy.postsToday,
      };
      if (isFresh(state.lastRunAt, ctx.now().getTime())) {
        return { id: ID, state: "working", label: "Brief del dia listo", summary: last.summary, needs: [], lastRunAt: state.lastRunAt, metrics };
      }
      return { id: ID, state: "available", label: "Brief vencido", summary: `Ultimo brief del ${last.date}; hace falta uno nuevo.`, needs: [], lastRunAt: state.lastRunAt, metrics };
    },
    run,
    actions: {
      async brief(ctx, input) {
        return run(ctx, input);
      },
      async latest(ctx) {
        const state = await loadState(ctx);
        const last = state.briefs[state.briefs.length - 1];
        return last ? { ok: true, summary: last.summary, report: last } : { ok: false, summary: "Todavia no hay brief del equipo.", error: "no_brief" };
      },
      async history(ctx, input) {
        const state = await loadState(ctx);
        const limit = Math.max(1, Math.min(MAX_BRIEFS, Number.isInteger(input.limit) ? Number(input.limit) : 7));
        const items = state.briefs.slice(-limit).reverse().map((brief) => ({ id: brief.id, date: brief.date, createdAt: brief.createdAt, summary: brief.summary }));
        return { ok: true, summary: `${items.length} brief(s) guardado(s).`, report: items };
      },
      async escalations(ctx) {
        const state = await loadState(ctx);
        const last = state.briefs[state.briefs.length - 1];
        const items = last?.approvalsForRobert || [];
        return { ok: true, summary: items.length ? `${items.reduce((sum, item) => sum + item.pending, 0)} aprobacion(es) esperan a Robert.` : "Nada espera la aprobacion de Robert.", report: items };
      },
    },
  };
}

const agent = createBlackRoomCeoAgent();
export default agent;
