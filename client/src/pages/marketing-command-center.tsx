import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, BarChart3, Brain, BriefcaseBusiness, CalendarClock, Layers3, Megaphone, RefreshCcw, ShieldCheck, Sparkles, Target, Users } from "lucide-react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import {kongSupervisorSessionScope,type SupervisorAuth} from "@/components/kong-supervisor-session";

type MarketingClient = {
  id: string;
  name: string;
  clientType: string;
  ownerAgent: string;
  sourceAgent: string;
  status: string;
  priority: string;
  separationKey: string;
  detectedSources?: string[];
  marketingCapabilities?: string[];
  handoff?: { status: string; inbound: string[]; outbound: string[]; dataBoundary: string };
  mission: string;
  primaryAudience: string;
  channels: string[];
  currentFocus: string;
  budgetPolicy: { monthlyCapUsd: number; currentSpendUsd: number; spendMode: string; rule: string };
  approvalPolicy: { canDraftAutonomously: string[]; requiresApproval: string[]; blockedAlways: string[] };
  metrics: { revenueUsd: number; spendUsd: number; orders: number; campaigns: number; posts: number; signals: number; roas: number | null };
  playbook: { brandVoice: string; contentPillars: string[]; offerAngles: string[]; postingCadence: string; successMetrics: string[] };
  nextActions: string[];
  risks: string[];
  learningRules: string[];
};

type MarketingSnapshot = {
  ownerId:string;
  evidence?:{metricsVerified:boolean;externalExecutionVerified:boolean;mode:string};
  cmoAgent: { id: string; name: string; scope: string; status: string; reportsTo: string; mandate: string };
  capacity: { maxClients: number; activeClients: number; openSlots: number; operatingRule: string };
  globalScorecard: {
    clients: number;
    readyClients: number;
    activeClients: number;
    totalRevenueUsd: number;
    totalSpendUsd: number;
    profitSignalUsd: number;
    approvalsNeeded: number;
    learningRuns: number;
  };
  operatingModel: {
    mission: string;
    clientSeparationRules: string[];
    canRunAutonomously: string[];
    requiresApproval: string[];
    blockedAlways: string[];
  };
  subagents: Array<{ id: string; name: string; role: string; status: string; currentFocus: string; autonomousOutputs: string[]; approvalGates: string[] }>;
  skillStack: Array<{ id: string; name: string; category: string; strength: string; usedFor: string; improvementSignal: string }>;
  clients: MarketingClient[];
  detectedMarketingApps: Array<{ clientId: string; clientName: string; status: string; sourceAgent: string; detectedSources: string[]; capabilities: string[]; dataBoundary: string }>;
  workstreams: Array<{ id: string; name: string; status: string; owner: string; output: string; nextMove: string }>;
  selfImprovement: {
    status: string;
    cadence: string;
    latestRun: null | { id: string; createdAt: string; summary: string };
    loops: Array<{ id: string; name: string; status: string; steps: string[] }>;
    guardrails: string[];
    improvementQueue: string[];
  };
  recentLearningRuns: Array<{ id: string; createdAt: string; summary: string; clientsReviewed: number; improvementsQueued: string[]; rulesUpdated: string[] }>;
  executiveSummary: { headline: string; nextCommand: string; budgetPosture: string };
};

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

function statusTone(status: string) {
  if (["active", "ready", "completed", "core"].includes(status)) return "border-emerald-400/40 bg-emerald-400/10 text-emerald-100";
  if (["needs_setup", "needs_data", "needs_signal", "draft_only", "approval_locked", "ready_after_approval", "locked_until_signal"].includes(status)) {
    return "border-amber-400/40 bg-amber-400/10 text-amber-100";
  }
  return "border-red-400/40 bg-red-400/10 text-red-100";
}

export default function MarketingCommandCenterPage() {
  const [lastRun, setLastRun] = useState<{owner:string;summary:string}|null>(null);
  const routerAuth=useQuery<SupervisorAuth>({queryKey:["auth-me"],enabled:false});
  const routerId=routerAuth.data?.user?.id || null;
  const verifiedAuth=useQuery<SupervisorAuth>({queryKey:["marketing-owner-auth",routerId],queryFn:async()=>{const response=await fetch("/api/auth/me",{cache:"no-store"});if(!response.ok)throw Error("Authentication unavailable");return response.json();},enabled:Boolean(routerId)&&!routerAuth.isFetching,staleTime:0,gcTime:0,refetchOnMount:"always",retry:false});
  const owner=kongSupervisorSessionScope(routerAuth.data,verifiedAuth.data,routerAuth.isFetching,verifiedAuth.isFetching,verifiedAuth.isError,routerAuth.isError);
  const { data: snapshot, isLoading, isError } = useQuery<MarketingSnapshot>({
    queryKey: ["marketing-command-center",owner],
    enabled:Boolean(owner),staleTime:0,gcTime:0,retry:false,
    queryFn: async () => {
      const response = await fetch("/api/marketing-command-center");
      if (!response.ok) throw new Error("Failed to load marketing command center");
      const data=await response.json();if(data.ownerId!==owner)throw Error("Marketing owner changed");return data;
    },
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["marketing-command-center",owner] });
  const runMutation = useMutation({
    mutationFn: async () => {if(!owner)throw Error("Authentication required");const data=await postJson<{ summary: string;ownerId:string }>("/api/marketing-command-center/run-day", { focusClientId: "all" });if(data.ownerId!==owner)throw Error("Marketing owner changed");return {...data,owner};},
    onSuccess: (data) => {
      setLastRun({owner:data.owner,summary:data.summary});
      refresh();
    },
  });

  if(!owner || isError)return <div role="alert" className="p-6">Historial privado no disponible. No se ha confirmado que este vacio.</div>;
  if (isLoading || !snapshot) {
    return <div className="flex min-h-screen items-center justify-center bg-black text-sm text-zinc-400">Cargando Marketing HQ...</div>;
  }

  return (
    <div className="min-h-screen bg-zinc-950 px-4 py-6 text-white sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <Link href="/agents-office">
              <Button variant="ghost" className="mb-3 h-9 px-0 text-zinc-400 hover:bg-transparent hover:text-white">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Agents Office
              </Button>
            </Link>
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-400 text-zinc-950">
                <Megaphone className="h-6 w-6" />
              </span>
              <div>
                <h1 className="text-2xl font-semibold">Global Marketing HQ</h1>
                <p className="mt-1 text-sm text-zinc-400">{snapshot.cmoAgent.mandate}</p>
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button onClick={() => runMutation.mutate()} disabled={runMutation.isPending} className="bg-emerald-600 text-white hover:bg-emerald-500">
              <RefreshCcw className="mr-2 h-4 w-4" />
              Guardar preparacion interna
            </Button>
            <Link href="/dropshipping-ceo">
              <Button className="bg-zinc-800 text-white hover:bg-zinc-700">
                <BriefcaseBusiness className="mr-2 h-4 w-4" />
                Dropshipping client
              </Button>
            </Link>
          </div>
        </header>

        <section className="mb-6 grid gap-3 md:grid-cols-6">
          <Metric label="Clientes" value={`${snapshot.globalScorecard.clients}/${snapshot.capacity.maxClients}`} />
          <Metric label="Ready" value={String(snapshot.globalScorecard.readyClients)} />
          <Metric label="Slots libres" value={String(snapshot.capacity.openSlots)} />
          <Metric label="Revenue" value={snapshot.evidence?.metricsVerified?money.format(snapshot.globalScorecard.totalRevenueUsd):"Sin verificar"} />
          <Metric label="Spend" value={snapshot.evidence?.metricsVerified?money.format(snapshot.globalScorecard.totalSpendUsd):"Sin verificar"} />
          <Metric label="Preparaciones guardadas" value={String(snapshot.globalScorecard.learningRuns)} />
        </section>

        {runMutation.isError && <p role="alert">No se confirmo el guardado. Reintentar conserva la misma preparacion diaria.</p>}
        {lastRun?.owner===owner && (
          <Card className="mb-6 border-emerald-400/20 bg-emerald-400/10">
            <CardContent className="p-4 text-sm leading-6 text-emerald-50">{lastRun.summary}</CardContent>
          </Card>
        )}

        <div className="mb-4 grid gap-4 lg:grid-cols-[1fr_0.9fr]">
          <Card className="border-zinc-800 bg-zinc-900/80">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Brain className="h-4 w-4" />
                CMO global
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <p className="font-medium text-white">{snapshot.executiveSummary.headline}</p>
                  <p className="mt-1 text-sm leading-6 text-zinc-400">{snapshot.executiveSummary.nextCommand}</p>
                  <p className="mt-2 text-sm text-zinc-500">{snapshot.executiveSummary.budgetPosture}</p>
                </div>
                <Badge variant="outline" className={cn("shrink-0", statusTone(snapshot.cmoAgent.status))}>{snapshot.cmoAgent.status}</Badge>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                {snapshot.operatingModel.clientSeparationRules.map((rule) => <Info key={rule} label="Separacion" value={rule} />)}
              </div>
            </CardContent>
          </Card>

          <Card className="border-zinc-800 bg-zinc-900/80">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldCheck className="h-4 w-4" />
                Safety gates
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {snapshot.selfImprovement.guardrails.map((guardrail) => (
                <p key={guardrail} className="rounded-lg border border-zinc-800 bg-black px-3 py-2 text-sm leading-5 text-zinc-300">{guardrail}</p>
              ))}
            </CardContent>
          </Card>
        </div>

        <section className="mb-4">
          <div className="mb-3 flex items-center gap-2">
            <Users className="h-4 w-4 text-emerald-300" />
            <h2 className="text-base font-semibold">Clientes internos</h2>
          </div>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            {snapshot.clients.map((client) => (
              <div key={client.id} className="rounded-lg border border-zinc-800 bg-zinc-900/80 p-4">
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-white">{client.name}</p>
                    <p className="mt-1 text-xs text-zinc-500">{client.ownerAgent} / {client.separationKey}</p>
                  </div>
                  <Badge variant="outline" className={cn("shrink-0", statusTone(client.status))}>{client.status}</Badge>
                </div>
                <p className="text-sm leading-6 text-zinc-300">{client.currentFocus}</p>
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-zinc-500">
                  <span>{snapshot.evidence?.metricsVerified?money.format(client.metrics.revenueUsd):"Sin verificar"} rev</span>
                  <span>{snapshot.evidence?.metricsVerified?money.format(client.metrics.spendUsd):"Sin verificar"} spend</span>
                  <span>{snapshot.evidence?.metricsVerified?client.metrics.signals:"Sin verificar"} signals</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-1">
                  {(client.marketingCapabilities || client.channels).slice(0, 4).map((channel) => (
                    <span key={channel} className="rounded-md border border-zinc-800 bg-black px-2 py-1 text-xs text-zinc-400">{channel}</span>
                  ))}
                </div>
                <p className="mt-3 text-xs leading-5 text-zinc-500">{client.handoff?.dataBoundary || client.separationKey}</p>
                <div className="mt-3 space-y-2">
                  {client.nextActions.slice(0, 2).map((action) => (
                    <p key={action} className="text-xs leading-5 text-zinc-400">{action}</p>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-4">
            <Card className="border-zinc-800 bg-zinc-900/80">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Target className="h-4 w-4" />
                  Apps detectadas
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 md:grid-cols-2">
                {snapshot.detectedMarketingApps.map((app) => (
                  <div key={app.clientId} className="rounded-lg border border-zinc-800 bg-black p-3">
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium text-white">{app.clientName}</p>
                        <p className="mt-1 text-xs text-zinc-500">{app.sourceAgent}</p>
                      </div>
                      <Badge variant="outline" className={cn("shrink-0", statusTone(app.status))}>{app.status}</Badge>
                    </div>
                    <p className="text-xs leading-5 text-zinc-400">{app.detectedSources.slice(0, 2).join(" / ")}</p>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="border-zinc-800 bg-zinc-900/80">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Sparkles className="h-4 w-4" />
                  Skills fuertes
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 md:grid-cols-2">
                {snapshot.skillStack.map((skill) => (
                  <div key={skill.id} className="rounded-lg border border-zinc-800 bg-black p-3">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-white">{skill.name}</p>
                      <span className="text-xs text-zinc-500">{skill.category}</span>
                    </div>
                    <p className="text-xs leading-5 text-zinc-400">{skill.usedFor}</p>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="border-zinc-800 bg-zinc-900/80">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Layers3 className="h-4 w-4" />
                  Subagentes
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-2">
                {snapshot.subagents.map((agent) => (
                  <div key={agent.id} className="rounded-lg border border-zinc-800 bg-black p-3">
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium text-white">{agent.name}</p>
                        <p className="mt-1 text-xs leading-5 text-zinc-500">{agent.role}</p>
                      </div>
                      <Badge variant="outline" className={cn("shrink-0", statusTone(agent.status))}>{agent.status}</Badge>
                    </div>
                    <p className="text-xs leading-5 text-zinc-300">{agent.currentFocus}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4">
            <Card className="border-zinc-800 bg-zinc-900/80">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Target className="h-4 w-4" />
                  Preparacion de recomendaciones
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {snapshot.selfImprovement.loops.map((loop) => (
                  <div key={loop.id} className="rounded-lg border border-zinc-800 bg-black p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-white">{loop.name}</p>
                      <Badge variant="outline" className={cn("shrink-0", statusTone(loop.status))}>{loop.status}</Badge>
                    </div>
                    <p className="text-xs leading-5 text-zinc-400">{loop.steps.join(" -> ")}</p>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="border-zinc-800 bg-zinc-900/80">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <CalendarClock className="h-4 w-4" />
                  Workstreams
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {snapshot.workstreams.map((stream) => (
                  <div key={stream.id} className="rounded-lg border border-zinc-800 bg-black p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-white">{stream.name}</p>
                      <Badge variant="outline" className={cn("shrink-0", statusTone(stream.status))}>{stream.status}</Badge>
                    </div>
                    <p className="text-xs text-zinc-500">{stream.owner}</p>
                    <p className="mt-2 text-xs leading-5 text-zinc-300">{stream.output}</p>
                    <p className="mt-2 text-xs leading-5 text-zinc-500">{stream.nextMove}</p>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="border-zinc-800 bg-zinc-900/80">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <BarChart3 className="h-4 w-4" />
                  Historial de preparacion
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {snapshot.recentLearningRuns.length ? snapshot.recentLearningRuns.map((run) => (
                  <p key={run.id} className="rounded-lg border border-zinc-800 bg-black px-3 py-2 text-sm leading-5 text-zinc-300">{run.summary}</p>
                )) : <p className="text-sm text-zinc-500">Sin preparaciones guardadas verificables.</p>}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card className="border-zinc-800 bg-zinc-900/80">
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wide text-zinc-500">{label}</p>
        <p className="mt-2 text-xl font-semibold text-white">{value}</p>
      </CardContent>
    </Card>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-black p-3">
      <p className="text-xs uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 text-sm leading-5 text-zinc-300">{value}</p>
    </div>
  );
}
