import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { KongOperationsState, PublicationStatus } from "@shared/kong-operations";

type View = KongOperationsState & { status: { "kong-metrics": { state: string; label: string }; inbox: number; holder: string | null; duplicates: number } };

const PUBLICATION_LABEL: Record<PublicationStatus, string> = {
  planned: "Reservada",
  submitted: "Enviada",
  confirmed: "Confirmada",
  failed: "Fallo",
  unknown: "Sin respuesta",
  retryable: "Para reintentar",
  duplicate: "DUPLICADA",
};

function when(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("es", { dateStyle: "short", timeStyle: "short" });
}

/**
 * KONG operations in the same Agents Office tab (owner-only, read-only view):
 * verified cards delivered to Videos KONG, the single publisher, the UUID ledger and the
 * results per publication. The external publisher acts through /api/kong-ops/*; this panel never publishes.
 */
export function KongOperationsPanel() {
  const [open, setOpen] = useState(false);
  const query = useQuery<View>({
    queryKey: ["/api/kong-ops/state"],
    enabled: open,
    refetchInterval: open ? 30_000 : false,
  });
  const view = query.data;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" data-testid="button-kong-operations">Operacion KONG</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl" data-testid="kong-operations-dialog">
        <DialogHeader>
          <DialogTitle>Operacion KONG</DialogTitle>
          <DialogDescription>
            Fichas de Venues y Promoters (fuente https revisada por su autor en los ultimos 7 dias, sin datos personales) para Videos KONG,
            el publicador unico, el registro por UUID y los resultados por publicacion. Esta oficina coordina; no publica.
          </DialogDescription>
        </DialogHeader>
        {query.isError && <p role="alert" className="text-sm text-rose-500">No se pudo leer la operacion de KONG.</p>}
        {!view && !query.isError && <p className="text-sm text-muted-foreground">Cargando...</p>}
        {view && (
          <div className="space-y-4 text-sm">
            {view.status.duplicates > 0 && (
              <p role="alert" className="rounded border border-rose-500 p-2 text-sm text-rose-600" data-testid="kong-ops-duplicates">
                {view.status.duplicates} publicacion(es) salieron dos veces. Revisa el registro y borra el post repetido.
              </p>
            )}
            <section data-testid="kong-ops-holder">
              <h3 className="font-semibold">Publicador unico</h3>
              <p>
                {view.status.holder
                  ? `${view.status.holder} (epoca ${view.lease?.epoch}) hasta ${when(view.lease?.expiresAt)}`
                  : "Nadie tiene la publicacion tomada ahora."}
              </p>
            </section>
            <section data-testid="kong-ops-inbox">
              <h3 className="font-semibold">Bandeja de Videos KONG · {view.status.inbox} pendientes</h3>
              {view.inbox.length === 0 && <p className="text-muted-foreground">Todavia no llegan fichas verificadas.</p>}
              <ul className="space-y-1">
                {view.inbox.slice(0, 12).map((brief) => (
                  <li key={brief.briefId} className="rounded border p-2">
                    <p className="font-medium">{brief.title} · <span className="text-xs">{brief.status}</span></p>
                    <p className="text-xs text-muted-foreground">{brief.highlight}</p>
                    <p className="text-xs text-muted-foreground">De {brief.from.replace("kong:", "")} · {when(brief.deliveredAt)} · {brief.sources.length} fuente(s)</p>
                  </li>
                ))}
              </ul>
            </section>
            <section data-testid="kong-ops-ledger">
              <h3 className="font-semibold">Publicaciones (por UUID)</h3>
              {view.publications.length === 0 && <p className="text-muted-foreground">Sin publicaciones registradas.</p>}
              <ul className="space-y-1">
                {view.publications.slice(0, 15).map((publication) => (
                  <li key={publication.uuid} className="flex flex-wrap justify-between gap-2 rounded border p-2 text-xs">
                    <span className="font-mono">{publication.uuid.slice(0, 8)}</span>
                    <span>{publication.network}</span>
                    <span>{PUBLICATION_LABEL[publication.status]}</span>
                    <span>{publication.externalPostId || "-"}</span>
                    <span>{publication.holder} · ep. {publication.epoch}</span>
                    {publication.lastError && <span className="w-full text-rose-500">{publication.lastError}</span>}
                  </li>
                ))}
              </ul>
            </section>
            <section data-testid="kong-ops-results">
              <h3 className="font-semibold">Metricas KONG · {view.status["kong-metrics"].label}</h3>
              {view.results.length === 0 && <p className="text-muted-foreground">Sin resultados medidos todavia.</p>}
              <ul className="space-y-1">
                {view.results.slice(0, 15).map((result) => (
                  <li key={result.uuid} className="rounded border p-2 text-xs">
                    <p className="font-medium">{result.title} · {result.network}</p>
                    <p>{result.impressions} vistas · {result.reach} alcance · {result.videoViews} reproducciones · {result.engagements} interacciones · {result.clicks} clics · {result.shares} compartidos</p>
                    <p className="text-muted-foreground">Medido {when(result.observedAt)}</p>
                  </li>
                ))}
              </ul>
            </section>
            {view.rejected.length > 0 && (
              <section data-testid="kong-ops-rejected">
                <h3 className="font-semibold">Fichas rechazadas</h3>
                <ul className="space-y-1 text-xs">
                  {view.rejected.slice(0, 8).map((item, index) => (
                    <li key={`${item.at}-${index}`}>{item.name || item.cardId || "Ficha"}: {item.reasons.join("; ")}</li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
