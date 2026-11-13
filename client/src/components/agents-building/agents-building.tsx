import { useMemo, useRef, useState } from "react";
import type { ComponentType, CSSProperties, PointerEvent, ReactNode } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import {
  agentProbes,
  runProbe,
  summarizeProbe,
  presentProbeStatus,
  type AgentLiveState,
  type AgentLiveStatus,
  type ProbeResult,
} from "@/lib/agent-live-status";
import type { CouncilDebate, CouncilProposal, CouncilState } from "@shared/agent-council";

export type BuildingAgent = {
  id: string;
  name: string;
  role: string;
  color: string;
  icon: ComponentType<{ className?: string }>;
};

export type BuildingTeamAgent = {
  name: string;
  job: string;
};

type Floor = {
  id: string;
  level: string;
  name: string;
  agentIds: string[];
};

// Top floor first, like reading a building from the roof down.
export const buildingFloors: Floor[] = [
  { id: "direccion", level: "6", name: "Direccion", agentIds: ["ceo", "assistant", "control"] },
  { id: "negocios", level: "5", name: "Negocios", agentIds: ["revenue", "dropshipping", "portfolio"] },
  { id: "marketing", level: "4", name: "Marketing y contenido", agentIds: ["marketing-cmo", "clippers", "radio"] },
  { id: "ingenieria", level: "3", name: "Ingenieria", agentIds: ["code", "github", "claude-reviewer", "app-qa"] },
  { id: "seguridad", level: "2", name: "Seguridad y legal", agentIds: ["cybersecurity", "legal"] },
];
const KONG_LEVEL = "1";
export const OPERATIONS_AGENT_IDS = ["automations"];

const stateStyle: Record<AgentLiveState, { dot: string; chip: string; text: string; screen: string; line: string }> = {
  available: {dot:"bg-slate-400",chip:"border-slate-300/20",text:"text-slate-200",screen:"border-slate-300/20",line:"text-slate-200"},
  working: { dot: "bg-emerald-400", chip: "border-emerald-300/30 bg-emerald-400/10", text: "text-emerald-100", screen: "border-cyan-200/50 shadow-[0_0_22px_rgba(34,211,238,0.35)]", line: "text-cyan-100" },
  "needs-setup": { dot: "bg-amber-300", chip: "border-amber-300/30 bg-amber-300/10", text: "text-amber-100", screen: "border-amber-200/50 shadow-[0_0_18px_rgba(252,211,77,0.25)]", line: "text-amber-100" },
  error: { dot: "bg-rose-400", chip: "border-rose-300/40 bg-rose-400/10", text: "text-rose-100", screen: "border-rose-300/60 motion-safe:animate-[agent-alert_1.4s_ease-in-out_infinite]", line: "text-rose-100" },
  offline: { dot: "bg-zinc-500", chip: "border-white/10 bg-white/[0.04]", text: "text-zinc-300", screen: "border-white/15", line: "text-zinc-300" },
  checking: { dot: "bg-sky-300", chip: "border-sky-300/20 bg-sky-300/10", text: "text-sky-100", screen: "border-sky-300/30", line: "text-sky-100" },
};

// What each agent is visibly doing at its desk. Everyone keeps moving; the label stays honest.
const workMode: Record<AgentLiveState, { body: string; hands: string; verb: string }> = {
  available: {body:"",hands:"",verb:"Disponible; sin ejecución actual verificada"},
  working: { body: "motion-safe:animate-[agent-bob_2.4s_ease-in-out_infinite]", hands: "motion-safe:animate-[agent-hands_0.35s_ease-in-out_infinite]", verb: "Trabajando" },
  "needs-setup": { body: "motion-safe:animate-[agent-scan_3.2s_ease-in-out_infinite]", hands: "motion-safe:animate-[agent-hands_0.9s_ease-in-out_infinite]", verb: "Esperando lo pendiente" },
  error: { body: "motion-safe:animate-[agent-bob_1.2s_ease-in-out_infinite]", hands: "motion-safe:animate-[agent-hands_0.22s_ease-in-out_infinite]", verb: "Investigando un error" },
  offline: { body: "motion-safe:animate-[agent-breathe_4.5s_ease-in-out_infinite]", hands: "", verb: "En espera" },
  checking: { body: "motion-safe:animate-[agent-breathe_2s_ease-in-out_infinite]", hands: "", verb: "Conectando" },
};

export type CouncilView = CouncilState & { overrides: Record<string, { label: string; detail: string }>; nextCycleInMs: number; costUsd: number; enabled?: boolean };

export function useAgentLiveStatuses(
  agentIds: string[],
  legal: { data: unknown; isError: boolean }
): Record<string, AgentLiveStatus> {
  const uniqueProbes = useMemo(() => {
    const byKey = new Map<string, (typeof agentProbes)[string]>();
    for (const id of agentIds) {
      const probe = agentProbes[id];
      if (probe && probe.kind !== "legal" && !byKey.has(probe.key)) byKey.set(probe.key, probe);
    }
    return Array.from(byKey.values());
  }, [agentIds]);

  const results = useQueries({
    queries: uniqueProbes.map((probe) => ({
      queryKey: ["agents-building-probe", probe.key],
      queryFn: () => runProbe(probe.url),
      refetchInterval: probe.intervalMs,
      staleTime: probe.intervalMs / 2,
      retry: false,
    })),
  });

  const resultByKey = new Map<string, ProbeResult | undefined>();
  uniqueProbes.forEach((probe, index) => resultByKey.set(probe.key, results[index]?.data));
  const statuses: Record<string, AgentLiveStatus> = {};
  for (const id of agentIds) {
    const probe = agentProbes[id];
    if (!probe) {
      statuses[id] = { state: "offline", label: "Sin monitoreo" };
      continue;
    }
    if (probe.kind === "legal") {
      const legalResult: ProbeResult | undefined = legal.isError
        ? { ok: false, status: 0, body: null, networkError: true }
        : legal.data === undefined
          ? undefined
          : { ok: true, status: 200, body: legal.data };
      statuses[id] = presentProbeStatus(probe,summarizeProbe(probe, legalResult));
      continue;
    }
    statuses[id] = presentProbeStatus(probe,summarizeProbe(probe, resultByKey.get(probe.key)));
  }
  return statuses;
}

export function useCouncil() {
  const query = useQuery({
    queryKey: ["agent-council-state"],
    queryFn: () => runProbe("/api/agent-council/state"),
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: false,
  });
  const result = query.data as ProbeResult | undefined;
  const view = result && result.ok && result.body && typeof result.body === "object" ? (result.body as CouncilView) : null;
  const error = !result ? null : "networkError" in result ? "Servidor sin respuesta" : !result.ok ? (result.status === 404 ? "El consejo aun no esta desplegado en el servidor" : `Error ${result.status}`) : null;
  return { view, error, loading: !result };
}

function Monitor({ status }: { status: AgentLiveStatus }) {
  const style = stateStyle[status.state];
  const lines = (status.activity && status.activity.length ? status.activity : [status.label, status.detail || workMode[status.state].verb]).filter(Boolean) as string[];
  const scroll = lines.length > 2;
  return (
    <span
      className={cn("relative block h-[52px] w-[88px] overflow-hidden rounded-md border bg-[#030712] [transform:rotateX(-6deg)] [transform-origin:bottom]", style.screen)}
      data-testid="agent-monitor"
    >
      <span className="absolute inset-x-1 top-1 flex h-1.5 items-center gap-0.5" aria-hidden="true">
        <span className="h-1 w-1 rounded-full bg-rose-400/70" />
        <span className="h-1 w-1 rounded-full bg-amber-300/70" />
        <span className="h-1 w-1 rounded-full bg-emerald-400/70" />
      </span>
      <span className="absolute inset-x-1 bottom-1 top-3 overflow-hidden">
        <span className={cn("flex flex-col gap-0.5", scroll && "motion-safe:animate-[screen-scroll_9s_linear_infinite]")}>
          {(scroll ? [...lines, ...lines] : lines).map((line, index) => (
            <span key={`${index}-${line}`} className={cn("block truncate font-mono text-[7px] leading-[9px]", style.line)}>
              {">"} {line}
            </span>
          ))}
        </span>
        <span className="mt-0.5 inline-block h-2 w-1 bg-current text-cyan-200 motion-safe:animate-[antenna-blink_1s_steps(2)_infinite]" />
      </span>
      <span className="pointer-events-none absolute inset-0 bg-[linear-gradient(transparent_50%,rgba(255,255,255,0.03)_50%)] bg-[size:100%_3px]" />
    </span>
  );
}

function Worker({ color, state, Icon }: { color: string; state: AgentLiveState; Icon?: BuildingAgent["icon"] }) {
  const mode = workMode[state];
  return (
    <span className={cn("relative block h-12 w-10 [transform-style:preserve-3d]", mode.body)}>
      <span className={cn("absolute left-1/2 top-0 h-5 w-5 -translate-x-1/2 rounded-full border border-white/30 bg-gradient-to-br shadow-[inset_-3px_-3px_6px_rgba(0,0,0,0.25)]", color)}>
        <span className="absolute left-1 top-2 h-1 w-1 rounded-full bg-zinc-950" />
        <span className="absolute right-1 top-2 h-1 w-1 rounded-full bg-zinc-950" />
      </span>
      <span className={cn("absolute bottom-0 left-1/2 flex h-7 w-9 -translate-x-1/2 items-center justify-center rounded-t-2xl border border-white/20 bg-gradient-to-br shadow-[inset_-4px_-6px_10px_rgba(0,0,0,0.25)]", color)}>
        {Icon && <Icon className="h-3 w-3 text-zinc-950/70" />}
      </span>
      {mode.hands && (
        <>
          <span className={cn("absolute -left-0.5 bottom-1 h-1.5 w-2.5 rounded-full bg-zinc-200", mode.hands)} />
          <span className={cn("absolute -right-0.5 bottom-1 h-1.5 w-2.5 rounded-full bg-zinc-200 [animation-delay:0.17s]", mode.hands)} />
        </>
      )}
    </span>
  );
}

function Desk({
  name,
  role,
  color,
  Icon,
  status,
  selected,
  debating,
  onSelect,
  testId,
}: {
  name: string;
  role: string;
  color: string;
  Icon?: BuildingAgent["icon"];
  status: AgentLiveStatus;
  selected?: boolean;
  debating?: string;
  onSelect?: () => void;
  testId: string;
}) {
  const style = stateStyle[status.state];
  const content = (
    <>
      {debating && (
        <span className="absolute -top-2 right-2 z-10 rounded-full border border-violet-200/50 bg-violet-500/80 px-1.5 py-0.5 text-[8px] font-bold text-white shadow-lg motion-safe:animate-[agent-breathe_2s_ease-in-out_infinite]" title={debating}>
          Debatiendo
        </span>
      )}
      <span className="flex items-end gap-1.5 [transform-style:preserve-3d]">
        <Worker color={color} state={status.state} Icon={Icon} />
        <Monitor status={status} />
      </span>
      <span className="mt-0.5 block h-2 w-[124px] rounded-sm bg-gradient-to-b from-zinc-500 to-zinc-800 shadow-[0_8px_12px_rgba(0,0,0,0.55)]" />
      <span className="mt-2 w-full truncate text-center text-xs font-semibold text-white">{name}</span>
      <span className="w-full truncate text-center text-[10px] text-zinc-500">{role}</span>
      <span className={cn("mt-1.5 flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5", style.chip)}>
        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", style.dot, status.state === "working" && "motion-safe:animate-pulse")} />
        <span className={cn("truncate text-[10px] font-medium", style.text)}>{status.label}</span>
      </span>
      <span className="mt-1 text-[9px] italic text-zinc-500">{workMode[status.state].verb}</span>
    </>
  );
  const className = cn(
    "pointer-events-auto group relative flex w-full min-w-0 flex-col items-center rounded-xl border px-2 pb-2 pt-3 text-left transition [transform-style:preserve-3d] [transform:translateZ(14px)]",
    "hover:brightness-125 hover:shadow-[0_18px_40px_rgba(34,211,238,0.18)]",
    selected ? "border-cyan-200/70 bg-cyan-300/10" : "border-white/[0.07] bg-[#0b1220]/90 hover:border-white/20",
    debating && "ring-1 ring-violet-300/50"
  );
  const title = status.detail ? `${status.label} - ${status.detail}` : status.label;
  return onSelect ? (
    <button type="button" onClick={onSelect} title={title} data-testid={testId} data-agent-state={status.state} className={className}>
      {content}
    </button>
  ) : (
    <div title={title} data-testid={testId} data-agent-state={status.state} className={className}>
      {content}
    </div>
  );
}

function FloorShell({ level, name, note, children, testId }: { level: string; name: string; note?: string; children: ReactNode; testId?: string }) {
  return (
    <div className="relative flex border-b-4 border-zinc-900/90 [transform-style:preserve-3d] last:border-b-0" data-testid={testId}>
      {/* Back wall with windows, sitting behind the desks. */}
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(148,197,255,0.06)_1px,transparent_1px)] bg-[size:46px_100%] [transform:translateZ(-10px)]" />
      <div className="flex w-10 shrink-0 flex-col items-center justify-center border-r border-white/[0.07] bg-black/40 py-3 sm:w-14">
        <span className="text-lg font-black leading-none text-white/80">{level}</span>
        <span className="mt-1 text-[8px] font-semibold uppercase tracking-[0.18em] text-zinc-500">piso</span>
      </div>
      <div className="min-w-0 flex-1 px-2 py-3 [transform-style:preserve-3d] sm:px-3">
        <div className="mb-2 flex items-baseline gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-100/80">{name}</p>
          {note && <p className="hidden truncate text-[10px] text-zinc-500 sm:block">{note}</p>}
        </div>
        <div className="grid grid-cols-2 items-start gap-2 [transform-style:preserve-3d] sm:grid-cols-3 sm:gap-2.5 md:grid-cols-4">{children}</div>
      </div>
    </div>
  );
}

const verdictStyle: Record<string, string> = {
  escalado: "border-amber-300/40 bg-amber-300/10 text-amber-100",
  confirmado: "border-emerald-300/30 bg-emerald-400/10 text-emerald-100",
  descartado: "border-white/10 bg-white/5 text-zinc-300",
};
const proposalStatusLabel: Record<CouncilProposal["status"], string> = {
  pending_submit: "preparando",
  submitted: "esperando tu aprobacion",
  approved: "aprobada",
  applied: "aplicada",
  rejected: "rechazada",
  not_submitted: "sin enviar (Trust Center no disponible)",
};

function DebateRoom({ council, names, onRun, running, runError }: { council: ReturnType<typeof useCouncil>; names: Record<string, string>; onRun: () => void; running: boolean; runError: string | null }) {
  const view = council.view;
  const debates: CouncilDebate[] = view?.debates || [];
  const proposals = (view?.proposals || []).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const open = proposals.filter((proposal) => ["submitted", "pending_submit", "not_submitted"].includes(proposal.status));
  const nameOf = (id: string) => names[id] || id;
  return (
    <div className="pointer-events-auto col-span-2 flex min-h-[170px] flex-col rounded-xl border border-violet-300/20 bg-[#120f24]/90 p-3 [transform:translateZ(14px)] sm:col-span-3 md:col-span-2" data-testid="council-room">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-violet-100">Sala de debate</p>
        <button
          type="button"
          onClick={onRun}
          disabled={running || !view}
          className="rounded-full border border-violet-200/40 bg-violet-400/15 px-2.5 py-1 text-[10px] font-semibold text-violet-50 transition hover:bg-violet-400/30 disabled:opacity-50"
          data-testid="button-council-run"
        >
          {running ? "Reunidos..." : "Reunir ahora"}
        </button>
      </div>
      {council.error && <p className="mt-2 text-[11px] text-amber-200" data-testid="council-error">{council.error}</p>}
      {runError && <p className="mt-1 text-[11px] text-amber-200">{runError}</p>}
      {view && (
        <p className="mt-1 text-[10px] text-zinc-400">
          {view.cycles} reuniones · ultima {view.lastCycleAt ? new Date(view.lastCycleAt).toLocaleTimeString() : "pendiente"} · {view.lessons.length} lecciones aprendidas · costo ${view.costUsd}
        </p>
      )}
      <div className="mt-2 flex flex-col gap-1.5">
        {view && view.enabled === false && <p className="text-[11px] text-zinc-400">El consejo esta apagado (AGENT_COUNCIL_ENABLED=false).</p>}
        {view && view.lastCycleError && <p className="text-[11px] text-rose-200" data-testid="council-cycle-error">La ultima reunion fallo: {view.lastCycleError}</p>}
        {view && view.enabled !== false && view.cycles === 0 && <p className="text-[11px] text-zinc-400">Primera reunion en camino (el consejo se reune cada 15 min).</p>}
        {view && view.cycles > 0 && !view.lastCycleError && debates.length === 0 && <p className="text-[11px] text-emerald-200">Sin desacuerdos: los agentes revisaron el trabajo de sus pares y todo cuadra.</p>}
        {debates.slice(0, 4).map((debate) => (
          <div key={debate.key} className="rounded-lg border border-white/[0.06] bg-black/30 p-2" data-testid="council-debate">
            <div className="flex flex-wrap items-center gap-1 text-[10px]">
              <span className="font-semibold text-violet-100">{nameOf(debate.reviewer)}</span>
              <span className="text-zinc-500">revisa a</span>
              <span className="font-semibold text-white">{nameOf(debate.subject)}</span>
              <span className={cn("ml-auto rounded-full border px-1.5 py-0.5 text-[9px] font-semibold", verdictStyle[debate.verdict])}>
                CEO: {debate.verdict}
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-4 text-zinc-200">{debate.claim}</p>
            <p className="mt-0.5 text-[10px] leading-4 text-zinc-500">Defensa: {debate.defense}{debate.streak > 1 ? ` · ${debate.streak} reuniones seguidas` : ""}</p>
          </div>
        ))}
        {debates.length > 4 && <p className="text-[10px] text-zinc-500">+{debates.length - 4} debates mas</p>}
      </div>
      {open.length > 0 && (
        <div className="mt-2 border-t border-white/[0.06] pt-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">Propuestas de mejora</p>
          {open.slice(0, 4).map((proposal) => (
            <p key={proposal.key} className="mt-1 truncate text-[11px] text-zinc-200" title={proposal.description} data-testid="council-proposal">
              <span className="text-violet-200">{proposal.kind === "new_agent" ? "Contratar" : proposal.kind === "lesson" ? "Leccion" : "Skill"}:</span> {proposal.title}{" "}
              <span className="text-zinc-500">({proposalStatusLabel[proposal.status]})</span>
            </p>
          ))}
          <a href="/" className="mt-1 inline-block text-[10px] font-semibold text-cyan-200 hover:underline">Aprobar o rechazar en el Trust Center →</a>
        </div>
      )}
    </div>
  );
}

export function councilDeskStatus(view: CouncilView | null, kind: "scout" | "factory", error: string | null): AgentLiveStatus {
  if (!view) return error ? { state: "offline", label: "Sin conexion", detail: error } : { state: "checking", label: "Verificando..." };
  if (kind === "scout") {
    const last = view.scout.lastRunAt ? Date.parse(view.scout.lastRunAt) : 0;
    const activity = view.scout.latest.slice(0, 4).map((release) => `${release.repo.split("/")[1]} ${release.tag}`);
    if (view.scout.error && !activity.length) return { state: "error", label: "Sin acceso a GitHub", detail: view.scout.error };
    if (!last) return { state: "checking", label: "Primera ronda pendiente", activity: ["Vigila releases publicos", "1 vez al dia, gratis"] };
    const stale = Date.now() - last > 26 * 3_600_000;
    const pending = view.proposals.filter((p) => p.owner === "skills-scout" && p.status === "submitted").length;
    return {
      state: stale ? "needs-setup" : "available",
      label: stale ? "Ronda atrasada" : pending ? `${pending} mejoras propuestas` : "Skills al dia",
      detail: view.scout.error || undefined,
      activity,
    };
  }
  if (view.cycles === 0) return { state: "checking", label: "Esperando la primera reunion", activity: ["Busca huecos entre los agentes", "Propone agentes nuevos al CEO"] };
  const hires = view.proposals.filter((p) => p.kind === "new_agent");
  const open = hires.filter((p) => ["submitted", "pending_submit", "not_submitted"].includes(p.status));
  return {
    state: "available",
    label: open.length ? `${open.length} contrataciones propuestas` : "Sin vacantes",
    activity: hires.length ? hires.slice(0, 4).map((p) => p.title.replace("Contratar ", "")) : ["Busca huecos entre los agentes", "Propone agentes nuevos al CEO"],
  };
}

export function AgentsBuilding({
  agents,
  kongTeam,
  legal,
  selectedAgentId,
  onSelectAgent,
  onSelectKongAgent,
}: {
  agents: BuildingAgent[];
  kongTeam: BuildingTeamAgent[];
  legal: { data: unknown; isError: boolean };
  selectedAgentId?: string;
  onSelectAgent: (agentId: string, status: AgentLiveStatus) => void;
  onSelectKongAgent: (name: string) => void;
}) {
  const agentIds = useMemo(() => agents.map((agent) => agent.id), [agents]);
  const liveStatuses = useAgentLiveStatuses(agentIds, legal);
  const council = useCouncil();
  const queryClient = useQueryClient();
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [tilt, setTilt] = useState({ x: 4, y: -10 });
  const stageRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const agentById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents]);
  const names = useMemo(() => ({
    ...Object.fromEntries(agents.map((agent) => [agent.id, agent.name])),
    "skills-scout": "Skills Scout",
    "agent-factory": "Fabrica de agentes",
    kong: "Equipo Kong",
  }), [agents]);

  // Approved council lessons change how an agent is reported.
  const statuses: Record<string, AgentLiveStatus> = { ...liveStatuses };
  for (const [agentId, override] of Object.entries(council.view?.overrides || {})) {
    const current = statuses[agentId];
    if (current && (current.state === "working" || current.state === "available")) statuses[agentId] = { ...current, state: "needs-setup", label: override.label, detail: override.detail };
  }

  const debatingBy = new Map<string, string>();
  for (const debate of council.view?.debates || []) {
    if (debate.verdict === "descartado") continue;
    debatingBy.set(debate.reviewer, debatingBy.get(debate.reviewer) || debate.topic);
    debatingBy.set(debate.subject, debatingBy.get(debate.subject) || debate.topic);
  }

  const counts: Record<AgentLiveState, number> = { working: 0, available:0, "needs-setup": 0, error: 0, offline: 0, checking: 0 };
  for (const id of agentIds) counts[statuses[id]?.state ?? "checking"] += 1;

  const runCouncil = async () => {
    setRunning(true);
    setRunError(null);
    const result = await runProbe("/api/agent-council/run", (input, init) => fetch(input, { ...init, method: "POST" }));
    if (!result.ok) setRunError(result.status === 429 ? "El consejo acaba de reunirse; espera un minuto." : "No se pudo reunir al consejo.");
    await queryClient.invalidateQueries({ queryKey: ["agent-council-state"] });
    setRunning(false);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse" || frameRef.current !== null) return;
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = (event.clientX - rect.left) / rect.width - 0.5;
    const py = (event.clientY - rect.top) / Math.max(rect.height, 1) - 0.5;
    // One tilt update per animation frame keeps re-renders cheap.
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      setTilt({ x: 4 - py * 4, y: -10 + px * 16 });
    });
  };

  const renderAgent = (id: string) => {
    const agent = agentById.get(id);
    if (!agent) return null;
    const status = statuses[id] ?? { state: "checking" as const, label: "Verificando..." };
    return (
      <Desk
        key={id}
        name={agent.name}
        role={agent.role}
        color={agent.color}
        Icon={agent.icon}
        status={status}
        selected={selectedAgentId === id}
        debating={debatingBy.get(id)}
        onSelect={() => onSelectAgent(id, status)}
        testId={`building-agent-${id}`}
      />
    );
  };

  const placed = new Set([...buildingFloors.flatMap((floor) => floor.agentIds), ...OPERATIONS_AGENT_IDS]);
  const unplaced = agentIds.filter((id) => !placed.has(id));
  const tiltStyle: CSSProperties = { transform: `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)` };

  return (
    <div className="mx-auto w-full max-w-[900px]" data-testid="agents-building">
      <div
        ref={stageRef}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setTilt({ x: 4, y: -10 })}
        className="group/stage pb-16 [perspective:2400px] [perspective-origin:50%_50%]"
        data-testid="building-stage"
      >
        <div className="pointer-events-none [transform-style:preserve-3d] motion-safe:animate-[building-sway_16s_ease-in-out_infinite] group-hover/stage:[animation-play-state:paused]">
          {/* Transform layers ignore the pointer so tilted planes never swallow clicks; desks and buttons opt back in. */}
          <div className="pointer-events-none relative transition-transform duration-500 ease-out [transform-style:preserve-3d]" style={tiltStyle} data-testid="building-3d">
            {/* Rooftop */}
            <div className="relative mx-auto flex h-16 w-[86%] items-end justify-center [transform-style:preserve-3d]">
              <span className="absolute bottom-0 left-[18%] h-12 w-0.5 bg-zinc-600" />
              <span className="absolute bottom-12 left-[18%] h-2 w-2 -translate-x-[3px] rounded-full bg-rose-400 motion-safe:animate-[antenna-blink_1.6s_steps(2)_infinite]" />
              <span className="absolute bottom-0 right-[20%] hidden h-6 w-12 rounded-t-md border border-white/10 bg-zinc-800 sm:block" />
              <div className="rounded-t-xl border border-b-0 border-cyan-200/20 bg-[#0b1220] px-5 py-2 text-center shadow-[0_-10px_40px_rgba(34,211,238,0.12)] [transform:translateZ(20px)]">
                <p className="text-sm font-black tracking-[0.3em] text-white">ROBS HQ</p>
                <p className="text-[10px] font-medium text-emerald-200" data-testid="building-working-count">
                  {counts.working} de {agentIds.length} agentes trabajando
                </p>
                <p className="text-[9px] text-violet-200" data-testid="building-council-count">
                  {council.view ? `${council.view.debates.length} debates abiertos · consejo cada 15 min · $0` : "Consejo conectando..."}
                </p>
              </div>
            </div>

            <div className="relative [transform-style:preserve-3d]">
              {/* Building volume: roof slab and side wall give the 3D depth. */}
              <div className="pointer-events-none absolute -top-10 left-0 right-0 h-10 origin-bottom bg-gradient-to-t from-zinc-800 to-zinc-900 [transform:rotateX(90deg)]" aria-hidden="true" />
              <div className="pointer-events-none absolute bottom-0 left-full top-0 w-10 origin-left bg-[linear-gradient(180deg,#111827,#05070c)] bg-[size:100%_100%] [transform:rotateY(90deg)]" aria-hidden="true">
                <div className="h-full w-full bg-[linear-gradient(rgba(148,197,255,0.08)_1px,transparent_1px)] bg-[size:100%_28px]" />
              </div>

              <div className="relative flex overflow-visible rounded-t-2xl border border-white/10 bg-[linear-gradient(180deg,#0d1522,#080d16)] shadow-[0_40px_80px_rgba(0,0,0,0.6)] [transform-style:preserve-3d]">
                <div className="min-w-0 flex-1 [transform-style:preserve-3d]">
                  <FloorShell level="7" name="Consejo y mejora continua" note="Revision cruzada entre agentes, sin gasto de API" testId="floor-council">
                    <Desk
                      name="Skills Scout"
                      role="Novedades y skills"
                      color="from-violet-300 to-fuchsia-400"
                      status={councilDeskStatus(council.view, "scout", council.error)}
                      debating={debatingBy.get("skills-scout")}
                      testId="building-agent-skills-scout"
                    />
                    <Desk
                      name="Fabrica de agentes"
                      role="El CEO contrata"
                      color="from-amber-200 to-violet-400"
                      status={councilDeskStatus(council.view, "factory", council.error)}
                      testId="building-agent-agent-factory"
                    />
                    <DebateRoom council={council} names={names} onRun={runCouncil} running={running} runError={runError} />
                  </FloorShell>

                  {buildingFloors.map((floor) => (
                    <FloorShell key={floor.id} level={floor.level} name={floor.name} testId={`floor-${floor.id}`}>
                      {floor.agentIds.map(renderAgent)}
                    </FloorShell>
                  ))}

                  <FloorShell level={KONG_LEVEL} name="Kong" note="Equipo de kong-nightlife: guias, todavia sin backend propio" testId="floor-kong">
                    {kongTeam.map((member) => (
                      <Desk
                        key={member.name}
                        name={member.name}
                        role={member.job}
                        color="from-lime-300 to-emerald-400"
                        status={{ state: "offline", label: "Sin backend propio", detail: "Responde con guias locales; no ejecuta tareas en Kong.", activity: ["Esperando su backend", "Guia local activa"] }}
                        selected={selectedAgentId === `Kong-${member.name}`}
                        debating={debatingBy.get("kong")}
                        onSelect={() => onSelectKongAgent(member.name)}
                        testId={`building-kong-${member.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                      />
                    ))}
                  </FloorShell>

                  <FloorShell level="PB" name="Operaciones y lobby" testId="floor-pb">
                    {OPERATIONS_AGENT_IDS.map(renderAgent)}
                    {unplaced.map(renderAgent)}
                    <div className="flex w-full flex-col items-center justify-end rounded-xl border border-dashed border-white/10 px-2 pb-2 pt-3">
                      <span className="flex h-12 items-end gap-1">
                        <span className="h-10 w-5 rounded-t-md border border-cyan-100/20 bg-cyan-200/10" />
                        <span className="h-10 w-5 rounded-t-md border border-cyan-100/20 bg-cyan-200/10" />
                      </span>
                      <span className="mt-2 text-[10px] uppercase tracking-[0.16em] text-zinc-500">Entrada</span>
                    </div>
                  </FloorShell>
                </div>

                {/* Elevator shaft */}
                <div className="relative hidden w-10 shrink-0 border-l border-white/[0.07] bg-black/40 sm:block" aria-hidden="true">
                  <span className="absolute inset-y-2 left-[18px] w-px bg-zinc-700" />
                  <span className="absolute left-1.5 h-10 w-7 rounded-sm border border-cyan-100/30 bg-cyan-200/15 shadow-[0_0_12px_rgba(34,211,238,0.25)] motion-safe:animate-[elevator-ride_16s_ease-in-out_infinite]" />
                </div>
              </div>
              <div className="h-3 rounded-b-md bg-zinc-800" />
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap justify-center gap-3 text-[11px] text-zinc-400">
        <Legend state="working" label={`Trabajando (${counts.working})`} />
        <Legend state="needs-setup" label={`Requiere atencion (${counts["needs-setup"]})`} />
        <Legend state="error" label={`Con error (${counts.error})`} />
        <Legend state="offline" label={`En espera o sin respuesta (${counts.offline})`} />
        <Legend state="offline" label={`Kong: guias sin backend (${kongTeam.length})`} />
        {counts.checking > 0 && <Legend state="checking" label={`Verificando (${counts.checking})`} />}
      </div>
      <p className="mt-2 text-center text-[10px] text-zinc-600">
        Todos se mueven en su escritorio; la etiqueta dice la verdad. El estado sale del endpoint real de cada agente (solo lectura, cada 1-5 min).
      </p>
    </div>
  );
}

function Legend({ state, label }: { state: AgentLiveState; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("h-2 w-2 rounded-full", stateStyle[state].dot)} />
      {label}
    </span>
  );
}
