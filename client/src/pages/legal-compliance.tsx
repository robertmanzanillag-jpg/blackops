import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  GitBranch,
  GitPullRequest,
  Loader2,
  Route,
  Scale,
  ShieldCheck,
} from "lucide-react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type LegalSeverity = "critico" | "revisar" | "info";

type LegalComplianceReport = {
  id: string;
  appName: string;
  source: "developer_health" | "projects" | "github";
  repo: string;
  url?: string | null;
  ownerAgent: "Legal Main";
  scoutAgent: string;
  operatingModel: "central_review" | "app_scout_to_main";
  escalationPath: string[];
  severity: LegalSeverity;
  summary: string;
  checks: string[];
  riskAreas: string[];
  evidenceSources: string[];
  nextAction: string;
  disclaimer: string;
};

type LegalComplianceRun = {
  generatedAt: string;
  totalTargets: number;
  githubConnected: boolean;
  githubError: string | null;
  sourceErrors: string[];
  summary: {
    critico: number;
    revisar: number;
    info: number;
  };
  reports: LegalComplianceReport[];
};

const severityStyle: Record<LegalSeverity, string> = {
  critico: "border-red-300/40 bg-red-500/12 text-red-100",
  revisar: "border-amber-300/40 bg-amber-500/12 text-amber-100",
  info: "border-cyan-300/30 bg-cyan-500/10 text-cyan-100",
};

const sourceLabel: Record<LegalComplianceReport["source"], string> = {
  developer_health: "App monitor",
  projects: "Projects",
  github: "GitHub",
};

function formatGeneratedAt(value?: string) {
  if (!value) return "Pendiente";
  return new Date(value).toLocaleString();
}

export default function LegalCompliancePage() {
  const { data, isLoading, error } = useQuery<LegalComplianceRun>({
    queryKey: ["/api/legal-compliance/reports"],
  });

  const reports = data?.reports || [];

  return (
    <div className="min-h-screen bg-[#03060b] text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top,rgba(167,139,250,0.16),transparent_35%),linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[length:auto,72px_72px,72px_72px]" />
      <main className="relative mx-auto max-w-6xl px-4 py-6 md:px-8">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-5">
          <div className="flex items-center gap-3">
            <Link href="/agents-office">
              <Button variant="ghost" size="icon" data-testid="button-back-office">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-violet-200/25 bg-violet-300/10 shadow-[0_0_30px_rgba(167,139,250,0.16)]">
              <Scale className="h-6 w-6 text-violet-100" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-violet-200">Legal Main</p>
              <h1 className="text-2xl font-semibold">Compliance de apps y repos</h1>
            </div>
          </div>
          <Link href="/tools">
            <Button variant="outline" className="border-white/15 bg-black/40 text-white hover:bg-white/10">
              Herramientas
            </Button>
          </Link>
        </header>

        <section className="mb-5 grid gap-3 md:grid-cols-5">
          {[
            ["Targets", data?.totalTargets ?? 0, "Apps + repos"],
            ["Critico", data?.summary.critico ?? 0, "Bloquear/revisar"],
            ["Revisar", data?.summary.revisar ?? 0, "Pedir contexto"],
            ["Info", data?.summary.info ?? 0, "Seguimiento"],
            ["GitHub", data?.githubConnected ? "OK" : "No", data?.githubConnected ? "Repos leidos" : data?.githubError || "Sin conexion"],
          ].map(([label, value, detail]) => (
            <Card key={label} className="border-white/10 bg-[#080d18]/84">
              <CardContent className="p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">{label}</p>
                <p className="mt-2 text-3xl font-semibold text-white">{value}</p>
                <p className="mt-1 text-sm text-zinc-500">{detail}</p>
              </CardContent>
            </Card>
          ))}
        </section>

        <div className="mb-5 grid gap-5 lg:grid-cols-[0.95fr_1.05fr]">
          <Card className="border-violet-200/15 bg-[#080d18]/88">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-white">
                <Route className="h-5 w-5 text-violet-200" />
                Modelo operativo
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-zinc-300">
              <p>
                Legal Main concentra las decisiones legales. Los scouts de cada app detectan riesgos de su area y escalan lo importante.
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {[
                  ["Kong Legal Scout", "venues, promoters, mesas, mensajes y eventos"],
                  ["Black Room Legal Scout", "flyers, media, artistas, eventos y copyright"],
                  ["Clippers Legal Scout", "fuentes de video, permisos y reglas de plataformas"],
                  ["Revenue Legal Scout", "deals, websites, claims, leads y tracking"],
                  ["Security Legal Scout", "datos, secretos, accesos y exposicion publica"],
                  ["Legal Main", "apps genericas y decision final"],
                ].map(([name, detail]) => (
                  <div key={name} className="rounded-xl border border-white/10 bg-black/24 p-3">
                    <p className="font-semibold text-white">{name}</p>
                    <p className="mt-1 text-xs text-zinc-500">{detail}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-[#080d18]/88">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-white">
                <ShieldCheck className="h-5 w-5 text-violet-200" />
                Estado del monitor
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-xl border border-white/10 bg-black/24 p-4">
                <p className="text-sm text-zinc-500">Ultima lectura</p>
                <p className="mt-1 font-semibold text-white">{formatGeneratedAt(data?.generatedAt)}</p>
              </div>
              {isLoading && (
                <div className="flex items-center gap-2 rounded-xl border border-violet-200/15 bg-violet-300/8 p-4 text-sm text-violet-100">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Leyendo apps, repos y scouts legales...
                </div>
              )}
              {error && (
                <div className="rounded-xl border border-red-300/20 bg-red-500/8 p-4 text-sm text-red-100">
                  No pude cargar Legal / Compliance ahora mismo.
                </div>
              )}
              {Boolean(data?.sourceErrors?.length) && (
                <div className="rounded-xl border border-amber-300/20 bg-amber-500/8 p-4 text-sm text-amber-100">
                  <p className="mb-2 font-semibold">Fuentes incompletas</p>
                  {data?.sourceErrors.map((sourceError) => <p key={sourceError}>{sourceError}</p>)}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="border-white/10 bg-[#080d18]/88">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-white">
              <GitPullRequest className="h-5 w-5 text-violet-200" />
              Reportes por app
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!isLoading && reports.length === 0 && (
              <div className="rounded-xl border border-white/10 bg-black/24 p-5 text-sm text-zinc-400">
                Todavia no hay apps o repos detectados para revisar.
              </div>
            )}

            {reports.map((report) => (
              <article key={report.id} className="rounded-2xl border border-white/10 bg-black/28 p-4">
                <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <Badge className={cn("border", severityStyle[report.severity])}>{report.severity}</Badge>
                      <Badge variant="outline" className="border-white/10 text-zinc-300">{sourceLabel[report.source]}</Badge>
                    </div>
                    <h2 className="text-lg font-semibold text-white">{report.appName}</h2>
                    <p className="mt-1 break-all text-sm text-zinc-500">{report.repo}</p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-right text-xs text-zinc-400">
                    <p className="font-semibold text-white">{report.scoutAgent || "Legal Main"}</p>
                    <p>owner: {report.ownerAgent || "Legal Main"}</p>
                  </div>
                </div>

                <p className="text-sm text-zinc-300">{report.summary}</p>

                <div className="mt-4 grid gap-3 lg:grid-cols-3">
                  <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                    <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                      <CheckCircle2 className="h-4 w-4" />
                      Checks
                    </p>
                    <ul className="space-y-2 text-sm text-zinc-300">
                      {report.checks.map((check) => <li key={check}>{check}</li>)}
                    </ul>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                    <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                      <AlertTriangle className="h-4 w-4" />
                      Riesgos
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {report.riskAreas.map((risk) => (
                        <span key={risk} className="rounded-full border border-violet-200/15 bg-violet-300/8 px-2 py-1 text-xs text-violet-100">
                          {risk}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                    <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                      <GitBranch className="h-4 w-4" />
                      Escalacion
                    </p>
                    <p className="text-sm text-zinc-300">{report.escalationPath.join(" -> ")}</p>
                    <p className="mt-3 text-sm text-violet-100">{report.nextAction}</p>
                  </div>
                </div>

                <p className="mt-3 text-xs text-zinc-600">{report.disclaimer}</p>
              </article>
            ))}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
