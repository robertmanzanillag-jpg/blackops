import type { QaMissionBreakdown, QaMissionStatus } from '@shared/app-qa-missions';
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  BellRing,
  Bot,
  CheckCircle2,
  ExternalLink,
  Github,
  Lightbulb,
  Loader2,
  MousePointerClick,
  Radar,
  Route,
  Server,
  TriangleAlert,
} from "lucide-react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

type QaSeverity = "critical" | "high" | "medium" | "low" | "info";
type QaStatus = "pass" | "warn" | "fail";

type QaFinding = {
  id: string;
  appName: string;
  area: string;
  severity: QaSeverity;
  title: string;
  detail: string;
  recommendation: string;
  sourceAgent: string;
  url?: string | null;
};

type QaSubAgent = {
  id: string;
  name: string;
  status: QaStatus;
  summary: string;
  checked: number;
  findings: QaFinding[];
};

type QaScan = {
  scannedAt: string;
  totalApps: number;
  totalGithubRepos: number;
  totalGithubAppRepos: number;
  githubConnected: boolean;
  githubError: string | null;
  totalRoutes: number;
  missionBreakdown?: QaMissionBreakdown;
  totalChecks: number;
  failCount: number;
  warnCount: number;
  telegramSent: boolean;
  dailyDigestSent: boolean;
  summary: string;
  council: {
    name: "QA Council";
    status: QaStatus;
    summary: string;
    cadence: string[];
    activeSubAgents: Array<{
      id: string;
      name: string;
      status: QaStatus;
      findings: number;
    }>;
    immediateActions: string[];
    nextSteps: string[];
  };
  subAgents: QaSubAgent[];
  routeMap: Array<{
    path: string;
    label: string;
    expectedClicks: string[];
    status: QaStatus;
    notes: string[];
  }>;
  visualScans: Array<{
    path: string;
    url: string;
    status: QaStatus | "pending";
    title?: string | null;
    consoleErrors: string[];
    clicked: string[];
    screenshotPath?: string | null;
    notes: string[];
  }>;
  githubApps: Array<{
    id: number;
    name: string;
    fullName: string;
    htmlUrl: string;
    homepage?: string | null;
    language?: string | null;
    private: boolean;
    archived?: boolean;
    disabled?: boolean;
    fork?: boolean;
    updatedAt?: string | null;
    pushedAt?: string | null;
    openIssuesCount?: number | null;
    connectedToInventory: boolean;
    checkedUrl?: string | null;
    status: QaStatus;
    notes: string[];
  }>;
  bugPatrol: {
    enabled: boolean;
    scannedFindings: number;
    candidates: number;
    created: number;
    dispatched: number;
    skipped: number;
    failed: number;
    handoffs: Array<{
      findingId: string;
      appName: string;
      severity: QaSeverity;
      title: string;
      repoFullName: string | null;
      status: "created" | "codex_dispatched" | "skipped" | "failed";
      issueUrl?: string;
      issueNumber?: number;
      codexDispatchCommentUrl?: string;
      reason?: string;
    }>;
  };
  findings: QaFinding[];
  improvementIdeas: QaFinding[];
};

type QaHistoryRun = {
  id: string;
  startedAt: string;
  finishedAt?: string | null;
  status: "success" | "failed" | "skipped" | "pending_approval";
  resultSummary?: string | null;
  errorMessage?: string | null;
  metadata?: {
    councilStatus?: QaStatus;
    failCount?: number;
    warnCount?: number;
    totalApps?: number;
    totalGithubRepos?: number;
    totalGithubAppRepos?: number;
    githubConnected?: boolean;
    telegramSent?: boolean;
    dailyDigestSent?: boolean;
    bugPatrol?: {
      candidates?: number;
      created?: number;
      dispatched?: number;
      skipped?: number;
      failed?: number;
    };
  } | null;
};

const severityStyle: Record<QaSeverity, string> = {
  critical: "border-red-400/40 bg-red-500/12 text-red-100",
  high: "border-orange-300/40 bg-orange-500/12 text-orange-100",
  medium: "border-amber-300/35 bg-amber-500/10 text-amber-100",
  low: "border-cyan-300/30 bg-cyan-500/10 text-cyan-100",
  info: "border-zinc-300/25 bg-zinc-500/10 text-zinc-100",
};

const statusStyle: Record<QaStatus, string> = {
  pass: "border-emerald-300/30 bg-emerald-500/10 text-emerald-100",
  warn: "border-amber-300/35 bg-amber-500/10 text-amber-100",
  fail: "border-red-400/40 bg-red-500/12 text-red-100",
};

const missionStatusLabels: Record<QaMissionStatus, string> = { pass: 'Verificada', warn: 'Avisos', fail: 'Fallos', pending: 'Verificación pendiente' };
const missionStatusStyle = { ...statusStyle, pending: 'border-zinc-400/30 bg-zinc-500/10 text-zinc-200' };

const agentIcon: Record<string, typeof Route> = {
  "route-scout": Route,
  "link-click-scout": MousePointerClick,
  "visual-click-scout": MousePointerClick,
  "github-scout": Github,
  "api-scout": Server,
  "error-scout": TriangleAlert,
  "improvement-scout": Lightbulb,
};

export default function AppQaAgentPage() {
  const { data, isLoading } = useQuery<QaScan>({
    queryKey: ["/api/app-qa-agent/status"],
  });
  const { data: history = [] } = useQuery<QaHistoryRun[]>({
    queryKey: ["/api/app-qa-agent/history"],
  });

  const scanMutation = useMutation<QaScan, Error, boolean>({
    mutationFn: async (notify) => {
      const response = await apiRequest("POST", "/api/app-qa-agent/scan", { notify });
      return response.json() as Promise<QaScan>;
    },
    onSuccess: (result) => {
      queryClient.setQueryData(["/api/app-qa-agent/status"], result);
      queryClient.invalidateQueries({ queryKey: ["/api/app-qa-agent/history"] });
    },
  });

  const scan = scanMutation.data || data;
  const topFindings = scan?.findings?.slice(0, 12) || [];

  return (
    <div className="min-h-screen bg-[#05070a] text-white">
      <div className="pointer-events-none fixed inset-0 bg-[linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[length:72px_72px]" />
      <main className="relative mx-auto max-w-6xl px-4 py-6 md:px-8">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-5">
          <div className="flex items-center gap-3">
            <Link href="/agents-office">
              <Button variant="ghost" size="icon" data-testid="button-back-office">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-emerald-200/25 bg-emerald-300/10">
              <Bot className="h-6 w-6 text-emerald-100" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-200">App QA Agent</p>
              <h1 className="text-2xl font-semibold">Subagentes revisando paginas, links y errores</h1>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={scanMutation.isPending}
              onClick={() => scanMutation.mutate(false)}
              className="border-white/15 bg-black/40 text-white hover:bg-white/10"
            >
              {scanMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Radar className="mr-2 h-4 w-4" />}
              Correr patrulla
            </Button>
            <Button
              type="button"
              disabled={scanMutation.isPending}
              onClick={() => scanMutation.mutate(true)}
              className="bg-emerald-100 text-black hover:bg-white"
            >
              <BellRing className="mr-2 h-4 w-4" />
              Reportar por Telegram
            </Button>
          </div>
        </header>

        <section className="mb-5 grid gap-3 md:grid-cols-6">
          {[
            ["Apps", scan?.totalApps ?? 0, "Inventario"],
            ["GitHub", scan?.githubConnected ? scan.totalGithubRepos : "No", scan?.githubConnected ? `${scan.totalGithubAppRepos} apps` : scan?.githubError || "No conectado"],
            ["Paginas", scan?.totalRoutes ?? 0, "Mapa local"],
            ["Checks", scan?.totalChecks ?? 0, "Subagentes"],
            ["Bloqueos", scan?.failCount ?? 0, "Alta prioridad"],
            ["Avisos", scan?.warnCount ?? 0, "Mejoras"],
          ].map(([label, value, detail]) => (
            <Card key={label} className="border-white/10 bg-[#0a1118]/86">
              <CardContent className="p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">{label}</p>
                <p className="mt-2 text-3xl font-semibold text-white">{value}</p>
                <p className="mt-1 text-sm text-zinc-500">{detail}</p>
              </CardContent>
            </Card>
          ))}
        </section>

        <Card className="mb-5 border-emerald-200/15 bg-[#0a1118]/90">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
            <div className="flex items-start gap-3">
              <div className={cn("mt-1 rounded-lg border p-2", scan?.failCount ? statusStyle.fail : scan?.warnCount ? statusStyle.warn : statusStyle.pass)}>
                {scan?.failCount || scan?.warnCount ? <TriangleAlert className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />}
              </div>
              <div>
                <h2 className="text-lg font-semibold">{isLoading ? "Los subagentes estan revisando..." : scan?.summary || "Sin datos todavia"}</h2>
                <p className="mt-1 text-sm text-zinc-500">
                  Ultima patrulla: {scan?.scannedAt ? new Date(scan.scannedAt).toLocaleString() : "pendiente"}.
                  {scan?.telegramSent ? " Telegram enviado." : " Telegram automatico solo si hay fallos altos o criticos."}
                  {scan?.dailyDigestSent ? " Digest diario enviado." : ""}
                </p>
              </div>
            </div>
            <Badge className="border-emerald-200/25 bg-emerald-300/10 text-emerald-100">Scheduler cada 30 min</Badge>
          </CardContent>
        </Card>

        <Card className="mb-5 border-white/10 bg-[#0a1118]/86">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-white">
              <Radar className="h-5 w-5 text-emerald-200" />
              Bug Patrol
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-5">
              {[
                ["Candidatos", scan?.bugPatrol?.candidates ?? 0],
                ["Handoffs", (scan?.bugPatrol?.created ?? 0) + (scan?.bugPatrol?.dispatched ?? 0)],
                ["Codex", scan?.bugPatrol?.dispatched ?? 0],
                ["Pendientes", scan?.bugPatrol?.skipped ?? 0],
                ["Fallidos", scan?.bugPatrol?.failed ?? 0],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border border-white/10 bg-black/24 p-3">
                  <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">{label}</p>
                  <p className="mt-1 text-2xl font-semibold text-white">{value}</p>
                </div>
              ))}
            </div>
            <div className="space-y-2">
              {(scan?.bugPatrol?.handoffs || []).slice(0, 4).map((handoff) => (
                <div key={`${handoff.findingId}-${handoff.status}`} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/22 p-3 text-sm">
                  <div>
                    <p className="font-medium text-white">{handoff.appName}: {handoff.title}</p>
                    <p className="text-xs text-zinc-500">{handoff.repoFullName || handoff.reason || "Sin repo conectado"}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className={cn("border", handoff.status === "failed" ? statusStyle.fail : handoff.status === "skipped" ? statusStyle.warn : statusStyle.pass)}>
                      {handoff.status}
                    </Badge>
                    {handoff.issueUrl && (
                      <a href={handoff.issueUrl} target="_blank" rel="noreferrer" className="text-emerald-200 hover:text-white">
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    )}
                  </div>
                </div>
              ))}
              {scan?.bugPatrol && scan.bugPatrol.handoffs.length === 0 && (
                <p className="rounded-lg border border-emerald-300/15 bg-emerald-500/8 p-3 text-sm text-emerald-100">
                  No hubo bugs nuevos para mandar a Codex en esta patrulla.
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="mb-5 border-white/10 bg-[#0a1118]/86">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-white">
              <Bot className="h-5 w-5 text-emerald-200" />
              QA Council
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 lg:grid-cols-[1fr_1fr]">
            <div className="rounded-lg border border-white/10 bg-black/24 p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold text-white">{scan?.council?.summary || "Esperando patrulla"}</h3>
                {scan?.council && <Badge className={cn("border", statusStyle[scan.council.status])}>{scan.council.status}</Badge>}
              </div>
              <div className="flex flex-wrap gap-2">
                {scan?.council?.cadence.map((item) => (
                  <span key={item} className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-xs text-zinc-300">
                    {item}
                  </span>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-white/10 bg-black/24 p-4">
              <h3 className="mb-3 font-semibold text-white">Siguientes acciones</h3>
              <div className="space-y-2 text-sm text-zinc-300">
                {(scan?.council?.immediateActions.length ? scan.council.immediateActions : scan?.council?.nextSteps || []).slice(0, 5).map((item) => (
                  <p key={item}>{item}</p>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
          <Card className="border-white/10 bg-[#0a1118]/86">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-white">
                <Bot className="h-5 w-5 text-emerald-200" />
                Subagentes
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {scan?.subAgents?.map((agent) => {
                const Icon = agentIcon[agent.id] || Bot;
                return (
                  <div key={agent.id} className="rounded-lg border border-white/10 bg-black/26 p-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-3">
                        <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/5">
                          <Icon className="h-4 w-4 text-emerald-100" />
                        </span>
                        <div>
                          <h3 className="font-semibold text-white">{agent.name}</h3>
                          <p className="text-xs text-zinc-500">{agent.checked} checks</p>
                        </div>
                      </div>
                      <Badge className={cn("border", statusStyle[agent.status])}>{agent.status}</Badge>
                    </div>
                    <p className="text-sm text-zinc-300">{agent.summary}</p>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-[#0a1118]/86">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-white">
                <TriangleAlert className="h-5 w-5 text-emerald-200" />
                Hallazgos principales
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!topFindings.length && (
                <div className="rounded-lg border border-emerald-300/20 bg-emerald-500/8 p-4 text-sm text-emerald-100">
                  Sin hallazgos abiertos en esta patrulla.
                </div>
              )}
              {topFindings.map((finding) => (
                <div key={finding.id} className="rounded-lg border border-white/10 bg-black/26 p-4">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-xs text-zinc-500">{finding.appName} / {finding.area}</p>
                      <h3 className="font-semibold text-white">{finding.title}</h3>
                    </div>
                    <Badge className={cn("border", severityStyle[finding.severity])}>{finding.severity}</Badge>
                  </div>
                  <p className="text-sm text-zinc-300">{finding.detail}</p>
                  <p className="mt-2 text-sm text-emerald-100">{finding.recommendation}</p>
                  {finding.url && (
                    <a href={finding.url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs text-cyan-100 hover:text-white">
                      Abrir referencia <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <Card className="mt-5 border-white/10 bg-[#0a1118]/86">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-white">
              <MousePointerClick className="h-5 w-5 text-emerald-200" />
              Visual Click Scout
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!scan?.visualScans?.length && (
              <div className="rounded-lg border border-white/10 bg-black/24 p-4 text-sm text-zinc-400">
                Visual Click Scout todavia no corrio. Necesita Playwright instalado y APP_QA_BASE_URL configurado.
              </div>
            )}
            {scan?.visualScans?.slice(0, 16).map((item) => (
              <div key={item.path} className="rounded-lg border border-white/10 bg-black/24 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold text-white">{item.path}</p>
                    <p className="text-xs text-zinc-500">{item.title || item.url}</p>
                  </div>
                  <Badge className={cn("border", missionStatusStyle[item.status])}>{item.status === "pending" ? missionStatusLabels.pending : item.status}</Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {item.notes.map((note) => (
                    <span key={note} className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-xs text-zinc-300">
                      {note}
                    </span>
                  ))}
                  {item.clicked.map((click) => (
                    <span key={click} className="rounded-full border border-emerald-300/20 bg-emerald-400/10 px-2 py-1 text-xs text-emerald-100">
                      click: {click}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="mt-5 border-white/10 bg-[#0a1118]/86">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-white">
              <Github className="h-5 w-5 text-emerald-200" />
              Apps detectados en GitHub
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!scan?.githubConnected && (
              <div className="rounded-lg border border-red-300/20 bg-red-500/8 p-4 text-sm text-red-100">
                GitHub no esta conectado para esta patrulla. {scan?.githubError || "Conecta GitHub para revisar todos los repos y detectar apps nuevos."}
              </div>
            )}
            {scan?.githubConnected && !scan.githubApps.length && (
              <div className="rounded-lg border border-emerald-300/20 bg-emerald-500/8 p-4 text-sm text-emerald-100">
                GitHub esta conectado, pero no encontre repos que parezcan apps en esta patrulla.
              </div>
            )}
            {scan?.githubApps?.slice(0, 16).map((repo) => (
              <div key={repo.id} className="rounded-lg border border-white/10 bg-black/24 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-white">{repo.fullName}</p>
                    <p className="text-xs text-zinc-500">
                      {repo.language || "sin lenguaje"} - {repo.private ? "privado" : "publico"} - {repo.connectedToInventory ? "en Developer Health" : "nuevo/fuera del inventario"}
                    </p>
                  </div>
                  <Badge className={cn("border", statusStyle[repo.status])}>{repo.status}</Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {repo.notes.map((note) => (
                    <span key={note} className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-xs text-zinc-300">
                      {note}
                    </span>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap gap-3 text-xs">
                  {repo.homepage && (
                    <a href={repo.homepage} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-cyan-100 hover:text-white">
                      Abrir deploy <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                  <a href={repo.htmlUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-zinc-300 hover:text-white">
                    Abrir repo <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="mt-5 border-white/10 bg-[#0a1118]/86">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-white">
              <Radar className="h-5 w-5 text-emerald-200" />
              Historial de patrullas
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!history.length && (
              <div className="rounded-lg border border-white/10 bg-black/24 p-4 text-sm text-zinc-400">
                Todavia no hay patrullas guardadas. Corre una patrulla manual o espera al scheduler.
              </div>
            )}
            {history.slice(0, 8).map((run) => (
              <div key={run.id} className="rounded-lg border border-white/10 bg-black/24 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold text-white">{run.resultSummary || "Patrulla App QA"}</p>
                    <p className="text-xs text-zinc-500">{new Date(run.startedAt).toLocaleString()}</p>
                  </div>
                  <Badge className={cn("border", statusStyle[run.metadata?.councilStatus || "pass"])}>{run.metadata?.councilStatus || run.status}</Badge>
                </div>
                <p className="mt-2 text-sm text-zinc-400">
                  Fallos: {run.metadata?.failCount ?? 0} - Avisos: {run.metadata?.warnCount ?? 0} - GitHub apps: {run.metadata?.totalGithubAppRepos ?? 0}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>

        <section className="mt-5" aria-label="Cobertura y resultados por misión">
          <h2 className="mb-3 text-xl font-semibold text-white">Cobertura y resultados por misión</h2>
          {!scan?.missionBreakdown ? <p role="status" className="rounded-lg border border-amber-300/30 p-4 text-sm text-amber-100">Resumen por misiones no disponible. Espera el reporte del servidor; no se acredita cobertura ni verificación.</p> : <>
            <p className="mb-4 text-sm text-zinc-300">{scan.missionBreakdown.coverage.classifiedRoutes}/{scan.missionBreakdown.coverage.totalRoutes} rutas clasificadas. Inventariar una ruta no acredita su ejecución. Los resultados del navegador se muestran por separado.</p>
            {!!(scan.missionBreakdown.coverage.unclassifiedPaths.length + scan.missionBreakdown.coverage.duplicatePaths.length + scan.missionBreakdown.coverage.missingPaths.length) && <p role="alert" className="mb-4 rounded-lg border border-red-300/30 p-4 text-sm text-red-100">Cobertura incompleta. Sin misión: {scan.missionBreakdown.coverage.unclassifiedPaths.join(', ') || 'ninguna'}. Duplicadas: {scan.missionBreakdown.coverage.duplicatePaths.join(', ') || 'ninguna'}. Sin inventariar: {scan.missionBreakdown.coverage.missingPaths.join(', ') || 'ninguna'}.</p>}
            <p className="mb-4 text-sm text-zinc-400">Hallazgos globales: {scan.missionBreakdown.globalFindingIds.length}. Dependencias, APIs y apps externas siguen en el gate y afectan el estado de las misiones.</p>
            <div className="grid gap-4 lg:grid-cols-2">
              {scan.missionBreakdown.missions.map(mission => <Card key={mission.id} className="min-w-0 border-white/10 bg-[#0a1118]/86" data-testid={`qa-mission-${mission.id}`}>
                <CardHeader><CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base text-white"><span>{mission.label}</span><Badge className={cn('border', missionStatusStyle[mission.status])}>{missionStatusLabels[mission.status]}</Badge></CardTitle></CardHeader>
                <CardContent>
                  <p className="mb-3 text-sm text-zinc-300">Navegador: {mission.reviewedRoutes}/{mission.routeCount} rutas revisadas · {mission.passedRoutes} sin fallos. Hallazgos de misión: {mission.localFindingCount}; globales: {mission.globalFindingCount}.</p>
                  <ul className="space-y-3">{mission.routes.map(route => <li key={route.path} className="rounded-lg border border-white/10 bg-black/25 p-3">
                    <p className="font-medium text-white">{route.label}</p><p className="break-all text-xs text-zinc-400">{route.path}</p>
                    <p className="mt-2 text-xs text-zinc-300">Inventario: {route.inventoryStatus}. Navegador: {missionStatusLabels[route.visualStatus]}.</p>
                    <div className="mt-2 flex flex-wrap gap-2">{scan.routeMap.find(item => item.path === route.path)?.expectedClicks.map(click => <span key={click} className="rounded-full border border-white/10 px-2 py-1 text-xs text-zinc-300">{click}</span>)}</div>
                  </li>)}</ul>
                </CardContent>
              </Card>)}
            </div>
          </>}
        </section>
      </main>
    </div>
  );
}
