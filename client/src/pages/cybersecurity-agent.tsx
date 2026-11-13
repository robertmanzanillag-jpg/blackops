import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  BellRing,
  CheckCircle2,
  DownloadCloud,
  Loader2,
  Radar,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

type CyberThreatSeverity = "critical" | "high" | "medium" | "low";

type CyberThreat = {
  id: string;
  appName: string;
  appUrl?: string | null;
  severity: CyberThreatSeverity;
  title: string;
  detail: string;
  recommendation: string;
  signal: "uptime" | "https" | "incidents" | "repo" | "coverage" | "priority" | "github";
};

type CyberSkill = {
  id: string;
  name: string;
  priority: CyberThreatSeverity;
  helpsWith: string;
  nextStep: string;
};

type CybersecurityScan = {
  scannedAt: string;
  totalApps: number;
  totalLegacyProjects: number;
  totalGithubRepos: number;
  githubConnected: boolean;
  githubError: string | null;
  threatCount: number;
  criticalCount: number;
  highCount: number;
  telegramSent: boolean;
  summary: string;
  threats: CyberThreat[];
  githubRepos: Array<{
    id: number;
    name: string;
    fullName: string;
    private: boolean;
    archived?: boolean;
    disabled?: boolean;
    fork?: boolean;
    language?: string | null;
    homepage?: string | null;
    htmlUrl: string;
    updatedAt?: string | null;
    pushedAt?: string | null;
    openIssuesCount?: number | null;
    connectedToMonitor: boolean;
    risk: CyberThreatSeverity;
    notes: string[];
  }>;
  skills: CyberSkill[];
};

type CyberInventoryImportResult = {
  imported: number;
  skipped: number;
  totalGithubRepos: number;
  githubConnected: boolean;
  apps: Array<{
    id: string;
    name: string;
    githubRepo?: string | null;
    publicUrl?: string | null;
    healthUrl?: string | null;
  }>;
  skippedRepos: Array<{
    fullName: string;
    reason: string;
  }>;
};

const severityStyle: Record<CyberThreatSeverity, string> = {
  critical: "border-red-400/40 bg-red-500/12 text-red-100",
  high: "border-orange-300/40 bg-orange-500/12 text-orange-100",
  medium: "border-amber-300/35 bg-amber-500/10 text-amber-100",
  low: "border-cyan-300/30 bg-cyan-500/10 text-cyan-100",
};

export default function CybersecurityAgentPage() {
  const { data, isLoading } = useQuery<CybersecurityScan>({
    queryKey: ["/api/cybersecurity-agent/status"],
  });

  const scanMutation = useMutation({
    mutationFn: async (notify: boolean) => {
      const response = await apiRequest("POST", "/api/cybersecurity-agent/scan", { notify });
      return response.json() as Promise<CybersecurityScan>;
    },
    onSuccess: (result) => {
      queryClient.setQueryData(["/api/cybersecurity-agent/status"], result);
    },
  });

  const importMissingAppsMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/cybersecurity-agent/import-missing-apps", {});
      return response.json() as Promise<CyberInventoryImportResult>;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/developer-health/apps"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/cybersecurity-agent/status"] });
      scanMutation.mutate(false);
    },
  });

  const scan = scanMutation.data || data;
  const hasThreats = Boolean(scan?.threatCount);
  const disconnectedGithubApps = scan?.githubRepos?.filter((repo) => !repo.connectedToMonitor && repo.risk !== "low").length ?? 0;

  return (
    <div className="min-h-screen bg-[#03070c] text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.14),transparent_34%),linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[length:auto,72px_72px,72px_72px]" />
      <main className="relative mx-auto max-w-6xl px-4 py-6 md:px-8">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-5">
          <div className="flex items-center gap-3">
            <Link href="/agents-office">
              <Button variant="ghost" size="icon" data-testid="button-back-office">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-cyan-200/25 bg-cyan-300/10 shadow-[0_0_30px_rgba(34,211,238,0.16)]">
              <ShieldCheck className="h-6 w-6 text-cyan-100" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200">Cybersecurity Agent</p>
              <h1 className="text-2xl font-semibold">Proteccion de apps y amenazas</h1>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={importMissingAppsMutation.isPending || !scan?.githubConnected}
              onClick={() => importMissingAppsMutation.mutate()}
              className="border-white/15 bg-black/40 text-white hover:bg-white/10"
            >
              {importMissingAppsMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <DownloadCloud className="mr-2 h-4 w-4" />}
              Importar apps
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={scanMutation.isPending}
              onClick={() => scanMutation.mutate(false)}
              className="border-white/15 bg-black/40 text-white hover:bg-white/10"
            >
              {scanMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Radar className="mr-2 h-4 w-4" />}
              Escanear
            </Button>
            <Button
              type="button"
              disabled={scanMutation.isPending}
              onClick={() => scanMutation.mutate(true)}
              className="bg-cyan-100 text-black hover:bg-white"
            >
              <BellRing className="mr-2 h-4 w-4" />
              Reportar por Telegram
            </Button>
          </div>
        </header>

        <section className="mb-5 grid gap-3 md:grid-cols-4">
          {[
            ["Apps", scan?.totalApps ?? 0, "Developer Health"],
            ["Projects", scan?.totalLegacyProjects ?? 0, "Monitor legacy"],
            ["GitHub", scan?.githubConnected ? scan.totalGithubRepos : "No", scan?.githubConnected ? "Repos revisados" : scan?.githubError || "No conectado"],
            ["Amenazas", scan?.threatCount ?? 0, "Senales abiertas"],
            ["Altas/Criticas", `${scan?.highCount ?? 0}/${scan?.criticalCount ?? 0}`, "Prioridad real"],
          ].map(([label, value, detail]) => (
            <Card key={label} className="border-white/10 bg-[#07101b]/82">
              <CardContent className="p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">{label}</p>
                <p className="mt-2 text-3xl font-semibold text-white">{value}</p>
                <p className="mt-1 text-sm text-zinc-500">{detail}</p>
              </CardContent>
            </Card>
          ))}
        </section>

        <Card className="mb-5 border-cyan-200/15 bg-[#07101b]/86">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
            <div className="flex items-start gap-3">
              <div className={cn("mt-1 rounded-xl border p-2", hasThreats ? "border-orange-300/35 bg-orange-500/10" : "border-emerald-300/30 bg-emerald-500/10")}>
                {hasThreats ? <TriangleAlert className="h-5 w-5 text-orange-200" /> : <CheckCircle2 className="h-5 w-5 text-emerald-200" />}
              </div>
              <div>
                <h2 className="text-lg font-semibold">{isLoading ? "Escaneando..." : scan?.summary || "Sin datos todavia"}</h2>
                <p className="mt-1 text-sm text-zinc-500">
                  Ultimo scan: {scan?.scannedAt ? new Date(scan.scannedAt).toLocaleString() : "pendiente"}.
                  {scan?.telegramSent ? " Telegram enviado." : " Telegram se manda si lo pides o si detecta caidas, HTTPS inseguro o incidentes urgentes."}
                </p>
                {importMissingAppsMutation.data && (
                  <p className="mt-2 text-sm text-cyan-100">
                    Inventario actualizado: {importMissingAppsMutation.data.imported} apps importadas, {importMissingAppsMutation.data.skipped} repos omitidos.
                  </p>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge className="border-cyan-200/25 bg-cyan-300/10 text-cyan-100">Monitor cada 15 min</Badge>
              {disconnectedGithubApps > 0 && (
                <Badge className="border-amber-300/25 bg-amber-400/10 text-amber-100">{disconnectedGithubApps} repos por importar</Badge>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-5 lg:grid-cols-[1.35fr_0.85fr]">
          <div className="space-y-5">
            <Card className="border-white/10 bg-[#07101b]/82">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-white">
                <ShieldAlert className="h-5 w-5 text-cyan-200" />
                Amenazas y configuraciones a revisar
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!scan?.threats?.length && (
                <div className="rounded-xl border border-emerald-300/20 bg-emerald-500/8 p-4 text-sm text-emerald-100">
                  No hay amenazas activas en este scan. Buen momento para conectar mas apps y health URLs.
                </div>
              )}
              {scan?.threats?.map((threat) => (
                <div key={threat.id} className="rounded-xl border border-white/10 bg-black/26 p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm text-zinc-500">{threat.appName}</p>
                      <h3 className="font-semibold text-white">{threat.title}</h3>
                    </div>
                    <Badge className={cn("border", severityStyle[threat.severity])}>{threat.severity}</Badge>
                  </div>
                  <p className="text-sm text-zinc-300">{threat.detail}</p>
                  <p className="mt-2 text-sm text-cyan-100">{threat.recommendation}</p>
                </div>
              ))}
            </CardContent>
            </Card>

            <Card className="border-white/10 bg-[#07101b]/82">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-white">
                  <Radar className="h-5 w-5 text-cyan-200" />
                  GitHub completo
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {!scan?.githubConnected && (
                  <div className="rounded-xl border border-amber-300/20 bg-amber-500/8 p-4 text-sm text-amber-100">
                    GitHub no esta conectado para este scan. {scan?.githubError || "Conecta GitHub para revisar todos tus repos."}
                  </div>
                )}
                {scan?.githubRepos?.slice(0, 12).map((repo) => (
                  <div key={repo.id} className="rounded-xl border border-white/10 bg-black/24 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-white">{repo.fullName}</p>
                        <p className="text-xs text-zinc-500">
                          {repo.language || "sin lenguaje"} · {repo.private ? "privado" : "publico"} · {repo.connectedToMonitor ? "conectado al monitor" : "fuera del monitor"}
                        </p>
                      </div>
                      <Badge className={cn("border", severityStyle[repo.risk])}>{repo.risk}</Badge>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {repo.notes.map((note) => (
                        <span key={note} className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-xs text-zinc-300">
                          {note}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <Card className="border-white/10 bg-[#07101b]/82">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-white">
                <Sparkles className="h-5 w-5 text-cyan-200" />
                Skills para mejorar
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {scan?.skills?.map((skill) => (
                <div key={skill.id} className="rounded-xl border border-cyan-200/14 bg-cyan-300/6 p-4">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h3 className="font-semibold text-white">{skill.name}</h3>
                    <Badge className={cn("border", severityStyle[skill.priority])}>{skill.priority}</Badge>
                  </div>
                  <p className="text-sm text-zinc-400">{skill.helpsWith}</p>
                  <p className="mt-2 text-sm text-cyan-100">{skill.nextStep}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
