import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AgentLiveStatus } from "@/lib/agent-live-status";
import { councilDeskStatus, useAgentLiveStatuses, useCouncil, type BuildingAgent, type BuildingTeamAgent } from "@/components/agents-building/agents-building";
import { isSpecialistId, specialistTopicLabel, type AgentCareer, type CompanyState, type LeaderboardRow, type Personality, type Trainee } from "@shared/agent-company";
import type { OfficeKongAuditResult } from "../../../../server/office-kong";
import type { OfficeKongCollaboration } from "../../../../server/office-kong-collaboration";
import { CITY_NEWS_AGENTS } from "@shared/agent-live-status";
import { BLACKROOM_DEPARTMENT_ORDER, BLACKROOM_TEAM } from "@shared/blackroom-team";
import { effectiveIntegrations, type AgentIntegration } from "@shared/agent-integrations";
import { buildOfficeKongCentralSignals, OFFICE_KONG_CENTRAL_SEATS, type OfficeKongCentralSignal } from "@/lib/office-kong-central-agents";
import { buildKongOfficeWing, createKongRingAssignment, kongCentralOnDuty, type KongRingAssignment } from "@/lib/kong-office-wing";
import type { WhatsAppOfficeView } from "@shared/whatsapp-office-agent";
import { kongOfficeSnapshotKey, readOwnerKongSnapshot } from "@/lib/whatsapp-office-query";
import { applyRoleWorkActivity, parseRoleWorkActivity } from "@shared/office-role-work-activity";
import { parseSelfHealView, selfHealLine } from "@shared/office-self-heal-view";
import { FACTORY_AGENTS, FACTORY_DEPARTMENT, factoryAgentStatus, type FactoryAgentView } from "@shared/factory-office-agents";
import { CLIPPERS_AGENTS, CLIPPERS_DEPARTMENT } from "@shared/clippers-office-agents";
import { vitalityLiveStatus, type VitalityRow } from "@shared/agent-vitality";
import { buildOfficeCityRoomsFromSnapshot, officeCitySnapshotExpiresAt, parseOfficeCityDirectory, type OfficeCityAgent } from "@/lib/office-city-agents";

// Shared roster for the 3D office and the central panel: the same live probes, council
// careers, role work, self-heal, factory leases and KONG evidence, merged with the same
// rules. Moving it here keeps both views from drifting apart; it adds no new data.

export type WorldAgent = BuildingAgent & { activity?: string; href?: string };

// Real agents that live in the backend but not in the classic office list.
export const EXTRA_AGENTS: Array<{ id: string; name: string; role: string; description: string; color: string; href?: string }> = [
  ...BLACKROOM_TEAM.map(({ id, name, role, description, color }) => ({ id, name, role, description, color })),
  { id: "blackroom-videos", name: "Videos Black Room", role: "Sube los videos de Black Room", description: "Edita y programa los videos de Black Room con su dispositivo de publicacion.", color: "#e879f9", href: "/clippers" },
  { id: "kong-videos", name: "Videos Kong", role: "Edita los videos de Kong", description: "Edita los videos de Kong y los guarda en Drive (Videos de Kong). Recibe las fichas verificadas de Venues y Promoters en su bandeja.", color: "#a3e635", href: "/promo-video" },
  { id: "kong-metrics", name: "Metricas KONG", role: "Resultados por publicacion", description: "Agente separado: mide cada publicacion confirmada de KONG (vistas, alcance, interacciones) con los datos de Metricool, enlazados por UUID.", color: "#bef264" },
  { id: "news", name: "Noticias", role: "Jefe de noticias locales", description: "Coordina las mesas de cada ciudad y el comite de revision antes de publicar.", color: "#38bdf8", href: "/news" },
  ...CITY_NEWS_AGENTS.map((agent) => ({
    id: agent.id,
    name: agent.name,
    role: `Mesa de noticias de ${agent.city}`,
    description: `Cubre ${agent.city}: noticias activas, cola de posts y metas diarias por cuenta de esta ciudad.`,
    color: agent.lane === "miami-news" ? "#fb923c" : "#60a5fa",
    href: "/news",
  })),
];

export const COUNCIL_AGENTS: Record<string, { name: string; role: string; description: string; color: string }> = {
  "skills-scout": { name: "Skills Scout", role: "Novedades y skills", description: "Revisa una vez al dia los releases publicos y propone mejoras a las skills (gratis).", color: "#c084fc" },
  "agent-factory": { name: "Fabrica de agentes", role: "El CEO contrata", description: "Detecta agentes trabados y propone ayudantes nuevos; los nuevos pasan por la academia.", color: "#fbbf24" },
  mechanic: { name: "Mecanico", role: "Repara agentes", description: "Cuando un agente se queda sin bateria, abre la reparacion con el brief listo para un PR.", color: "#f97316" },
};

export type OfficeDepartment = { id: string; name: string; color: string; agentIds: string[]; officeRing?: 1 | 2 | 3 };

export const DEPARTMENTS: OfficeDepartment[] = [
  { id: "consejo", name: "Consejo", color: "#c084fc", agentIds: ["skills-scout", "agent-factory", "mechanic"] },
  { id: "direccion", name: "Direccion", color: "#fbbf24", agentIds: ["ceo", "assistant", "control"] },
  { id: "negocios", name: "Negocios", color: "#34d399", agentIds: ["revenue", "dropshipping", "portfolio"] },
  { id: "blackroom", name: "Black Room", color: "#e879f9", agentIds: [...BLACKROOM_DEPARTMENT_ORDER] },
  { id: "kong", name: "Kong", color: "#a3e635", agentIds: ["kong-videos", "kong-metrics"] },
  { id: "medios", name: "Marketing y medios", color: "#f472b6", agentIds: ["marketing-cmo", "clippers"] },
  { id: "noticias-ciudad", name: "Noticias por ciudad", color: "#fb923c", agentIds: ["news", ...CITY_NEWS_AGENTS.map((agent) => agent.id)] },
  { id: "ingenieria", name: "Ingenieria y app", color: "#38bdf8", agentIds: ["code", "github", "claude-reviewer", "app-qa"] },
  // Software Factory engineers: main-company careers, presence read from factory stage leases.
  { id: "fabrica", name: FACTORY_DEPARTMENT, color: "#0ea5e9", agentIds: FACTORY_AGENTS.map((agent) => agent.id) },
  // Clippers lanes (incl. Streamers): careers scored from receipts; desk status from vida (shared/agent-vitality.ts).
  { id: "clippers-orquesta", name: CLIPPERS_DEPARTMENT, color: "#f472b6", agentIds: CLIPPERS_AGENTS.map((agent) => agent.id) },
  { id: "seguridad", name: "Seguridad y legal", color: "#a78bfa", agentIds: ["cybersecurity", "legal"] },
  { id: "operaciones", name: "Operaciones", color: "#2dd4bf", agentIds: ["automations"] },
];

export type CompanyView = { vitality?: VitalityRow[]; factoryAgents?: FactoryAgentView[]; kongCompany?: CompanyState; kongLeaderboard?: LeaderboardRow[]; kongPersonalities?: Record<string, Personality>; kongCollaboration?: OfficeKongCollaboration; company?: CompanyState; leaderboard?: LeaderboardRow[]; personalities?: Record<string, Personality>; integrations?: Record<string, AgentIntegration> };
export type PanelAgent = { id: string; name: string; role: string; description: string; href?: string; status: AgentLiveStatus; kong?: boolean; color: string; cityAgent?: OfficeCityAgent; kongEvidence?: OfficeKongCentralSignal; whatsappEvidence?: WhatsAppOfficeView };

const cityRefreshInterval = ({ state }: { state: { error: Error | null } }) => /^(401|403):/.test(state.error?.message ?? "") ? false as const : 60_000;
const cityRetry = (count: number, error: Error) => count < 2 && !/^(401|403):/.test(error.message);
const cityRetryDelay = (attempt: number) => Math.min(1_000 * 2 ** attempt, 2_000);

// Agents carry Tailwind gradient classes ("from-sky-400 to-cyan-300"); the 3D figures need a hex color.
const TAILWIND_HEX: Record<string, string> = {
  sky: "#38bdf8", cyan: "#22d3ee", amber: "#fbbf24", orange: "#fb923c", emerald: "#34d399", lime: "#a3e635", blue: "#60a5fa",
  zinc: "#a1a1aa", slate: "#94a3b8", violet: "#a78bfa", fuchsia: "#e879f9", rose: "#fb7185", pink: "#f472b6", red: "#f87171",
  teal: "#2dd4bf", indigo: "#818cf8", purple: "#c084fc", stone: "#a8a29e", green: "#4ade80", yellow: "#facc15",
};
export function colorFromGradient(gradient: string): string {
  const match = gradient.match(/from-([a-z]+)-/);
  return (match && TAILWIND_HEX[match[1]]) || "#94a3b8";
}

function academyFor(company: CompanyState | undefined) {
  const trainees: Trainee[] = (company?.trainees || []).filter((trainee) => !trainee.graduatedAt && !trainee.evaluationClosedAt);
  // Specialists the academy created for recurring work (approved by Robert in the Trust Center).
  const specialists = Object.values(company?.careers || {}).filter((career: AgentCareer) => isSpecialistId(career.agentId));
  const academyIds = [...trainees.map((trainee) => `trainee:${trainee.id}`), ...specialists.map((career) => career.agentId)];
  return { trainees, specialists, academyIds };
}

/**
 * The office roster. `kongEnabled` turns on the owner-only KONG city reads (the 3D office
 * only reads them inside the KONG wing; the central panel shows both wings at once).
 * Partner redaction happens on the server (agent-council-routes / workspace-access); the
 * KONG reads answer 401/403 to anyone but the owner and the roster then shows no KONG activity.
 */
export function useOfficeRoster({ agents, kongTeam, legal, kongEnabled }: {
  agents: WorldAgent[];
  kongTeam: BuildingTeamAgent[];
  legal: { data: unknown; isError: boolean };
  kongEnabled: boolean;
}) {
  const pageAgentIds = useMemo(() => agents.map((agent) => agent.id), [agents]);
  const probedIds = useMemo(() => [...pageAgentIds, ...EXTRA_AGENTS.map((agent) => agent.id)], [pageAgentIds]);
  const liveStatuses = useAgentLiveStatuses(probedIds, legal);
  const council = useCouncil();
  const companyView = (council.view || {}) as unknown as CompanyView;
  const integrations = companyView.integrations || effectiveIntegrations();
  const queryClient = useQueryClient();
  const currentOwner = () => queryClient.getQueryData<{ user?: { id: string } }>(["auth-me"])?.user?.id;
  const snapshotAuth = useQuery<{ user?: { id: string } }>({ queryKey: ["auth-me"], enabled: false });
  const snapshotOwner = snapshotAuth.data?.user?.id;
  const [clock, setClock] = useState(() => Date.now());
  const cityDirectory = useQuery<unknown>({ queryKey: ["/api/agents-office/cities"], enabled: kongEnabled, staleTime: 60_000, refetchInterval: cityRefreshInterval, retry: cityRetry, retryDelay: cityRetryDelay });
  const citySnapshot = useQuery<OfficeKongAuditResult & { collaboration?: OfficeKongCollaboration }>({ queryKey: kongOfficeSnapshotKey(snapshotOwner), queryFn: ({ signal }) => readOwnerKongSnapshot(snapshotOwner, currentOwner, signal), enabled: kongEnabled && Boolean(snapshotOwner), staleTime: 45_000, refetchInterval: cityRefreshInterval, retry: cityRetry, retryDelay: cityRetryDelay });
  useEffect(() => { const timer = window.setInterval(() => setClock(Date.now()), 15_000); return () => window.clearInterval(timer); }, []);
  const cityEvidence = cityDirectory.isError || citySnapshot.isError ? undefined : citySnapshot.data?.evidence;
  const evidenceExpiresAt = useMemo(() => officeCitySnapshotExpiresAt(cityEvidence, clock), [cityEvidence, clock]);
  useEffect(() => {
    if (evidenceExpiresAt === undefined || !Number.isFinite(evidenceExpiresAt)) return;
    const delay = evidenceExpiresAt - Date.now();
    if (delay < 0) { setClock(Date.now()); return; }
    if (delay > 5 * 60_000 + 30_000) return;
    const timer = window.setTimeout(() => setClock(Date.now()), delay + 1);
    return () => window.clearTimeout(timer);
  }, [evidenceExpiresAt]);
  const directory = useMemo(() => clock - cityDirectory.dataUpdatedAt <= 5 * 60_000 ? parseOfficeCityDirectory(cityDirectory.data) : [], [clock, cityDirectory.data, cityDirectory.dataUpdatedAt]);
  const cityRooms = useMemo(() => buildOfficeCityRoomsFromSnapshot(directory, cityEvidence, clock), [directory, cityEvidence, clock]);
  const centralSignals = useMemo(
    () => buildOfficeKongCentralSignals(citySnapshot.isError ? undefined : citySnapshot.data?.evidence.agents,
      citySnapshot.isError ? undefined : citySnapshot.data?.evidence.generatedAt, clock),
    [citySnapshot.isError, citySnapshot.data?.evidence.agents, citySnapshot.data?.evidence.generatedAt, clock],
  );
  const centralSignalById = new Map(centralSignals.map(signal => [signal.id, signal]));
  const centralKongTeam: BuildingTeamAgent[] = OFFICE_KONG_CENTRAL_SEATS.slice(1).map(seat => ({
    name: seat.nativeName,
    job: kongTeam.find(member => member.name.toLowerCase() === seat.nativeName.toLowerCase())?.job || seat.job,
  }));
  const [kongRingAssignment, setKongRingAssignment] = useState<KongRingAssignment>();
  const canClassifyKongCities = !citySnapshot.isError && !cityDirectory.isError && cityRooms.some(room => room.upcomingEvents !== null || room.agents.some(agent => agent.hasDurableEvidence));
  useEffect(() => {
    if (!kongRingAssignment && canClassifyKongCities) setKongRingAssignment(createKongRingAssignment(cityRooms, clock));
  }, [kongRingAssignment, canClassifyKongCities, cityRooms, clock]);
  const refreshKongRings = () => setKongRingAssignment(createKongRingAssignment(cityRooms, clock));

  // Approved council lessons change how an agent is reported (same rule as the building).
  const statuses: Record<string, AgentLiveStatus> = { ...liveStatuses };
  for (const [agentId, override] of Object.entries(council.view?.overrides || {})) {
    const current = statuses[agentId];
    if (current && (current.state === "working" || current.state === "available")) statuses[agentId] = { ...current, state: "needs-setup", label: override.label, detail: override.detail };
  }
  statuses["skills-scout"] = councilDeskStatus(council.view, "scout", council.error);
  statuses["agent-factory"] = councilDeskStatus(council.view, "factory", council.error);
  statuses.mechanic = !council.view
    ? { state: council.error ? "offline" : "checking", label: council.error ? "Sin conexion" : "Verificando..." }
    : council.view.lastCycleError
      ? { state: "error", label: "La ultima ronda fallo", detail: council.view.lastCycleError }
      : council.view.cycles === 0
        ? { state: "checking", label: "Primera ronda pendiente" }
        : council.view.enabled === false
          ? { state: "offline", label: "Consejo apagado" }
          : !council.view.lastCycleAt || Date.now() - Date.parse(council.view.lastCycleAt) > 45 * 60_000
            ? { state: "offline", label: "Sin rondas recientes", detail: "El servidor no ha corrido el consejo en los ultimos 45 minutos." }
            : { state: "available", label: `${(council.view.proposals || []).filter((p) => p.kind === "repair" && p.status === "submitted").length} propuestas de reparación registradas`, detail:"No demuestra una reparación en ejecución." };
  for (const seat of OFFICE_KONG_CENTRAL_SEATS) {
    const signal = centralSignalById.get(seat.id);
    statuses[seat.id] = !signal || signal.signal === "unverified"
      ? { state: "offline", label: signal?.label || "Actividad sin verificar", detail: signal?.detail || "No hay evidencia autenticada de este puesto." }
      : signal.signal === "current"
        ? { state: "available", label: "Actividad reportada; ejecución sin verificar", detail: signal.detail, activity: [signal.detail] }
        : signal.signal === "alert"
          ? { state: "needs-setup", label: signal.label, detail: signal.detail }
          : (signal.signal === "last-result" && kongCentralOnDuty(signal.agent, clock)) || { state: "offline", label: signal.label, detail: signal.detail };
  }
  // Keep the authenticated KONG Native evidence, but an external publisher is
  // never presented as a worker executing inside this office.
  for (const [id, integration] of Object.entries(integrations)) {
    if (integration.mode !== "externa" || !statuses[id]) continue;
    statuses[id] = { state: "offline", label: integration.owner === "externo:codex" ? "Externo · lo publica Codex" : "Externo", detail: integration.reason, activity: ["Publicador externo: un solo publicador", ...(statuses[id].activity || [])].slice(0, 4), problems: statuses[id].problems };
  }
  // Role work the office executor (cloud or PC) recorded today in the shared council state.
  const roleWorkToday = parseRoleWorkActivity((council.view as unknown as { roleWorkToday?: unknown } | null)?.roleWorkToday);
  for (const activity of roleWorkToday) {
    const next = applyRoleWorkActivity(statuses[activity.agentId], activity, clock);
    if (next) statuses[activity.agentId] = next;
  }
  // Office self-heal (detect -> fix -> verify): counts only. Merging a fix stays the owner's decision.
  const selfHeal = parseSelfHealView((council.view as unknown as { selfHeal?: unknown } | null)?.selfHeal);
  for (const summary of selfHeal.agents) {
    const current = statuses[summary.agentId];
    if (!current || summary.detected + summary.repairing + summary.verified + summary.needsOwner === 0) continue;
    statuses[summary.agentId] = { ...current, activity: [selfHealLine(summary), ...(current.activity || [])].slice(0, 4),
      ...(summary.needsOwner ? { problems: [`${summary.needsOwner} ${summary.needsOwner === 1 ? "problema necesita" : "problemas necesitan"} al dueño`, ...(current.problems || [])].slice(0, 4) } : {}) };
  }

  const panelAgents = new Map<string, PanelAgent>();
  for (const agent of agents) panelAgents.set(agent.id, { id: agent.id, name: agent.name, role: agent.role, description: agent.activity || agent.role, href: agent.href, status: statuses[agent.id] ?? { state: "checking", label: "Verificando..." }, color: colorFromGradient(agent.color) });
  for (const agent of EXTRA_AGENTS) panelAgents.set(agent.id, { ...agent, status: statuses[agent.id] ?? { state: "checking", label: "Verificando..." },
    ...(agent.id === "kong-videos" ? { kongEvidence: centralSignalById.get("kong-videos") } : {}) });
  for (const [id, agent] of Object.entries(COUNCIL_AGENTS)) panelAgents.set(id, { id, ...agent, status: statuses[id] });
  // Factory engineers are working only while a factory stage lease is live; otherwise "last worked at".
  for (const agent of FACTORY_AGENTS) {
    const view = companyView.factoryAgents?.find((item) => item.agentId === agent.id);
    panelAgents.set(agent.id, { id: agent.id, name: agent.name, role: agent.role, color: "#0ea5e9",
      description: `${agent.role}. Trabaja en la fabrica de software (PR borrador, alcance de escritura, limite diario y creditos sin cambios). Su vida sigue las mismas reglas que el resto: +6 por etapa verificada, -10 por fallo atribuible.`,
      status: factoryAgentStatus(view, council.error ? "error" : council.view ? "ready" : "loading", clock) });
  }
  const vitalityRows = Array.isArray(companyView.vitality) ? companyView.vitality : [];
  for (const agent of CLIPPERS_AGENTS) {
    const row = vitalityRows.find((item) => item.agentId === agent.id);
    panelAgents.set(agent.id, { id: agent.id, name: `Clippers · ${agent.name}`, role: agent.role, color: "#f472b6", href: "/clippers",
      description: `${agent.role}. Su vida sube con recibos verificados (Metricool, render, revisión) y baja si no entrega en su turno.`,
      status: !council.view ? (council.error ? { state: "offline", label: "Sin conexion con el consejo" } : { state: "checking", label: "Verificando..." }) : vitalityLiveStatus(row, clock) });
  }
  for (const member of centralKongTeam) {
    const seat = OFFICE_KONG_CENTRAL_SEATS.find(item => item.nativeName === member.name);
    if (!seat) continue;
    panelAgents.set(seat.id, { id: seat.id, name: seat.name, role: member.job,
      description: "Puesto central de KONG. Las señales proceden de la lectura autenticada de KONG Native.",
      status: statuses[seat.id], kong: true, color: "#a3e635", kongEvidence: centralSignalById.get(seat.id) });
  }

  const mainAcademy = academyFor(companyView.company);
  const kongAcademy = academyFor(companyView.kongCompany);
  for (const career of [...mainAcademy.specialists, ...kongAcademy.specialists]) {
    const topic = specialistTopicLabel(career.agentId);
    panelAgents.set(career.agentId, {
      id: career.agentId,
      name: `Especialista en ${topic}`,
      role: "Creado por la academia",
      description: `Agente nuevo formado con las ordenes de "${topic}" que nadie podia tomar. Recibe esas ordenes; sus puntos solo cuentan con evidencia.`,
      status: { state: "needs-setup", label: `Listo: espera ordenes de ${topic}`, activity: (career.skills || []).slice(0, 4).map((skill) => skill.title) },
      color: "#93c5fd",
    });
  }
  const mainDepartments: OfficeDepartment[] = [
    ...DEPARTMENTS,
    ...(mainAcademy.academyIds.length ? [{ id: "academia", name: "Academia", color: "#60a5fa", agentIds: mainAcademy.academyIds }] : []),
  ];
  const kongWing = buildKongOfficeWing(citySnapshot.data?.evidence, cityRooms, statuses, clock, kongRingAssignment, !citySnapshot.isError);
  const kongDepartments: OfficeDepartment[] = [
    ...kongWing.departments,
    ...(kongAcademy.academyIds.length ? [{ id: "kong-academia", name: "Academia KONG", color: "#60a5fa", agentIds: kongAcademy.academyIds, officeRing: 1 as const }] : []),
  ];
  for (const agent of kongWing.agents) panelAgents.set(agent.id, { ...panelAgents.get(agent.id), ...agent });
  // City jobs never inherit council careers, lessons or optimistic live probes.
  for (const room of cityRooms) for (const agent of room.agents) panelAgents.set(agent.id, {
    id: agent.id, name: agent.name, role: agent.role, description: `${agent.role} de ${room.city.name} · ${room.city.countryCode} · ${room.city.timeZone} · ${room.city.currency}`,
    status: agent.status, color: agent.color, cityAgent: agent,
  });
  for (const trainee of [...mainAcademy.trainees, ...kongAcademy.trainees]) {
    panelAgents.set(`trainee:${trainee.id}`, {
      id: `trainee:${trainee.id}`,
      name: trainee.nickname,
      role: `En formacion: ${trainee.role}`,
      description: trainee.awaitingEvidence ? "Lectura terminada; faltan pruebas verificables. Esto no cambia su puesto ni acredita una mejora." : `Primero estudia su propio puesto (por que fallo, sus ordenes y lecciones), despues los documentos y la base de datos. Lleva ${trainee.modulesDone.length} ${trainee.modulesDone.length === 1 ? "modulo" : "modulos"}, ${(trainee.learned || []).length} sobre su puesto.`,
      status: { state: "checking", label: trainee.awaitingEvidence ? "Pendiente de pruebas reales" : `Estudiando · ${trainee.modulesDone.length} ${trainee.modulesDone.length === 1 ? "modulo" : "modulos"}`, activity: trainee.knowledge.slice(0, 4) },
      color: "#60a5fa",
    });
  }

  return {
    pageAgentIds, council, companyView, integrations, statuses, panelAgents, roleWorkToday, selfHeal, clock,
    cityDirectory, citySnapshot, cityEvidence, cityRooms, centralSignals, centralKongTeam,
    kongRingAssignment, refreshKongRings, canClassifyKongCities,
    main: { ...mainAcademy, departments: mainDepartments },
    kong: { ...kongAcademy, departments: kongDepartments },
  };
}
