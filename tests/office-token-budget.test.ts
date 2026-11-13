import assert from "node:assert/strict";
import test from "node:test";
import { createOfficeTokenBudget, type OfficeTokenBudgetState } from "../server/office-token-budget";
const input = { model: "gpt-6-astra", promptBytes: 100, maxOutputTokens: 32 };
const result = { provider: "openai" as const, model: "gpt-6-astra", sessionId: "resp_one", completedAt: "2026-11-06T12:00:00Z", usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 } };
function fixture(limit = 2000) {
  let state: OfficeTokenBudgetState = { reservations: [] }; let time = "2026-11-06T12:00:00Z"; let tail = Promise.resolve();
  const transact = (fn: (s: OfficeTokenBudgetState) => void) => {
    const next = tail.then(() => { const candidate = structuredClone(state); fn(candidate); state = candidate; });
    tail = next.catch(() => {}); return next;
  };
  const create = () => createOfficeTokenBudget({ limit, transact, now: () => new Date(time) });
  return { create, state: () => state, setTime: (v: string) => { time = v; } };
}
test("concurrent attempts cannot oversubscribe durable reservation", async () => {
  const f = fixture(); const budget = f.create();
  const results = await Promise.allSettled([budget.reserve(input), budget.reserve(input)]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1); assert.equal(f.state().reservations.length, 1);
});
test("restart retains reservations and unknown attempts carry across month", async () => {
  const f = fixture(); await f.create().reserve(input);
  f.setTime("2026-12-01T01:00:00Z");
  await assert.rejects(f.create().reserve(input), (e: any) => e.code === "token_budget_exhausted");
});
test("verified usage releases unused reservation and records response once", async () => {
  const f = fixture(); const budget = f.create(); const id = await budget.reserve(input);
  await budget.recordUsage(id, result); await budget.recordUsage(id, result);
  await budget.reserve(input); assert.equal(f.state().reservations.length, 2);
  await assert.rejects(budget.recordUsage(id, { ...result, sessionId: "resp_other" }));
});
test("actual overrun remains charged and prevents subsequent admission", async () => {
  const f = fixture(); const budget = f.create(); const id = await budget.reserve(input);
  await budget.recordUsage(id, { ...result, usage: { inputTokens: 2000, outputTokens: 100, totalTokens: 2100 } });
  await assert.rejects(budget.reserve(input)); assert.equal(f.state().reservations[0].result?.usage.totalTokens, 2100);
});
test("invalid usage and reused provider response roll back", async () => {
  const f = fixture(4000); const budget = f.create(); const a = await budget.reserve(input); const b = await budget.reserve(input);
  await assert.rejects(budget.recordUsage(a, { ...result, usage: { inputTokens: 20, outputTokens: 10, totalTokens: 0 } }));
  assert.equal(f.state().reservations[0].status, "reserved");
  await budget.recordUsage(a, result); await assert.rejects(budget.recordUsage(b, result));
  assert.equal(f.state().reservations[1].status, "reserved");
});
test("missing explicit limit and malformed persisted state fail closed", async () => {
  assert.throws(() => createOfficeTokenBudget({ limit: NaN, transact: async () => {} }));
  const budget = createOfficeTokenBudget({ limit: 2000, transact: async fn => fn({ reservations: [{ id: "bad" }] } as any) });
  await assert.rejects(budget.reserve(input));
});
