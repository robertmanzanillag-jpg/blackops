// Independent QA scenarios (ES/EN) for the riskiest KONG Mirror Lab paths: never-auto areas,
// scout dedupe after a PR is merged/closed, HMAC receiver edges and the approve guards.
import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createKongMirrorLab, buildCodexChangeComment, CLAUDE_CODE_FOOTER, KONG_MIRROR_REPOSITORY, type MirrorCards, type MirrorGithub, type MirrorCard } from "../server/kong-mirror-lab";
import { createKongImprovementScouts, neverAutoArea, type ScoutInputs } from "../server/kong-improvement-scouts";

const NOW = Date.parse("2026-11-20T12:00:00Z"), SECRET = "synthetic-only-mirror-secret-0123456789", HEAD = "b".repeat(40), BASE = "a".repeat(40);

function memoryStore() {
  const rows = new Map<string, string>(); let tail = Promise.resolve();
  return { rows, read: async (key: string) => rows.get(key) ?? null, transact: async (key: string, change: (raw: string | null) => Promise<string>) => {
    const job = tail.then(async () => { const next = await change(rows.get(key) ?? null); rows.set(key, next); return next; });
    tail = job.then(() => {}, () => {}); return job;
  } };
}

test("never-auto (ES/EN): payments, auth, pricing, user messaging, DB schema/deletes and legal are always decisions", () => {
  const blocked: Array<[string, string]> = [
    ["Fix the authentication flow for promoters", "auth/permisos"],
    ["Corregir la autenticación de promotores", "auth/permisos"],
    ["Revisar la autorización de administradores", "auth/permisos"],
    ["Users cannot sign in with Google", "auth/permisos"],
    ["Refresh expired OAuth tokens", "auth/permisos"],
    ["Update billing for the VIP plan", "pagos/Stripe"],
    ["Cobrar la mesa por adelantado", "pagos/Stripe"],
    ["Cancel subscriptions that failed", "precios"],
    ["Send push notifications to users", "mensajes a usuarios"],
    ["Enviar mensajes a los usuarios por Telegram", "mensajes a usuarios"],
    ["Add database migrations for the events table", "esquema de BD/borrados"],
    ["Deleted rows reappear: clean them", "esquema de BD/borrados"],
    ["Agregar migraciones al esquema", "esquema de BD/borrados"],
    ["Update the cookie consent banner", "legal"],
  ];
  for (const [text, area] of blocked) assert.equal(neverAutoArea(text), area, text);
  for (const safe of ["mejorar el layout de la tarjeta de eventos", "The Miami scraper returns 0 events", "Author name overlaps the flyer", "Mostrar el género del evento"])
    assert.equal(neverAutoArea(safe), null, safe);
});

function scouts(pull: { number: number; state: string; merged: boolean } | null) {
  const store = memoryStore(); const issues: Array<{ title: string; body: string }> = [];
  const inputs: ScoutInputs = { agents: [{ id: "events", name: "Agente eventos", blocker: "El scraper de Miami devuelve 0 eventos", issues: [] }], cities: [], repairs: [], lessons: [] };
  const state = { pull };
  let clock = NOW;
  const instance = createKongImprovementScouts({ owner: "o", store, now: () => clock, env: { KONG_IMPROVEMENT_SCOUTS_ENABLED: "true" },
    github: { createIssue: async (_repo, issue) => { issues.push(issue); return { number: issues.length, url: `https://github.com/x/y/issues/${issues.length}` }; },
      findPullByBranch: async () => state.pull, listMirrorRuns: async () => [] },
    readInputs: async () => inputs, mirrorStatusFor: async () => null });
  return { instance, issues, state, tick: () => { clock += 7 * 3600_000; } };
}

for (const [label, pull] of [["merged / fusionado", { number: 7, state: "closed", merged: true }], ["closed by Robert / cerrado", { number: 7, state: "closed", merged: false }]] as const) {
  test(`scouts dedupe: a proposal whose PR was ${label} never opens a duplicate issue every 6 h while the signal persists`, async () => {
    const { instance, issues, tick } = scouts(pull);
    await instance.run({ force: true });
    assert.equal(issues.length, 1);
    for (let round = 0; round < 4; round++) { tick(); await instance.run(); }
    assert.equal(issues.length, 1, "the same signal must not reopen issues in kong-nightlife after the PR is merged or closed");
    const view = await instance.view();
    assert.ok(["merged", "closed"].includes(view.proposals[0].status));
  });
}

test("scouts are off by default / apagados por defecto", async () => {
  const { scoutsEnabled } = await import("../server/kong-improvement-scouts");
  assert.equal(scoutsEnabled({}), false);
  assert.equal(scoutsEnabled({ KONG_IMPROVEMENT_SCOUTS_ENABLED: "1" }), false);
});

test("@codex change comment: footer present, credentials and contact data redacted / sin secretos ni datos personales", () => {
  const body = buildCodexChangeComment({ prNumber: 42, headSha: HEAD,
    text: "Hazlo azul. token: ghp_abcdefghijklmnopqrstu y llama a +1 (305) 555-0199 o escribe a ana@example.com; key sk-proj-ABCDEFGHIJKLMNOP" });
  assert.ok(body.endsWith(CLAUDE_CODE_FOOTER));
  assert.match(body, /^@codex /);
  for (const leak of ["ghp_abcdefghijklmnopqrstu", "555-0199", "ana@example.com", "sk-proj-ABCDEFGHIJKLMNOP"]) assert.ok(!body.includes(leak), leak);
});

function fakeCards() {
  const actions = new Map<string, { id: string; status: string; card: MirrorCard }>(); let n = 0;
  const cards: MirrorCards = {
    create: async card => { const id = `pa-${++n}`; actions.set(id, { id, status: "pending", card }); return { id }; },
    findByKey: async key => { const found = [...actions.values()].find(action => action.card.key === key); return found ? { id: found.id, status: found.status } : null; },
    get: async id => actions.has(id) ? { id, status: actions.get(id)!.status } : null,
    note: async () => {}, approved: async id => { actions.get(id)!.status = "approved"; }, executed: async id => { actions.get(id)!.status = "executed"; },
    reopen: async id => { actions.get(id)!.status = "pending"; }, rejected: async id => { actions.get(id)!.status = "rejected"; }, closed: async id => { actions.get(id)!.status = "cancelled"; },
  };
  return { cards, actions };
}
function report(patch: Record<string, unknown> = {}) {
  return { version: 1, repo: KONG_MIRROR_REPOSITORY, prNumber: 42, prUrl: `https://github.com/${KONG_MIRROR_REPOSITORY}/pull/42`, title: "Botón más visible", baseSha: BASE, headSha: HEAD,
    overall: "pass", agents: [{ id: "visual", name: "Agente visual", verdict: "pass", summary: "ok", details: [] }], metrics: {}, images: [], videos: [],
    generatedAt: new Date(NOW - 60_000).toISOString(), dataSource: "production-copy", ...patch };
}
function signed(value: unknown) {
  const raw = Buffer.from(JSON.stringify(value));
  return { raw, signature: `sha256=${createHmac("sha256", SECRET).update(raw).digest("hex")}`, timestamp: String(Math.floor(NOW / 1000)) };
}

test("receiver (EN/ES): unknown fields, wrong repo and a re-sent body with a fresh timestamp are refused", async () => {
  const { cards } = fakeCards();
  let merges = 0;
  const github: MirrorGithub = { readPull: async () => ({ state: "open", merged: false, headSha: HEAD, baseRepo: KONG_MIRROR_REPOSITORY, baseRef: "main", mergeable: true }),
    readChecks: async () => ({ passed: true, summary: "ok" }), merge: async () => { merges++; return { merged: true, sha: "c".repeat(40) }; }, comment: async () => ({ url: null }) };
  const lab = createKongMirrorLab({ owner: "owner", store: memoryStore(), now: () => NOW, cards, github, summarize: async () => ({ text: "r", source: "deterministic" }) });
  for (const bad of [report({ extra: true }), report({ repo: "evil/repo", prUrl: "https://github.com/evil/repo/pull/42" })]) {
    const s = signed(bad);
    await assert.rejects(lab.receive(s.raw, s.signature, s.timestamp, SECRET), (error: { status?: number }) => error.status === 400);
  }
  const good = signed(report());
  await lab.receive(good.raw, good.signature, good.timestamp, SECRET);
  // Same signed body replayed later with a new (unsigned) timestamp header: still a replay.
  await assert.rejects(lab.receive(good.raw, good.signature, String(Math.floor(NOW / 1000) + 30), SECRET), (error: { code?: string }) => error.code === "MIRROR_REPLAY");
  assert.equal(merges, 0, "receiving never merges / recibir nunca fusiona");
});

test("approve (ES): a failing report is never mergeable even if checks are green; a moved head SHA refuses", async () => {
  const { cards } = fakeCards();
  let merges = 0, head = HEAD;
  const github: MirrorGithub = { readPull: async () => ({ state: "open", merged: false, headSha: head, baseRepo: KONG_MIRROR_REPOSITORY, baseRef: "main", mergeable: true }),
    readChecks: async () => ({ passed: true, summary: "ok" }), merge: async () => { merges++; return { merged: true, sha: "c".repeat(40) }; }, comment: async () => ({ url: null }) };
  const lab = createKongMirrorLab({ owner: "owner", store: memoryStore(), now: () => NOW, cards, github, summarize: async () => ({ text: "r", source: "deterministic" }) });
  const failing = signed(report({ overall: "fail" }));
  const received = await lab.receive(failing.raw, failing.signature, failing.timestamp, SECRET);
  assert.equal((await lab.approve(received.key, { actorId: "robert" })).ok, false);
  const next = signed(report({ headSha: "d".repeat(40), overall: "pass" }));
  const fresh = await lab.receive(next.raw, next.signature, next.timestamp, SECRET);
  head = "e".repeat(40);
  const moved = await lab.approve(fresh.key, { actorId: "robert", headSha: "d".repeat(40) });
  assert.equal(moved.ok, false); assert.equal((moved as { code: string }).code, "MIRROR_SHA_CHANGED");
  assert.equal(merges, 0);
});
