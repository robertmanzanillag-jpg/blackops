import test from "node:test";
import assert from "node:assert/strict";
import { activeSummary, countActive, isActiveStatus, isOnDuty, isOnDutyWindow, onDutyClock, onDutyMaxAge, onDutyStatus } from "../shared/office-on-duty";

const now = Date.parse("2026-11-13T12:00:00Z");
const at = (delta: number) => new Date(now + delta).toISOString();

test("window: fresh, not in the future, no missed turn", () => {
  assert.equal(isOnDutyWindow({ lastWorkAt: at(-60_000), maxAgeMs: 3_600_000, now }), true);
  assert.equal(isOnDutyWindow({ lastWorkAt: at(-3_600_001), maxAgeMs: 3_600_000, now }), false);
  assert.equal(isOnDutyWindow({ lastWorkAt: at(120_000), maxAgeMs: 3_600_000, now }), false);
  assert.equal(isOnDutyWindow({ lastWorkAt: null, maxAgeMs: 3_600_000, now }), false);
  assert.equal(isOnDutyWindow({ lastWorkAt: "bad", maxAgeMs: 3_600_000, now }), false);
  assert.equal(isOnDutyWindow({ lastWorkAt: at(-30 * 60_000), nextWorkAt: at(-10 * 60_000), maxAgeMs: 3_600_000, now }), true, "inside the 15 min grace");
  assert.equal(isOnDutyWindow({ lastWorkAt: at(-40 * 60_000), nextWorkAt: at(-16 * 60_000), maxAgeMs: 3_600_000, now }), false, "missed turn");
  assert.equal(onDutyMaxAge(600_000), 1_200_000);
  assert.equal(onDutyMaxAge(null), 86_400_000);
});

test("status stays available, carries times and is counted as active, never as working", () => {
  const status = onDutyStatus({ lastWorkAt: "2026-11-13T07:01:00Z", nextWorkAt: "2026-11-13T13:01:00Z", now, base: { state: "offline", label: "x", problems: ["p"] } });
  assert.equal(status.state, "available");
  assert.equal(status.label, "Activo · al día");
  assert.deepEqual(status.problems, ["p"]);
  assert.equal(onDutyClock("2026-11-13T07:01:00Z", "UTC"), "07:01");
  assert.match(status.detail!, /^Último trabajo \d{2}:01 · próximo turno \d{2}:01$/);
  assert.equal(isOnDuty(status), true);
  assert.equal(isOnDuty({ state: "error", onDuty: status.onDuty }), false);
  assert.equal(isActiveStatus({ state: "working" }), true);
  assert.equal(isActiveStatus({ state: "available" }), false);
  const statuses = [status, { state: "working" as const }, { state: "offline" as const }, undefined];
  assert.deepEqual(countActive(statuses), { active: 2, working: 1, total: 4 });
  assert.equal(activeSummary(statuses), "2 de 4 activos · 1 ejecutando ahora");
});
