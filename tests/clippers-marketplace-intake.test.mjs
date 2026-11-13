import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runMarketplaceIntake } from "../script/clippers-marketplace-intake.mjs";

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "clippers-marketplace-intake-"));
  await mkdir(path.join(root, "research", "marketplace-snapshots"), { recursive: true });
  await mkdir(path.join(root, "evidence-drop", "marketplaces"), { recursive: true });
  return root;
}

async function evidence(root, filename, { id, marketplace, sourceUrl }) {
  const relativePath = `evidence-drop/marketplaces/${filename}`;
  await writeFile(path.join(root, relativePath), [
    `Campaign ${id} on ${marketplace}.`,
    `Authorized source: ${sourceUrl}`,
    "The campaign brief grants transformation and publishing rights for this campaign on the compatible destination account.",
    "This is a locally captured rights record, not a placeholder.",
  ].join("\n").replace("not a placeholder", "completed evidence record"));
  return relativePath;
}

function campaign(overrides = {}) {
  return {
    id: "call-of-duty-streamer",
    title: "Call of Duty streamer clips",
    creator: "Call of Duty",
    active: true,
    joined: true,
    expiresAt: "2026-08-12T12:00:00.000Z",
    payoutCpm: 2,
    minViewsPerPost: 1000,
    sourceUrl: "https://assets.example.org/cod-authorized",
    compatibleAccounts: ["@streamersclipusa"],
    evidenceVerified: true,
    sourceFilesReady: 2,
    draftsReady: 1,
    requiredHashtags: ["#CallOfDuty", "#paidpartner"],
    ...overrides,
  };
}

test("normalizes fresh, joined, rights-verified local marketplace snapshots", async () => {
  const root = await fixture();
  try {
    const row = campaign();
    row.rightsEvidencePath = await evidence(root, "cod.md", { id: row.id, marketplace: "content_rewards", sourceUrl: row.sourceUrl });
    await writeFile(path.join(root, "research", "marketplace-snapshots", "content-rewards.json"), JSON.stringify({
      marketplace: "Content Rewards",
      observedAt: "2026-08-05T11:00:00.000Z",
      campaigns: [row],
    }));

    const report = await runMarketplaceIntake({ workspaceRoot: root, now: new Date("2026-08-05T12:00:00.000Z") });
    assert.equal(report.summary.accepted, 1);
    assert.equal(report.summary.productionReady, 1);
    assert.equal(report.costUsd, 0);
    assert.equal(report.networkAccessUsed, false);
    const output = JSON.parse(await readFile(path.join(root, "research", "paid-streamer-campaigns.json"), "utf8"));
    assert.equal(output[0].marketplace, "content_rewards");
    assert.equal(output[0].accountHandle, "streamersclipusa");
    assert.deepEqual(output[0].compatibleAccounts, ["streamersclipusa"]);
    assert.equal(output[0].rightsEvidencePath, row.rightsEvidencePath);
    assert.equal(output[0].rightsExpiresAt, "2026-08-12T12:00:00.000Z");
    assert.equal(output[0].expiresAt, "2026-08-12T12:00:00.000Z");
    assert.deepEqual(output[0].requiredHashtags, ["#CallOfDuty", "#paidpartner"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects stale, expired, unjoined, incompatible, and unverified campaigns with observable reasons", async () => {
  const root = await fixture();
  try {
    const validEvidence = await evidence(root, "shared.md", {
      id: "stale",
      marketplace: "vyro",
      sourceUrl: "https://assets.example.org/stale",
    });
    const rows = [
      campaign({ id: "stale", sourceUrl: "https://assets.example.org/stale", rightsEvidencePath: validEvidence }),
      campaign({ id: "expired", expiresAt: "2026-08-04T12:00:00.000Z", rightsEvidencePath: "missing.md" }),
      campaign({ id: "unjoined", joined: false, rightsEvidencePath: "missing.md" }),
      campaign({ id: "wrong-account", compatibleAccounts: ["otheraccount"], rightsEvidencePath: "missing.md" }),
      campaign({ id: "unverified", evidenceVerified: false, rightsEvidencePath: "missing.md" }),
    ];
    await writeFile(path.join(root, "research", "marketplace-snapshots", "vyro.json"), JSON.stringify({
      marketplace: "vyro",
      observedAt: "2026-08-01T00:00:00.000Z",
      campaigns: rows,
    }));
    const report = await runMarketplaceIntake({ workspaceRoot: root, now: new Date("2026-08-05T12:00:00.000Z"), maxSnapshotAgeHours: 48 });
    assert.equal(report.summary.accepted, 0);
    assert.equal(report.summary.rejected, 5);
    assert.ok(report.rejected.every((row) => row.blockers.includes("snapshot_stale")));
    assert.ok(report.rejected.find((row) => row.id === "expired").blockers.includes("campaign_expired"));
    assert.ok(report.rejected.find((row) => row.id === "unjoined").blockers.includes("campaign_not_joined"));
    assert.ok(report.rejected.find((row) => row.id === "wrong-account").blockers.includes("destination_account_incompatible"));
    assert.ok(report.rejected.find((row) => row.id === "unverified").blockers.includes("rights_evidence_not_attested"));
    const markdown = await readFile(path.join(root, "reports", "marketplace-supply-report.md"), "utf8");
    assert.match(markdown, /Campaigns accepted: 0/);
    assert.match(markdown, /snapshot_stale/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("deduplicates by marketplace and campaign id using the newest eligible snapshot", async () => {
  const root = await fixture();
  try {
    const older = campaign({ payoutCpm: 1 });
    older.rightsEvidencePath = await evidence(root, "older.md", { id: older.id, marketplace: "clipping", sourceUrl: older.sourceUrl });
    const newer = campaign({ payoutCpm: 3 });
    newer.rightsEvidencePath = await evidence(root, "newer.md", { id: newer.id, marketplace: "clipping", sourceUrl: newer.sourceUrl });
    await writeFile(path.join(root, "research", "marketplace-snapshots", "a.json"), JSON.stringify({ marketplace: "CLIPPING", observedAt: "2026-08-05T09:00:00Z", campaigns: [older] }));
    await writeFile(path.join(root, "research", "marketplace-snapshots", "b.json"), JSON.stringify({ marketplace: "clipping.net", observedAt: "2026-08-05T11:00:00Z", campaigns: [newer] }));
    const report = await runMarketplaceIntake({ workspaceRoot: root, now: new Date("2026-08-05T12:00:00Z") });
    assert.equal(report.summary.accepted, 1);
    assert.equal(report.summary.rejected, 1);
    assert.equal(report.accepted[0].payoutCpm, 3);
    assert.deepEqual(report.rejected[0].blockers, ["superseded_by_newer_snapshot"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("does not trust a path outside the workspace even when the snapshot attests rights", async () => {
  const root = await fixture();
  try {
    const row = campaign({ rightsEvidencePath: "/etc/hosts" });
    await writeFile(path.join(root, "research", "marketplace-snapshots", "whop.json"), JSON.stringify({
      marketplace: "whop",
      observedAt: "2026-08-05T11:00:00Z",
      campaigns: [row],
    }));
    const report = await runMarketplaceIntake({ workspaceRoot: root, now: new Date("2026-08-05T12:00:00Z") });
    assert.equal(report.summary.accepted, 0);
    assert.ok(report.rejected[0].blockers.includes("rights_evidence_file_missing_or_unsafe"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("keeps malformed snapshots observable without blocking valid local supply", async () => {
  const root = await fixture();
  try {
    const row = campaign();
    row.rightsEvidencePath = await evidence(root, "valid.md", { id: row.id, marketplace: "content_rewards", sourceUrl: row.sourceUrl });
    await writeFile(path.join(root, "research", "marketplace-snapshots", "broken.json"), "{not json");
    await writeFile(path.join(root, "research", "marketplace-snapshots", "empty.json"), JSON.stringify({ marketplace: "whop", campaigns: [] }));
    await writeFile(path.join(root, "research", "marketplace-snapshots", "valid.json"), JSON.stringify({
      marketplace: "content_rewards",
      observedAt: "2026-08-05T11:00:00Z",
      campaigns: [row],
    }));
    const report = await runMarketplaceIntake({ workspaceRoot: root, now: new Date("2026-08-05T12:00:00Z") });
    assert.equal(report.summary.snapshotsRead, 3);
    assert.equal(report.summary.accepted, 1);
    assert.ok(report.rejected.some((item) => item.blockers.includes("snapshot_json_invalid")));
    assert.ok(report.rejected.some((item) => item.blockers.includes("snapshot_campaigns_missing")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("does not follow a marketplace snapshot symlink outside the workspace", async () => {
  const root = await fixture();
  const external = await mkdtemp(path.join(os.tmpdir(), "clippers-external-snapshot-"));
  try {
    const externalPath = path.join(external, "external.json");
    await writeFile(externalPath, JSON.stringify({ marketplace: "vyro", observedAt: "2026-08-05T11:00:00Z", campaigns: [campaign()] }));
    await symlink(externalPath, path.join(root, "research", "marketplace-snapshots", "linked.json"));
    const report = await runMarketplaceIntake({ workspaceRoot: root, now: new Date("2026-08-05T12:00:00Z") });
    assert.equal(report.summary.accepted, 0);
    assert.deepEqual(report.rejected[0].blockers, ["snapshot_file_missing_or_unsafe"]);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(external, { recursive: true, force: true });
  }
});
