import test from "node:test";
import assert from "node:assert/strict";
import { runInNewContext, Script } from "node:vm";
import { blackRoomLearningPanelScript } from "../server/blackroom-learning-panel";
import { blackRoomPage } from "../server/blackroom-control-routes";

test("all generated panel scripts remain valid JavaScript", () => {
  const scripts = [...blackRoomPage.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length > 0);
  for (const match of scripts) assert.doesNotThrow(() => new Script(match[1]));
});

test("panel is wired to refresh and distinguishes missing, stale and controlled evidence", () => {
  assert.ok(blackRoomPage.includes('function render(d){renderLearning(d);'));
  const target = { textContent: "", style: {} };
  const context = { document: { getElementById: () => target } };
  runInNewContext(blackRoomLearningPanelScript + ';renderLearning({});', context);
  assert.match(target.textContent, /sin evaluación verificable/);
  runInNewContext(`renderLearning({agent:{analytics:{verifiedLearning:{youtube:{status:'stale',sourceObservedAt:'2026-07-01T00:00:00Z',matchedSnapshots:12,windowHours:24,reason:'<img src=x onerror=alert(1)>',id:'test'}}}}});`, context);
  assert.match(target.textContent, /adaptación detenida/);
  assert.match(target.textContent, /Muestras comparables: 12/);
  assert.match(target.textContent, /<img/); // Rendered as text, never interpreted as markup.
  assert.equal('innerHTML' in target, false);
});

test("panel shows collection failures and actual coverage even without a decision", () => {
  const target = { textContent: "", style: {} };
  runInNewContext(blackRoomLearningPanelScript + `;renderLearning({remote:{analyticsImports:{youtube:{sampleCount:20,exactAttributed:3,snapshotCoverage:{24:3,72:1,168:0}}},device:{worker:{automaticAnalytics:{setupRequired:true,errors:{youtube:'Sesión expirada'}}}}}});`,
    { document: { getElementById: () => target } });
  assert.match(target.textContent, /Asociación exacta: 3\/20/);
  assert.match(target.textContent, /Mediciones 24h\/72h\/7d: 3\/1\/0/);
  assert.match(target.textContent, /requiere iniciar sesión/);
  assert.match(target.textContent, /Sesión expirada/);
});
