import test from "node:test";
import assert from "node:assert/strict";
import { agentProbes, summarizeProbe } from "../shared/agent-live-status";
import { advanceCompany, emptyCompanyState, SETUP_NEUTRAL_BATTERY, SETUP_RECOVERY_PER_CYCLE } from "../shared/agent-company";
import { uptimeStatusForApp, withUptimeHealth } from "../shared/app-health-uptime";
import { diagnoseGitHubTokenEnv, gitHubSetupReason } from "../server/github-token-diagnosis";

const NOW = Date.parse("2026-11-11T12:00:00Z");
const ok = (body: unknown) => ({ ok: true as const, status: 200, body });

test("blackroom: an observation built a few ms after the reader's clock is fresh, not stale", () => {
  const operations = (checkedAtOffsetMs: number) => ok({
    operations: { checkedAt: new Date(NOW + checkedAtOffsetMs).toISOString(), state: "waiting", worker: { online: true }, learning: {}, actions: [] },
  });
  assert.notEqual(summarizeProbe(agentProbes["blackroom-videos"], operations(40), NOW).label, "Evidencia desactualizada");
  assert.notEqual(summarizeProbe(agentProbes["blackroom-videos"], operations(-30_000), NOW).label, "Evidencia desactualizada");
  // Really old or far-future observations stay stale.
  assert.equal(summarizeProbe(agentProbes["blackroom-videos"], operations(-120_000), NOW).label, "Evidencia desactualizada");
  assert.equal(summarizeProbe(agentProbes["blackroom-videos"], operations(60_000), NOW).label, "Evidencia desactualizada");
});

test("github: the missing setup is named in the detail", () => {
  const status = summarizeProbe(agentProbes.github, ok({ connected: false, reason: "Falta el Secret GITHUB_TOKEN" }), NOW);
  assert.equal(status.state, "needs-setup");
  assert.equal(status.label, "GitHub sin conectar");
  assert.match(status.detail || "", /GITHUB_TOKEN/);
  assert.match(summarizeProbe(agentProbes.code, ok({ connected: false }), NOW).detail || "", /GITHUB_TOKEN/);
});

test("github token diagnosis: only GITHUB_TOKEN/GH_TOKEN or the connector count; the factory token is never reused", () => {
  assert.equal(diagnoseGitHubTokenEnv({ GITHUB_TOKEN: "ghp_abc123" } as NodeJS.ProcessEnv).source, "GITHUB_TOKEN");
  assert.equal(diagnoseGitHubTokenEnv({ GH_TOKEN: "github_pat_A1_b2" } as NodeJS.ProcessEnv).source, "GH_TOKEN");
  const factory = diagnoseGitHubTokenEnv({ SOFTWARE_FACTORY_GITHUB_TOKEN: "ghp_factory1" } as NodeJS.ProcessEnv);
  assert.equal(factory.token, null);
  assert.equal(factory.factoryTokenOnly, true);
  const reason = gitHubSetupReason(factory, { stage: "connector" });
  assert.match(reason, /GITHUB_TOKEN/);
  assert.match(reason, /SOFTWARE_FACTORY_GITHUB_TOKEN es exclusivo/);
  assert.doesNotMatch(reason, /ghp_factory1/);
  const malformed = diagnoseGitHubTokenEnv({ GITHUB_TOKEN: "\"ghp_quoted\"" } as NodeJS.ProcessEnv);
  assert.deepEqual(malformed.invalidFormat, ["GITHUB_TOKEN"]);
  assert.match(gitHubSetupReason(malformed), /formato no reconocido/);
  assert.doesNotMatch(gitHubSetupReason(malformed), /quoted/);
  const connector = diagnoseGitHubTokenEnv({ REPL_IDENTITY: "id", REPLIT_CONNECTORS_HOSTNAME: "connectors.example" } as NodeJS.ProcessEnv);
  assert.equal(connector.connectorIdentity, true);
  assert.match(gitHubSetupReason(connector), /conector GitHub de Replit no esta autorizado/);
  assert.match(gitHubSetupReason(connector, { stage: "api", status: 401 }), /rechazo la credencial \(401\)/);
});

test("news: a desk that never ran says why (scheduler disabled / failed)", () => {
  const disabled = summarizeProbe(agentProbes.news, ok({ bootstrapped: false, scheduler: { enabled: false, started: false } }), NOW);
  assert.equal(disabled.label, "Sin configurar");
  assert.match(disabled.detail || "", /CLIPPERS_LOCAL_NEWS_SCHEDULER_ENABLED=false/);
  const failed = summarizeProbe(agentProbes["news:ny-news"], ok({ bootstrapped: false, scheduler: { enabled: true, started: true, lastError: "Error: EACCES" } }), NOW);
  assert.match(failed.detail || "", /EACCES/);
  assert.match(summarizeProbe(agentProbes.news, ok({ bootstrapped: false }), NOW).detail || "", /no ha corrido nunca/);
});

test("automations: a connector failure names its cause and stays penalty-exempt", () => {
  const run = { id: "r1", status: "failed", errorMessage: "Google connector not connected", startedAt: new Date(NOW - 60_000).toISOString(), finishedAt: new Date(NOW - 30_000).toISOString() };
  const status = summarizeProbe(agentProbes.automations, ok([run]), NOW);
  assert.equal(status.state, "error");
  assert.equal(status.lifePenaltyExempt, true);
  assert.match(status.detail || "", /Causa: Google connector not connected/);
});

test("control: apps never scanned take the fresh uptime monitor result for the same host or repo", () => {
  const fresh = new Date(NOW - 2 * 60_000).toISOString();
  const apps = [
    { id: "a", name: "BlackOps", status: "unknown", publicUrl: "https://robertwebsites.com", healthUrl: "https://robertwebsites.com/api/health" },
    { id: "b", name: "Web", status: "unknown", publicUrl: "https://blackroomus.com", githubRepo: "robertmanzanillag-jpg/br-website" },
    { id: "c", name: "Scanned", status: "degraded", publicUrl: "https://scanned.example" },
    { id: "d", name: "Unmonitored", status: "unknown", publicUrl: "https://none.example" },
  ];
  const monitors = [
    { url: "https://www.robertwebsites.com/", status: "online", lastCheck: fresh, checkInterval: 5 },
    { url: "https://other.example", githubRepo: "robertmanzanillag-jpg/br-website", status: "offline", lastCheck: fresh, checkInterval: 5 },
    { url: "https://scanned.example", status: "online", lastCheck: fresh, checkInterval: 5 },
  ];
  const result = withUptimeHealth(apps, monitors, NOW);
  assert.equal(result[0].status, "healthy");
  assert.equal(result[0].statusSource, "uptime");
  assert.equal(result[1].status, "down");
  assert.equal(result[2].status, "degraded", "a scan result is never overridden");
  assert.equal(result[3].status, "unknown");
  // Stale or unchecked monitors are not current evidence.
  assert.equal(uptimeStatusForApp(apps[0], [{ ...monitors[0], lastCheck: new Date(NOW - 2 * 60 * 60_000).toISOString() }], NOW), null);
  assert.equal(uptimeStatusForApp(apps[0], [{ ...monitors[0], status: "unknown" }], NOW), null);
  // Worst result wins when several monitors match.
  assert.equal(uptimeStatusForApp(apps[0], [monitors[0], { ...monitors[0], status: "degraded" }], NOW), "degraded");

  const summary = (list: typeof result) => ({
    apps: list,
    summary: { totalApps: list.length, healthy: list.filter((a) => a.status === "healthy").length, degraded: list.filter((a) => a.status === "degraded").length, down: list.filter((a) => a.status === "down").length, unknown: list.filter((a) => a.status === "unknown").length, openIncidents: 0, criticalIncidents: 0 },
  });
  const allUnknown = apps.map((app) => ({ ...app, status: "unknown" }));
  assert.equal(summarizeProbe(agentProbes.control, ok(summary(allUnknown)), NOW).label, "Apps sin chequeos de salud");
  assert.notEqual(summarizeProbe(agentProbes.control, ok(summary(withUptimeHealth(allUnknown, monitors, NOW))), NOW).label, "Apps sin chequeos de salud");
});

test("battery: agents blocked only by setup drift back to neutral, never above, never down", () => {
  const roles = { code: "Code", radio: "Radio", automations: "Autos" };
  let state = emptyCompanyState();
  state = { ...state, careers: Object.fromEntries(Object.entries({ code: 20, radio: 70, automations: 0 }).map(([agentId, battery]) => [agentId, {
    agentId, generation: 1, nickname: agentId, points: 5, battery, lastState: null, cyclesWorking: 0, cyclesTotal: 0, ordersDone: 0, firedCount: 0, hiredAt: new Date(NOW - 10 * 86_400_000).toISOString(), memory: [],
  }])) as typeof state.careers };
  const cycle = () => {
    state = advanceCompany(state, { now: NOW, roles, statuses: {
      code: { state: "needs-setup", label: "GitHub sin conectar", lifePenaltyExempt: true },
      radio: { state: "needs-setup", label: "x", lifePenaltyExempt: true },
      automations: { state: "error", label: "1 corrida fallida", evidenceId: "automation:r1", lifePenaltyExempt: true },
    } }).state;
  };
  cycle();
  assert.equal(state.careers.code.battery, 20 + SETUP_RECOVERY_PER_CYCLE);
  assert.equal(state.careers.automations.battery, SETUP_RECOVERY_PER_CYCLE);
  assert.equal(state.careers.radio.battery, 70, "above neutral is never reduced");
  assert.equal(state.careers.code.points, 5, "no points for waiting");
  for (let i = 0; i < 40; i += 1) cycle();
  assert.equal(state.careers.code.battery, SETUP_NEUTRAL_BATTERY);
  assert.equal(state.careers.automations.battery, SETUP_NEUTRAL_BATTERY);
  assert.equal(state.careers.automations.firedCount, 0);
  // An attributable failure still costs battery.
  state = advanceCompany(state, { now: NOW, roles, statuses: { automations: { state: "error", label: "fallo", evidenceId: "automation:r2" } } }).state;
  assert.equal(state.careers.automations.battery, SETUP_NEUTRAL_BATTERY - 10);
});

test("battery: frozen reconciliation careers and trainees are not touched by the setup drift", () => {
  let state = emptyCompanyState();
  const base = { generation: 1, points: 0, battery: 10, lastState: null, cyclesWorking: 0, cyclesTotal: 0, ordersDone: 0, firedCount: 0, hiredAt: new Date(NOW - 86_400_000 * 5).toISOString(), memory: [] };
  state = { ...state, careers: {
    frozen: { ...base, agentId: "frozen", nickname: "F", scoreReconciliation: { reason: "legacy" } },
    trainee: { ...base, agentId: "trainee", nickname: "T", inTrainingUntilGeneration: 1 },
  } as unknown as typeof state.careers };
  state = advanceCompany(state, { now: NOW, roles: {}, statuses: { frozen: { state: "needs-setup", label: "x" }, trainee: { state: "needs-setup", label: "x" } } }).state;
  assert.equal(state.careers.frozen.battery, 10);
  assert.equal(state.careers.trainee.battery, 10);
});
