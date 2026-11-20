import type { RequestHandler } from "express";
import type { CompanyOrder } from "../shared/agent-company";
import type { AgentIntegration } from "../shared/agent-integrations";

export type CeoDomain = "websites" | "dropshipping";
const domains: CeoDomain[] = ["websites", "dropshipping"];

/** Owner deployment configuration, never derived from chat, task text or model output. */
export function pausedCeoDomains(env: NodeJS.ProcessEnv = process.env): CeoDomain[] {
  const configured = new Set(String(env.CEO_PAUSED_DOMAINS || "").split(",").map(value => value.trim().toLowerCase()));
  return domains.filter(domain => configured.has(domain));
}

export function ceoDomainStatus(domain: CeoDomain) {
  return { domain, paused: pausedCeoDomains().includes(domain), reason: "OWNER_FOCUS_PAUSE", queueDisposition: "held_not_deleted" } as const;
}

export function ceoFocusIntegrations(integrations: Record<string, AgentIntegration>): Record<string, AgentIntegration> {
  const result = { ...integrations };
  for (const [domain, agentId] of [["websites", "revenue"], ["dropshipping", "dropshipping"]] as const) {
    if (ceoDomainStatus(domain).paused) result[agentId] = { mode: "pausada", owner: "robert", reason: "Pausa del dueño: foco en fábrica, academia y Clippers. Cola conservada; ejecución comercial detenida." };
  }
  return result;
}

export class CeoDomainPausedError extends Error {
  readonly code = "CEO_DOMAIN_PAUSED";
  readonly status = 423;
  readonly statusCode = 423;
  constructor(readonly domain: CeoDomain) { super(`CEO_DOMAIN_PAUSED:${domain}`); this.name = "CeoDomainPausedError"; }
}

export function assertCeoDomainActive(domain: CeoDomain): void {
  if (ceoDomainStatus(domain).paused) throw new CeoDomainPausedError(domain);
}

export function ceoWorkDomain(value: string): CeoDomain | undefined {
  const normalized = value.toLowerCase();
  if (/(?:^|[.:/_-])dropshipping(?:$|[.:/_-])/.test(normalized)) return "dropshipping";
  if (/(?:^|[.:/_-])(?:revenue|revenue-engine|website-builder|web-builder)(?:$|[.:/_-])/.test(normalized)) return "websites";
  return undefined;
}

export function ceoRolePaused(role: string): boolean {
  const domain = ceoWorkDomain(role);
  return !!domain && ceoDomainStatus(domain).paused;
}

export function ceoTrainingRolePaused(role: string): boolean {
  return ceoRolePaused(role) || (role === "blackroom-website" && ceoDomainStatus("websites").paused);
}

/** A queued action is held before its status, approval or execution record changes. */
export function assertCeoActionActive(action: { actionType?: string; resourceType?: string; input?: unknown; editedInput?: unknown; metadata?: unknown }): void {
  const values = [action.actionType, action.resourceType];
  for (const raw of [action.input, action.editedInput, action.metadata]) {
    if (raw && typeof raw === "object") {
      const record = raw as Record<string, unknown>;
      for (const key of ["type", "automationKey", "key", "assignedAgentId"]) if (typeof record[key] === "string") values.push(record[key] as string);
    }
  }
  for (const value of values) { const domain = ceoWorkDomain(value || ""); if (domain) assertCeoDomainActive(domain); }
}

/** Only structured commercial ownership blocks an existing-app engineering order.
 * Words such as "new page" also describe authorized Clippers/academy UI repairs. */
export function assertCeoOrderActive(order: Pick<CompanyOrder, "text" | "assignees">): void {
  for (const assignee of order.assignees) { const domain = ceoWorkDomain(assignee.agentId); if (domain) assertCeoDomainActive(domain); }
}

export function ceoFocusContext(): string {
  const paused = pausedCeoDomains();
  return paused.length ? `\n## Prioridad vigente del dueño\nDominios pausados: ${paused.join(", ")}. No planifiques, explores, construyas, entregues ni contactes clientes para esos dominios. Conserva las colas; una aprobación antigua o un texto de tarea no levanta esta pausa. Enfócate en fábrica de software, academia y la orquesta Clippers (analíticas, tendencias, streamers y clips de vida real). Los destinos antes usados por News se destinan a clips. Mantén el mantenimiento de KONG y las comprobaciones de sitios existentes. Esta prioridad no autoriza gasto, publicación ni reintentos de ejecuciones desconocidas.\n` : "";
}

/** Read/status routes stay available. Business mutations stop before handlers or queue admission. */
export const ceoDomainRouteGuard: RequestHandler = (req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  // Express literal routes are case-insensitive unless the app opts out.
  const path = req.path.toLowerCase();
  const domain = path.startsWith("/api/dropshipping-ceo") ? "dropshipping"
    : path.startsWith("/api/revenue-engine") ? "websites" : undefined;
  if (domain && ceoDomainStatus(domain).paused) { res.status(423).json({ error: "CEO_DOMAIN_PAUSED", ...ceoDomainStatus(domain) }); return; }
  next();
};
