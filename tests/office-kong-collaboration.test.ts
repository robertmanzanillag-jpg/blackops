import assert from "node:assert/strict";
import test from "node:test";
import { buildOfficeKongCollaboration } from "../server/office-kong-collaboration";
import type { OfficeKongAuditResult, OfficeKongCityCategory } from "../server/office-kong";

const now = Date.parse("2026-11-05T10:00:00Z");
const at = (minutes: number) => new Date(now + minutes * 60_000).toISOString();
const job: OfficeKongCityCategory = { category: "sports", state: "attention", evidence: "persisted", recordedFailure: true,
  lastRunAt: at(-3), lastStartedAt: at(-4), lastSuccessAt: at(-60), nextRunAt: at(5), intervalMs: 60 * 60_000,
  issues: ["Ticketmaster sports discovery failed: HTTP 429", "private provider detail"] };

function fixture(categories: OfficeKongCityCategory[], cityCount = 1): OfficeKongAuditResult["evidence"] {
  return { generatedAt: at(0), citySnapshotCheckedAt: at(0), agents: [], cityAgentsEnabled: true, cityCoverageComplete: false,
    cities: Array.from({ length: cityCount }, (_, index) => ({ id: `city-${index}`, name: `City ${index}`, countryCode: "AR",
      status: "needs_attention", timeZone: "America/Argentina/Buenos_Aires", currency: "ARS", categories })) };
}

test("uses the supervisor finding and proposes a bounded action without copying provider details", () => {
  const evidence = fixture([job, { ...job, category: "clubs", recordedFailure: false, issues: ["Paid discovery disabled: budget $0"] }]);
  const result = buildOfficeKongCollaboration(evidence, now);
  assert.equal(result.verified, true);
  assert.equal(result.totalFindings, 2);
  assert.deepEqual(result.exchanges.map(item => [item.kind, item.evidenceAt, ...item.comments.map(comment => comment.author)]),
    [["failed", at(-3), "supervisor", "operations"], ["attention", at(-3), "supervisor", "operations"]]);
  assert.match(result.exchanges[0].comments[1].text, /límite de Ticketmaster/);
  assert.match(result.exchanges[1].comments[1].text, /presupuesto actual/);
  assert.doesNotMatch(JSON.stringify(result), /private provider detail/);
  assert.deepEqual(buildOfficeKongCollaboration(evidence, now + 1), result);
});

test("fresh persisted findings remain distinguishable from missing, duplicated, disabled or incomplete evidence", () => {
  const incomplete = { ...job, category: "clubs" as const, lastStartedAt: at(-1) };
  const missing = { ...job, category: "events" as const, evidence: "missing" as const };
  const evidence = fixture([job, { ...job, evidence: "missing" }, incomplete, missing]);
  assert.equal(buildOfficeKongCollaboration(evidence, now).totalFindings, 0);
  assert.equal(buildOfficeKongCollaboration(fixture([job]), now + 6 * 60_000).verified, false);
  assert.equal(buildOfficeKongCollaboration({ ...fixture([job]), cityAgentsEnabled: false }, now).totalFindings, 0);
});

test("counts all observed cities while bounding the number of exchanges", () => {
  const result = buildOfficeKongCollaboration(fixture([job], 27), now);
  assert.equal(result.totalFindings, 27);
  assert.equal(result.exchanges.length, 24);
  assert.equal(new Set(result.exchanges.map(item => item.id)).size, 24);
});

test("a sanitized rate limit proposes official alternatives without guessing the provider", () => {
  const evidence = fixture([{ ...job, lastSuccessAt: at(-3), recordedFailure: false, issues: ["La fuente limitó las consultas (HTTP 429)."] }]);
  const [exchange] = buildOfficeKongCollaboration(evidence, now).exchanges;
  assert.equal(exchange.kind, "attention");
  assert.match(exchange.comments[0].text, /exitosa con avisos/);
  assert.match(exchange.comments[1].text, /límite de consultas de la fuente/);
  assert.doesNotMatch(JSON.stringify(exchange), /Ticketmaster/);
});

test("proposes CEO review of reassignment only with a persisted failure and at least two recorded attempts", () => {
  const evidence = fixture([{ ...job, attemptsSinceSuccess: 2 }, { ...job, category: "vip", attemptsSinceSuccess: 1 }]);
  const result = buildOfficeKongCollaboration(evidence, now);
  assert.deepEqual(result.exchanges.map(item => [item.category, item.proposal.recipient, item.proposal.status, item.proposal.action]),
    [["sports", "ceo", "proposed", "review_reassignment"], ["vip", "ceo", "proposed", "review_city_improvement"]]);
  assert.match(result.exchanges[0].comments[0].text, /2 intentos/);
  assert.doesNotMatch(result.exchanges[1].comments[0].text, /intentos/);
});
