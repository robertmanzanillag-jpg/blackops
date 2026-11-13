import assert from "node:assert/strict";
import test from "node:test";
import type { AutomationDefinition, AutomationRun } from "@shared/schema";
import { buildCeoOperationalHealth } from "../server/ceo-operational-health";

test("June next-run metadata after a November run is unverified, not a missed dispatch",()=>{
  const definition=automation({nextRunAt:new Date('2026-06-22T06:45:00Z'),lastRunAt:new Date('2026-11-06T11:45:00Z'),schedule:{kind:'daily_time',hour:6,minute:45}});
  const result=buildCeoOperationalHealth({automations:[definition],runs:[],now:new Date('2026-11-06T12:00:00Z')});
  assert.equal(result.totals.overdueRuns,0);assert.equal(result.status,'warning');
  assert.equal(result.items[0].nextRunAt,null);assert.match(result.items[0].detail,/unverified/);
});

function automation(overrides: Partial<AutomationDefinition> = {}): AutomationDefinition {
  return {
    id: "automation-1",
    ownerUserId: "user-1",
    name: "Morning brief",
    description: null,
    type: "reminder",
    assignedAgentId: "scheduler",
    schedule: null,
    timezone: "America/New_York",
    status: "active",
    permissionLevel: "autonomous",
    requiresApproval: false,
    nextRunAt: new Date("2026-06-18T11:00:00.000Z"),
    lastRunAt: null,
    lastStatus: null,
    failureCount: 0,
    costEstimate: null,
    metadata: null,
    createdAt: new Date("2026-06-17T10:00:00.000Z"),
    updatedAt: new Date("2026-06-17T10:00:00.000Z"),
    ...overrides,
  };
}

function run(overrides: Partial<AutomationRun> = {}): AutomationRun {
  return {
    id: "run-1",
    automationId: "automation-1",
    ownerUserId: "user-1",
    startedAt: new Date("2026-06-17T10:00:00.000Z"),
    finishedAt: new Date("2026-06-17T10:01:00.000Z"),
    status: "success",
    triggeredBy: "scheduler",
    resultSummary: "Sent brief.",
    errorMessage: null,
    costEstimate: null,
    pendingActionId: null,
    auditLogId: null,
    metadata: null,
    createdAt: new Date("2026-06-17T10:01:00.000Z"),
    ...overrides,
  };
}

test("reports operational health ready for healthy active automations", () => {
  const health = buildCeoOperationalHealth({
    automations: [automation()],
    runs: [run()],
    now: new Date("2026-06-17T12:00:00.000Z"),
  });

  assert.equal(health.status, "ready");
  assert.equal(health.totals.active, 1);
  assert.equal(health.totals.failedRuns, 0);
  assert.equal(health.items[0].status, "ready");
});

test("blocks operational health on failed latest run", () => {
  const health = buildCeoOperationalHealth({
    automations: [automation()],
    runs: [run({ status: "failed", errorMessage: "Telegram token rejected." })],
    now: new Date("2026-06-17T12:00:00.000Z"),
  });

  assert.equal(health.status, "blocked");
  assert.equal(health.totals.failedRuns, 1);
  assert.match(health.items[0].detail, /Telegram token rejected/);
});

test("warns for overdue active automations", () => {
  const health = buildCeoOperationalHealth({
    automations: [automation({ nextRunAt: new Date("2026-06-17T08:00:00.000Z") })],
    runs: [],
    now: new Date("2026-06-17T12:00:00.000Z"),
  });

  assert.equal(health.status, "warning");
  assert.equal(health.totals.overdueRuns, 1);
  assert.match(health.items[0].detail, /past/);
});
