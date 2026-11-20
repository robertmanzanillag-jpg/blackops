import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import {
  createKongMirrorLab, createMirrorSummarizer, createMirrorAiBudget, resolveMirrorAiCapUsd, looksLikeChangeRequest, verifyMirrorReport, mirrorReportKey, MirrorError,
  KONG_MIRROR_REPOSITORY, MIRROR_MAX_IMAGE_BYTES, type MirrorCards, type MirrorGithub, type MirrorCard, type KongMirrorReport,
} from "../server/kong-mirror-lab";
import { registerKongMirrorRoutes } from "../server/kong-mirror-routes";
import { createMirrorChat, NO_LO_SE, type MirrorChatProvider, type MirrorPrContext } from "../server/kong-mirror-chat";
import { createKongImprovementScouts, estimateMirrorSpend, neverAutoArea, resolveMirrorRunBudgetUsd, resolveMirrorUsdPerMinute, type MirrorWorkflowRun, type ScoutInputs } from "../server/kong-improvement-scouts";
import { buildMonthlyAiSpendReport } from "../server/ai-cost-policy";

const NOW = Date.parse("2026-11-20T12:00:00Z"), SECRET = "synthetic-only-mirror-secret-0123456789", HEAD = "b".repeat(40), BASE = "a".repeat(40);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]).toString("base64");

function report(patch: Partial<KongMirrorReport> = {}) {
  return {
    version: 1, repo: KONG_MIRROR_REPOSITORY, prNumber: 42, prUrl: `https://github.com/${KONG_MIRROR_REPOSITORY}/pull/42`, title: "Botón de reservar más visible",
    baseSha: BASE, headSha: HEAD, overall: "pass",
    agents: [
      { id: "visual", name: "Agente visual", verdict: "pass", summary: "El botón se ve en móvil sin hacer scroll.", details: ["Mejora: probar color en modo oscuro"] },
      { id: "perf", name: "Agente rendimiento", verdict: "pass", summary: "LCP baja de 2.8s a 2.1s.", details: [] },
      { id: "devils-advocate", name: "Abogado del diablo", verdict: "pass", summary: "Riesgo bajo: solo CSS.", details: ["Podría chocar con el banner de cookies"] },
    ],
    metrics: { lcp: { before: 2.8, after: 2.1, unit: "s", better: "lower" }, errors: 0 },
    images: [{ id: "home-before", page: "/", viewport: "390x844", kind: "before", caption: "Inicio antes", mime: "image/png", dataBase64: PNG },
      { id: "home-after", page: "/", viewport: { width: 390, height: 844 }, kind: "after", caption: "Inicio después", mime: "image/png", dataBase64: PNG }],
    videos: ["https://github.com/robertmanzanillag-jpg/kong-nightlife/actions/runs/1"],
    artifactUrl: "https://github.com/robertmanzanillag-jpg/kong-nightlife/actions/runs/1/artifacts/2",
    generatedAt: new Date(NOW - 60_000).toISOString(), dataSource: "production-copy",
    ...patch,
  };
}
function sign(value: unknown, secret = SECRET) {
  const raw = Buffer.from(JSON.stringify(value));
  return { raw, signature: `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`, timestamp: String(Math.floor(NOW / 1000)) };
}
function memoryStore() {
  const rows = new Map<string, string>(); let tail = Promise.resolve();
  return { rows, read: async (key: string) => rows.get(key) ?? null, transact: async (key: string, change: (raw: string | null) => Promise<string>) => {
    const job = tail.then(async () => { const next = await change(rows.get(key) ?? null); rows.set(key, next); return next; });
    tail = job.then(() => {}, () => {}); return job;
  } };
}
function fakeCards() {
  const actions = new Map<string, { id: string; status: string; card: MirrorCard; notes: string[] }>(); let n = 0;
  const cards: MirrorCards = {
    create: async card => { const id = `pa-${++n}`; actions.set(id, { id, status: "pending", card, notes: [] }); return { id }; },
    findByKey: async key => { const found = [...actions.values()].find(action => action.card.key === key); return found ? { id: found.id, status: found.status } : null; },
    get: async id => actions.has(id) ? { id, status: actions.get(id)!.status } : null,
    note: async (id, note) => { actions.get(id)!.notes.push(note); },
    approved: async id => { actions.get(id)!.status = "approved"; },
    executed: async id => { actions.get(id)!.status = "executed"; },
    reopen: async id => { actions.get(id)!.status = "pending"; },
    rejected: async id => { actions.get(id)!.status = "rejected"; },
    closed: async id => { actions.get(id)!.status = "cancelled"; },
  };
  return { cards, actions };
}
function fakeGithub(patch: Partial<{ headSha: string; checks: boolean; state: string }> = {}) {
  const calls = { merges: 0, comments: [] as string[] };
  const github: MirrorGithub = {
    readPull: async () => ({ state: patch.state || "open", merged: false, headSha: patch.headSha || HEAD, baseRepo: KONG_MIRROR_REPOSITORY, baseRef: "main", mergeable: true }),
    readChecks: async () => ({ passed: patch.checks ?? true, summary: patch.checks === false ? "1 check(s) sin éxito: test" : "todo en verde" }),
    merge: async () => { calls.merges++; return { merged: true, sha: "c".repeat(40) }; },
    comment: async (_repo, _pr, body) => { calls.comments.push(body); return { url: `https://github.com/x/y/pull/42#c${calls.comments.length}` }; },
  };
  return { github, calls };
}
function lab(options: { github?: MirrorGithub; time?: () => number } = {}) {
  const store = memoryStore(), { cards, actions } = fakeCards(), gh = fakeGithub();
  const instance = createKongMirrorLab({ owner: "owner", store, now: options.time || (() => NOW), cards, github: options.github || gh.github,
    summarize: async () => ({ text: "Resumen determinista", source: "deterministic" }) });
  return { instance, store, actions, calls: gh.calls };
}

test("signature: valid accepted, invalid/stale/oversized rejected", () => {
  const good = sign(report());
  assert.equal(verifyMirrorReport(good.raw, good.signature, good.timestamp, SECRET, NOW).report.prNumber, 42);
  assert.throws(() => verifyMirrorReport(good.raw, good.signature, good.timestamp, "another-secret-of-at-least-32-chars!!", NOW), (error: MirrorError) => error.code === "MIRROR_INVALID_SIGNATURE");
  assert.throws(() => verifyMirrorReport(Buffer.from(good.raw.toString().replace("42", "43")), good.signature, good.timestamp, SECRET, NOW), (error: MirrorError) => error.code === "MIRROR_INVALID_SIGNATURE");
  assert.throws(() => verifyMirrorReport(good.raw, good.signature, String(Math.floor((NOW - 11 * 60_000) / 1000)), SECRET, NOW), (error: MirrorError) => error.code === "MIRROR_STALE");
  assert.throws(() => verifyMirrorReport(good.raw, good.signature, undefined, SECRET, NOW), (error: MirrorError) => error.code === "MIRROR_STALE");
  const oldBody = sign(report({ generatedAt: new Date(NOW - 2 * 60 * 60_000).toISOString() }));
  assert.throws(() => verifyMirrorReport(oldBody.raw, oldBody.signature, oldBody.timestamp, SECRET, NOW), (error: MirrorError) => error.code === "MIRROR_STALE");
  assert.throws(() => verifyMirrorReport(good.raw, good.signature, good.timestamp, "short", NOW), (error: MirrorError) => error.code === "MIRROR_NOT_CONFIGURED");
  const big = Buffer.alloc(MIRROR_MAX_IMAGE_BYTES + 1024, 1);
  big.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const huge = sign(report({ images: [{ id: "big", page: "/", viewport: "1x1", kind: "after", caption: "", mime: "image/png", dataBase64: big.toString("base64") }] }));
  assert.throws(() => verifyMirrorReport(huge.raw, huge.signature, huge.timestamp, SECRET, NOW), (error: MirrorError) => error.code === "MIRROR_TOO_LARGE" && error.status === 413);
  const strict = sign({ ...report(), unexpected: true });
  assert.throws(() => verifyMirrorReport(strict.raw, strict.signature, strict.timestamp, SECRET, NOW), (error: MirrorError) => error.code === "MIRROR_INVALID_REPORT");
  const fake = sign(report({ images: [{ id: "x", page: "/", viewport: "1x1", kind: "after", caption: "", mime: "image/png", dataBase64: Buffer.from("<svg onload=alert(1)>").toString("base64") }] }));
  assert.throws(() => verifyMirrorReport(fake.raw, fake.signature, fake.timestamp, SECRET, NOW), (error: MirrorError) => error.code === "MIRROR_INVALID_REPORT");
});

test("replay rejected; same repo+PR+headSha is idempotent: one card, images stored outside the journal", async () => {
  const { instance, store, actions } = lab();
  const first = sign(report());
  const created = await instance.receive(first.raw, first.signature, first.timestamp, SECRET);
  assert.equal(created.duplicate, false);
  await assert.rejects(instance.receive(first.raw, first.signature, first.timestamp, SECRET), (error: MirrorError) => error.code === "MIRROR_REPLAY" && error.status === 409);
  const rerun = sign(report({ generatedAt: new Date(NOW - 30_000).toISOString() }));
  const again = await instance.receive(rerun.raw, rerun.signature, rerun.timestamp, SECRET);
  assert.equal(again.duplicate, true);
  assert.equal(again.pendingActionId, created.pendingActionId);
  assert.equal(actions.size, 1);
  const journal = store.rows.get(JSON.stringify(["kong-mirror-reports-v1", "owner"]))!;
  assert.ok(!journal.includes(PNG), "journal must not hold image data");
  const card = actions.get(created.pendingActionId)!.card;
  assert.ok(!JSON.stringify(card).includes(PNG), "card must only reference images");
  const image = await instance.image(card.images[0].key);
  assert.equal(image?.mime, "image/png");
  assert.equal(card.key, mirrorReportKey(KONG_MIRROR_REPOSITORY, 42, HEAD));
  const newSha = sign(report({ headSha: "d".repeat(40) }));
  await instance.receive(newSha.raw, newSha.signature, newSha.timestamp, SECRET);
  assert.equal(actions.size, 2, "a new head SHA gets its own card (no count cap)");
});

test("cards: pass approvable, warn flagged, fail informational (also when an agent fails under overall=pass)", async () => {
  const { instance, actions } = lab();
  const cardFor = async (patch: Partial<KongMirrorReport>, sha: string) => {
    const signed = sign(report({ headSha: sha, ...patch }));
    const { pendingActionId } = await instance.receive(signed.raw, signed.signature, signed.timestamp, SECRET);
    return actions.get(pendingActionId)!.card;
  };
  const pass = await cardFor({}, "1".repeat(40));
  assert.equal(pass.approvable, true); assert.equal(pass.warn, false);
  assert.equal(pass.risks.devilsAdvocate?.name, "Abogado del diablo");
  assert.deepEqual(pass.metrics[0], { name: "lcp", before: 2.8, after: 2.1, unit: "s", better: "lower" });
  assert.ok(pass.improveLater.some(line => line.includes("modo oscuro")));
  assert.equal(pass.images.length, 2);
  const warn = await cardFor({ overall: "warn" }, "2".repeat(40));
  assert.equal(warn.approvable, true); assert.equal(warn.warn, true); assert.match(warn.statusLabel, /AVISOS/);
  const fail = await cardFor({ overall: "fail", agents: [{ id: "a11y", name: "Agente accesibilidad", verdict: "fail", summary: "Contraste insuficiente.", details: [] }] }, "3".repeat(40));
  assert.equal(fail.approvable, false); assert.deepEqual(fail.failReasons, ["Agente accesibilidad: Contraste insuficiente."]);
  const sneaky = await cardFor({ overall: "pass", agents: [{ id: "flow", name: "Agente flujo", verdict: "fail", summary: "El pago se rompe.", details: [] }] }, "4".repeat(40));
  assert.equal(sneaky.overall, "fail"); assert.equal(sneaky.approvable, false);
  const failKey = mirrorReportKey(KONG_MIRROR_REPOSITORY, 42, "3".repeat(40));
  const refused = await instance.approve(failKey, { actorId: "robert" });
  assert.equal(refused.ok, false); assert.equal((refused as { code: string }).code, "MIRROR_NOT_APPROVABLE");
});

test("approve refuses on SHA mismatch or red checks, merges only after both pass", async () => {
  const changed = fakeGithub({ headSha: "e".repeat(40) });
  const t1 = lab({ github: changed.github });
  const signed = sign(report());
  const { key, pendingActionId } = await t1.instance.receive(signed.raw, signed.signature, signed.timestamp, SECRET);
  const refused = await t1.instance.approve(key, { actorId: "robert", headSha: HEAD });
  assert.equal(refused.ok, false); assert.equal((refused as { code: string }).code, "MIRROR_SHA_CHANGED");
  assert.equal(changed.calls.merges, 0);
  assert.equal(t1.actions.get(pendingActionId)!.status, "pending", "card stays pending after a refusal");

  const red = fakeGithub({ checks: false });
  const t2 = lab({ github: red.github });
  const r2 = await t2.instance.receive(signed.raw, signed.signature, signed.timestamp, SECRET);
  const redResult = await t2.instance.approve(r2.key, { actorId: "robert" });
  assert.equal((redResult as { code: string }).code, "MIRROR_CHECKS_RED"); assert.equal(red.calls.merges, 0);

  const green = fakeGithub();
  const t3 = lab({ github: green.github });
  const r3 = await t3.instance.receive(signed.raw, signed.signature, signed.timestamp, SECRET);
  const merged = await t3.instance.approve(r3.key, { actorId: "robert", headSha: HEAD });
  assert.equal(merged.ok, true);
  assert.equal((merged as { message: string }).message, "Merge hecho: falta republicar KONG en Replit");
  assert.equal(green.calls.merges, 1);
  assert.equal(t3.actions.get(r3.pendingActionId)!.status, "executed");
  const twice = await t3.instance.approve(r3.key, { actorId: "robert" });
  assert.equal(twice.ok, false); assert.equal(green.calls.merges, 1);
});

test("reject closes the card and posts the optional note as a PR comment", async () => {
  const gh = fakeGithub();
  const t = lab({ github: gh.github });
  const signed = sign(report());
  const { key, pendingActionId } = await t.instance.receive(signed.raw, signed.signature, signed.timestamp, SECRET);
  const result = await t.instance.reject(key, { actorId: "robert", note: "Prefiero otro color" });
  assert.equal(result.ok, true); assert.equal((result as { commentPosted: boolean }).commentPosted, true);
  assert.match(gh.calls.comments[0], /Prefiero otro color/);
  assert.equal(t.actions.get(pendingActionId)!.status, "rejected");
  assert.equal((await t.instance.approve(key, { actorId: "robert" })).ok, false);
});

test("AI budget: env clamp (10 → 5, 0 → off, old alias), cap enforced, deterministic fallback, spend reported", async () => {
  assert.equal(resolveMirrorAiCapUsd({ BLACKOPS_MIRROR_AI_MONTHLY_USD: "10" }), 5);
  assert.equal(resolveMirrorAiCapUsd({ BLACKOPS_MIRROR_AI_MONTHLY_USD: "0" }), 0);
  assert.equal(resolveMirrorAiCapUsd({}), 5);
  assert.equal(resolveMirrorAiCapUsd({ BLACKOPS_MIRROR_AI_MONTHLY_USD: "1.5" }), 1.5);
  assert.equal(resolveMirrorAiCapUsd({ BLACKOPS_MIRROR_AI_MONTHLY_USD: "abc" }), 0);
  assert.equal(resolveMirrorAiCapUsd({ BLACKOPS_MIRROR_SUMMARY_MONTHLY_USD: "2" }), 2, "old name still read as alias");
  assert.equal(resolveMirrorAiCapUsd({ BLACKOPS_MIRROR_SUMMARY_MONTHLY_USD: "2", BLACKOPS_MIRROR_AI_MONTHLY_USD: "4" }), 4, "new name wins");
  const parsed = verifyMirrorReport(sign(report()).raw, sign(report()).signature, sign(report()).timestamp, SECRET, NOW).report;
  let calls = 0, prompt = "";
  const generate = async (value: string) => { calls++; prompt = value; return { text: "Conviene porque el botón se ve mejor.", inputTokens: 100, outputTokens: 50 }; };
  const budgetFor = (store: ReturnType<typeof memoryStore>, env: NodeJS.ProcessEnv) => createMirrorAiBudget({ owner: "o", store, now: () => NOW, env });
  const off = createMirrorSummarizer({ budget: budgetFor(memoryStore(), { BLACKOPS_MIRROR_AI_MONTHLY_USD: "0" }), generate, estimateUsd: () => 0.001 });
  const offResult = await off.summarize(parsed);
  assert.equal(offResult.source, "deterministic"); assert.equal(calls, 0); assert.match(offResult.text, /agentes de prueba aprobaron/);
  const store = memoryStore();
  const on = createMirrorSummarizer({ budget: budgetFor(store, { BLACKOPS_MIRROR_AI_MONTHLY_USD: "10" }), generate, estimateUsd: call => (call.inputTokens + call.outputTokens) / 1000 * 0.5 });
  const ai = await on.summarize(parsed);
  assert.equal(ai.source, "ai"); assert.equal(calls, 1);
  assert.ok(!prompt.includes(PNG), "no image data goes to the model");
  await store.transact(JSON.stringify(["kong-mirror-ai-spend-v1", "o"]), async () => JSON.stringify({ version: 1, months: { "2026-11": { spentUsd: 4.999, reservedUsd: 0, calls: 99 } } }));
  const capped = await on.summarize(parsed);
  assert.equal(capped.source, "deterministic"); assert.equal(calls, 1); assert.match(capped.reason || "", /tope/);
  const spend = await on.monthSpend();
  assert.equal(spend.capUsd, 5); assert.equal(spend.spentUsd, 4.999);
  const failing = createMirrorSummarizer({ budget: budgetFor(memoryStore(), {}), generate: async () => { throw new Error("FACTORY_API_GEMINI_USAGE_UNPRICED"); }, estimateUsd: () => 0.001 });
  const fallback = await failing.summarize(parsed);
  assert.equal(fallback.source, "deterministic"); assert.equal((await failing.monthSpend()).spentUsd, 0, "a refused preflight releases the reservation");
  const tracker = buildMonthlyAiSpendReport([], new Date(NOW), [{ id: "kong_mirror_ai", label: "IA Mirror Lab", amountUsd: 1.25, count: 3, kind: "estimated" }]);
  assert.equal(tracker.trackedSpendUsd, 1.25);
  assert.ok(tracker.sources.some(source => source.id === "kong_mirror_ai"));
});

const PR_CONTEXT: MirrorPrContext = { title: "Botón de reservar más visible", body: "Mueve el CTA arriba.", comments: [{ author: "codex", body: "Listo, tests verdes." }],
  files: [{ filename: "client/src/components/booking-button.tsx", status: "modified", additions: 4, deletions: 2, patch: "-  className=\"mt-96\"\n+  className=\"mt-4 bg-lime-400\"" }] };
async function chatFixture(options: { env?: NodeJS.ProcessEnv; answer?: string; providers?: MirrorChatProvider[] } = {}) {
  const t = lab();
  const signed = sign(report());
  const { key } = await t.instance.receive(signed.raw, signed.signature, signed.timestamp, SECRET);
  const store = memoryStore(); let calls = 0;
  const budget = createMirrorAiBudget({ owner: "o", store, now: () => NOW, env: options.env || {} });
  const providers = options.providers || [{ name: "gemini" as const, model: "gemini-2.5-flash-lite", generate: async () => { calls++; return { text: options.answer ?? "El botón cambia en [archivo:client/src/components/booking-button.tsx] y el visual lo aprobó [agente:Agente visual].", inputTokens: 500, outputTokens: 60 }; } }];
  const chat = createMirrorChat({ owner: "o", store, now: () => NOW, budget, providers, estimateUsd: () => 0.002, github: { readPullContext: async () => PR_CONTEXT }, lab: t.instance });
  return { ...t, key, chat, store, calls: () => calls };
}

test("chat: grounded answers cite evidence; outside the evidence it says 'no lo sé' (without spending)", async () => {
  const f = await chatFixture();
  const good = await f.chat.ask(f.key, { message: "¿Qué archivos cambia el booking-button?" });
  assert.equal(good.ok, true);
  assert.deepEqual((good as { reply: { citations: string[] } }).reply.citations.sort(), ["agente:Agente visual", "archivo:client/src/components/booking-button.tsx"]);
  const outside = await f.chat.ask(f.key, { message: "¿Cuánto vale el bitcoin hoy en Tokio?" });
  assert.equal((outside as { reply: { text: string; source: string } }).reply.text, NO_LO_SE);
  assert.equal((outside as { reply: { source: string } }).reply.source, "evidence-gate");
  assert.equal(f.calls(), 1, "the evidence gate does not call the model");
  const uncited = await chatFixture({ answer: "Seguro que sube las ventas un 300%." });
  const result = await uncited.chat.ask(uncited.key, { message: "¿Por qué hacerlo?" });
  assert.equal((result as { reply: { text: string } }).reply.text, NO_LO_SE, "answers without valid citations are replaced");
  assert.equal((await f.chat.thread(f.key)).length, 4, "thread stored per card");
});

test("chat: budget exhausted → honest message + deterministic sections; unpriced cheap model falls back to priced OpenAI", async () => {
  const f = await chatFixture({ env: { BLACKOPS_MIRROR_AI_MONTHLY_USD: "5" } });
  await f.store.transact(JSON.stringify(["kong-mirror-ai-spend-v1", "o"]), async () => JSON.stringify({ version: 1, months: { "2026-11": { spentUsd: 5, reservedUsd: 0, calls: 10 } } }));
  const out = await f.chat.ask(f.key, { message: "¿Qué riesgos vio el equipo?" }) as { reply: { text: string; source: string }; fallbackSections: Array<{ title: string }> };
  assert.match(out.reply.text, /presupuesto de IA del Mirror Lab de este mes \(\$5\) ya se usó/);
  assert.equal(out.reply.source, "budget"); assert.equal(f.calls(), 0);
  assert.ok(out.fallbackSections.some(section => section.title === "Riesgos"));
  let openai = 0;
  const g = await chatFixture({ providers: [
    { name: "gemini", model: "gemini-2.5-flash-lite", generate: async () => { throw new Error("FACTORY_API_GEMINI_USAGE_UNPRICED"); } },
    { name: "openai", model: "gpt-5.4-mini", generate: async () => { openai++; return { text: "Lo dice [agente:Abogado del diablo].", inputTokens: 400, outputTokens: 20 }; } },
  ] });
  const viaOpenAi = await g.chat.ask(g.key, { message: "¿Qué dice el abogado del diablo?" }) as { reply: { source: string } };
  assert.equal(viaOpenAi.reply.source, "ai"); assert.equal(openai, 1);
});

test("change request: one @codex comment per idempotency key, card → 'Cambios pedidos', approve waits", async () => {
  const gh = fakeGithub();
  const t = lab({ github: gh.github });
  const signed = sign(report());
  const { key } = await t.instance.receive(signed.raw, signed.signature, signed.timestamp, SECRET);
  assert.equal(looksLikeChangeRequest("hazlo azul"), true);
  assert.equal(looksLikeChangeRequest("no cambies la pantalla de mesas"), true);
  assert.equal(looksLikeChangeRequest("¿qué archivos cambia?"), false);
  const first = await t.instance.requestChange(key, { actorId: "robert", text: "hazlo azul y escríbeme a robert@example.com", idempotencyKey: "cambio-abc12345" });
  const again = await t.instance.requestChange(key, { actorId: "robert", text: "hazlo azul", idempotencyKey: "cambio-abc12345" });
  assert.equal(first.ok, true); assert.equal((again as { duplicate: boolean }).duplicate, true);
  assert.equal(gh.calls.comments.length, 1, "double click posts once");
  assert.match(gh.calls.comments[0], /^@codex /);
  assert.match(gh.calls.comments[0], /> hazlo azul/);
  assert.ok(!gh.calls.comments[0].includes("robert@example.com"), "no personal data leaves BlackOps");
  assert.ok(gh.calls.comments[0].endsWith("\n\n---\n_Generated by [Claude Code](https://claude.ai/code)_"));
  const entry = await t.instance.find(key);
  assert.equal(entry!.status, "changes_requested");
  assert.equal(entry!.changeRequests.filter(request => request.state === "posted").length, 1);
  const blocked = await t.instance.approve(key, { actorId: "robert" });
  assert.equal((blocked as { code: string }).code, "MIRROR_CHANGES_REQUESTED"); assert.equal(gh.calls.merges, 0);
  await t.instance.requestChange(key, { actorId: "robert", text: "también agrega un icono", idempotencyKey: "cambio-def67890" });
  assert.equal(gh.calls.comments.length, 2, "no cap on how many different changes Robert asks for");
});

test("a new headSha report supersedes the old card, keeps history linked, and becomes approvable", async () => {
  const gh = fakeGithub({ headSha: "d".repeat(40) });
  const t = lab({ github: gh.github });
  const first = sign(report());
  const old = await t.instance.receive(first.raw, first.signature, first.timestamp, SECRET);
  await t.instance.requestChange(old.key, { actorId: "robert", text: "hazlo azul", idempotencyKey: "cambio-11111111" });
  const second = sign(report({ headSha: "d".repeat(40) }));
  const fresh = await t.instance.receive(second.raw, second.signature, second.timestamp, SECRET);
  const oldEntry = await t.instance.find(old.key), newEntry = await t.instance.find(fresh.key);
  assert.equal(oldEntry!.status, "superseded"); assert.equal(oldEntry!.supersededBy, fresh.key); assert.equal(newEntry!.supersedes, old.key);
  assert.equal(t.actions.get(old.pendingActionId)!.status, "cancelled");
  assert.equal((await t.instance.approve(old.key, { actorId: "robert" })).ok, false);
  assert.equal((await t.instance.approve(fresh.key, { actorId: "robert" })).ok, true);
});

function scoutFixture(options: { budgetEnv?: NodeJS.ProcessEnv; runs?: MirrorWorkflowRun[] } = {}) {
  const store = memoryStore(); const issues: Array<{ title: string; body: string; labels: string[] }> = [];
  const inputs: ScoutInputs = {
    agents: [
      { id: "events", name: "Agente eventos", blocker: "El scraper de Miami devuelve 0 eventos", issues: ["Timeout al leer la fuente"], nextAction: "Revisar el scraper" },
      { id: "venues", name: "Agente venues", blocker: null, issues: ["Timeout al leer la fuente"] },
      { id: "billing", name: "Agente cobros", blocker: "El checkout de Stripe falla en el pago", issues: [] },
    ],
    cities: [{ id: "mia", name: "Miami", categories: [{ category: "events", recordedFailure: true }] }],
    repairs: [], lessons: [],
  };
  const scouts = createKongImprovementScouts({ owner: "o", store, now: () => NOW, env: { KONG_IMPROVEMENT_SCOUTS_ENABLED: "true", ...(options.budgetEnv || {}) },
    github: { createIssue: async (_repo, issue) => { issues.push(issue); return { number: issues.length, url: `https://github.com/x/y/issues/${issues.length}` }; },
      findPullByBranch: async () => null, listMirrorRuns: async () => options.runs || [] },
    readInputs: async () => inputs, mirrorStatusFor: async () => null });
  return { scouts, issues };
}

test("scouts: deterministic proposals, dedupe across runs, never-auto areas only as decisions", async () => {
  const { scouts, issues } = scoutFixture();
  const first = await scouts.run({ force: true });
  assert.equal(first.ran, true);
  const view = await scouts.view();
  const decision = view.proposals.find(item => item.title.includes("Agente cobros"))!;
  assert.equal(decision.kind, "decision"); assert.equal(decision.status, "decision"); assert.match(decision.change, /Requiere decisión de Robert/);
  assert.ok(issues.every(issue => !/Stripe|checkout/i.test(issue.title)), "never-auto areas never become @codex issues");
  assert.ok(issues.length >= 3);
  for (const issue of issues) {
    assert.deepEqual(issue.labels, ["improve"]);
    assert.match(issue.body, /@codex/); assert.match(issue.body, /improve\//); assert.match(issue.body, /label `mirror-lab`/); assert.match(issue.body, /claude\/genre-fixes-570/);
  }
  const count = issues.length;
  await scouts.run({ force: true });
  assert.equal(issues.length, count, "same open items are never re-proposed");
  assert.equal((await scouts.run()).ran, false, "cadence: at most every 6 hours");
  assert.equal(neverAutoArea("cambiar el precio del ticket"), "precios");
  assert.equal(neverAutoArea("mejorar el layout de la tarjeta"), null);
});

test("mirror run budget: env clamps, estimate from run minutes, scouts open nothing when reached, Robert's change still allowed", async () => {
  assert.equal(resolveMirrorRunBudgetUsd({}), 20);
  assert.equal(resolveMirrorRunBudgetUsd({ KONG_MIRROR_MONTHLY_USD: "0" }), 0);
  assert.equal(resolveMirrorRunBudgetUsd({ KONG_MIRROR_MONTHLY_USD: "9999" }), 500);
  assert.equal(resolveMirrorRunBudgetUsd({ KONG_MIRROR_MONTHLY_USD: "-3" }), 0);
  assert.equal(resolveMirrorUsdPerMinute({}), 0.008);
  const start = new Date(NOW - 3600_000).toISOString();
  const runs: MirrorWorkflowRun[] = [{ id: 1, status: "completed", runStartedAt: start, updatedAt: new Date(NOW - 3600_000 + 30 * 60_000).toISOString(), createdAt: start },
    { id: 2, status: "in_progress", runStartedAt: start, updatedAt: start, createdAt: start }];
  const estimate = estimateMirrorSpend(runs, NOW, {});
  assert.equal(estimate.spentUsd, 0.6, "30 measured min + 45 assumed min at $0.008");
  assert.equal(estimate.perRunMinutes, 30); assert.equal(estimate.paused, false);
  assert.equal(estimate.label, "Pruebas del mes: $0.60 de $20 (estimado)");
  const reached = scoutFixture({ budgetEnv: { KONG_MIRROR_MONTHLY_USD: "0.5" }, runs });
  const result = await reached.scouts.run({ force: true });
  assert.equal(reached.issues.length, 0, "budget reached → no new issues/@codex requests");
  assert.ok(result.ran && result.pausedByBudget > 0);
  assert.equal(result.ran && result.budget.pausedLabel, "En pausa por presupuesto hasta el 1 del próximo mes");
  // Robert's own change request still goes out, with the estimate as a warning.
  const t = lab();
  const app = express(); app.use(express.json());
  registerKongMirrorRoutes(app, { runtime: async () => ({ lab: t.instance, scouts: reached.scouts }), secret: () => SECRET, owner: () => true, sameOrigin: () => true });
  const signed = sign(report());
  const { key } = await t.instance.receive(signed.raw, signed.signature, signed.timestamp, SECRET);
  const server = app.listen(0); const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const response = await fetch(`${base}/api/kong-mirror/${key}/change-request`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "hazlo azul", idempotencyKey: "cambio-route-0001" }) });
    const body = await response.json() as { ok: boolean; warning: string };
    assert.equal(response.status, 200); assert.equal(body.ok, true);
    assert.match(body.warning, /Pruebas del mes: \$0\.60 de \$0\.5 \(estimado\)/);
    assert.match(body.warning, /igual se hará porque la pediste tú/);
    assert.equal(t.calls.comments.length, 1);
  } finally { server.close(); }
});

test("route: signed receive 202, bad signature 401, owner-only decisions", async () => {
  const t = lab();
  const app = express();
  app.use(KONG_PATH, express.raw({ type: () => true, limit: "12mb" }), (req, _res, next) => { (req as { rawBody?: unknown }).rawBody = req.body; next(); });
  app.use(express.json());
  let isOwner = false;
  registerKongMirrorRoutes(app, { resolve: async () => t.instance, secret: () => SECRET, owner: () => isOwner, sameOrigin: () => true });
  const server = app.listen(0); const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    // The lab instance uses a fixed clock; the route passes the raw body and headers through untouched.
    const good = sign(report());
    const post = (signature: string) => fetch(`${base}${KONG_PATH}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Kong-Mirror-Signature": signature, "X-Kong-Mirror-Timestamp": good.timestamp }, body: good.raw });
    assert.equal((await post("sha256=" + "0".repeat(64))).status, 401);
    const accepted = await post(good.signature);
    assert.equal(accepted.status, 202, await accepted.clone().text());
    assert.equal((await post(good.signature)).status, 409);
    const key = mirrorReportKey(KONG_MIRROR_REPOSITORY, 42, HEAD);
    assert.equal((await fetch(`${base}/api/kong-mirror/${key}/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: true }) })).status, 403);
    assert.equal((await fetch(`${base}/api/kong-mirror/reports`)).status, 403);
    isOwner = true;
    assert.equal((await fetch(`${base}/api/kong-mirror/${key}/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status, 400, "second click confirmation required");
    const list = await (await fetch(`${base}/api/kong-mirror/reports`)).json() as { pendingCount: number };
    assert.equal(list.pendingCount, 1);
  } finally { server.close(); }
});
const KONG_PATH = "/api/integrations/kong/mirror-reports";
