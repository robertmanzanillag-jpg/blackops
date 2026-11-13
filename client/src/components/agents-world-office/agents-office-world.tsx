import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { runProbe, type AgentLiveState, type AgentLiveStatus } from "@/lib/agent-live-status";
import {
  AgentsBuilding,
  councilDeskStatus,
  useAgentLiveStatuses,
  useCouncil,
  type BuildingAgent,
  type BuildingTeamAgent,
} from "@/components/agents-building/agents-building";
import { SPECIALIST_PREFIX, isSpecialistId, specialistTopicLabel, personalityFor, type AgentCareer, type CompanyOrder, type CompanyState, type LeaderboardRow, type Personality, type Trainee } from "@shared/agent-company";
import { OFFICE_KONG_CITY_TASKS, scoreOfficeKongSnapshot } from "@shared/office-kong-supervisor";
import type { OfficeKongAuditResult } from "../../../../server/office-kong";
import type { OfficeKongCollaboration } from "../../../../server/office-kong-collaboration";
import { CITY_NEWS_AGENTS } from "@shared/agent-live-status";
import { BLACKROOM_DEPARTMENT_ORDER, BLACKROOM_TEAM } from "@shared/blackroom-team";
import { INTEGRATION_LABEL, effectiveIntegrations, integrationFor, type AgentIntegration } from "@shared/agent-integrations";
import { buildOfficeKongCentralSignals, OFFICE_KONG_CENTRAL_SEATS, officeCityEvidenceNotice, type OfficeKongCentralSignal } from "@/lib/office-kong-central-agents";
import { buildKongOfficeWing, createKongRingAssignment, kongCentralOnDuty, type KongRingAssignment } from "@/lib/kong-office-wing";
import { activeSummary, countActive, isActiveStatus, isOnDuty } from "@shared/office-on-duty";
import type { WhatsAppOfficeView } from "@shared/whatsapp-office-agent";
import { kongOfficeSnapshotKey, readOwnerKongSnapshot } from "@/lib/whatsapp-office-query";
import { createOfficeScene, type SceneData, type SceneDepartment } from "./office-scene";
import { applyRoleWorkActivity, countRoleWorkCompleted, parseRoleWorkActivity } from "@shared/office-role-work-activity";
import { parseSelfHealView, selfHealLine, selfHealTotals } from "@shared/office-self-heal-view";
import { FACTORY_AGENTS, FACTORY_DEPARTMENT, factoryAgentStatus, type FactoryAgentView } from "@shared/factory-office-agents";
import { buildOfficeCityRoomsFromSnapshot, officeCitySnapshotExpiresAt, parseOfficeCityDirectory, type OfficeCityAgent } from "@/lib/office-city-agents";
import { useWorkspaceRole } from "@/lib/workspace-role";
import { PartnerInvitePanel } from "@/components/workspace/partner-invite-panel";
import { BlackRoomAcademyPanel } from "./blackroom-academy-panel";
import { BlackRoomCeoChatPanel } from "@/components/blackroom-ceo-chat/blackroom-ceo-chat-panel";

export type WorldAgent = BuildingAgent & { activity?: string; href?: string };

// Real agents that live in the backend but not in the classic office list.
const EXTRA_AGENTS: Array<{ id: string; name: string; role: string; description: string; color: string; href?: string }> = [
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

const COUNCIL_AGENTS: Record<string, { name: string; role: string; description: string; color: string }> = {
  "skills-scout": { name: "Skills Scout", role: "Novedades y skills", description: "Revisa una vez al dia los releases publicos y propone mejoras a las skills (gratis).", color: "#c084fc" },
  "agent-factory": { name: "Fabrica de agentes", role: "El CEO contrata", description: "Detecta agentes trabados y propone ayudantes nuevos; los nuevos pasan por la academia.", color: "#fbbf24" },
  mechanic: { name: "Mecanico", role: "Repara agentes", description: "Cuando un agente se queda sin bateria, abre la reparacion con el brief listo para un PR.", color: "#f97316" },
};

const DEPARTMENTS: Array<{ id: string; name: string; color: string; agentIds: string[] }> = [
  { id: "consejo", name: "Consejo", color: "#c084fc", agentIds: ["skills-scout", "agent-factory", "mechanic"] },
  { id: "direccion", name: "Direccion", color: "#fbbf24", agentIds: ["ceo", "assistant", "control"] },
  { id: "negocios", name: "Negocios", color: "#34d399", agentIds: ["revenue", "dropshipping", "portfolio"] },
  { id: "blackroom", name: "Black Room", color: "#e879f9", agentIds: [...BLACKROOM_DEPARTMENT_ORDER] },
  { id: "kong", name: "Kong", color: "#a3e635", agentIds: ["kong-videos", "kong-metrics", "kong:KONG AI", "kong:Promoters + Mesas", "kong:Venues", "kong:Kong Legal"] },
  { id: "medios", name: "Marketing y medios", color: "#f472b6", agentIds: ["marketing-cmo", "clippers"] },
  { id: "noticias-ciudad", name: "Noticias por ciudad", color: "#fb923c", agentIds: ["news", ...CITY_NEWS_AGENTS.map((agent) => agent.id)] },
  { id: "ingenieria", name: "Ingenieria y app", color: "#38bdf8", agentIds: ["code", "github", "claude-reviewer", "app-qa"] },
  // Software Factory engineers: main-company careers, presence read from factory stage leases.
  { id: "fabrica", name: FACTORY_DEPARTMENT, color: "#0ea5e9", agentIds: FACTORY_AGENTS.map((agent) => agent.id) },
  { id: "seguridad", name: "Seguridad y legal", color: "#a78bfa", agentIds: ["cybersecurity", "legal"] },
  { id: "operaciones", name: "Operaciones", color: "#2dd4bf", agentIds: ["automations"] },
];

const SCREEN_KIND: Record<string, SceneDepartment["agents"][number]["screen"]> = {
  ...Object.fromEntries(BLACKROOM_TEAM.map((agent) => [agent.id, agent.screen])),
  radio: "timeline", clippers: "timeline", "blackroom-videos": "timeline", "kong-videos": "timeline", "kong-metrics": "chart", "news:miami-news": "list", "news:ny-news": "list",
  revenue: "chart", portfolio: "chart", "marketing-cmo": "chart", dropshipping: "chart", news: "chart",
  code: "code", github: "code", "claude-reviewer": "code", "app-qa": "code", cybersecurity: "code", mechanic: "code",
  ...Object.fromEntries(FACTORY_AGENTS.map((agent) => [agent.id, "code" as const])),
};
const CITY_COUNTRY_COLORS: Record<string, string> = {
  AR: "#fbbf24", US: "#38bdf8", GB: "#c084fc", ES: "#f472b6", FR: "#2dd4bf", AE: "#a3e635",
};
const cityRefreshInterval = ({ state }: { state: { error: Error | null } }) => /^(401|403):/.test(state.error?.message ?? "") ? false as const : 60_000;

const SOURCE_NAME: Record<string, string> = {
  ...Object.fromEntries(BLACKROOM_TEAM.map((agent) => [agent.id, agent.sourceName])),
  assistant: "Google Calendar", ceo: "Telegram + IA", control: "Salud de apps", revenue: "Stripe", dropshipping: "Shopify (pre-cuentas)",
  portfolio: "Mercados", "marketing-cmo": "Clientes de marketing", clippers: "Worker de clips", radio: "Calendario de radio",
  code: "GitHub", github: "GitHub", "claude-reviewer": "GitHub", "app-qa": "Salud de apps", cybersecurity: "Salud de apps",
  legal: "Reportes legales", automations: "Automatizaciones", "skills-scout": "Releases de GitHub", "agent-factory": "Consejo de agentes",
  mechanic: "Consejo de agentes", "blackroom-videos": "Publicador Black Room", news: "Noticias locales", "kong-videos": "Publicador externo KONG (Codex)", "kong-metrics": "Metricool (lectura) · registro por UUID",
  "news:miami-news": "Noticias locales", "news:ny-news": "Noticias locales",
  ...Object.fromEntries(FACTORY_AGENTS.map((agent) => [agent.id, "Fabrica de software (GitHub Actions)"])),
};

const STATE_TEXT: Record<AgentLiveState, string> = {
  available:"text-slate-300",
  working: "text-emerald-300", "needs-setup": "text-amber-200", error: "text-rose-300", offline: "text-zinc-400", checking: "text-sky-200",
};
const STATE_BAR: Record<AgentLiveState, string> = {
  available:"bg-slate-400",
  working: "bg-emerald-400", "needs-setup": "bg-amber-300", error: "bg-rose-400", offline: "bg-zinc-600", checking: "bg-sky-300",
};
// On duty ("Activo · al día"): fresh verified work, no live lease. Teal, not the animated working emerald.
const statusText = (status: AgentLiveStatus) => isOnDuty(status) ? "text-teal-300" : STATE_TEXT[status.state];
const statusBar = (status: AgentLiveStatus) => isOnDuty(status) ? "bg-teal-400 w-3/4" : STATE_BAR[status.state];

type CompanyView = { factoryAgents?: FactoryAgentView[]; kongCompany?: CompanyState; kongLeaderboard?: LeaderboardRow[]; kongPersonalities?: Record<string, Personality>; kongCollaboration?: OfficeKongCollaboration; company?: CompanyState; leaderboard?: LeaderboardRow[]; personalities?: Record<string, Personality>; integrations?: Record<string, AgentIntegration> };
export type WorldContact = { id: string; name: string; role: string; department: string; status: AgentLiveStatus; description: string; href?: string; color: string };
type PanelAgent = { id: string; name: string; role: string; description: string; href?: string; status: AgentLiveStatus; kong?: boolean; color: string; cityAgent?: OfficeCityAgent; kongEvidence?: OfficeKongCentralSignal; whatsappEvidence?: WhatsAppOfficeView };

export function AgentsOfficeWorld({
  agents,
  kongTeam,
  legal,
  selectedAgentId,
  onSelectAgent,
  onSelectKongAgent,
  onOpenKongOffice,
  onOpenContact,
  kongWingRequest = 0,
}: {
  agents: WorldAgent[];
  kongTeam: BuildingTeamAgent[];
  legal: { data: unknown; isError: boolean };
  selectedAgentId?: string;
  onSelectAgent: (agentId: string, status: AgentLiveStatus) => void;
  onSelectKongAgent: (name: string) => void;
  onOpenKongOffice: () => void;
  kongWingRequest?: number;
  // Opens the same local chat for agents that are not in the classic list (cities, new agents, trainees).
  onOpenContact?: (contact: WorldContact) => void;
}) {
  const pageAgentIds = useMemo(() => agents.map((agent) => agent.id), [agents]);
  const probedIds = useMemo(() => [...pageAgentIds, ...EXTRA_AGENTS.map((agent) => agent.id)], [pageAgentIds]);
  const liveStatuses = useAgentLiveStatuses(probedIds, legal);
  const council = useCouncil();
  const companyView = (council.view || {}) as unknown as CompanyView;
  const [officeWing, setOfficeWing] = useState<"main" | "kong">("main");
  const company = officeWing === "kong" ? companyView.kongCompany : companyView.company;
  const careers: Record<string, AgentCareer> = company?.careers || {};
  const leaderboardRows = (officeWing === "kong" ? companyView.kongLeaderboard : companyView.leaderboard) || [];
  const personalities = (officeWing === "kong" ? companyView.kongPersonalities : companyView.personalities) || {};
  const integrations = companyView.integrations || effectiveIntegrations();
  const deputyId = leaderboardRows[0]?.points ? leaderboardRows[0].agentId : null;
  const queryClient = useQueryClient();
  const currentOwner = () => queryClient.getQueryData<{ user?: { id: string } }>(["auth-me"])?.user?.id;
  const snapshotAuth = useQuery<{ user?: { id: string } }>({ queryKey: ["auth-me"], enabled: false });
  const snapshotOwner = snapshotAuth.data?.user?.id;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const labelsRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<ReturnType<typeof createOfficeScene> | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [focusedDepartment, setFocusedDepartment] = useState<string | null>(null);
  const [panelAgentId, setPanelAgentId] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<"none" | "ranking" | "ceo" | "city-director" | "kong-talk" | "partners" | "blackroom-ceo-chat" | "blackroom-academy">("none");
  // Partners ("socios") see the whole office but only talk to / order the Black Room team.
  const workspace = useWorkspaceRole();
  const ceoOrdersLocked = workspace.isPartner && officeWing === "kong";
  const orderCompany = workspace.isPartner ? "blackroom" : officeWing;
  // Chat with the CEO Black Room: owner and partner only.
  const canChatBlackRoomCeo = workspace.isOwner || workspace.isPartner;
  const [directorCityId, setDirectorCityId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [orderText, setOrderText] = useState("");

  const [mainPanelMinimized, setMainPanelMinimized] = useState(false);
  const [cityDetailsOpen, setCityDetailsOpen] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const cityDirectory = useQuery<unknown>({ queryKey: ["/api/agents-office/cities"], enabled: officeWing === "kong", staleTime: 60_000, refetchInterval: cityRefreshInterval, retry: (count, error) => count < 2 && !/^(401|403):/.test(error.message), retryDelay: attempt => Math.min(1_000 * 2 ** attempt, 2_000) });
  const citySnapshot = useQuery<OfficeKongAuditResult & { collaboration?: OfficeKongCollaboration }>({ queryKey: kongOfficeSnapshotKey(snapshotOwner), queryFn: ({ signal }) => readOwnerKongSnapshot(snapshotOwner, currentOwner, signal), enabled: officeWing === "kong" && Boolean(snapshotOwner), staleTime: 45_000, refetchInterval: cityRefreshInterval, retry: (count, error) => count < 2 && !/^(401|403):/.test(error.message), retryDelay: attempt => Math.min(1_000 * 2 ** attempt, 2_000) });
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
  const refreshKongRings = () => {
    setKongRingAssignment(createKongRingAssignment(cityRooms, clock));
    setFocusedDepartment(null); setPanelAgentId(null); sceneRef.current?.focusDepartment(null);
  };
  const selectedCity = cityRooms.find(room => room.id === focusedDepartment);
  const directorCity = cityRooms.find(room => room.city.id === directorCityId) ?? cityRooms[0];
  const citySupervision = overlay === "city-director" && cityEvidence ? scoreOfficeKongSnapshot(cityEvidence, clock) : undefined;
  const directorScore = citySupervision?.cities.find(city => city.id === directorCity?.city.id);
  const reassignmentProposals = citySupervision?.verified ? citySnapshot.data?.collaboration?.exchanges.filter(exchange => exchange.proposal.action === "review_reassignment") ?? [] : [];
  const changeWing = (wing: "main" | "kong") => {
    setOfficeWing(wing); setFocusedDepartment(null); setPanelAgentId(null); setOverlay("none");
    setCityDetailsOpen(true); setMainPanelMinimized(false);
    sceneRef.current?.focusDepartment(null);
  };
  const focusRoom = (id: string | null) => {
    setFocusedDepartment(id); setPanelAgentId(null); sceneRef.current?.focusDepartment(id);
    if (id === "kong") changeWing("kong");
  };
  useEffect(() => { if (kongWingRequest > 0) changeWing("kong"); }, [kongWingRequest]);
  const wingRef = useRef(officeWing);
  wingRef.current = officeWing;
  // Bumped after every close attempt so a failed pick can be selected again.
  const [evidenceResetKey, setEvidenceResetKey] = useState(0);

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
  for (const member of centralKongTeam) {
    const seat = OFFICE_KONG_CENTRAL_SEATS.find(item => item.nativeName === member.name);
    if (!seat) continue;
    panelAgents.set(seat.id, { id: seat.id, name: seat.name, role: member.job,
      description: "Puesto central de KONG. Las señales proceden de la lectura autenticada de KONG Native.",
      status: statuses[seat.id], kong: true, color: "#a3e635", kongEvidence: centralSignalById.get(seat.id) });
  }

  const trainees: Trainee[] = (company?.trainees || []).filter((trainee) => !trainee.graduatedAt && !trainee.evaluationClosedAt);
  // Specialists the academy created for recurring work (approved by Robert in the Trust Center).
  const specialists = Object.values(careers).filter((career) => isSpecialistId(career.agentId));
  for (const career of specialists) {
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
  const academyIds = [...trainees.map((trainee) => `trainee:${trainee.id}`), ...specialists.map((career) => career.agentId)];
  const mainDepartments = [
    ...DEPARTMENTS,
    ...(academyIds.length ? [{ id: "academia", name: "Academia", color: "#60a5fa", agentIds: academyIds }] : []),
  ];
  const kongWing = buildKongOfficeWing(citySnapshot.data?.evidence, cityRooms, statuses, clock, kongRingAssignment, !citySnapshot.isError);
  const departments = officeWing === "main" ? mainDepartments : [
    ...kongWing.departments,
    ...(academyIds.length ? [{ id: "kong-academia", name: "Academia KONG", color: "#60a5fa", agentIds: academyIds, officeRing: 1 as const }] : []),
  ];
  for (const agent of kongWing.agents) panelAgents.set(agent.id, { ...panelAgents.get(agent.id), ...agent });
  const kongCollaboration = citySnapshot.isError || !cityEvidence || !scoreOfficeKongSnapshot(cityEvidence, clock).verified ? undefined : citySnapshot.data?.collaboration;
  // City jobs never inherit council careers, lessons or optimistic live probes.
  for (const room of cityRooms) for (const agent of room.agents) panelAgents.set(agent.id, {
    id: agent.id, name: agent.name, role: agent.role, description: `${agent.role} de ${room.city.name} · ${room.city.countryCode} · ${room.city.timeZone} · ${room.city.currency}`,
    status: agent.status, color: agent.color, cityAgent: agent,
  });
  for (const trainee of trainees) {
    panelAgents.set(`trainee:${trainee.id}`, {
      id: `trainee:${trainee.id}`,
      name: trainee.nickname,
      role: `En formacion: ${trainee.role}`,
      description: trainee.awaitingEvidence ? "Lectura terminada; faltan pruebas verificables. Esto no cambia su puesto ni acredita una mejora." : `Primero estudia su propio puesto (por que fallo, sus ordenes y lecciones), despues los documentos y la base de datos. Lleva ${trainee.modulesDone.length} ${trainee.modulesDone.length === 1 ? "modulo" : "modulos"}, ${(trainee.learned || []).length} sobre su puesto.`,
      status: { state: "checking", label: trainee.awaitingEvidence ? "Pendiente de pruebas reales" : `Estudiando · ${trainee.modulesDone.length} ${trainee.modulesDone.length === 1 ? "modulo" : "modulos"}`, activity: trainee.knowledge.slice(0, 4) },
      color: "#60a5fa",
    });
  }

  const sceneData: SceneData = {
    company: officeWing === "kong" ? "KONG" : "BlackOps",
    departments: departments.map((department) => ({
      id: department.id,
      name: department.name,
      color: department.color,
      officeRing: "officeRing" in department ? department.officeRing as 1 | 2 | 3 : undefined,
      agents: department.agentIds
        .map((id) => panelAgents.get(id))
        .filter((agent): agent is PanelAgent => Boolean(agent))
        .map((agent) => {
          const career = careers[agent.id];
          return {
            id: agent.id,
            name: agent.name,
            label: agent.status.label,
            state: agent.status.state,
            onDuty: isOnDuty(agent.status),
            color: agent.color,
            screen: SCREEN_KIND[agent.id] || "list",
            activity: agent.status.activity || [agent.status.label, agent.status.detail || ""].filter(Boolean),
            cityRole: agent.cityAgent?.role,
            badge: integrationFor(agent.id, integrations).mode !== "activa"
              ? INTEGRATION_LABEL[integrationFor(agent.id, integrations).mode]
              : career ? `${career.nickname} · ${career.points} pts` : undefined,
            battery: career?.battery,
            deputy: agent.id === deputyId,
            student: agent.id.startsWith("trainee:"),
          };
        }),
    })),
    debates: officeWing === "kong" ? (kongCollaboration?.exchanges || []).map(exchange => ({ from: "kong:city_operations", to: `kong-city:${exchange.cityId}:${exchange.category}` })) : (council.view?.debates || []).filter((debate) => debate.verdict !== "descartado").map((debate) => ({ from: debate.reviewer, to: debate.subject })),
  };
  const sceneKey = JSON.stringify(sceneData);
  const latestSceneKey = useRef(sceneKey);
  latestSceneKey.current = sceneKey;

  useEffect(() => {
    let cancelled = false;
    const host = hostRef.current;
    const labels = labelsRef.current;
    if (!host || !labels) return;
    const reducedMotion = typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
    // @ts-ignore three ships without type declarations in this repo; the scene module types it loosely.
    import("three")
      .then((THREE: unknown) => {
        if (cancelled) return;
        try {
          sceneRef.current = createOfficeScene(THREE, host, labels, {
            onFocusDepartment: (id) => {
              setFocusedDepartment(id);
              if (id === "kong") { setOfficeWing("kong"); setFocusedDepartment(null); setPanelAgentId(null); return; }
              if (id?.startsWith("kong-city:")) {
                setOfficeWing("kong");
                setPanelAgentId(null);
                setCityDetailsOpen(true);
              } else if (id) {
                if (wingRef.current !== "kong") setOfficeWing("main");
                setOverlay(value => value === "city-director" ? "none" : value);
                setPanelAgentId(null);
              }
            },
            onSelectAgent: (id) => { setPanelAgentId(id); if (id.startsWith("kong-city:")) setCityDetailsOpen(true); if (id === "blackroom-ceo") setOverlay(value => value === "none" ? "blackroom-ceo-chat" : value); },
            onOpenCityDirector: () => { setOfficeWing("kong"); setOverlay(value => value === "city-director" ? "none" : "city-director"); },
          }, { reducedMotion });
          sceneRef.current.update(JSON.parse(latestSceneKey.current));
        } catch (error) {
          setFailed(error instanceof Error ? error.message : "WebGL no disponible");
        }
      })
      .catch((error: unknown) => setFailed(error instanceof Error ? error.message : "No se pudo cargar el motor 3D"));
    return () => {
      cancelled = true;
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
    // The scene is created once; data changes go through update() below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    sceneRef.current?.update(JSON.parse(sceneKey));
  }, [sceneKey]);

  const post = async (url: string, body?: unknown) =>
    runProbe(url, (input, init) => fetch(input, { ...init, method: "POST", headers: { ...(init?.headers || {}), "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }));

  const refreshCouncil = () => queryClient.invalidateQueries({ queryKey: ["agent-council-state"] });

  const runCouncil = async () => {
    setBusy(true);
    const result = await post("/api/agent-council/run");
    setMessage(result.ok ? "El consejo se reunio." : result.status === 429 ? "El consejo acaba de reunirse; espera un minuto." : result.status === 409 ? "El consejo esta apagado." : "No se pudo reunir al consejo.");
    await refreshCouncil();
    setBusy(false);
  };

  const sendOrder = async () => {
    const text = orderText.trim();
    if (!text) return;
    setBusy(true);
    const result = await post("/api/agent-company/orders", { text, company: orderCompany });
    if (result.ok) {
      setOrderText("");
      setMessage("El CEO recibio la orden y la asigno.");
    } else {
      setMessage((result.body as { error?: string } | null)?.error || "No se pudo enviar la orden.");
    }
    await refreshCouncil();
    setBusy(false);
  };

  const markDone = async (orderId: string, evidenceRunId?: string) => {
    setBusy(true);
    const result = await post(`/api/agent-company/orders/${encodeURIComponent(orderId)}/done`, { ...(evidenceRunId && !workspace.isPartner ? { evidenceRunId } : {}), company: orderCompany });
    setMessage(result.ok ? (evidenceRunId ? "Orden cerrada con evidencia: puntos para quien trabajaba." : "Orden cerrada a mano: queda anotada, sin puntos.") : (result.body as { error?: string } | null)?.error || "No se pudo cerrar la orden.");
    await refreshCouncil();
    setEvidenceResetKey((value) => value + 1);
    setBusy(false);
  };

  if (failed && officeWing === "main") {
    return (
      <div className="absolute inset-0 overflow-y-auto px-4 pb-10 pt-24">
        <p className="mx-auto mb-4 max-w-[900px] rounded-lg border border-amber-300/30 bg-amber-300/10 p-3 text-xs text-amber-100" data-testid="world-fallback">
          Este navegador no pudo abrir la oficina 3D ({failed}). Te muestro el edificio con los mismos datos en vivo.
        </p>
        <button type="button" onClick={() => changeWing("kong")} className="mx-auto mb-4 block rounded-full bg-violet-500 px-5 py-3 font-bold text-white" data-testid="world-kong-wing">Ver oficina KONG</button>

        <AgentsBuilding agents={agents} kongTeam={centralKongTeam} legal={legal} selectedAgentId={selectedAgentId} onSelectAgent={onSelectAgent} onSelectKongAgent={onSelectKongAgent} />
      </div>
    );
  }

  const companyIds = departments.flatMap((department) => department.agentIds);
  const companyActivity = countActive(companyIds.map((id) => panelAgents.get(id)?.status));
  const verifiedTodayCount = officeWing === "main" ? countRoleWorkCompleted(roleWorkToday, companyIds) : 0;
  const selfHealTotal = selfHealTotals(selfHeal, companyIds);
  const focused = departments.find((department) => department.id === focusedDepartment) || null;
  const focusedAgents = focused ? focused.agentIds.map((id) => panelAgents.get(id)).filter((agent): agent is PanelAgent => Boolean(agent)) : [];
  const panelAgent = (panelAgentId && focusedAgents.find((agent) => agent.id === panelAgentId)) || focusedAgents[0] || null;
  const focusedIds = new Set(focused?.agentIds || []);
  const proposals = (council.view?.proposals || []).filter((proposal) => ["submitted", "pending_submit", "not_submitted"].includes(proposal.status) && (focusedIds.has(proposal.owner) || (proposal.lesson && focusedIds.has(proposal.lesson.subject)) || [...focusedIds].some((id) => proposal.key.startsWith(`repair:${id}#`))));
  const debates = (council.view?.debates || []).filter((debate) => focusedIds.has(debate.reviewer) || focusedIds.has(debate.subject));
  const sourceMap = new Map<string, { name: string; state: AgentLiveState; label: string; users: string[]; activeUsers: number }>();
  const rank: Record<AgentLiveState, number> = { error: 4, "needs-setup": 3, offline: 2, checking: 1, available:1, working: 0 };
  for (const agent of focusedAgents) {
    if (agent.id.startsWith("trainee:")) continue;
    const name = agent.cityAgent ? "Auditoria autenticada KONG" : (agent.kong || agent.id.startsWith("kong:")) ? "Lectura autenticada KONG" : SOURCE_NAME[agent.id] || agent.name;
    const current = sourceMap.get(name);
    const active = isActiveStatus(agent.status) ? 1 : 0;
    if (!current) sourceMap.set(name, { name, state: agent.status.state, label: agent.status.label, users: [agent.name], activeUsers: active });
    else {
      current.users.push(agent.name);
      current.activeUsers += active;
      if (rank[agent.status.state] > rank[current.state]) Object.assign(current, { state: agent.status.state, label: agent.status.label });
    }
  }
  const sources = Array.from(sourceMap.values());
  // A source counts as live when at least one of its agents has current evidence (working or on duty) and none reports a problem.
  const sourceLive = (source: (typeof sources)[number]) => source.activeUsers > 0 && source.state !== "error" && source.state !== "needs-setup";
  const orders: CompanyOrder[] = company?.orders || [];
  const nameOf = (id: string) => panelAgents.get(id)?.name || id;
  // KONG city agents are measured by the KONG audit score (their own system), not by council careers.
  const panelCareer = panelAgent ? careers[panelAgent.id] : undefined;
  // Every agent has a personality: from its career when it has one, otherwise the same deterministic pick.
  const panelPersonality = panelAgent ? personalities[panelAgent.id] || personalityFor(panelAgent.id, 1) : undefined;
  const panelIntegration = panelAgent ? integrationFor(panelAgent.id, integrations) : undefined;
  const lifeNotApplicable = !panelAgent
    ? ""
    : panelAgent.cityAgent
      ? "Esperando resultados verificados de este puesto en el consejo KONG."
      : panelAgent.id.startsWith("trainee:")
      ? "En formacion en la academia: empieza a ganar o perder vida cuando se gradue."
      : panelIntegration && panelIntegration.mode !== "activa"
        ? panelIntegration.reason
        : COUNCIL_AGENTS[panelAgent.id]
          ? "Parte del consejo: revisa a los demas y no se mide a si mismo."
          : panelAgent.id === "ceo"
            ? "El CEO dirige; no compite en la tabla."
            : panelAgent.status.state === "checking"
              ? "Todavia no hay lectura de su trabajo; la vida empieza cuando el consejo lo mida."
              : "Se le abre la carrera en la proxima ronda del consejo (cada 15 min).";
  const evidenceBody = (queryClient.getQueryData(["agents-building-probe", "automation-runs"]) as { ok?: boolean; body?: unknown } | undefined)?.body;
  // A partner gets a redacted object here, never the run list.
  const evidenceRuns = (Array.isArray(evidenceBody) ? evidenceBody as Array<{ id?: string; status?: string; resultSummary?: string | null; startedAt?: string }> : [])
    .filter((run) => officeWing !== "kong" && run && typeof run.id === "string" && run.status === "success")
    .slice(0, 10);
  const panelRank = panelAgent ? leaderboardRows.find((row) => row.agentId === panelAgent.id) : undefined;
  const panelOrders = panelAgent ? orders.filter((order) => order.assignees.some((assignee) => assignee.agentId === panelAgent.id)).slice(0, 4) : [];

  return (
    <div className="absolute inset-0 overflow-hidden bg-[#04060b]" data-testid="agents-office-world">
      <div ref={hostRef} className="absolute inset-0" data-testid="world-canvas-host" />
      <div ref={labelsRef} className="pointer-events-none absolute inset-0 overflow-hidden" />

      <section className={cn("absolute bottom-3 left-3 z-10 max-h-[45%] overflow-y-auto rounded-2xl border border-white/10 bg-[#04060b]/95 p-3 text-white shadow-2xl", !mainPanelMinimized && "w-[min(365px,calc(100vw-1.5rem))]")} aria-label="Controles de oficina">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.2em] text-cyan-100" data-testid="world-company-label">{officeWing === "kong" ? "KONG · la empresa" : "BlackOps · la empresa"}</h2>
          <button type="button" aria-expanded={!mainPanelMinimized} aria-controls="world-office-panel-content" onClick={() => setMainPanelMinimized(v => !v)} className="rounded-full border border-white/20 px-2 py-1 text-xs" data-testid="world-main-panel-toggle">{mainPanelMinimized ? "Abrir" : "Minimizar"}</button>
        </div>
        <div id="world-office-panel-content" hidden={mainPanelMinimized}>
          <p className="mt-2 text-lg font-black" data-testid="world-active-count" title="Activos = ejecutando ahora (reserva viva) + al día (último trabajo verificado dentro de su turno, sin fallos).">{companyActivity.active} de {companyActivity.total} activos · <span data-testid="world-working-count">{companyActivity.working} ejecutando ahora</span></p>
          {officeWing === "main" && <p className="mt-1 text-sm font-semibold text-emerald-200" data-testid="world-verified-today-count">{verifiedTodayCount} de {companyIds.length} con trabajo verificado hoy (ejecutor de la oficina)</p>}
          {officeWing === "main" && selfHeal.enabled && <p className="mt-1 text-xs text-zinc-300" data-testid="world-self-heal-summary">Auto-reparación: {selfHealTotal.detected} detectados · {selfHealTotal.repairing} en reparación · {selfHealTotal.verified} reparados y verificados · {selfHealTotal.needsOwner} necesitan al dueño{selfHealTotal.readyToMerge ? ` · ${selfHealTotal.readyToMerge} PR listos para fusionar (decide el dueño)` : ""}</p>}
          {officeWing === "kong" && <p className="mt-1 text-xs text-zinc-300">Todos los puestos centrales y {cityRooms.length} ciudades en la misma oficina. La oficina observa y coordina; abrirla no activa los ejecutores.</p>}
          {officeWing === "kong" && <div className="mt-2 space-y-1 text-[11px] text-zinc-300" data-testid="world-kong-rings-legend">
            <p><span className="text-amber-200">1 · Equipo central</span> · <span className="text-cyan-200">2 · Ciudades prioritarias ({kongRingAssignment?.busyCityIds.length ?? 0})</span> · <span className="text-violet-200">3 · Resto de ciudades</span></p>
            <p>{kongRingAssignment?.basis === "events" ? "Prioridad por eventos próximos (30 días); desempate por puestos con trabajo completado en 24 h. No mide reservas ni ventas." : kongRingAssignment?.basis === "operations" ? "Sin volumen de eventos disponible: prioridad por actividad operativa registrada (puestos con último intento completado en 24 h, incluidos fallos)." : "Sin datos vigentes para priorizar ciudades; el segundo anillo espera evidencia."}</p>
            <p>Distribución fija{kongRingAssignment ? ` desde ${new Date(kongRingAssignment.classifiedAt).toLocaleTimeString("es", {hour: "2-digit", minute: "2-digit"})}` : " hasta recibir evidencia"}; los estados siguen actualizándose.</p>
            <button type="button" onClick={refreshKongRings} disabled={!canClassifyKongCities} className="rounded-full border border-white/20 px-2 py-1 disabled:opacity-40" data-testid="world-kong-refresh-rings">Actualizar distribución</button>
          </div>}
          <p className="mt-1 text-xs text-zinc-400">{trainees.length} en la academia · puntuación por evidencia registrada.</p>
          {officeWing === "kong" && (citySnapshot.isError || cityDirectory.isError) && <p role="status" className="mt-1 text-xs text-amber-200">Actividad de KONG sin conectar. Los puestos no muestran trabajo sin evidencia vigente.</p>}
          {failed && <p role="status" className="mt-1 text-xs text-amber-200" data-testid="world-kong-fallback">Vista 3D no disponible. Todos los agentes están accesibles por departamento.</p>}
          {company?.events?.[0] && <p className="mt-1 text-xs text-violet-200" data-testid="world-last-event">Último: {company.events[0].text}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => changeWing(officeWing === "kong" ? "main" : "kong")} className="rounded-full bg-violet-500 px-3 py-2 text-xs font-bold" data-testid="world-kong-wing">{officeWing === "kong" ? "Volver a la oficina principal" : "Ver oficina KONG"}</button>
            <button type="button" onClick={() => focusRoom(null)} className="rounded-full border border-white/20 px-3 py-2 text-xs" data-testid="world-overview">Vista general</button>
            <button type="button" onClick={() => { const target = canChatBlackRoomCeo && officeWing === "main" ? "blackroom-ceo-chat" : "ceo"; setOverlay(overlay === target ? "none" : target); }} className="rounded-full bg-amber-300 px-3 py-2 text-xs font-bold text-black hover:bg-amber-200" data-testid="world-ceo-channel">💬 {canChatBlackRoomCeo && officeWing === "main" ? "Chat con el CEO" : workspace.isPartner ? "Canal con el CEO Black Room" : "Canal con el CEO"}</button>
            <button type="button" onClick={() => setOverlay(overlay === "ranking" ? "none" : "ranking")} className="rounded-full border border-emerald-200/40 px-3 py-2 text-xs text-emerald-100" data-testid="world-ranking">Tabla de posiciones</button>
            {officeWing === "main" && <button type="button" onClick={() => setOverlay(overlay === "blackroom-academy" ? "none" : "blackroom-academy")} className="rounded-full border border-fuchsia-200/40 px-3 py-2 text-xs text-fuchsia-100" data-testid="world-blackroom-academy">Academia Black Room</button>}
            {!workspace.isPartner && <button type="button" onClick={runCouncil} disabled={busy || !council.view} className="rounded-full border border-violet-200/40 px-3 py-2 text-xs disabled:opacity-50" data-testid="world-council-run">Reunir consejo</button>}
            {workspace.isOwner && <button type="button" onClick={() => setOverlay(overlay === "partners" ? "none" : "partners")} className="rounded-full border border-fuchsia-200/40 px-3 py-2 text-xs text-fuchsia-100" data-testid="world-partner-invite">Invitar socio</button>}
            {officeWing === "kong" && <>
              <button type="button" onClick={() => setOverlay(overlay === "kong-talk" ? "none" : "kong-talk")} className="rounded-full border border-cyan-200/40 px-3 py-2 text-xs text-cyan-100" data-testid="world-kong-collaboration">Colaboración · {kongCollaboration?.exchanges.length ?? 0}</button>
              <button type="button" onClick={() => setOverlay(overlay === "city-director" ? "none" : "city-director")} className="rounded-full border border-amber-200/40 px-3 py-2 text-xs" data-testid="world-city-director-toggle">Director de ciudades</button>
            </>}
          </div>
          <nav className="mt-3 flex flex-wrap gap-1.5" aria-label="Departamentos" data-testid="world-deptnav">
            {departments.map(department => <button key={department.id} type="button" onClick={() => { focusRoom(department.id); setCityDetailsOpen(true); }} aria-pressed={focusedDepartment === department.id} className="rounded-full border px-2 py-1 text-[11px] hover:bg-white/15" style={{borderColor: department.color}} data-testid={`world-nav-${department.id}`}>{department.name}</button>)}
          </nav>
          {workspace.isPartner && <p className="mt-2 text-[11px] text-fuchsia-200" data-testid="world-partner-note">Vista de socio: ves toda la oficina; solo puedes hablar, dar órdenes y aprobar con el equipo de Black Room. El resto es solo Robert.</p>}
          {message && <p role="status" className="mt-2 text-xs text-violet-100" data-testid="world-message">{message}</p>}
        </div>
      </section>
      {officeWing === "kong" && overlay === "kong-talk" && <section aria-label="Colaboración KONG" className="absolute right-3 top-[220px] z-30 sm:top-36 lg:top-24 max-h-[48%] w-[min(420px,calc(100vw-1.5rem))] overflow-y-auto rounded-2xl border border-cyan-200/25 bg-[#07131b]/95 p-4 text-xs text-white" data-testid="world-kong-collaboration-panel">
        <div className="flex justify-between gap-2"><h2 className="font-bold text-cyan-100">Colaboración KONG</h2><button type="button" onClick={() => setOverlay("none")} aria-label="Cerrar colaboración">Cerrar</button></div>
        <p className="mt-2 text-zinc-300">Revisión automática de evidencia entre supervisión y operaciones. Son propuestas pendientes de revisión; no conversaciones de IA ni acciones ya ejecutadas.</p>
        {!kongCollaboration?.exchanges.length && <p className="mt-3">Sin intercambios con evidencia vigente.</p>}
        {kongCollaboration?.exchanges.map(exchange => <article key={exchange.id} className="mt-3 rounded-lg border border-white/10 p-2">
          <h3 className="font-bold">{cityRooms.find(room => room.city.id === exchange.cityId)?.name ?? exchange.cityId} · {exchange.category}</h3>
          {exchange.comments.map(comment => <p key={comment.author} className="mt-1"><b>{comment.author === "supervisor" ? "Supervisor" : "Operaciones"}:</b> {comment.text}</p>)}
          <p className="mt-2 text-amber-100">Para el CEO · {exchange.proposal.text}</p>
        </article>)}
      </section>}

      {officeWing === "kong" && overlay === "city-director" && <section aria-label="Director de ciudades de KONG" data-testid="world-city-director-panel" className="absolute top-[220px] right-3 z-30 sm:top-36 lg:top-24 max-h-[45%] w-[min(410px,calc(100vw-1.5rem))] space-y-2 overflow-y-auto rounded-2xl border border-amber-200/25 bg-[#120d04]/95 p-3 text-xs text-white shadow-2xl [color-scheme:dark]">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-amber-100">Director de ciudades · KONG</h2>
          <button type="button" onClick={() => setOverlay("none")} className="rounded-full border border-white/20 px-2 py-1">Cerrar</button>
        </div>
        <p className="text-slate-300">El coordinador de KONG asigna los turnos de los siete puestos. El director calcula los puntos con el resultado registrado y propone relevos para revisión cuando hay intentos repetidos sin éxito.</p>
        <label className="block" htmlFor="world-director-city">Equipo de ciudad</label>
        <select id="world-director-city" className="w-full rounded border border-white/20 bg-[#120d04] px-2 py-1" value={directorCity?.city.id ?? ""} disabled={!directorCity} onChange={event => setDirectorCityId(event.target.value)}>
          {cityRooms.map(room => <option key={room.id} value={room.city.id}>{room.name}</option>)}
        </select>
        {!citySupervision?.verified && <p className="text-amber-200">Sin evidencia vigente para asignar puntos o proponer relevos.</p>}
        {directorScore?.points != null && <p className="font-semibold">{directorScore.scoredCategories === directorScore.totalCategories ? "Puntos del equipo" : "Puntaje parcial"}: {directorScore.points}/100 · {directorScore.scoredCategories}/{directorScore.totalCategories} puestos verificados</p>}
        <ul className="space-y-1">{directorCity?.agents.map(agent => {
          const grade = directorScore?.categories.find(category => category.category === agent.category);
          return <li key={agent.id} className="border-t border-white/10 pt-1">
            <strong>{agent.role}</strong> · {grade?.points == null ? "Sin puntuación" : `${grade.points}/100`}
            <p>{OFFICE_KONG_CITY_TASKS[agent.category]}</p>
            <p className="text-slate-400">{agent.status.label}{agent.nextWorkAt ? ` · Próximo turno: ${formatCityTime(agent.nextWorkAt)}` : ""}</p>
          </li>;
        })}</ul>
        <h3 className="font-semibold text-amber-100">Relevos propuestos · {reassignmentProposals.length}</h3>
        {reassignmentProposals.map(item => <p key={item.id} className="text-amber-200">{cityRooms.find(room => room.city.id === item.cityId)?.name ?? item.cityId} · {item.category} · {item.proposal.text}</p>)}
        <a href="https://kongnightlife.com/admin/ceo" className="inline-block text-amber-100 underline">Abrir la revisión del CEO en KONG</a>
      </section>}
      {overlay === "ranking" && (
        <section className="absolute top-[220px] right-3 z-30 sm:top-36 lg:top-24 max-h-[45%] w-[min(380px,calc(100vw-1.5rem))] overflow-y-auto rounded-2xl border border-emerald-200/20 bg-[#06100d]/95 p-4 text-white shadow-2xl [color-scheme:dark]" data-testid="world-ranking-panel">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-emerald-200">Tabla de posiciones</p>
            <button type="button" onClick={() => setOverlay("none")} className="text-xs text-zinc-400 hover:text-white">✕</button>
          </div>
          <p className="mt-1 text-[11px] text-zinc-400">Puntos por resultados distintos y verificados. Conectarse, consultar y cerrar órdenes a mano no suma puntos.</p>
          {leaderboardRows.length === 0 && <p className="mt-3 text-xs text-zinc-400">{officeWing === "kong" ? "Todavía no hay puntos: faltan resultados completados con evidencia verificable." : "Todavía no hay puntos: el consejo revisa las evidencias en cada reunión."}</p>}
          <ol className="mt-3 space-y-1.5">
            {leaderboardRows.slice(0, 15).map((row) => (
              <li key={row.agentId} className="flex items-center gap-2 rounded-lg bg-white/[0.04] px-2 py-1.5 text-[11px]" data-testid="world-ranking-row">
                <span className="w-6 text-center font-black text-zinc-300">{row.rank === 1 ? "👑" : row.rank}</span>
                <span className="min-w-0 flex-1 truncate"><b>{nameOf(row.agentId)}</b> <span className="text-zinc-400">· {row.nickname} · {row.title}</span></span>
                <span className="font-mono text-emerald-200">{row.points}</span>
                <span className={cn("font-mono", row.battery > 60 ? "text-emerald-300" : row.battery > 25 ? "text-amber-200" : "text-rose-300")}>{row.battery}%</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {overlay === "partners" && workspace.isOwner && <PartnerInvitePanel onClose={() => setOverlay("none")} />}
      {overlay === "blackroom-academy" && officeWing === "main" && <BlackRoomAcademyPanel company={companyView.company} onClose={() => setOverlay("none")} />}
      {overlay === "blackroom-ceo-chat" && canChatBlackRoomCeo && <BlackRoomCeoChatPanel onClose={() => setOverlay("none")} onShowTasks={officeWing === "main" ? () => setOverlay("ceo") : undefined} />}

      {overlay === "ceo" && (
        <section className="absolute top-[220px] right-3 z-30 sm:top-36 lg:top-24 flex max-h-[45%] w-[min(420px,calc(100vw-1.5rem))] flex-col rounded-2xl border border-amber-200/25 bg-[#120d04]/95 p-4 text-white shadow-2xl [color-scheme:dark]" data-testid="world-ceo-panel">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-amber-200">{officeWing === "main" && canChatBlackRoomCeo ? "Tareas de la oficina" : "Canal directo con el CEO"}</p>
            <div className="flex items-center gap-2">
              {officeWing === "main" && canChatBlackRoomCeo && <button type="button" onClick={() => setOverlay("blackroom-ceo-chat")} className="rounded-full bg-amber-300 px-2.5 py-1 text-[11px] font-bold text-black" data-testid="world-ceo-back-to-chat">💬 Volver al chat</button>}
              <button type="button" onClick={() => setOverlay("none")} className="text-xs text-zinc-400 hover:text-white">✕</button>
            </div>
          </div>
          {workspace.isPartner && <p className="mt-1 text-[11px] text-fuchsia-200" data-testid="world-ceo-partner-note">{ceoOrdersLocked ? "Solo Robert: las órdenes de KONG no están disponibles para socios." : "Tus órdenes van al CEO de Black Room y solo se asignan a su equipo."}</p>}
          <p className="mt-1 text-[11px] text-zinc-400">{officeWing === "kong" ? "Escribe una orden para coordinar al equipo KONG. Queda asignada, pero no activa ejecutores. Aquí puedes cerrarla a mano con 0 puntos; los resultados de KONG se verifican por separado." : "Escribe lo que necesitas y el CEO lo asigna al departamento correcto. Queda anotado como tarea: los agentes no la ejecutan solos. Para dar puntos, ciérrala con una ejecución exitosa como evidencia; cerrarla a mano solo la anota."}</p>
          {!ceoOrdersLocked && <div className="mt-3 flex gap-2">
            <input
              value={orderText}
              onChange={(event) => setOrderText(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") void sendOrder(); }}
              aria-label="Orden para el CEO"
              placeholder={officeWing === "kong" ? "Ej: revisar eventos de Miami" : "Ej: revisar el video nuevo de Black Room"}
              maxLength={500}
              className="min-w-0 flex-1 rounded-full border border-white/10 bg-black/50 px-3 py-2 text-xs text-white placeholder:text-zinc-500 focus:border-amber-200/50 focus:outline-none"
              data-testid="world-order-input"
            />
            <button type="button" onClick={sendOrder} disabled={busy || !orderText.trim()} className="rounded-full bg-amber-300 px-3 py-2 text-xs font-bold text-black hover:bg-amber-200 disabled:opacity-50" data-testid="world-order-send">Enviar</button>
          </div>}
          <div className="mt-3 space-y-2 overflow-y-auto">
            {orders.length === 0 && <p className="text-xs text-zinc-500">Todavia no hay ordenes.</p>}
            {orders.slice(0, 8).map((order) => (
              <div key={order.id} className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-2" data-testid="world-order">
                <p className="text-xs text-white">{order.text}</p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {order.assignees.map((assignee) => (
                    <span key={assignee.agentId} title={assignee.note} className={cn("rounded-full border px-2 py-0.5 text-[10px]", assignee.status === "hecha" ? "border-emerald-300/40 text-emerald-200" : assignee.status === "en_curso" ? "border-sky-300/40 text-sky-100" : "border-rose-300/40 text-rose-200")}>
                      {nameOf(assignee.agentId)} · {assignee.status === "en_curso" ? "asignada" : assignee.status === "bloqueada" ? "agente parado" : assignee.status}
                    </span>
                  ))}
                </div>
                {order.doneAt && (
                  <p className="mt-1 text-[10px] text-zinc-500">{order.closedBy === "evidencia" ? `Cerrada con evidencia: ${order.evidence?.summary || ""}` : "Cerrada a mano (sin puntos)"}</p>
                )}
                {!order.doneAt && !ceoOrdersLocked && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    {!workspace.isPartner && <select
                      key={`${order.id}-${evidenceResetKey}`}
                      defaultValue=""
                      disabled={busy || evidenceRuns.length === 0}
                      onChange={(event) => { if (event.target.value) void markDone(order.id, event.target.value); }}
                      className="max-w-[220px] rounded-full border border-emerald-300/30 bg-black/60 px-2 py-0.5 text-[10px] text-emerald-100"
                      data-testid="world-order-evidence"
                    >
                      <option value="">{evidenceRuns.length ? "Cerrar con evidencia..." : "Sin ejecuciones exitosas"}</option>
                      {evidenceRuns.map((run) => <option key={run.id} value={run.id}>{(run.resultSummary || "Ejecucion exitosa").slice(0, 40)}</option>)}
                    </select>}
                    <button type="button" onClick={() => markDone(order.id)} disabled={busy} className="text-[10px] font-semibold text-zinc-300 hover:underline" data-testid="world-order-done">Cerrar a mano (0 pts)</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {!focused && overlay === "none" && (
        <p className={cn("pointer-events-none absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full border border-white/10 bg-black/60 px-4 py-2 text-xs text-zinc-300", officeWing === "kong" && "hidden sm:block")}>
          {failed ? "Vista sin 3D: elige un departamento para ver sus agentes." : officeWing === "kong" ? "Todos los agentes de KONG · toca un departamento para entrar" : "Arrastra para girar · rueda para acercar · toca un departamento para entrar"}
        </p>
      )}

      {focused && (
        <aside className="absolute right-3 top-[220px] z-20 sm:top-36 lg:top-24 flex max-h-[42%] w-[min(390px,calc(100vw-1.5rem))] flex-col overflow-y-auto rounded-2xl border border-white/10 bg-[#070b14]/95 p-3 text-white shadow-2xl sm:max-h-[65%]" data-testid="world-panel">
          <div className="flex shrink-0 items-start justify-between gap-2">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.24em]" style={{ color: focused.color }}>{focused.name}</p>
              <p className="mt-0.5 text-xs text-zinc-400" data-testid="world-room-active-count">{activeSummary(focusedAgents.map((agent) => agent.status))}</p>
              {focused.id === "blackroom" && canChatBlackRoomCeo && <button type="button" onClick={() => setOverlay("blackroom-ceo-chat")} className="mt-1 rounded-full border border-fuchsia-200/40 px-2 py-0.5 text-[11px] text-fuchsia-100 hover:bg-fuchsia-300/10" data-testid="world-blackroom-dept-chat">Hablar con el CEO Black Room</button>}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {selectedCity && <button type="button" aria-expanded={cityDetailsOpen} aria-controls="world-city-details-content" onClick={() => setCityDetailsOpen(open => !open)} className="rounded-full border border-white/20 px-2 py-1 text-[11px] font-semibold text-white hover:bg-white/10" data-testid="world-city-details-toggle">{cityDetailsOpen ? "Minimizar" : "Ver detalles"}</button>}
              <button type="button" onClick={() => focusRoom(null)} className="rounded-full border border-white/10 px-2 py-0.5 text-xs text-zinc-300 hover:bg-white/10" aria-label="Cerrar departamento">✕</button>
            </div>
          </div>

          <div id={selectedCity ? "world-city-details-content" : undefined} hidden={Boolean(selectedCity) && !cityDetailsOpen} className={selectedCity && cityDetailsOpen ? "flex min-h-0 flex-col overflow-y-auto pr-1" : undefined}>

          {sources.length > 0 && (
            <section className="mt-4">
              <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">
                <span>Fuentes conectadas</span>
                <span className="text-emerald-300" data-testid="world-sources-live">{sources.filter(sourceLive).length} live</span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                {sources.map((source) => (
                  <div key={`src-${source.name}`} className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-2 py-1.5" title={source.users.join(", ")}>
                    <p className="truncate text-[11px] font-semibold">{source.name}</p>
                    <p className={cn("truncate text-[10px]", sourceLive(source) ? (source.state === "working" ? STATE_TEXT.working : "text-teal-300") : STATE_TEXT[source.state])}>● {sourceLive(source) ? `conectado · ${source.activeUsers} de ${source.users.length} agente${source.users.length === 1 ? "" : "s"} activo${source.activeUsers === 1 ? "" : "s"}` : source.label}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className={selectedCity ? "mt-2" : "mt-4"}>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">{focused.id === "academia" ? "Alumnos" : "Agentes en paralelo"}</p>
            <div className={selectedCity ? "mt-1 grid grid-cols-2 gap-1" : "mt-2 space-y-1.5"}>
              {focusedAgents.map((agent) => {
                const career = careers[agent.id];
                return (
                  <button key={`row-${agent.id}`} type="button" onClick={() => setPanelAgentId(agent.id)} className={cn("w-full rounded-lg px-2 py-1.5 text-left hover:bg-white/5", panelAgent?.id === agent.id && "bg-white/[0.06]")} data-testid={`world-agent-row-${agent.id}`}>
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="truncate font-mono text-zinc-100">{agent.id === deputyId ? "👑 " : ""}{agent.cityAgent ? agent.role : agent.name}{career ? <span className="text-zinc-500"> · {career.nickname}</span> : null}</span>
                      <span className={cn("truncate text-[10px]", statusText(agent.status))}>{agent.status.label}</span>
                    </div>
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/10">
                      <div className={cn("h-full rounded-full", statusBar(agent.status), isOnDuty(agent.status) ? "" : agent.status.state === "working" ? "w-1/2 motion-safe:animate-[world-progress_2.4s_ease-in-out_infinite]" : agent.status.state === "error" ? "w-full" : "w-1/4")} />
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {panelAgent && (
            <section className={cn("rounded-xl border border-white/10 bg-white/[0.03]", panelAgent.cityAgent ? "order-first mt-2 p-2" : "mt-4 p-3")} data-testid="world-agent-card">
              <p className="text-sm font-bold">{panelAgent.name}{panelCareer ? <span className="font-normal text-zinc-400"> · {panelCareer.nickname} (gen {panelCareer.generation})</span> : null}</p>
              <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">{panelAgent.role}{panelRank ? ` · #${panelRank.rank} · ${panelRank.title}` : ""}</p>
              {panelIntegration && panelIntegration.mode !== "activa" && (
                <p className="mt-1 inline-block rounded-full border border-sky-200/30 bg-sky-400/10 px-2 py-0.5 text-[10px] font-semibold text-sky-100" data-testid="world-integration">
                  {INTEGRATION_LABEL[panelIntegration.mode]}{panelIntegration.owner === "externo:codex" ? " · Codex" : ""}
                </p>
              )}
              {panelCareer && (
                <div className="mt-2 grid grid-cols-3 gap-1.5 text-center" data-testid="world-career">
                  <div className="rounded-lg bg-black/40 p-1.5"><p className="text-[9px] uppercase text-zinc-500">Bateria</p><p className={cn("text-sm font-bold", panelCareer.battery > 60 ? "text-emerald-300" : panelCareer.battery > 25 ? "text-amber-200" : "text-rose-300")}>{panelCareer.battery}%</p></div>
                  <div className="rounded-lg bg-black/40 p-1.5"><p className="text-[9px] uppercase text-zinc-500">Puntos</p><p className="text-sm font-bold text-white">{panelCareer.points}</p></div>
                  <div className="rounded-lg bg-black/40 p-1.5"><p className="text-[9px] uppercase text-zinc-500">Confiable</p><p className="text-sm font-bold text-white">{panelRank?.reliability ?? 0}%</p></div>
                </div>
              )}
              {panelCareer && panelIntegration?.mode === "activa" && !COUNCIL_AGENTS[panelAgent.id] && panelAgent.id !== "ceo" && !panelAgent.id.startsWith(SPECIALIST_PREFIX) && (
                <p className="mt-1 text-[10px] text-zinc-500" data-testid="world-rotation">
                  Rotacion: si su vida llega a 0% el CEO lo reemplaza y el nuevo pasa por la academia.{panelCareer.firedCount ? ` Ya rotado ${panelCareer.firedCount} ${panelCareer.firedCount === 1 ? "vez" : "veces"}.` : ""}
                </p>
              )}
              {(!panelCareer || (panelIntegration && panelIntegration.mode !== "activa")) && (
                <div className="mt-2 rounded-lg bg-black/40 p-2 text-[11px]" data-testid="world-life-na">
                  <span className="font-semibold text-zinc-200">Vida: {panelCareer ? `${panelCareer.battery}% (congelada)` : "no aplica"}</span>
                  <span className="text-zinc-400"> · {lifeNotApplicable}</span>
                </div>
              )}
              {panelPersonality && (
                <p className="mt-2 text-[11px] text-zinc-300">Personalidad: {panelPersonality.traits.join(", ")} · <i>"{panelPersonality.motto}"</i></p>
              )}
              <p className="mt-2 text-xs leading-5 text-zinc-300">{panelAgent.description}</p>
              {panelAgent.id === "blackroom-ceo" && canChatBlackRoomCeo && <button type="button" onClick={() => setOverlay("blackroom-ceo-chat")} className="mt-2 rounded-full bg-fuchsia-300 px-3 py-1 text-[11px] font-bold text-black hover:bg-fuchsia-200" data-testid="world-blackroom-ceo-open-chat">Abrir chat con el CEO</button>}
              <div className="mt-2 rounded-lg border border-white/[0.06] bg-black/40 p-2">
                <p className={cn("text-[11px] font-semibold", statusText(panelAgent.status))}>Ahora: {panelAgent.status.label}</p>
                {panelAgent.status.detail && <p className="mt-0.5 text-[11px] text-zinc-400">{panelAgent.status.detail}</p>}
              </div>
              {(panelAgent.status.problems || []).length > 0 && (
                <div className="mt-2 rounded-lg border border-rose-300/20 bg-rose-500/5 p-2 text-[11px] text-rose-100" data-testid="world-problems">
                  <p className="mb-1 text-[9px] uppercase tracking-[0.18em] text-rose-200">Problemas</p>
                  {(panelAgent.status.problems || []).map((problem) => <p key={problem}>· {problem}</p>)}
                </div>
              )}
              {(panelAgent.status.activity || []).length > 0 && (
                <div className="mt-2 rounded-lg bg-[#020617] p-2 font-mono text-[10px] leading-4 text-zinc-300">
                  <p className="mb-1 text-[9px] uppercase tracking-[0.18em] text-zinc-500">{panelAgent.cityAgent ? "Evidencia del trabajo" : "Trabajo en vivo"}</p>
                  {(panelAgent.status.activity || []).map((line, index) => <p key={`${index}-${line}`} className="truncate">&gt; {line}</p>)}
                </div>
              )}
              {panelAgent.cityAgent && <dl className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-zinc-300" data-testid="world-city-evidence">
                <div><dt className="text-zinc-500">Último resultado registrado</dt><dd>{formatCityTime(panelAgent.cityAgent.lastWorkAt)}</dd></div>
                <div><dt className="text-zinc-500">Ultimo inicio</dt><dd>{formatCityTime(panelAgent.cityAgent.lastStartedAt)}</dd></div>
                <div><dt className="text-zinc-500">Proximo trabajo registrado</dt><dd>{formatCityTime(panelAgent.cityAgent.nextWorkAt)}</dd></div>
                <div className="col-span-2"><dt className="text-zinc-500">Bloqueo / limite actual</dt><dd>{panelAgent.cityAgent.blocker}</dd></div>
                <div><dt className="text-zinc-500">Auditoria consultada</dt><dd>{formatCityTime(panelAgent.cityAgent.snapshotAt)}</dd></div>
              </dl>}
              {panelCareer && (panelCareer.skills || []).length > 0 && (
                <div className="mt-2 rounded-lg border border-sky-300/15 bg-sky-500/5 p-2 text-[10px] leading-4 text-zinc-300" data-testid="world-skills">
                  <p className="mb-1 text-[9px] uppercase tracking-[0.18em] text-sky-200">Skills ganadas</p>
                  <div className="flex flex-wrap gap-1">
                    {(panelCareer.skills || []).slice(0, 8).map((skill) => (
                      <span key={skill.id} className="rounded-full border border-sky-200/20 bg-black/40 px-2 py-0.5" title={`${skill.source === "academia" ? "Aprendida en la academia" : skill.source === "orden" ? "Ordenes cerradas con evidencia" : "Leccion aprobada en el Trust Center"} · ${skill.uses} ${skill.uses === 1 ? "vez" : "veces"}`}>
                        {skill.title}{skill.uses > 1 ? ` ×${skill.uses}` : ""}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {panelAgent.whatsappEvidence && <div className="mt-2 space-y-1 rounded-lg border border-lime-300/20 bg-lime-300/5 p-2 text-[11px]" data-testid="world-whatsapp-evidence">
                <p className="font-semibold">{panelAgent.whatsappEvidence.label}</p>
                <p>{panelAgent.whatsappEvidence.detail}</p>
                <p>Programación: {({active: "activa", paused: "pausada", unknown: "desconocida"} as const)[panelAgent.whatsappEvidence.evidence?.scheduler ?? "unknown"]}; no acredita lectura.</p>
                <p>Sesión: {({connected: "conectada", disconnected: "desconectada", unknown: "desconocida"} as const)[panelAgent.whatsappEvidence.evidence?.session ?? "unknown"]}</p>
                <p>Responsable: {panelAgent.whatsappEvidence.evidence?.ownerId ?? "Sin verificar"}</p>
                <p>Última observación: {formatCityTime(panelAgent.whatsappEvidence.evidence?.observedAt ?? null)}</p>
                <p>Última revisión: {formatCityTime(panelAgent.whatsappEvidence.evidence?.lastReviewAt ?? null)}</p>
                <p>Último intento: {formatCityTime(panelAgent.whatsappEvidence.evidence?.lastAttemptAt ?? null)}</p>
                <p>Última lectura correcta: {formatCityTime(panelAgent.whatsappEvidence.evidence?.lastSuccessAt ?? null)}</p>
                <p>Grupos leídos en esta revisión: {panelAgent.whatsappEvidence.evidence?.groupsRead ?? "Sin verificar"} / 4 autorizados</p>
                <p>Grupos de la última lectura correcta: {panelAgent.whatsappEvidence.evidence?.lastSuccessGroupCount ?? "Sin verificar"} / 4</p>
                <p>Punto de lectura conservado: {panelAgent.whatsappEvidence.evidence ? panelAgent.whatsappEvidence.evidence.checkpointsRetained ? "Sí" : "Sin confirmar" : "Sin verificar"}</p>
                <p className="text-amber-100">Vida y academia registran resultados confirmados una sola vez. La rotación local no sustituye ni inicia al lector externo; su reemplazo operativo no está conectado.</p>
              </div>}
              {panelAgent.kongEvidence && <div className="mt-2 rounded-lg border border-lime-300/20 bg-lime-300/5 p-2 text-[11px]" data-testid={`world-kong-native-evidence-${panelAgent.kongEvidence.id}`}>
                <p className="font-semibold text-lime-100">{panelAgent.kongEvidence.label}</p>
                <p className="mt-1 text-zinc-300">{panelAgent.kongEvidence.detail}</p>
                <p className="mt-1">Tarea en curso: {panelAgent.kongEvidence.signal === "current" ? "KONG Native reporta actividad; no hay una tarea en ejecución verificada." : "No hay tarea actual verificada."}</p>
                <p>Último resultado: {formatCityTime(panelAgent.kongEvidence.lastRunAt)}</p>
                <p>Próximo turno: {formatCityTime(panelAgent.kongEvidence.nextRunAt)}</p>
                <p className="text-zinc-400">La lectura disponible no identifica entregas ni ejecuciones bajo demanda por separado.</p>
              </div>}
              {panelAgent.cityAgent && officeCityEvidenceNotice(panelAgent.cityAgent) && <p className="mt-2 text-[10px] text-amber-200" data-testid="world-city-evidence-notice">{officeCityEvidenceNotice(panelAgent.cityAgent)?.label}</p>}
              {(panelAgent.cityAgent || panelAgent.kong || !pageAgentIds.includes(panelAgent.id)) && <OfficeAgentStatusChat key={panelAgent.id} agent={panelAgent} />}
              {(panelAgent.cityAgent || panelAgent.kong) && !workspace.isPartner && <a href={`/agent-chat?agent=${encodeURIComponent(panelAgent.id)}`} className="mt-2 inline-block rounded-full border border-cyan-200/30 px-3 py-1 text-[11px] font-semibold text-cyan-100 hover:bg-cyan-300/10" data-testid="world-agent-full-chat">Chat completo</a>}
              {panelCareer && panelCareer.memory.length > 0 && (
                <div className="mt-2 rounded-lg border border-violet-300/15 bg-violet-500/5 p-2 text-[10px] leading-4 text-zinc-300" data-testid="world-brain">
                  <p className="mb-1 text-[9px] uppercase tracking-[0.18em] text-violet-200">Cerebro · lo que recuerda</p>
                  {panelCareer.memory.slice(0, 5).map((entry, index) => <p key={`${index}-${entry.at}`} className="truncate" title={entry.text}>· {entry.text}</p>)}
                </div>
              )}
              {panelOrders.length > 0 && (
                <div className="mt-2 text-[10px] text-zinc-300">
                  <p className="mb-1 text-[9px] uppercase tracking-[0.18em] text-amber-200">Ordenes del CEO</p>
                  {panelOrders.map((order) => <p key={order.id} className="truncate">· {order.text} <span className="text-zinc-500">({order.doneAt ? "hecha" : order.assignees.find((a) => a.agentId === panelAgent.id)?.status})</span></p>)}
                </div>
              )}
              {!panelAgent.cityAgent && (panelAgent.kong || pageAgentIds.includes(panelAgent.id) || Boolean(onOpenContact)) && <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (panelAgent.kong) onSelectKongAgent(panelAgent.name);
                    else if (pageAgentIds.includes(panelAgent.id)) onSelectAgent(panelAgent.id, panelAgent.status);
                    else onOpenContact?.({ id: panelAgent.id, name: panelAgent.name, role: panelAgent.role, department: focused?.name || "Oficina", status: panelAgent.status, description: panelAgent.description, href: panelAgent.href, color: panelAgent.color });
                  }}
                  disabled={!workspace.canInteractWith(panelAgent.id) || panelAgent.kong && workspace.isPartner || (!panelAgent.kong && !pageAgentIds.includes(panelAgent.id) && !onOpenContact)}
                  title={workspace.canInteractWith(panelAgent.id) && !(panelAgent.kong && workspace.isPartner) ? undefined : "Solo Robert"}
                  className="flex-1 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-black hover:bg-zinc-200 disabled:opacity-40"
                  data-testid="world-talk"
                >
                  {workspace.canInteractWith(panelAgent.id) && !(panelAgent.kong && workspace.isPartner) ? "Hablar con el agente" : "Solo Robert"}
                </button>
                {panelAgent.href && <a href={panelAgent.href} className="rounded-full border border-white/15 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/10">Abrir</a>}
              </div>}
            </section>
          )}

          {officeWing === "main" && focused.id === "kong" && <section className="mt-4 rounded-xl border border-amber-200/20 bg-amber-300/5 p-3 text-[11px]" data-testid="world-kong-evidence-followup">
            <p className="font-semibold text-amber-100">Evidencia pendiente para coordinar con KONG Ultimate Native</p>
            <p className="mt-1 text-zinc-300">La oficina puede consultar señales autenticadas, pero no dispone de un canal de solicitud o mensajería hacia Native.</p>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-zinc-300">
              {centralSignals.map(signal => <li key={signal.id}>
                {signal.name}: {signal.signal === "unverified" ? signal.detail : "confirmar fecha y resultado de entrega; indicar si fue bajo demanda y aportar la tarea actual si sigue ejecutándose."}
              </li>)}
            </ul>
            <p className="mt-2 text-zinc-400">No se envió ninguna solicitud ni se inició una ejecución.</p>
          </section>}

          {proposals.length > 0 && (
            <section className="mt-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-200">Esperando tu OK</p>
              {proposals.slice(0, 4).map((proposal) => (
                <a key={proposal.key} href="/" className="mt-1.5 block rounded-lg border border-amber-200/20 bg-amber-300/5 px-2 py-1.5 text-[11px] text-amber-50 hover:bg-amber-300/10" title={proposal.description}>
                  {proposal.title} <span className="text-amber-200/70">· aprobar en el Trust Center</span>
                </a>
              ))}
            </section>
          )}

          {debates.length > 0 && (
            <section className="mt-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-violet-200">Debates del consejo</p>
              {debates.slice(0, 3).map((debate) => (
                <div key={debate.key} className="mt-1.5 rounded-lg border border-violet-300/20 bg-violet-500/5 px-2 py-1.5 text-[11px]">
                  <p className="text-violet-100">{nameOf(debate.reviewer)} → {nameOf(debate.subject)}</p>
                  <p className="mt-0.5 text-zinc-300">{debate.claim}</p>
                  <p className="mt-0.5 text-zinc-500">CEO: {debate.verdict}</p>
                </div>
              ))}
            </section>
          )}
          </div>
        </aside>
      )}
    </div>
  );
}

// Agents carry Tailwind gradient classes ("from-sky-400 to-cyan-300"); the 3D figures need a hex color.
const TAILWIND_HEX: Record<string, string> = {
  sky: "#38bdf8", cyan: "#22d3ee", amber: "#fbbf24", orange: "#fb923c", emerald: "#34d399", lime: "#a3e635", blue: "#60a5fa",
  zinc: "#a1a1aa", slate: "#94a3b8", violet: "#a78bfa", fuchsia: "#e879f9", rose: "#fb7185", pink: "#f472b6", red: "#f87171",
  teal: "#2dd4bf", indigo: "#818cf8", purple: "#c084fc", stone: "#a8a29e", green: "#4ade80", yellow: "#facc15",
};
function colorFromGradient(gradient: string): string {
  const match = gradient.match(/from-([a-z]+)-/);
  return (match && TAILWIND_HEX[match[1]]) || "#94a3b8";
}
function OfficeAgentStatusChat({ agent }: { agent: PanelAgent }) {
  const [message, setMessage] = useState("");
  const [reply, setReply] = useState<{ question: string; answer: string }>();
  return <form className="mt-3 space-y-1 rounded-lg border border-cyan-200/20 p-2 text-[11px]" onSubmit={event => {
    event.preventDefault();
    const question = message.trim();
    if (!question) return;
    const city = agent.cityAgent;
    const text = question.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
    const notice = city ? officeCityEvidenceNotice(city) : undefined;
    let answer = `${agent.status.label}. ${agent.status.detail ?? ""}`.trim();
    if (city && /fuente|429|limite|l[ií]mite/.test(text) && notice?.kind === "source-limit") answer = `${notice.label}. ${city.blocker}`;
    else if (city && /cobertura|fuentes/.test(text) && notice?.kind === "coverage") answer = `${notice.label}. ${city.blocker}`;
    else if (city && /fallo|error|problema/.test(text) && notice?.kind === "failure") answer = `${notice.label}. ${city.blocker}`;
    else if (city && /proxim|turno|cuando/.test(text)) answer = city.nextWorkAt ? `Mi próximo turno registrado es ${formatCityTime(city.nextWorkAt)}.` : "KONG no muestra un próximo turno verificable.";
    else if (city && /ultim|anterior|terminaste|resultado|entrega/.test(text)) answer = city.lastWorkAt
      ? `El último resultado registrado fue ${formatCityTime(city.lastWorkAt)}. ${notice?.label || agent.status.label}.`
      : "KONG no muestra un resultado reciente verificable.";
    else if (city && /tarea|haces|haciendo|funcion/.test(text)) answer = agent.status.state === "working" && city.hasDurableEvidence
      ? `Tarea en curso verificada: ${OFFICE_KONG_CITY_TASKS[city.category]}.`
      : isOnDuty(agent.status)
        ? `Al día: ${OFFICE_KONG_CITY_TASKS[city.category]}. ${agent.status.detail ?? ""} Entre turnos no está ejecutando.`.trim()
        : `Tarea prevista del puesto: ${OFFICE_KONG_CITY_TASKS[city.category]}. KONG no confirma una ejecución actual.`;
    else if (agent.kongEvidence && /demanda/.test(text)) answer = "La lectura de KONG Native no identifica ejecuciones bajo demanda por separado.";
    else if (agent.kongEvidence && /proxim|turno|cuando/.test(text)) answer = agent.kongEvidence.nextRunAt
      ? `Próximo turno informado por KONG Native: ${formatCityTime(agent.kongEvidence.nextRunAt)}.` : "KONG Native no informa un próximo turno verificable.";
    else if (agent.kongEvidence && /ultim|anterior|resultado|entrega/.test(text)) answer = agent.kongEvidence.lastRunAt
      ? `KONG Native registra una ejecución el ${formatCityTime(agent.kongEvidence.lastRunAt)}; no confirma que sea una entrega.` : "KONG Native no muestra una última ejecución verificable.";
    else if (agent.kongEvidence && /tarea|haces|haciendo/.test(text)) answer = agent.kongEvidence.signal === "current"
      ? "KONG Native reporta actividad; no hay una tarea en ejecución verificada."
      : "No hay una tarea actual verificada para este puesto.";
    else if (!/estado|trabaj|bloque|error|problema|hola/.test(text)) answer = "Puedo responder sobre el estado registrado, el último resultado y el próximo turno. Esta consulta no inicia ni cambia trabajos.";
    setReply({ question, answer });
    setMessage("");
  }}>
    <label htmlFor="world-status-chat-input" className="block font-semibold text-cyan-100">Chat de estado</label>
    {reply && <div role="status" className="space-y-1"><p className="break-words text-slate-400">Tú · {reply.question}</p><p>{agent.role} · {reply.answer}</p></div>}
    <div className="flex gap-1">
      <input id="world-status-chat-input" value={message} onChange={event => setMessage(event.target.value)} maxLength={240} placeholder="¿Qué estás haciendo?" className="min-w-0 flex-1 rounded border border-white/20 bg-black px-2 py-1" />
      <button type="submit" disabled={!message.trim()} className="rounded bg-cyan-100 px-2 py-1 font-semibold text-slate-950 disabled:opacity-50">Preguntar</button>
    </div>
  </form>;
}

function formatCityTime(value: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "Sin registro verificable";
  return new Date(value).toLocaleString("es", { dateStyle: "medium", timeStyle: "short" });
}
