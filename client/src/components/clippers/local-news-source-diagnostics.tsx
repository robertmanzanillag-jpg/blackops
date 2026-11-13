import type { SourceDiagnostic, SourceDiagnostics, SourceError, SourceObservation } from "../../../../shared/local-news-source-diagnostics";

interface LocalNewsSourceDiagnosticsProps {
  diagnostics?: SourceDiagnostics;
}

const outcomeLabels: Record<SourceDiagnostic["status"], string> = {
  recent_news: "recent_news · noticias recientes",
  candidates_only: "candidates_only · candidatos recientes, sin aporte nuevo aprobado",
  empty: "empty · respuesta vacía",
  no_recent_news: "no_recent_news · sin noticias recientes",
  undated: "undated · sin fecha publicable",
  error: "error · consulta fallida",
  not_observed: "not_observed · aún no observada",
  disabled: "disabled · deshabilitada / no configurada",
  stale: "stale · observación desactualizada",
};

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "Sin dato";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return `Fecha inválida: ${value}`;
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function displayCount(value: number | null | undefined): string {
  return value === null || value === undefined ? "Sin dato" : String(value);
}

function SourceErrorDetails({ error }: { error: SourceError | null | undefined }) {
  if (!error) return <p className="text-xs text-zinc-500">Sin error registrado en esta observación.</p>;
  return (
    <div className="mt-2 rounded border border-amber-300/15 bg-amber-300/5 p-2 text-xs leading-5 text-amber-100">
      <p className="font-medium">{error.category} · {error.code}</p>
      <p>{error.message || "Mensaje de error no disponible."}</p>
      {error.httpStatus !== undefined && <p className="text-amber-200/70">HTTP {error.httpStatus}</p>}
      {error.category === "potentially_transient" && (
        <p className="mt-1 text-amber-200/80">Categoría tentativa; no confirma la causa raíz.</p>
      )}
      {error.category === "configuration_or_access" && (
        <p className="mt-1 text-amber-200/80">Posible configuración o acceso; no confirma la causa raíz.</p>
      )}
    </div>
  );
}

function ObservationRow({ observation }: { observation: SourceObservation }) {
  return (
    <div className="rounded border border-white/10 bg-black/20 p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-zinc-200">{observation.outcome}</span>
        <time className="text-zinc-500">{formatTimestamp(observation.checkedAt)}</time>
      </div>
      <p className="mt-1 text-zinc-400">
        Recibidas: {displayCount(observation.receivedCount)} · Aceptadas: {observation.acceptedCount} · Recientes: {observation.recentCount} · Sin fecha: {observation.undatedCount}
      </p>
      <p className="text-zinc-400">Publicación original más reciente: {formatTimestamp(observation.newestOriginalPublishedAt)}</p>
      {observation.error && <SourceErrorDetails error={observation.error} />}
    </div>
  );
}

export function LocalNewsSourceDiagnostics({ diagnostics }: LocalNewsSourceDiagnosticsProps) {
  const storedDiagnostics = diagnostics;
  const boundedSources = (storedDiagnostics?.sources || []).map((source) => ({
    ...source,
    history: (source.history || []).slice(0, storedDiagnostics?.maxHistoryPerSource || 100),
  }));

  return (
    <section aria-labelledby="local-news-source-diagnostics-title" className="mt-4 rounded-md border border-white/10 bg-black/35 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 id="local-news-source-diagnostics-title" className="text-sm font-medium text-white">Diagnóstico persistente de fuentes</h3>
          <p className="mt-1 text-xs leading-5 text-zinc-400">
            Ventana de noticias recientes: {storedDiagnostics?.recentWindowHours ?? 72} horas. Historial: hasta {storedDiagnostics?.maxHistoryPerSource ?? 100} observaciones por fuente durante {storedDiagnostics?.retentionDays ?? 7} días.
            {" "}Los resultados corresponden a la última comprobación; tras {storedDiagnostics?.observationMaxAgeMinutes ?? 30} minutos sin comprobar se marcan desactualizados. Las candidatas extraídas no equivalen a aportes: solo cuentan como aportes las noticias nuevas o actualizadas, deduplicadas, con fecha original conocida y aprobadas por el comité. Ningún recuento confirma publicación.
          </p>
        </div>
        {storedDiagnostics?.scope && (
          <span className="rounded border border-white/10 px-2 py-1 text-[10px] uppercase tracking-wide text-zinc-400">
            {storedDiagnostics.scope}
          </span>
        )}
      </div>

      <p className="mt-2 text-xs leading-5 text-amber-200/90">
        Estos datos pertenecen a esta instancia local y no se agregan entre instancias Autoscale. No hay backfill histórico. La ausencia de una excepción no demuestra que una fuente haya funcionado.
      </p>

      {!storedDiagnostics && (
        <p className="mt-3 rounded border border-amber-300/20 bg-amber-300/5 p-2 text-xs leading-5 text-amber-100">
          Diagnósticos no incluidos en el estado recibido: no hay datos para confirmar éxito o fallo.
        </p>
      )}
      {storedDiagnostics && !storedDiagnostics.available && (
        <p className="mt-3 rounded border border-amber-300/20 bg-amber-300/5 p-2 text-xs leading-5 text-amber-100">
          {storedDiagnostics.storageError === "write_failed"
            ? "No se pudieron guardar los diagnósticos; la ingesta continúa, pero el historial puede estar incompleto."
            : storedDiagnostics.storageError === "missing"
            ? "Almacenamiento de diagnósticos ausente; no hay datos históricos disponibles."
            : storedDiagnostics.storageError === "invalid"
              ? "Almacenamiento de diagnósticos inválido; no se puede confiar en un historial disponible."
              : "Diagnósticos no disponibles; no hay datos para confirmar éxito o fallo."}
        </p>
      )}
      {storedDiagnostics && boundedSources.length === 0 && (
        <p className="mt-3 text-xs text-zinc-400">No hay fuentes observadas en los diagnósticos disponibles.</p>
      )}

      {storedDiagnostics && boundedSources.length > 0 && (
        <div className="mt-3 space-y-2">
          {boundedSources.map((source) => (
            <article key={source.id} className="rounded border border-white/10 bg-zinc-950/50 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="break-all text-sm font-medium text-zinc-100">{source.name || source.id}</p>
                  <p className="break-all text-xs text-zinc-500">{source.id}</p>
                  <p className="text-xs text-zinc-400">
                    {source.city} · {source.status === "disabled" ? "Deshabilitada" : source.configured ? "Configurada · habilitada" : "No configurada"}
                  </p>
                </div>
                <span className={`rounded border px-2 py-1 text-[10px] leading-4 ${
                  source.status === "recent_news"
                    ? "border-emerald-300/20 bg-emerald-300/5 text-emerald-200"
                    : source.status === "error"
                      ? "border-rose-300/20 bg-rose-300/5 text-rose-200"
                      : "border-amber-300/20 bg-amber-300/5 text-amber-100"
                }`}>
                  {outcomeLabels[source.status] || source.status}
                </span>
              </div>
              <dl className="mt-3 grid gap-x-4 gap-y-2 text-xs sm:grid-cols-2">
                <div><dt className="text-zinc-500">Última comprobación</dt><dd className="mt-0.5 text-zinc-300">{formatTimestamp(source.latest?.checkedAt || source.lastAttemptAt)}</dd></div>
                <div><dt className="text-zinc-500">Última consulta exitosa</dt><dd className="mt-0.5 text-zinc-300">{formatTimestamp(source.lastFetchSuccessAt)}</dd></div>
                <div><dt className="text-zinc-500">Último éxito con noticias</dt><dd className="mt-0.5 text-zinc-300">{formatTimestamp(source.lastNewsSuccessAt)}</dd></div>
                <div><dt className="text-zinc-500">Publicación original más reciente</dt><dd className="mt-0.5 text-zinc-300">{formatTimestamp(source.latest?.newestOriginalPublishedAt)}</dd></div>
              </dl>
              {source.latest ? (
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                  <div className="rounded bg-white/[0.03] p-2"><span className="block text-zinc-500">Recibidas</span><span className="text-zinc-200">{displayCount(source.latest.receivedCount)}</span></div>
                  <div className="rounded bg-white/[0.03] p-2"><span className="block text-zinc-500">Extraídas / candidatas recientes</span><span className="text-zinc-200">{source.latest.acceptedCount} / {source.latest.recentCandidateCount}</span></div>
                  <div className="rounded bg-white/[0.03] p-2"><span className="block text-zinc-500">Aportes nuevos aprobados (no publicados)</span><span className="text-zinc-200">{source.latest.recentCount}</span></div>
                  <div className="rounded bg-white/[0.03] p-2"><span className="block text-zinc-500">Sin fecha</span><span className="text-zinc-200">{source.latest.undatedCount}</span></div>
                </div>
              ) : (
                <p className="mt-3 text-xs text-zinc-500">Sin observación más reciente; el estado no implica que la fuente haya funcionado.</p>
              )}
              {source.latest && !source.latest.ingestionComplete && (
                <p className="mt-2 text-xs text-amber-200">Observación de extracción; el aporte final de ingesta todavía no está confirmado.</p>
              )}
              {source.latest?.error && <SourceErrorDetails error={source.latest.error} />}
              <details className="mt-3 border-t border-white/10 pt-2">
                <summary className="cursor-pointer select-none text-xs text-cyan-200 hover:text-cyan-100">
                  Historial de observaciones ({source.history.length})
                </summary>
                <div className="mt-2 space-y-2">
                  {source.history.length ? source.history.map((observation, index) => (
                    <ObservationRow key={`${observation.checkedAt}-${index}`} observation={observation} />
                  )) : <p className="text-xs text-zinc-500">No hay observaciones en el historial retenido.</p>}
                </div>
              </details>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

