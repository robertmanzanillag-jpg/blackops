import { buildOfficeKongCentralSignals, type OfficeKongCentralSignal } from "./office-kong-central-agents";
import type { AgentLiveStatus } from "./agent-live-status";
import { isOnDutyWindow, ON_DUTY_DAY_MS, onDutyStatus } from "@shared/office-on-duty";
import type { OfficeCityRoom } from "./office-city-agents";
import type { OfficeKongAuditResult } from "../../../server/office-kong";
import { WHATSAPP_AGENT_ID, WHATSAPP_CAREER_ID, whatsappOfficeAgent, whatsappOfficeView, type WhatsAppOfficeView } from "@shared/whatsapp-office-agent";

export type KongOfficeDesk = { id: string; name: string; role: string; description: string; color: string; status: AgentLiveStatus; kongEvidence?: OfficeKongCentralSignal; whatsappEvidence?: WhatsAppOfficeView };
export type KongOfficeRing = 1 | 2 | 3;
export type KongRingAssignment = { busyCityIds: string[]; cityOrder: string[]; classifiedAt: string; basis: "events" | "operations" | "unavailable" };
export type KongOfficeDepartment = { id: string; name: string; color: string; agentIds: string[]; officeRing: KongOfficeRing };

/** One measurement per current snapshot: polling never adds work to the ranking. */
export function measureKongCityActivity(room: OfficeCityRoom, now: number) {
  const verified = room.agents.filter(agent => {
    const age = agent.snapshotAt ? now - Date.parse(agent.snapshotAt) : Infinity;
    return agent.hasDurableEvidence && age >= -30_000 && age <= 300_000;
  });
  const completedPosts = verified.filter(agent => {
    const completed = agent.lastWorkAt ? Date.parse(agent.lastWorkAt) : NaN;
    return completed <= now && completed >= now - 86_400_000 && completed <= Date.parse(agent.snapshotAt!);
  }).length;
  const runningPosts = verified.filter(agent => agent.status.state === "working").length;
  return { cityId: room.city.id, upcomingEvents: room.upcomingEvents, completedPosts, runningPosts };
}

/** Capture explicitly; callers retain this assignment while operational status keeps refreshing. */
export function createKongRingAssignment(cities: OfficeCityRoom[], now: number): KongRingAssignment {
  const rows = cities.map(room => measureKongCityActivity(room, now));
  const ranked = rows.filter(row => row.upcomingEvents !== null || row.completedPosts > 0 || row.runningPosts > 0)
    .sort((a, b) => (b.upcomingEvents ?? -1) - (a.upcomingEvents ?? -1) || b.completedPosts - a.completedPosts || b.runningPosts - a.runningPosts || a.cityId.localeCompare(b.cityId));
  return { busyCityIds: ranked.slice(0, 8).map(row => row.cityId), cityOrder: [...cities].map(room => room.city.id).sort(), classifiedAt: new Date(now).toISOString(), basis: rows.some(row => row.upcomingEvents !== null) ? "events" : ranked.length ? "operations" : "unavailable" };
}

const centralGroups = [
  { id: "kong-direction", name: "Dirección KONG", color: "#fbbf24", ids: ["chief_of_staff", "city_operations", "legacy_ceo"] },
  { id: "kong-operations", name: "Operaciones KONG", color: "#a3e635", ids: ["customer_operations", "venue_deals", "promoters_partnerships", "restaurant_secretary", "restaurant_deals"] },
  { id: "kong-growth", name: "Crecimiento KONG", color: "#38bdf8", ids: ["growth_analytics", "finance_risk"] },
];
const names: Record<string, string> = { chief_of_staff: "Coordinación KONG", city_operations: "Operaciones de ciudades", legacy_ceo: "CEO bajo demanda", customer_operations: "Atención al cliente", venue_deals: "Venues", promoters_partnerships: "Promotores y mesas", restaurant_secretary: "Secretaría de restaurantes", restaurant_deals: "Acuerdos de restaurantes", growth_analytics: "Crecimiento y analítica", finance_risk: "Finanzas y riesgo", product_reliability: "Producto y fiabilidad", kong_ai_chat: "KONG AI" };

type KongCentralAgent = NonNullable<OfficeKongAuditResult["evidence"]>["agents"][number];
const WAITING_FIRST_RUN = /esperando (su )?primera ejecuci[oó]n/i;

/** A scheduled central desk KONG reports healthy, with its last run inside one day and no missed turn. */
export function kongCentralOnDuty(source: Pick<KongCentralAgent, "state" | "operationMode" | "lastRunAt" | "nextRunAt" | "blocker" | "issues" | "nextAction"> | undefined, now: number): AgentLiveStatus | undefined {
  if (!source || source.state !== "healthy" || source.operationMode === "on_demand" || !source.lastRunAt || source.blocker) return undefined;
  if (!isOnDutyWindow({ lastWorkAt: source.lastRunAt, nextWorkAt: source.nextRunAt, maxAgeMs: ON_DUTY_DAY_MS, now })) return undefined;
  return onDutyStatus({ lastWorkAt: source.lastRunAt, nextWorkAt: source.nextRunAt, now });
}

/** Honest desk state from one current KONG agent record; never infers activity KONG did not report. */
export function kongDeskStatus(source: KongCentralAgent | undefined, snapshotExpired = false, now = Date.now()): AgentLiveStatus {
  if (!source) return snapshotExpired
    ? { state: "offline", label: "Evidencia vencida", detail: "La última lectura de KONG superó cinco minutos; esperando una lectura vigente." }
    : { state: "offline", label: "Sin evidencia vigente" };
  const why = [source.blocker, ...source.issues].filter((item): item is string => Boolean(item));
  switch (source.state) {
    case "running": return { state: "needs-setup", label: "Ejecución reportada sin verificar", detail: "El registro central no aporta una tarea o arrendamiento verificable en esta lectura." };
    case "attention": return { state: "error", label: "Requiere atención", detail: [...new Set(why)].join(" · ") || source.nextAction };
    case "disabled": return { state: "offline", label: "Deshabilitado", detail: source.blocker || source.nextAction };
    case "idle": return { state: "available", label: "Disponible bajo demanda", detail: source.nextAction };
    case "healthy": return source.operationMode === "on_demand"
      ? { state: "available", label: "Disponible bajo demanda", detail: source.nextAction }
      : kongCentralOnDuty(source, now) ?? { state: "offline", label: "Último trabajo registrado", detail: source.lastRunAt ? `Completado: ${source.lastRunAt}` : "Sin ejecución activa registrada" };
    case "stale": return { state: "offline", label: "Sin ejecución reciente", detail: [source.blocker, source.nextAction].filter(Boolean).join(" · ") };
    default: return source.evidencePending && WAITING_FIRST_RUN.test(source.nextAction)
      ? { state: "offline", label: "Programado · esperando primera ejecución", detail: source.nextAction }
      : { state: "offline", label: "Sin historial conectado", detail: source.nextAction || source.blocker || undefined };
  }
}

/** Shared visual vocabulary with BlackOps; activity comes only from a current KONG snapshot. */
export function buildKongOfficeWing(evidence: OfficeKongAuditResult["evidence"] | undefined, cities: OfficeCityRoom[], media: Record<string, AgentLiveStatus>, now: number, assignment?: KongRingAssignment, transportCurrent = true) {
  const age = evidence ? now - Date.parse(evidence.generatedAt) : Infinity;
  const fresh = transportCurrent && age >= -30_000 && age <= 300_000;
  const nativeSignals = buildOfficeKongCentralSignals(transportCurrent ? evidence?.agents : undefined, transportCurrent ? evidence?.generatedAt : undefined, now);
  const central = new Map((evidence?.agents ?? []).filter(agent => agent.kind !== "city").map(agent => [agent.id, agent]));
  central.set(WHATSAPP_AGENT_ID, whatsappOfficeAgent(evidence?.whatsappReader, now, fresh));
  const videoNativeId = nativeSignals.find(signal => signal.id === "kong-videos")?.agent?.id;
  const ids = new Set([...Object.keys(names), ...[...central.keys()].sort()].filter(id => id !== videoNativeId && id !== "kong-metrics"));
  const agents: KongOfficeDesk[] = [...ids].map(id => {
    const source = central.get(id);
    if (id === WHATSAPP_AGENT_ID) {
      const view = whatsappOfficeView(evidence?.whatsappReader, now, fresh);
      return { id: WHATSAPP_CAREER_ID, name: "Vigilancia WhatsApp", role: "Lector externo autorizado", description: source!.responsibility,
        color: "#22c55e", whatsappEvidence: view,
        status: { state: view.status === "reading" ? "working" : view.status === "recent" ? "available" : view.status === "blocked" ? "needs-setup" : "offline",
          label: view.label, detail: view.detail, lifePenaltyExempt: true } };
    }
    const status = kongDeskStatus(fresh ? source : undefined, Boolean(source && evidence && !fresh), now);
    if (source && fresh) { status.problems = [...new Set([source.state === "attention" ? source.blocker : null, ...source.issues].filter((item): item is string => Boolean(item)))]; status.activity = [source.responsibility, source.nextAction].filter(Boolean); }
    return { id: `kong:${id}`, name: source?.name || names[id] || id, role: source?.owner || "KONG", description: source?.responsibility || "Puesto KONG; esperando evidencia del backend.", color: "#a3e635", status };
  });
  agents.push(
    { id: "kong-videos", name: "Videos KONG", role: "Contenido", description: "Recibe fichas verificadas. La publicación corresponde al publicador autorizado.", color: "#a3e635", status: media["kong-videos"] || { state: "offline", label: "Sin evidencia" } },
    { id: "kong-metrics", name: "Métricas KONG", role: "Medición", description: "Mide resultados de publicaciones confirmadas.", color: "#38bdf8", status: media["kong-metrics"] || { state: "offline", label: "Sin evidencia" } },
  );
  const nativeIds: string[] = [];
  for (const signal of nativeSignals) {
    const existing = agents.find(agent => agent.id === (signal.id === "kong-videos" ? "kong-videos" : signal.agent ? `kong:${signal.agent.id}` : signal.id));
    const status: AgentLiveStatus = signal.signal === "current" ? { state: "available", label: "Actividad reportada; ejecución sin verificar", detail: signal.detail }
      : (signal.signal === "last-result" && kongCentralOnDuty(signal.agent, now)) || { state: signal.signal === "alert" ? "needs-setup" : "offline", label: signal.label, detail: signal.detail };
    if (existing) { if (signal.id !== "kong-videos") existing.status = status; existing.kongEvidence = signal; }
    else { agents.push({id:signal.id,name:signal.name,role:signal.role,description:signal.detail,color:"#a3e635",status,kongEvidence:signal}); nativeIds.push(signal.id); }
  }
  const grouped = new Set(centralGroups.flatMap(group => group.ids));
  const busyCities = new Set(assignment?.busyCityIds ?? []);
  const cityOrder = new Map((assignment?.cityOrder ?? []).map((id, index) => [id, index]));
  const rankedCityOrder = new Map((assignment?.busyCityIds ?? []).map((id, index) => [id, index]));
  const orderedCities = [...cities].sort((a, b) => Number(busyCities.has(b.city.id)) - Number(busyCities.has(a.city.id)) ||
    (busyCities.has(a.city.id) ? (rankedCityOrder.get(a.city.id) ?? Infinity) - (rankedCityOrder.get(b.city.id) ?? Infinity) :
    (cityOrder.get(a.city.id) ?? Infinity) - (cityOrder.get(b.city.id) ?? Infinity)) || a.city.id.localeCompare(b.city.id));
  const centralDepartments = [
    ...centralGroups.map(({ids, ...group}) => ({...group, agentIds: ids.map(id => `kong:${id}`)})),
    { id: "kong-native", name: "Equipo Native KONG", color: "#a3e635", agentIds: nativeIds },
    { id: "kong-systems", name: "Sistemas KONG", color: "#c084fc", agentIds: [...ids].filter(id => !grouped.has(id)).map(id => `kong:${id}`) },
    { id: "kong-media", name: "Contenido KONG", color: "#f472b6", agentIds: ["kong-videos", "kong-metrics"] },
  ].filter(group => group.agentIds.length);
  const departments: KongOfficeDepartment[] = [
    ...centralDepartments.map(group => ({...group, officeRing: 1 as const})),
    ...orderedCities.map(room => ({id: room.id, name: room.name, color: busyCities.has(room.city.id) ? "#22d3ee" : "#a78bfa", agentIds: room.agents.map(agent => agent.id), officeRing: busyCities.has(room.city.id) ? 2 as const : 3 as const})),
  ];
  return { agents, departments };
}
