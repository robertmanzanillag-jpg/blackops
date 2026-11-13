import type { AutomationDefinition, AutomationRun, InsertAutomationRun } from "@shared/schema";

export const fakeStorage = {
  definitions: [] as AutomationDefinition[],
  reads: 0,
  writes: 0,
  runs: [] as InsertAutomationRun[],
  async getAutomationDefinitions(_owner: string) { this.reads++; return structuredClone(this.definitions); },
  async getAutomationRuns() { return []; },
  async createAutomationRun(run: InsertAutomationRun) { this.runs.push(run); return { ...run, id: "fixture-run" } as AutomationRun; },
  async createAutomationDefinition() { this.writes++; throw new Error("unexpected definition creation"); },
  async updateAutomationDefinition() { this.writes++; throw new Error("unexpected definition mutation"); },
};
