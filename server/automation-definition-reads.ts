import type { AutomationDefinition } from "@shared/schema";

export interface AutomationDefinitionReader {
  getAutomationDefinitions(userId: string): Promise<AutomationDefinition[]>;
}

// Missing definitions remain missing. A read never registers defaults or resumes.
export function verifiedNextRunAt(definition: Pick<AutomationDefinition,"nextRunAt"|"lastRunAt">): Date | null {
  const next=definition.nextRunAt, last=definition.lastRunAt;
  if(!next) return null;
  if(!Number.isFinite(new Date(next).getTime())) return null;
  // A timestamp already behind a recorded run is not evidence of the next
  // scheduled dispatch. Do not manufacture a new date from the host timezone.
  return last && new Date(next).getTime() <= new Date(last).getTime() ? null : next;
}
export async function listExistingAutomationDefinitions(reader: AutomationDefinitionReader, userId: string) {
  return (await reader.getAutomationDefinitions(userId)).map(definition=>({
    ...definition,nextRunAt:verifiedNextRunAt(definition),
    scheduleEvidence: definition.nextRunAt && !verifiedNextRunAt(definition)
      ? {state:"unverified_next_run",recordedNextRunAt:definition.nextRunAt} : undefined,
  }));
}

export function activeMetricoolAnalyticsDefinition(definitions: AutomationDefinition[]): boolean {
  return definitions.some(item => item.status === "active"
    && (item.metadata as { key?: unknown } | null)?.key === "metricool-daily-analytics-sync");
}
