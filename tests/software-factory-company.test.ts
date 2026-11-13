import test from "node:test";
import assert from "node:assert/strict";
import { companyOrderJob, createCompanyOrderDiscovery, ASISTENTE_REPOSITORY } from "../server/software-factory-company";
import type { CompanyOrder } from "../shared/agent-company";
import type { FactoryProject } from "../server/software-factory";

const order: CompanyOrder = { id: "order-1", text: "Mejora la búsqueda de agentes en Asistente", createdAt: "2026-11-06T12:00:00Z", assignees: [{ agentId: "code", status: "en_curso", note: "" }] };
const project = { id: "asistente", repo: ASISTENTE_REPOSITORY } as FactoryProject;
test("private company admission is stable across status updates and excludes Kong and non-engineering work", () => {
  const first = companyOrderJob(order, project, 1);
  assert.deepEqual(companyOrderJob({ ...order, assignees: [{ ...order.assignees[0], note: "processing" }] }, project, 1), first);
  assert.doesNotMatch(JSON.stringify(first), /búsqueda|Mejora/);
  assert.notEqual(companyOrderJob({ ...order, text: "Mejora los filtros" }, project, 1).key, first.key);
  for (const invalid of [
    { ...order, doneAt: order.createdAt }, { ...order, text: "Mejorar Kong" },
    ...["kong", "kong:CEO", "kong-videos", "kong-metrics", "kong-city:miami", "kong-supervisor"].map(agentId => ({ ...order, assignees: [...order.assignees, { agentId, status: "en_curso" as const, note: "" }] })),
    { ...order, assignees: [{ agentId: "marketing-cmo", status: "en_curso" as const, note: "" }] },
  ]) assert.throws(() => companyOrderJob(invalid, project, 1));
  assert.throws(() => companyOrderJob(order, { ...project, repo: "owner/kong" }, 1));
  assert.throws(() => companyOrderJob(order, project, 0));
});
test("discovery re-reads the main order, binds exact source revision and head, and never closes it", async () => {
  let current: CompanyOrder | undefined = structuredClone(order), heads = 0;
  const discover = createCompanyOrderDiscovery({ readMainOrder: async id => id === order.id ? current : undefined, resolveHead: async repo => { assert.equal(repo, ASISTENTE_REPOSITORY); heads++; return "a".repeat(40); }, inspectOrder: async () => ({ kind: "bug", regressionScenarioId: "agent-search" }) });
  const context = { signal: new AbortController().signal, maxCostCents: 1, source: companyOrderJob(order, project, 1).payload };
  const result = await discover(project, context);
  assert.equal(result.costCents, 0);
  assert.equal(result.finding?.baseSha, "a".repeat(40));
  assert.equal(result.finding?.kind, "bug");
  assert.equal(result.finding?.regressionScenarioId, "agent-search");
  assert.match(result.finding!.request, /búsqueda/);
  assert.deepEqual(current, order);
  current = { ...order, text: "Un encargo diferente" };
  await assert.rejects(discover(project, context), /ORDER_CHANGED/);
  current = { ...order, doneAt: order.createdAt };
  await assert.rejects(discover(project, context), /ORDER_INELIGIBLE/);
  current = undefined;
  await assert.rejects(discover(project, context), /ORDER_UNAVAILABLE/);
  await assert.rejects(discover(project, { ...context, source: { companyOrder: { company: "kong", version: 1, orderId: order.id } } }), /SOURCE_REQUIRED/);
  assert.equal(heads, 1);
});

test("discovery persists the trusted per-order file selection on the finding", async () => {
  const context = { signal: new AbortController().signal, maxCostCents: 1, source: companyOrderJob(order, project, 1).payload };
  const make = (sourcePaths: unknown) => createCompanyOrderDiscovery({ readMainOrder: async () => order, resolveHead: async () => "a".repeat(40), inspectOrder: async () => ({ kind: "bug", regressionScenarioId: "agent-search", sourcePaths } as any) });
  const selected = ["server/agent-search.ts", "tests/agent-search.test.ts"];
  assert.deepEqual((await make(selected)(project, context)).finding?.sourcePaths, selected);
  assert.equal("sourcePaths" in (await make(undefined)(project, context)).finding!, false);
  for (const bad of [[], "server/a.ts", [""], [1]]) await assert.rejects(make(bad)(project, context), /PATHS_UNVERIFIED/);
});
