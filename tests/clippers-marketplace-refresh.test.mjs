import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runMarketplaceRefresh } from "../script/clippers-marketplace-refresh.mjs";

const NOW = new Date("2026-08-12T12:00:00.000Z");

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "clippers-marketplace-refresh-"));
  await mkdir(path.join(root, "workspace"), { recursive: true });
  return root;
}

function validSnapshot(marketplace = "vyro") {
  return {
    marketplace,
    observedAt: NOW.toISOString(),
    campaigns: [{
      id: "campaign-1", title: "Authorized campaign", active: true, joined: true,
      expiresAt: "2026-08-20T12:00:00.000Z", rightsExpiresAt: "2026-08-20T12:00:00.000Z",
      sourceUrl: "https://media.example.test/source", rightsEvidencePath: "evidence-drop/marketplaces/campaign.md",
      evidenceVerified: true, compatibleAccounts: ["streamersclipusa"], payoutCpm: 2, minViewsPerPost: 0,
    }],
  };
}

const executable = process.execPath;

test("falls back between authorized adapters and atomically writes a validated fresh snapshot", async () => {
  const root = await fixture();
  try {
    const calls = [];
    const report = await runMarketplaceRefresh({
      workspaceRoot: path.join(root, "workspace"), now: NOW,
      config: { schemaVersion: 1, providers: [{ provider: "vyro", enabled: true, authorized: true, adapters: [
        { command: executable, args: ["first"] }, { command: executable, args: ["second"] },
      ] }] },
      executeAdapter: async (adapter) => {
        calls.push(adapter.args[0]);
        return adapter.args[0] === "first" ? { ok: false, reason: "session_unavailable" } : { ok: true, stdout: JSON.stringify(validSnapshot()) };
      },
    });
    assert.equal(report.status, "ready");
    assert.equal(report.summary.refreshed, 1);
    assert.deepEqual(calls, ["first", "second"]);
    assert.deepEqual(report.providers[0].attempts.map((row) => row.reason || row.status), ["session_unavailable", "succeeded"]);
    const stored = JSON.parse(await readFile(path.join(root, "workspace", "research", "marketplace-snapshots", "vyro.json"), "utf8"));
    assert.deepEqual(stored, { schemaVersion: 1, ...validSnapshot() });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("does not fabricate a snapshot when configuration or an adapter is absent", async () => {
  const root = await fixture();
  try {
    const workspaceRoot = path.join(root, "workspace");
    const missing = await runMarketplaceRefresh({ workspaceRoot, configPath: path.join(root, "missing.json"), now: NOW });
    assert.equal(missing.status, "blocked");
    assert.equal(missing.reason, "config_missing");
    const absent = await runMarketplaceRefresh({ workspaceRoot, now: NOW, config: { schemaVersion: 1, providers: [{ provider: "whop", authorized: true, adapters: [] }] } });
    assert.equal(absent.status, "blocked");
    assert.equal(absent.providers[0].reason, "adapter_missing");
    await assert.rejects(readFile(path.join(workspaceRoot, "research", "marketplace-snapshots", "whop.json")));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("requires explicit provider authorization and rejects unsafe commands", async () => {
  const root = await fixture();
  try {
    const report = await runMarketplaceRefresh({ workspaceRoot: path.join(root, "workspace"), now: NOW, config: { schemaVersion: 1, providers: [
      { provider: "content rewards", authorized: false, adapters: [{ command: executable, args: [] }] },
      { provider: "clipping", authorized: true, adapters: [{ command: "node", args: [] }] },
    ] } });
    assert.equal(report.status, "blocked");
    assert.equal(report.providers[0].reason, "provider_not_authorized");
    assert.equal(report.providers[1].attempts[0].reason, "adapter_command_unsafe");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("rejects stale, mismatched, and incomplete adapter data without retaining secret output", async () => {
  const root = await fixture();
  try {
    const outputs = [
      { ...validSnapshot("whop"), observedAt: "2026-08-12T10:00:00.000Z", token: "TOP_SECRET" },
      validSnapshot("vyro"),
      { ...validSnapshot("whop"), campaigns: [{ title: "made up" }] },
    ];
    let call = 0;
    const report = await runMarketplaceRefresh({
      workspaceRoot: path.join(root, "workspace"), now: NOW,
      config: { schemaVersion: 1, providers: [{ provider: "whop", authorized: true, adapters: outputs.map((_, i) => ({ command: executable, args: [String(i)] })) }] },
      executeAdapter: async () => ({ ok: true, stdout: JSON.stringify(outputs[call++]) }),
    });
    assert.equal(report.status, "blocked");
    assert.deepEqual(report.providers[0].attempts.map((row) => row.reason), ["snapshot_not_fresh", "snapshot_provider_mismatch", "campaign_id_missing"]);
    assert.doesNotMatch(JSON.stringify(report), /TOP_SECRET/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("real command runner enforces timeout without logging command output", async () => {
  const root = await fixture();
  try {
    const report = await runMarketplaceRefresh({
      workspaceRoot: path.join(root, "workspace"), now: NOW, timeoutMs: 30,
      config: { schemaVersion: 1, providers: [{ provider: "vyro", authorized: true, adapters: [{ command: executable, args: ["-e", "setTimeout(()=>{},10000); console.error('SECRET')"] }] }] },
    });
    assert.equal(report.status, "blocked");
    assert.equal(report.providers[0].attempts[0].reason, "adapter_timeout");
    assert.doesNotMatch(JSON.stringify(report), /SECRET/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("adapter environment cannot opt into paid-AI or billing credentials", async () => {
  const root = await fixture();
  const previous = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    CLIPPERS_MARKETPLACE_VYRO_SESSION_TOKEN: process.env.CLIPPERS_MARKETPLACE_VYRO_SESSION_TOKEN,
  };
  process.env.OPENAI_API_KEY = "must-not-pass";
  process.env.CLIPPERS_MARKETPLACE_VYRO_SESSION_TOKEN = "allowed-provider-session";
  try {
    const adapterScript = path.join(root, "adapter.mjs");
    await writeFile(adapterScript, `console.log(JSON.stringify({marketplace:"vyro",observedAt:"${NOW.toISOString()}",campaigns:[{id:"env-check",title:String(Boolean(process.env.OPENAI_API_KEY))+":"+String(Boolean(process.env.CLIPPERS_MARKETPLACE_VYRO_SESSION_TOKEN)),active:true,joined:true,expiresAt:"2026-08-20T12:00:00.000Z",rightsExpiresAt:"2026-08-20T12:00:00.000Z",sourceUrl:"https://media.example.test/source",rightsEvidencePath:"evidence-drop/marketplaces/campaign.md",evidenceVerified:true,compatibleAccounts:["streamersclipusa"],payoutCpm:2,minViewsPerPost:0}]}))`);
    const report = await runMarketplaceRefresh({
      workspaceRoot: path.join(root, "workspace"), now: NOW,
      config: { schemaVersion: 1, providers: [{ provider: "vyro", authorized: true, adapters: [{
        command: executable,
        args: [adapterScript],
        envAllowlist: ["OPENAI_API_KEY", "CLIPPERS_MARKETPLACE_VYRO_SESSION_TOKEN"],
      }] }] },
    });
    assert.equal(report.status, "ready");
    const stored = JSON.parse(await readFile(path.join(root, "workspace/research/marketplace-snapshots/vyro.json"), "utf8"));
    assert.equal(stored.campaigns[0].title, "false:true");
  } finally {
    if (previous.OPENAI_API_KEY === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previous.OPENAI_API_KEY;
    if (previous.CLIPPERS_MARKETPLACE_VYRO_SESSION_TOKEN === undefined) delete process.env.CLIPPERS_MARKETPLACE_VYRO_SESSION_TOKEN; else process.env.CLIPPERS_MARKETPLACE_VYRO_SESSION_TOKEN = previous.CLIPPERS_MARKETPLACE_VYRO_SESSION_TOKEN;
    await rm(root, { recursive: true, force: true });
  }
});

test("resolves a relative refresh config from the separate config root", async () => {
  const root = await fixture();
  const configRoot = path.join(root, "config");
  await mkdir(configRoot, { recursive: true });
  await writeFile(path.join(configRoot, "relative-refresh.json"), JSON.stringify({ schemaVersion: 1, providers: [] }));
  try {
    const report = await runMarketplaceRefresh({
      configRoot,
      workspaceRoot: root,
      configPath: "relative-refresh.json",
      now: NOW,
    });
    assert.equal(report.reason, "no_provider_refreshed");
    assert.equal(report.summary.configured, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
