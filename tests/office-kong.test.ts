import assert from "node:assert/strict";
import test from "node:test";
import { createOfficeKongConnector, OfficeKongError, OFFICE_KONG_CITY_CATEGORIES } from "../server/office-kong";

test("invalid reader timestamps are removed at connector boundary, not forwarded as evidence", async () => {
  const reader = { version:1, scopeId:"kong-venues-four-groups", ownerId:"11111111-1111-4111-8111-111111111111",observedAt:NOW.toISOString(),scheduler:"active",intervalMinutes:30,reader:"reading",session:"connected",lastAttemptAt:NOW.toISOString(),lastSuccessAt:null,lastSuccessGroupCount:0,groupsRead:0,blocker:"none",checkpointsRetained:false };
  for (const patch of [{observedAt:new Date(NOW.getTime()+60000).toISOString()}, {lastSuccessAt:new Date(NOW.getTime()+60000).toISOString(),lastSuccessGroupCount:4}]) {
    const audit = await connector(async()=>json({...operations(),whatsappReader:{...reader,...patch}})).runOfficeKongReadOnly();
    assert.equal(audit.evidence.whatsappReader,undefined);
    assert.equal(audit.evidence.agents.find(agent=>agent.id==="whatsapp_reader")?.state,"unknown");
  }
});

const NOW = new Date("2026-11-05T03:00:00.000Z");
const TOKEN = "test-only-office-admin-token";
function operations() {
  return {
    generatedAt: NOW.toISOString(),
    agents: [{ id: "city:miami", name: "Miami", kind: "city", owner: "city_operations", responsibility: "Revisar cobertura", state: "unknown", lastRunAt: null, nextRunAt: null, blocker: "No existe un heartbeat durable consultable", nextAction: "Instrumentar el historial", issues: [] }],
    objectives: [{ id: "coverage", objective: "Cobertura", kpi: "eventos", baseline: null, target: "100", unit: "%", owner: "venue_deals", dueAt: null }],
    briefs: { daily: null, weekly: null },
    metrics: { completedLast7Days: null, completedPrevious7Days: null, open: null, blocked: null },
    issues: [],
    bugs: [{ errorId: "bug-1", severity: "high", occurrences: 2, affectedUsers: 1, status: "pending", owner: "product_reliability", summary: "HTTP 500", lastSeenAt: NOW.toISOString() }],
  };
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const CITIES_URL = "https://kongnightlife.com/api/admin/city-agents";
const DIRECTORY_URL = "https://kongnightlife.com/api/cities";
function citiesFixture(ids = ["miami"]) {
  return {
    enabled: true, coordinator: "global", maxConcurrent: 2, referenceCity: "miami",
    countries: [...new Set(ids.map(id => id === "buenos-aires" ? "AR" : "US"))], needsAttention: [...ids],
    cities: ids.map(id => ({
      id, name: id === "buenos-aires" ? "Buenos Aires" : id, countryCode: id === "buenos-aires" ? "AR" : "US",
      timeZone: id === "buenos-aires" ? "America/Argentina/Buenos_Aires" : "America/New_York", currency: id === "buenos-aires" ? "ARS" : "USD", status: "needs_attention",
      jobs: OFFICE_KONG_CITY_CATEGORIES.map(category => ({ city_id: id, category, interval_ms: "86400000", next_run_at: NOW.toISOString(), lease_until: null,
        last_started_at: null, last_completed_at: null, last_success_at: null, attempts: 0, last_error: null, report: {} })),
    })),
  };
}
function connector(fetchImpl: typeof fetch, token = TOKEN) {
  return createOfficeKongConnector({ token: () => token, now: () => NOW,
    fetchImpl: async (url, init) => url === CITIES_URL ? json(citiesFixture()) : fetchImpl(url, init) });
}

test("visible city directory uses the public registry without reading or sending a credential", async () => {
  const ids = ["buenos-aires", ...Array.from({ length: 24 }, (_, index) => `city-${index}`)];
  const entries = citiesFixture(ids).cities.map(({ jobs: _jobs, status: _status, ...entry }) => ({ ...entry, privateMetadata: "must be discarded" }));
  const client = createOfficeKongConnector({ token: () => { throw new Error("Credential must never be read for the public directory"); }, fetchImpl: async (url, init) => {
    assert.equal(url, DIRECTORY_URL); assert.equal(init?.method, "GET"); assert.equal(init?.redirect, "error");
    assert.equal((init?.headers as Record<string,string>).Authorization, undefined);
    return json(entries);
  } });
  const directory = await client.loadOfficeKongDirectory();
  assert.equal(directory.length, 25); assert.equal(directory[0].currency, "ARS");
  assert.ok(!JSON.stringify(directory).includes("privateMetadata"));
  assert.ok(directory.every(city => !("jobs" in city) && !("state" in city)));
});

test("city directory rejects duplicates and malformed metadata instead of inventing agents", async () => {
  const { jobs: _jobs, status: _status, ...entry } = citiesFixture().cities[0];
  for (const payload of [[entry, entry], [{ ...entry, timeZone: "Invalid/Nowhere" }], [{ ...entry, currency: "not-currency" }], []]) {
    const client = createOfficeKongConnector({ fetchImpl: async () => json(payload) });
    await assert.rejects(client.loadOfficeKongDirectory(), (error: unknown) => error instanceof OfficeKongError && error.code === "INVALID_RESPONSE");
  }
});

test("city directory refuses redirected and non-JSON responses", async () => {
  for (const response of [new Response("redirect", {status:302}), new Response("<html>not a directory</html>", {headers:{"content-type":"text/html"}})]) {
    const client = createOfficeKongConnector({ fetchImpl: async () => response });
    await assert.rejects(client.loadOfficeKongDirectory(), OfficeKongError);
  }
});

test("missing configuration blocks without making a request", async () => {
  const c = connector(async () => { throw new Error("must not request"); }, "");
  assert.equal((await c.probeOfficeKong()).status, "blocked");
  await assert.rejects(c.runOfficeKongReadOnly(), (error: unknown) => error instanceof OfficeKongError && error.code === "NOT_CONFIGURED");
});

test("authenticated audit uses only fixed GET contract and preserves unknown evidence", async () => {
  const c = connector(async (url, init) => {
    assert.equal(url, "https://kongnightlife.com/api/admin/ceo/operations");
    assert.equal(init?.method, "GET");
    assert.equal(init?.redirect, "error");
    assert.equal((init?.headers as Record<string, string>).Authorization, `Bearer ${TOKEN}`);
    assert.ok(init?.signal);
    return json(operations());
  });
  const probe = await c.probeOfficeKong();
  assert.equal(probe.status, "ready");
  assert.equal(probe.agents?.[0].state, "unknown");
  const audit = await c.runOfficeKongReadOnly();
  assert.equal(audit.evidence.generatedAt, NOW.toISOString());
  assert.equal(audit.evidence.agents[0].lastRunAt, null);
  assert.match(audit.text, /2 sin evidencia verificable/);
  assert.match(audit.text, /no inicia agentes, no lee WhatsApp/);
});

for (const status of [401, 403, 302, 500]) {
  test(`HTTP ${status} blocks without exposing response or token`, async () => {
    const result = await connector(async () => new Response(TOKEN, { status })).probeOfficeKong();
    assert.equal(result.status, "blocked");
    assert.equal(result.agents, undefined);
    assert.ok(!JSON.stringify(result).includes(TOKEN));
  });
}

test("HTML login pages and invalid JSON are rejected", async () => {
  for (const response of [new Response("<html>Login</html>", { headers: { "content-type": "text/html" } }), new Response("invalid-json", { headers: { "content-type": "application/json" } })]) {
    const result = await connector(async () => response).probeOfficeKong();
    assert.equal(result.status, "blocked");
  }
});

test("malformed core DTO and unexpected agent fields never become connected", async () => {
  const missing = operations();
  delete (missing as Partial<typeof missing>).metrics;
  const invalidState = operations();
  invalidState.agents[0].state = "connected";
  const unexpectedAgentField = operations();
  (unexpectedAgentField.agents[0] as Record<string, unknown>).privateToken = TOKEN;
  for (const payload of [missing, unexpectedAgentField, { ...operations(), agents: [] }]) {
    assert.equal((await connector(async () => json(payload)).probeOfficeKong()).status, "blocked");
  }
  // An unrecognized state is never treated as connected: it degrades to "unknown" for that agent only.
  const probe = await connector(async () => json(invalidState)).probeOfficeKong();
  assert.equal(probe.status, "ready");
  assert.equal(probe.agents?.[0].state, "unknown");
});

test("new operations root metadata is discarded rather than exposed or treated as evidence", async () => {
  const payload = { ...operations(), privateMetadata: { secret: TOKEN, privateNote: "never-expose-this-metadata" },
    cityAgentBreakdown: { unrecognized: "not-the-trusted-city-contract" } };
  const c = connector(async () => json(payload));
  const probe = await c.probeOfficeKong();
  assert.equal(probe.status, "ready");
  const audit = await c.runOfficeKongReadOnly();
  for (const output of [probe, audit]) {
    const serialized = JSON.stringify(output);
    assert.ok(!serialized.includes("privateMetadata"));
    assert.ok(!serialized.includes("never-expose-this-metadata"));
    assert.ok(!serialized.includes("cityAgentBreakdown"));
    assert.ok(!serialized.includes(TOKEN));
  }
  assert.equal(audit.evidence.cities[0].id, "miami");
});

test("service-mode metadata from the new KONG operations contract survives strict read-only parsing", async () => {
  const modes = [
    ...["restaurant_secretary", "legacy_ceo", "restaurant_deals", "kong_ai_chat"].map(id => ({ id, operationMode: "on_demand" })),
    ...["error_analyzer", "venue_events", "promoter_reminders", "image_health", "proactive_notifications", "backend_watchdog"].map(id => ({ id, operationMode: "scheduled" })),
  ];
  const payload = { ...operations(), agents: [...operations().agents, ...modes.map(({id, operationMode}) => ({
    ...operations().agents[0], id, name: id, kind: "system", state: "unknown", blocker: null,
    operationMode, evidencePending: true,
  }))] };
  const client = connector(async () => json(payload));
  const probe = await client.probeOfficeKong();
  assert.equal(probe.status, "ready");
  const audit = await client.runOfficeKongReadOnly();
  for (const agents of [probe.agents!, audit.evidence.agents]) {
    assert.equal(agents.filter(agent => agent.kind === "system").length, 11);
    for (const expected of modes) {
      const actual = agents.find(agent => agent.id === expected.id)!;
      assert.equal(actual.operationMode, expected.operationMode);
      assert.equal(actual.evidencePending, true);
      assert.equal(actual.state, "unknown", "Service design must not establish activity or health");
      assert.equal(actual.lastRunAt, null);
      assert.equal(actual.nextRunAt, null);
    }
  }
});

test("service metadata remains optional and validates exact enum and boolean types", async () => {
  for (const fields of [{}, {operationMode: "on_demand"}, {operationMode: "scheduled"}, {evidencePending: false}, {evidencePending: true}]) {
    const payload = {...operations(), agents: [{...operations().agents[0], ...fields}]};
    assert.equal((await connector(async () => json(payload)).probeOfficeKong()).status, "ready");
  }
  for (const fields of [{operationMode: "always_on"}, {operationMode: null}, {operationMode: true},
    {evidencePending: "true"}, {evidencePending: null}, {evidencePending: 1},
    {operationMode: "scheduled", evidencePending: true, unrecognizedAgentField: "must reject"}]) {
    const payload = {...operations(), agents: [{...operations().agents[0], ...fields}]};
    await assert.rejects(connector(async () => json(payload)).runOfficeKongReadOnly(),
      (error: unknown) => error instanceof OfficeKongError && error.code === "INVALID_RESPONSE");
  }
});

test("event-driven receipt aggregates remain strict and do not establish live reader activity", async () => {
  const aggregate = { windowDays: 30, receivedCount: 2, appliedCount: 1, pendingCount: 1, lastReceivedAt: null, lastAppliedAt: null };
  const agent = { ...operations().agents[0], id: "black_room_whatsapp_reader", kind: "system", state: "unknown", operationMode: "event_driven", verifiedActivity: aggregate };
  const payload = { ...operations(), agents: [...operations().agents, agent] };
  const result = await connector(async () => json(payload)).runOfficeKongReadOnly();
  const parsed = result.evidence.agents.find(item => item.id === agent.id)!;
  assert.deepEqual(parsed.verifiedActivity, aggregate);
  assert.equal(parsed.state, "unknown");
  assert.equal(result.evidence.whatsappReader, undefined);
  for (const invalid of [{ ...aggregate, chat: "private" }, { ...aggregate, receivedCount: -1 }, { ...aggregate, lastAppliedAt: "not-a-timestamp" }]) {
    await assert.rejects(connector(async () => json({ ...payload, agents: [{ ...agent, verifiedActivity: invalid }] })).runOfficeKongReadOnly(),
      (error: unknown) => error instanceof OfficeKongError && error.code === "INVALID_RESPONSE");
  }
});

test("old and implausibly future snapshots are rejected", async () => {
  for (const offset of [-300_001, 30_001]) {
    const payload = { ...operations(), generatedAt: new Date(NOW.getTime() + offset).toISOString() };
    await assert.rejects(connector(async () => json(payload)).runOfficeKongReadOnly(), (error: unknown) => error instanceof OfficeKongError && error.code === "STALE_SNAPSHOT");
  }
});

test("declared and streamed bodies over one MiB are rejected", async () => {
  let cancelled = false;
  const huge = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(1024 * 1024 + 1)); },
    cancel() { cancelled = true; },
  });
  for (const response of [new Response("{}", { headers: { "content-type": "application/json", "content-length": String(1024 * 1024 + 1) } }), new Response(huge, { headers: { "content-type": "application/json" } })]) {
    await assert.rejects(connector(async () => response).runOfficeKongReadOnly(), (error: unknown) => error instanceof OfficeKongError && error.code === "RESPONSE_TOO_LARGE");
  }
  assert.equal(cancelled, true);
});

test("network errors never expose token and echoed credentials are redacted in evidence", async () => {
  const blocked = await connector(async () => { throw new Error(`Authorization: Bearer ${TOKEN}`); }).probeOfficeKong();
  assert.ok(!JSON.stringify(blocked).includes(TOKEN));
  const payload = operations();
  payload.agents[0].blocker = `Bearer ${TOKEN}`;
  const output = await connector(async () => json(payload)).runOfficeKongReadOnly();
  assert.ok(!JSON.stringify(output).includes(TOKEN));
  assert.match(output.evidence.agents[0].blocker ?? "", /redacted/);
});

test("probe stays operations-only while a full audit reads every city and all seven category rows", async () => {
  const ids = ["miami", ...Array.from({ length: 23 }, (_, index) => `additional-city-${index}`), "buenos-aires"];
  const cityData = citiesFixture(ids);
  const operationData = operations();
  operationData.agents = ids.map(id => ({ ...operationData.agents[0], id: `city:${id}`, name: id }));
  const calls: string[] = [];
  const c = createOfficeKongConnector({ token: () => TOKEN, now: () => NOW, fetchImpl: async (url, init) => {
    calls.push(String(url));
    assert.equal(init?.method, "GET");
    assert.equal(init?.redirect, "error");
    assert.equal((init?.headers as Record<string, string>).Authorization, `Bearer ${TOKEN}`);
    return json(url === CITIES_URL ? cityData : operationData);
  } });
  assert.equal((await c.probeOfficeKong()).status, "ready");
  assert.deepEqual(calls, ["https://kongnightlife.com/api/admin/ceo/operations"]);
  const audit = await c.runOfficeKongReadOnly();
  assert.equal(audit.evidence.cities.length, ids.length);
  assert.equal(audit.evidence.cities.reduce((sum, city) => sum + city.categories.length, 0), ids.length * OFFICE_KONG_CITY_CATEGORIES.length);
  assert.equal(audit.evidence.cities.find(city => city.id === "buenos-aires")?.currency, "ARS");
  assert.equal(audit.evidence.cityCoverageComplete, true);
  assert.ok(audit.evidence.cities.every(city => city.categories.every(category => category.state === "unknown" && category.evidence === "persisted")));
  assert.equal(calls.filter(url => url === CITIES_URL).length, 1);
});

test("missing category evidence stays unknown and never becomes a fabricated healthy job", async () => {
  const cityData = citiesFixture();
  cityData.cities[0].jobs = cityData.cities[0].jobs.filter(job => job.category !== "vip");
  const c = createOfficeKongConnector({ token: () => TOKEN, now: () => NOW, fetchImpl: async url => json(url === CITIES_URL ? cityData : operations()) });
  const audit = await c.runOfficeKongReadOnly();
  const vip = audit.evidence.cities[0].categories.find(category => category.category === "vip")!;
  assert.equal(vip.state, "unknown");
  assert.equal(vip.evidence, "missing");
  assert.equal(vip.lastRunAt, null);
  assert.equal(audit.evidence.cityCoverageComplete, false);
  assert.match(audit.text, /Faltan trabajos/);
});

test("city endpoint failure and registry mismatch reject the full audit", async () => {
  for (const cityResponse of [() => new Response("forbidden", { status: 403 }), () => json({ ...citiesFixture(), cities: [] }), () => json(citiesFixture(["miami", "buenos-aires"]))]) {
    const c = createOfficeKongConnector({ token: () => TOKEN, now: () => NOW, fetchImpl: async url => url === CITIES_URL ? cityResponse() : json(operations()) });
    await assert.rejects(c.runOfficeKongReadOnly(), error => error instanceof OfficeKongError);
  }
});

test("city jobs with duplicate categories or foreign ownership are rejected", async () => {
  for (const mutate of [(data: ReturnType<typeof citiesFixture>) => { data.cities[0].jobs[1] = data.cities[0].jobs[0]; },
    (data: ReturnType<typeof citiesFixture>) => { data.cities[0].jobs[0].city_id = "another-city"; }]) {
    const cityData = citiesFixture(); mutate(cityData);
    const c = createOfficeKongConnector({ token: () => TOKEN, now: () => NOW, fetchImpl: async url => json(url === CITIES_URL ? cityData : operations()) });
    await assert.rejects(c.runOfficeKongReadOnly(), error => error instanceof OfficeKongError && error.code === "INVALID_RESPONSE");
  }
});

test("category state derives from durable timestamps, leases and actual failures", async () => {
  const base = citiesFixture();
  const cityData = { ...base, cities: base.cities.map(city => ({ ...city, status: "healthy", jobs: city.jobs.map(job => ({ ...job,
    last_started_at: NOW.toISOString(), last_completed_at: NOW.toISOString(), last_success_at: NOW.toISOString(), report: { status: "healthy" },
    ...(job.category === "vip" ? { lease_until: new Date(NOW.getTime() + 60_000).toISOString() } : {}),
    ...(job.category === "restaurants" ? { last_error: TOKEN } : {}),
    ...(job.category === "events" ? { last_success_at: new Date(NOW.getTime() - 2 * Number(job.interval_ms) - 1).toISOString() } : {}),
    ...(job.category === "sports" ? { last_success_at: null, last_completed_at: null, report: {} } : {}),
    ...(job.category === "experiences" ? { report: { status: "needs_attention", issues: ["Paid discovery disabled: $0 provider budget"] } } : {}),
    ...(job.category === "media" ? { last_started_at: new Date(NOW.getTime() + 60_000).toISOString() } : {}),
  })) })) };
  const c = createOfficeKongConnector({ token: () => TOKEN, now: () => NOW, fetchImpl: async url => json(url === CITIES_URL ? cityData : operations()) });
  const audit = await c.runOfficeKongReadOnly();
  const states = Object.fromEntries(audit.evidence.cities[0].categories.map(category => [category.category, category.state]));
  assert.deepEqual(states, { clubs: "healthy", vip: "running", restaurants: "attention", events: "stale", sports: "unknown", experiences: "attention", media: "unknown", discovery: "healthy" });
  assert.equal(audit.evidence.cities[0].status, "needs_attention");
  assert.ok(!JSON.stringify(audit).includes(TOKEN));
  cityData.enabled = false;
  const disabled = await c.runOfficeKongReadOnly();
  assert.ok(disabled.evidence.cities[0].categories.every(category => category.state === "disabled"));
});

test("newer KONG contract: idle, coverage and active city verdicts parse; one unknown state degrades only that agent", async () => {
  const coverage = { percent: 62, categoriesComplete: 4, categoriesTotal: 7, pendingItems: 12, configurationNotices: ["Google Places: $0 (desactivado)."] };
  const payload = { ...operations(), agents: [
    { ...operations().agents[0], state: "healthy", coverage },
    { ...operations().agents[0], id: "kong_ai_chat", name: "Asistente", kind: "system", state: "idle", operationMode: "on_demand", evidencePending: false, blocker: null, nextAction: "Disponible bajo demanda" },
    { ...operations().agents[0], id: "future_service", name: "Futuro", kind: "system", state: "hibernating", blocker: null },
  ] };
  const cities = citiesFixture();
  cities.cities[0].status = "active";
  const client = createOfficeKongConnector({ token: () => TOKEN, now: () => NOW,
    fetchImpl: async url => url === CITIES_URL ? json(cities) : json(payload) });
  assert.equal((await client.probeOfficeKong()).status, "ready");
  const audit = await client.runOfficeKongReadOnly();
  const byId = new Map(audit.evidence.agents.map(agent => [agent.id, agent]));
  assert.deepEqual(byId.get("city:miami")?.coverage, coverage);
  assert.equal(byId.get("kong_ai_chat")?.state, "idle");
  assert.equal(byId.get("future_service")?.state, "unknown");
  assert.equal(audit.evidence.cities[0].id, "miami");
  // A malformed informational coverage block is dropped, not fatal.
  const bad = { ...payload, agents: [{ ...payload.agents[0], coverage: { percent: "62" } }, ...payload.agents.slice(1)] };
  const tolerant = await createOfficeKongConnector({ token: () => TOKEN, now: () => NOW,
    fetchImpl: async url => url === CITIES_URL ? json(cities) : json(bad) }).runOfficeKongReadOnly();
  assert.equal(tolerant.evidence.agents.find(agent => agent.id === "city:miami")?.coverage, undefined);
});

test("discovery (8th KONG category) is read with its counts, and the operations agent may carry discovery evidence", async () => {
  const base = citiesFixture();
  const done = { last_started_at: NOW.toISOString(), last_completed_at: NOW.toISOString(), last_success_at: NOW.toISOString() };
  const cityData = { ...base, cities: base.cities.map(city => ({ ...city, jobs: city.jobs.map(job => job.category === "discovery"
    ? { ...job, ...done, report: { status: "healthy", discovery: { mode: "deterministic", found: 9, added: 2, queuedForReview: 3, rejected: 4, alreadyInKong: 1, pagesChecked: 8, reviewPendingTotal: 5, titles: ["must be stripped"] } } }
    : job) })) };
  const ops = operations();
  (ops.agents[0] as Record<string, unknown>).discovery = { mode: "deterministic", lastRunAt: NOW.toISOString(), found: 9, added: 2, queuedForReview: 3,
    rejected: 4, alreadyInKong: 1, reviewPending: 5, aiSpentUsd: 0, aiCapUsd: 0 };
  const c = createOfficeKongConnector({ token: () => TOKEN, now: () => NOW, fetchImpl: async url => json(url === CITIES_URL ? cityData : ops) });
  const audit = await c.runOfficeKongReadOnly();
  const discovery = audit.evidence.cities[0].categories.find(category => category.category === "discovery")!;
  assert.equal(discovery.state, "healthy");
  assert.deepEqual(discovery.discovery, { mode: "deterministic", found: 9, added: 2, queuedForReview: 3, rejected: 4, alreadyInKong: 1, pagesChecked: 8, reviewPendingTotal: 5 });
  assert.equal(audit.evidence.cities[0].categories.length, 8);
  assert.equal((audit.evidence.agents[0] as Record<string, any>).discovery.added, 2);
  // Malformed discovery counts never fail the read; they are simply omitted.
  const broken = { ...cityData, cities: cityData.cities.map(city => ({ ...city, jobs: city.jobs.map(job => job.category === "discovery" ? { ...job, report: { status: "healthy", discovery: { found: -1 } } } : job) })) };
  const tolerant = await createOfficeKongConnector({ token: () => TOKEN, now: () => NOW, fetchImpl: async url => json(url === CITIES_URL ? broken : operations()) }).runOfficeKongReadOnly();
  assert.equal(tolerant.evidence.cities[0].categories.find(category => category.category === "discovery")?.discovery, undefined);
});

test("an older KONG without discovery and a newer KONG with unknown categories both keep the city read working", async () => {
  const legacy = citiesFixture();
  legacy.cities[0].jobs = legacy.cities[0].jobs.filter(job => job.category !== "discovery");
  const older = await createOfficeKongConnector({ token: () => TOKEN, now: () => NOW, fetchImpl: async url => json(url === CITIES_URL ? legacy : operations()) }).runOfficeKongReadOnly();
  const missing = older.evidence.cities[0].categories.find(category => category.category === "discovery")!;
  assert.deepEqual([missing.state, missing.evidence], ["unknown", "missing"]);

  const future = citiesFixture();
  future.cities[0].jobs = [...future.cities[0].jobs,
    { ...future.cities[0].jobs[0], category: "future_agent" as any },
    { category: "another_future_agent", unexpected: true } as any,
  ];
  const newer = await createOfficeKongConnector({ token: () => TOKEN, now: () => NOW, fetchImpl: async url => json(url === CITIES_URL ? future : operations()) }).runOfficeKongReadOnly();
  assert.deepEqual(newer.evidence.cities[0].categories.map(category => category.category), [...OFFICE_KONG_CITY_CATEGORIES]);
  assert.ok(newer.evidence.cities[0].categories.every(category => category.evidence === "persisted"));

  // A KNOWN category with a malformed shape is still rejected: tolerance is per unknown category only.
  const malformed = citiesFixture();
  (malformed.cities[0].jobs[0] as Record<string, unknown>).interval_ms = "not-a-number";
  await assert.rejects(createOfficeKongConnector({ token: () => TOKEN, now: () => NOW, fetchImpl: async url => json(url === CITIES_URL ? malformed : operations()) }).runOfficeKongReadOnly(),
    (error: unknown) => error instanceof OfficeKongError && error.code === "INVALID_RESPONSE");
});
