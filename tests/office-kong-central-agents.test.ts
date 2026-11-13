import assert from "node:assert/strict";
import test from "node:test";
import type { OfficeKongAgent } from "../server/office-kong";
import type { OfficeCityAgent } from "../client/src/lib/office-city-agents";
import { buildOfficeKongCentralSignals, officeCityEvidenceNotice, OFFICE_KONG_CENTRAL_SEATS } from "../client/src/lib/office-kong-central-agents";

const now = Date.parse("2026-11-05T12:00:00Z");
const at = (minutes: number) => new Date(now + minutes * 60_000).toISOString();
const agent = (overrides: Partial<OfficeKongAgent> = {}): OfficeKongAgent => ({
  id: "kong-videos", name: "Videos Kong", kind: "department", owner: "kong_native", responsibility: "KONG videos",
  state: "unknown", lastRunAt: null, nextRunAt: null, blocker: null, nextAction: "Esperar evidencia", issues: [], ...overrides,
});

test("keeps the five central desks visible and maps only exact KONG Native department identities", () => {
  const signals = buildOfficeKongCentralSignals([
    agent({ state: "running", nextRunAt: at(2) }),
    agent({ id: "kong-ai", name: "KONG AI", state: "healthy", lastRunAt: at(-2) }),
    agent({ id: "promoters", name: "Promoters + Mesas", state: "attention", blocker: "Aviso de cobertura" }),
    agent({ id: "venues", name: "Venues", kind: "system", state: "running" }),
    agent({ id: "legal", name: "Kong Legal", state: "disabled" }),
    agent({ id: "unrelated", name: "Videos Kong", kind: "city", state: "running" }),
  ], at(0), now);

  assert.equal(OFFICE_KONG_CENTRAL_SEATS.length, 5);
  assert.deepEqual(signals.map(item => item.name), ["Videos Kong", "KONG AI", "Promotores + Mesas", "Venues", "Kong Legal"]);
  assert.deepEqual(signals.map(item => item.signal), ["current", "last-result", "alert", "unverified", "alert"]);
  assert.equal(signals[0].label, "Ejecución actual reportada por KONG Native");
  assert.equal(signals[1].lastRunAt, at(-2));
  assert.equal(signals[3].agent, undefined);
});

test("stale snapshots, duplicate identities and future timestamps never confirm current work", () => {
  const duplicated = buildOfficeKongCentralSignals([agent(), agent({ id: "another", name: "Videos Kong" })], at(0), now);
  const stale = buildOfficeKongCentralSignals([agent({ state: "running" })], at(-6), now);
  const future = buildOfficeKongCentralSignals([agent({ state: "running", lastRunAt: at(1) })], at(0), now);
  assert.equal(duplicated[0].signal, "unverified");
  assert.match(duplicated[0].detail, /duplicadas/);
  assert.equal(stale[0].signal, "unverified");
  assert.equal(future[0].signal, "unverified");
});

function cityAgent(options: { state?: OfficeCityAgent["status"]["state"]; detail?: string; blocker?: string; recordedFailure?: boolean } = {}): OfficeCityAgent {
  return {
    id: "kong-city:fixture:events", name: "Eventos", role: "Eventos", cityId: "fixture", cityName: "Ciudad de prueba",
    category: "events", status: { state: options.state ?? "needs-setup", label: "Atención", detail: options.detail },
    color: "#fbbf24", lastWorkAt: at(-1), lastStartedAt: at(-2), nextWorkAt: at(2),
    blocker: options.blocker ?? options.detail ?? "", snapshotAt: at(0), hasDurableEvidence: true,
    recordedFailure: options.recordedFailure,
  };
}

test("city chat labels real failures, source limits and coverage warnings separately", () => {
  assert.deepEqual(officeCityEvidenceNotice(cityAgent({ state: "error", recordedFailure: true })), {
    kind: "failure", label: "Fallo real registrado por KONG",
  });
  assert.deepEqual(officeCityEvidenceNotice(cityAgent({ detail: "La fuente limitó las consultas (HTTP 429)." })), {
    kind: "source-limit", label: "Límite de la fuente · no equivale a un fallo del puesto",
  });
  assert.deepEqual(officeCityEvidenceNotice(cityAgent({ detail: "Aviso de cobertura: fuentes pendientes." })), {
    kind: "coverage", label: "Aviso de cobertura · no confirma un fallo de ejecución",
  });
});
