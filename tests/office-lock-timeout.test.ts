import test from "node:test";
import assert from "node:assert/strict";
import { describeOwnerLockHolders, isLockNotAvailable, skipOnOwnerLockTimeout } from "../server/office-lock-timeout";
import { councilApplicationName } from "../server/agent-council-store";

const lockError = () => Object.assign(new Error("canceling statement due to lock timeout"), { code: "55P03" });

test("55P03 is detected directly and through a cause chain only", () => {
  assert.equal(isLockNotAvailable(lockError()), true);
  assert.equal(isLockNotAvailable(new Error("wrapped", { cause: lockError() })), true);
  assert.equal(isLockNotAvailable(Object.assign(new Error("x"), { code: "28P01" })), false);
  assert.equal(isLockNotAvailable(null), false);
});

test("a lock timeout skips the cycle and logs holders without private data", async () => {
  const lines: string[] = [];
  const step = skipOnOwnerLockTimeout("capability", async () => { throw lockError(); },
    async () => [{ pid: 42, application: "blackops-council:replit-web", state: "idle in transaction", granted: true, xactSeconds: 25 }],
    line => lines.push(line));
  await step();
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.event, "office_owner_lock_busy");
  assert.equal(entry.step, "capability");
  assert.equal(entry.holders[0].application, "blackops-council:replit-web");
  assert.doesNotMatch(lines[0], /canceling statement/, "no driver message text");
});

test("other errors still end the run as before", async () => {
  const step = skipOnOwnerLockTimeout("academy", async () => { throw Object.assign(new Error("x"), { code: "28P01" }); }, async () => [], () => undefined);
  await assert.rejects(step(), /x/);
});

test("diagnostics failure does not turn a skip into a failure", async () => {
  const lines: string[] = [];
  await skipOnOwnerLockTimeout("academy", async () => { throw lockError(); }, async () => { throw new Error("no"); }, l => lines.push(l))();
  assert.equal(JSON.parse(lines[0]).holders, "unavailable");
});

test("holder rows are sanitized and the key is a parameter", async () => {
  let values: unknown[] | undefined;
  const rows = await describeOwnerLockHolders({ async query(_sql, v) { values = v; return { rows: [{ pid: "7", application: "evil\u0000name;DROP", state: "active", granted: false, xact_seconds: null }] }; } }, "abc");
  assert.deepEqual(values, ["abc"]);
  assert.deepEqual(rows, [{ pid: 7, application: "evil?name?DROP", state: "active", granted: false, xactSeconds: null }]);
});

test("council connections carry a non-secret host label", () => {
  assert.equal(councilApplicationName({ GITHUB_ACTIONS: "true", GITHUB_JOB: "office-once" }), "blackops-council:gha-office-once");
  assert.equal(councilApplicationName({ REPLIT_DEPLOYMENT: "1" }), "blackops-council:replit-web");
  assert.equal(councilApplicationName({}), "blackops-council:local");
});

test("every pool role gets a named application_name; council pools cap idle-in-transaction at 30 s", async () => {
  const { blackopsApplicationName, councilPoolConfig, COUNCIL_IDLE_IN_TRANSACTION_MS } = await import("../server/agent-council-store");
  assert.equal(blackopsApplicationName("streamers", { GITHUB_ACTIONS: "true", GITHUB_JOB: "discover" }), "blackops-streamers:gha-discover");
  assert.equal(blackopsApplicationName("web-db", { REPLIT_DEPLOYMENT: "1" }), "blackops-web-db:replit-web");
  assert.ok(blackopsApplicationName("x".repeat(80), { GITHUB_ACTIONS: "true", GITHUB_JOB: "y".repeat(80) }).length <= 63);
  const config = councilPoolConfig("postgres://example/db", "credit-notify", {});
  assert.equal(config.application_name, "blackops-credit-notify:local");
  assert.equal(config.idle_in_transaction_session_timeout, 30_000);
  assert.equal(COUNCIL_IDLE_IN_TRANSACTION_MS, 30_000);
});

// Files whose bytes are pinned elsewhere, so their pools stay unnamed on purpose. Every entry must
// still contain an unnamed pool (a stale exemption fails), and nothing else may.
const UNNAMED_POOL_EXEMPTIONS: Record<string, string> = {
  "server/software-factory-store.ts": "SHA-256 pinned by script/office-api-budget-v6/manifest.json (afterSha256); not a council holder",
  "script/office-api-budget-v6/provision-table.mjs": "part of the pinned v6 package; one-shot provisioning",
  "script/release-gate/office-review-enqueue.ts": "release-gate machinery (label-gated by diff hygiene); short-lived enqueue",
};

/** Every `new Pool(` / `new pg.Pool(` / `new Client(` / `new pg.Client(` call with its balanced argument text. */
export function findPoolConstructions(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/new\s+(?:pg\.)?(?:Pool|Client)\s*\(/g)) {
    let depth = 1, i = m.index! + m[0].length;
    for (; i < src.length && depth > 0; i++) { if (src[i] === "(") depth++; else if (src[i] === ")") depth--; }
    out.push(src.slice(m.index!, i));
  }
  return out;
}
/** Named: an object literal with application_name, or the shared councilPoolConfig(...). A bare variable is not. */
export const poolIsNamed = (call: string) => /application_name/.test(call) || /\(\s*councilPoolConfig\(/.test(call);

test("pool guard catches literal, variable and Client constructions", () => {
  const found = findPoolConstructions(`new Pool({ a: f(1) }); new pg.Pool(config); new pg.Client({ connectionString }); new Client(cfg); new Pool({ application_name: "x" }); new Pool(councilPoolConfig(u, "r"))`);
  assert.equal(found.length, 6);
  assert.deepEqual(found.map(poolIsNamed), [false, false, false, false, true, true]);
});

test("no PostgreSQL pool or client in server/ or script/ is left without application_name", async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  const unnamed = new Set<string>();
  for (const dir of ["server", "script"]) for (const file of readdirSync(new URL(`../${dir}/`, import.meta.url), { recursive: true }) as string[]) {
    if (!/\.(ts|mts|mjs|js|cjs)$/.test(file) || /\.test\./.test(file) || /\.d\.m?ts$/.test(file)) continue;
    const src = readFileSync(new URL(`../${dir}/${file}`, import.meta.url), "utf8");
    if (findPoolConstructions(src).some(call => !poolIsNamed(call))) unnamed.add(`${dir}/${file}`);
  }
  assert.deepEqual([...unnamed].filter(f => !(f in UNNAMED_POOL_EXEMPTIONS)).sort(), [], "name the pool: application_name or councilPoolConfig");
  assert.deepEqual(Object.keys(UNNAMED_POOL_EXEMPTIONS).filter(f => !unnamed.has(f)), [], "stale exemption: remove it");
});

test("updateStarted is found anywhere in the cause chain, so wrapped post-update 55P03 still fails", async () => {
  const { isRetryableLockContention, councilUpdateStarted } = await import("../server/office-lock-timeout");
  const started = Object.assign(lockError(), { updateStarted: true });
  assert.equal(isRetryableLockContention(lockError()), true);
  assert.equal(isRetryableLockContention(new Error("wrapped", { cause: lockError() })), true);
  assert.equal(isRetryableLockContention(started), false);
  assert.equal(isRetryableLockContention(new Error("wrapped", { cause: started })), false);
  assert.equal(isRetryableLockContention(new Error("outer", { cause: new Error("mid", { cause: started }) })), false);
  assert.equal(councilUpdateStarted(Object.assign(new Error("x"), { cause: Object.assign(new Error("y"), { updateStarted: true }) })), true);
  const logs: string[] = [];
  await assert.rejects(skipOnOwnerLockTimeout("capability", async () => { throw new Error("w", { cause: started }); }, async () => [], l => logs.push(l))(), /w/);
  assert.equal(logs.length, 0);
});
