import { useEffect, useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";

const ENDPOINT = "/api/kong-repairs";
const REFRESH_INTERVAL_MS = 60_000;
const SOURCE_MAX_AGE_MS = 30 * 60_000;
const MAKER_MAX_AGE_MS = 45 * 60_000;

type RepairResponse = {
  entries?: Array<{ status?: string } | null>;
  pull?: { lastSuccessfulSourceReadAt?: string; lastHttpStatus?: number; errorCode?: string };
  maker?: { lastSuccessfulPollAt?: string; workerConnected?: boolean; state?: string };
};

function parseSignalTime(at: unknown) {
  if (typeof at !== "string") return undefined;
  const timestamp = Date.parse(at);
  return Number.isFinite(timestamp) && timestamp <= Date.now() ? new Date(timestamp).toISOString() : undefined;
}

function isFresh(at: string | undefined, now: number, maxAgeMs: number) {
  const age = typeof at === "string" ? now - Date.parse(at) : NaN;
  return age >= 0 && age <= maxAgeMs;
}

function isDisabledError(message: string) {
  if (!message.startsWith("503: ")) return false;
  try {
    return JSON.parse(message.slice(5))?.code === "REPAIR_BRIDGE_DISABLED";
  } catch {
    return false;
  }
}

async function readRepairStatus() {
  try {
    const response = await apiRequest("GET", ENDPOINT);
    const data: RepairResponse | null = await response.json();
    if (!Array.isArray(data?.entries)) throw new Error("Invalid repair status");

    const counts = { queued: 0, review: 0, deployment: 0, verified: 0 };
    for (const entry of data.entries) {
      switch (entry?.status) {
        case "queued": counts.queued += 1; break;
        case "awaiting_checker":
        case "awaiting_independent_review":
        case "awaiting_qareview": counts.review += 1; break;
        case "awaiting_deployment": counts.deployment += 1; break;
        case "verified": counts.verified += 1; break;
      }
    }

    return {
      sourceReadAt: parseSignalTime(data.pull?.lastSuccessfulSourceReadAt),
      sourceReadSucceeded: data.pull?.lastHttpStatus === 200 && data.pull?.errorCode === "NONE",
      makerPollAt: parseSignalTime(data.maker?.lastSuccessfulPollAt),
      makerConnected: data.maker?.workerConnected === true,
      makerIdle: data.maker?.state === "idle",
      makerUncertain: data.maker?.state === "unknown",
      counts,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/^(401|403): /.test(message)) throw new Error("access");
    if (isDisabledError(message)) throw new Error("disabled");
    throw new Error("unavailable");
  }
}

const dateFormat = new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short" });

function SignalTime({ label, at }: { label: string; at?: string }) {
  if (!at) return null;

  return <span className="block text-xs text-muted-foreground">
    {label} <time dateTime={at}>{dateFormat.format(Date.parse(at))}</time>
  </span>;
}

export function KongRepairStatusPanel({ sessionScope }: { sessionScope: string }) {
  const headingId = useId();
  const [, setClock] = useState(0);
  const repair = useQuery({
    queryKey: [ENDPOINT, sessionScope],
    queryFn: readRepairStatus,
    refetchInterval: REFRESH_INTERVAL_MS,
    refetchOnMount: "always",
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    gcTime: 0,
    retry: false,
  });
  const data = repair.isError ? undefined : repair.data;
  const sourceReadAt = data?.sourceReadAt;
  const makerPollAt = data?.makerPollAt;
  useEffect(() => {
    const timers = [[sourceReadAt, SOURCE_MAX_AGE_MS], [makerPollAt, MAKER_MAX_AGE_MS]] as const;
    const handles = timers.flatMap(([at, maxAgeMs]) => {
      if (!at) return [];
      const delay = Math.max(Date.parse(at) + maxAgeMs + 1 - Date.now(), 0);
      return [window.setTimeout(() => setClock(tick => tick + 1), delay)];
    });
    return () => handles.forEach(timer => window.clearTimeout(timer));
  }, [sourceReadAt, makerPollAt]);

  const currentTime = Date.now();
  const sourceFresh = isFresh(sourceReadAt, currentTime, SOURCE_MAX_AGE_MS);
  const makerFresh = data?.makerConnected && isFresh(makerPollAt, currentTime, MAKER_MAX_AGE_MS);
  const errorMessage = repair.error?.message === "access" ? "Solo el propietario puede consultar las reparaciones."
    : repair.error?.message === "disabled" ? "Sin activar"
    : "No se pudo consultar el estado de las reparaciones.";

  return <section aria-labelledby={headingId} className="space-y-3 rounded border p-3 text-sm">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 id={headingId} className="font-semibold">Reparaciones de KONG</h2>
      <Button type="button" variant="outline" size="sm" disabled={repair.isFetching}
        onClick={() => void repair.refetch()}>Actualizar estado</Button>
    </div>
    {repair.isError ? <p role="status">{errorMessage}</p> : data ? <>
      <dl className="grid gap-3 sm:grid-cols-2">
        <div>
          <dt className="font-medium">Fuente CEO</dt>
          <dd aria-live="polite">
            <span>{sourceFresh && data.sourceReadSucceeded ? "Conexión verificada"
              : sourceFresh ? "La última lectura falló" : "Sin lectura reciente verificada"}</span>
            <SignalTime label="Última lectura confirmada" at={sourceReadAt} />
          </dd>
        </div>
        <div>
          <dt className="font-medium">Ejecutor (Maker)</dt>
          <dd aria-live="polite">
            <span>{makerFresh && data.makerIdle ? "Conexión verificada · En espera"
              : makerFresh && data.makerUncertain ? "Contacto reciente · Estado incierto" : "Sin conexión reciente verificada"}</span>
            <SignalTime label="Último contacto confirmado" at={makerPollAt} />
          </dd>
        </div>
      </dl>
      <dl className="grid grid-cols-2 gap-2 border-t pt-2 sm:grid-cols-4">
        <div><dt>En cola</dt><dd className="font-semibold tabular-nums">{data.counts.queued}</dd></div>
        <div><dt>En revisión</dt><dd className="font-semibold tabular-nums">{data.counts.review}</dd></div>
        <div><dt>Pendientes de despliegue</dt><dd className="font-semibold tabular-nums">{data.counts.deployment}</dd></div>
        <div><dt>Verificadas</dt><dd className="font-semibold tabular-nums">{data.counts.verified}</dd></div>
      </dl>
    </> : <p role="status">Consultando reparaciones…</p>}
  </section>;
}
