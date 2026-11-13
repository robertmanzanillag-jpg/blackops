import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  getMarketingCommandCenterSnapshot,
  resetMarketingCommandCenterForTests,
  runMarketingCommandCenterDay,
  setMarketingCommandCenterLearningPathForTests,
} from "../server/marketing-command-center";

const testDir = path.join(os.tmpdir(), "marketing-command-center-tests");

test.beforeEach(() => {
  const learningPath = path.join(testDir, "learning-runs.json");
  rmSync(learningPath, { force: true });
  setMarketingCommandCenterLearningPathForTests(learningPath);
  resetMarketingCommandCenterForTests();
});

test.after(() => {
  setMarketingCommandCenterLearningPathForTests(null);
  resetMarketingCommandCenterForTests();
});

test("builds a global CMO with separated internal clients and strong skills", () => {
  const snapshot = getMarketingCommandCenterSnapshot();

  assert.equal(snapshot.cmoAgent.id, "marketing-cmo");
  assert.equal(snapshot.cmoAgent.scope, "global");
  assert.equal(snapshot.capacity.maxClients, 20);
  assert.equal(snapshot.clients.length, 4);
  assert.equal(snapshot.capacity.openSlots, 16);
  assert.equal(snapshot.globalScorecard.readyClients, snapshot.clients.length);
  assert.deepEqual(snapshot.clients.map((client) => client.id), ["black-room", "dropshipping", "kong", "clipping"]);
  assert.equal(snapshot.clients.every((client) => client.separationKey.startsWith("client:")), true);
  assert.equal(snapshot.clients.every((client) => client.status === "ready"), true);
  assert.equal(snapshot.clients.every((client) => client.handoff?.status === "ready"), true);
  const blackRoom = snapshot.clients.find((client) => client.id === "black-room");
  assert.ok(blackRoom);
  assert.equal(blackRoom.name, "Black Room (Fiesta + Radio)");
  assert.equal(blackRoom.marketingCapabilities?.includes("flyers/templates"), true);
  assert.equal(blackRoom.marketingCapabilities?.includes("promo videos"), true);
  assert.equal(blackRoom.detectedSources?.includes("server/promo-video-agent.ts"), true);
  assert.equal(blackRoom.detectedSources?.includes("client/src/components/flyer-generator.tsx"), true);
  assert.equal(snapshot.clients.some((client) => client.id === "personal-brand"), false);
  assert.equal(snapshot.clients.some((client) => client.id === "revenue-websites"), false);
  assert.equal(snapshot.detectedMarketingApps.some((app) => app.clientId === "black-room" && app.detectedSources.includes("server/promo-video-agent.ts")), true);
  assert.equal(snapshot.detectedMarketingApps.some((app) => app.clientId === "black-room" && app.detectedSources.includes("client/src/components/flyer-generator.tsx")), true);
  assert.equal(snapshot.skillStack.some((skill) => skill.id === "analytics-attribution"), true);
  assert.equal(snapshot.skillStack.some((skill) => skill.id === "paid-ads-profit-guard"), true);
  assert.equal(snapshot.skillStack.some((skill) => skill.id === "learning-system"), true);
  assert.equal(snapshot.subagents.some((agent) => agent.id === "learning-optimizer"), true);
  assert.equal(snapshot.operatingModel.requiresApproval.includes("publicar"), true);
});

test("runs self-improvement without publishing, spending, contacting, or mixing client data", () => {
  const result = runMarketingCommandCenterDay({ focusClientId: "all" });

  assert.equal(result.status, "completed");
  assert.equal(result.safety.externalActionsBlocked, true);
  assert.equal(result.safety.spentUsd, 0);
  assert.equal(result.safety.publishedExternally, 0);
  assert.equal(result.safety.clientDataMixed, false);
  assert.equal(result.learning.clientsReviewed, 4);
  assert.equal(result.learning.safetyBlocks.includes("Mezcla de datos entre clientes bloqueada."), true);
  assert.equal(result.snapshot.recentLearningRuns.length, 1);
});
