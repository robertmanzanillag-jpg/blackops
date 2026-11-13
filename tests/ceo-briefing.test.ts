import assert from "node:assert/strict";
import test from "node:test";
import { buildCeoDailyCommandCenter, formatCeoMorningBrief, formatCeoRoutineCommand, type CeoBriefSnapshot } from "../server/ceo-brief-format";

function emptySnapshot(overrides: Partial<CeoBriefSnapshot> = {}): CeoBriefSnapshot {
  return {
    tasks: [],
    weeklyTasks: [],
    monthlyGoals: [],
    yearlyGoals: [],
    pendingActions: [],
    projects: [],
    priceAlerts: [],
    investments: [],
    scheduledReminders: [],
    auditLogs: [],
    meetingPreps: [],
    recentDecisions: [],
    keyPeople: [],
    commitments: [],
    totalUsers: 1,
    ...overrides,
  };
}

test("formats an empty CEO morning brief with all core sections", () => {
  const brief = formatCeoMorningBrief(emptySnapshot(), new Date("2026-06-15T12:00:00Z"));

  assert.match(brief, /Brief CEO/);
  assert.match(brief, /1\. Agenda de hoy/);
  assert.match(brief, /2\. Prioridades/);
  assert.match(brief, /3\. Decisiones y aprobaciones/);
  assert.match(brief, /4\. Riesgos/);
  assert.match(brief, /10\. Metas/);
  assert.match(brief, /Comandos utiles|Comandos útiles/);
});

test("formats CEO morning brief with priorities, approvals, risks, and context", () => {
  const now = new Date("2026-06-15T12:00:00Z");
  const brief = formatCeoMorningBrief(emptySnapshot({
    tasks: [
      { title: "Board review", date: "2026-06-15T14:00:00Z", type: "event", completed: false, createdAt: "2026-06-15T09:00:00Z" },
      { title: "Close investor memo", date: "2026-06-15T16:00:00Z", type: "regular", priority: "high", completed: false },
      { title: "Follow-up: Ana - contract", date: "2026-06-14T18:00:00Z", type: "follow_up", completed: false },
    ],
    weeklyTasks: [{ title: "Ship CEO dashboard", completed: false }],
    monthlyGoals: [{ title: "Reach MRR target", completed: false }],
    yearlyGoals: [{ title: "Launch operating system", completed: false }],
    pendingActions: [{ id: "00000000-0000-0000-0000-000000000001", title: "Send investor update", status: "pending", riskLevel: "medium" }],
    projects: [{ name: "Client portal", status: "degraded" }],
    priceAlerts: [{ enabled: true, triggered: false }],
    investments: [{ quantity: "10", avgBuyPrice: "25" }],
    scheduledReminders: [{ isActive: true }],
    auditLogs: [{ status: "failed" }],
    meetingPreps: [{ title: "Board review", startsAt: "2026-06-15T14:00:00Z", suggestedQuestions: ["What decision is needed?"] }],
    recentDecisions: [{ key: "Pricing", value: "Keep annual plan" }],
    keyPeople: [{ key: "Ana", value: "Investor" }],
    commitments: [{ key: "Roberto", value: "Send deck by Friday" }],
    totalUsers: 3,
  }), now);

  assert.match(brief, /Board review/);
  assert.match(brief, /Close investor memo/);
  assert.match(brief, /Send investor update/);
  assert.match(brief, /aprobar ID o rechazar ID/);
  assert.match(brief, /Client portal/);
  assert.match(brief, /Follow-up: Ana - contract/);
  assert.match(brief, /Portafolio registrado: 1 activo\(s\), base \$250/);
  assert.match(brief, /Pricing/);
  assert.match(brief, /Persona: Ana/);
  assert.match(brief, /Reach MRR target/);
});

test("builds CEO routine command center from the same brief snapshot", () => {
  const now = new Date("2026-06-15T12:00:00Z");
  const snapshot = emptySnapshot({
    tasks: [
      { title: "Close investor memo", date: "2026-06-15T16:00:00Z", type: "regular", priority: "high", completed: false },
      { title: "Follow-up: Ana - contract", date: "2026-06-14T18:00:00Z", type: "follow_up", completed: false },
    ],
    weeklyTasks: [{ title: "Ship CEO dashboard", completed: false }],
    pendingActions: [{ id: "00000000-0000-0000-0000-000000000001", title: "Send investor update", status: "pending", riskLevel: "medium" }],
    projects: [{ name: "Client portal", status: "degraded" }],
    auditLogs: [{ status: "failed" }],
    commitments: [{ key: "Roberto", value: "Send deck by Friday" }],
  });

  const center = buildCeoDailyCommandCenter(snapshot, now);
  assert.deepEqual(center.topPriorities.slice(0, 2), ["Close investor memo", "Follow-up: Ana - contract"]);
  assert.equal(center.blockers.some((item) => item.includes("aprobación")), true);
  assert.equal(center.blockers.some((item) => item.includes("Client portal")), true);
  assert.equal(center.chaseList.some((item) => item.includes("Ana")), true);

  assert.match(formatCeoRoutineCommand("top3", snapshot, now), /Top 3 prioridades/);
  assert.match(formatCeoRoutineCommand("blockers", snapshot, now), /Bloqueos actuales/);
  assert.match(formatCeoRoutineCommand("chase", snapshot, now), /A quién perseguir/);
  assert.match(formatCeoRoutineCommand("close_day", snapshot, now), /Cierre del día/);
});
