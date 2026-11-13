import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPublicScoutConnectorIntakePayload,
  buildPublicScoutConnectorIntakeRequest,
} from "../client/src/lib/revenue-engine-public-scout-connector";

const connectorContext = {
  activeScoutArea: "Miami",
  activeScoutNiche: "coffee shop",
  missionId: "daily-scout-1",
  sourceTaskId: "task-1",
  connectorName: "browser-public-scout",
  connectorRunId: "run-1",
};

const resultRow = {
  businessName: "No Site Cafe",
  area: "Miami",
  niche: "coffee shop",
  websiteStatus: "no_website",
  contactChannel: "instagram",
  contactValue: "@nositecafe",
  sourceUrl: "https://instagram.com/nositecafe",
  evidence: "Public Instagram profile is active, has no dedicated website link and shows menu posts.",
  painPoint: "Needs online menu and inquiry capture.",
};

test("public scout connector payload accepts raw result arrays", () => {
  const payload = buildPublicScoutConnectorIntakePayload(JSON.stringify([resultRow]), connectorContext);

  assert.equal(payload.area, "Miami");
  assert.equal(payload.niche, "coffee shop");
  assert.equal(payload.missionId, "daily-scout-1");
  assert.equal(payload.sourceTaskId, "task-1");
  assert.equal(payload.connectorName, "browser-public-scout");
  assert.equal(payload.connectorRunId, "run-1");
  assert.deepEqual(payload.results, [resultRow]);
  assert.equal(payload.notes, "Recorded from Revenue Engine verified connector intake UI.");
});

test("public scout connector payload accepts full dispatch payload object", () => {
  const payload = buildPublicScoutConnectorIntakePayload(JSON.stringify({
    area: "Tampa",
    niche: "dentists",
    missionId: "daily-scout-2",
    sourceTaskId: "task-2",
    connectorName: "browser-public-scout",
    connectorRunId: "run-2",
    results: [resultRow],
    notes: "Verified public-search scout connector intake.",
  }), connectorContext);

  assert.equal(payload.area, "Tampa");
  assert.equal(payload.niche, "dentists");
  assert.equal(payload.missionId, "daily-scout-2");
  assert.equal(payload.sourceTaskId, "task-2");
  assert.equal(payload.connectorRunId, "run-2");
  assert.deepEqual(payload.results, [resultRow]);
  assert.equal(payload.notes, "Verified public-search scout connector intake.");
});

test("public scout connector payload rejects objects without results array", () => {
  assert.throws(
    () => buildPublicScoutConnectorIntakePayload(JSON.stringify({ results: "nope" }), connectorContext),
    /array de resultados o el payload completo/,
  );
});

test("public scout connector request posts the full dispatch payload body", () => {
  const request = buildPublicScoutConnectorIntakeRequest(JSON.stringify({
    area: "Tampa",
    niche: "dentists",
    missionId: "daily-scout-2",
    sourceTaskId: "task-2",
    connectorName: "browser-public-scout",
    connectorRunId: "run-2",
    results: [resultRow],
    notes: "Verified public-search scout connector intake.",
  }), connectorContext);

  assert.equal(request.endpoint, "/api/revenue-engine/public-scout-connector-intake");
  assert.equal(request.init.method, "POST");
  assert.deepEqual(request.init.headers, { "Content-Type": "application/json" });
  assert.deepEqual(JSON.parse(request.init.body), {
    area: "Tampa",
    niche: "dentists",
    missionId: "daily-scout-2",
    sourceTaskId: "task-2",
    connectorName: "browser-public-scout",
    connectorRunId: "run-2",
    results: [resultRow],
    notes: "Verified public-search scout connector intake.",
  });
});
