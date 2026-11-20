import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import { assertCeoActionActive, assertCeoOrderActive, ceoDomainRouteGuard, ceoFocusContext, ceoFocusIntegrations, pausedCeoDomains } from "../server/ceo-domain-policy";
import { companyOrderJob, createCompanyOrderDiscovery, ASISTENTE_REPOSITORY } from "../server/software-factory-company";
import * as dropshipping from "../server/dropshipping-ceo";
import * as revenue from "../server/revenue-engine";
import type { CompanyOrder } from "../shared/agent-company";
import type { FactoryProject } from "../server/software-factory";
import { mkdtemp, readFile, realpath, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

test("owner focus pause holds API and direct commercial work while maintenance stays available", async () => {
  const previous = process.env.CEO_PAUSED_DOMAINS;
  process.env.CEO_PAUSED_DOMAINS = "websites,dropshipping";
  try {
    assert.deepEqual(pausedCeoDomains({ CEO_PAUSED_DOMAINS: "websites,clippers,factory,websites,dropshipping" }), ["websites", "dropshipping"]);
    assert.match(ceoFocusContext(), /fábrica de software, academia/);
    assert.match(ceoFocusContext(), /News.*clips/);
    assert.equal(ceoFocusIntegrations({}).revenue.mode, "pausada");
    assert.equal(ceoFocusIntegrations({}).dropshipping.mode, "pausada");
    assert.equal(ceoFocusIntegrations({})["clippers"], undefined);
    assert.equal(dropshipping.getDropshippingCeoSnapshot().operatingPause.paused, true);
    assert.equal(revenue.getRevenueEngineSnapshot().operatingPause.paused, true);
    const app = express(); let mutations = 0;
    app.use(ceoDomainRouteGuard);
    app.get(["/api/revenue-engine", "/api/dropshipping-ceo/status"], (_req, res) => res.json({ readable: true }));
    app.post(["/api/revenue-engine/scout-dispatch", "/api/dropshipping-ceo/operating-cycle", "/api/software-factory/enqueue", "/api/clippers/run", "/api/academy/run", "/api/kong-repairs"], (_req, res) => { mutations++; res.json({ allowed: true }); });
    const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
    try {
      const address = server.address(); assert.ok(address && typeof address !== "string");
      const base = `http://127.0.0.1:${address.port}`;
      for (const route of ["/api/revenue-engine", "/api/dropshipping-ceo/status", "/API/REVENUE-ENGINE"]) {
        assert.equal((await fetch(base + route)).status, 200);
        assert.equal((await fetch(base + route, { method: "HEAD" })).status, 200);
      }
      for (const route of ["/api/revenue-engine/scout-dispatch", "/api/dropshipping-ceo/operating-cycle", "/API/REVENUE-ENGINE/scout-dispatch", "/API/DROPSHIPPING-CEO/operating-cycle"]) {
        const response = await fetch(base + route, { method: "POST" }); assert.equal(response.status, 423);
        const body = await response.json(); assert.equal(body.error, "CEO_DOMAIN_PAUSED"); assert.equal(body.queueDisposition, "held_not_deleted");
      }
      assert.equal(mutations, 0);
      for (const route of ["/api/software-factory/enqueue", "/api/clippers/run", "/api/academy/run", "/api/kong-repairs"]) assert.equal((await fetch(base + route, { method: "POST" })).status, 200);
      assert.equal(mutations, 4);
    } finally { server.close(); await once(server, "close"); }

    // Invalid inputs would fail parsing; the owner pause must run even earlier,
    // before any disk writes, provider, outreach or queue acknowledgement.
    for (const operation of [
      dropshipping.runDropshippingDailyOperatingCycle, dropshipping.runDropshippingAutopilotProductHunter,
      dropshipping.prepareDropshippingLaunchPackApprovalQueue, dropshipping.markDropshippingApprovalOutboxQueued,
      dropshipping.researchDropshippingProduct, dropshipping.buildDropshippingLaunchPlan,
      revenue.runRevenueScoutDispatch, revenue.runRevenueMoneySprint, revenue.buildRevenueMockup,
      revenue.createWebsiteDeliveryWorkspaceFromLead, revenue.recordRevenueSalesAutopilot,
      revenue.deliverRevenueDeliveryWorkspaceFromTrustedApproval,
    ]) assert.throws(() => (operation as (input: unknown) => unknown)(undefined), /CEO_DOMAIN_PAUSED/);
    await assert.rejects(dropshipping.createDropshippingShopifyDraft(undefined as never), /CEO_DOMAIN_PAUSED/);
    await assert.rejects(dropshipping.publishDropshippingSocialPost(undefined as never), /CEO_DOMAIN_PAUSED/);
    await assert.rejects(revenue.sendRevenueOutreachDraft(undefined as never), /CEO_DOMAIN_PAUSED/);

    const queued = { actionType: "dropshipping.create_shopify_draft", input: { approved: true, CEO_PAUSED_DOMAINS: "" }, status: "approved" };
    const before = structuredClone(queued);
    assert.throws(() => assertCeoActionActive(queued), /CEO_DOMAIN_PAUSED/);
    assert.deepEqual(queued, before);
    assert.throws(() => assertCeoActionActive({ actionType: "automation.manual_run", metadata: { key: "dropshipping-ceo-daily-operating-cycle" } }), /CEO_DOMAIN_PAUSED/);
    assert.doesNotThrow(() => assertCeoActionActive({ actionType: "clippers.run" }));

    const maintenance: CompanyOrder = { id: "existing", text: "Arregla el error de búsqueda de nuestra web existente", createdAt: "2026-11-18T12:00:00Z", assignees: [{ agentId: "code", status: "en_curso", note: "" }] };
    const commercial = { ...maintenance, text: "Crea una nueva página para vender websites", assignees: [...maintenance.assignees, { agentId: "revenue", status: "en_curso" as const, note: "" }] };
    const project = { id: "asistente", repo: ASISTENTE_REPOSITORY } as FactoryProject;
    assert.doesNotThrow(() => assertCeoOrderActive(maintenance));
    assert.doesNotThrow(() => companyOrderJob(maintenance, project, 1));
    for (const text of ["Crear una página nueva para analíticas de Clippers", "Crear una página nueva para la academia", "create new cache layer for KONG website"]) {
      assert.doesNotThrow(() => assertCeoOrderActive({ ...maintenance, text }));
    }
    for (const agentId of ["revenue", "dropshipping"]) assert.throws(() => assertCeoOrderActive({ ...maintenance, assignees: [{ agentId, status: "en_curso", note: "" }] }), /CEO_DOMAIN_PAUSED/);
    assert.throws(() => companyOrderJob(commercial, project, 1), /CEO_DOMAIN_PAUSED/);
    let downstreamCalls = 0;
    // Existing queued factory source re-checks the owner pause before head reads or model inspection.
    const discovery = createCompanyOrderDiscovery({ readMainOrder: async () => commercial, resolveHead: async () => { downstreamCalls++; return "a".repeat(40); }, inspectOrder: async () => { downstreamCalls++; return undefined; } });
    await assert.rejects(discovery(project, { signal: new AbortController().signal, maxCostCents: 1, source: { companyOrder: { version: 1, company: "main", orderId: commercial.id, revision: "old-approved" } } }), /CEO_DOMAIN_PAUSED/);
    assert.equal(downstreamCalls, 0);
    assert.equal(commercial.assignees[0].status, "en_curso");

    // Reversible owner control; queued records need no deletion or recreation.
    process.env.CEO_PAUSED_DOMAINS = "";
    assert.equal(ceoFocusContext(), "");
    assert.doesNotThrow(() => assertCeoActionActive(queued));
    assert.doesNotThrow(() => companyOrderJob(commercial, project, 1));
  } finally {
    if (previous === undefined) delete process.env.CEO_PAUSED_DOMAINS; else process.env.CEO_PAUSED_DOMAINS = previous;
  }
});

test("the real Revenue page renders held snapshots without restoring commercial fallback routes or commands", async () => {
  const previous = process.env.CEO_PAUSED_DOMAINS;
  const directory = await mkdtemp(path.join(os.tmpdir(), "ceo-guidance-render-"));
  const { build } = await import("esbuild");
  const React = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  const { Router } = await import("wouter");
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, gcTime: Infinity, retry: false } } });
  try {
    await symlink(await realpath("node_modules"), path.join(directory, "node_modules"));
    const modulePath = path.join(directory, "page.mjs");
    await build({
      stdin: { contents: "export { default } from './client/src/pages/revenue-engine';", resolveDir: process.cwd(), loader: "tsx" },
      bundle: true, platform: "node", format: "esm", packages: "external", outfile: modulePath, jsx: "automatic",
      // Exercise every real page panel in SSR without a browser or changing its
      // production tab behavior. Only the tab wrapper is force-mounted here.
      plugins: [{ name: "all-revenue-panels", setup(builder) {
        builder.onLoad({ filter: /[/\\]components[/\\]ui[/\\]tabs\.tsx$/ }, async args => {
          const source = await readFile(args.path, "utf8");
          assert.equal(source.split("<TabsPrimitive.Content").length - 1, 1);
          return { contents: source.replace("<TabsPrimitive.Content", "<TabsPrimitive.Content forceMount"), loader: "tsx" };
        });
      } }],
    });
    const { default: Page } = await import(pathToFileURL(modulePath).href);
    const render = () => renderToStaticMarkup(React.createElement(QueryClientProvider, { client }, React.createElement(Router, { ssrPath: "/revenue-engine" }, React.createElement(Page))));
    process.env.CEO_PAUSED_DOMAINS = "websites,dropshipping";
    client.setQueryData(["revenue-engine"], revenue.getRevenueEngineSnapshot());
    const html = render();
    assert.equal(html.includes("/api/revenue-engine/scout-dispatch"), false, "a blank paused action must not restore a default route");
    assert.equal(html.includes("Find public no-website leads."), false, "a blank command must not restore research advice");
    for (const id of ["button-copy-first-sprint-brief", "button-copy-first-sprint-dispatch-request", "button-copy-daily-money-command", "button-copy-daily-run-packet", "button-copy-daily-run-api-request", "button-run-daily-money-safe-action"]) {
      const tag = html.match(new RegExp(`<button[^>]*data-testid="${id}"[^>]*>`))?.[0];
      assert.equal(!!tag && /\bdisabled(?:=|\s|>)/.test(tag), true, `${id} must remain held`);
    }
    process.env.CEO_PAUSED_DOMAINS = "";
    client.setQueryData(["revenue-engine"], revenue.getRevenueEngineSnapshot());
    const resumed = render();
    assert.equal(resumed.includes("/api/revenue-engine/scout-dispatch"), true);
    const resumedCopy = resumed.match(/<button[^>]*data-testid="button-copy-first-sprint-brief"[^>]*>/)?.[0];
    assert.equal(!!resumedCopy && /\bdisabled(?:=|\s|>)/.test(resumedCopy), false);
  } finally {
    client.clear(); await rm(directory, { recursive: true, force: true });
    if (previous === undefined) delete process.env.CEO_PAUSED_DOMAINS; else process.env.CEO_PAUSED_DOMAINS = previous;
  }
});

test("paused commercial summaries hold guidance without changing records or facts, and resume their original guidance", async () => {
  const previous = process.env.CEO_PAUSED_DOMAINS;
  const directory = await mkdtemp(path.join(os.tmpdir(), "ceo-guidance-fixture-"));
  const originalLeadsPath = revenue.getRevenueEngineSnapshot().persistence.leadsPath;
  try {
    process.env.CEO_PAUSED_DOMAINS = "";
    revenue.setRevenueLeadsPathForTests(path.join(directory, "leads.json"));
    dropshipping.setDropshippingProductsPathForTests(path.join(directory, "products.json"));
    revenue.recordRevenueLead(revenue.revenueLeadSchema.parse({ businessName: "Fixture Business", area: "Fixture City", niche: "fixture service", websiteStatus: "no_website", contactChannel: "email", contactValue: "fixture@example.test", evidence: "Local synthetic public-evidence fixture", painPoint: "Fixture conversion problem", estimatedOfferUsd: 1500 }));
    dropshipping.researchDropshippingProduct(dropshipping.dropshippingProductResearchSchema.parse({ productName: "Fixture product", productCostUsd: 4, targetSellPriceUsd: 20, evidence: "Local synthetic product evidence" }));
    const beforeRevenue = revenue.getRevenueEngineSnapshot(), beforeDrop = dropshipping.getDropshippingCeoSnapshot();
    assert.ok(beforeRevenue.recentLeads.length > 0); assert.ok(beforeDrop.recentProducts.length > 0);
    process.env.CEO_PAUSED_DOMAINS = "websites,dropshipping";
    const heldRevenue = revenue.getRevenueEngineSnapshot(), heldDrop = dropshipping.getDropshippingCeoSnapshot();
    assert.deepEqual(heldRevenue.metrics, beforeRevenue.metrics); assert.deepEqual(heldDrop.metrics, beforeDrop.metrics);
    assert.deepEqual(heldRevenue.recentLeads, beforeRevenue.recentLeads); assert.deepEqual(heldDrop.recentProducts, beforeDrop.recentProducts);
    assert.deepEqual(heldRevenue.operatorConsole.scoreboard, beforeRevenue.operatorConsole.scoreboard);
    assert.deepEqual(heldRevenue.systemReadiness.items.map(item => item.evidence), beforeRevenue.systemReadiness.items.map(item => item.evidence));
    assert.deepEqual(heldDrop.executionSetup.connectors.map(item => item.evidence), beforeDrop.executionSetup.connectors.map(item => item.evidence));
    assert.deepEqual(heldRevenue.operatorConsole.allowedNow, []); assert.match(heldRevenue.operatorConsole.nextCommand, /^Pausado/);
    assert.equal(heldRevenue.operatorConsole.canSpendNow, false); assert.equal(heldRevenue.dailyMoneyCommand.status, "held");
    assert.deepEqual(heldRevenue.dailyMoneyCommand.steps, []); assert.equal(heldRevenue.dailyMoneyCommand.runPacket.apiAction, "");
    assert.equal(heldRevenue.dailyMoneyCommand.runPacket.copyableApiRequest, ""); assert.equal(heldRevenue.dailyMoneyCommand.copyableOperatorBrief, "");
    assert.deepEqual(heldRevenue.businessScoutQueue.tasks, []); assert.equal(heldRevenue.businessScoutQueue.safety.researchesPublicSources, false);
    assert.equal(heldRevenue.moneyActivationPlan.canContactBusinesses, false); assert.equal(heldRevenue.moneyActivationPlan.canCollectMoney, false);
    assert.equal(heldRevenue.moneyActivationPlan.firstSprintPlan.nextApiAction, ""); assert.deepEqual(heldRevenue.costPolicy.allowedWithoutApproval, []);
    assert.equal(heldRevenue.websiteSalesPacketQueue.readyCount, beforeRevenue.websiteSalesPacketQueue.readyCount);
    assert.equal(heldDrop.executiveSummary.status, "held"); assert.match(heldDrop.executiveSummary.nextCommand, /^Pausado/);
    assert.deepEqual(heldDrop.operatingContract.canRunAutonomously, []); assert.deepEqual(heldDrop.growthLoop.dailyOperatingRhythm, []);
    assert.deepEqual(heldDrop.growthBoard.nextOperatingOrders, []); assert.equal(heldDrop.profitGuard.canSpendUsd, 0);
    assert.deepEqual(heldDrop.marketingDepartment.operatingModel.canRunAutonomously, []);
    assert.equal(heldDrop.launchReadiness.checkout.paymentProcessorConfigured, beforeDrop.launchReadiness.checkout.paymentProcessorConfigured);
    assert.equal(heldDrop.liveSignalReadiness.configured, beforeDrop.liveSignalReadiness.configured);
    assert.deepEqual(heldDrop.liveSignalReadiness.recommendedSources, []);
    assert.deepEqual(heldDrop.readiness.map(item => item.status), beforeDrop.readiness.map(item => item.status));
    assert.ok(heldDrop.readiness.every(item => item.detail.startsWith("Pausado")));
    assert.equal(dropshipping.getDropshippingExecutionSetup().executionSetup.nextApprovalRequest.actionType, "");
    assert.ok(heldRevenue.agents.every(agent => agent.status === "held")); assert.ok(heldDrop.agents.every(agent => agent.status === "held"));
    assert.throws(() => revenue.runRevenueScoutDispatch(), /CEO_DOMAIN_PAUSED/); assert.throws(() => dropshipping.runDropshippingDailyOperatingCycle(), /CEO_DOMAIN_PAUSED/);
    process.env.CEO_PAUSED_DOMAINS = "";
    assert.deepEqual(revenue.getRevenueEngineSnapshot().operatorConsole, beforeRevenue.operatorConsole);
    assert.deepEqual(dropshipping.getDropshippingCeoSnapshot().executiveSummary, beforeDrop.executiveSummary);
  } finally {
    revenue.setRevenueLeadsPathForTests(originalLeadsPath); dropshipping.setDropshippingProductsPathForTests(null);
    await rm(directory, { recursive: true, force: true });
    if (previous === undefined) delete process.env.CEO_PAUSED_DOMAINS; else process.env.CEO_PAUSED_DOMAINS = previous;
  }
});
