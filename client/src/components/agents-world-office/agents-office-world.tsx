import { useEffect, useRef, useState, type HTMLAttributes, type ReactNode, type RefObject } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { runProbe, type AgentLiveState, type AgentLiveStatus } from "@/lib/agent-live-status";
import { AgentsBuilding, type BuildingTeamAgent } from "@/components/agents-building/agents-building";
import { SPECIALIST_PREFIX, personalityFor, type AgentCareer, type CompanyOrder } from "@shared/agent-company";
import { OFFICE_KONG_CITY_TASKS, scoreOfficeKongSnapshot } from "@shared/office-kong-supervisor";
import { BLACKROOM_TEAM } from "@shared/blackroom-team";
import { INTEGRATION_LABEL, integrationFor } from "@shared/agent-integrations";
import { officeCityEvidenceNotice } from "@/lib/office-kong-central-agents";
import { activeSummary, countActive, isActiveStatus, isOnDuty } from "@shared/office-on-duty";
import { createOfficeScene, type SceneData, type SceneDepartment } from "./office-scene";
import { countRoleWorkCompleted } from "@shared/office-role-work-activity";
import { selfHealTotals } from "@shared/office-self-heal-view";
import { creditPacerLine } from "@shared/credit-pacer-view";
import { FACTORY_AGENTS } from "@shared/factory-office-agents";
import { useWorkspaceRole } from "@/lib/workspace-role";
import { KONG_ORDER_MAX_TEXT, isKongOrderAgent } from "@shared/agent-chat-routing";
import { officeDeepLinkStep } from "@/lib/office-central-panel";
import { PartnerInvitePanel } from "@/components/workspace/partner-invite-panel";
import { BlackRoomAcademyPanel } from "./blackroom-academy-panel";
import { BlackRoomCeoChatPanel } from "@/components/blackroom-ceo-chat/blackroom-ceo-chat-panel";
import { COUNCIL_AGENTS, useOfficeRoster, type OfficeDepartment, type PanelAgent, type WorldAgent } from "./use-office-roster";
import { useDraggablePanel } from "./use-draggable-panel";

export type { WorldAgent } from "./use-office-roster";

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

export const SOURCE_NAME: Record<string, string> = {
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

export type WorldContact = { id: string; name: string; role: string; department: string; status: AgentLiveStatus; description: string; href?: string; color: string };

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
  initialAgentId,
}: {
  agents: WorldAgent[];
  kongTeam: BuildingTeamAgent[];
  legal: { data: unknown; isError: boolean };
  selectedAgentId?: string;
  onSelectAgent: (agentId: string, status: AgentLiveStatus) => void;
  onSelectKongAgent: (name: string) => void;
  onOpenKongOffice: () => void;
  kongWingRequest?: number;
  // Deep link from the central panel (/agents-office?agent=<id>): opens that agent's card and chat.
  initialAgentId?: string;
  // Opens the same local chat for agents that are not in the classic list (cities, new agents, trainees).
  onOpenContact?: (contact: WorldContact) => void;
}) {
  const [officeWing, setOfficeWing] = useState<"main" | "kong">("main");
  const roster = useOfficeRoster({ agents, kongTeam, legal, kongEnabled: officeWing === "kong" });
  const { pageAgentIds, council, companyView, integrations, panelAgents, roleWorkToday, selfHeal, clock, cityDirectory, citySnapshot, cityEvidence, cityRooms, centralSignals, centralKongTeam, kongRingAssignment, canClassifyKongCities } = roster;
  const company = officeWing === "kong" ? companyView.kongCompany : companyView.company;
  const careers: Record<string, AgentCareer> = company?.careers || {};
  const leaderboardRows = (officeWing === "kong" ? companyView.kongLeaderboard : companyView.leaderboard) || [];
  const personalities = (officeWing === "kong" ? companyView.kongPersonalities : companyView.personalities) || {};
  const deputyId = leaderboardRows[0]?.points ? leaderboardRows[0].agentId : null;
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
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
  const refreshKongRings = () => {
    roster.refreshKongRings();
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

  // Phones and tablets: opening a room or an overlay folds the controls so the two panels never overlap.
  // They unfold again when the room or overlay closes, unless the owner folded them by hand.
  const autoMinimized = useRef(false);
  useEffect(() => {
    const open = Boolean(focusedDepartment) || overlay !== "none";
    if (open && typeof window !== "undefined" && window.innerWidth < 1024) {
      setMainPanelMinimized(current => { if (!current) autoMinimized.current = true; return true; });
    } else if (!open && autoMinimized.current) {
      autoMinimized.current = false;
      setMainPanelMinimized(false);
    }
  }, [focusedDepartment, overlay]);
  // Deep link: wait until the agent's room exists (KONG rooms need the owner-only snapshot), then focus it once.
  // The wing switches to KONG at most once, and the link gives up once the council and the city
  // directory/snapshot have settled (loaded, failed or disabled) or the user left that wing.
  const deepLinkDone = useRef(false);
  const deepLinkWingSwitched = useRef(false);
  const querySettled = (query: { isFetched: boolean; isError: boolean; fetchStatus: string }) => query.isFetched || query.isError || query.fetchStatus === "idle";
  useEffect(() => {
    if (!initialAgentId || deepLinkDone.current) return;
    const inMain = roster.main.departments.find(department => department.agentIds.includes(initialAgentId));
    const inKong = roster.kong.departments.find(department => department.agentIds.includes(initialAgentId));
    const councilSettled = Boolean(council.view || council.error);
    const step = officeDeepLinkStep({
      agentId: initialAgentId, mainRoomId: inMain?.id, kongRoomId: inKong?.id, wing: officeWing, wingSwitched: deepLinkWingSwitched.current,
      settled: councilSettled && (inMain ? true : querySettled(cityDirectory) && querySettled(citySnapshot)),
    });
    if (step.action === "wait") return;
    if (step.action === "switch-wing") { deepLinkWingSwitched.current = true; setOfficeWing("kong"); return; }
    deepLinkDone.current = true;
    if (step.action === "give-up") return;
    setFocusedDepartment(step.roomId); sceneRef.current?.focusDepartment(step.roomId);
    setPanelAgentId(initialAgentId); setCityDetailsOpen(true);
  });

  const trainees = (officeWing === "kong" ? roster.kong : roster.main).trainees;
  const departments: OfficeDepartment[] = officeWing === "main" ? roster.main.departments : roster.kong.departments;
  const kongCollaboration = citySnapshot.isError || !cityEvidence || !scoreOfficeKongSnapshot(cityEvidence, clock).verified ? undefined : citySnapshot.data?.collaboration;

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
      <div className="office-scrollbar absolute inset-0 overflow-y-auto px-4 pb-10 pt-24">
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
  const creditBudgetLine = creditPacerLine((council.view as unknown as { creditPacer?: unknown } | null)?.creditPacer);
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

      {/* Top-left by default (never over the bottom "Fábrica de software" button or a bottom-right chat); draggable by its header. */}
      <FloatingPanel panelId="controls" className={cn(FLOAT_LEFT, "z-10 overflow-y-auto rounded-2xl border border-white/10 bg-[#04060b]/95 p-3 text-white shadow-2xl", !mainPanelMinimized && "w-[min(365px,calc(100vw-1.5rem))]")} aria-label="Controles de oficina" data-testid="world-controls-panel">{handle => <>
        <div className="flex items-center justify-between gap-3" {...handle} data-testid="world-controls-drag">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.2em] text-cyan-100" data-testid="world-company-label"><span aria-hidden className="mr-1 text-zinc-500">⠿</span>{officeWing === "kong" ? "KONG · la empresa" : "BlackOps · la empresa"}</h2>
          {/* Folded controls keep the way back to the whole office. */}
          {mainPanelMinimized && focusedDepartment && <button type="button" onClick={() => focusRoom(null)} className="ml-auto rounded-full border border-white/20 px-2 py-1 text-xs" data-testid="world-overview">Vista general</button>}
          <button type="button" aria-expanded={!mainPanelMinimized} aria-controls="world-office-panel-content" onClick={() => { autoMinimized.current = false; setMainPanelMinimized(v => !v); }} className="rounded-full border border-white/20 px-2 py-1 text-xs" data-testid="world-main-panel-toggle">{mainPanelMinimized ? "Abrir" : "Minimizar"}</button>
        </div>
        {workspace.isOwner && <button type="button" onClick={() => navigate(CENTRAL_PANEL_PATH)} className="mt-2 w-full rounded-full bg-cyan-300 px-3 py-2 text-xs font-black text-slate-950 hover:bg-cyan-200" data-testid="world-open-central-panel">Panel completo · todos los agentes</button>}
        <div id="world-office-panel-content" hidden={mainPanelMinimized}>
          <p className="mt-2 text-lg font-black" data-testid="world-active-count" title="Activos = ejecutando ahora (reserva viva) + al día (último trabajo verificado dentro de su turno, sin fallos).">{companyActivity.active} de {companyActivity.total} activos · <span data-testid="world-working-count">{companyActivity.working} ejecutando ahora</span></p>
          {officeWing === "main" && <p className="mt-1 text-sm font-semibold text-emerald-200" data-testid="world-verified-today-count">{verifiedTodayCount} de {companyIds.length} con trabajo verificado hoy (ejecutor de la oficina)</p>}
          {officeWing === "main" && creditBudgetLine && <p className="mt-1 text-xs text-amber-100" data-testid="world-credit-pacer">{creditBudgetLine}</p>}
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
            {!mainPanelMinimized && <button type="button" onClick={() => focusRoom(null)} className="rounded-full border border-white/20 px-3 py-2 text-xs" data-testid="world-overview">Vista general</button>}
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
      </>}</FloatingPanel>
      {officeWing === "kong" && overlay === "kong-talk" && <FloatingPanel panelId="kong-talk" aria-label="Colaboración KONG" className={cn(FLOAT_RIGHT, "z-30 max-h-[min(48%,var(--float-avail,100%))] w-[min(420px,calc(100vw-1.5rem))] overflow-y-auto rounded-2xl border border-cyan-200/25 bg-[#07131b]/95 p-4 text-xs text-white")} data-testid="world-kong-collaboration-panel">{handle => <>
        <div className="flex justify-between gap-2" {...handle}><h2 className="font-bold text-cyan-100"><span aria-hidden className="mr-1 text-zinc-500">⠿</span>Colaboración KONG</h2><button type="button" onClick={() => setOverlay("none")} aria-label="Cerrar colaboración">Cerrar</button></div>
        <p className="mt-2 text-zinc-300">Revisión automática de evidencia entre supervisión y operaciones. Son propuestas pendientes de revisión; no conversaciones de IA ni acciones ya ejecutadas.</p>
        {!kongCollaboration?.exchanges.length && <p className="mt-3">Sin intercambios con evidencia vigente.</p>}
        {kongCollaboration?.exchanges.map(exchange => <article key={exchange.id} className="mt-3 rounded-lg border border-white/10 p-2">
          <h3 className="font-bold">{cityRooms.find(room => room.city.id === exchange.cityId)?.name ?? exchange.cityId} · {exchange.category}</h3>
          {exchange.comments.map(comment => <p key={comment.author} className="mt-1"><b>{comment.author === "supervisor" ? "Supervisor" : "Operaciones"}:</b> {comment.text}</p>)}
          <p className="mt-2 text-amber-100">Para el CEO · {exchange.proposal.text}</p>
        </article>)}
      </>}</FloatingPanel>}

      {officeWing === "kong" && overlay === "city-director" && <FloatingPanel panelId="city-director" aria-label="Director de ciudades de KONG" data-testid="world-city-director-panel" className={cn(FLOAT_RIGHT, "z-30 max-h-[min(45%,var(--float-avail,100%))] w-[min(410px,calc(100vw-1.5rem))] space-y-2 overflow-y-auto rounded-2xl border border-amber-200/25 bg-[#120d04]/95 p-3 text-xs text-white shadow-2xl [color-scheme:dark]")}>{handle => <>
        <div className="flex items-center justify-between gap-2" {...handle}>
          <h2 className="text-sm font-bold text-amber-100"><span aria-hidden className="mr-1 text-zinc-500">⠿</span>Director de ciudades · KONG</h2>
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
      </>}</FloatingPanel>}
      {overlay === "ranking" && (
        <FloatingPanel panelId="ranking" className={cn(FLOAT_RIGHT, "z-30 max-h-[min(45%,var(--float-avail,100%))] w-[min(380px,calc(100vw-1.5rem))] overflow-y-auto rounded-2xl border border-emerald-200/20 bg-[#06100d]/95 p-4 text-white shadow-2xl [color-scheme:dark]")} data-testid="world-ranking-panel">{handle => <>
          <div className="flex items-center justify-between" {...handle}>
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-emerald-200"><span aria-hidden className="mr-1 text-zinc-500">⠿</span>Tabla de posiciones</p>
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
          {workspace.isOwner && <button type="button" onClick={() => navigate(CENTRAL_PANEL_PATH)} className="mt-3 w-full rounded-full border border-emerald-200/40 px-3 py-1.5 text-[11px] text-emerald-100 hover:bg-emerald-300/10" data-testid="world-ranking-open-panel">Ver ranking completo en el panel</button>}
        </>}</FloatingPanel>
      )}

      {/* These overlays position themselves; the wrappers only add the black scrollbars and keep the
          Black Room chat (fixed height) above the bottom band with the "Fábrica de software" button. */}
      {overlay === "partners" && workspace.isOwner && <div className="office-scrollbar contents"><PartnerInvitePanel onClose={() => setOverlay("none")} /></div>}
      {overlay === "blackroom-academy" && officeWing === "main" && <div className="office-scrollbar contents"><BlackRoomAcademyPanel company={companyView.company} onClose={() => setOverlay("none")} /></div>}
      {overlay === "blackroom-ceo-chat" && canChatBlackRoomCeo && <div className="office-scrollbar contents [&>section]:max-h-[calc(100%-220px-4.5rem)] sm:[&>section]:max-h-[calc(100%-9rem-4.5rem)] lg:[&>section]:max-h-[calc(100%-6rem-4.5rem)]" data-testid="world-blackroom-ceo-chat-frame"><BlackRoomCeoChatPanel onClose={() => setOverlay("none")} onShowTasks={officeWing === "main" ? () => setOverlay("ceo") : undefined} /></div>}

      {overlay === "ceo" && (
        <FloatingPanel panelId="ceo" className={cn(FLOAT_RIGHT, "z-30 flex max-h-[min(45%,var(--float-avail,100%))] w-[min(420px,calc(100vw-1.5rem))] flex-col rounded-2xl border border-amber-200/25 bg-[#120d04]/95 p-4 text-white shadow-2xl [color-scheme:dark]")} data-testid="world-ceo-panel">{handle => <>
          <div className="flex items-center justify-between" {...handle}>
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-amber-200"><span aria-hidden className="mr-1 text-zinc-500">⠿</span>{officeWing === "main" && canChatBlackRoomCeo ? "Tareas de la oficina" : "Canal directo con el CEO"}</p>
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
        </>}</FloatingPanel>
      )}

      {!focused && overlay === "none" && (
        <p className="pointer-events-none absolute bottom-4 left-1/2 z-10 hidden -translate-x-1/2 rounded-full border border-white/10 bg-black/60 px-4 py-2 text-xs text-zinc-300 sm:block">
          {failed ? "Vista sin 3D: elige un departamento para ver sus agentes." : officeWing === "kong" ? "Todos los agentes de KONG · toca un departamento para entrar" : "Arrastra para girar · rueda para acercar · toca un departamento para entrar"}
        </p>
      )}

      {focused && (
        <FloatingPanel as="aside" panelId="department" className={cn(FLOAT_RIGHT, "z-20 flex max-h-[min(42%,var(--float-avail,100%))] w-[min(390px,calc(100vw-1.5rem))] flex-col overflow-y-auto rounded-2xl border border-white/10 bg-[#070b14]/95 p-3 text-white shadow-2xl sm:max-h-[min(65%,var(--float-avail,100%))]")} data-testid="world-panel">{handle => <>
          <div className="flex shrink-0 items-start justify-between gap-2" {...handle}>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.24em]" style={{ color: focused.color }}><span aria-hidden className="mr-1 text-zinc-500">⠿</span>{focused.name}</p>
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
        </>}</FloatingPanel>
      )}
    </div>
  );
}

const CENTRAL_PANEL_PATH = "/agents-office/panel";
// Floating panels start in the top band, under the toolbar, and their height is capped by
// --float-avail (set by useDraggablePanel) so they never reach the bottom band holding the
// "Fábrica de software" button and a bottom-right chat launcher, even when dragged or when their
// content grows: they scroll instead.
const FLOAT_LEFT = "absolute left-3 top-[220px] sm:top-36 lg:top-24 max-h-[var(--float-avail,calc(100%-220px-4.5rem))] sm:max-h-[var(--float-avail,calc(100%-9rem-4.5rem))] lg:max-h-[var(--float-avail,calc(100%-6rem-4.5rem))]";
// Phones and tablets: just under the folded controls pill (top 220 px / 144 px). lg:top-28 keeps the right column
// clear of the "Trabajo real" toggle (top-16, z-110).
const FLOAT_RIGHT = "absolute right-3 top-[272px] sm:top-[196px] lg:top-28";

type DragHandleProps = ReturnType<typeof useDraggablePanel>["handleProps"] & { onDoubleClick: () => void };
function FloatingPanel({ panelId, as = "section", className, children, ...rest }: { panelId: string; as?: "section" | "aside"; className: string; children: (handle: DragHandleProps) => ReactNode } & Omit<HTMLAttributes<HTMLElement>, "children" | "className">) {
  const drag = useDraggablePanel(panelId);
  const Tag = as;
  return (
    <Tag ref={drag.ref as RefObject<HTMLElement>} style={drag.style} className={cn("office-scrollbar", className)} data-moved={drag.moved ? "true" : undefined} {...rest}>
      {children({ ...drag.handleProps, title: "Arrastra para mover · doble clic para volver a su lugar", onDoubleClick: drag.reset })}
    </Tag>
  );
}

// KONG central desks and city desks take Robert's orders through the agent chat (server → KONG office-orders).
export function OfficeAgentStatusChat({ agent }: { agent: PanelAgent }) {
  const workspace = useWorkspaceRole();
  const [message, setMessage] = useState("");
  const [reply, setReply] = useState<{ question: string; answer: string }>();
  const [sending, setSending] = useState(false);
  const threadRef = useRef<string | undefined>(undefined);
  const pendingRef = useRef<{ text: string; requestId: string } | undefined>(undefined);
  // Anything the status rules below do not cover goes to the agent chat, which answers from the
  // agent's record or, for an order, sends it to KONG and replies with the KONG task number.
  const askAgentChat = async (question: string) => {
    setSending(true);
    setReply({ question, answer: "Enviando…" });
    try {
      // A retry of the same unanswered text reuses its requestId, so KONG gets the same idempotency key.
      const requestId = pendingRef.current?.text === question ? pendingRef.current.requestId : `office-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      pendingRef.current = { text: question, requestId };
      const res = await fetch(`/api/agent-chat/${encodeURIComponent(agent.id)}/messages`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: question, requestId, ...(threadRef.current ? { threadId: threadRef.current } : {}) }),
      });
      const body = await res.json().catch(() => null) as { error?: string; thread?: { id: string }; messages?: Array<{ role: string; text: string }> } | null;
      if (!res.ok) throw new Error(body?.error || "No se pudo hablar con el agente.");
      pendingRef.current = undefined;
      if (body?.thread?.id) threadRef.current = body.thread.id;
      const answer = [...(body?.messages || [])].reverse().find(item => item.role === "agent" || item.role === "handoff")?.text;
      setReply({ question, answer: (answer || "Sin respuesta registrada.").replace(/\*\*/g, "").replace(/`/g, "") });
    } catch (error) {
      setReply({ question, answer: error instanceof Error ? error.message : "No se pudo hablar con el agente." });
    } finally { setSending(false); }
  };
  return <form className="mt-3 space-y-1 rounded-lg border border-cyan-200/20 p-2 text-[11px]" onSubmit={event => {
    event.preventDefault();
    const question = message.trim();
    if (!question || sending) return;
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
    else if (!/estado|trabaj|bloque|error|problema|hola/.test(text)) {
      if (workspace.isOwner && isKongOrderAgent(agent.id)) { setMessage(""); void askAgentChat(question); return; }
      answer = "Puedo responder sobre el estado registrado, el último resultado y el próximo turno. Esta consulta no inicia ni cambia trabajos.";
    }
    setReply({ question, answer });
    setMessage("");
  }}>
    <label htmlFor="world-status-chat-input" className="block font-semibold text-cyan-100">Chat de estado</label>
    {reply && <div role="status" className="space-y-1"><p className="break-words text-slate-400">Tú · {reply.question}</p><p className="whitespace-pre-line break-words">{agent.role} · {reply.answer}</p>
      {threadRef.current && <a href={`/agent-chat?agent=${encodeURIComponent(agent.id)}`} className="text-cyan-200 underline" data-testid="world-status-chat-open-thread">Ver la conversación y el estado de la tarea</a>}</div>}
    <div className="flex gap-1">
      <input id="world-status-chat-input" value={message} onChange={event => setMessage(event.target.value)} maxLength={workspace.isOwner && isKongOrderAgent(agent.id) ? KONG_ORDER_MAX_TEXT : 240} placeholder={workspace.isOwner && isKongOrderAgent(agent.id) ? "Pregunta o dale una orden…" : "¿Qué estás haciendo?"} className="min-w-0 flex-1 rounded border border-white/20 bg-black px-2 py-1" />
      <button type="submit" disabled={!message.trim() || sending} className="rounded bg-cyan-100 px-2 py-1 font-semibold text-slate-950 disabled:opacity-50">Preguntar</button>
    </div>
  </form>;
}

function formatCityTime(value: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "Sin registro verificable";
  return new Date(value).toLocaleString("es", { dateStyle: "medium", timeStyle: "short" });
}
