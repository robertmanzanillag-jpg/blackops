// Who owns each agent's work and whether the office should score it.
//
// The office SUPERVISES; it never produces or publishes. An agent whose work is paused on purpose,
// done by an external system (e.g. the KONG publisher run from Codex) or simply not built yet is
// shown honestly and is never penalized, fired or "repaired" for it.
//
// Robert can switch a mode without a code change through the AGENT_INTEGRATION_OVERRIDES
// environment variable, e.g. "blackroom-videos=activa,kong-videos=externa".
//
// Pure module (no IO) so the client and the tests use the same rules.

export type IntegrationMode = "activa" | "pausada" | "externa" | "ausente";
export type IntegrationOwner = "interno" | "externo:codex" | "robert";

export type AgentIntegration = {
  mode: IntegrationMode;
  owner: IntegrationOwner;
  reason: string;
};

export const INTEGRATION_LABEL: Record<IntegrationMode, string> = {
  activa: "Activa",
  pausada: "Pausada",
  externa: "Externa",
  ausente: "Sin integrar",
};

// Only exceptions are listed; every other agent is "activa" and owned internally.
export const DEFAULT_INTEGRATIONS: Record<string, AgentIntegration> = {
  "blackroom-videos": {
    mode: "activa",
    owner: "interno",
    reason: "Supervisa el publicador unico de BlackRoom. La actividad y el aprendizaje requieren evidencia reciente; activar la supervision no inicia ni duplica publicaciones.",
  },
  "kong-videos": {
    mode: "externa",
    owner: "externo:codex",
    reason: "La produccion y publicacion de KONG la hace el publicador externo en Codex (unico publicador). La oficina no publica ni la duplica.",
  },
  "kong:KONG AI": { mode: "ausente", owner: "interno", reason: "Guia local de KONG; todavia sin backend propio." },
  "kong:Promoters + Mesas": { mode: "ausente", owner: "interno", reason: "Guia local de KONG; todavia sin backend propio." },
  "kong:Venues": { mode: "ausente", owner: "interno", reason: "Guia local de KONG; todavia sin backend propio." },
  "kong:Kong Legal": { mode: "ausente", owner: "interno", reason: "Guia local de KONG; todavia sin backend propio." },
  mechanic: { mode: "ausente", owner: "interno", reason: "Es parte del consejo: revisa a los demas, no tiene trabajo propio que medir." },
};

const ACTIVE: AgentIntegration = { mode: "activa", owner: "interno", reason: "" };
const MODES: IntegrationMode[] = ["activa", "pausada", "externa", "ausente"];

export function parseIntegrationOverrides(raw: string | undefined | null): Record<string, IntegrationMode> {
  const result: Record<string, IntegrationMode> = {};
  for (const part of String(raw || "").split(",")) {
    const [id, mode] = part.split("=").map((value) => value.trim());
    if (id && MODES.includes(mode as IntegrationMode)) result[id] = mode as IntegrationMode;
  }
  return result;
}

export function effectiveIntegrations(overrides: Record<string, IntegrationMode> = {}): Record<string, AgentIntegration> {
  const result: Record<string, AgentIntegration> = { ...DEFAULT_INTEGRATIONS };
  for (const [id, mode] of Object.entries(overrides)) {
    const base = result[id] || ACTIVE;
    result[id] = {
      ...base,
      mode,
      reason: mode === base.mode ? base.reason : mode === "activa" ? "Activada por Robert." : `Marcada como ${INTEGRATION_LABEL[mode].toLowerCase()} por Robert.`,
    };
  }
  return result;
}

export function integrationFor(id: string, integrations: Record<string, AgentIntegration>): AgentIntegration {
  return integrations[id] || ACTIVE;
}

/** Agents the office must not score, fire or send repairs for. */
export function unscoredAgentIds(integrations: Record<string, AgentIntegration>): string[] {
  return Object.entries(integrations).filter(([, value]) => value.mode !== "activa").map(([id]) => id);
}
