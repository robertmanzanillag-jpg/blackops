import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import type { OfficeVerification } from "@shared/office-verification";
import { kongSupervisorSessionScope, type SupervisorAuth } from "./kong-supervisor-session";

const timestamp = (value: string) => new Date(value).toLocaleString("es", { timeZoneName: "short" });
const quality = (value: number | null) => value === null ? "sin comparación" : `${value}/100`;

export function OfficeVerificationPanel({ ownerId }: { ownerId: string }) {
  const [open, setOpen] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("officePanel") === "verification");
  const [retrying, setRetrying] = useState(false);
  const auth = useQuery<SupervisorAuth>({ queryKey: ["auth-me"], enabled: false });
  const verifiedAuth = useQuery<SupervisorAuth>({
    queryKey: ["office-verification-auth", ownerId],
    queryFn: async () => (await apiRequest("GET", "/api/auth/me")).json(),
    enabled: open && auth.data?.user?.id === ownerId && !auth.isFetching,
    staleTime: 0, gcTime: 0, retry: false, refetchOnMount: "always",
  });
  const session = kongSupervisorSessionScope(auth.data, verifiedAuth.data, auth.isFetching, verifiedAuth.isFetching, verifiedAuth.isError, auth.isError);
  const query = useQuery<OfficeVerification>({
    queryKey: ["office-verification", session],
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/agents-office/verification", { credentials: "include", signal });
      if (!response.ok) throw new Error("Office verification unavailable");
      return response.json();
    },
    enabled: open && session === ownerId,
    staleTime: 0, gcTime: 0, retry: false,
    refetchInterval: open && session === ownerId ? 30_000 : false,
  });
  const data = open && session === ownerId && !query.isError ? query.data : undefined;
  const feedback = data?.mechanisms.feedback;
  const evaluations = data?.mechanisms.evals;
  const failed = verifiedAuth.isError || auth.isError || query.isError || (verifiedAuth.isSuccess && session !== ownerId && !verifiedAuth.isFetching);
  const retry = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      if (auth.isError) await auth.refetch();
      else if (session !== ownerId) await verifiedAuth.refetch();
      else await query.refetch();
    } finally { setRetrying(false); }
  };

  return <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
    <DialogPrimitive.Trigger asChild>
      <Button className="absolute bottom-16 left-3 z-[110] border border-emerald-200/30 bg-slate-950 text-white hover:bg-slate-800" data-testid="open-office-verification">Verificación y mejora</Button>
    </DialogPrimitive.Trigger>
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-[240] bg-black/80" />
      <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-[250] max-h-[85dvh] w-[calc(100vw-1.5rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto overscroll-contain rounded-xl border border-white/15 bg-slate-950 p-4 text-slate-100 shadow-xl sm:p-6" data-testid="office-verification-dialog">
        <div className="flex items-start justify-between gap-4">
          <DialogPrimitive.Title className="text-lg font-semibold">Verificación y mejora</DialogPrimitive.Title>
          <DialogPrimitive.Close asChild><Button variant="outline" size="sm" data-testid="close-office-verification">Cerrar</Button></DialogPrimitive.Close>
        </div>
        <DialogPrimitive.Description className="mt-2 text-sm text-slate-300">Evidencia registrada de comprobación, aprendizaje y límites de los agentes. Habilitar un mecanismo no demuestra que esté ejecutándose ni que haya mejorado.</DialogPrimitive.Description>
        {!failed && !data && <p role="status" className="mt-4 text-sm">Consultando evidencia…</p>}
        {failed && <div role="alert" className="mt-4 space-y-2 text-sm text-amber-200"><p>No se pudo verificar la sesión o consultar la evidencia actual. Los datos anteriores no confirman el estado actual.</p><Button variant="outline" disabled={retrying || auth.isFetching || verifiedAuth.isFetching || query.isFetching} onClick={() => void retry()} data-testid="retry-office-verification">{retrying ? "Reintentando…" : "Reintentar"}</Button></div>}
        {data && <div className="mt-5 space-y-5 break-words text-sm">
          <div role="status" data-testid="office-verification-evidence" className="rounded-lg border border-white/15 p-3">
            <p className={data.evidenceStatus === "recent" ? "text-emerald-200" : "text-amber-200"}>{data.evidenceStatus === "recent" ? "Evidencia reciente registrada" : data.evidenceStatus === "stale" ? "Evidencia antigua: actividad actual sin confirmar" : "Sin evidencia registrada"}</p>
            <p className="mt-1 text-slate-300">Última evidencia: {data.latestEvidenceAt ? <time dateTime={data.latestEvidenceAt}>{timestamp(data.latestEvidenceAt)}</time> : "ninguna"}.</p>
            <p className="mt-1 text-xs text-slate-400">Consultado: <time dateTime={data.generatedAt}>{timestamp(data.generatedAt)}</time>. Actualización cada 30 segundos mientras este panel está abierto.</p>
            <Button size="sm" variant="outline" className="mt-2" disabled={query.isFetching} onClick={() => void query.refetch()} data-testid="refresh-office-verification">{query.isFetching ? "Actualizando…" : "Actualizar evidencia"}</Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <section aria-labelledby="verification-feedback-title" data-testid="office-verification-feedback" className="rounded-lg border border-white/15 p-3">
              <h2 id="verification-feedback-title" className="font-semibold">Feedback loop</h2>
              <p className="mt-2">Reparación automática: {feedback!.enabled ? "configurada en este servidor" : "sin configurar en este servidor"}</p>
              <p className="mt-2 text-slate-300">Detectados: {feedback!.detected} · En reparación: {feedback!.repairing} · Verificados: {feedback!.verified} · Necesitan al dueño: {feedback!.needsOwner}</p>
              <p className="mt-2 text-xs text-slate-400">Los intentos de reparación y los resultados verificados se cuentan por separado.</p>
            </section>
            <section aria-labelledby="verification-evals-title" data-testid="office-verification-evals" className="rounded-lg border border-white/15 p-3">
              <h2 id="verification-evals-title" className="font-semibold">Evaluaciones</h2>
              <p className="mt-2">Evaluación: {evaluations!.enabled ? "configurada en este servidor" : "sin configurar en este servidor"}</p>
              <p className="mt-2 text-slate-300">Ejecuciones: {evaluations!.totalRuns} · Completadas: {evaluations!.completedRuns} · Sin confirmar: {evaluations!.unknownRuns}</p>
              <p className="mt-2 text-slate-300">Políticas candidatas: {evaluations!.candidatePolicies} · Calificadas: {evaluations!.qualifiedPolicies}</p>
              <p className="mt-2 font-medium" data-testid="office-verification-improvements">{evaluations!.verifiedImprovements > 0 ? `${evaluations!.verifiedImprovements} mejoras verificadas en su habilidad evaluada` : "Todavía no hay mejoras verificadas"}</p>
            </section>
          </div>
          {evaluations!.comparisons.length > 0 && <section aria-labelledby="verification-comparisons-title" data-testid="office-verification-comparisons">
            <h2 id="verification-comparisons-title" className="font-semibold">Comparaciones de instrucciones</h2>
            <ul className="mt-2 grid gap-2 sm:grid-cols-2">{evaluations!.comparisons.map(row => <li key={`${row.role}:${row.policyVersion}`} className="min-w-0 rounded-lg border border-white/15 p-3">
              <h3 className="font-medium">{row.role}</h3>
              <p className="mt-1 text-slate-300">Referencia: {quality(row.baselineQuality)} · Candidata: {quality(row.candidateQuality)}</p>
              <p className="mt-1">Pares aprobados: {row.passedPairs} · Estado registrado: {row.status}</p>
              <p className="mt-1 text-xs text-slate-400">{row.firstVerifiedRunId ? "Primera ejecución con esta política verificada." : "Primera ejecución con esta política pendiente de verificar."}</p>
            </li>)}</ul>
          </section>}
          <section aria-labelledby="verification-guardrails-title" data-testid="office-verification-guardrails" className="rounded-lg border border-white/15 p-3">
            <h2 id="verification-guardrails-title" className="font-semibold">Guardrails</h2>
            <p className="mt-2 text-slate-300">Reglas declaradas en el código; las referencias permiten revisar su implementación y sus pruebas. Este informe no ejecuta esas pruebas.</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">{data.mechanisms.guardrails.rules.map(rule => <li key={rule}>{rule}</li>)}</ul>
            <ul className="mt-3 space-y-2 text-xs text-slate-400" data-testid="office-verification-guardrail-references">{data.mechanisms.guardrails.references.map(reference => <li key={`${reference.rule}:${reference.source}`} className="rounded border border-white/10 p-2">
              <p className="font-medium text-slate-300">{reference.rule}</p>
              <p className="mt-1">Implementación: <code>{reference.source}</code></p>
              <p>Prueba: <code>{reference.test}</code></p>
            </li>)}</ul>
          </section>
          <section aria-labelledby="verification-map-title" data-testid="office-verification-feature-map">
            <h2 id="verification-map-title" className="font-semibold">Mapa de funcionalidades</h2>
            <p className="mt-1 text-slate-300">Recorridos y resultados que debe comprobar el agente.</p>
            <ul className="mt-2 space-y-2">{data.featureMap.map(feature => <li key={feature.id} className="rounded-lg border border-white/15 p-3">
              <a href={feature.route} data-testid={`office-verification-feature-${feature.id}`} className="font-medium text-cyan-200 underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200">{feature.title}</a>
              <p className="mt-1 text-slate-300">{feature.expected}</p>
            </li>)}</ul>
          </section>
          {data.limitations.length > 0 && <section aria-labelledby="verification-limits-title" data-testid="office-verification-limitations">
            <h2 id="verification-limits-title" className="font-semibold">Alcance y pendientes</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-300">{data.limitations.map(value => <li key={value}>{value}</li>)}</ul>
          </section>}
        </div>}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>;
}
