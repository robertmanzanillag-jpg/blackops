import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import { cn } from "@/lib/utils";
import type { BuildingTeamAgent } from "@/components/agents-building/agents-building";
import type { AgentCareer, CompanyState, LeaderboardRow } from "@shared/agent-company";
import { isMainCompanyUnscored } from "@shared/agent-integrations";
import { selfHealTotals } from "@shared/office-self-heal-view";
import { useWorkspaceRole } from "@/lib/workspace-role";
import {
  ROOM_LABEL_MAX, defaultOfficeLayout, loadOfficeLayout, moveOfficeAgent, officeRoomOf, renameOfficeRoom, saveOfficeLayout, saveOfficeLocations, saveOfficeOffsets, saveOfficeRooms, type OfficeLayout,
} from "@/lib/office-layout";
import {
  BATTERY_DANGER, PANEL_SECTIONS, STATUS_KIND_LABEL, buildGlobalRanking, buildPanelRows, buildReportsFeed, filterPanelRows,
  panelCounters, readPanelParams, selectReplaceable, selectReplaced, type PanelAgentInput, type PanelCompany, type PanelRow, type PanelSectionId, type PanelStatusKind,
} from "@/lib/office-central-panel";
import { useOfficeRoster, type WorldAgent } from "./use-office-roster";
import { ClippersCentralGrowth } from "./clippers-central-growth";
import { OfficeAgentStatusChat, SOURCE_NAME } from "./agents-office-world";

const KIND_STYLE: Record<PanelStatusKind, { dot: string; text: string; chip: string }> = {
  working: { dot: "bg-emerald-400 motion-safe:animate-pulse", text: "text-emerald-200", chip: "border-emerald-300/40 bg-emerald-400/10" },
  "on-duty": { dot: "bg-teal-400", text: "text-teal-200", chip: "border-teal-300/40 bg-teal-400/10" },
  blocked: { dot: "bg-rose-400", text: "text-rose-200", chip: "border-rose-300/40 bg-rose-400/10" },
  attention: { dot: "bg-amber-300", text: "text-amber-100", chip: "border-amber-300/40 bg-amber-300/10" },
  idle: { dot: "bg-zinc-500", text: "text-zinc-300", chip: "border-white/10 bg-white/[0.04]" },
  checking: { dot: "bg-sky-300", text: "text-sky-100", chip: "border-sky-300/30 bg-sky-300/10" },
};
const batteryClass = (battery: number) => (battery > 60 ? "text-emerald-300" : battery > BATTERY_DANGER ? "text-amber-200" : "text-rose-300");
const COMPANY_LABEL: Record<PanelCompany, string> = { main: "BlackOps", kong: "KONG" };
// Same chat entry as the office ("Chat completo"): the agent-chat page answers from the agent's
// recorded data (/api/agent-chat) and offers the hand-off buttons; office ids resolve there.
const agentChatHref = (id: string) => `/agent-chat?agent=${encodeURIComponent(id)}`;

function when(value: string | null | undefined): string {
  if (!value) return "—";
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "—";
  return new Date(time).toLocaleString("es", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** Owner-only central panel: every agent of every office room, with the reports, ranking and rotation. */
export function OfficeCentralPanel({ agents, kongTeam, legal }: { agents: WorldAgent[]; kongTeam: BuildingTeamAgent[]; legal: { data: unknown; isError: boolean } }) {
  const workspace = useWorkspaceRole();
  if (workspace.loading) return <PanelShell><p className="text-sm text-zinc-400" role="status">Verificando acceso…</p></PanelShell>;
  if (!workspace.isOwner) {
    return <PanelShell>
      <p role="alert" className="rounded-xl border border-amber-300/30 bg-amber-300/10 p-4 text-sm text-amber-100" data-testid="central-panel-owner-only">El panel central es solo para Robert. Tu vista sigue disponible en la oficina 3D.</p>
    </PanelShell>;
  }
  return <OwnerCentralPanel agents={agents} kongTeam={kongTeam} legal={legal} />;
}

function PanelShell({ children }: { children: ReactNode }) {
  // The page itself scrolls (document scrollbar): make it black like the panel's own lists.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("office-scrollbar");
    return () => root.classList.remove("office-scrollbar");
  }, []);
  return <div className="office-scrollbar min-h-screen bg-[#05060a] px-4 pb-16 pt-16 text-white sm:px-6" data-testid="central-panel">
    <div className="mx-auto max-w-[1400px]">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/agents-office" className="rounded-xl border border-white/15 px-3 py-2 text-xs font-semibold text-white hover:bg-white/10" data-testid="central-panel-back">← Oficina 3D</Link>
        <h1 className="text-xl font-black tracking-tight sm:text-2xl">Panel central de agentes</h1>
      </div>
      <div className="mt-4">{children}</div>
    </div>
  </div>;
}

function OwnerCentralPanel({ agents, kongTeam, legal }: { agents: WorldAgent[]; kongTeam: BuildingTeamAgent[]; legal: { data: unknown; isError: boolean } }) {
  const roster = useOfficeRoster({ agents, kongTeam, legal, kongEnabled: true });
  const { companyView, panelAgents, roleWorkToday, selfHeal, council, integrations, clock } = roster;
  const search = useSearch();
  const [, navigate] = useLocation();
  const params = useMemo(() => readPanelParams(search), [search]);
  const [section, setSection] = useState<PanelSectionId | "all">(params.section);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(params.agent);
  useEffect(() => { setSection(params.section); setSelectedId(params.agent); }, [params.section, params.agent]);

  const careers: Record<PanelCompany, Record<string, AgentCareer>> = { main: companyView.company?.careers || {}, kong: companyView.kongCompany?.careers || {} };
  const leaderboards: Record<PanelCompany, LeaderboardRow[]> = { main: companyView.leaderboard || [], kong: companyView.kongLeaderboard || [] };
  const companies: Record<PanelCompany, CompanyState | undefined> = { main: companyView.company, kong: companyView.kongCompany };
  const nameOf = (id: string) => panelAgents.get(id)?.name || id;

  const inputs = new Map<string, PanelAgentInput & { sourceName?: string }>();
  for (const [id, agent] of panelAgents) {
    inputs.set(id, {
      id, name: agent.name, role: agent.role, status: agent.status ?? { state: "checking", label: "Verificando..." },
      ...(agent.cityAgent ? { city: agent.cityAgent } : {}),
      ...(agent.kongEvidence ? { kongEvidence: agent.kongEvidence } : {}),
      ...(SOURCE_NAME[id] ? { sourceName: SOURCE_NAME[id] } : {}),
    });
  }
  const departments = [
    ...roster.main.departments.map(department => ({ department, company: "main" as const })),
    ...roster.kong.departments.map(department => ({ department, company: "kong" as const })),
  ];
  const rows = buildPanelRows({ departments, agents: inputs, careers, leaderboards, roleWork: roleWorkToday });
  const counters = panelCounters(rows);
  const live = rows.filter(row => row.kind === "working" || row.kind === "on-duty").sort((a, b) => Number(b.kind === "working") - Number(a.kind === "working") || a.name.localeCompare(b.name));
  const ranking = buildGlobalRanking(leaderboards, nameOf, 10);
  // Same exemption the council applies before rotating (server/agent-council.ts); KONG has none.
  const isExempt = (id: string, company: PanelCompany) => company === "main" && isMainCompanyUnscored(id, integrations);
  const replaceable = selectReplaceable({ careers, statuses: new Map(rows.map(row => [row.id, panelAgents.get(row.id)?.status])), isExempt, nameOf, now: clock });
  const replaced = selectReplaced({ companies, nameOf, limit: 20 });
  const events = (["main", "kong"] as const).flatMap(company => (companies[company]?.events || []).slice(0, 10).map(event => ({ company, at: event.at, text: event.text })));
  const reports = buildReportsFeed({ rows, agents: inputs, roleWork: roleWorkToday, events, limit: 40 });
  const pendingProposals = (council.view?.proposals || []).filter(proposal => ["submitted", "pending_submit", "not_submitted"].includes(proposal.status)).length;
  const needsOwner = selfHealTotals(selfHeal).needsOwner + pendingProposals;
  const filtered = filterPanelRows(rows, section, query);
  const selected = selectedId ? rows.find(row => row.id === selectedId) : undefined;
  const selectedAgent = selectedId ? panelAgents.get(selectedId) : undefined;

  // Deep link: scroll to the requested section, then to the agent's row once it exists.
  const scrolledSection = useRef(false);
  const scrolledAgent = useRef<string | null>(null);
  useEffect(() => {
    if (!scrolledSection.current && params.section !== "all") {
      scrolledSection.current = true;
      document.getElementById(`panel-section-${params.section}`)?.scrollIntoView({ block: "start" });
    }
    if (selectedId && scrolledAgent.current !== selectedId && rows.some(row => row.id === selectedId)) {
      scrolledAgent.current = selectedId;
      document.querySelector(`[data-row-id="${CSS.escape(selectedId)}"]`)?.scrollIntoView({ block: "center" });
    }
  });

  const select = (id: string) => setSelectedId(current => (current === id ? null : id));
  const openInOffice = (id: string) => navigate(`/agents-office?agent=${encodeURIComponent(id)}`);
  const lastRead = council.view ? when(new Date(clock).toISOString()) : "—";

  return <PanelShell>
    <p className="text-xs text-zinc-400">Todos los agentes por sección, igual que en la oficina. Se actualiza solo con la misma lectura de la oficina (consejo cada minuto, sondas de cada agente y KONG cada minuto). Abrir este panel no inicia trabajos. Última revisión: {lastRead}.</p>
    {council.error && <p role="status" className="mt-2 text-xs text-amber-200">Consejo sin conexión: {council.error}. Carreras, puntos y ranking pueden faltar.</p>}

    <section aria-label="Resumen" className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" data-testid="central-panel-counters">
      <Counter label="Trabajando ahora" value={counters.working} tone="text-emerald-300" testId="counter-working" />
      <Counter label="Activos · al día" value={counters.onDuty} tone="text-teal-300" testId="counter-on-duty" />
      <Counter label="Bloqueados" value={counters.blocked} tone="text-rose-300" testId="counter-blocked" />
      <Counter label="Necesitan atención" value={counters.attention} tone="text-amber-200" testId="counter-attention" />
      <Counter label="Necesitan al dueño" value={needsOwner} tone="text-fuchsia-200" testId="counter-needs-owner" hint="Auto-reparaciones que esperan tu decisión + propuestas esperando tu OK" />
      <Counter label="Agentes en total" value={counters.total} tone="text-white" testId="counter-total" />
    </section>
    <ClippersCentralGrowth />

    <div className="mt-4 grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
      <Card title={`En vivo · ${live.length}`} testId="central-panel-live">
        {live.length === 0 && <p className="text-xs text-zinc-400">Nadie con trabajo verificado vigente ahora mismo.</p>}
        <ul className="space-y-1">{live.slice(0, 14).map(row => <li key={row.id}>
          <button type="button" onClick={() => select(row.id)} className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left text-xs hover:bg-white/5">
            <span className={cn("h-2 w-2 shrink-0 rounded-full", KIND_STYLE[row.kind].dot)} />
            <span className="min-w-0 flex-1 truncate"><b>{row.name}</b> <span className="text-zinc-500">· {row.departmentName}</span></span>
            <span className={cn("shrink-0 text-[10px]", KIND_STYLE[row.kind].text)}>{row.kind === "working" ? "ahora" : "al día"}</span>
          </button>
        </li>)}</ul>
        {live.length > 14 && <p className="mt-1 text-[11px] text-zinc-500">y {live.length - 14} más en las secciones.</p>}
      </Card>

      <Card title="Ranking · quién trabaja mejor" testId="central-panel-ranking">
        <p className="text-[11px] text-zinc-400">Puntos por resultados distintos y verificados (BlackOps y KONG llevan libros separados).</p>
        {ranking.length === 0 && <p className="mt-2 text-xs text-zinc-400">Todavía no hay puntos verificados.</p>}
        <ol className="mt-2 space-y-1">{ranking.map((row, index) => <li key={`${row.company}:${row.agentId}`} className="flex items-center gap-2 rounded-lg bg-white/[0.04] px-2 py-1 text-[11px]" data-testid="central-ranking-row">
          <span className="w-5 text-center font-black text-zinc-300">{index === 0 ? "👑" : index + 1}</span>
          <button type="button" onClick={() => select(row.agentId)} className="min-w-0 flex-1 truncate text-left"><b>{row.name}</b> <span className="text-zinc-400">· {row.nickname} · {COMPANY_LABEL[row.company]}</span></button>
          <span className="font-mono text-emerald-200">{row.points}</span>
          <span className={cn("font-mono", batteryClass(row.battery))}>{row.battery}%</span>
        </li>)}</ol>
      </Card>

      <Card title={`Pueden ser reemplazados · ${replaceable.length}`} testId="central-panel-replaceable">
        <p className="text-[11px] text-zinc-400">Regla actual: con la vida en 0% (y al menos 24 h en el puesto) el CEO lo reemplaza y el nuevo entra a la academia. Cada fallo registrado resta 10%. Aquí: vida ≤ {BATTERY_DANGER}% o fallando ahora.</p>
        {replaceable.length === 0 && <p className="mt-2 text-xs text-zinc-400">Nadie en zona de reemplazo.</p>}
        <ul className="mt-2 space-y-1">{replaceable.slice(0, 12).map(row => <li key={`${row.company}:${row.agentId}`} className="rounded-lg border border-rose-300/15 bg-rose-500/5 px-2 py-1 text-[11px]" data-testid="central-replaceable-row">
          <button type="button" onClick={() => select(row.agentId)} className="w-full text-left">
            <span className="flex items-center justify-between gap-2"><b className="truncate">{row.name}</b><span className={cn("font-mono", batteryClass(row.battery))}>{row.battery}%</span></span>
            <span className="text-zinc-400">{row.nickname} · gen {row.generation} · {COMPANY_LABEL[row.company]} · {row.protectedUntil ? `protegido hasta ${when(row.protectedUntil)}` : row.battery === 0 ? "se reemplaza en la próxima evaluación" : `${row.failuresLeft} ${row.failuresLeft === 1 ? "fallo" : "fallos"} para el reemplazo`}{row.failingNow ? " · fallando ahora" : ""}</span>
          </button>
        </li>)}</ul>
      </Card>

      <Card title={`Reemplazados · ${replaced.length}`} testId="central-panel-replaced">
        {replaced.length === 0 && <p className="text-xs text-zinc-400">Todavía no hubo reemplazos.</p>}
        <ul className="space-y-1">{replaced.slice(0, 12).map(row => <li key={`${row.company}:${row.agentId}:${row.generation}`} className="rounded-lg bg-white/[0.04] px-2 py-1 text-[11px]" data-testid="central-replaced-row">
          <p><b>{row.name}</b> <span className="text-zinc-400">· {row.nickname} (gen {row.generation}) → {row.successor ? `${row.successor.nickname} (gen ${row.successor.generation})` : "reemplazo en la academia"}</span></p>
          <p className="text-zinc-500">{when(row.replacedAt)} · {COMPANY_LABEL[row.company]}{row.reason ? ` · ${row.reason}` : ""}</p>
        </li>)}</ul>
      </Card>
    </div>

    <Card title={`Reportes · ${reports.length}`} testId="central-panel-reports" className="mt-3">
      {reports.length === 0 && <p className="text-xs text-zinc-400">Sin problemas ni reportes registrados.</p>}
      <ul className="grid gap-1 md:grid-cols-2">{reports.map(report => <li key={report.id} className={cn("rounded-lg border px-2 py-1 text-[11px]", report.severity === "problem" ? "border-rose-300/20 bg-rose-500/5" : report.severity === "warning" ? "border-amber-300/20 bg-amber-300/5" : "border-white/10 bg-white/[0.03]")} data-testid="central-report">
        <p className="flex flex-wrap items-baseline justify-between gap-x-2">
          {report.agentId ? <button type="button" onClick={() => select(report.agentId!)} className="font-semibold hover:underline">{report.name}</button> : <b>{report.name}</b>}
          <span className="text-zinc-500">{report.source} · {when(report.at)}</span>
        </p>
        <p className="mt-0.5 break-words text-zinc-300">{report.text}</p>
      </li>)}</ul>
    </Card>

    <OfficeLayoutEditor agents={agents} />

    <div className="sticky top-14 z-20 -mx-4 mt-4 border-b border-white/10 bg-[#05060a]/95 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6" data-testid="central-panel-filters">
      <div className="flex flex-wrap items-center gap-1.5">
        <SectionChip active={section === "all"} onClick={() => setSection("all")} label={`Todo · ${rows.length}`} testId="filter-all" />
        {PANEL_SECTIONS.map(item => <SectionChip key={item.id} active={section === item.id} onClick={() => setSection(item.id)} label={`${item.name} · ${rows.filter(row => row.section === item.id).length}`} testId={`filter-${item.id}`} />)}
        <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar agente, apodo, sala o problema…" aria-label="Buscar agente" maxLength={80}
          className="ml-auto min-w-0 flex-1 basis-full rounded-full border border-white/15 bg-black/50 px-3 py-1.5 text-xs text-white placeholder:text-zinc-500 focus:border-cyan-200/50 focus:outline-none sm:basis-60" data-testid="central-panel-search" />
      </div>
    </div>

    {selected && <AgentDetail row={selected} onClose={() => setSelectedId(null)} onOpenInOffice={() => openInOffice(selected.id)} chat={selectedAgent ? <OfficeAgentStatusChat key={selected.id} agent={selectedAgent} /> : null} />}
    {selectedId && !selected && <p role="status" className="mt-3 text-xs text-amber-200" data-testid="central-panel-agent-missing">El agente «{selectedId}» todavía no aparece en la lectura actual (KONG puede tardar un minuto).</p>}

    <div className="mt-3 space-y-6">
      {PANEL_SECTIONS.filter(item => section === "all" || item.id === section).map(item => {
        const sectionRows = filtered.filter(row => row.section === item.id);
        const rooms = [...new Map(sectionRows.map(row => [row.departmentId, { id: row.departmentId, name: row.departmentName, color: row.departmentColor }])).values()];
        return <section key={item.id} id={`panel-section-${item.id}`} aria-label={item.name} className="scroll-mt-24" data-testid={`central-section-${item.id}`}>
          <h2 className="text-sm font-black uppercase tracking-[0.18em] text-cyan-100">{item.name} <span className="text-zinc-500">· {panelCounters(sectionRows).active} de {sectionRows.length} activos</span></h2>
          {sectionRows.length === 0 && <p className="mt-2 text-xs text-zinc-500">{item.id === "kong-cities" ? "Sin ciudades con evidencia vigente de KONG." : query ? "Ningún agente coincide con la búsqueda." : "Sin agentes en esta sección."}</p>}
          {rooms.map(room => {
            const roomRows = sectionRows.filter(row => row.departmentId === room.id);
            // 25 cities x 7 desks: city rooms start folded unless something there needs a look.
            const open = item.id !== "kong-cities" || section === "kong-cities" || Boolean(query.trim()) || roomRows.some(row => row.id === selectedId || row.kind !== "idle" && row.kind !== "checking");
            return <RoomTable key={room.id} room={room} rows={roomRows} selectedId={selectedId} onSelect={select} defaultOpen={open} />;
          })}
        </section>;
      })}
    </div>
  </PanelShell>;
}

/**
 * Owner's office editor (moved here from the removed classic view): rename the office rooms, seat
 * each BlackOps agent in a room and reset to the defaults. Same per-owner localStorage as before, so
 * earlier customizations keep working; the 3D office shows them in the agent card (Área, room chips).
 */
function OfficeLayoutEditor({ agents }: { agents: WorldAgent[] }) {
  const queryClient = useQueryClient();
  const ownerId = queryClient.getQueryData<{ user?: { id: string } }>(["auth-me"])?.user?.id;
  const [layout, setLayout] = useState<OfficeLayout | null>(() => (ownerId ? loadOfficeLayout(ownerId) : null));
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  if (!ownerId || !layout) return <p role="alert" className="mt-3 text-xs text-amber-200">No se pudo verificar el propietario de la sesión; la edición de la oficina no está disponible.</p>;

  const commitRoom = (roomId: string) => {
    const draft = drafts[roomId];
    if (draft === undefined) return;
    const rooms = renameOfficeRoom(layout.rooms, roomId, draft);
    setLayout({ ...layout, rooms });
    saveOfficeRooms(ownerId, rooms);
    setDrafts(current => { const next = { ...current }; delete next[roomId]; return next; });
    setNotice(`Sala guardada: ${rooms.find(room => room.id === roomId)?.label}.`);
  };
  const seat = (agentId: string, roomId: string) => {
    const next = moveOfficeAgent(layout, agentId, roomId);
    setLayout(next);
    saveOfficeLocations(ownerId, next.locations);
    saveOfficeOffsets(ownerId, next.offsets);
    setNotice(`${agents.find(agent => agent.id === agentId)?.name ?? agentId} ahora está en ${officeRoomOf(next, agentId)?.label}.`);
  };
  const reset = () => {
    if (!window.confirm("¿Volver a los nombres de sala y ubicaciones originales? Se pierden tus cambios de la oficina.")) return;
    const next = defaultOfficeLayout();
    setLayout(next);
    setDrafts({});
    saveOfficeLayout(ownerId, next);
    setNotice("Oficina restablecida a los valores originales.");
  };

  return <details className="mt-3 rounded-2xl border border-cyan-200/20 bg-[#070b14] p-3" data-testid="central-panel-office-editor">
    <summary className="cursor-pointer text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-100">Editar oficina · salas y ubicación de agentes</summary>
    <p className="mt-2 text-[11px] text-zinc-400">Lo mismo que editaba la vista clásica: nombres de las salas, en qué sala se sienta cada agente de BlackOps y volver a lo original. Se guarda en este navegador (como antes) y la oficina 3D lo muestra en la ficha del agente («Área» y salas). No cambia los departamentos del mapa 3D ni los datos del agente en el servidor.</p>
    {notice && <p role="status" className="mt-2 text-xs text-emerald-200" data-testid="office-editor-notice">{notice}</p>}
    <div className="mt-3 grid gap-3 lg:grid-cols-2">
      <section aria-label="Salas" className="min-w-0">
        <h3 className="text-[11px] font-bold uppercase tracking-wide text-zinc-300">Salas · {layout.rooms.length}</h3>
        <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">{layout.rooms.map(room => <li key={room.id}>
          <label className="block text-[10px] text-zinc-500" htmlFor={`office-room-${room.id}`}>{room.id}</label>
          <input id={`office-room-${room.id}`} value={drafts[room.id] ?? room.label} maxLength={ROOM_LABEL_MAX}
            onChange={event => setDrafts(current => ({ ...current, [room.id]: event.target.value }))}
            onBlur={() => commitRoom(room.id)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); commitRoom(room.id); } }}
            className="w-full rounded-lg border border-white/15 bg-black/50 px-2 py-1 text-xs text-white focus:border-cyan-200/50 focus:outline-none" data-testid={`office-room-input-${room.id}`} />
        </li>)}</ul>
      </section>
      <section aria-label="Ubicación de agentes" className="min-w-0">
        <h3 className="text-[11px] font-bold uppercase tracking-wide text-zinc-300">Ubicación de agentes · {agents.length}</h3>
        <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">{agents.map(agent => <li key={agent.id} className="flex items-center gap-2 text-xs">
          <label className="min-w-0 flex-1 truncate" htmlFor={`office-seat-${agent.id}`}>{agent.name}</label>
          <select id={`office-seat-${agent.id}`} value={officeRoomOf(layout, agent.id)?.id ?? ""} onChange={event => seat(agent.id, event.target.value)}
            className="w-40 shrink-0 rounded-lg border border-white/15 bg-black px-2 py-1 text-xs text-white" data-testid={`office-seat-${agent.id}`}>
            {!officeRoomOf(layout, agent.id) && <option value="">Sin sala</option>}
            {layout.rooms.map(room => <option key={room.id} value={room.id}>{room.label}</option>)}
          </select>
        </li>)}</ul>
      </section>
    </div>
    <button type="button" onClick={reset} className="mt-3 rounded-full border border-rose-300/40 px-3 py-1.5 text-xs text-rose-100 hover:bg-rose-500/10" data-testid="office-editor-reset">Restablecer oficina</button>
  </details>;
}

function Counter({ label, value, tone, testId, hint }: { label: string; value: number; tone: string; testId: string; hint?: string }) {
  return <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3" title={hint} data-testid={testId}>
    <p className={cn("text-2xl font-black", tone)}>{value}</p>
    <p className="text-[11px] text-zinc-400">{label}</p>
  </div>;
}

function Card({ title, children, testId, className }: { title: string; children: ReactNode; testId: string; className?: string }) {
  return <section aria-label={title} className={cn("min-w-0 rounded-2xl border border-white/10 bg-[#070b14] p-3", className)} data-testid={testId}>
    <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-300">{title}</h2>
    <div className="max-h-[340px] overflow-y-auto pr-1">{children}</div>
  </section>;
}

function SectionChip({ active, onClick, label, testId }: { active: boolean; onClick: () => void; label: string; testId: string }) {
  return <button type="button" onClick={onClick} aria-pressed={active} className={cn("rounded-full border px-2.5 py-1 text-[11px]", active ? "border-cyan-100 bg-cyan-100 font-bold text-slate-950" : "border-white/15 text-zinc-200 hover:bg-white/10")} data-testid={testId}>{label}</button>;
}

function StatusCell({ row }: { row: PanelRow }) {
  return <div className="min-w-0">
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold", KIND_STYLE[row.kind].chip, KIND_STYLE[row.kind].text)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", KIND_STYLE[row.kind].dot)} />{STATUS_KIND_LABEL[row.kind]}
    </span>
    <p className="mt-0.5 truncate text-[11px] text-zinc-400" title={row.statusLabel}>{row.statusLabel}</p>
    {row.reason && <p className="mt-0.5 line-clamp-2 text-[11px] text-rose-100/90" title={row.reason}>{row.reason}</p>}
  </div>;
}

function CareerCells({ row }: { row: PanelRow }) {
  if (!row.career) return <span className="text-[11px] text-zinc-500">Sin carrera</span>;
  return <span className="text-[11px]">
    <span className="font-mono text-white">{row.career.points} pts</span> · <span className={cn("font-mono", batteryClass(row.career.battery))}>{row.career.battery}%</span>
    {" · "}<span className="text-zinc-300">gen {row.career.generation}</span>
    {row.inTraining && <span className="text-sky-200"> · en academia</span>}
  </span>;
}

function RoomTable({ room, rows, selectedId, onSelect, defaultOpen }: { room: { id: string; name: string; color: string }; rows: PanelRow[]; selectedId: string | null; onSelect: (id: string) => void; defaultOpen: boolean }) {
  const counters = panelCounters(rows);
  return <details open={defaultOpen} className="group mt-3 rounded-2xl border border-white/10 bg-[#070b14]" data-testid={`central-room-${room.id}`}>
    <summary className="cursor-pointer list-none border-b border-white/10 px-3 py-2 text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: room.color }}>
      <span aria-hidden className="mr-1 inline-block text-zinc-500 transition-transform group-open:rotate-90">▸</span>{room.name} <span className="font-normal normal-case tracking-normal text-zinc-500">· {counters.active} de {rows.length} activos{counters.blocked ? ` · ${counters.blocked} bloqueados` : ""}{counters.attention ? ` · ${counters.attention} con atención` : ""}</span>
    </summary>
    {/* Phones: one card per agent. */}
    <ul className="divide-y divide-white/5 md:hidden">{rows.map(row => <li key={row.id} className="relative">
      <a href={agentChatHref(row.id)} className="absolute right-3 top-2 z-10 rounded-full border border-cyan-200/30 bg-[#070b14] px-2 py-0.5 text-[10px] text-cyan-100" aria-label={`Chat con ${row.name}`}>Chat</a>
      <button type="button" onClick={() => onSelect(row.id)} data-row-id={row.id} className={cn("w-full px-3 py-2 text-left", row.id === selectedId && "bg-cyan-300/10 ring-1 ring-inset ring-cyan-200/60")} data-testid={`central-row-${row.id}`}>
        <p className="flex items-center gap-2 pr-14 text-xs"><b className="truncate">{row.rank?.rank === 1 ? "👑 " : ""}{row.name}</b>{row.rank && <span className="shrink-0 text-[10px] text-zinc-400">#{row.rank.rank}</span>}</p>
        <p className="truncate text-[11px] text-zinc-500">{row.role}{row.career ? ` · ${row.career.nickname}` : ""}</p>
        <div className="mt-1"><StatusCell row={row} /></div>
        <p className="mt-1 text-[11px] text-zinc-400">Último: {when(row.lastWorkAt)} · Próximo: {when(row.nextWorkAt)}</p>
        <p className="mt-0.5"><CareerCells row={row} /></p>
      </button>
    </li>)}</ul>
    {/* Tablets and desktop: a table. */}
    <table className="hidden w-full table-fixed text-left text-xs md:table">
      <thead className="text-[10px] uppercase tracking-[0.14em] text-zinc-500">
        <tr><th className="w-[23%] px-3 py-1.5">Agente</th><th className="w-[27%] px-3 py-1.5">Estado</th><th className="w-[12%] px-3 py-1.5">Último trabajo</th><th className="w-[12%] px-3 py-1.5">Próximo turno</th><th className="w-[15%] px-3 py-1.5">Puntos · vida · gen</th><th className="w-[11%] px-3 py-1.5">Rango · chat</th></tr>
      </thead>
      <tbody className="divide-y divide-white/5">{rows.map(row => <tr key={row.id} onClick={() => onSelect(row.id)} data-row-id={row.id} className={cn("cursor-pointer align-top hover:bg-white/[0.03]", row.id === selectedId && "bg-cyan-300/10 outline outline-1 outline-cyan-200/60")} data-testid={`central-row-${row.id}`}>
        <td className="px-3 py-2"><button type="button" onClick={event => { event.stopPropagation(); onSelect(row.id); }} className="block max-w-full truncate text-left font-semibold hover:underline">{row.rank?.rank === 1 ? "👑 " : ""}{row.name}</button><p className="truncate text-[11px] text-zinc-500">{row.role}{row.career ? ` · ${row.career.nickname}` : ""}</p></td>
        <td className="px-3 py-2"><StatusCell row={row} /></td>
        <td className="px-3 py-2 text-[11px] text-zinc-300">{when(row.lastWorkAt)}</td>
        <td className="px-3 py-2 text-[11px] text-zinc-300">{when(row.nextWorkAt)}</td>
        <td className="px-3 py-2"><CareerCells row={row} /></td>
        <td className="px-3 py-2 text-[11px] text-zinc-300">{row.rank ? <span title={row.rank.title}>#{row.rank.rank}</span> : "—"}<a href={agentChatHref(row.id)} onClick={event => event.stopPropagation()} className="ml-2 rounded-full border border-cyan-200/30 px-2 py-0.5 text-[10px] text-cyan-100 hover:bg-cyan-300/10" aria-label={`Chat con ${row.name}`} data-testid={`central-row-chat-${row.id}`}>Chat</a></td>
      </tr>)}</tbody>
    </table>
  </details>;
}

function AgentDetail({ row, onClose, onOpenInOffice, chat }: { row: PanelRow; onClose: () => void; onOpenInOffice: () => void; chat: ReactNode }) {
  return <section aria-label={`Detalle de ${row.name}`} className="mt-3 rounded-2xl border border-cyan-200/30 bg-[#06111b] p-3 text-xs" data-testid="central-panel-agent">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="text-sm font-bold">{row.name}{row.career ? <span className="font-normal text-zinc-400"> · {row.career.nickname} (gen {row.career.generation})</span> : null}</p>
        <p className="text-[11px] text-zinc-400">{row.role} · {row.departmentName} · {COMPANY_LABEL[row.company]}{row.rank ? ` · #${row.rank.rank} · ${row.rank.title}` : ""}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <a href={agentChatHref(row.id)} className="rounded-full bg-white px-3 py-1.5 text-[11px] font-bold text-black hover:bg-zinc-200" data-testid="central-panel-open-chat">Chat completo</a>
        <button type="button" onClick={onOpenInOffice} className="rounded-full border border-cyan-200/40 px-3 py-1.5 text-[11px] font-semibold text-cyan-100 hover:bg-cyan-300/10" data-testid="central-panel-open-office">Ver en la oficina 3D</button>
        <button type="button" onClick={onClose} className="rounded-full border border-white/20 px-3 py-1.5 text-[11px]" aria-label="Cerrar detalle">Cerrar</button>
      </div>
    </div>
    <div className="mt-2 grid gap-2 sm:grid-cols-2">
      <div className="rounded-lg bg-black/40 p-2"><StatusCell row={row} /><p className="mt-1 text-[11px] text-zinc-400">Último trabajo: {when(row.lastWorkAt)} · Próximo turno: {when(row.nextWorkAt)}</p><p className="mt-1"><CareerCells row={row} /></p>{row.rank && <p className="mt-1 text-[11px] text-zinc-400">Confiable {row.rank.reliability}%</p>}{row.career?.firedCount ? <p className="mt-1 text-[11px] text-zinc-400">Rotado {row.career.firedCount} {row.career.firedCount === 1 ? "vez" : "veces"}.</p> : null}</div>
      <div className="min-w-0">{chat}</div>
    </div>
  </section>;
}
