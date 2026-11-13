import assert from "node:assert/strict";
import test from "node:test";
import { OFFICE_KONG_SUPERVISED_CATEGORIES, scoreOfficeKongSnapshot, type OfficeKongSupervisorSnapshot } from "../shared/office-kong-supervisor";

const NOW = Date.parse("2026-11-05T06:00:00.000Z");
const MINUTE = 60_000;
const at = (offsetMinutes = 0) => new Date(NOW + offsetMinutes * MINUTE).toISOString();
type City = OfficeKongSupervisorSnapshot["cities"][number];
type Category = City["categories"][number];
const job = (category: Category["category"], overrides: Partial<Category> = {}): Category => ({
  category, state: "healthy", evidence: "persisted", lastStartedAt: at(-4), lastRunAt: at(-3), lastSuccessAt: at(-3),
  nextRunAt: at(57), intervalMs: 60 * MINUTE, ...overrides,
});
const city = (id: string, countryCode: string, categories: Category[]): City => ({ id, name: id, countryCode, categories });
const snapshot = (...cities: City[]): OfficeKongSupervisorSnapshot => ({
  generatedAt: at(), citySnapshotCheckedAt: at(), cityAgentsEnabled: true, cities,
});

test("one authenticated snapshot distinguishes completion, idle, live work and fixed deductions", () => {
  const evidence = snapshot(city("miami", "US", [
    job("clubs"),
    job("vip", { state: "stale", recordedFailure: true, lastSuccessAt: at(-180) }),
    job("restaurants", { nextRunAt: at(-16), lastStartedAt: at(-60), lastRunAt: at(-59), lastSuccessAt: at(-59) }),
    job("events", { state: "stale", lastSuccessAt: at(-180) }),
    job("sports", { state: "running", lastStartedAt: at(-0.5), leaseUntil: at(1) }),
    job("experiences", { evidence: "missing" }),
    job("media", { nextRunAt: null }),
    job("discovery"),
  ]));
  const result = scoreOfficeKongSnapshot(evidence, NOW);
  assert.equal(result.verified, true);
  assert.deepEqual(result.cities[0].categories.map(({ state, points, deduction }) => [state, points, deduction]), [
    ["scheduled", 100, 0], ["failed", 75, 25], ["missed", 85, 15], ["stale", 80, 20], ["running", 100, 0], ["unverified", null, 0], ["completed", 100, 0], ["scheduled", 100, 0],
  ]);
  assert.equal(result.cities[0].points, 91);
  assert.equal(result.cities[0].scoredCategories, 7);
  assert.equal(result.cities[0].totalCategories, 8);
  assert.deepEqual(scoreOfficeKongSnapshot(evidence, NOW + 1000), result);
});

test("unknown, intentionally disabled and ambiguous attention stay unscored", () => {
  const evidence = snapshot(city("madrid", "ES", [
    job("clubs", { state: "attention", recordedFailure: false, lastSuccessAt: at(-5) }),
    job("vip", { state: "attention", recordedFailure: true, lastRunAt: null }),
    job("events", { state: "unknown", nextRunAt: at(-40) }),
    job("sports", { state: "disabled" }),
    job("media", { state: "healthy", lastSuccessAt: at(2) }),
  ]));
  const result = scoreOfficeKongSnapshot(evidence, NOW);
  assert.equal(result.cities[0].points, null);
  assert.equal(result.cities[0].totalCategories, 8);
  assert.equal(result.cities[0].categories.find(value => value.category === "sports")?.state, "disabled");
  assert.ok(result.cities[0].categories.every(value => value.points === null && value.deduction === 0));
});

test("completed coverage warnings do not hide stale, missed, failed or unverified executions", () => {
  const warnings = { state: "attention" as const, recordedFailure: false };
  const evidence = snapshot(city("buenos-aires", "AR", [
    job("clubs", warnings),
    job("vip", { ...warnings, recordedFailure: true }),
    job("restaurants", { ...warnings, lastStartedAt: at(-151), lastRunAt: at(-150), lastSuccessAt: at(-150) }),
    job("events", { ...warnings, nextRunAt: at(-16), lastStartedAt: at(-60), lastRunAt: at(-59), lastSuccessAt: at(-59) }),
    job("sports", { ...warnings, lastSuccessAt: null }),
    job("media", { ...warnings, lastStartedAt: at(-1) }),
  ]));
  assert.deepEqual(scoreOfficeKongSnapshot(evidence, NOW).cities[0].categories.map(({ state, points }) => [state, points]), [
    ["completed_with_warnings", 95], ["failed", 75], ["stale", 80], ["missed", 85], ["unverified", null], ["unverified", null], ["unverified", null], ["unverified", null],
  ]);
});

test("a full registry with completed warnings and one recorded failure keeps those findings distinct", () => {
  const cities = Array.from({ length: 25 }, (_, index) => city(`city-${index}`, "US", OFFICE_KONG_SUPERVISED_CATEGORIES.map(category =>
    job(category, { state: "attention", recordedFailure: index === 0 && category === "vip" }))));
  const result = scoreOfficeKongSnapshot(snapshot(...cities), NOW);
  const categories = result.cities.flatMap(value => value.categories);
  assert.equal(categories.filter(value => value.state === "completed_with_warnings").length, 25 * OFFICE_KONG_SUPERVISED_CATEGORIES.length - 1);
  assert.equal(categories.filter(value => value.state === "failed").length, 1);
});

test("expired or inconsistent audit evidence never generates a score or penalty", () => {
  const recorded = city("miami", "US", [job("vip", { state: "attention", recordedFailure: true })]);
  const evidence = snapshot(recorded);
  for (const value of [{ ...evidence, generatedAt: at(-6) }, { ...evidence, citySnapshotCheckedAt: at(1) }, snapshot(recorded, recorded)]) {
    const result = scoreOfficeKongSnapshot(value, NOW);
    assert.equal(result.verified, false);
    assert.ok(result.cities.every(value => value.points === null && value.categories.every(category => category.deduction === 0)));
  }
});

test("a live execution must still have its recorded lease when the office displays it", () => {
  const evidence = snapshot(city("dubai", "AE", [job("events", { state: "running", nextRunAt: at(-20), leaseUntil: at(1) })]));
  assert.equal(scoreOfficeKongSnapshot(evidence, NOW).cities[0].categories.find(value => value.category === "events")?.state, "running");
  const expired = scoreOfficeKongSnapshot(evidence, NOW + MINUTE).cities[0].categories.find(value => value.category === "events")!;
  assert.deepEqual([expired.state, expired.points, expired.deduction], ["unverified", null, 0]);
  const noLease = snapshot(city("dubai", "AE", [job("events", { state: "running" })]));
  assert.equal(scoreOfficeKongSnapshot(noLease, NOW).cities[0].points, null);
  const interrupted = snapshot(city("dubai", "AE", [job("events", { lastStartedAt: at(-1), leaseUntil: at(-0.5) })]));
  assert.equal(scoreOfficeKongSnapshot(interrupted, NOW).cities[0].points, null);
});

test("country scores weigh verified categories and keep coverage for the full city registry", () => {
  const failed = job("vip", { state: "attention", recordedFailure: true });
  const evidence = snapshot(
    city("miami", "US", [failed, job("events")]),
    city("chicago", "US", [failed]),
    city("buenos-aires", "AR", []),
    ...Array.from({ length: 22 }, (_, index) => city(`fixture-${index}`, "GB", [job("media")])),
  );
  const result = scoreOfficeKongSnapshot(evidence, NOW);
  assert.equal(result.cities.length, evidence.cities.length);
  assert.equal(result.cities.reduce((sum, value) => sum + value.totalCategories, 0), evidence.cities.length * OFFICE_KONG_SUPERVISED_CATEGORIES.length);
  assert.deepEqual(result.countries.find(value => value.countryCode === "US"), { countryCode: "US", cityCount: 2, points: 83, scoredCategories: 3, totalCategories: 16 });
  assert.equal(result.countries.find(value => value.countryCode === "AR")?.points, null);
});

test("a turn must exceed the grace period and have no subsequent attempt to count as missed", () => {
  const evidence = snapshot(city("miami", "US", [
    job("clubs", { nextRunAt: at(-15), lastStartedAt: at(-60), lastRunAt: at(-59), lastSuccessAt: at(-59) }),
    job("events", { nextRunAt: at(-25) }),
  ]));
  assert.deepEqual(scoreOfficeKongSnapshot(evidence, NOW).cities[0].categories.filter(value => value.points !== null).map(value => [value.category, value.state, value.points]),
    [["clubs", "completed", 100], ["events", "completed", 100]]);
});

test("a verified overdue first turn is missed even without a prior completed result", () => {
  const neverStarted = { state: "unknown" as const, lastStartedAt: null, lastRunAt: null, lastSuccessAt: null, nextRunAt: at(-16) };
  const evidence = snapshot(city("miami", "US", [job("clubs", neverStarted),
    job("events", { ...neverStarted, intervalMs: null }), job("sports", { ...neverStarted, evidence: "missing" })]));
  const categories = scoreOfficeKongSnapshot(evidence, NOW).cities[0].categories;
  assert.equal(categories.find(value => value.category === "clubs")?.points, 85);
  assert.equal(categories.find(value => value.category === "events")?.points, null);
  assert.equal(categories.find(value => value.category === "sports")?.points, null);
});

test("discovery is a supervised category with its own task and count summary", async () => {
  const { OFFICE_KONG_CITY_TASKS, officeKongDiscoverySummary } = await import("../shared/office-kong-supervisor");
  assert.equal(OFFICE_KONG_SUPERVISED_CATEGORIES.length, 8);
  assert.ok(OFFICE_KONG_SUPERVISED_CATEGORIES.includes("discovery"));
  assert.match(OFFICE_KONG_CITY_TASKS.discovery, /novedades/i);
  assert.equal(officeKongDiscoverySummary({ mode: "deterministic", found: 9, added: 2, queuedForReview: 3, rejected: 4, reviewPendingTotal: 5 }),
    "Novedades del último turno: 9 encontradas · 2 añadidas · 3 a revisión · 4 rechazadas · 5 pendientes de revisar.");
  assert.equal(officeKongDiscoverySummary({ mode: "disabled" }), "Descubrimiento desactivado en KONG.");
  assert.equal(officeKongDiscoverySummary(undefined), null);
});
