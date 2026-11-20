// Operational roles of the existing Clippers pipeline. Registration is not
// execution evidence: careers and activity must come from persisted outcomes.
export const CLIPPERS_DEPARTMENT = "Clippers / Orquesta";

export const CLIPPERS_AGENTS = [
  { id: "clippers-supervisor", stage: "supervisor", name: "Supervisor", role: "Coordina cuentas, turnos y bloqueos" },
  { id: "clippers-analytics", stage: "analytics", name: "Analytics", role: "Compara métricas reales por destino" },
  { id: "clippers-trends", stage: "trends", name: "Tendencias", role: "Detecta novedades y conserva su procedencia" },
  { id: "clippers-streamers", stage: "streamers", name: "Streamers", role: "Descubre streamers en Twitch/YouTube; recorta salvo prohibición explícita, con crédito" },
  { id: "clippers-editor", stage: "editor", name: "Editor", role: "Prepara y renderiza material aprobado" },
  { id: "clippers-checker", stage: "checker", name: "Revisor", role: "Comprueba calidad, derechos y destino exacto" },
  { id: "clippers-publisher", stage: "publisher", name: "Publicador", role: "Publica con permiso vigente y recibo verificable" },
  { id: "clippers-learning", stage: "learning", name: "Aprendizaje", role: "Evalúa políticas con comparaciones medidas" },
  { id: "clippers-health", stage: "health", name: "Salud", role: "Observa latidos, horarios y fallos del worker" },
] as const;

export type ClippersAgentId = typeof CLIPPERS_AGENTS[number]["id"];
export type ClippersStage = typeof CLIPPERS_AGENTS[number]["stage"];
export const CLIPPERS_AGENT_IDS: ClippersAgentId[] = CLIPPERS_AGENTS.map(agent => agent.id);
export const CLIPPERS_AGENT_NAMES = Object.fromEntries(CLIPPERS_AGENTS.map(agent => [agent.id, `Clippers · ${agent.name}`])) as Record<ClippersAgentId, string>;
export const isClippersAgentId = (id: string): id is ClippersAgentId => (CLIPPERS_AGENT_IDS as readonly string[]).includes(id);
export const clippersAgentForStage = (stage: string): ClippersAgentId | undefined => CLIPPERS_AGENTS.find(agent => agent.stage === stage)?.id;
