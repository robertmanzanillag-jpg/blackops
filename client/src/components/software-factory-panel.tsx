import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { apiRequest } from "@/lib/queryClient";
import type { SoftwareFactoryView, FactoryOfficeReviewLink } from "@shared/software-factory-view";

/** Read-only display of the office reviewer's verdict. Never implies merge or order completion. */
function officeReviewLabel(review: FactoryOfficeReviewLink): string {
  const findings = review.findingsCount ?? 0;
  switch (review.status) {
    case "pass": return "aprobada · 0 hallazgos (sin fusión automática)";
    case "block": return `bloqueada · ${findings} ${findings === 1 ? "hallazgo" : "hallazgos"}`;
    case "pending": return "en cola";
    case "running": return "en curso";
    case "head_mismatch": return "no vinculada: la versión revisada no coincide con la propuesta";
    case "failed": return "sin dictamen verificable";
    case "unavailable": return "no se pudo consultar";
    default: return "no solicitada";
  }
}

const projectFields = [
  ["id", "Identificador de la aplicación"], ["repo", "Repositorio (propietario/nombre)"],
  ["stagingUrl", "Dirección del entorno de ensayo"], ["productionUrl", "Dirección de la aplicación publicada"],
  ["healthUrl", "Dirección de comprobación de salud"], ["testCommand", "Comando de pruebas"],
  ["buildCommand", "Comando de construcción"], ["rollbackCommand", "Comando de recuperación"],
] as const;
const readinessLabels: Record<string, string> = { project_repository_missing: "Falta el repositorio", project_commands_missing: "Faltan comandos de pruebas o recuperación", isolated_environment_missing: "Falta un entorno de ensayo separado", journeys_missing_or_duplicate: "Faltan recorridos únicos de usuario", provider_release_or_recovery_unavailable: "Publicación y recuperación del proveedor todavía sin verificar" };
const endpoint = "/api/software-factory";
const money = (cents: number) => new Intl.NumberFormat("es", { style: "currency", currency: "USD" }).format(cents / 100);
const stages: Record<string, string> = { discover: "Buscar mejoras", build: "Construir", simulate: "Simular usuarios", review: "Revisión independiente", deploy: "Publicar", verify: "Verificar publicación", rollback: "Recuperar versión", evaluate: "Evaluar aprendizaje" };
const statuses: Record<string, string> = { pending: "En cola", running: "En ejecución", completed: "Completado", blocked: "Bloqueado", failed: "Falló", unknown: "Resultado sin confirmar" };

export function SoftwareFactoryPanel() {
  const [open, setOpen] = useState(false);
  const [project, setProject] = useState<Record<string, string>>({});
  const [journeys, setJourneys] = useState("");
  const [fixed, setFixed] = useState("");
  const client = useQueryClient();
  const query = useQuery<SoftwareFactoryView>({ queryKey: [endpoint], enabled: open, staleTime: 0, refetchInterval: false, refetchOnWindowFocus: false, refetchOnReconnect: false, retry: false });
  const mutation = useMutation({
    mutationFn: async (action: { path: "pause" | "budget"; body: { paused: boolean } | { fixedCents: number } }) => {
      await apiRequest("POST", `${endpoint}/${action.path}`, action.body);
    },
    onSuccess: () => { void client.invalidateQueries({ queryKey: [endpoint] }); },
  });
  const registration = useMutation({
    mutationFn: async () => { await apiRequest("POST", `${endpoint}/projects`, { ...project, journeys: journeys.split("\n").map(value => value.trim()).filter(Boolean) }); },
    onSuccess: () => { setProject({}); setJourneys(""); void client.invalidateQueries({ queryKey: [endpoint] }); },
  });
  const data = query.isError ? undefined : query.data;
  const fixedCents = Math.round(Number(fixed) * 100);
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button className="absolute bottom-3 left-3 z-[110] border border-cyan-200/30 bg-slate-950 text-white hover:bg-slate-800" data-testid="open-software-factory">Fábrica de software</Button></DialogTrigger>
    <DialogContent className="z-[250] max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>Fábrica de software</DialogTitle>
        <DialogDescription>Fábrica para mejorar Asistente y su empresa de agentes. Solo créditos existentes de OpenAI, sin pagos ni recargas y sin intervenir en Kong. La conexión del ejecutor de Asistente está pendiente; este panel no la activa. El límite del registro no representa saldo disponible de OpenAI.</DialogDescription>
      </DialogHeader>
      {query.isPending && <p role="status">Comprobando actividad y presupuesto…</p>}
      {query.isError && <div role="alert"><p>No se pudo comprobar la fábrica. La actividad anterior no confirma que siga trabajando.</p><Button variant="outline" onClick={() => void query.refetch()}>Reintentar</Button></div>}
      {mutation.isError && <p role="alert">No se confirmó el cambio. Actualiza el estado antes de reintentarlo.</p>}
      {data && <div className="space-y-5">
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Estado comprobado el <time dateTime={data.checkedAt}>{new Date(data.checkedAt).toLocaleString("es")}</time>. No se actualiza automáticamente; esta información no confirma la actividad actual.</p>
          <Button variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>{query.isFetching ? "Actualizando…" : "Actualizar estado"}</Button>
        </div>
        <section aria-labelledby="factory-state">
          <h3 id="factory-state" className="font-semibold">{data.paused ? "Fábrica pausada" : data.readiness === "available" ? "Ejecutor disponible" : "Necesita preparación"}</h3>
          <p className="text-sm text-muted-foreground">Pausar impide tomar nuevos trabajos; una operación ya iniciada puede terminar.</p>
          <Button className="mt-2" disabled={mutation.isPending || query.isFetching} onClick={() => mutation.mutate({ path: "pause", body: { paused: !data.paused } })}>{data.paused ? "Reanudar cola" : "Pausar cola"}</Button>
          {data.blockers.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">{data.blockers.map(blocker => <li key={blocker}>{blocker}</li>)}</ul>}
          {data.proposal && <div className="mt-3 rounded-lg border p-3 text-sm">
            <p className="font-medium">Modo propuestas (solo revisión, sin publicar): {data.proposal.readiness === "available" ? "disponible" : data.proposal.readiness === "paused" ? "pausado" : "necesita preparación"}</p>
            <p className="text-xs text-muted-foreground">Construye, prueba en GitHub Actions y revisa un PR. No despliega ni publica; la publicación automática sigue bloqueada arriba.</p>
            {data.proposal.blockers.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-5">{data.proposal.blockers.map(blocker => <li key={blocker}>{blocker}</li>)}</ul>}
          </div>}
        </section>
        <section aria-labelledby="factory-budget">
          <h3 id="factory-budget" className="font-semibold">Presupuesto · {data.budget.month}</h3>
          <dl className="mt-2 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            {([["Límite", data.budget.limitCents], ["Costes fijos", data.budget.fixedCents], ["Gastado", data.budget.spentCents], ["Comprometido", data.budget.reservedCents], ["Disponible", data.budget.remainingCents]] as const).map(([label, value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="font-medium">{data.budget.configured || label === "Límite" ? money(value) : "Sin confirmar"}</dd></div>)}
          </dl>
          {!data.budget.configured && <form className="mt-3 space-y-2" onSubmit={event => { event.preventDefault(); if (fixed.trim() && Number.isFinite(fixedCents) && fixedCents >= 0 && fixedCents <= 10000) mutation.mutate({ path: "budget", body: { fixedCents } }); }}>
            <label htmlFor="factory-fixed-cost" className="block text-sm">Alojamiento y otros costes fijos de este mes (USD)</label>
            <input id="factory-fixed-cost" type="number" min="0" max="100" step="0.01" required value={fixed} onChange={event => setFixed(event.target.value)} aria-describedby="factory-budget-help" className="w-full rounded-md border bg-background p-2" />
            <p id="factory-budget-help" className="text-xs text-muted-foreground">Se reserva este importe antes de ejecutar tareas. El registro del mes no puede reemplazarse desde este panel.</p>
            <Button type="submit" disabled={mutation.isPending || !fixed.trim()}>Registrar costes del mes</Button>
          </form>}
        </section>
        <section aria-labelledby="factory-projects">
          <h3 id="factory-projects" className="font-semibold">Aplicaciones</h3>
          {data.projects.map(item => <div key={item.id} className="mt-2 rounded-lg border p-3 text-sm"><p className="font-medium">{item.id} · {item.repo}</p><p>{item.automaticRelease ? "Publicación automática habilitada" : "Publicación automática pendiente de pruebas"}</p><ul className="list-disc pl-5">{item.readiness.map(reason => <li key={reason}>{readinessLabels[reason] ?? "Configuración pendiente de verificar"}</li>)}</ul></div>)}
          <details className="mt-3"><summary className="cursor-pointer text-sm font-medium">Registrar o actualizar una aplicación</summary>
            <form className="mt-3 space-y-3" onSubmit={event => { event.preventDefault(); registration.mutate(); }}>
              <p className="text-xs text-muted-foreground">Actualizar un identificador existente exige verificar de nuevo su publicación y recuperación. Los comandos se ejecutarán únicamente en un entorno aislado configurado por el operador.</p>
              {projectFields.map(([key, label]) => <div key={key}><label className="block text-sm" htmlFor={`factory-project-${key}`}>{label}</label><input className="w-full rounded-md border bg-background p-2 text-sm" id={`factory-project-${key}`} type={key.endsWith("Url") ? "url" : "text"} required maxLength={key === "id" ? 100 : 2000} value={project[key] ?? ""} onChange={event => setProject(previous => ({ ...previous, [key]: event.target.value }))} /></div>)}
              <label className="block text-sm" htmlFor="factory-journeys">Recorridos de usuario (uno por línea)</label><textarea id="factory-journeys" required className="w-full rounded-md border bg-background p-2 text-sm" value={journeys} onChange={event => setJourneys(event.target.value)} />
              {registration.isError && <p role="alert">No se registró la aplicación. Revisa los campos y usa un entorno de ensayo separado.</p>}
              {registration.isSuccess && <p role="status">Aplicación registrada; la publicación automática sigue pendiente de verificación.</p>}
              <Button type="submit" disabled={registration.isPending}>Guardar aplicación</Button>
            </form>
          </details>
        </section>
        <section aria-labelledby="factory-proposals">
          <h3 id="factory-proposals" className="font-semibold">Propuestas revisadas por orden</h3>
          <p className="text-xs text-muted-foreground">Evidencia registrada por la fábrica; no acredita publicación, vigencia de la orden ni rendimiento de una generación de agentes.</p>
          {data.proposalEvidenceStatus!=="complete" && <p role="status">No se pudo completar la consulta de evidencia; los resultados pueden estar incompletos.</p>}
          {!(data.reviewedProposals?.length) ? <p className="text-sm">Sin propuestas verificadas en esta consulta.</p> : <ol>{data.reviewedProposals.map(proposal=><li key={proposal.reviewJobId} className="rounded-lg border p-3 text-sm">
            <p>Orden {proposal.orderId} · Propuesta revisada, no publicada</p>
            <p>Vínculo histórico; vigencia de la orden sin verificar.</p>
            <a href={proposal.prUrl} target="_blank" rel="noopener noreferrer" className="underline">Ver propuesta en GitHub</a>
            <p className="break-all text-xs">Revisión de orden: {proposal.orderRevision} · Versión: {proposal.headSha}</p>
            {proposal.officeReview && <p className="text-xs" data-testid="factory-office-review">Revisión de oficina: {officeReviewLabel(proposal.officeReview)}</p>}
            <time dateTime={proposal.completedAt}>{new Date(proposal.completedAt).toLocaleString("es")}</time>
          </li>)}</ol>}
        </section>
        <section aria-labelledby="factory-results">
          <h3 id="factory-results" className="font-semibold">Resultados recientes</h3>
          <p className="text-xs text-muted-foreground">Resumen de los últimos 100 trabajos; abajo se muestran los 50 más recientes.</p>
          <p className="text-sm">{data.metrics.verifiedDeliveries} entregas verificadas · {data.metrics.rollbacks} recuperaciones completadas · {data.metrics.blockedJobs} trabajos bloqueados o sin confirmar</p>
          <p className="text-sm">{data.metrics.stagingVerifications} verificaciones en ensayo · {data.metrics.regressions} regresiones detectadas · Intervenciones humanas: {data.metrics.humanInterventions ?? "sin registro consolidado"}</p>
          <p className="text-xs text-muted-foreground">Coste medio por trabajo: {data.metrics.averageCompletedCostCents === null ? "sin evidencia suficiente" : money(data.metrics.averageCompletedCostCents)}.</p>
          {data.jobs.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">Todavía no hay trabajos registrados. Reanudar la cola no configura automáticamente proveedores o aplicaciones.</p> : <ol className="mt-3 space-y-3">{data.jobs.map(job => <li key={job.id} className="rounded-lg border p-3 text-sm">
            <p className="font-medium">{stages[job.kind] ?? job.kind} · {job.projectId}</p>
            <p>{statuses[job.status] ?? job.status}</p>
            {job.blocker && <p>{job.blocker}</p>}
            {job.reasonCode && <p className="break-all text-xs text-muted-foreground">Código: {job.reasonCode}</p>}
            <p className="text-xs text-muted-foreground">{job.evidenceCount} registros de evidencia · Coste: {job.costCents === null ? "sin confirmar" : money(job.costCents)}</p>
            <p className="break-all text-xs text-muted-foreground">{job.headSha ? `Versión: ${job.headSha}` : "Versión todavía sin registrar"}</p>
            <time className="text-xs text-muted-foreground" dateTime={job.createdAt}>{new Date(job.createdAt).toLocaleString("es")}</time>
          </li>)}</ol>}
        </section>
      </div>}
    </DialogContent>
  </Dialog>;
}
