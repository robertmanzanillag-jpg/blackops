import { useQuery } from "@tanstack/react-query";
import { parseClippersOrchestraStatus, type ClippersOrchestraStatus } from "@shared/clippers-orchestra";
import { growthRows } from "@shared/clippers-growth-view";

const ENDPOINT = "/api/clippers/orchestra/status";
const fmt = (value: number | null) => value === null ? "—" : new Intl.NumberFormat("es").format(value);

/** Panel central: per-account Clippers weekly views, median, publish mode and decisions (owner-only read; hidden otherwise). */
export function ClippersCentralGrowth() {
  const query = useQuery<ClippersOrchestraStatus>({
    queryKey: [ENDPOINT, "central-panel-growth"],
    queryFn: async ({ signal }) => {
      const response = await fetch(ENDPOINT, { signal, credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("unavailable");
      const data = parseClippersOrchestraStatus(await response.json());
      if (!data) throw new Error("invalid");
      return data;
    },
    retry: false, staleTime: 60_000, refetchInterval: 120_000, refetchOnWindowFocus: false,
  });
  const rows = growthRows(query.data?.roles.find(role => role.stage === "learning")?.outputs);
  if (query.isError || !rows.length) return null;
  return <section aria-label="Clippers · crecimiento por cuenta" className="mt-4 rounded-2xl border border-amber-200/20 bg-[#070b14] p-3 text-xs" data-testid="central-clippers-growth">
    <h3 className="font-semibold text-white">Clippers · crecimiento por cuenta (7 días)</h3>
    <ul className="mt-2 grid gap-1 sm:grid-cols-2">{rows.map(row => <li key={row.lane} className="text-zinc-300" data-testid={`central-clippers-growth-${row.lane}`}>
      <span className="text-white">{row.label}</span>: {fmt(row.weeklyViews)} views · mediana {fmt(row.weeklyMedian)} · {row.ownerOverride ? "auto (owner override)" : row.autoPublish ? "auto-publica" : "borradores"} · {fmt(row.decisions)} decisiones
    </li>)}</ul>
  </section>;
}
