import { useMemo, useState } from "react";
import { useCouncil } from "@/components/agents-building/agents-building";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { VitalityRow, VitalityState } from "@shared/agent-vitality";
import type { ClippersLesson } from "@shared/agent-self-improvement";
import { SELF_IMPROVEMENT_PREFIX } from "@shared/agent-self-improvement";
import type { CouncilProposal } from "@shared/agent-council";

// Read-only roster of every registered agent with its vida (0-100), real state and what it
// learned. Data: /api/agent-council/state (same query as the rest of the office). Nothing here
// scores, fires or approves; approvals stay in the Trust Center.

const STATE_LABEL: Record<VitalityState, string> = {
  trabajando: "Trabajando", al_dia: "En turno", atrasado: "Perdiendo vida", en_espera: "En espera (no pierde vida)",
  en_academia: "En la academia", vida_cero: "Vida 0 · revisión del CEO/Robert", sin_entregable: "Sin entregable propio",
  sin_puntuar: "No se puntúa", sin_carrera: "Sin carrera aún",
};
const STATE_CLASS: Record<VitalityState, string> = {
  trabajando: "bg-emerald-400/15 text-emerald-200", al_dia: "bg-sky-400/15 text-sky-200", atrasado: "bg-amber-400/15 text-amber-200",
  en_espera: "bg-slate-400/15 text-slate-200", en_academia: "bg-blue-400/15 text-blue-200", vida_cero: "bg-rose-500/20 text-rose-200",
  sin_entregable: "bg-zinc-500/15 text-zinc-300", sin_puntuar: "bg-zinc-500/15 text-zinc-300", sin_carrera: "bg-zinc-500/15 text-zinc-300",
};
const vidaClass = (vida: number) => (vida > 60 ? "accent-emerald-400" : vida > 25 ? "accent-amber-300" : "accent-rose-400");
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("es", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "nunca");

type VitalityCouncilView = { vitality?: VitalityRow[]; clippersAcademy?: { observedAt: string; lessons: ClippersLesson[] } | null; proposals?: CouncilProposal[] };

export function AgentVitalityRoster({ groups, title = "Vida del equipo", testId = "agent-vitality-roster" }: { groups?: string[]; title?: string; testId?: string }) {
  const council = useCouncil();
  const view = (council.view || null) as unknown as VitalityCouncilView | null;
  const [filter, setFilter] = useState<"todos" | "problemas">("todos");
  const rows = useMemo(() => (Array.isArray(view?.vitality) ? view!.vitality : []).filter((row) => !groups || groups.includes(row.group)), [view, groups]);
  const shown = filter === "problemas" ? rows.filter((row) => row.state === "atrasado" || row.state === "vida_cero") : rows;
  const byGroup = useMemo(() => {
    const map = new Map<string, VitalityRow[]>();
    for (const row of shown) map.set(row.group, [...(map.get(row.group) || []), row]);
    return [...map.entries()];
  }, [shown]);
  const count = (state: VitalityState) => rows.filter((row) => row.state === state).length;
  const lessons = (view?.clippersAcademy?.lessons || []).filter((lesson) => !groups || groups.includes("Clippers / Orquesta"));
  const automejora = (view?.proposals || []).filter((proposal) => proposal.key.startsWith(SELF_IMPROVEMENT_PREFIX) && ["pending_submit", "submitted", "not_submitted"].includes(proposal.status) && (!groups || rows.some((row) => row.agentId === proposal.owner)));

  if (!view) return <section data-testid={testId} className="rounded-lg border p-3 text-sm"><h3 className="font-semibold">{title}</h3>
    <p className="mt-1 text-xs text-muted-foreground" role="status">{council.error ? `No se pudo leer la vida del equipo (${council.error}). No se presenta actividad como actual.` : "Verificando la vida del equipo..."}</p></section>;
  if (!rows.length) return <section data-testid={testId} className="rounded-lg border p-3 text-sm"><h3 className="font-semibold">{title}</h3>
    <p className="mt-1 text-xs text-muted-foreground">El servidor todavía no publica la vida por agente (requiere desplegar esta versión).</p></section>;

  return <section data-testid={testId} className="rounded-lg border p-3 text-sm">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="font-semibold">{title}</h3>
      <div className="flex gap-1 text-xs" role="group" aria-label="Filtro de vida">
        <button type="button" aria-pressed={filter === "todos"} onClick={() => setFilter("todos")} className={`rounded px-2 py-0.5 ${filter === "todos" ? "bg-white/15" : ""}`}>Todos ({rows.length})</button>
        <button type="button" aria-pressed={filter === "problemas"} onClick={() => setFilter("problemas")} className={`rounded px-2 py-0.5 ${filter === "problemas" ? "bg-white/15" : ""}`}>Perdiendo vida ({count("atrasado") + count("vida_cero")})</button>
      </div>
    </div>
    <p className="mt-1 text-xs text-muted-foreground" data-testid={`${testId}-summary`}>{count("trabajando")} trabajando · {count("al_dia")} en turno · {count("atrasado")} perdiendo vida · {count("vida_cero")} con vida 0 · {count("en_espera")} en espera de configuración</p>
    <p className="mt-1 text-[11px] text-muted-foreground">Regla: sin entregable verificado en su turno pierde 3 de vida por turno; cada ronda con trabajo verificado recupera vida. Con vida 0 el CEO pide tu revisión; la inactividad nunca despide ni borra a nadie. Esperar configuración, una fuente apagada, la academia o la oficina caída no restan vida.</p>
    {byGroup.map(([group, items]) => <div key={group} className="mt-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group}</p>
      <ul className="mt-1 space-y-1.5">{items.map((row) => <li key={row.agentId} data-testid={`vitality-${row.agentId}`} className="rounded border border-white/10 p-2">
        <div className="flex items-center justify-between gap-2">
          <b className="truncate">{row.name}</b>
          <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] ${STATE_CLASS[row.state]}`}>{STATE_LABEL[row.state]}</span>
        </div>
        {row.vida !== null ? <div className="mt-1 flex items-center gap-2">
          <meter aria-label={`Vida de ${row.name}`} min={0} max={100} low={26} high={61} optimum={100} value={row.vida} className={`h-2 flex-1 ${vidaClass(row.vida)}`} />
          <span className="w-12 text-right font-mono text-xs">{row.vida}/100</span>
        </div> : null}
        <p className="mt-1 text-[11px] text-muted-foreground">{row.label}. Último entregable verificado: {when(row.lastVerifiedWorkAt)}{row.lastVerifiedLabel ? ` (${row.lastVerifiedLabel})` : ""}{row.cadenceHours ? ` · turno ${row.cadenceHours} h` : ""}{row.nextLossAt && row.state !== "trabajando" ? ` · próxima pérdida ${when(row.nextLossAt)}` : ""}</p>
        {row.learned.length > 0 && <p className="mt-0.5 text-[11px] text-sky-200/80">Aprendió: {row.learned.join(" · ")}</p>}
      </li>)}</ul>
    </div>)}
    {lessons.length > 0 && <div className="mt-3" data-testid={`${testId}-clippers-academy`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Academia Clippers (Metricool)</p>
      <ul className="mt-1 space-y-1">{lessons.slice(0, 12).map((lesson) => <li key={lesson.id} className="text-xs"><b>{lesson.title}</b>{lesson.supported ? "" : " (en prueba)"} — <span className="text-muted-foreground">{lesson.detail}</span></li>)}</ul>
    </div>}
    {automejora.length > 0 && <div className="mt-3" data-testid={`${testId}-automejora`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Automejora pendiente de tu aprobación</p>
      <ul className="mt-1 space-y-1">{automejora.map((proposal) => <li key={proposal.key} className="text-xs"><b>{proposal.title}</b> — <span className="text-muted-foreground">Apruébala o recházala en el Centro de confianza.</span></li>)}</ul>
    </div>}
  </section>;
}

/** Office (la empresa) entry point: one button that opens the full roster (Radix dialog: focus trap, Escape, focus return). */
export function AgentVitalityButton() {
  return <Dialog>
    <DialogTrigger asChild>
      <button type="button" data-testid="office-open-vitality" className="rounded-xl border border-emerald-300/35 bg-emerald-400/10 px-3 py-2 text-xs font-semibold text-emerald-100">Vida del equipo</button>
    </DialogTrigger>
    {/* Above every office control (top bar z-[95..110], legacy overlays z-[260]). */}
    <DialogContent className="z-[270] max-h-[85dvh] overflow-y-auto sm:max-w-2xl" overlayClassName="z-[265]">
      <DialogHeader>
        <DialogTitle>Vida del equipo</DialogTitle>
        <DialogDescription>Todos los agentes registrados con su vida y su último entregable verificado.</DialogDescription>
      </DialogHeader>
      <AgentVitalityRoster testId="office-vitality-roster" title="Agentes" />
    </DialogContent>
  </Dialog>;
}
