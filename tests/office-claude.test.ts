import assert from "node:assert/strict";
import test from "node:test";
import { createOfficeClaude, OfficeClaudeError, type OfficeClaudeProcessRequest, type OfficeClaudeProcessResult } from "../server/office-claude";

const auth = { code: 0, stdout: JSON.stringify({ loggedIn: true, authMethod: "claude.ai" }) };
const success = { code: 0, stdout: JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "Revision real", session_id: "session-123" }) };
const date = "2026-11-05T12:00:00.000Z";

function fixture(results: (OfficeClaudeProcessResult | Error)[] = [auth, success], env: NodeJS.ProcessEnv = {}) {
  const calls: OfficeClaudeProcessRequest[] = [];
  const office = createOfficeClaude({
    env, cwd: "C:\\trusted-office", now: () => new Date(date),
    runner: async (request) => {
      calls.push(request);
      const next = results.shift();
      if (next instanceof Error) throw next;
      assert.ok(next, "unexpected extra process execution");
      return next;
    },
  });
  return { ...office, calls };
}

test("subscription run verifies auth and disables tools, MCP, hooks, sessions and shell", async () => {
  const office = fixture();
  const prompt = 'Review this literal text: $(touch dangerous) & "quoted"';
  assert.deepEqual(await office.runOfficeClaude(prompt), { text: "Revision real", sessionId: "session-123", completedAt: date });
  assert.equal(office.calls.length, 2);
  const [probe, run] = office.calls;
  assert.deepEqual(probe.args, ["--safe-mode", "--settings", '{"disableAllHooks":true}', "auth", "status"]);
  assert.equal(probe.input, "");
  assert.equal(probe.timeoutMs, 15_000);
  assert.equal(run.executable, "claude");
  assert.equal(run.shell, false);
  assert.equal(run.cwd, "C:\\trusted-office");
  assert.equal(run.input, prompt);
  assert.equal(run.timeoutMs, 120_000);
  assert.equal(run.maxOutputBytes, 1024 * 1024);
  assert.deepEqual(run.args, ["-p", "--safe-mode", "--tools", "", "--disallowedTools", "mcp__*", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--settings", '{"disableAllHooks":true}', "--no-session-persistence", "--output-format", "json", "--max-turns", "2"]);
  assert.ok(!run.args.includes(prompt));
});

test("subprocess environment omits API, helper, third-party routing and startup injection", async () => {
  const office = fixture([auth, success], {
    OFFICE_CLAUDE_EXECUTABLE: "C:\\trusted\\claude.exe", PATH: "C:\\bin", APPDATA: "C:\\profile",
    ANTHROPIC_API_KEY: "never-forward", ANTHROPIC_AUTH_TOKEN: "never-forward",
    CLAUDE_CODE_OAUTH_TOKEN: "never-forward", CLAUDE_CODE_USE_BEDROCK: "1", CLAUDE_CODE_USE_VERTEX: "1",
    ANTHROPIC_BASE_URL: "https://untrusted.example", NODE_OPTIONS: "--require=evil", BASH_ENV: "evil",
    AWS_ACCESS_KEY_ID: "never-forward", GOOGLE_APPLICATION_CREDENTIALS: "never-forward",
  });
  await office.runOfficeClaude("Review");
  for (const call of office.calls) {
    assert.equal(call.executable, "C:\\trusted\\claude.exe");
    assert.deepEqual(call.env, { PATH: "C:\\bin", APPDATA: "C:\\profile" });
  }
});

test("probe reports missing CLI without leaking raw error contents", async () => {
  const office = fixture([new Error("ENOENT secret-token")]);
  const probe = await office.probeOfficeClaude();
  assert.equal(probe.status, "blocked");
  assert.equal(probe.checkedAt, date);
  assert.match(probe.reason, /no esta disponible/);
  assert.ok(!JSON.stringify(probe).includes("secret-token"));
});

for (const record of [
  { loggedIn: false, authMethod: "claude.ai" },
  { loggedIn: true, authMethod: "api_key" },
  { loggedIn: true, authMethod: "oauth_token" },
  { loggedIn: true, authMethod: "apiKeyHelper" },
  { loggedIn: true },
]) test(`rejects unverifiable subscription auth ${JSON.stringify(record)}`, async () => {
  const office = fixture([{ code: 0, stdout: JSON.stringify(record) }]);
  await assert.rejects(office.runOfficeClaude("Review"), (error: unknown) => error instanceof OfficeClaudeError && error.code === "blocked");
  assert.equal(office.calls.length, 1);
});

for (const output of ["", "not JSON", "[]", "null"])
  test(`invalid auth output stays blocked: ${JSON.stringify(output)}`, async () => {
    assert.equal((await fixture([{ code: 0, stdout: output }]).probeOfficeClaude()).status, "blocked");
  });

test("invalid or oversized prompts never launch CLI", async () => {
  const office = fixture([]);
  for (const prompt of ["", "  ", "a".repeat(65537), "€".repeat(22000)]) {
    await assert.rejects(office.runOfficeClaude(prompt), (error: unknown) => error instanceof OfficeClaudeError && error.code === "invalid_prompt");
  }
  assert.equal(office.calls.length, 0);
});

test("relative or command-shaped executable configuration is blocked", async () => {
  for (const executable of ["./claude", "claude --dangerously-skip-permissions", "relative/claude.exe"]) {
    const office = fixture([], { OFFICE_CLAUDE_EXECUTABLE: executable });
    assert.equal((await office.probeOfficeClaude()).status, "blocked");
    assert.equal(office.calls.length, 0);
  }
});

for (const [code, result] of [
  ["timeout", { code: null, stdout: "", timedOut: true }],
  ["output_limit", { code: null, stdout: "", outputLimitExceeded: true }],
  ["output_limit", { code: 0, stdout: "x".repeat(1024 * 1024 + 1) }],
  ["cli_failed", { code: 1, stdout: success.stdout, stderr: "secret-token" }],
  ["invalid_output", { code: 0, stdout: "not JSON" }],
] as const) test(`execution fails closed on ${code}`, async () => {
  const office = fixture([auth, result]);
  await assert.rejects(office.runOfficeClaude("Review"), (error: unknown) => error instanceof OfficeClaudeError && error.code === code && !error.message.includes("secret-token"));
});

for (const patch of [
  { is_error: true }, { is_error: null }, { subtype: "error_max_turns" }, { type: "assistant" },
  { result: " " }, { session_id: "" }, { session_id: null },
]) test(`success envelope validation ${JSON.stringify(patch)}`, async () => {
  const record = { ...JSON.parse(success.stdout), ...patch };
  const office = fixture([auth, { code: 0, stdout: JSON.stringify(record) }]);
  await assert.rejects(office.runOfficeClaude("Review"), (error: unknown) => error instanceof OfficeClaudeError && error.code === "invalid_result");
});

test("auth is rechecked for every independent request", async () => {
  const office = fixture([auth, success, { code: 0, stdout: '{"loggedIn":false}' }]);
  await office.runOfficeClaude("First");
  await assert.rejects(office.runOfficeClaude("Second"));
  assert.equal(office.calls.length, 3);
});

const subscriptionToken = "dummy-official-subscription-token";
const tokenAuth = { code: 0, stdout: JSON.stringify({ loggedIn: true, authMethod: "oauth_token", apiProvider: "firstParty" }) };
const tokenEnvironment = () => ({ OFFICE_CLAUDE_AUTH_MODE: "subscription-token", CLAUDE_CODE_OAUTH_TOKEN: subscriptionToken });

test("official subscription-token mode is explicit and forwards only its declared credential", async () => {
  const office = fixture([tokenAuth, success], {
    ...tokenEnvironment(), PATH: "trusted-path", ANTHROPIC_API_KEY: "never-forward",
    ANTHROPIC_AUTH_TOKEN: "never-forward", ANTHROPIC_BASE_URL: "https://untrusted.example",
    CLAUDE_CODE_USE_BEDROCK: "1", CLAUDE_CODE_USE_VERTEX: "1", CLAUDE_CODE_API_KEY_HELPER: "never-forward",
    CLAUDE_CODE_OAUTH_REFRESH_TOKEN: "never-forward", CLAUDE_CODE_OAUTH_SCOPES: "never-forward",
    AWS_SECRET_ACCESS_KEY: "never-forward", NODE_OPTIONS: "--require=evil",
  });
  assert.equal((await office.runOfficeClaude("Review")).sessionId, "session-123");
  for (const call of office.calls) {
    assert.deepEqual(call.env, { PATH: "trusted-path", CLAUDE_CODE_OAUTH_TOKEN: subscriptionToken });
    assert.ok(!call.args.join(" ").includes(subscriptionToken));
    assert.equal(call.shell, false);
  }
});

test("an OAuth token is stripped unless subscription-token mode was explicitly selected", async () => {
  const office = fixture([tokenAuth], { CLAUDE_CODE_OAUTH_TOKEN: subscriptionToken });
  const probe = await office.probeOfficeClaude();
  assert.equal(probe.status, "blocked");
  assert.equal(office.calls.length, 1);
  assert.equal(office.calls[0].env.CLAUDE_CODE_OAUTH_TOKEN, undefined);
  assert.ok(!JSON.stringify(probe).includes(subscriptionToken));
});

for (const token of [undefined, "", "   ", "bad\ntoken"]) test(`subscription-token mode blocks missing or invalid configured credential (${JSON.stringify(token)})`, async () => {
  const office = fixture([], { OFFICE_CLAUDE_AUTH_MODE: "subscription-token", CLAUDE_CODE_OAUTH_TOKEN: token });
  assert.equal((await office.probeOfficeClaude()).status, "blocked");
  await assert.rejects(office.runOfficeClaude("Review"), (error: unknown) => error instanceof OfficeClaudeError && error.code === "subscription_token_required");
  assert.equal(office.calls.length, 0);
});

for (const record of [
  { loggedIn: false, authMethod: "oauth_token", apiProvider: "firstParty" },
  { loggedIn: true, authMethod: "oauth_token" },
  { loggedIn: true, authMethod: "oauth_token", apiProvider: "thirdParty" },
  { loggedIn: true, authMethod: "oauth_token", apiProvider: "bedrock" },
  { loggedIn: true, authMethod: "oauth_token", apiProvider: "console" },
  { loggedIn: true, authMethod: "api_key", apiProvider: "firstParty" },
  { loggedIn: true, authMethod: "api_key_helper", apiProvider: "firstParty" },
  { loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty" },
]) test(`subscription-token mode rejects mismatched authentication ${JSON.stringify(record)}`, async () => {
  const office = fixture([{ code: 0, stdout: JSON.stringify(record) }], tokenEnvironment());
  await assert.rejects(office.runOfficeClaude("Review"), (error: unknown) => error instanceof OfficeClaudeError && error.code === "blocked");
  assert.equal(office.calls.length, 1);
});

test("stored subscription mode rejects explicit non-first-party providers", async () => {
  const office = fixture([{ code: 0, stdout: '{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"thirdParty"}' }]);
  assert.equal((await office.probeOfficeClaude()).status, "blocked");
});

test("configuration probe does not claim that a configured token is network-verified", async () => {
  const office = fixture([tokenAuth], tokenEnvironment());
  const probe = await office.probeOfficeClaude();
  assert.equal(probe.status, "ready");
  assert.match(probe.reason, /configurada/);
  assert.match(probe.reason, /al completar una ejecucion real/);
  assert.doesNotMatch(probe.reason, /verificada|validado/);
  assert.ok(!JSON.stringify(probe).includes(subscriptionToken));
});

test("configured token cannot turn an unsuccessful CLI result into completed execution", async () => {
  const office = fixture([tokenAuth, { code: 1, stdout: JSON.stringify({ type: "result", subtype: "error", is_error: true, result: subscriptionToken }), stderr: subscriptionToken }], tokenEnvironment());
  await assert.rejects(office.runOfficeClaude("Review"), (error: unknown) => error instanceof OfficeClaudeError && error.code === "cli_failed" && !error.message.includes(subscriptionToken));
});

test("token-mode success still requires a real successful session envelope", async () => {
  const office = fixture([tokenAuth, { code: 0, stdout: '{"type":"result","subtype":"success","is_error":false,"result":"Answer"}' }], tokenEnvironment());
  await assert.rejects(office.runOfficeClaude("Review"), (error: unknown) => error instanceof OfficeClaudeError && error.code === "invalid_result");
});

test("environment filtering never reads ignored secret values", async () => {
  const env: NodeJS.ProcessEnv = { PATH: "trusted-path" };
  for (const key of ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "PRIVATE_UNRELATED_SECRET"]) {
    Object.defineProperty(env, key, { enumerable: true, get() { throw new Error(`Ignored secret read: ${key}`); } });
  }
  const office = fixture([auth, success], env);
  await office.runOfficeClaude("Review");
  assert.deepEqual(office.calls[0].env, { PATH: "trusted-path" });
});

test("authentication configuration is pinned across probe and execution", async () => {
  const env = tokenEnvironment();
  const calls: OfficeClaudeProcessRequest[] = [];
  const office = createOfficeClaude({ env, runner: async request => {
    calls.push(request);
    if (calls.length === 1) { env.CLAUDE_CODE_OAUTH_TOKEN = "rotated-token-not-yet-probed"; return tokenAuth; }
    return success;
  } });
  await office.runOfficeClaude("Review");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].env.CLAUDE_CODE_OAUTH_TOKEN, subscriptionToken);
  assert.equal(calls[1].env.CLAUDE_CODE_OAUTH_TOKEN, subscriptionToken);
});

test("unknown authentication modes fail closed without reading or forwarding a token", async () => {
  const office = fixture([], { ...tokenEnvironment(), OFFICE_CLAUDE_AUTH_MODE: "api" });
  const probe = await office.probeOfficeClaude();
  assert.equal(probe.status, "blocked");
  assert.equal(office.calls.length, 0);
});
