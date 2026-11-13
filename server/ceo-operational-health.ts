import type { AutomationDefinition, AutomationRun } from "@shared/schema";
import { verifiedNextRunAt } from "./automation-definition-reads";

export type CeoOperationalHealthStatus = "ready" | "warning" | "blocked";

export type CeoOperationalHealthItem = {
  id: string;
  title: string;
  status: CeoOperationalHealthStatus;
  detail: string;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  failureCount: number;
};

export type CeoOperationalHealth = {
  status: CeoOperationalHealthStatus;
  totals: {
    automations: number;
    active: number;
    paused: number;
    failedDefinitions: number;
    failedRuns: number;
    pendingApprovalRuns: number;
    overdueRuns: number;
  };
  recentRuns: Array<{
    id: string;
    automationId: string;
    title: string;
    status: AutomationRun["status"];
    startedAt: Date;
    finishedAt: Date | null;
    errorMessage: string | null;
  }>;
  items: CeoOperationalHealthItem[];
};

function worstStatus(items: CeoOperationalHealthItem[]): CeoOperationalHealthStatus {
  if (items.some((item) => item.status === "blocked")) return "blocked";
  if (items.some((item) => item.status === "warning")) return "warning";
  return "ready";
}

function isOverdue(definition: AutomationDefinition, now: Date): boolean {
  if (definition.status !== "active") return false;
  const next=verifiedNextRunAt(definition);
  return !!next && next.getTime() < now.getTime();
}

export function buildCeoOperationalHealth(input: {
  automations: AutomationDefinition[];
  runs: AutomationRun[];
  now?: Date;
}): CeoOperationalHealth {
  const now = input.now || new Date();
  const runsByAutomation = new Map<string, AutomationRun[]>();
  for (const run of input.runs) {
    const existing = runsByAutomation.get(run.automationId) || [];
    existing.push(run);
    runsByAutomation.set(run.automationId, existing);
  }

  for (const runs of runsByAutomation.values()) {
    runs.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  }

  const items = input.automations.map<CeoOperationalHealthItem>((automation) => {
    const latestRun = runsByAutomation.get(automation.id)?.[0];
    const overdue = isOverdue(automation, now);
    const nextRunAt=verifiedNextRunAt(automation);
    const unknownSchedule=automation.status === "active" && !nextRunAt && !!(automation.schedule || automation.nextRunAt);
    const status: CeoOperationalHealthStatus = automation.status === "failed" || latestRun?.status === "failed"
      ? "blocked"
      : overdue || unknownSchedule || latestRun?.status === "pending_approval" || automation.status === "paused"
      ? "warning"
      : "ready";
    const detail = automation.status === "failed"
      ? "Automation definition is marked failed."
      : latestRun?.status === "failed"
      ? latestRun.errorMessage || "Latest automation run failed."
      : latestRun?.status === "pending_approval"
      ? "Latest automation run is waiting for approval."
      : overdue
      ? "Next run time is in the past."
      : automation.status === "paused"
      ? "Automation is paused."
      : unknownSchedule
      ? "Next scheduled dispatch is unverified; recorded run results are preserved."
      : latestRun
      ? `Latest run ${latestRun.status}.`
      : "No run history yet.";

    return {
      id: automation.id,
      title: automation.name,
      status,
      detail,
      lastRunAt: automation.lastRunAt || latestRun?.startedAt || null,
      nextRunAt,
      failureCount: automation.failureCount || 0,
    };
  });

  const failedRuns = input.runs.filter((run) => run.status === "failed");
  const pendingApprovalRuns = input.runs.filter((run) => run.status === "pending_approval");
  const overdueRuns = input.automations.filter((automation) => isOverdue(automation, now));

  const sortedRecentRuns = [...input.runs]
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
    .slice(0, 8);
  const automationById = new Map(input.automations.map((automation) => [automation.id, automation]));

  return {
    status: worstStatus(items),
    totals: {
      automations: input.automations.length,
      active: input.automations.filter((automation) => automation.status === "active").length,
      paused: input.automations.filter((automation) => automation.status === "paused").length,
      failedDefinitions: input.automations.filter((automation) => automation.status === "failed").length,
      failedRuns: failedRuns.length,
      pendingApprovalRuns: pendingApprovalRuns.length,
      overdueRuns: overdueRuns.length,
    },
    recentRuns: sortedRecentRuns.map((run) => ({
      id: run.id,
      automationId: run.automationId,
      title: automationById.get(run.automationId)?.name || run.resultSummary || "Automation run",
      status: run.status,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt || null,
      errorMessage: run.errorMessage || null,
    })),
    items: items
      .sort((a, b) => {
        const rank: Record<CeoOperationalHealthStatus, number> = { blocked: 0, warning: 1, ready: 2 };
        return rank[a.status] - rank[b.status] || a.title.localeCompare(b.title);
      })
      .slice(0, 8),
  };
}
