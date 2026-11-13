import test from "node:test";
import assert from "node:assert/strict";
import { agentProbes, runProbe, summarizeProbe, presentProbeStatus } from "../shared/agent-live-status";
import {advanceCompany,emptyCompanyState} from "../shared/agent-company";

test('connection, readiness and past reports never animate as current execution',()=>{
  for(const id of ['assistant','ceo','github','code','marketing-cmo','portfolio','radio','app-qa','cybersecurity','news','kong-videos','legal','clippers','automations']) {
    const status=presentProbeStatus(agentProbes[id],{state:'working',label:'Prior observation',activity:['source record'],evidenceId:id==='automations'?'stored-run':undefined});
    assert.equal(status.state,'available');assert.equal(status.lifePenaltyExempt,true);assert.deepEqual(status.activity,['source record']);
  }
  const completed=presentProbeStatus(agentProbes.clippers,{state:'working',label:'Ultima corrida OK'});
  assert.match(completed.label,/completada/);
  const error={state:'error' as const,label:'Real error'};assert.deepEqual(presentProbeStatus(agentProbes.radio,error),error);
});

test('skipped and running polls never score; only a distinct completed success earns points',()=>{
  const now=Date.parse('2026-11-06T12:00:00Z');
  const row=(status:string,id=status)=>({id,status,startedAt:new Date(now-1000).toISOString(),finishedAt:new Date(now).toISOString()});
  let state=emptyCompanyState();
  const apply=(body:unknown[])=>{const status=summarizeProbe(agentProbes.automations,{ok:true,status:200,body},now);state=advanceCompany(state,{now,roles:{automations:'Automation'},statuses:{automations:status}}).state;return status;};
  for(const status of ['skipped','running','pending_approval']) {assert.equal(apply([row(status)]).evidenceId,undefined);assert.equal(state.careers.automations.points,0);assert.equal(state.careers.automations.battery,80);}
  assert.equal(apply([row('success','success-1')]).evidenceId,'automation:success-1');
  const points=state.careers.automations.points,battery=state.careers.automations.battery;
  apply([row('skipped'),row('success','success-1')]);
  assert.equal(state.careers.automations.points,points);assert.equal(state.careers.automations.battery,battery);
  apply([{...row('success','unfinished'),finishedAt:null}]);assert.equal(state.careers.automations.points,points);
});

// Fixtures mirror the real server responses:
// - CEO: server/ceo-readiness.ts buildCeoReadinessReport -> { ready, status, checks: [{ id, label, status }] }
// - Revenue: server/revenue-stripe-routes.ts -> { ready, checks: { name: boolean } }
// - Clippers: server/clippers-runtime-status.ts -> { status, nextAction: { code, message }, configurationBlockers }
// - Dropshipping: server/dropshipping-ceo.ts getDropshippingLaunchReadiness -> { launchReadiness, snapshot }
// - Marketing: server/marketing-command-center.ts -> { globalScorecard: { clients, readyClients, approvalsNeeded } }
// - Automations: GET /api/automation-runs -> [{ status, startedAt }]
const ok = (body: unknown) => ({ ok: true as const, status: 200, body });
const NOW = Date.parse("2026-11-04T12:00:00Z");

test("every probe is read-only: no scan-on-GET or seeding endpoints", () => {
  const unsafeOnGet = ["/api/app-qa-agent/status", "/api/cybersecurity-agent/status", "/api/automation-manager/summary", "/api/automations"];
  for (const [agentId, probe] of Object.entries(agentProbes)) {
    assert.ok(probe.url.startsWith("/api/"), `${agentId} probes an API route`);
    assert.ok(!unsafeOnGet.includes(probe.url.split("?")[0]), `${agentId} must not poll ${probe.url}`);
    assert.ok(probe.intervalMs >= 60_000, `${agentId} polls at most once per minute`);
  }
});

test("missing, failed, unauthorized or non-JSON responses never read as working", () => {
  for (const probe of Object.values(agentProbes)) {
    assert.equal(summarizeProbe(probe, undefined).state, "checking");
    assert.equal(summarizeProbe(probe, { ok: false, status: 0, body: null, networkError: true }).state, "offline");
    assert.equal(summarizeProbe(probe, { ok: false, status: 401, body: { error: "auth" } }).label, "Requiere sesion");
    assert.equal(summarizeProbe(probe, { ok: false, status: 403, body: { error: "owner" } }).label, "Sin permiso");
    assert.equal(summarizeProbe(probe, { ok: false, status: 500, body: { error: "boom" } }).state, "error");
    assert.equal(summarizeProbe(probe, ok({ error: "Failed" })).state, "error");
    assert.notEqual(summarizeProbe(probe, ok(null)).state, "working", `${probe.kind}: empty body`);
    assert.notEqual(summarizeProbe(probe, ok({ unexpected: true }), NOW).state, "working", `${probe.kind}: unknown shape`);
  }
});

test("CEO readiness uses the checks array and treats warnings as operating", () => {
  const checks = [
    { id: "auth", label: "Auth", status: "warning" },
    { id: "telegram", label: "Telegram", status: "blocked" },
    { id: "ai", label: "AI", status: "ready" },
  ];
  const blocked = summarizeProbe(agentProbes.ceo, ok({ ready: false, status: "blocked", checks }));
  assert.equal(blocked.state, "needs-setup");
  assert.equal(blocked.detail, "Pendiente: Auth, Telegram");
  const warning = summarizeProbe(agentProbes.ceo, ok({ ready: false, status: "warning", checks: checks.slice(0, 1) }));
  assert.equal(warning.state, "working");
  assert.equal(warning.label, "Operativo con avisos");
  assert.equal(summarizeProbe(agentProbes.ceo, ok({ ready: true, status: "ready", checks: [] })).state, "working");
});

test("revenue readiness lists missing boolean checks", () => {
  const status = summarizeProbe(agentProbes.revenue, ok({ ready: false, checks: { accountSeparated: true, signedWebhook: false, telegram: false } }));
  assert.equal(status.state, "needs-setup");
  assert.equal(status.detail, "Pendiente: signedWebhook, telegram");
});

test("clippers: never_run and blocked are not working; nextAction message is shown", () => {
  const next = { code: "configure", message: "Conectar Metricool" };
  const neverRun = summarizeProbe(agentProbes.clippers, ok({ status: "never_run", nextAction: next, configurationBlockers: [] }));
  assert.equal(neverRun.state, "needs-setup");
  assert.equal(neverRun.detail, "Conectar Metricool");
  assert.equal(summarizeProbe(agentProbes.clippers, ok({ status: "blocked", nextAction: next, configurationBlockers: ["x"] })).state, "needs-setup");
  assert.equal(summarizeProbe(agentProbes.clippers, ok({ status: "completed", nextAction: next, configurationBlockers: ["x"] })).state, "needs-setup");
  assert.equal(summarizeProbe(agentProbes.clippers, ok({ status: "completed", nextAction: next, configurationBlockers: [] })).state, "working");
  assert.equal(summarizeProbe(agentProbes.clippers, ok({ status: "running", nextAction: next, configurationBlockers: [] })).label, "Procesando clips");
});

test("dropshipping: only a Profit Guard spend pause is a red stop", () => {
  const lr = (status: string, profitGuard = "ok") => ok({ launchReadiness: { status, summary: "x" }, snapshot: { profitGuard: { status: profitGuard } } });
  assert.equal(summarizeProbe(agentProbes.dropshipping, lr("blocked_safety", "pause_spend")).state, "error");
  assert.equal(summarizeProbe(agentProbes.dropshipping, lr("blocked_safety")).label, "Falta producto o supplier");
  assert.equal(summarizeProbe(agentProbes.dropshipping, lr("blocked_needs_accounts")).state, "needs-setup");
  assert.equal(summarizeProbe(agentProbes.dropshipping, lr("pre_account_ready")).state, "working");
  assert.equal(summarizeProbe(agentProbes.dropshipping, lr("something_new")).state, "error");
});

test("marketing reports ready clients from the scorecard", () => {
  const status = summarizeProbe(agentProbes["marketing-cmo"], ok({ globalScorecard: { clients: 6, readyClients: 4, approvalsNeeded: 2 } }));
  assert.equal(status.label, "4/6 clientes listos");
  assert.equal(status.detail, "2 aprobaciones pendientes");
  assert.equal(summarizeProbe(agentProbes["marketing-cmo"], ok({ globalScorecard: { clients: 0 } })).state, "needs-setup");
});

test("automations read recent runs, not the seeding summary", () => {
  const run = (status: string, hoursAgo: number) => ({ status, startedAt: new Date(NOW - hoursAgo * 3_600_000).toISOString() });
  assert.equal(summarizeProbe(agentProbes.automations, ok([run("success", 1), run("failed", 2)]), NOW).state, "error");
  assert.equal(summarizeProbe(agentProbes.automations, ok([run("success", 40)]), NOW).state, "offline");
  assert.equal(summarizeProbe(agentProbes.automations, ok([run("skipped", 1), run("skipped", 2)]), NOW).state, "offline");
  const working = summarizeProbe(agentProbes.automations, ok([run("success", 1), run("success", 3), run("pending_approval", 4)]), NOW);
  assert.equal(working.state, "working");
  assert.equal(working.label, "2 corridas en 24 h");
  assert.equal(working.detail, "1 aprobacion pendiente");
});

test("calendar, github, portfolio and radio", () => {
  assert.equal(summarizeProbe(agentProbes.assistant, ok({ google: false, zoho: false })).state, "needs-setup");
  assert.equal(summarizeProbe(agentProbes.assistant, ok({ google: true, zoho: false })).detail, "Google");
  assert.equal(summarizeProbe(agentProbes.github, ok({ connected: true, user: { login: "rob" } })).detail, "@rob");
  assert.equal(summarizeProbe(agentProbes.github, ok({ connected: false })).state, "needs-setup");
  assert.equal(summarizeProbe(agentProbes.portfolio, ok({ totalValue: 0, distribution: [] })).state, "needs-setup");
  assert.equal(summarizeProbe(agentProbes.portfolio, ok({ totalValue: 10, distribution: [{ type: "stock" }] })).state, "working");
  assert.equal(summarizeProbe(agentProbes.radio, ok([])).state, "offline");
  assert.equal(summarizeProbe(agentProbes.radio, ok([{}, {}])).detail, "2 eventos proximos");
});

test("developer health and legal findings ask for attention without marking the agent broken", () => {
  const health = (summary: Record<string, number>) => ok({ summary });
  assert.equal(summarizeProbe(agentProbes.cybersecurity, health({ totalApps: 0 })).state, "needs-setup");
  assert.equal(summarizeProbe(agentProbes.cybersecurity, health({ totalApps: 4, criticalIncidents: 1 })).state, "needs-setup");
  assert.equal(summarizeProbe(agentProbes["app-qa"], health({ totalApps: 4, down: 1 })).label, "1 app caida");
  assert.equal(summarizeProbe(agentProbes.control, health({ totalApps: 4, unknown: 4 })).label, "Apps sin chequeos de salud");
  assert.equal(summarizeProbe(agentProbes.control, health({ totalApps: 4, degraded: 1 })).state, "needs-setup");
  const watching = summarizeProbe(agentProbes.control, health({ totalApps: 4, healthy: 4, openIncidents: 2 }));
  assert.equal(watching.state, "working");
  assert.equal(watching.label, "2 incidentes abiertos");
  assert.match(summarizeProbe(agentProbes["app-qa"], health({ totalApps: 4, healthy: 4 })).detail ?? "", /bajo demanda/);
  const legal = (body: Record<string, unknown>) => ok({ totalTargets: 3, githubConnected: true, summary: { critico: 0, revisar: 0 }, ...body });
  assert.equal(summarizeProbe(agentProbes.legal, legal({ summary: { critico: 2, revisar: 1 } })).state, "needs-setup");
  assert.equal(summarizeProbe(agentProbes.legal, legal({ githubConnected: false })).label, "GitHub sin conectar");
  assert.equal(summarizeProbe(agentProbes.legal, legal({})).label, "Revisando 3 apps");
});

test("runProbe maps fetch outcomes without throwing", async () => {
  const fake = (response: Response | Error) => (async () => {
    if (response instanceof Error) throw response;
    return response;
  }) as unknown as typeof fetch;
  assert.deepEqual(await runProbe("/api/x", fake(new Response(JSON.stringify({ a: 1 }), { status: 200 }))), { ok: true, status: 200, body: { a: 1 } });
  assert.deepEqual(await runProbe("/api/x", fake(new Response("not json", { status: 502 }))), { ok: false, status: 502, body: null });
  assert.deepEqual(await runProbe("/api/x", fake(new Error("offline"))), { ok: false, status: 0, body: null, networkError: true });
});

test("BlackRoom supervision separates activity, pause, stale evidence and learning", () => {
  const now = Date.parse("2026-11-05T12:00:00Z");
  const probe = agentProbes["blackroom-videos"];
  const operations = { checkedAt: new Date(now).toISOString(), state: "waiting", worker: { online: true, processing: false }, learning: { tiktok: { status: "stale", exactAttributed: 0 } }, actions: [{ message: "Recuperar métricas recientes" }] };
  const result = (value: unknown) => ({ ok: true as const, status: 200, body: { operations: value } });
  assert.equal(summarizeProbe(probe, result(operations), now).state, "checking");
  assert.match(summarizeProbe(probe, result(operations), now).problems!.join(" "), /métricas/);
  assert.equal(summarizeProbe(probe, result({ ...operations, state: "paused" }), now).state, "checking");
  assert.equal(summarizeProbe(probe, result({ ...operations, checkedAt: new Date(now - 91_000).toISOString() }), now).state, "needs-setup");
  assert.equal(summarizeProbe(probe, result({ ...operations, worker: { online: false } }), now).label, "Publicador desconectado");
  assert.equal(summarizeProbe(probe, result({ ...operations, state: "working", worker: { online: true, processing: true, progressEventId: "edit-1" } }), now).state, "checking");
  assert.equal(summarizeProbe(probe, result({ ...operations, state: "working", worker: { online: true, processing: true } }), now).state, "checking");
});

test("new real agents: Black Room videos, news and Kong videos", () => {
  const now = Date.parse("2026-11-04T12:00:00Z");
  const br = (online: boolean, totals: Record<string, number>) => ({ ok: true as const, status: 200, body: { agent: { totals }, remote: { online } } });
  assert.equal(summarizeProbe(agentProbes["blackroom-videos"], br(false, { queued: 3 }), now).label, "Publicador desconectado");
  assert.equal(summarizeProbe(agentProbes["blackroom-videos"], br(true, { queued: 2, processing: 1, scheduled: 4 }), now).state, "checking");
  assert.equal(summarizeProbe(agentProbes["blackroom-videos"], br(true, { retry: 2 }), now).state, "error");
  assert.equal(summarizeProbe(agentProbes["blackroom-videos"], br(true, {}), now).state, "offline");
  const news = (lastRunAt: string | null) => ({ ok: true as const, status: 200, body: { bootstrapped: true, lastRunAt, events: { active: 3 }, queue: { total: 2, approvalRequired: 1 } } });
  assert.equal(summarizeProbe(agentProbes.news, news(new Date(now - 3_600_000).toISOString()), now).state, "working");
  assert.equal(summarizeProbe(agentProbes.news, news(new Date(now - 30 * 3_600_000).toISOString()), now).state, "needs-setup");
  const kong = (outputs: Array<{ name: string; modifiedAt: string }>) => ({ ok: true as const, status: 200, body: { outputVideos: outputs, inputVideos: [] } });
  const fresh = kong([{ name: "kong-1.mp4", modifiedAt: new Date(now - 3_600_000).toISOString() }]);
  assert.equal(summarizeProbe(agentProbes["kong-videos"], fresh, now).state, "working");
  assert.match((summarizeProbe(agentProbes["kong-videos"], fresh, now).activity || []).join(" "), /kong-1\.mp4/);
  assert.equal(summarizeProbe(agentProbes["kong-videos"], kong([]), now).state, "needs-setup");
  assert.equal(summarizeProbe(agentProbes["kong-videos"], kong([{ name: "old", modifiedAt: new Date(now - 72 * 3_600_000).toISOString() }]), now).state, "offline");
});

// Shape of GET /api/clippers/local-news/status (server/clippers-local-news-agent.ts ClipperLocalNewsStatus).
const localNews = (overrides: Record<string, unknown> = {}) => ({
  bootstrapped: true,
  lastRunAt: new Date(Date.parse("2026-11-04T12:00:00Z") - 30 * 60_000).toISOString(),
  lanes: { "miami-news": { active: 3, resolved: 5, queued: 2 }, "ny-news": { active: 0, resolved: 1, queued: 0 } },
  editorial: { dailyPublishing: { accounts: {
    "miami-news": { facebook: { queuedToday: 4, target: 10, deficit: 6 }, x: { queuedToday: 10, target: 10, deficit: 0 } },
    "ny-news": { facebook: { queuedToday: 10, target: 10, deficit: 0 } },
  } } },
  connectors: [{ id: "fl511", lane: "miami-news", configured: false, requiresKey: true, public: false }, { id: "nws", lane: "ny-news", configured: true, requiresKey: false, public: true }],
  coverage: { miamiTraffic: "not_configured", nyTraffic: "notify_nyc_public" },
  ...overrides,
});

test("city desks: each city reports its own work and its own real problems", () => {
  const now = Date.parse("2026-11-04T12:00:00Z");
  const miami = summarizeProbe(agentProbes["news:miami-news"], ok(localNews()), now);
  assert.equal(miami.state, "working");
  assert.match(miami.label, /3 noticias · 2 en cola/);
  assert.deepEqual(miami.problems, ["Facebook: 4/10 hoy (faltan 6)", "Fuentes sin configurar: fl511", "Trafico sin cobertura configurada"]);
  const ny = summarizeProbe(agentProbes["news:ny-news"], ok(localNews()), now);
  assert.equal(ny.state, "working", "a quiet city with fresh rounds is not a failure");
  assert.match(ny.label, /Vigilando/);
  assert.equal(ny.problems, undefined);
  assert.equal(agentProbes["news:miami-news"].key, agentProbes.news.key, "cities reuse the news request");
});

test("city desks fail closed: missing city, stale rounds or never bootstrapped are not working", () => {
  const now = Date.parse("2026-11-04T12:00:00Z");
  assert.equal(summarizeProbe(agentProbes["news:ny-news"], ok(localNews({ lanes: { "miami-news": { active: 1, resolved: 0, queued: 0 } } })), now).state, "error");
  assert.equal(summarizeProbe(agentProbes["news:ny-news"], ok(localNews({ lastRunAt: "2026-11-02T00:00:00Z" })), now).state, "needs-setup");
  assert.equal(summarizeProbe(agentProbes["news:miami-news"], ok(localNews({ bootstrapped: false })), now).state, "needs-setup");
  assert.equal(summarizeProbe(agentProbes["news:miami-news"], { ok: false, status: 500, body: null }, now).state, "error");
});

test("KONG metrics agent: status and results come from the operations state, fail closed", () => {
  const now = Date.parse("2026-11-05T12:00:00Z");
  const body = { status: { "kong-metrics": { state: "working", label: "1/1 publicaciones medidas" } }, results: [{ title: "Venue: Club Prueba (Miami)", network: "instagram", impressions: 1200, engagements: 97 }] };
  const status = summarizeProbe(agentProbes["kong-metrics"], ok(body), now);
  assert.equal(status.state, "checking", "legacy working snapshots never earn repeat points");
  assert.match(status.activity?.[0] || "", /1200 vistas/);
  assert.equal(summarizeProbe(agentProbes["kong-metrics"], ok({ ...body, status: { "kong-metrics": { state: "checking", label: "Datos disponibles" } } }), now).state, "checking");
  assert.equal(summarizeProbe(agentProbes["kong-metrics"], ok({ status: { "kong-metrics": { state: "working?" } } }), now).state, "error");
  assert.equal(summarizeProbe(agentProbes["kong-metrics"], { ok: false, status: 403, body: null }, now).state, "needs-setup");
});

test("shared transport failure is penalty-exempt and automation evidence IDs stay stable across polls",()=>{
  const failed=summarizeProbe(agentProbes.automations,{ok:false,status:503,body:{error:"database unavailable"}},NOW);
  assert.equal(failed.lifePenaltyExempt,true);
  const body=[{id:"run-x",status:"failed",startedAt:new Date(NOW-1000).toISOString(),finishedAt:new Date(NOW).toISOString(),metadata:{failureKind:"agent_output",errorCode:"INVALID_RESULT"}}];
  const one=summarizeProbe(agentProbes.automations,ok(body),NOW);
  const two=summarizeProbe(agentProbes.automations,ok(body),NOW+60000);
  assert.equal(one.evidenceId,two.evidenceId);assert.ok(one.evidenceId);assert.notEqual(one.lifePenaltyExempt,true);
});

test("connector, infrastructure and unclassified execution failures remain visible without life penalties",()=>{
  for(const errorMessage of ['Google connector not connected','database unavailable','HTTP 429','request timeout','unclassified failure']) {
    const run={id:'failure',status:'failed',startedAt:new Date(NOW-1000).toISOString(),finishedAt:new Date(NOW).toISOString(),errorMessage};
    const status=summarizeProbe(agentProbes.automations,ok([run]),NOW);
    assert.equal(status.state,'error');assert.equal(status.lifePenaltyExempt,true);
  }
  const readiness=summarizeProbe(agentProbes.github,ok({connected:true}),NOW);
  assert.equal(readiness.lifePenaltyExempt,true);assert.equal(readiness.evidenceId,undefined);
  const invalid={id:'invalid',status:'failed',startedAt:new Date(NOW-1000).toISOString(),finishedAt:new Date(NOW+1000).toISOString(),metadata:{failureKind:'agent_output',errorCode:'INVALID_RESULT'}};
  assert.equal(summarizeProbe(agentProbes.automations,ok([invalid]),NOW).lifePenaltyExempt,true);
  const infra={...invalid,finishedAt:new Date(NOW).toISOString(),errorMessage:'Google connector not connected'};
  assert.equal(summarizeProbe(agentProbes.automations,ok([infra]),NOW).lifePenaltyExempt,true,'transport cause overrides contradictory attribution metadata');
});
