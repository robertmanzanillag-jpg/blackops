import { useEffect, useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Clapperboard, Clock3, Radio, RefreshCw, ShieldCheck } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiRequest } from "@/lib/queryClient";
import { CLIPPERS_AGENTS } from "@shared/clippers-office-agents";
import { parseClippersOrchestraStatus, type ClippersOrchestraStatus, type ClippersRoleEvidence } from "@shared/clippers-orchestra";
import type { ViralScoutView } from "@shared/clippers-viral-scout.mjs";
import { kongSupervisorSessionScope, type SupervisorAuth } from "./kong-supervisor-session";
import { growthRows } from "@shared/clippers-growth-view";

export const CLIPPERS_ORCHESTRA_ENDPOINT = "/api/clippers/orchestra/status";
const dateFormat = new Intl.DateTimeFormat("es", { dateStyle: "short", timeStyle: "short" });
const number = (value: number | null) => value === null ? "Sin evidencia" : new Intl.NumberFormat("es").format(value);
const at = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? dateFormat.format(Date.parse(value)) : "Sin registro";

export function clippersEvidenceFresh(data: ClippersOrchestraStatus, now: number) {
  const ingest = Date.parse(data.transport.lastIngestAt || "");
  const report = Date.parse(data.sourceFreshness.reportedAt || "");
  return data.transport.state === "connected" && data.sourceFreshness.state === "connected"
    && Number.isFinite(ingest) && now >= ingest && now - ingest <= data.transport.maxAgeMs
    && Number.isFinite(report) && now >= report && now - report <= data.sourceFreshness.staleAfterMinutes * 60_000;
}

export function clippersVisibleRoleState(role: ClippersRoleEvidence, fresh: boolean, now: number) {
  if (!fresh) return role.state === "disconnected" ? "disconnected" : "stale";
  if (role.state !== "working") return role.state;
  const until = Date.parse(role.activeUntil || "");
  return role.runId && role.evidenceIds.length > 0 && Number.isFinite(until) && until > now ? "working" : "unverified";
}

const stateLabels = {
  working: "Ejecutando ahora", completed: "Última ejecución completada", held: "En espera",
  idle: "Sin ejecución actual", stale: "Señal obsoleta", disconnected: "Sin conexión verificada", unverified: "Actividad sin verificar",
};
const stateTone = (state: string) => state === "working" ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-200"
  : ["held", "stale", "disconnected", "unverified"].includes(state) ? "border-amber-200/20 bg-amber-200/5 text-amber-100"
    : "border-slate-400/20 bg-slate-400/5 text-slate-300";

const reasonLabels: Record<string, string> = {
  creator_selection_report_unavailable: "Todavía no se ha recibido una evaluación verificable de creadores.",
  creator_routing_unavailable: "No pudo verificarse la selección de creadores en este ciclo.",
  no_current_ready_assets: "No hay activos vigentes y revisados para comparar creadores.",
  reviewed_creator_context_or_render_missing: "Faltan el contexto revisado o los recibos del material.",
  creator_band_capacity_insufficient: "La franja no tiene suficientes horarios aprobados para una comparación viable.",
  multiple_approved_slots_in_band_required: "Se requieren al menos dos horarios ya aprobados dentro de esta franja.",
  current_readiness_required: "Falta material vigente y revisado para este contexto.",
  comparable_evidence_insufficient: "Todavía no hay evidencia comparable suficiente.",
  three_disjoint_batches_required: "Faltan tres cohortes independientes de cinco publicaciones por grupo.",
  exact_five_per_arm_required: "Cada cohorte debe tener cinco publicaciones de cada creador.",
  assigned_sample_invalid_or_conflicting: "Una muestra asignada carece de métricas o recibos comparables.",
  actual_age_bin_mismatch: "Las muestras tienen edades diferentes y no se comparan.",
  direct_quality_metric_required: "Falta una métrica directa y comparable de finalización.",
  median_lift_below_twenty_percent: "La mejora medida no alcanza el 20% requerido.",
  quality_regression: "La finalización medida empeoró; se conserva la referencia.",
  cost_or_elapsed_regression: "El costo o tiempo medido empeoró; se conserva la referencia.",
  duplicate_post_or_source: "Una publicación o fuente repetida impide contar cohortes independientes.",
  three_disjoint_batches_qualified: "Tres cohortes independientes superaron los controles de rendimiento.",
  creator_preference_expired: "La evidencia de esta preferencia caducó; se conserva una referencia segura.",
  creator_preference_freshness_unverified: "La vigencia de esta preferencia ya no puede verificarse.",
  creator_context_time_budget_reached: "La evaluación alcanzó su límite de tiempo y queda pendiente.",
  scope_capacity_reached: "Se alcanzó el límite de contextos; el historial anterior se conserva.",
  duplicate_reviewed_asset_id: "El mismo material aparece varias veces y su asignación queda pendiente.",
  challenger_not_due_today: "Esta fuente se revisará en su turno de exploración.",
  daily_rss_cap_reached: "Se alcanzó el presupuesto diario de lecturas públicas.",
  reserved_request_outcome_unknown: "Una lectura anterior no confirmó su resultado y no se repite.",
  discovery_deadline_or_day_changed: "La lectura alcanzó su límite de tiempo o cambió el día de presupuesto.",
  no_reviewed_assets: "Falta material revisado con permiso para este destino.",
  no_eligible_assets: "No hay material apto para este destino.",
  no_measured_pairs: "Todavía no hay comparaciones medidas con evidencia suficiente.",
  destination_not_connected: "La marca no tiene redes conectadas.",
  not_observed: "Esta fuente aún no tiene una observación verificada.",
  report_missing: "Falta el reporte del ejecutor.",
  report_stale: "El reporte del ejecutor está obsoleto.",
  transport_stale: "No se ha recibido una señal reciente del ejecutor.",
  metrics_missing: "No hay métricas verificadas para comparar.",
  rights_not_reviewed: "Los derechos de uso están pendientes de revisión.",
  render_receipt_missing: "Falta un recibo verificable del renderizado.",
  render_receipt_unverified: "Todavía no se ha verificado el recibo de renderizado.",
  runtime_evidence_stale: "La evidencia del ejecutor ha superado su plazo de vigencia.",
  runtime_reports_unavailable: "No hay reportes verificables del ejecutor.",
  runtime_evidence_unavailable_or_stale: "Falta evidencia reciente del ejecutor.",
  mac_status_ingest_stale: "La señal recibida desde el ejecutor local ha caducado.",
  source_not_observed: "Esta fuente aún no tiene observaciones verificadas.",
  learning_report_unavailable: "Falta el reporte de aprendizaje de esta cuenta.",
  learning_state_unavailable: "El historial de aprendizaje no está disponible.",
  watchdog_report_unavailable: "Falta el reporte del supervisor diario.",
  no_verified_metric_observations: "Todavía no hay métricas verificadas para evaluar resultados.",
  initial_baseline_or_insufficient_metrics: "Solo hay una referencia inicial o faltan métricas para medir crecimiento.",
  public_feed_observations_unavailable: "Todavía no se han verificado observaciones de estas fuentes públicas.",
  preparation_disabled: "La preparación de material está desactivada.",
  no_reviewed_ready_media: "Falta material listo y revisado para preparar.",
  rights_or_render_review_required: "Falta revisar los derechos de uso o el renderizado.",
  no_provider_confirmed_publication_or_schedule: "No hay una programación o publicación confirmada por el proveedor.",
  three_current_independent_comparisons_required: "Se necesitan tres experimentos independientes y vigentes.",
  manual_queue_review_required: "Las comparaciones requieren revisión manual antes de activar una política.",
  comparison_not_current: "Esta comparación corresponde a una política anterior.",
  five_samples_per_arm_required: "Se necesitan al menos cinco muestras en cada grupo.",
  quality_cost_time_or_view_guard_not_met: "La comparación no cumple los límites de calidad, coste, tiempo o mejora de views.",
  account_analytics_unavailable: "Todavía no hay una lectura verificable de la analítica de esta cuenta.",
};
const outputLabels: Record<string, string> = {
  researchCandidates: "Candidatos de investigación",
  verified_publications: "Publicaciones verificadas", observations: "Observaciones", prepared: "Preparados",
  uploaded: "Subidos", eligible_assets: "Activos aptos", comparisons: "Comparaciones", promotions: "Promociones",
  snapshots: "Muestras de métricas", pairedGrowthSignals: "Señales de crecimiento pareado", scopedMediaReceipts: "Recibos del destino",
  verifiedScopedMedia: "Material verificado por destino", confirmed: "Confirmados por el proveedor", verifiedPublications: "Publicaciones verificadas", eligibleComparisons: "Comparaciones elegibles",
};

/** Per-account weekly views, median, auto-publish gate and growth decisions (cloud growth loop). */
export function ClippersGrowthTable({ outputs }: { outputs: Record<string, number> }) {
  const rows = growthRows(outputs);
  if (!rows.length) return null;
  return <table className="mt-3 w-full text-left text-[11px]" data-testid="clippers-growth-table">
    <caption className="mb-1 text-left text-slate-400">Crecimiento por cuenta (últimos 7 días)</caption>
    <thead><tr className="text-slate-500"><th className="font-normal">Cuenta</th><th className="font-normal">Views</th><th className="font-normal">Mediana</th><th className="font-normal">Publicación</th><th className="font-normal">Decisiones</th></tr></thead>
    <tbody>{rows.map(row => <tr key={row.lane} className="text-slate-200" data-testid={`clippers-growth-${row.lane}`}>
      <td>{row.label}</td><td>{number(row.weeklyViews)}</td><td>{number(row.weeklyMedian)}</td>
      <td>{row.ownerOverride ? "auto (owner override)" : row.autoPublish ? "Automática" : "Borradores (aprobación)"}</td><td>{number(row.decisions)}</td>
    </tr>)}</tbody>
  </table>;
}

function Reasons({ reasons }: { reasons: string[] }) {
  return reasons.length > 0 ? <ul className="mt-2 space-y-1 text-xs leading-relaxed text-amber-100/90">
    {reasons.map((reason, index) => <li key={`${index}:${reason}`} className="break-words">{Object.hasOwn(reasonLabels, reason) ? reasonLabels[reason] : "Motivo pendiente de verificación."}</li>)}
  </ul> : null;
}

function Time({ label, value }: { label: string; value: string | null }) {
  return <div><dt className="text-slate-500">{label}</dt><dd className="mt-0.5 text-slate-300">{value ? <time dateTime={value}>{at(value)}</time> : "Sin registro"}</dd></div>;
}

function AgentCard({ agent, role, fresh, now }: { agent: typeof CLIPPERS_AGENTS[number]; role?: ClippersRoleEvidence; fresh: boolean; now: number }) {
  const title = useId();
  const state = role ? clippersVisibleRoleState(role, fresh, now) : "unverified";
  const career = role?.career;
  return <article aria-labelledby={title} data-testid={`clippers-agent-${agent.stage}`} className="min-w-0 rounded-2xl border border-white/10 bg-slate-950/70 p-4">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div><p className="text-[10px] font-medium uppercase tracking-[0.2em] text-amber-300/70">Clippers / {agent.stage}</p><h3 id={title} className="mt-1 text-base font-semibold text-white">{agent.name}</h3></div>
      <span className={`rounded-full border px-2 py-1 text-[10px] ${stateTone(state)}`}>{stateLabels[state]}</span>
    </div>
    <p className="mt-2 min-h-10 text-xs leading-relaxed text-slate-400">{agent.role}</p>
    <div className="mt-4 border-t border-white/5 pt-3" data-testid={`clippers-career-${agent.stage}`}>
      {career?.registered && career.battery !== null ? <>
        <div className="flex justify-between gap-2 text-xs"><span className="text-slate-400">Vida registrada · generación {career.generation ?? "sin verificar"}</span><span className="font-medium text-white">{career.battery}/100</span></div>
        <meter aria-label={`Vida registrada de ${agent.name}`} min={0} max={100} value={career.battery} className="mt-2 h-2 w-full accent-amber-300" />
        <p className="mt-1 text-xs text-slate-400">{number(career.points)} puntos registrados · {career.inTraining ? "En academia" : "Carrera registrada"}</p>
        <p className="mt-1 text-[11px] text-slate-500">{career.lastEvidenceId ? "Con resultado evaluado en el historial" : "Sin resultado evaluado; la vida inicial no prueba rendimiento"}</p>
        {career.skillIds.length > 0 && <p className="mt-1 text-[11px] text-slate-400">{career.skillIds.length} habilidades registradas</p>}
      </> : <p className="text-xs text-slate-500">Carrera sin registrar. No se asigna vida ni puntuación desde esta vista.</p>}
    </div>
    {role && <>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-[11px]">
        <Time label="Última ejecución" value={role.lastRunAt} /><Time label="Próximo turno" value={role.nextDueAt} />
        <Time label="Latido observado" value={role.heartbeatAt} /><Time label="Evidencia" value={role.evidenceAt} />
      </dl>
      {agent.stage === "learning" && <ClippersGrowthTable outputs={role.outputs} />}
      {Object.keys(role.outputs).some(key => !key.startsWith("growth_")) && <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">{Object.entries(role.outputs).filter(([key]) => !key.startsWith("growth_")).map(([key, value]) => <div key={key}><dt className="inline text-slate-500">{Object.hasOwn(outputLabels, key) ? outputLabels[key] : "Resultado registrado"}: </dt><dd className="inline text-slate-200">{number(value)}</dd></div>)}</dl>}
      <Reasons reasons={role.heldReasons} />
      {role.ownerNotes?.map(note => <p key={note} className="mt-2 text-xs text-amber-100" data-testid="clippers-owner-note">Nota para Robert: {note}</p>)}
      {role.lifePenaltyExempt && role.heldReasons.length > 0 && <p className="mt-2 text-[10px] text-slate-500">Esta espera no penaliza la vida del agente.</p>}
    </>}
  </article>;
}

export function ClippersViralScout({ scout, now, fresh }: { scout?: ViralScoutView; now: number; fresh: boolean }) {
  return <section className="rounded-2xl border border-amber-200/15 p-4" aria-label="Agente de búsqueda viral" data-testid="clippers-viral-scout">
    <h3 className="font-semibold text-white">Agente de búsqueda viral · candidatos</h3>
    <p className="mt-2 text-xs leading-relaxed text-slate-400">Busca en los canales oficiales del catálogo y ordena videos recientes. Prioriza crecimiento medido; después, views observadas. La popularidad de una muestra no confirma viralidad ni rendimiento en nuestras cuentas.</p>
    <p className="mt-2 text-[11px] text-slate-500">Evaluación: {at(scout?.evaluatedAt ?? null)} · reutiliza las lecturas RSS; sin llamadas pagadas de IA.</p>
    {!scout?.candidates.length && <p className="mt-3 text-sm text-amber-100">{scout?.status === "no_recent_candidates" ? "La última lectura no contiene candidatos recientes con evidencia suficiente." : "Sin datos recientes para proponer videos. La búsqueda necesita una lectura verificable de las fuentes."}</p>}
    {!!scout?.candidates.length && <ol className="mt-4 space-y-3">{scout.candidates.map(candidate => {
      const current = fresh && now - Date.parse(candidate.observedAt) <= 26 * 3600000 && now - Date.parse(candidate.publishedAt) <= 72 * 3600000;
      return <li key={candidate.videoId} className="min-w-0 rounded-xl border border-white/10 bg-white/[0.02] p-3">
        <p className="text-[11px] text-slate-400">{candidate.creatorName} · YouTube</p>
        <a href={candidate.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block break-words text-sm font-medium text-amber-100 underline underline-offset-4">{candidate.title}</a>
        {!current && <p className="mt-2 text-xs text-amber-200">Lectura anterior; prioridad actual sin confirmar.</p>}
        <p className="mt-2 text-xs text-slate-300">Views observadas: {number(candidate.views)} · likes: sin datos</p>
        <p className="mt-1 text-xs text-slate-400">{candidate.evidence === "growth_observed" ? `Dos muestras: +${number(candidate.growthViews)} views · ${number(candidate.growthPerHour)} por hora` : candidate.evidence === "counter_unchanged" ? "Dos muestras sin aumento del contador." : candidate.evidence === "counter_decreased" ? "El contador descendió; no se afirma crecimiento." : candidate.evidence === "metrics_unknown" ? "Sin contador público verificable; crecimiento sin medir." : "Una muestra de popularidad; crecimiento todavía sin medir."}</p>
        <p className="mt-1 text-[11px] text-slate-500">Publicado: {at(candidate.publishedAt)} · observado: {at(candidate.observedAt)} · edad al observar: {candidate.ageHoursWhenObserved.toFixed(1)} h</p>
        {candidate.previousObservedAt && <p className="mt-1 text-[11px] text-slate-500">Muestra anterior: {number(candidate.previousViews)} views · {at(candidate.previousObservedAt)}</p>}
        <a href={candidate.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-[11px] text-slate-400 underline underline-offset-4">Fuente pública de los datos</a>
        <p className="mt-2 text-[11px] text-amber-100">Candidato para revisión · permiso de uso pendiente · sin recortar ni publicar</p>
      </li>;
    })}</ol>}
  </section>;
}

export function ClippersOfficeReport({ data, now }: { data: ClippersOrchestraStatus; now: number }) {
  const fresh = clippersEvidenceFresh(data, now);
  const sum = (key: "eligibleAssets" | "confirmedScheduledOrPublished") => data.accounts.some(account => account[key] === null) ? null : data.accounts.reduce((total, account) => total + (account[key] ?? 0), 0);
  return <div className="min-w-0 space-y-6" data-testid="clippers-orchestra-report">
    <section className="rounded-2xl border border-white/10 bg-gradient-to-br from-amber-300/[0.08] via-slate-950 to-slate-950 p-4 sm:p-6" aria-label="Estado de la orquesta">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><div className="flex items-center gap-2 text-xs text-amber-200"><Radio className="h-3.5 w-3.5" aria-hidden="true" /><span>{fresh ? "Reportes conectados" : "Sin señal reciente verificada"}</span></div><p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-300">Cada cuenta conserva sus permisos, métricas y aprendizaje. Una fuente descubierta aún necesita derechos y revisión antes de producir o publicar.</p></div>
        <p className="text-xs text-slate-500">Evidencia de origen<br /><span className="text-slate-300">{at(data.sourceFreshness.reportedAt)}</span></p>
      </div>
      {!fresh && <p role="status" className="mt-3 text-xs text-amber-100">Los datos siguientes son históricos o no están confirmados. No acreditan actividad actual.</p>}
      <Reasons reasons={data.sourceFreshness.heldReasons} />
      <dl className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[["Destinos configurados", data.accounts.length], ["Activos aptos por destino", sum("eligibleAssets")], ["Programados o publicados con recibo", sum("confirmedScheduledOrPublished")], ["Promociones registradas", data.learning.promotions]].map(([label, value]) => <div key={String(label)} className="rounded-xl border border-white/5 bg-black/20 p-3"><dt className="text-[11px] text-slate-400">{label}</dt><dd className="mt-1 text-xl font-semibold tracking-tight text-white">{number(value as number | null)}</dd></div>)}
      </dl>
    </section>
    <Tabs defaultValue="team">
      <TabsList aria-label="Área Clippers" className="grid h-auto w-full grid-cols-2 gap-1 bg-slate-900 p-1 sm:grid-cols-4">
        <TabsTrigger value="team">Equipo y vida</TabsTrigger><TabsTrigger value="accounts">Cuentas y métricas</TabsTrigger><TabsTrigger value="sources">Fuentes y tendencias</TabsTrigger><TabsTrigger value="learning">Aprendizaje</TabsTrigger>
      </TabsList>
      <TabsContent value="team" className="mt-4 space-y-3">
        <p className="text-xs leading-relaxed text-slate-400">La vida y los puntos proceden del historial real de la oficina. Un latido, un puesto configurado o una ejecución sin material no son éxitos ni mejoras.</p>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{CLIPPERS_AGENTS.map(agent => <AgentCard key={agent.id} agent={agent} role={data.roles.find(role => role.id === agent.id)} fresh={fresh} now={now} />)}</div>
      </TabsContent>
      <TabsContent value="accounts" className="mt-4 space-y-4">
        <p className="text-xs text-slate-400">Una conexión observada no sustituye un permiso de publicación. Las métricas se agrupan por su edad real, por destino.</p>
        {data.accounts.map(account => <article key={account.key} className="rounded-2xl border border-white/10 bg-slate-950/70 p-4" data-testid={`clippers-account-${account.key}`}>
          <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-semibold text-white">{account.label}</h3><p className="mt-1 break-all text-xs text-slate-400">{account.network === "tiktok" ? "TikTok" : "Facebook"} · {account.account} · marca {account.brandId}</p></div><span className={`rounded-full border px-2 py-1 text-[11px] ${stateTone(account.connection === "observed" && fresh ? "completed" : "held")}`}>{account.connection === "observed" ? "Conexión observada" : account.connection === "disconnected" ? "Desconectada" : "Conexión sin verificar"}</span></div>
          <p className="mt-2 text-xs text-slate-500">Observación de conexión: {at(account.observedAt)}</p>
          <section className="mt-3 rounded-xl border border-white/5 bg-white/[0.02] p-3" data-testid={`clippers-analytics-${account.key}`}>
            <h4 className="text-sm font-medium text-slate-200">Analítica de la cuenta · publicaciones de 7 días</h4>
            <p className="mt-1 text-[11px] text-slate-500">{account.analytics?.status === "observed" ? "Última lectura observada" : account.analytics?.status === "held" ? "Lectura en espera; vigencia sin confirmar" : "Aún no disponible"} · {at(account.analytics?.observedAt ?? null)}</p>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-3"><div><dt className="text-slate-500">Publicaciones observadas</dt><dd className="mt-1 text-slate-200">{number(account.analytics?.posts ?? null)}</dd></div><div><dt className="text-slate-500">Views acumuladas de estos posts</dt><dd className="mt-1 text-slate-200">{number(account.analytics?.totalViews ?? null)}</dd></div><div><dt className="text-slate-500">Edad de los posts al leer los datos</dt><dd className="mt-1 text-slate-200">{account.analytics?.actualAgeHoursMin === null || account.analytics?.actualAgeHoursMin === undefined || account.analytics.actualAgeHoursMax === null ? "Sin medir" : `${account.analytics.actualAgeHoursMin.toFixed(1)}–${account.analytics.actualAgeHoursMax.toFixed(1)} h`}</dd></div></dl>
            <p className="mt-2 text-[11px] text-slate-500">Las views son acumuladas de las publicaciones leídas; esta lectura no constituye una comparación de crecimiento.</p><Reasons reasons={account.analytics?.heldReasons ?? ["account_analytics_unavailable"]} />
          </section>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">{[["Meta diaria", account.dailyTarget], ["Activos aptos", account.eligibleAssets], ["Con recibo", account.confirmedScheduledOrPublished], ["Pendientes para la meta", account.shortfall]].map(([label, value]) => <div key={String(label)}><dt className="text-slate-500">{label}</dt><dd className="mt-1 text-slate-200">{number(value as number | null)}</dd></div>)}</dl>
          <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[680px] text-left text-xs"><caption className="mb-2 text-left text-slate-400">Observaciones controladas para aprendizaje · por edad real</caption><thead><tr className="border-b border-white/10 text-slate-500"><th scope="col" className="py-2">Ventana</th><th scope="col">Muestras</th><th scope="col">Edad real</th><th scope="col">Views</th><th scope="col">Likes</th><th scope="col">Comentarios</th><th scope="col">Compartidos</th><th scope="col">Última observación</th></tr></thead><tbody>{account.metricAgeBuckets.map(bucket => <tr key={bucket.windowHours} className="border-b border-white/5 text-slate-300"><th scope="row" className="py-2 font-normal">{bucket.windowHours} h</th><td>{number(bucket.samples)}</td><td>{bucket.actualAgeHoursMin === null ? "Sin muestra" : `${bucket.actualAgeHoursMin.toFixed(1)}–${bucket.actualAgeHoursMax?.toFixed(1) ?? "?"} h`}</td><td>{bucket.samples ? number(bucket.views) : "Sin muestra"}</td><td>{bucket.samples ? number(bucket.likes) : "Sin muestra"}</td><td>{bucket.samples ? number(bucket.comments) : "Sin muestra"}</td><td>{bucket.samples ? number(bucket.shares) : "Sin muestra"}</td><td>{at(bucket.latestObservedAt)}</td></tr>)}{account.metricAgeBuckets.length === 0 && <tr><td colSpan={8} className="py-3 text-slate-500">No hay métricas observadas para esta cuenta.</td></tr>}</tbody></table></div>
          <p className="mt-3 text-xs text-slate-500">Política: {account.activeVersion ?? "sin versión activa confirmada"} · {account.policyStatus === "unmeasured_baseline" ? "Línea base sin medición" : "Estado de política sin verificar"}</p><Reasons reasons={account.heldReasons} />
        </article>)}
        {data.disconnectedDestinations.map(destination => <article key={destination.brandId} className="rounded-xl border border-amber-200/15 p-4 text-sm"><h3 className="font-semibold text-amber-100">{destination.label} · sin redes conectadas</h3><p className="mt-1 text-xs text-slate-400">Marca {destination.brandId}. No se inventa una cuenta o red para este destino.</p><Reasons reasons={[destination.reason]} /></article>)}
      </TabsContent>
      <TabsContent value="sources" className="mt-4 space-y-4">
        <ClippersViralScout scout={data.discovery.scout} now={now} fresh={fresh} />
        <div className="rounded-2xl border border-amber-200/15 p-4"><h3 className="font-semibold text-white">Descubrimiento de varios streamers</h3><p className="mt-2 text-sm text-slate-400">{number(data.discovery.observations)} observaciones · {number(data.discovery.eligibleAssets)} activos con autorización verificada. {data.discovery.catalogVersion === 2 ? "Presupuesto configurado: hasta 14 lecturas RSS oficiales al día, con 13 canales prioritarios y una exploración rotativa. Son metadatos públicos; los derechos siguen pendientes." : `La rotación configurada es de ${data.discovery.rotationSize} fuentes cada ${data.discovery.rotationDays} días.`} Los horarios configurados no demuestran una ejecución.</p></div>
        <div className="grid gap-3 sm:grid-cols-2">{data.discovery.sources.map(source => <article key={source.creatorId} className="min-w-0 rounded-xl border border-white/10 p-4"><h3 className="break-all text-sm font-semibold text-white">{source.creatorId}</h3><a href={`https://www.youtube.com/channel/${source.channelId}`} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-xs text-amber-200 underline underline-offset-4">Identidad del canal de origen</a><p className="mt-2 text-xs text-slate-300">{source.status === "observed" ? "Fuente observada" : source.status === "unavailable" ? "Fuente no disponible" : "Aún no observada"} · {number(source.observations)} observaciones</p><p className="mt-1 text-xs text-slate-500">{at(source.observedAt)}</p><Reasons reasons={source.heldReasons} /></article>)}</div>
        <section className="rounded-2xl border border-white/10 p-4" aria-label="Tendencias medidas"><h3 className="font-semibold text-white">Tendencias con procedencia</h3><p className="mt-1 text-xs text-slate-400">Una primera muestra crea una referencia; solo observaciones pareadas permiten calcular crecimiento. Ninguna señal concede derechos de uso.</p><div className="mt-3 space-y-3">{data.discovery.signals.map(signal => <article key={`${signal.creatorId}:${signal.videoId}`} className="rounded-xl bg-white/[0.03] p-3"><p className="break-all text-sm text-slate-200">{signal.creatorId} · {signal.videoId}</p><p className="mt-1 text-xs text-slate-400">Views observadas: {number(signal.views)}{signal.previousObservedAt ? ` · muestra anterior: ${number(signal.previousViews)} (${at(signal.previousObservedAt)})` : ""}</p><p className="mt-1 text-xs text-slate-400">{signal.label === "paired_growth_observed" ? `Crecimiento observado: ${number(signal.growthViews)} views · ${number(signal.growthPerHour)} por hora` : signal.label === "initial_baseline" ? "Primera observación; crecimiento aún sin medir" : signal.label === "stale_reference" ? "Referencia anterior obsoleta; crecimiento sin confirmar" : "Métricas insuficientes para medir crecimiento"}</p><p className="mt-1 text-[11px] text-slate-500">Publicación de origen: {at(signal.publishedAt)} · observada: {at(signal.observedAt)}</p><p className="mt-2 text-[11px] text-amber-100">Derechos pendientes de revisión del propietario</p></article>)}{data.discovery.signals.length === 0 && <p className="text-sm text-slate-500">Todavía no hay señales de tendencia verificadas.</p>}</div></section>
      </TabsContent>
      <TabsContent value="learning" className="mt-4 space-y-4">
        <section className="rounded-2xl border border-white/10 bg-slate-950/70 p-4"><div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-amber-200" aria-hidden="true" /><h3 className="font-semibold text-white">Mejorar exige medir y comparar</h3></div><p className="mt-2 text-sm leading-relaxed text-slate-400">El ciclo usa los renderizados, recibos y observaciones reales del publicador. No cambia una política por completar un turno ni por disponer de un motor nuevo.</p><ol className="mt-4 grid gap-3 text-xs sm:grid-cols-3"><li className="rounded-xl border border-white/5 p-3"><strong className="block text-amber-100">1 · Evidencia equivalente</strong><span className="mt-1 block text-slate-400">Misma cuenta, una variable, versiones y manifiestos exactos, recibos de render y edades comparables.</span></li><li className="rounded-xl border border-white/5 p-3"><strong className="block text-amber-100">2 · Comparaciones independientes</strong><span className="mt-1 block text-slate-400">{data.learning.requiredComparisons} experimentos; al menos {data.learning.minimumPerArm} publicaciones por grupo, sin reutilizar posts. El objetivo de views exige {(data.learning.improvementThreshold * 100).toFixed(0)}% de mejora, sin regresiones; al menos dos experimentos deben mejorar la finalización.</span></li><li className="rounded-xl border border-white/5 p-3"><strong className="block text-amber-100">3 · Revisión antes de activar</strong><span className="mt-1 block text-slate-400">La promoción de parámetros de edición requiere revisión manual y conserva la evidencia para volver a la versión anterior.</span></li></ol><p className="mt-4 text-sm text-slate-200">Comparaciones elegibles: {number(data.learning.eligibleComparisons)} · Promociones registradas: {number(data.learning.promotions)}</p>{data.learning.promotions === 0 && data.learning.eligibleComparisons === 0 && <p className="mt-2 text-sm text-amber-100" data-testid="clippers-no-improvements">Todavía no hay comparaciones elegibles ni promociones verificadas en este ciclo.</p>}<Reasons reasons={data.learning.heldReasons} /></section>
        <section className="rounded-2xl border border-amber-200/15 p-4" aria-label="Selección de creadores" data-testid="clippers-creator-selection">
          <h3 className="font-semibold text-white">Preferencia de creadores por cuenta y formato</h3>
          <p className="mt-2 text-xs text-slate-400">Tres lotes independientes de 5 + 5 publicaciones comparables requieren al menos 20% más views, calidad directa disponible y ausencia de regresión de costo o tiempo. La preferencia ordena activos autorizados; los límites diarios y permisos siguen vigentes.</p>
          <p className="mt-2 text-xs text-slate-500">Evaluación: {at(data.creatorSelection?.evaluatedAt ?? null)} · Asignaciones registradas: {number(data.creatorSelection?.assigned ?? null)}</p>
          <Reasons reasons={data.creatorSelection?.heldReasons ?? ["creator_selection_report_unavailable"]} />
          {!data.creatorSelection?.preferences.length && <p className="mt-3 text-sm text-amber-100">Selección sin medir: todavía no hay evidencia comparable suficiente.</p>}
          {data.creatorSelection?.preferences.map(preference => { const live = fresh && preference.status === "preferred" && !!preference.expiresAt && Date.parse(preference.expiresAt) > now; return <article key={preference.scopeKey} className="mt-3 rounded-xl border border-white/10 p-3 text-xs">
            <p className="break-all font-medium text-slate-200">{preference.destination.network} · {preference.destination.account} · {preference.format} · {preference.language}</p>
            <p className="mt-1 text-slate-400">{preference.context} · {preference.postingBand} (franja de 1 h, Nueva York) · muestras de {preference.windowHours} h</p>
            <p className="mt-2 text-amber-100">{live ? `Preferencia con evidencia: ${preference.preferredCreatorGroupId}` : `Referencia sin preferencia vigente: ${preference.baselineCreatorGroupId}`}</p>
            <p className="mt-1 text-slate-500">{preference.eligibleSamples} muestras elegibles · Caduca: {at(preference.expiresAt)}</p><Reasons reasons={[live ? preference.reason : preference.status === "preferred" ? "creator_preference_freshness_unverified" : preference.reason]} />
          </article>; })}
        </section>
        {data.learning.comparisons.map(comparison => <article key={comparison.id} className="rounded-xl border border-white/10 p-4 text-xs"><h3 className="break-all font-semibold text-slate-200">{comparison.destination} · {comparison.variable}</h3><p className="mt-2 text-slate-400">{comparison.baselineVersion} → {comparison.candidateVersion} · control {comparison.controlSamples} / candidato {comparison.candidateSamples}</p><p className="mt-1 text-slate-400">{comparison.renderReceiptVerified ? "Recibos de render verificados" : "Falta verificar el render"} · {fresh && comparison.current ? "Comparación vigente" : "Comparación histórica"} · {!fresh ? "Elegibilidad sin verificar" : comparison.eligible ? "Elegible para revisión" : "En espera"}</p><Reasons reasons={comparison.heldReasons} /></article>)}
      </TabsContent>
    </Tabs>
    <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4 text-xs text-slate-500"><span>KONG y Black Room quedan fuera de este portafolio. Esta vista no publica ni modifica permisos.</span><Link href="/clippers" className="inline-flex items-center gap-1 text-amber-200 underline underline-offset-4">Abrir herramientas de Clippers <ArrowUpRight className="h-3 w-3" aria-hidden="true" /></Link></footer>
  </div>;
}

function OrchestraData({ sessionScope }: { sessionScope: string }) {
  const [, setClock] = useState(0);
  const query = useQuery<ClippersOrchestraStatus>({
    queryKey: [CLIPPERS_ORCHESTRA_ENDPOINT, sessionScope],
    queryFn: async ({ signal }) => {
      const response = await fetch(CLIPPERS_ORCHESTRA_ENDPOINT, { signal, credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "access" : "unavailable");
      const data = parseClippersOrchestraStatus(await response.json());
      if (!data) throw new Error("invalid");
      return data;
    },
    gcTime: 0, staleTime: 0, retry: false, refetchOnMount: "always", refetchInterval: 60_000, refetchOnWindowFocus: false, refetchOnReconnect: false,
  });
  const data = query.isError ? undefined : query.data;
  useEffect(() => {
    if (!data) return;
    const deadlines = [Date.parse(data.transport.lastIngestAt || "") + data.transport.maxAgeMs, Date.parse(data.sourceFreshness.reportedAt || "") + data.sourceFreshness.staleAfterMinutes * 60_000, ...data.roles.map(role => Date.parse(role.activeUntil || "")), ...(data.creatorSelection?.preferences ?? []).map(preference => Date.parse(preference.expiresAt || ""))];
    const timers = deadlines.filter(time => Number.isFinite(time) && time >= Date.now()).map(time => window.setTimeout(() => setClock(value => value + 1), Math.max(0, time - Date.now() + 1)));
    return () => timers.forEach(timer => window.clearTimeout(timer));
  }, [data]);
  return <>
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500"><span className="inline-flex items-center gap-1"><Clock3 className="h-3 w-3" aria-hidden="true" />Consulta de solo lectura · cada minuto mientras esta área está abierta</span><Button variant="outline" size="sm" disabled={query.isFetching} onClick={() => void query.refetch()} data-testid="clippers-refresh"><RefreshCw className="mr-2 h-3 w-3" aria-hidden="true" />{query.isFetching ? "Actualizando…" : "Actualizar evidencia"}</Button></div>
    {query.isPending && <p role="status" className="py-10 text-sm text-slate-400">Consultando reportes, cuentas y carreras reales…</p>}
    {query.isError && <div role="alert" className="rounded-xl border border-amber-200/20 p-4 text-sm text-amber-100">{query.error.message === "access" ? "Solo el propietario puede consultar esta área." : "No se pudo verificar la orquesta de Clippers. No se presenta actividad anterior como actual."}</div>}
    {data && <ClippersOfficeReport data={data} now={Date.now()} />}
  </>;
}

export function ClippersOfficeArea({ ownerId }: { ownerId: string }) {
  const [open, setOpen] = useState(false);
  const router = useQuery<SupervisorAuth>({ queryKey: ["auth-me"], enabled: false });
  const verified = useQuery<SupervisorAuth>({ queryKey: ["clippers-orchestra-auth", ownerId], queryFn: async () => (await apiRequest("GET", "/api/auth/me")).json(), enabled: open && router.data?.user?.id === ownerId && !router.isFetching, gcTime: 0, staleTime: 0, retry: false, refetchOnMount: "always" });
  const session = kongSupervisorSessionScope(router.data, verified.data, router.isFetching, verified.isFetching, verified.isError, router.isError);
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button type="button" variant="outline" className="rounded-xl border-amber-200/30 bg-slate-950/95 px-3 py-2 text-xs font-semibold text-amber-100 hover:bg-slate-800" data-testid="open-clippers-office"><Clapperboard className="mr-1.5 h-4 w-4" aria-hidden="true" />Área Clippers</Button></DialogTrigger>
    <DialogContent data-testid="clippers-office-dialog" className="z-[250] max-h-[90dvh] w-[calc(100%-1rem)] min-w-0 max-w-6xl grid-cols-[minmax(0,1fr)] overflow-x-hidden overflow-y-auto border-white/10 bg-[#090d15] p-4 text-slate-200 sm:p-6">
      <DialogHeader className="pr-7 text-left"><p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-amber-300">Estudio / Clippers</p><DialogTitle className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">Una orquesta, con trabajo verificable</DialogTitle><DialogDescription className="text-slate-400">Cuentas, fuentes, agentes y aprendizaje en su propia área. Cada estado se apoya en evidencia del ejecutor; esta vista no inicia trabajos.</DialogDescription></DialogHeader>
      {open && session && session === ownerId ? <OrchestraData key={session} sessionScope={session} /> : open ? <p role="status" className="py-8 text-sm text-slate-400">Verificando la sesión del propietario…</p> : null}
    </DialogContent>
  </Dialog>;
}
