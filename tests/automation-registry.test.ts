import assert from "node:assert/strict";
import test from "node:test";
import type { AutomationDefinition } from "@shared/schema";
import { DEFAULT_AUTOMATIONS, buildScheduledAutomationRunInput } from "../server/automation-registry";
import {listExistingAutomationDefinitions,verifiedNextRunAt} from "../server/automation-definition-reads";

test("consumed schedule metadata is unknown without changing runs, permissions or persisted records",async()=>{
  for(const lastStatus of ["success","failed","skipped"] as const) {
    const saved=automation({nextRunAt:new Date('2026-06-22T06:45:00Z'),lastRunAt:new Date('2026-11-06T11:45:58Z'),lastStatus});
    const [view]=await listExistingAutomationDefinitions({getAutomationDefinitions:async()=>[saved]},'user-1');
    assert.equal(view.nextRunAt,null);assert.equal(view.lastStatus,lastStatus);
    assert.equal(view.status,saved.status);assert.equal(view.permissionLevel,saved.permissionLevel);
    assert.equal(view.scheduleEvidence?.state,'unverified_next_run');
    assert.equal(saved.nextRunAt!.toISOString(),'2026-06-22T06:45:00.000Z');
  }
  const future=new Date('2026-11-07T11:45:00Z');
  assert.equal(verifiedNextRunAt(automation({nextRunAt:future,lastRunAt:new Date('2026-11-06T11:45:00Z')})),future);
});

function automation(overrides: Partial<AutomationDefinition> = {}): AutomationDefinition {
  return {
    id: "automation-1",
    ownerUserId: "user-1",
    name: "CEO brief",
    description: "Sends the morning brief.",
    type: "reminder",
    assignedAgentId: "blackops-scheduler",
    schedule: { kind: "daily_time", hour: 7, minute: 0 },
    timezone: "America/New_York",
    status: "active",
    permissionLevel: "autonomous",
    requiresApproval: false,
    nextRunAt: null,
    lastRunAt: null,
    lastStatus: null,
    failureCount: 0,
    costEstimate: "0",
    metadata: { key: "morning-reminder" },
    createdAt: new Date("2026-06-17T10:00:00.000Z"),
    updatedAt: new Date("2026-06-17T10:00:00.000Z"),
    ...overrides,
  };
}

test("builds a scheduled automation run insert for successful scheduler jobs", () => {
  const startedAt = new Date("2026-06-17T11:00:00.000Z");
  const finishedAt = new Date("2026-06-17T11:00:05.000Z");
  const run = buildScheduledAutomationRunInput({
    automation: automation(),
    startedAt,
    finishedAt,
    outcome: {
      status: "success",
      resultSummary: "CEO morning brief sent.",
      metadata: { pendingCount: 3 },
    },
  });

  assert.equal(run.automationId, "automation-1");
  assert.equal(run.ownerUserId, "user-1");
  assert.equal(run.triggeredBy, "scheduler");
  assert.equal(run.status, "success");
  assert.equal(run.costEstimate, "0");
  assert.deepEqual(run.metadata, { pendingCount: 3 });
});

test("builds a failed scheduled automation run insert with error details", () => {
  const run = buildScheduledAutomationRunInput({
    automation: automation({ costEstimate: "low" }),
    startedAt: new Date("2026-06-17T11:00:00.000Z"),
    finishedAt: new Date("2026-06-17T11:00:05.000Z"),
    outcome: {
      status: "failed",
      resultSummary: "Proactive insights failed.",
      errorMessage: "AI key missing.",
      metadata: { error: "AI key missing." },
    },
  });

  assert.equal(run.status, "failed");
  assert.equal(run.errorMessage, "AI key missing.");
  assert.equal(run.costEstimate, "low");
  assert.deepEqual(run.metadata, { error: "AI key missing." });
});

test("default automations expose Bug Patrol and daily QA report", () => {
  const automation = DEFAULT_AUTOMATIONS.find((item) => item.key === "app-qa-council");

  assert.ok(automation);
  assert.match(automation.name, /Bug Patrol/);
  assert.match(automation.description || "", /Codex PR-first handoffs/);
  assert.equal((automation.metadata as any).bugPatrol, true);
  assert.equal((automation.metadata as any).digest, "daily");
});

test("registers the active five-minute Clippers local-news intake cycle", () => {
  const automation = DEFAULT_AUTOMATIONS.find((item) => item.key === "clippers-local-news-cycle");

  assert.ok(automation);
  assert.deepEqual(automation.schedule, { kind: "interval", everyMinutes: 5 });
  assert.equal(automation.status, "active");
  assert.equal(automation.assignedAgentId, "clippers-agent");
  assert.equal((automation.metadata as any).source, "server/clippers-local-news-agent.ts");
  assert.equal((automation.metadata as any).function, "runClipperLocalNewsCycle");
  assert.equal((automation.metadata as any).requiresMetricoolConnection, true);
  assert.deepEqual((automation.metadata as any).brandIds, ["winner-account-1", "winner-account-2"]);
});

test("registers the Metricool analytics sync as active Facebook-only automation", () => {
  const automation = DEFAULT_AUTOMATIONS.find((item) => item.key === "metricool-daily-analytics-sync");
  assert.ok(automation);
  assert.equal(automation.status, "active");
  assert.deepEqual(automation.schedule, { kind: "daily_time", hour: 6, minute: 45 });
  assert.deepEqual((automation.metadata as any).networks, ["facebook"]);
  assert.equal((automation.metadata as any).xEnabled, false);
});
