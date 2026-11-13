import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  CalendarClock,
  CheckCircle2,
  Clock3,
  DollarSign,
  History,
  Pause,
  Play,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

type AutomationDefinition = {
  id: string;
  name: string;
  description: string | null;
  type: string;
  assignedAgentId: string | null;
  schedule: Record<string, any> | null;
  timezone: string;
  status: "active" | "paused" | "failed" | "disabled";
  permissionLevel: string;
  requiresApproval: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: string | null;
  failureCount: number;
  costEstimate: string | null;
  metadata: Record<string, any> | null;
};

type AutomationRun = {
  id: string;
  automationId: string;
  startedAt: string;
  finishedAt: string | null;
  status: "success" | "failed" | "skipped" | "pending_approval";
  triggeredBy: string;
  resultSummary: string | null;
  errorMessage: string | null;
  costEstimate: string | null;
};

function toneForStatus(status?: string | null) {
  if (status === "active" || status === "success") return "border-emerald-400/20 bg-emerald-400/10 text-emerald-200";
  if (status === "paused" || status === "pending_approval" || status === "skipped") return "border-amber-400/20 bg-amber-400/10 text-amber-200";
  if (status === "failed" || status === "disabled") return "border-red-400/20 bg-red-400/10 text-red-200";
  return "border-zinc-700 bg-zinc-900 text-zinc-300";
}

function formatDate(value?: string | null) {
  if (!value) return "No run";
  return new Date(value).toLocaleString("es-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function scheduleLabel(schedule: Record<string, any> | null) {
  if (!schedule) return "Manual";
  if (schedule.kind === "interval") return `Cada ${schedule.everyMinutes} min`;
  if (schedule.kind === "daily_time") return `Diario ${String(schedule.hour).padStart(2, "0")}:${String(schedule.minute || 0).padStart(2, "0")}`;
  if (schedule.kind === "weekly_time") {
    const days = ["Dom", "Lun", "Mar", "Mie", "Jue", "Vie", "Sab"];
    return `${days[schedule.dayOfWeek || 0]} ${String(schedule.hour).padStart(2, "0")}:${String(schedule.minute || 0).padStart(2, "0")}`;
  }
  return "Manual";
}

function postAutomationAction(id: string, action: "pause" | "resume" | "run") {
  return fetch(`/api/automations/${id}/${action}`, { method: "POST" }).then(async (response) => {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "No se pudo actualizar automation");
    return data;
  });
}

export default function AutomationManagerPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");

  const { data: automations = [], isLoading, isError } = useQuery<AutomationDefinition[]>({
    queryKey: ["automations"],
    queryFn: () => fetch("/api/automations").then((response) => response.json()),
    refetchInterval: 30000,
  });

  const selected = automations.find((automation) => automation.id === selectedId) || automations[0];

  const { data: runs = [] } = useQuery<AutomationRun[]>({
    queryKey: ["automation-runs", selected?.id],
    queryFn: () => fetch(`/api/automations/${selected!.id}/runs`).then((response) => response.json()),
    enabled: !!selected?.id,
    refetchInterval: 30000,
  });

  const mutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "pause" | "resume" | "run" }) => postAutomationAction(id, action),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["automations"] });
      queryClient.invalidateQueries({ queryKey: ["automation-runs"] });
      queryClient.invalidateQueries({ queryKey: ["pending-actions"] });
      queryClient.invalidateQueries({ queryKey: ["ceo-dashboard"] });
    },
  });

  const stats = useMemo(() => ({
    active: automations.filter((automation) => automation.status === "active").length,
    paused: automations.filter((automation) => automation.status === "paused").length,
    failed: automations.filter((automation) => automation.status === "failed").length,
    approval: automations.filter((automation) => automation.requiresApproval).length,
  }), [automations]);

  const visibleAutomations = automations.filter((automation) => filter === "all" || automation.status === filter || automation.type === filter);
  const types = Array.from(new Set(automations.map((automation) => automation.type)));

  return (
    <div className="min-h-screen bg-black pb-8 text-white">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-black/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-4">
          <div className="flex items-center gap-3">
            <Link href="/">
              <Button variant="ghost" size="icon" className="rounded-full text-zinc-400 hover:bg-zinc-900 hover:text-white">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-cyan-300">BlackOps</p>
              <h1 className="text-xl font-semibold sm:text-2xl">Automation Manager</h1>
            </div>
          </div>
          <Button
            variant="outline"
            className="border-zinc-800"
            onClick={() => queryClient.invalidateQueries({ queryKey: ["automations"] })}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-4 px-4 py-5 lg:grid-cols-[1fr_380px]">
        <section className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="rounded-2xl border border-white/10 bg-zinc-950/80 p-4">
              <p className="text-2xl font-semibold">{stats.active}</p>
              <p className="text-xs text-zinc-500">Active</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-zinc-950/80 p-4">
              <p className="text-2xl font-semibold">{stats.paused}</p>
              <p className="text-xs text-zinc-500">Paused</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-zinc-950/80 p-4">
              <p className="text-2xl font-semibold">{stats.failed}</p>
              <p className="text-xs text-zinc-500">Failed</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-zinc-950/80 p-4">
              <p className="text-2xl font-semibold">{stats.approval}</p>
              <p className="text-xs text-zinc-500">Approval required</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {["all", "active", "paused", "failed", "disabled", ...types].map((item) => (
              <Button
                key={item}
                size="sm"
                variant={filter === item ? "default" : "outline"}
                onClick={() => setFilter(item)}
                className={cn(filter === item ? "bg-zinc-100 text-zinc-950 hover:bg-white" : "border-zinc-800 text-zinc-400")}
              >
                {item}
              </Button>
            ))}
          </div>

          {isLoading ? (
            <div className="flex h-64 items-center justify-center rounded-2xl border border-white/10 bg-zinc-950/80 text-zinc-400">
              <RefreshCw className="mr-2 h-5 w-5 animate-spin" />
              Loading automations...
            </div>
          ) : isError ? (
            <div className="rounded-2xl border border-red-500/20 bg-red-950/20 p-5 text-red-200">
              No pude cargar automations. Revisa migraciones/base de datos.
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/80">
              <div className="grid grid-cols-[1.4fr_0.8fr_0.7fr_0.8fr_0.8fr] gap-3 border-b border-white/10 px-4 py-3 text-xs uppercase tracking-wide text-zinc-500 max-md:hidden">
                <span>Automation</span>
                <span>Status</span>
                <span>Last run</span>
                <span>Next run</span>
                <span>Control</span>
              </div>
              <div className="divide-y divide-white/10">
                {visibleAutomations.map((automation) => (
                  <button
                    key={automation.id}
                    onClick={() => setSelectedId(automation.id)}
                    className={cn(
                      "grid w-full gap-3 px-4 py-4 text-left transition hover:bg-white/[0.03] md:grid-cols-[1.4fr_0.8fr_0.7fr_0.8fr_0.8fr]",
                      selected?.id === automation.id && "bg-white/[0.04]"
                    )}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Bot className="h-4 w-4 text-zinc-500" />
                        <p className="truncate text-sm font-medium text-white">{automation.name}</p>
                      </div>
                      <p className="mt-1 line-clamp-1 text-xs text-zinc-500">{automation.description}</p>
                      <p className="mt-2 text-[11px] text-zinc-600">{automation.assignedAgentId || "unassigned"} · {automation.type}</p>
                    </div>
                    <div>
                      <Badge variant="outline" className={toneForStatus(automation.status)}>{automation.status}</Badge>
                      <p className="mt-2 text-xs text-zinc-500">{automation.requiresApproval ? "approval" : "autonomous"}</p>
                    </div>
                    <div className="text-sm text-zinc-400">{formatDate(automation.lastRunAt)}</div>
                    <div className="text-sm text-zinc-400">
                      {formatDate(automation.nextRunAt)}
                      <p className="mt-1 text-xs text-zinc-600">{scheduleLabel(automation.schedule)}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-zinc-800"
                        onClick={(event) => {
                          event.stopPropagation();
                          mutation.mutate({ id: automation.id, action: automation.status === "paused" ? "resume" : "pause" });
                        }}
                      >
                        {automation.status === "paused" ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                      </Button>
                      <Button
                        size="sm"
                        className="bg-zinc-100 text-zinc-950 hover:bg-white"
                        onClick={(event) => {
                          event.stopPropagation();
                          mutation.mutate({ id: automation.id, action: "run" });
                        }}
                      >
                        Run
                      </Button>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        <aside className="space-y-4">
          {selected && (
            <>
              <div className="rounded-2xl border border-white/10 bg-zinc-950/80 p-4">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold">{selected.name}</h2>
                    <p className="mt-1 text-sm leading-6 text-zinc-500">{selected.description}</p>
                  </div>
                  <Badge variant="outline" className={toneForStatus(selected.status)}>{selected.status}</Badge>
                </div>

                <div className="grid gap-3 text-sm">
                  <div className="flex items-center justify-between rounded-xl border border-white/10 p-3">
                    <span className="flex items-center gap-2 text-zinc-400"><CalendarClock className="h-4 w-4" /> Schedule</span>
                    <span>{scheduleLabel(selected.schedule)}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-xl border border-white/10 p-3">
                    <span className="flex items-center gap-2 text-zinc-400"><ShieldCheck className="h-4 w-4" /> Permission</span>
                    <span>{selected.permissionLevel}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-xl border border-white/10 p-3">
                    <span className="flex items-center gap-2 text-zinc-400"><DollarSign className="h-4 w-4" /> Cost</span>
                    <span>{selected.costEstimate || "0"}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-xl border border-white/10 p-3">
                    <span className="flex items-center gap-2 text-zinc-400"><AlertTriangle className="h-4 w-4" /> Failures</span>
                    <span>{selected.failureCount}</span>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-zinc-950/80 p-4">
                <div className="mb-4 flex items-center gap-2">
                  <History className="h-4 w-4 text-zinc-400" />
                  <h3 className="text-sm font-semibold">Run history</h3>
                </div>
                <div className="space-y-2">
                  {runs.length === 0 ? (
                    <p className="rounded-xl border border-white/10 p-3 text-sm text-zinc-500">No runs recorded yet.</p>
                  ) : (
                    runs.slice(0, 8).map((run) => (
                      <div key={run.id} className="rounded-xl border border-white/10 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            {run.status === "success" ? <CheckCircle2 className="h-4 w-4 text-emerald-300" /> : run.status === "failed" ? <XCircle className="h-4 w-4 text-red-300" /> : <Clock3 className="h-4 w-4 text-amber-300" />}
                            <span className="text-sm">{run.status}</span>
                          </div>
                          <span className="text-xs text-zinc-500">{formatDate(run.startedAt)}</span>
                        </div>
                        <p className="mt-2 text-xs leading-5 text-zinc-500">{run.resultSummary || run.errorMessage || "No summary"}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </>
          )}
        </aside>
      </main>
    </div>
  );
}

