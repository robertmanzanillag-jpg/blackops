import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  buildOfficeCityRoomsFromSnapshot,
  officeCityCountries,
  parseOfficeCityDirectory,
  officeCitySnapshotExpiresAt,
} from "@/lib/office-city-agents";
import { useAgentLiveStatuses } from "@/components/agents-building/agents-building";
import { OFFICE_KONG_CITY_TASKS } from "@shared/office-kong-supervisor";
import type { OfficeKongAuditResult } from "../../../server/office-kong";

const priority = [
  "customer_operations", "venue_deals", "finance_risk", "growth_analytics",
  "promoters_partnerships", "city_operations",
];
const mediaIds = ["kong-videos", "kong-metrics"];
const onDemand = new Set(["restaurant_secretary", "legacy_ceo", "restaurant_deals", "kong_ai_chat"]);
const labels: Record<string, string> = {
  running: "En ejecución", healthy: "Última actividad verificada",
  attention: "Requiere atención", disabled: "Deshabilitado",
  stale: "Evidencia vencida", unknown: "Sin evidencia reciente", idle: "Disponible bajo demanda",
};
const station = "rounded-lg border border-white/20 px-3 py-2 text-sm text-slate-100 hover:bg-white/10 focus-visible:outline focus-visible:outline-cyan-200";
type Desk = { id: string; name: string; owner: string; responsibility: string; status: string; lastRunAt: string | null; blocker: string | null; detail?: string | null };
const searchKey = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export function KongTeamOffice({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState("");
  const [cityId, setCityId] = useState("");
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const panel = dialog.current;
    panel?.showModal();
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => { window.clearInterval(timer); panel?.close(); };
  }, []);
  const directory = useQuery<unknown>({ queryKey: ["/api/agents-office/cities"], refetchInterval: 60_000, retry: false });
  const snapshot = useQuery<OfficeKongAuditResult>({ queryKey: ["/api/agents-office/kong-snapshot"], refetchInterval: 60_000, retry: false });
  const media = useAgentLiveStatuses(mediaIds, { data: null, isError: false });
  const evidence = snapshot.data?.evidence;
  const age = evidence ? now - Date.parse(evidence.generatedAt) : Infinity;
  const current = !snapshot.isError && age >= -30_000 && age <= 300_000;
  const cities = parseOfficeCityDirectory(directory.data);
  const cityEvidence = current && !directory.isError ? evidence : undefined;
  const rooms = buildOfficeCityRoomsFromSnapshot(cities, cityEvidence, now);
  const expiresAt = officeCitySnapshotExpiresAt(cityEvidence, now);
  useEffect(() => {
    if (expiresAt === undefined || !Number.isFinite(expiresAt) || expiresAt < now) return;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.max(0, expiresAt - Date.now() + 1));
    return () => window.clearTimeout(timer);
  }, [expiresAt, now]);
  const countries = officeCityCountries(cities);
  const team: Desk[] = (evidence?.agents ?? []).filter(agent => agent.kind !== "city").map(agent => ({
    ...agent,
    status: onDemand.has(agent.id) ? "Bajo demanda" : labels[current ? agent.state : "unknown"],
  }));
  team.push(
    { id: "kong-videos", name: "Videos KONG", owner: "Contenido", responsibility: "Recibir fichas verificadas y preparar videos para el publicador autorizado.", status: media["kong-videos"]?.label ?? labels.unknown, lastRunAt: null, blocker: media["kong-videos"]?.state === "error" ? media["kong-videos"].detail ?? null : null },
    { id: "kong-metrics", name: "Métricas KONG", owner: "Crecimiento y analítica", responsibility: "Medir resultados por publicación confirmada.", status: media["kong-metrics"]?.label ?? labels.unknown, lastRunAt: null, blocker: media["kong-metrics"]?.state === "error" ? media["kong-metrics"].detail ?? null : null },
  );
  const byId = new Map(team.map(desk => [desk.id, desk]));
  const cityDesks: Desk[] = rooms.flatMap(room => room.agents.map(agent => ({
    id: agent.id, name: agent.name, owner: "Coordinador de ciudades",
    responsibility: OFFICE_KONG_CITY_TASKS[agent.category],
    status: agent.status.label, lastRunAt: agent.lastWorkAt, blocker: agent.recordedFailure || agent.status.state === "needs-setup" ? agent.blocker : null,
    detail: agent.discoverySummary ?? null,
  })));
  const all = [...byId.values(), ...cityDesks];
  const desk = all.find(agent => agent.id === selected);
  const city = rooms.find(room => room.city.id === cityId);
  const query = searchKey(search.trim());
  const results = query ? all.filter(agent => searchKey(`${agent.name} ${agent.responsibility} ${agent.owner}`).includes(query)) : [];
  const agentButton = (agent: Desk) => (
    <button className={station} key={agent.id} type="button" aria-pressed={agent.id === selected} onClick={() => setSelected(agent.id)}>
      {agent.name}
    </button>
  );
  const ceo = byId.get("chief_of_staff");
  const priorityDesks = priority.flatMap(id => {
    const agent = byId.get(id);
    return agent ? [agent] : [];
  });
  return (
    <dialog ref={dialog} aria-labelledby="kong-team-title" data-testid="kong-team-office" onClose={onClose} onCancel={event => { event.preventDefault(); onClose(); }}
      className="m-auto max-h-[90dvh] w-[min(96vw,75rem)] overflow-auto rounded-2xl border border-lime-300/30 bg-slate-950 p-4 text-slate-100 backdrop:bg-black/75 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="kong-team-title" className="text-xl font-bold text-lime-200">Oficina KONG</h2>
        <button type="button" className={station} onClick={onClose}>Volver a la oficina principal</button>
      </header>
      <p className="mt-2 text-sm text-slate-300">{byId.size} puestos centrales visibles · {cities.length} ciudades · {cityDesks.length} puestos de ciudad</p>
      {!current && <p role="status" className="mt-2 text-sm text-amber-200">{snapshot.isLoading ? "Consultando KONG…" : "Actividad de KONG sin verificar. Comprueba la conexión con el backend."}</p>}
      {directory.isError && <p role="status" className="mt-2 text-sm text-amber-200">El directorio de ciudades no está disponible.</p>}
      <label className="mt-4 block text-sm" htmlFor="kong-team-search">Buscar agente, ciudad o función</label>
      <input id="kong-team-search" value={search} onChange={event => setSearch(event.target.value)} className="mt-1 w-full rounded-lg border border-white/25 bg-slate-900 px-3 py-2" />
      {query ? (
        <section aria-label="Resultados" className="mt-4 flex flex-wrap gap-2">
          {results.length ? results.map(agentButton) : <p>No se encontraron puestos.</p>}
        </section>
      ) : (
        <div className="mt-4 space-y-4 rounded-2xl border border-lime-300/25 p-3 sm:p-5">
          <section aria-label="Equipo central" className="rounded-2xl border border-cyan-300/25 p-3">
            <h3 className="text-center text-xs font-semibold uppercase text-cyan-200">Operación prioritaria</h3>
            <div className="mt-3 grid grid-cols-2 items-center justify-items-center gap-2 sm:grid-cols-3">
              <div className="col-span-2 rounded-full border border-amber-300/70 bg-amber-300/10 p-3 text-center sm:col-span-1 sm:col-start-2 sm:row-start-2">
                {ceo ? agentButton(ceo) : <span>CEO · Coordinación general</span>}
              </div>
              {priorityDesks.map(agentButton)}
            </div>
          </section>
          <section aria-label="Departamentos y sistemas">
            <h3 className="text-sm font-semibold">Departamentos y sistemas</h3>
            <div className="mt-2 flex flex-wrap gap-2">
              {[...byId.values()].filter(agent => agent.id !== "chief_of_staff" && !priority.includes(agent.id)).map(agentButton)}
            </div>
          </section>
          <section aria-label="Ciudades">
            <h3 className="text-sm font-semibold">Ciudades</h3>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {countries.map(country => (
                <div key={country.code} className="rounded-lg bg-slate-900 p-2">
                  <h4 className="mb-1 text-xs text-slate-300">{country.name}</h4>
                  <div className="flex flex-wrap gap-1">
                    {rooms.filter(room => room.city.countryCode === country.code).map(room => (
                      <button key={room.id} type="button" className={station} aria-pressed={cityId === room.city.id}
                        onClick={() => { setCityId(room.city.id); setSelected(""); }}>{room.name}</button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {city && <div className="mt-3 flex flex-wrap gap-2" aria-label={`Puestos de ${city.name}`}>
              {cityDesks.filter(agent => city.agents.some(job => job.id === agent.id)).map(agentButton)}
            </div>}
          </section>
        </div>
      )}
      {desk && <section aria-live="polite" className="mt-4 rounded-xl border border-cyan-300/30 bg-slate-900 p-4">
        <h3 className="font-semibold">{desk.name}</h3>
        <p className="text-sm">{desk.responsibility}</p>
        <p className="mt-2 text-sm">Responsable · {byId.get(desk.owner)?.name ?? desk.owner}</p>
        <p className="text-sm">{desk.status}</p>
        <p className="text-sm">Última evidencia · {desk.lastRunAt ? new Date(desk.lastRunAt).toLocaleString("es", { timeZone: "America/New_York" }) : "Sin registro"}</p>
        {media[desk.id]?.activity?.map(detail => <p key={detail} className="text-sm">{detail}</p>)}
        {desk.detail && <p className="text-sm">{desk.detail}</p>}
        {desk.blocker && <p className="text-sm text-amber-200">Bloqueo · {desk.blocker}</p>}
      </section>}
    </dialog>
  );
}
