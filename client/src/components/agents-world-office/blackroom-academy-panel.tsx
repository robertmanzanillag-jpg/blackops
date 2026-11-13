import { blackRoomAcademySummary, type BlackRoomAcademyRow } from "@shared/blackroom-academy";
import { BLACKROOM_TEAM } from "@shared/blackroom-team";
import type { CompanyState } from "@shared/agent-company";

const NAMES: Record<string, string> = {
  ...Object.fromEntries(BLACKROOM_TEAM.map((agent) => [agent.id, agent.name])),
  "blackroom-videos": "Videos Black Room",
  radio: "Radio Black Room",
};

const STATUS_STYLE: Record<BlackRoomAcademyRow["status"], string> = {
  estudiando: "text-sky-200",
  evaluando: "text-amber-200",
  "espera ejecucion real": "text-violet-200",
  graduado: "text-emerald-300",
  cerrado: "text-zinc-400",
};

const PURPOSE_TEXT: Record<BlackRoomAcademyRow["purpose"], string> = {
  refresco: "Refuerzo del puesto",
  reemplazo: "Reemplazo de un despedido",
  aspirante: "Aspirante",
};

/** "Academia Black Room": trainees of the Black Room team, curriculum progress, scores and graduations. Read-only. */
export function BlackRoomAcademyPanel({ company, onClose }: { company: CompanyState | null | undefined; onClose: () => void }) {
  const summary = blackRoomAcademySummary(company);
  return (
    <section aria-label="Academia Black Room" className="absolute right-3 top-[220px] z-30 sm:top-36 lg:top-24 max-h-[55%] w-[min(440px,calc(100vw-1.5rem))] overflow-y-auto rounded-2xl border border-fuchsia-200/25 bg-[#12061a]/95 p-4 text-xs text-white shadow-2xl" data-testid="world-blackroom-academy-panel">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-bold text-fuchsia-100">Academia Black Room</h2>
        <button type="button" onClick={onClose} aria-label="Cerrar academia Black Room">Cerrar</button>
      </div>
      <p className="mt-1 text-zinc-300">
        {summary.active} en formacion · {summary.graduated} graduados · {summary.jobs.today} evaluaciones hoy{summary.jobs.blocked ? ` · ${summary.jobs.blocked} por conciliar` : ""}
      </p>
      <p className="mt-1 text-[11px] text-zinc-400">Estudian su puesto y las lecciones reales del equipo (posteos rechazados, trabajos fallidos, lo que rindio arriba de la mediana). Se graduan solo con casos aprobados y una ejecucion real verificada.</p>

      {summary.careers.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-1.5" data-testid="world-blackroom-academy-careers">
          {summary.careers.map((career) => (
            <div key={career.agentId} className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-2 py-1.5">
              <p className="truncate text-[11px] font-semibold">{NAMES[career.agentId] || career.agentId}</p>
              <p className="truncate text-[10px] text-zinc-400">{career.nickname} · gen {career.generation} · {career.points} pts · vida {career.battery}%{career.inTraining ? " · en academia" : ""}</p>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 space-y-1.5" data-testid="world-blackroom-academy-rows">
        {summary.rows.length === 0 && <p className="text-zinc-400">Todavia no hay alumnos de Black Room. Entran cuando el consejo corre una ronda con el equipo contratado.</p>}
        {summary.rows.map((row) => (
          <div key={row.id} className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-2 py-1.5" data-testid={`world-blackroom-academy-row-${row.forAgentId}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-semibold">{row.nickname} · {NAMES[row.forAgentId] || row.forAgentId}</span>
              <span className={`shrink-0 text-[10px] ${STATUS_STYLE[row.status]}`}>{row.status}</span>
            </div>
            <p className="mt-0.5 text-[10px] text-zinc-400">{PURPOSE_TEXT[row.purpose]} · desde {row.startedAt.slice(0, 10)}{row.graduatedAt ? ` · graduado ${row.graduatedAt.slice(0, 10)}` : ""}</p>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/10" aria-label={`Curriculo ${row.modulesDone} de ${row.modulesTotal}`}>
              <div className="h-full rounded-full bg-fuchsia-400" style={{ width: `${row.modulesTotal ? Math.round((row.modulesDone / row.modulesTotal) * 100) : 0}%` }} />
            </div>
            <p className="mt-1 text-[10px] text-zinc-300">
              Curriculo {row.modulesDone}/{row.modulesTotal} ({row.lessonsStudied} lecciones reales) · casos aprobados {row.casesPassed}/3 de {row.casesTried} intentados
              {row.averageQuality !== null ? ` · nota media ${row.averageQuality}` : ""} · ejecuciones reales {row.realRuns}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
