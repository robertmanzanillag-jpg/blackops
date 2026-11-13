import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { OFFICE_KONG_CITY_TASKS, scoreOfficeKongSnapshot } from "@shared/office-kong-supervisor";
import { officeCitySnapshotExpiresAt } from "@/lib/office-city-agents";
import type { OfficeKongAuditResult } from "../../../server/office-kong";
import type { OfficeKongCollaboration } from "../../../server/office-kong-collaboration";
import { kongSupervisorSessionScope, type SupervisorAuth } from "./kong-supervisor-session";
import { OfficeBusinessHistory } from "./office-business-history";

type Probe = { status: "ready" | "blocked"; reason: string; checkedAt: string };
type Run = { id: string; key: string; kind: string; status: string; source?: "scheduled"; text?: string; createdAt: string; completedAt?: string; sessionId?: string; evidence?: OfficeKongAuditResult["evidence"]; error?: { reason: string }; review?: { verdict: string; headSha: string } };
type InternalHistory = {jobs:Array<{id:string;role:string;status:string;startedAt:string;completedAt?:string;reason?:string;artifact?:{text:string}}>;
  roleWork?:Array<{id:string;role:string;status:string;startedAt:string;reason?:string;artifactId?:string;webAudit?:{scope:string;selected:number;total:number|null;diagnostics:string[];counts:Record<string,number>};audit?:{scope:string;selected:number;total:number|null;findings:Array<{code:string;detail:string}>;metrics:Record<string,number>}}>;
  roleAcademy?:Array<{role:string;status:string;completedPairs:number;candidateQualified:boolean;reason?:string;productionBlocker:string;comparisons:Array<{id:string;candidate:{quality:number};incumbent:{quality:number}}>}>;
  capabilityTraining?:{policies:Array<{role:string;policyVersion:string;status:string;lessons:string[];scope:string;promptLabel?:string;instructionCorrected?:boolean;lifecycle?:{life:number;status:string;capabilityStatus:string;blockedReason?:string;retiredAt?:string;firstVerifiedRunId?:string;currentGenerationMatches?:boolean}}>;runs:Array<{id:string;role:string;kind:string;status:string;quality?:number;costUsd?:number;reason?:string;promptLabel?:string;instructionCorrected?:boolean}>};
  academy:Array<{id:string;agentId:string;purpose?:string;policyCurrentlyApplied?:boolean;status:string;startedAt:string;reason?:string;benchmarkId:string;assessment?:{passed:boolean;quality:number;incumbentQuality:number;scope:string}}>};
async function readOffice<T>(url:string):Promise<T> { const response=await apiRequest("GET",url);return response.json(); }
const statuses: Record<string, string> = { accepted: "Registrada", pending: "Registrada", running: "En ejecucion", completed: "Completada", blocked: "Bloqueada", failed: "Fallo", unknown: "Resultado sin confirmar" };
const agentStates: Record<string, string> = { healthy: "Evidencia vigente", running: "En ejecucion", attention: "Necesita atencion", stale: "Evidencia antigua", unknown: "Sin evidencia", disabled: "Deshabilitado", idle: "Disponible bajo demanda" };
const categoryNames: Record<string, string> = { clubs: "Clubs", vip: "VIP", restaurants: "Restaurantes", events: "Eventos", sports: "Deportes", experiences: "Experiencias", media: "Imagenes", discovery: "Descubrimiento" };
const qualityChecks = { events: "Calendarios y eventos", media: "Flyers e imágenes", vip: "Fuentes de reservas VIP" } as const;

export function OfficeConnectionsPanel() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [prUrl, setPrUrl] = useState("");
  const [clock, setClock] = useState(Date.now);
  const routerAuth=useQuery<SupervisorAuth>({queryKey:["auth-me"],enabled:false});
  const routerId=routerAuth.data?.user?.id || null;
  const verifiedAuth=useQuery({queryKey:["office-history-auth",routerId],queryFn:()=>readOffice<SupervisorAuth>("/api/auth/me"),enabled:open && Boolean(routerId) && !routerAuth.isFetching,staleTime:0,gcTime:0,refetchOnMount:"always",retry:false});
  const sessionScope=kongSupervisorSessionScope(routerAuth.data,verifiedAuth.data,routerAuth.isFetching,verifiedAuth.isFetching,verifiedAuth.isError,routerAuth.isError);
  // Retain the same key after an uncertain HTTP outcome; no duplicate dispatch.
  const pending = useRef<{ signature: string; key: string } | undefined>(undefined);
  const connections = useQuery<{ claude?: Probe; worker?: Probe; workerEnabled?: boolean; reviewOnly?: boolean }>({ queryKey: ["/api/agents-office/connections"], enabled: open, staleTime: 30_000, refetchInterval: query => query.state.data?.workerEnabled === false ? false : 30_000 });
  const fresh = (probe?: Probe) => !connections.isError && Boolean(probe && Date.now() - Date.parse(probe.checkedAt) >= -30_000 && Date.now() - Date.parse(probe.checkedAt) < 90_000);
  const workerReady = fresh(connections.data?.worker) && connections.data?.worker?.status === "ready";
  const historyKey=["office-history",sessionScope];
  const runs = useQuery<Run[]>({ queryKey: historyKey, queryFn:()=>readOffice<Run[]>("/api/agents-office/runs"), enabled: open && Boolean(sessionScope), staleTime:0,gcTime:0,refetchInterval: 5_000 });
  const internal=useQuery<InternalHistory>({queryKey:["office-internal-history",sessionScope],queryFn:()=>readOffice<InternalHistory>("/api/agent-council/internal-work"),enabled:open && Boolean(sessionScope),staleTime:0,gcTime:0,refetchInterval:30_000,retry:false});
  const visibleRuns=sessionScope && !runs.isError ? runs.data:undefined;
  const visibleInternal=sessionScope && !internal.isError ? internal.data:undefined;
  const internalJobs=Array.isArray(visibleInternal?.jobs)?visibleInternal.jobs:[];
  const academyJobs=Array.isArray(visibleInternal?.academy)?visibleInternal.academy:[];
  const snapshot = useQuery<OfficeKongAuditResult & { collaboration?: OfficeKongCollaboration }>({ queryKey: ["/api/agents-office/kong-snapshot"], enabled: open, staleTime: 45_000, refetchInterval: 60_000, retry: false });
  const mutation = useMutation({
    mutationFn: async (input: { kind: string; message?: string; prUrl?: string }) => {
      if(!sessionScope) throw new Error("Verified session required");
      const scope=sessionScope;
      const signature = JSON.stringify({scope,input});
      if (!pending.current || pending.current.signature !== signature) pending.current = { signature, key: crypto.randomUUID() };
      const response = await apiRequest("POST", "/api/agents-office/runs", { ...input, key: pending.current.key });
      return {run:await response.json() as Run,scope};
    },
    onSuccess: ({run,scope}) => {
      pending.current = undefined;
      queryClient.setQueryData<Run[]>(["office-history",scope], previous => [run, ...(previous || []).filter(item => item.id !== run.id)]);
      void queryClient.invalidateQueries({ queryKey: ["office-history",scope] });
    },
  });
  const isActive = (run: Run) => ["accepted", "pending", "running"].includes(run.status);
  const busy = mutation.isPending || visibleRuns?.some(run => run.source !== "scheduled" && isActive(run));
  const enabled = Boolean(sessionScope) && workerReady && fresh(connections.data?.claude) && connections.data?.claude?.status === "ready";
  const kongEvidence = snapshot.isError ? undefined : snapshot.data?.evidence;
  const nextExpiry = officeCitySnapshotExpiresAt(kongEvidence, clock);
  useEffect(() => {
    if (!open || nextExpiry === undefined) return;
    const delay = nextExpiry - Date.now();
    if (delay < 0) { setClock(Date.now()); return; }
    if (delay > 330_000) return;
    const timer = window.setTimeout(() => setClock(Date.now()), delay + 1);
    return () => window.clearTimeout(timer);
  }, [open, nextExpiry]);
  const supervision = scoreOfficeKongSnapshot(kongEvidence);
  const kongAgents = kongEvidence?.agents;
  const kongEvidenceFresh = supervision.verified;
  const collaboration = kongEvidenceFresh ? snapshot.data?.collaboration : undefined;
  const teams = supervision.cities.filter(city => city.points !== null && city.scoredCategories === city.totalCategories)
    .sort((a, b) => (b.points ?? 0) - (a.points ?? 0) || a.name.localeCompare(b.name));
  return (
    <aside className={`absolute right-3 top-16 z-[110] rounded-xl border border-cyan-200/25 bg-[#080d18]/95 px-2.5 py-1 text-white shadow-xl backdrop-blur ${open ? "w-[min(340px,calc(100vw-1.5rem))]" : "w-fit"}`} aria-label="Conexiones reales de la oficina">
      <div className="flex items-center justify-between gap-3">
        {open && <h2 className="text-sm font-semibold">Trabajo real de agentes</h2>}
        <Button aria-expanded={open} size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => { setClock(Date.now()); setOpen(!open); }}>{open ? "Minimizar" : "Trabajo real"}</Button>
      </div>
      {open && <div className="mt-2 max-h-[34dvh] space-y-3 overflow-y-auto overscroll-contain pb-2 pr-1">
        <OfficeBusinessHistory sessionScope={sessionScope} ownerId={routerId}/>
      <OfficeBusinessHistory sessionScope={sessionScope} ownerId={routerId} kind="editorial"/>
      <OfficeBusinessHistory sessionScope={sessionScope} ownerId={routerId} kind="revenue"/>
        {connections.isError && <p role="alert" className="text-sm text-amber-200">No se pudo comprobar el acceso a Claude y su ejecutor.</p>}
        {!connections.data && !connections.isError && <p className="text-sm text-slate-300">Comprobando conexiones…</p>}
        {connections.data && (["worker", "claude"] as const).map(name => {
          const probe = connections.data[name];
          return <div key={name} className="rounded-xl border border-white/10 p-3">
            <p className="text-sm font-semibold">{name === "claude" ? "Claude" : "Ejecutor"} · {fresh(probe) && probe?.status === "ready" ? (name === "claude" ? "Inicio de sesion configurado" : "Ejecutor responde") : "Pendiente de conexion"}</p>
            <p className="mt-1 text-xs leading-5 text-slate-300">{probe?.reason || "Estado pendiente de verificación."}</p>
            {probe?.checkedAt && <p className="text-[10px] text-slate-500">Comprobado: {new Date(probe.checkedAt).toLocaleString()}</p>}
          </div>;
        })}
        <div className="space-y-1">
          <Button disabled={snapshot.isFetching} onClick={() => void snapshot.refetch()}>Consultar agentes de KONG</Button>
          {snapshot.isError && <p role="alert" className="text-xs text-amber-200">No se pudo consultar la actividad registrada de KONG.</p>}
          {snapshot.isLoading && <p className="text-xs text-slate-300">Consultando KONG…</p>}
        </div>
        {kongAgents?.map(agent => <div key={agent.id} className="rounded-lg border border-white/10 p-2 text-xs">
          <p className="font-semibold">{agent.name} · {kongEvidenceFresh ? (agentStates[agent.state] || agent.state) : "Evidencia caducada"}</p>
          <p className="mt-1 text-slate-400">Ultima ejecucion: {agent.lastRunAt ? new Date(agent.lastRunAt).toLocaleString() : "Sin evidencia"}</p>
          {agent.blocker && <p className="mt-1 text-amber-200">{agent.blocker}</p>}
        </div>)}
        <details className="rounded-lg border border-cyan-200/20 p-2 text-xs" data-testid="office-kong-supervisor">
          <summary className="cursor-pointer font-semibold">Supervisor de KONG</summary>
          <p className="mt-2 text-slate-300">Revisa las siete categorías por ciudad. Los puntos se calculan sobre la última auditoría: descuenta fallos, atrasos y trabajos vencidos. Esperar el próximo turno no resta puntos.</p>
          {!supervision.verified && <p className="mt-2 text-amber-200">Sin auditoría vigente. Aún no se pueden asignar puntos.</p>}
          {supervision.verified && <div className="mt-2 space-y-1">
            <p className="text-slate-400">Última revisión: {supervision.snapshotAt ? new Date(supervision.snapshotAt).toLocaleString() : "Sin registro"}</p>
            {supervision.countries.map(country => <p key={country.countryCode}><strong>{country.countryCode}</strong> · {country.points === null ? "Sin puntuación" : `${country.points}/100`} · {country.scoredCategories}/{country.totalCategories} verificados</p>)}
          </div>}
        </details>
        <details className="rounded-lg border border-cyan-200/20 p-2 text-xs" data-testid="office-kong-teams">
          <summary className="cursor-pointer font-semibold">Clasificación de ciudades</summary>
          <p className="mt-2 text-slate-300">Puntaje operativo sobre 100, basado en las ejecuciones de los siete puestos. La calidad del catálogo se revisa por separado.</p>
          {teams.length === 0 && <p className="mt-2 text-slate-400">Todavía no hay equipos con evidencia completa para clasificar.</p>}
          {teams.length > 0 && <ol className="mt-2 space-y-1">
            {teams.map(team => <li key={team.id}>{teams.findIndex(entry => entry.points === team.points) + 1}. {team.name} · {team.points}/100</li>)}
          </ol>}
          {supervision.verified && supervision.cities.length > teams.length && <p className="mt-2 text-slate-400">Equipos pendientes de verificación completa: {supervision.cities.length - teams.length}.</p>}
        </details>
        <details className="rounded-lg border border-cyan-200/20 p-2 text-xs" data-testid="office-kong-catalog-quality">
          <summary className="cursor-pointer font-semibold">Calidad del catálogo por ciudad</summary>
          <p className="mt-2 text-slate-300">Los informes indican qué revisó cada puesto y si dejó avisos. La cobertura total y la exactitud de cada precio de entrada todavía requieren medición por evento.</p>
          {!supervision.verified && <p className="mt-2 text-amber-200">Sin informes vigentes para comparar ciudades.</p>}
          {supervision.verified && <ul className="mt-2 space-y-2">
            {supervision.cities.map(city => <li key={city.id} className="border-t border-white/10 pt-2">
              <strong>{city.name}</strong>
              {city.categories.filter(category => Object.hasOwn(qualityChecks, category.category)).map(category => <p key={category.category} className="mt-1 text-slate-300">
                {qualityChecks[category.category as keyof typeof qualityChecks]} · {category.reason}
              </p>)}
            </li>)}
          </ul>}
        </details>
        <details className="rounded-lg border border-cyan-200/20 p-2 text-xs" data-testid="office-kong-team-review">
          <summary className="cursor-pointer font-semibold">Mesa de equipos · propuestas para el CEO</summary>
          <p className="mt-2 text-slate-300">El supervisor señala incidencias registradas y Operaciones propone cómo revisarlas.</p>
          <a href="https://kongnightlife.com/admin/ceo" className="mt-2 inline-block text-cyan-200 underline">Abrir la revisión semanal y la memoria del CEO</a>
          {!collaboration?.verified && <p className="mt-2 text-amber-200">Sin auditoría vigente para generar propuestas.</p>}
          {collaboration?.verified && collaboration.totalFindings === 0 && <p className="mt-2 text-slate-400">La última revisión no registró incidencias que requieran una propuesta.</p>}
          {collaboration?.verified && collaboration.exchanges.map(exchange => <article key={exchange.id} className="mt-2 border-t border-white/10 pt-2">
            <p className="font-semibold">{kongEvidence?.cities?.find(city => city.id === exchange.cityId)?.name ?? exchange.cityId} · {categoryNames[exchange.category] ?? exchange.category}</p>
            <time className="text-slate-400" dateTime={exchange.evidenceAt}>{new Date(exchange.evidenceAt).toLocaleString()}</time>
            {exchange.comments.map(comment => <p key={comment.author} className="mt-1"><strong>{comment.author === "supervisor" ? "Supervisor" : "Operaciones"}</strong> · {comment.text}</p>)}
            {exchange.proposal.action === "review_reassignment" && <p className="mt-1 text-amber-200"><strong>Para revisión del CEO</strong> · {exchange.proposal.text}</p>}
          </article>)}
        </details>
        {kongEvidence?.cities && <section aria-label="Agentes de KONG por ciudad" className="space-y-2">
          <h3 className="text-sm font-semibold">{kongEvidence.cities.length} ciudades · {kongEvidence.cities.reduce((count, city) => count + city.categories.length, 0)} agentes por categoria</h3>
          {kongEvidence.cityCoverageComplete === false && <p className="text-xs text-amber-200">Faltan trabajos registrados. Las categorias sin registro no se consideran funcionando.</p>}
          {kongEvidence.cities.map(city => { const score = supervision.cities.find(row => row.id === city.id); return <details key={city.id} className="rounded-xl border border-white/10 p-2 text-xs">
            <summary className="cursor-pointer font-semibold">{city.name} · {city.currency}{score?.points != null ? ` · ${score.points}/100` : ""}</summary>
            <div className="mt-2 space-y-2">{city.categories.map(category => { const grade = score?.categories.find(row => row.category === category.category); return <div key={category.category} className="border-t border-white/10 pt-2">
              <p>{categoryNames[category.category] || category.category} · {!kongEvidenceFresh ? "Evidencia caducada" : grade?.state === "completed_with_warnings" ? "Activo · cobertura con pendientes" : grade?.state === "failed" ? "Falló la última ejecución" : category.state === "running" && grade?.state !== "running" ? "Ejecución sin confirmar" : (agentStates[category.state] || category.state)}</p>
              {grade?.state === "running" && <p className="mt-1 text-emerald-200">{OFFICE_KONG_CITY_TASKS[category.category]}</p>}
              <p className="mt-1 text-slate-400">Ultima ejecucion: {category.lastRunAt ? new Date(category.lastRunAt).toLocaleString() : "Sin evidencia"}</p>
              <p className="text-slate-400">Proxima: {category.nextRunAt ? new Date(category.nextRunAt).toLocaleString() : "Sin programacion comprobada"}</p>
              {grade && <p className="text-slate-400">Supervisor: {grade.points === null ? "Sin puntuación" : `${grade.points}/100${grade.deduction ? ` (−${grade.deduction})` : ""}`} · {grade.reason}</p>}
              {category.issues.map((issue, index) => <p key={index} className="mt-1 text-amber-200">{issue}</p>)}
            </div>; })}</div>
          </details>; })}
        </section>}
        <div className="space-y-2">
          <label htmlFor="office-live-message" className="text-sm">Hablar con Claude</label>
          <textarea id="office-live-message" value={message} onChange={e => setMessage(e.target.value)} maxLength={16000} className="min-h-20 w-full rounded-lg border border-white/15 bg-black/50 p-2 text-sm" placeholder="Escribe una tarea de analisis o una pregunta" />
          <p className="text-xs text-slate-400">Cada respuesta necesita una sesion real registrada de Claude. Este flujo analiza texto; no modifica archivos ni envia mensajes.</p>
          {connections.data?.reviewOnly && <p className="text-xs text-amber-200">Este ejecutor solo revisa codigo. El chat necesita otro ejecutor.</p>}
          <Button disabled={!enabled || connections.data?.reviewOnly || busy || !message.trim()} onClick={() => mutation.mutate({ kind: "claude_chat", message: message.trim() })}>Enviar a Claude</Button>
        </div>
        <div className="space-y-2">
          <label htmlFor="office-live-pr" className="text-sm">Revision independiente de cambios</label>
          <input id="office-live-pr" value={prUrl} onChange={e => setPrUrl(e.target.value)} className="w-full rounded-lg border border-white/15 bg-black/50 p-2 text-sm" placeholder="https://github.com/propietario/repo/pull/123" />
          <Button disabled={!enabled || busy || !prUrl.trim()} onClick={() => mutation.mutate({ kind: "claude_review", prUrl: prUrl.trim() })}>Revisar PR</Button>
        </div>
        {mutation.isError && <p role="alert" className="text-sm text-amber-200">No se confirmo el registro de la tarea. Revisa el historial; volver a enviar la misma solicitud conserva su identificador.</p>}
        {runs.isError && <p role="alert" className="text-sm text-amber-200">No se pudo leer el historial de ejecuciones.</p>}
        <section aria-label="Resultados de agentes" className="space-y-3">
          <h3 className="text-sm font-semibold">Ejecuciones comprobables</h3>
          {runs.isLoading && <p className="text-xs text-slate-300">Leyendo historial guardado…</p>}
          {visibleRuns?.length === 0 && <p className="text-xs text-slate-300">No hay ejecuciones guardadas para esta cuenta.</p>}
          {Array.isArray(visibleRuns) && visibleRuns.slice(0, 15).map(run => <article key={run.id} className="rounded-xl border border-white/10 p-3 text-xs">
            <p className="font-semibold">{run.source === "scheduled" ? "Supervisor KONG" : run.kind === "kong_audit" ? "KONG" : run.kind === "claude_review" ? "Revisor" : "Claude"} · {statuses[run.status] || run.status}</p>
            <p className="mt-1 text-slate-500">{new Date(run.createdAt).toLocaleString()} · {run.id.slice(0, 8)}</p>
            {run.error && <p className="mt-2 text-amber-200">{run.error.reason}</p>}
            {run.text && <p className="mt-2 whitespace-pre-wrap break-words leading-5 text-slate-200">{run.text}</p>}
            {run.review && <p className="mt-2">Revision: {run.review.verdict} · {run.review.headSha.slice(0, 12)}</p>}
            {run.completedAt && <p className="mt-2 text-slate-500">Finalizo: {new Date(run.completedAt).toLocaleString()}</p>}
          </article>)}
        </section>
        <section aria-label="Preparación interna y academia" className="space-y-2">
          <h3 className="text-sm font-semibold">Trabajo interno y formación comprobada</h3>
          {internal.isError && <p className="text-xs text-amber-200">{internal.error.message.startsWith("403:") ? "Este historial requiere acceso del propietario." : "El historial privado no está disponible. No se ha confirmado que esté vacío."}</p>}
          {internal.isLoading && <p className="text-xs text-slate-300">Leyendo preparación guardada…</p>}
          {visibleInternal && internalJobs.length === 0 && <p className="text-xs text-slate-300">Todavía no hay preparaciones internas registradas.</p>}
          {internalJobs.slice().reverse().slice(0,8).map(job=><details key={job.id} className="rounded-lg border border-white/10 p-2 text-xs">
            <summary>{job.role === "ceo" ? "CEO" : job.role === "radio" ? "Radio" : "Asistente"} · {statuses[job.status] || job.status} · {new Date(job.startedAt).toLocaleString()}</summary>
            {job.reason && <p className="mt-2 text-amber-200">{job.reason}</p>}
            {job.artifact && <p className="mt-2 whitespace-pre-wrap break-words">{job.artifact.text}</p>}
          </details>)}
          <p className="text-xs text-slate-400">La preparación interna verifica registros guardados; no demuestra mejora de un candidato.</p>
          {visibleInternal && academyJobs.length === 0 && <p className="text-xs text-slate-300">Sin evaluaciones de academia ejecutadas.</p>}
          {academyJobs.slice(0,8).map(job=><article key={job.id} className="rounded-lg border border-white/10 p-2 text-xs">
            <p>Academia · {job.agentId} · {statuses[job.status] || job.status}</p>
            <p>{job.purpose === "incumbent" ? "Entrenamiento del titular" : "Evaluación de candidato"} · {job.policyCurrentlyApplied ? "Esta política está aplicada actualmente" : "Aplicación de esta política no confirmada"}</p>
            <p className="text-slate-400">{new Date(job.startedAt).toLocaleString()} · {job.benchmarkId}</p>
            {job.reason && <p className="text-amber-200">{job.reason}</p>}
            {job.assessment && <p>Evaluación {job.assessment.scope === "production" ? "de trabajo real" : "de prueba"}: {job.assessment.passed ? "superada" : "no superada"} · versión evaluada {job.assessment.quality}/100 · titular de referencia {job.assessment.incumbentQuality}/100. {job.policyCurrentlyApplied ? "Aplicación registrada; alcance indicado arriba." : "Esta evaluación por sí sola no acredita una promoción."}</p>}
          </article>)}
          <h4 className="text-sm font-semibold">Auditorías de los puestos pendientes</h4>
          {(visibleInternal?.roleWork || []).map(job=><details key={job.id} className="rounded-lg border border-white/10 p-2 text-xs">
            <summary>{job.role} · {statuses[job.status] || job.status} · {new Date(job.startedAt).toLocaleString()}</summary>
            {job.reason && <p className="text-amber-200">{job.reason}</p>}
            {job.audit && <><p>{job.audit.scope}</p><p>Registros: {job.audit.selected} de {job.audit.total ?? "total sin verificar"}</p>{job.audit.findings.map((finding,index)=><p key={index}>{finding.detail}</p>)}{Object.entries(job.audit.metrics).map(([key,value])=><p key={key}>{key}: {value}</p>)}</>}
            {job.webAudit && <><p>{job.webAudit.scope}</p><p>Registros: {job.webAudit.selected} de {job.webAudit.total ?? "total sin verificar"}</p>{job.webAudit.diagnostics.map(code=><p key={code}>{code}</p>)}{Object.entries(job.webAudit.counts).map(([key,count])=><p key={key}>{key}: {count}</p>)}</>}
          </details>)}
          <h4 className="text-sm font-semibold">Formación específica por puesto</h4>
          <p className="text-xs text-slate-400">Ejercicios de interpretación de evidencia. No sustituyen trabajo real ni activan reemplazos por sí solos.</p>
          {(visibleInternal?.capabilityTraining?.runs || []).map(run=><div key={run.id} className="rounded-lg border border-white/10 p-2 text-xs"><strong>{run.role}: {run.kind==="production"?"Revisión de una auditoría real":"Evaluación independiente"}</strong><p className="text-amber-200">{run.promptLabel || "Instrucción anterior: ambigüedad detectada; no demuestra incapacidad"}</p><p>{run.status}{run.quality!==undefined?` · calificación registrada: ${run.quality}/100`:""}{run.costUsd!==undefined?` · costo registrado: $${run.costUsd.toFixed(6)}`:""}</p><p className="text-muted-foreground">{run.reason || "Formación específica en revisión de registros; no acredita publicación ni reemplazo del agente."}</p></div>)}
          {(visibleInternal?.capabilityTraining?.policies || []).filter(p=>p.instructionCorrected && p.lifecycle && p.lifecycle.currentGenerationMatches!==false).map(policy=><div key={`life:${policy.policyVersion}`} className="rounded-lg border border-white/10 p-2 text-xs"><strong>{policy.role}: habilidad de revisión</strong><p>Vida de esta habilidad: {policy.lifecycle!.life}/100 · {policy.lifecycle!.capabilityStatus==="blocked_no_qualified_successor"?"Sin reemplazo apto":policy.lifecycle!.status==="retired"?"Política retirada":policy.lifecycle!.status==="execution_unresolved"?"Ejecución pendiente de verificar":policy.lifecycle!.status==="probation"?"En prueba con trabajo real":policy.lifecycle!.status==="candidate"?"Candidata en evaluación":policy.lifecycle!.status==="rejected"?"Candidata descartada":policy.lifecycle!.status==="superseded"?"Política sustituida":"Política disponible"}</p>{policy.lifecycle!.blockedReason && <p className="text-amber-200">Preparación agotada: hace falta nueva evidencia y formación verificable. No se crea un reemplazo automático.</p>}<p className="text-muted-foreground">Solo revisión de auditorías guardadas; no es la vida del agente completo ni acredita tareas comerciales.</p></div>)}
          {(visibleInternal?.capabilityTraining?.policies || []).filter(p=>p.lessons.length>0).map(policy=><div key={policy.policyVersion} className="rounded-lg border border-white/10 p-2 text-xs"><strong>{policy.role}: {policy.lessons.length} {policy.instructionCorrected?"lecciones basadas en errores":"lecciones históricas de la instrucción anterior"}</strong><p className="text-amber-200">{policy.promptLabel || "Instrucción anterior: ambigüedad detectada; no demuestra incapacidad"}</p><p>{policy.status} · {policy.scope}</p></div>)}
          {(visibleInternal?.roleAcademy || []).map(row=><details key={row.role} className="rounded-lg border border-white/10 p-2 text-xs">
            <summary>{row.role} · {statuses[row.status] || row.status} · {row.completedPairs}/3 comparaciones</summary>
            {row.reason && <p className="text-amber-200">{row.reason}</p>}
            {row.comparisons.map(pair=><p key={pair.id}>Titular: {pair.incumbent.quality}/100 · candidato: {pair.candidate.quality}/100</p>)}
            <p>{row.candidateQualified ? "Superó las comparaciones de prueba; falta validar la capacidad en producción." : "Sin mejora sostenida demostrada para reemplazar al titular."}</p>
          </details>)}
        </section>
      </div>}
    </aside>
  );
}
