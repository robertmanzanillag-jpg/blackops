import assert from "node:assert/strict";
import { access, mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { mock, test } from "node:test";
import { promises as dns } from "node:dns";
import path from "node:path";
import { __clipperInternals, bootstrapClipperAccounts, bootstrapClipperWorkspace, buildClipperConnectActions, getClipperStatus, importClipperCredentialDropFiles, importClipperLaunchEvidenceDropFiles, importClipperMetricoolApprovalEvidence, importClipperSourceDropFiles, ingestClipperMetrics, ingestClipperTrends, prepareClipper100ClipsExecutionSprint, prepareClipperAccountCreationPack, prepareClipperAccountEvidenceVault, prepareClipperAccountIdentityKit, prepareClipperAccountLaunchKit, prepareClipperAccountSetupSession, prepareClipperAnalyticsReportingPack, prepareClipperAppReviewDemoPack, prepareClipperAppReviewSubmissionPack, prepareClipperAutomationSchedule, prepareClipperBlockerResolutionPack, prepareClipperCredentialDoctor, prepareClipperCredentialDropStarter, prepareClipperCredentialSetupCenter, prepareClipperDeveloperAppEvidenceVault, prepareClipperDeveloperApplicationDrafts, prepareClipperDraftSpecs, prepareClipperDriveWorkspace, prepareClipperDropzoneReadyPack, prepareClipperExternalAccountPermissionSprint, prepareClipperExternalExecutionHandoff, prepareClipperExternalExecutionSession, prepareClipperExternalLaunchDossier, prepareClipperExternalSetupQueue, prepareClipperGoLiveAutopilotBrief, prepareClipperGoLiveCompletionAudit, prepareClipperGoLiveOperatorBrief, prepareClipperGoLiveEvidenceBundle, prepareClipperGoLiveExecutionPack, prepareClipperHttpsTunnelPlan, prepareClipperIntakeKit, prepareClipperLaunchCommandCenter, prepareClipperLaunchEvidenceFixPack, prepareClipperLegalPolicyPack, prepareClipperManualPostingPack, prepareClipperMetricoolApprovalReport, prepareClipperMetricoolApprovalSession, prepareClipperMetricoolExecutionQueue, prepareClipperMetricoolMvpLaunchPack, prepareClipperMetricoolPublishingPlan, prepareClipperOAuthConnectionPack, prepareClipperOAuthGoLivePreflight, prepareClipperOfficialPermissionMatrix, prepareClipperOwnerConnectPack, prepareClipperPermissionPack, prepareClipperPermissionRequestPack, prepareClipperPermissionSubmissionDossier, prepareClipperPermissionTracker, prepareClipperPlatformPortalChecklist, prepareClipperPlatformReadinessMatrix, prepareClipperProductionQueue, prepareClipperProductionUrlSetup, prepareClipperPublisherConnectors, prepareClipperPublisherExecutionQueue, prepareClipperPublishingPackage, prepareClipperRightsEvidenceLedger, prepareClipperRightsOutreachPack, prepareClipperRobertNextActions, prepareClipperSourceAcquisitionPlan, prepareClipperSourceDiscoveryHandoff, prepareClipperSourceHuntSheet, prepareClipperSourceIngestionSprint, prepareClipperSourceScout, prepareClipperSourceScoutDailySprint, prepareClipperSourceScoutExactUrlKit, prepareClipperSourceScoutPermissionPack, prepareClipperSourceScoutSourceFileKit, prepareClipperSourceScoutWorkQueue, prepareClipperSourceSupplyDropKit, prepareClipperTrendRightsOutreachPack, prepareClipperViralDiscoveryPack, prepareClipperWeeklyProductionFunnel, previewClipperCredentialSecretsBatch, previewClipperLaunchEvidenceBatch, recordClipperAccountEvidence, recordClipperCredentialSecret, recordClipperCredentialSecretsBatch, recordClipperDeveloperAppEvidence, recordClipperLaunchEvidenceBatch, recordClipperMetricoolAccountEvidence, recordClipperOAuthCallback, recordClipperOwnerConnectProgress, recordClipperPermissionStatus, recordClipperProductionPublicUrl, recordClipperSourceIntakeBatch, recordClipperSourceRights, recordClipperSourceScoutIntake, recordClipperTrendCandidatesBatch, reloadClipperCredentials, renderClipperDraftVideos, runClipperAutomationCycle, runClipperDailyPlan, runClipperExternalConnectAutopilot, runClipperGoLiveAutopilot, runClipperGoLivePrepSweep, runClipperIntakeRefreshSweep, runClipperLocalDropSync, runClipperPostConnectActivationSweep, saveClipperTokenPayload, verifyClipperProductionLocalPreflight, verifyClipperProductionUrl } from "../server/clippers-agent";
import { buildClipperExternalCloseoutBatchCopyPacket, buildClipperExternalCloseoutEvidenceCsvTemplate, buildClipperExternalCloseoutNextActionCopyPacket, buildClipperExternalCloseoutSprintSummary, enrichClipperExternalCloseoutOperatorRows } from "../server/routes";

const GOOGLE_OAUTH_ALIAS_ENV_VARS = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH2_CLIENT_ID",
  "GOOGLE_WEB_CLIENT_ID",
  "GOOGLE_DRIVE_CLIENT_ID",
  "GOOGLE_DRIVE_OAUTH_CLIENT_ID",
  "GOOGLE_DRIVE_OAUTH2_CLIENT_ID",
  "GOOGLE_DRIVE_WEB_CLIENT_ID",
  "YOUTUBE_CLIENT_ID",
  "YOUTUBE_OAUTH_CLIENT_ID",
  "YOUTUBE_OAUTH2_CLIENT_ID",
  "YOUTUBE_WEB_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "GOOGLE_OAUTH2_CLIENT_SECRET",
  "GOOGLE_WEB_CLIENT_SECRET",
  "GOOGLE_DRIVE_CLIENT_SECRET",
  "GOOGLE_DRIVE_OAUTH_CLIENT_SECRET",
  "GOOGLE_DRIVE_OAUTH2_CLIENT_SECRET",
  "GOOGLE_DRIVE_WEB_CLIENT_SECRET",
  "YOUTUBE_CLIENT_SECRET",
  "YOUTUBE_OAUTH_CLIENT_SECRET",
  "YOUTUBE_OAUTH2_CLIENT_SECRET",
  "YOUTUBE_WEB_CLIENT_SECRET",
  "GOOGLE_DRIVE_REFRESH_TOKEN",
  "GOOGLE_REFRESH_TOKEN",
  "GOOGLE_OAUTH_REFRESH_TOKEN",
  "GOOGLE_OAUTH2_REFRESH_TOKEN",
  "YOUTUBE_REFRESH_TOKEN",
  "YOUTUBE_OAUTH_REFRESH_TOKEN",
  "YOUTUBE_OAUTH2_REFRESH_TOKEN",
];

const testClipperWorkspaceRoot = path.join(process.cwd(), "clippers_workspace");
let testClipperWorkspaceBackupPath: string | null = null;

async function pathExists(filePath: string) {
  return access(filePath).then(() => true, () => false);
}

test.before(async () => {
  if (!(await pathExists(testClipperWorkspaceRoot))) return;
  testClipperWorkspaceBackupPath = path.join(process.cwd(), `.clippers_workspace.agent-test-backup-${process.pid}-${Date.now()}`);
  await rename(testClipperWorkspaceRoot, testClipperWorkspaceBackupPath);
});

test.after(async () => {
  await rm(testClipperWorkspaceRoot, { recursive: true, force: true });
  if (testClipperWorkspaceBackupPath && await pathExists(testClipperWorkspaceBackupPath)) {
    await rename(testClipperWorkspaceBackupPath, testClipperWorkspaceRoot);
  }
});

function snapshotEnv(names: string[]): Record<string, string | undefined> {
  return Object.fromEntries(names.map((name) => [name, process.env[name]]));
}

function clearEnv(names: string[]) {
  for (const name of names) delete process.env[name];
}

function restoreEnv(snapshot: Record<string, string | undefined>) {
  for (const [name, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

function writeTinyTestVideo(outputPath: string) {
  const result = spawnSync("ffmpeg", [
    "-y",
    "-f", "lavfi",
    "-i", "color=c=blue:s=720x1280:d=1",
    "-f", "lavfi",
    "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
    "-shortest",
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    outputPath,
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  appendFileSync(outputPath, Buffer.alloc(12 * 1024));
}

async function prepareMetricoolOwnedSourceFixtures() {
  const rootDir = path.join(process.cwd(), "clippers_workspace");
  const sourceDropDir = path.join(rootDir, "source-drop");
  const allowlistDir = path.join(rootDir, "allowlist");
  const seedVideoPath = path.join(rootDir, "test-fixtures", "metricool-owned-seed.mp4");
  await mkdir(path.dirname(seedVideoPath), { recursive: true });
  if (!(await stat(seedVideoPath).then((file) => file.isFile()).catch(() => false))) {
    writeTinyTestVideo(seedVideoPath);
  }
  const seedVideo = await readFile(seedVideoPath);
  const categories = [
    {
      category: "sports",
      prefix: "sports-owned",
      count: 30,
      evidenceFileName: "owned-sports-production-notes.md",
      accountLabel: "Sports Daily",
      restrictions: "no league footage, broadcast footage, team footage, athlete likenesses, copyrighted music, scraped highlights, or platform-private material",
    },
    {
      category: "memes",
      prefix: "memes-owned",
      count: 34,
      evidenceFileName: "owned-meme-production-notes-v2.md",
      accountLabel: "Meme Radar",
      restrictions: "no third-party footage, creator clips, sports broadcasts, streamer clips, licensed music, watermarked reposts, or platform-private material",
    },
  ];

  await mkdir(allowlistDir, { recursive: true });
  for (const fixture of categories) {
    const categoryDir = path.join(sourceDropDir, fixture.category);
    const sourcesCategoryDir = path.join(rootDir, "sources", fixture.category);
    await mkdir(categoryDir, { recursive: true });
    await mkdir(sourcesCategoryDir, { recursive: true });
    const evidencePath = path.join(categoryDir, fixture.evidenceFileName);
    const firstFile = `${fixture.prefix}-01.mp4`;
    const lastFile = `${fixture.prefix}-${String(fixture.count).padStart(2, "0")}.mp4`;
    await writeFile(evidencePath, [
      "status: owned_source",
      `Owned source generated locally for ${fixture.accountLabel}; source videos are original generated material.`,
      `${firstFile} through ${lastFile} are covered by this production note.`,
      `Restrictions: ${fixture.restrictions}.`,
      "No third-party footage, no league footage, no raw streamer clips, no copyrighted music, no broadcast footage, no scraped footage.",
      "created_by: local clippers test fixture",
      "",
    ].join("\n"));
    const manifestRows = ["target_file_name,rights_status,evidence_link"];
    for (let index = 1; index <= fixture.count; index += 1) {
      const fileName = `${fixture.prefix}-${String(index).padStart(2, "0")}.mp4`;
      const sourcePath = path.join(categoryDir, fileName);
      const productionSourcePath = path.join(sourcesCategoryDir, fileName);
      await writeFile(sourcePath, seedVideo);
      await writeFile(productionSourcePath, seedVideo);
      manifestRows.push(`${fileName},owned_or_permissioned,owner note path: ${evidencePath}`);
      await writeFile(path.join(allowlistDir, `${path.parse(fileName).name}.md`), [
        `# Source Rights Evidence: ${fileName}`,
        "",
        "status: owned_or_permissioned",
        `category: ${fixture.category}`,
        `asset_id: owned-source:${fixture.category}:${fileName}`,
        `source_path: ${sourcePath}`,
        "source: test-source-drop-manifest",
        `manifest_evidence_path: ${evidencePath}`,
        `resolved_evidence_path: ${evidencePath}`,
        "",
        "Notes:",
        [
          `Owned source generated locally for ${fixture.accountLabel};`,
          `owner note path ${evidencePath};`,
          `${fixture.restrictions};`,
          `asset ${fileName};`,
          "approved only for draft creation and Metricool approval_required queue review.",
        ].join(" "),
        "",
      ].join("\n"));
    }
    await writeFile(path.join(categoryDir, "source-drop-manifest.csv"), `${manifestRows.join("\n")}\n`);
  }
}

test("normalizeRunOptions clamps clips and defaults publish mode", () => {
  const result = __clipperInternals.normalizeRunOptions({
    clipsPerAccount: 999,
    publishMode: "anything",
    riskTolerance: "wild",
  });

  assert.equal(result.clipsPerAccount, 50);
  assert.equal(result.publishMode, "approval_required");
  assert.equal(result.riskTolerance, "growth");
});

test("external closeout next action copy packet guides proof without requesting secrets", () => {
  const packet = buildClipperExternalCloseoutNextActionCopyPacket({
    id: "developer_app:instagram",
    lane: "developer_app",
    priority: "critical",
    platform: "instagram",
    accountId: "",
    scope: "",
    proofPath: "/tmp/external-closeout-proofs/developer_app-instagram.md",
    requiredCsvStatus: "submitted",
    missingCsvFields: ["app_identifier", "proof"],
    portalUrl: "https://developers.facebook.com/",
    redirectUri: "https://app.clipprreview.com/api/clippers/oauth/instagram/callback",
    operatorAction: "Open instagram developer portal and submit the app.",
    csvEditHint: "Set status to submitted and fill app_identifier and proof.",
    blockers: ["fill app_identifier from the developer portal"],
  });

  assert.match(packet, /Next external action: developer_app:instagram/);
  assert.match(packet, /Redirect URI \/ callback to register: https:\/\/app\.clipprreview\.com\/api\/clippers\/oauth\/instagram\/callback/);
  assert.match(packet, /Public app\/account identifier: <paste public id only, never client secret>/);
  assert.match(packet, /app_identifier=<public app id if this is a developer app>/);
  assert.match(packet, /proof=<proof URL, ticket ID or local proof file path>/);
  assert.match(packet, /Metricool stays approval_required/);
  assert.doesNotMatch(packet, /client_secret=/i);
  assert.doesNotMatch(packet, /oauth_token=/i);
});

test("external closeout operator rows regenerate copy packets instead of trusting persisted text", () => {
  const [row] = enrichClipperExternalCloseoutOperatorRows([{
    id: "developer_app:tiktok",
    lane: "developer_app",
    platform: "tiktok",
    accountId: "",
    scope: "",
    proofPath: "/tmp/external-closeout-proofs/developer_app-tiktok.md",
    requiredCsvStatus: "submitted",
    missingCsvFields: ["app_identifier", "proof"],
    portalUrl: "https://developers.tiktok.com/",
    redirectUri: "https://app.clipprreview.com/api/clippers/oauth/tiktok/callback",
    operatorAction: "Create TikTok developer app and capture proof.",
    csvEditHint: "Fill submitted evidence only after real portal action.",
    copyPacket: "READY TO PUBLISH WITH SECRET client_secret=abc",
  }]);

  assert.match(row.copyPacket, /Next external action: developer_app:tiktok/);
  assert.match(row.copyPacket, /Metricool stays approval_required/);
  assert.doesNotMatch(row.copyPacket, /READY TO PUBLISH/i);
  assert.doesNotMatch(row.copyPacket, /client_secret=abc/i);
});

test("external closeout batch copy packet combines safe regenerated operator packets", () => {
  const packet = buildClipperExternalCloseoutBatchCopyPacket([
    {
      id: "developer_app:instagram",
      lane: "developer_app",
      platform: "instagram",
      accountId: "",
      scope: "",
      proofPath: "/tmp/external-closeout-proofs/developer_app-instagram.md",
      requiredCsvStatus: "submitted",
      missingCsvFields: ["app_identifier", "proof"],
      portalUrl: "https://developers.facebook.com/",
      redirectUri: "https://app.clipprreview.com/api/clippers/oauth/instagram/callback",
      operatorAction: "Create Instagram developer app and capture proof.",
      csvEditHint: "Fill submitted evidence only after real portal action.",
    },
    {
      id: "permission:tiktok:video.upload",
      lane: "permission",
      platform: "tiktok",
      accountId: "sports-daily",
      scope: "video.upload",
      proofPath: "/tmp/external-closeout-proofs/permission-tiktok-video.upload.md",
      requiredCsvStatus: "requested",
      missingCsvFields: ["proof"],
      portalUrl: "https://developers.tiktok.com/",
      redirectUri: "https://app.clipprreview.com/api/clippers/oauth/tiktok/callback",
      operatorAction: "Request TikTok video.upload permission and capture proof.",
      csvEditHint: "Fill requested evidence only after real portal action.",
      copyPacket: "READY TO PUBLISH client_secret=abc",
    },
  ]);

  assert.match(packet, /Clippers External Closeout Batch Packet/);
  assert.match(packet, /Actions: 2/);
  assert.match(packet, /--- Action 1: developer_app:instagram ---/);
  assert.match(packet, /--- Action 2: permission:tiktok:video.upload ---/);
  assert.match(packet, /Metricool stays approval_required/);
  assert.doesNotMatch(packet, /READY TO PUBLISH/i);
  assert.doesNotMatch(packet, /client_secret=abc/i);
});

test("external closeout evidence CSV template keeps placeholders explicit and safe", () => {
  const csv = buildClipperExternalCloseoutEvidenceCsvTemplate([
    {
      id: "developer_app:instagram",
      lane: "developer_app",
      platform: "instagram",
      accountId: "",
      scope: "",
      proofPath: "/tmp/external-closeout-proofs/developer_app-instagram.md",
      requiredCsvStatus: "submitted",
      missingCsvFields: ["app_identifier", "proof"],
      portalUrl: "https://developers.facebook.com/",
      redirectUri: "https://app.clipprreview.com/api/clippers/oauth/instagram/callback",
      operatorAction: "Create Instagram developer app and capture proof.",
      csvEditHint: "Fill submitted evidence only after real portal action.",
    },
    {
      id: "account:sports-daily:youtube",
      lane: "account",
      platform: "youtube",
      accountId: "sports-daily",
      proofPath: "/tmp/external-closeout-proofs/account-sports-daily-youtube.md",
      requiredCsvStatus: "verified",
      missingCsvFields: ["proof"],
      portalUrl: "https://www.youtube.com/create_channel?name=Sports, \"Daily\"",
      operatorAction: "Verify YouTube account ownership and capture proof.",
      csvEditHint: "Fill verified evidence only after real portal action.",
    },
    {
      id: "developer_app:localhost-https",
      lane: "developer_app",
      platform: "instagram",
      proofPath: "/tmp/external-closeout-proofs/developer_app-localhost.md",
      requiredCsvStatus: "submitted",
      missingCsvFields: ["app_identifier", "proof"],
      portalUrl: "https://developers.facebook.com/apps/123",
      redirectUri: "https://localhost:5010/api/clippers/oauth/instagram/callback",
      operatorAction: "Localhost redirect should not prefill public base URL.",
      csvEditHint: "Replace with production HTTPS redirect before import.",
    },
    {
      id: "developer_app:private-ip",
      lane: "developer_app",
      platform: "tiktok",
      proofPath: "/tmp/external-closeout-proofs/developer_app-private.md",
      requiredCsvStatus: "submitted",
      missingCsvFields: ["app_identifier", "proof"],
      portalUrl: "https://developers.tiktok.com/",
      redirectUri: "https://10.0.0.2/callback",
      operatorAction: "Private redirect should not prefill public base URL.",
      csvEditHint: "Replace with production HTTPS redirect before import.",
    },
    {
      id: "developer_app:loopback-range",
      lane: "developer_app",
      platform: "instagram",
      proofPath: "/tmp/external-closeout-proofs/developer_app-loopback-range.md",
      requiredCsvStatus: "submitted",
      missingCsvFields: ["app_identifier", "proof"],
      portalUrl: "https://developers.facebook.com/",
      redirectUri: "https://127.0.0.2/callback",
      operatorAction: "Loopback redirect range should not prefill public base URL.",
      csvEditHint: "Replace with production HTTPS redirect before import.",
    },
    {
      id: "developer_app:loopback-ipv6",
      lane: "developer_app",
      platform: "youtube",
      proofPath: "/tmp/external-closeout-proofs/developer_app-ipv6.md",
      requiredCsvStatus: "submitted",
      missingCsvFields: ["app_identifier", "proof"],
      portalUrl: "https://console.cloud.google.com/apis/library/youtube.googleapis.com",
      redirectUri: "https://[::1]/callback",
      operatorAction: "IPv6 loopback redirect should not prefill public base URL.",
      csvEditHint: "Replace with production HTTPS redirect before import.",
    },
    {
      id: "developer_app:link-local",
      lane: "developer_app",
      platform: "youtube",
      proofPath: "/tmp/external-closeout-proofs/developer_app-link-local.md",
      requiredCsvStatus: "submitted",
      missingCsvFields: ["app_identifier", "proof"],
      portalUrl: "https://console.cloud.google.com/apis/library/youtube.googleapis.com",
      redirectUri: "https://169.254.1.1/callback",
      operatorAction: "Link-local redirect should not prefill public base URL.",
      csvEditHint: "Replace with production HTTPS redirect before import.",
    },
  ]);

  assert.ok(csv.startsWith("kind,account_id,platform,status,scope,app_identifier,public_base_url,redirect_uri,portal_url,docs_url,proof,notes\n"));
  assert.match(csv, /"developer_app","","instagram","submitted","","<public instagram app id>","https:\/\/app\.clipprreview\.com","https:\/\/app\.clipprreview\.com\/api\/clippers\/oauth\/instagram\/callback"/);
  assert.match(csv, /"account","sports-daily","youtube","verified","","","","","https:\/\/www\.youtube\.com\/create_channel\?name=Sports, ""Daily"""/);
  assert.match(csv, /"developer_app","","instagram","submitted","","<public instagram app id>","","https:\/\/localhost:5010\/api\/clippers\/oauth\/instagram\/callback"/);
  assert.match(csv, /"developer_app","","tiktok","submitted","","<public tiktok app id>","","https:\/\/10\.0\.0\.2\/callback"/);
  assert.match(csv, /"developer_app","","instagram","submitted","","<public instagram app id>","","https:\/\/127\.0\.0\.2\/callback"/);
  assert.match(csv, /"developer_app","","youtube","submitted","","<public youtube app id>","","https:\/\/\[::1\]\/callback"/);
  assert.match(csv, /"developer_app","","youtube","submitted","","<public youtube app id>","","https:\/\/169\.254\.1\.1\/callback"/);
  assert.match(csv, /"<replace with 20\+ char real operator note for developer_app:instagram>"/);
  assert.doesNotMatch(csv, /client_secret=/i);
  assert.doesNotMatch(csv, /oauth_token=/i);
});

test("external closeout sprint summary prioritizes real critical portal actions", () => {
  const summary = buildClipperExternalCloseoutSprintSummary([
    {
      id: "account:sports-daily:youtube",
      lane: "account",
      priority: "high",
      platform: "youtube",
      operatorAction: "Verify YouTube ownership.",
    },
    {
      id: "developer_app:instagram",
      lane: "developer_app",
      priority: "critical",
      platform: "instagram",
      operatorAction: "Create Instagram developer app and capture proof.",
    },
    {
      id: "permission:instagram:instagram_content_publish",
      lane: "permission",
      priority: "critical",
      platform: "instagram",
      scope: "instagram_content_publish",
      operatorAction: "Request Instagram publish permission.",
    },
  ]);

  assert.equal(summary.totalActions, 3);
  assert.equal(summary.criticalActions, 2);
  assert.equal(summary.highActions, 1);
  assert.equal(summary.developerApps, 1);
  assert.equal(summary.permissions, 1);
  assert.equal(summary.accountProofs, 1);
  assert.equal(summary.criticalDeveloperApps, 1);
  assert.equal(summary.criticalPermissions, 1);
  assert.equal(summary.firstActionId, "developer_app:instagram");
  assert.equal(summary.platformRows.length, 2);
  assert.equal(summary.platformRows[0].platform, "instagram");
  assert.equal(summary.platformRows[0].totalActions, 2);
  assert.equal(summary.platformRows[0].criticalActions, 2);
  assert.equal(summary.platformRows[0].developerApps, 1);
  assert.equal(summary.platformRows[0].permissions, 1);
  assert.equal(summary.platformRows[0].firstActionId, "developer_app:instagram");
  assert.match(summary.platformRows[0].nextStep, /Instagram developer app/);
  assert.equal(summary.platformRows[1].platform, "youtube");
  assert.equal(summary.platformRows[1].accountProofs, 1);
  assert.match(summary.nextStep, /developer_app:instagram/);
  assert.ok(summary.safety.some((item) => item.includes("Metricool remains approval_required")));
});

test("external closeout evidence importer blocks copied CSV template before apply", async () => {
  const evidenceCsvPath = path.join(process.cwd(), "clippers_workspace", "evidence-drop", "external-closeout-evidence-import.csv");
  const reportJsonPath = path.join(process.cwd(), "clippers_workspace", "reports", "clippers-external-closeout-evidence-import-report.json");
  const reportMarkdownPath = path.join(process.cwd(), "clippers_workspace", "reports", "clippers-external-closeout-evidence-import-report.md");
  const reportCsvPath = path.join(process.cwd(), "clippers_workspace", "reports", "clippers-external-closeout-evidence-import-report.csv");
  const previousEvidenceCsv = await readFile(evidenceCsvPath, "utf8").catch(() => null);
  const previousReportJson = await readFile(reportJsonPath, "utf8").catch(() => null);
  const previousReportMarkdown = await readFile(reportMarkdownPath, "utf8").catch(() => null);
  const previousReportCsv = await readFile(reportCsvPath, "utf8").catch(() => null);
  const template = buildClipperExternalCloseoutEvidenceCsvTemplate([
    {
      id: "developer_app:tiktok",
      lane: "developer_app",
      platform: "tiktok",
      proofPath: "clippers_workspace/evidence-drop/external-closeout-proofs/developer_app-tiktok.md",
      requiredCsvStatus: "submitted",
      missingCsvFields: ["app_identifier", "proof"],
      portalUrl: "https://developers.tiktok.com/",
      redirectUri: "https://app.clipprreview.com/api/clippers/oauth/tiktok/callback",
      operatorAction: "Create TikTok developer app and capture proof.",
      csvEditHint: "Fill submitted evidence only after real portal action.",
    },
  ]);

  try {
    const closeoutPack = spawnSync(process.execPath, ["script/clippers-external-closeout-pack.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(closeoutPack.status, 0, closeoutPack.stderr || closeoutPack.stdout);
    await mkdir(path.dirname(evidenceCsvPath), { recursive: true });
    await writeFile(evidenceCsvPath, template);
    const result = spawnSync(process.execPath, ["--import", "tsx", "script/clippers-import-external-closeout-evidence.ts"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(await readFile(reportJsonPath, "utf8"));
    assert.equal(report.status, "blocked_invalid_evidence");
    assert.equal(report.totals.accepted, 0);
    assert.equal(report.totals.applied, 0);
    assert.ok(report.totals.rejected > 0);
    assert.match(JSON.stringify(report.rejected), /app_identifier|placeholder|proof/i);
    assert.ok(report.repairQueue.length > 0);
    assert.equal(report.repairQueue[0].closeoutId, "developer_app:tiktok");
    assert.match(report.repairQueue[0].proofPath, /developer_app-tiktok\.md$/);
    assert.match(report.repairQueue[0].nextStep, /preview again/i);
    assert.match(report.repairQueue[0].safeProofStarter, /never client secret/i);
    assert.doesNotMatch(JSON.stringify(report.repairQueue), /access_token=|refresh_token=|client_secret=|password=|cookie=|sk-[A-Za-z0-9_-]{12,}/i);
    const rawMarkdown = await readFile(reportMarkdownPath, "utf8");
    const rawCsv = await readFile(reportCsvPath, "utf8");
    assert.match(rawMarkdown, /## Repair Queue/);
    assert.match(rawCsv, /repair/);
  } finally {
    if (previousEvidenceCsv === null) await unlink(evidenceCsvPath).catch(() => undefined);
    else await writeFile(evidenceCsvPath, previousEvidenceCsv);
    if (previousReportJson === null) await unlink(reportJsonPath).catch(() => undefined);
    else await writeFile(reportJsonPath, previousReportJson);
    if (previousReportMarkdown === null) await unlink(reportMarkdownPath).catch(() => undefined);
    else await writeFile(reportMarkdownPath, previousReportMarkdown);
    if (previousReportCsv === null) await unlink(reportCsvPath).catch(() => undefined);
    else await writeFile(reportCsvPath, previousReportCsv);
  }
});

test("runClipperDailyPlan creates drafts for each configured account", async () => {
  const userId = "clipper-owner-a";
  const { report, status } = await runClipperDailyPlan({
    clipsPerAccount: 2,
    publishMode: "draft_only",
    riskTolerance: "safe",
  }, userId);

  assert.equal(report.userId, userId);
  assert.equal(report.publishMode, "draft_only");
  assert.equal(report.riskTolerance, "safe");
  assert.equal(report.plannedClips.length, status.accounts.length * 2);
  assert.ok(report.nextActions.some((action) => action.includes("TikTok")));
});

test("getClipperStatus exposes guarded growth goals", async () => {
  const status = await getClipperStatus();

  assert.ok(status.goals.totalWeeklyGoal >= 3_000_000);
  assert.ok(status.guardrails.some((rule) => rule.includes("licenciado")));
  assert.ok(status.agents.some((agent) => agent.id === "rights-gate"));
  assert.ok(status.agents.some((agent) => agent.id === "local-news-scout" && agent.status === "active"));
  assert.ok(status.sources.some((source) => source.id === "local-news-official-feeds" && source.type === "official_api"));
  assert.ok(status.growthAudit.score >= 0 && status.growthAudit.score <= 100);
  const metricsLoop = status.growthAudit.items.find((item) => item.id === "metrics-loop");
  assert.ok(metricsLoop);
  assert.ok(["critical", "warning", "ready"].includes(metricsLoop.status));
  assert.ok(metricsLoop.label.toLowerCase().includes("metric"));
  assert.ok(status.growthAudit.items.some((item) => item.id === "google-drive-workspace"));
  assert.ok(status.growthAudit.roadmap.some((step) => step.includes("metricas")));
  assert.ok(["missing_keys", "needs_oauth", "ready", "error"].includes(status.driveWorkspace.status));
  assert.ok(status.driveWorkspace.envDiagnostics.envFilesChecked.includes("CEO_ASSISTANT_ENV"));
  assert.ok(status.driveWorkspace.envDiagnostics.envFilesChecked.includes(".env.development"));
  assert.ok(status.driveWorkspace.envDiagnostics.acceptedClientIdAliases.includes("GOOGLE_CLIENT_ID"));
  assert.ok(Array.isArray(status.driveWorkspace.envDiagnostics.envFilesWithAcceptedAliases));
  assert.equal(status.driveWorkspace.oauthSetup.authPath, "/api/google-drive/auth");
  assert.equal(status.driveWorkspace.oauthSetup.callbackPath, "/api/google-drive/oauth/callback");
  assert.ok(status.driveWorkspace.oauthSetup.recommendedRedirectUris.some((uri) => uri.includes("/api/google-drive/oauth/callback")));
  assert.ok(status.driveWorkspace.oauthSetup.scopes.includes("https://www.googleapis.com/auth/drive.file"));
  assert.ok(status.driveWorkspace.folders.some((folder) => folder.id === "metrics-inbox"));
  assert.ok(status.driveWorkspace.envDiagnostics.credentialTemplatePath.endsWith("google-drive-env-template.env"));
  assert.ok(status.driveWorkspace.envDiagnostics.requiredEnvTemplateRows.includes("GOOGLE_CLIENT_ID="));
  assert.ok(status.metrics.metricsDir.endsWith("metrics"));
  assert.ok(status.analyticsReportingPack.metricsDir.endsWith("metrics"));
  assert.ok(status.analyticsReportingPack.importTemplate.startsWith("account_id,platform,clip_id,hook"));
  assert.ok(status.growthAudit.items.some((item) => item.id === "analytics-reporting-pack"));
  assert.ok(status.commandCenter.steps.some((step) => step.id === "analytics-reporting-pack"));
  assert.ok(status.trendRadar.trendsDir.endsWith("trends"));
  assert.ok(status.growthAudit.items.some((item) => item.id === "trend-radar"));
  assert.ok(status.automationSchedule.manifestPath.endsWith("automation-schedule.json"));
  assert.equal(status.budgetPlanner.targetWeeklyClips, 100);
  assert.equal(status.budgetPlanner.recommendedScenarioId, "growth");
  assert.ok(status.budgetPlanner.scenarios.some((scenario) => scenario.id === "growth" && scenario.weeklyCostLow > 0));
  assert.equal(status.accountLaunchKit.tasks.length, status.accounts.length * 3);
  assert.ok(status.growthAudit.items.some((item) => item.id === "account-launch-kit"));
  assert.equal(status.accountEvidence.totals.expected, status.accounts.length * 3);
  assert.ok(status.growthAudit.items.some((item) => item.id === "account-evidence"));
  assert.equal(status.developerAppEvidence.totals.expected, 3);
  assert.ok(status.growthAudit.items.some((item) => item.id === "developer-app-evidence"));
  assert.ok(status.commandCenter.steps.some((step) => step.id === "external-accounts"));
  assert.ok(status.commandCenter.steps.some((step) => step.id === "developer-apps"));
  assert.ok(status.commandCenter.steps.some((step) => step.id === "credential-setup"));
  assert.ok(status.commandCenter.steps.some((step) => step.id === "intake-kit"));
  assert.ok(status.credentialSetup.items.some((item) => item.id === "google-youtube-oauth"));
  assert.ok(status.intakeKit.files.some((file) => file.id === "trend-opportunities"));
  assert.equal(status.permissionTracker.items.length, status.permissionQueue.length);
  assert.ok(status.permissionTracker.officialSources.some((source) => source.includes("developers.tiktok.com")));
  assert.ok(status.growthAudit.items.some((item) => item.id === "permission-tracker"));
  assert.ok(status.growthAudit.items.some((item) => item.id === "oauth-connection-pack"));
  assert.ok(status.commandCenter.steps.some((step) => step.id === "oauth-connection-pack"));
  assert.ok(status.commandCenter.steps.some((step) => step.id === "publishing-package"));
  assert.ok(status.growthAudit.items.some((item) => item.id === "publishing-package"));
  assert.equal(status.publishingPackage.manifestPath.endsWith("publishing-package.json"), true);
  assert.ok(["not_run", "pass", "partial", "fail"].includes(status.productionLocalPreflight.status));
  assert.ok(status.productionLocalPreflight.markdownPath.endsWith("production-local-preflight.md"));
  assert.ok(["not_prepared", "blocked", "ready"].includes(status.sourceDiscoveryHandoff.status));
  assert.ok(status.sourceDiscoveryHandoff.markdownPath.endsWith("source-discovery-handoff.md"));
  assert.ok(["not_prepared", "needs_files", "needs_metadata", "needs_rights", "ready_to_import", "ready"].includes(status.sourceIngestionSprint.status));
  assert.ok(status.sourceIngestionSprint.markdownPath.endsWith("source-ingestion-sprint.md"));
  assert.ok(["clean", "blocked"].includes(status.evidenceIntegrityAudit.status));
  assert.ok(status.evidenceIntegrityAudit.manifestPath.endsWith("evidence-integrity-audit.json"));
  assert.ok(status.evidenceIntegrityAudit.markdownPath.endsWith("evidence-integrity-audit.md"));
  assert.ok(status.evidenceIntegrityAudit.csvPath.endsWith("evidence-integrity-audit.csv"));
  assert.ok(status.goLiveCompletionAudit.requirements.some((item) => item.id === "evidence-integrity-clean"));
  assert.ok(status.goLiveCompletionAudit.requirements.some((item) => item.id === "official-permission-sources-verified"));
  assert.ok(status.externalConnectAutopilot === null || status.externalConnectAutopilot.markdownPath.endsWith("external-connect-autopilot.md"));
  assert.ok(["not_prepared", "blocked", "ready"].includes(status.hundredClipsExecutionSprint.status));
  assert.equal(status.externalAccountPermissionSprint.manifestPath, status.hundredClipsExecutionSprint.manifestPath);
  assert.ok(status.hundredClipsExecutionSprint.markdownPath.endsWith("100-clips-execution-sprint.md"));
});

test("prepareClipper100ClipsExecutionSprint writes coordination artifacts without duplicating source scout", async () => {
  const result = await prepareClipper100ClipsExecutionSprint();
  const sprint = result.hundredClipsExecutionSprint;

  assert.equal(result.externalAccountPermissionSprint.manifestPath, sprint.manifestPath);
  assert.ok(sprint.manifestPath.endsWith("100-clips-execution-sprint.json"));
  assert.ok(sprint.markdownPath.endsWith("100-clips-execution-sprint.md"));
  assert.ok(sprint.csvPath.endsWith("100-clips-execution-sprint.csv"));
  assert.ok((await stat(sprint.manifestPath)).isFile());
  assert.ok((await stat(sprint.markdownPath)).isFile());
  assert.ok((await stat(sprint.csvPath)).isFile());
  assert.equal(sprint.targetWeeklyClips, 100);
  assert.ok(sprint.sourceArtifacts.sourceScoutWorkQueuePath.endsWith("source-scout-work-queue.md"));
  assert.ok(sprint.sourceArtifacts.sourceScoutExactUrlKitPath.endsWith("source-scout-exact-url-kit.md"));
  assert.ok(sprint.sourceArtifacts.sourceScoutSourceFileKitPath.endsWith("source-scout-source-file-kit.md"));
  assert.equal(sprint.totals.items, sprint.items.length);
  assert.ok(sprint.items.some((item) => item.type === "account_create" || item.type === "account_verify"));
  assert.ok(sprint.items.some((item) => item.type === "permission_request"));
  assert.ok(sprint.items.some((item) => item.type === "source_scout"));

  const manifest = JSON.parse(await readFile(sprint.manifestPath, "utf8"));
  assert.equal(manifest.manifestPath, sprint.manifestPath);
  const csv = await readFile(sprint.csvPath, "utf8");
  assert.ok(csv.includes("owner_action"));
});

test("prepareClipperExternalAccountPermissionSprint aliases the 100 clips sprint and sanitizes evidence rows", async () => {
  const credentialEnvNames = [
    "TIKTOK_CLIENT_KEY",
    "TIKTOK_CLIENT_ID",
    "TIKTOK_CLIENT_SECRET",
    "META_APP_ID",
    "FACEBOOK_APP_ID",
    "META_APP_SECRET",
    "FACEBOOK_APP_SECRET",
    ...GOOGLE_OAUTH_ALIAS_ENV_VARS,
  ];
  const snapshot = snapshotEnv(credentialEnvNames);
  clearEnv(credentialEnvNames);

  try {
    const result = await prepareClipperExternalAccountPermissionSprint();
    const sprint = result.externalAccountPermissionSprint;
    const evidenceText = sprint.items.flatMap((item) => item.requiredEvidence).join("\n");

    assert.equal(result.hundredClipsExecutionSprint.manifestPath, sprint.manifestPath);
    assert.ok(sprint.items.some((item) => item.type === "credential_missing" && item.ownerAction.includes("TIKTOK_CLIENT_KEY")));
    assert.ok(sprint.items.some((item) => item.type === "account_create" || item.type === "account_verify"));
    assert.ok(sprint.items.some((item) => item.type === "permission_request"));
    assert.ok(sprint.items.some((item) => item.type === "metricool_profile"));
    assert.equal(/password|token|client_secret/i.test(evidenceText), false);
    assert.equal(sprint.totals.credentialMissing > 0, true);
    assert.equal(sprint.status, "blocked");
  } finally {
    restoreEnv(snapshot);
  }
});

test("100 clips sprint keeps Metricool in approval required mode", async () => {
  const { hundredClipsExecutionSprint, status } = await prepareClipper100ClipsExecutionSprint();
  const metricoolItems = hundredClipsExecutionSprint.items.filter((item) => item.type === "metricool_profile" || item.type === "metricool_queue");

  assert.equal(status.metricoolExecutionQueue.realPublishEnabled, false);
  assert.ok(metricoolItems.length > 0);
  assert.ok(metricoolItems.every((item) => item.publishGuardrail.includes("approval_required")));
  assert.ok(metricoolItems.every((item) => item.publishGuardrail.includes("realPublishEnabled=false")));
});

test("getClipperStatus blocks fake values in operational launch evidence", async () => {
  const beforeStatus = await getClipperStatus();
  const ownerConnectEvidenceDropPath = path.join(beforeStatus.rootDir, "evidence-drop", "owner-connect-evidence.csv");
  const previousOwnerConnectEvidenceDrop = await readFile(ownerConnectEvidenceDropPath, "utf8").catch(() => null);
  const previousAuditManifest = await readFile(beforeStatus.evidenceIntegrityAudit.manifestPath, "utf8").catch(() => null);
  const previousAuditMarkdown = await readFile(beforeStatus.evidenceIntegrityAudit.markdownPath, "utf8").catch(() => null);
  const previousAuditCsv = await readFile(beforeStatus.evidenceIntegrityAudit.csvPath, "utf8").catch(() => null);

  await writeFile(ownerConnectEvidenceDropPath, [
    "kind,account_id,platform,status,scope,app_identifier,public_base_url,notes",
    "developer_app,,tiktok,submitted,,tiktok-app-id,http://localhost:5010,Submitted with localhost URL",
  ].join("\n"));

  try {
    const status = await getClipperStatus();
    const integrityRequirement = status.goLiveCompletionAudit.requirements.find((item) => item.id === "evidence-integrity-clean");
    assert.equal(status.evidenceIntegrityAudit.status, "blocked");
    assert.ok(status.evidenceIntegrityAudit.totals.fakeOrTest >= 1);
    assert.ok(status.evidenceIntegrityAudit.totals.localUrl >= 1);
    assert.ok(status.evidenceIntegrityAudit.items.some((item) => item.relativePath.endsWith("owner-connect-evidence.csv")));
    assert.equal(integrityRequirement?.status, "blocked");
    assert.equal(status.goLiveCompletionAudit.readyToPublish, false);
  } finally {
    if (previousOwnerConnectEvidenceDrop === null) await unlink(ownerConnectEvidenceDropPath).catch(() => undefined);
    else await writeFile(ownerConnectEvidenceDropPath, previousOwnerConnectEvidenceDrop);
    if (previousAuditManifest === null) await unlink(beforeStatus.evidenceIntegrityAudit.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.evidenceIntegrityAudit.manifestPath, previousAuditManifest);
    if (previousAuditMarkdown === null) await unlink(beforeStatus.evidenceIntegrityAudit.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.evidenceIntegrityAudit.markdownPath, previousAuditMarkdown);
    if (previousAuditCsv === null) await unlink(beforeStatus.evidenceIntegrityAudit.csvPath).catch(() => undefined);
    else await writeFile(beforeStatus.evidenceIntegrityAudit.csvPath, previousAuditCsv);
  }
});

test("getClipperStatus blocks fake source-drop proof files", async () => {
  const beforeStatus = await getClipperStatus();
  const sourceProofDir = path.join(beforeStatus.rootDir, "source-drop", "sports");
  const sourceProofPath = path.join(sourceProofDir, "viral-rights-proof.csv");
  const previousSourceProof = await readFile(sourceProofPath, "utf8").catch(() => null);
  const previousAuditManifest = await readFile(beforeStatus.evidenceIntegrityAudit.manifestPath, "utf8").catch(() => null);
  const previousAuditMarkdown = await readFile(beforeStatus.evidenceIntegrityAudit.markdownPath, "utf8").catch(() => null);
  const previousAuditCsv = await readFile(beforeStatus.evidenceIntegrityAudit.csvPath, "utf8").catch(() => null);

  await mkdir(sourceProofDir, { recursive: true });
  await writeFile(sourceProofPath, [
    "title,rights_status,evidence_link,notes",
    "Viral clip,owned_or_permissioned,https://example.com/proof,fake source rights proof",
  ].join("\n"));

  try {
    const status = await getClipperStatus();
    const integrityRequirement = status.goLiveCompletionAudit.requirements.find((item) => item.id === "evidence-integrity-clean");
    assert.equal(status.evidenceIntegrityAudit.status, "blocked");
    assert.ok(status.evidenceIntegrityAudit.scannedPaths.some((item) => item.endsWith("viral-rights-proof.csv")));
    assert.ok(status.evidenceIntegrityAudit.items.some((item) => item.relativePath.endsWith("source-drop/sports/viral-rights-proof.csv")));
    assert.equal(integrityRequirement?.status, "blocked");
    assert.equal(status.goLiveCompletionAudit.readyToPublish, false);
  } finally {
    if (previousSourceProof === null) await unlink(sourceProofPath).catch(() => undefined);
    else await writeFile(sourceProofPath, previousSourceProof);
    if (previousAuditManifest === null) await unlink(beforeStatus.evidenceIntegrityAudit.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.evidenceIntegrityAudit.manifestPath, previousAuditManifest);
    if (previousAuditMarkdown === null) await unlink(beforeStatus.evidenceIntegrityAudit.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.evidenceIntegrityAudit.markdownPath, previousAuditMarkdown);
    if (previousAuditCsv === null) await unlink(beforeStatus.evidenceIntegrityAudit.csvPath).catch(() => undefined);
    else await writeFile(beforeStatus.evidenceIntegrityAudit.csvPath, previousAuditCsv);
  }
});

test("bootstrapClipperAccounts prepares platform accounts and permission queue", async () => {
  const status = await bootstrapClipperAccounts();
  const platformAccounts = status.accounts.flatMap((account) => account.platformAccounts);

  assert.equal(platformAccounts.length, status.accounts.length * 3);
  assert.ok(platformAccounts.some((account) => account.platform === "tiktok" && account.requiredScopes.includes("video.publish")));
  assert.ok(platformAccounts.some((account) => account.platform === "youtube" && account.requiredScopes.includes("https://www.googleapis.com/auth/youtube.upload")));
  assert.ok(status.permissionQueue.some((permission) => permission.scope === "instagram_content_publish"));
  assert.ok(status.platformRequirements.every((platform) => platform.humanRequired.length > 0));
});

test("bootstrapClipperWorkspace prepares source folders and credential checks", async () => {
  const status = await bootstrapClipperWorkspace();

  assert.ok(status.sourceFolders.some((folder) => folder.category === "sports"));
  assert.ok(status.sourceFolders.some((folder) => folder.category === "allowlist"));
  assert.ok(status.sourceFolders.some((folder) => folder.category === "developerAppEvidence"));
  assert.equal(status.credentialChecks.length, 3);
  assert.ok(status.credentialChecks.some((check) => check.platform === "tiktok" && check.requiredEnvVars.includes("TIKTOK_CLIENT_KEY")));

  const sportsFolder = status.sourceFolders.find((folder) => folder.category === "sports");
  assert.ok(sportsFolder);
  const folderStat = await stat(sportsFolder.path);
  assert.equal(folderStat.isDirectory(), true);
});

test("prepareClipperCredentialSetupCenter writes safe setup docs and accepts Google Drive aliases", async () => {
  const envVars = [
    ...GOOGLE_OAUTH_ALIAS_ENV_VARS,
    "TIKTOK_CLIENT_KEY",
    "TIKTOK_CLIENT_ID",
    "TIKTOK_CLIENT_SECRET",
    "META_APP_ID",
    "META_APP_SECRET",
    "FACEBOOK_APP_ID",
    "FACEBOOK_APP_SECRET",
  ];
  const snapshot = snapshotEnv(envVars);
  clearEnv(envVars);
  process.env.GOOGLE_DRIVE_CLIENT_ID = "drive-client-id";
  process.env.GOOGLE_DRIVE_CLIENT_SECRET = "drive-client-secret";

  try {
    const { credentialSetup, status } = await prepareClipperCredentialSetupCenter();
    assert.ok(credentialSetup.readmePath.endsWith("credential-setup/README.md"));
    assert.ok(credentialSetup.templatePath.endsWith("credential-setup/clippers-env-template.env"));
    assert.ok(credentialSetup.missingTemplatePath.endsWith("credential-setup/missing-env-template.env"));
    assert.ok(credentialSetup.items.some((item) => item.id === "google-youtube-oauth" && item.status === "ready"));
    assert.ok(credentialSetup.importPlan.some((item) => item.id === "google-youtube-oauth" && item.supportedInputFormats.includes("Google OAuth JSON client")));
    assert.ok(credentialSetup.importPlan.every((item) => item.verificationSteps.length >= 3));
    assert.equal(credentialSetup.credentialPastePack.length, credentialSetup.items.length);
    assert.ok(credentialSetup.credentialPastePack.some((item) => item.id === "tiktok-oauth" && item.missingSuggestedEnvVars.includes("TIKTOK_CLIENT_KEY")));
    assert.ok(credentialSetup.credentialPastePack.some((item) => item.id === "google-youtube-oauth" && item.status === "ready"));
    assert.ok(credentialSetup.credentialPasteTemplate.includes("Clippers All Missing Credentials Paste Pack"));
    assert.ok(credentialSetup.credentialPasteTemplate.includes("TIKTOK_CLIENT_KEY="));
    assert.ok(credentialSetup.credentialPasteChecklist.length >= 5);
    assert.ok(credentialSetup.credentialTransferKitManifestPath.endsWith("credential-setup/credential-transfer-kit.json"));
    assert.ok(credentialSetup.credentialTransferKitMarkdownPath.endsWith("credential-setup/credential-transfer-kit.md"));
    assert.ok(credentialSetup.credentialTransferKitEnvPath.endsWith("credential-setup/credential-transfer-kit.env"));
    assert.ok(credentialSetup.credentialTransferKitGeneratedAt);
    assert.ok(credentialSetup.credentialDropDiagnosticPath.endsWith("credential-setup/credential-drop-diagnostic.json"));
    assert.ok(credentialSetup.credentialDropDiagnosticMarkdownPath.endsWith("credential-setup/credential-drop-diagnostic.md"));
    assert.ok(credentialSetup.credentialDropDiagnosticGeneratedAt);
    assert.ok(["ready_to_import", "needs_review", "move_candidates_to_drop_dir", "no_candidates"].includes(credentialSetup.credentialDropDiagnostic.status));
    assert.equal(credentialSetup.credentialDropDiagnostic.manifestPath, credentialSetup.credentialDropDiagnosticPath);
    assert.equal(credentialSetup.credentialDropDiagnostic.markdownPath, credentialSetup.credentialDropDiagnosticMarkdownPath);
    assert.ok(credentialSetup.credentialDropDiagnostic.allowedEnvVars.includes("GOOGLE_CLIENT_ID"));
    assert.equal(credentialSetup.credentialTransferKitItems.length, credentialSetup.items.length);
    assert.ok(credentialSetup.credentialTransferKitItems.some((item) => item.id === "tiktok-oauth" && item.driveSearchQueries.some((query) => query.includes("TIKTOK_CLIENT_KEY"))));
    assert.ok(credentialSetup.credentialTransferKitItems.every((item) => item.driveSearchUrls.length === item.driveSearchQueries.length));
    assert.ok(credentialSetup.credentialTransferKitItems.some((item) => item.driveSearchUrls.some((url) => url.startsWith("https://drive.google.com/drive/search?q="))));
    assert.ok(credentialSetup.credentialTransferKitItems.some((item) => item.id === "google-youtube-oauth" && item.localDropFileNames.some((fileName) => fileName.endsWith(".json"))));
    assert.ok(credentialSetup.credentialTransferKitItems.some((item) => item.id === "google-youtube-oauth" && item.localDropFileNames.includes("credentials/google-drive-keys.txt")));
    assert.ok(credentialSetup.credentialTransferKitItems.some((item) => item.id === "google-drive-refresh" && item.localDropFileNames.includes("credentials/google-drive-refresh.txt")));
    assert.ok(credentialSetup.credentialTransferTemplate.includes("Clippers Credential Transfer Kit"));
    assert.ok(credentialSetup.credentialTransferTemplate.includes("TIKTOK_CLIENT_KEY="));
    assert.ok(credentialSetup.credentialTransferChecklist.some((step) => step.includes("Google Drive")));
    assert.ok(credentialSetup.credentialTransferChecklist.some((step) => step.includes("KEY=value")));
    assert.ok(credentialSetup.credentialDriveIntakeRunbookPath.endsWith("credential-setup/credential-drive-intake-runbook.json"));
    assert.ok(credentialSetup.credentialDriveIntakeRunbookMarkdownPath.endsWith("credential-setup/credential-drive-intake-runbook.md"));
    assert.ok(credentialSetup.credentialDriveIntakeRunbookCsvPath.endsWith("credential-setup/credential-drive-intake-runbook.csv"));
    assert.ok(credentialSetup.credentialDriveIntakeRunbookGeneratedAt);
    assert.equal(credentialSetup.credentialDriveIntakeRunbook.length, credentialSetup.credentialTransferKitItems.length);
    assert.ok(credentialSetup.credentialDriveIntakeRunbook.some((item) => item.id === "google-youtube-oauth" && item.acceptedInputFormats.some((format) => format.includes("Google OAuth client JSON"))));
    assert.ok(credentialSetup.credentialDriveIntakeRunbook.every((item) => item.driveSearchUrls.length === item.driveSearchQueries.length));
    assert.ok(credentialSetup.credentialDriveIntakeRunbook.every((item) => item.operatorChecklist.length >= 4));
    assert.ok(credentialSetup.envFileScans.some((file) => file.fileName === "CEO_ASSISTANT_ENV"));
    assert.ok(status.credentialChecks.some((check) => check.platform === "youtube" && check.status === "ready"));

    const readmeStat = await stat(credentialSetup.readmePath);
    const templateStat = await stat(credentialSetup.templatePath);
    const missingTemplateStat = await stat(credentialSetup.missingTemplatePath);
    const transferManifestStat = await stat(credentialSetup.credentialTransferKitManifestPath);
    const transferMarkdownStat = await stat(credentialSetup.credentialTransferKitMarkdownPath);
    const transferEnvStat = await stat(credentialSetup.credentialTransferKitEnvPath);
    const driveIntakeRunbookStat = await stat(credentialSetup.credentialDriveIntakeRunbookPath);
    const driveIntakeRunbookMarkdownStat = await stat(credentialSetup.credentialDriveIntakeRunbookMarkdownPath);
    const driveIntakeRunbookCsvStat = await stat(credentialSetup.credentialDriveIntakeRunbookCsvPath);
    const dropDiagnosticStat = await stat(credentialSetup.credentialDropDiagnosticPath);
    const dropDiagnosticMarkdownStat = await stat(credentialSetup.credentialDropDiagnosticMarkdownPath);
    assert.equal(readmeStat.isFile(), true);
    assert.equal(templateStat.isFile(), true);
    assert.equal(missingTemplateStat.isFile(), true);
    const credentialDropDir = credentialSetup.credentialDropDirs.find((dir) => dir.endsWith("credentials"));
    assert.ok(credentialDropDir);
    const credentialDropReadme = await readFile(path.join(credentialDropDir, "README.md"), "utf8");
    assert.ok(credentialDropReadme.includes("google-drive-keys.txt"));
    assert.ok(credentialDropReadme.includes("KEY=value"));
    assert.equal(transferManifestStat.isFile(), true);
    assert.equal(transferMarkdownStat.isFile(), true);
    assert.equal(transferEnvStat.isFile(), true);
    assert.equal(driveIntakeRunbookStat.isFile(), true);
    assert.equal(driveIntakeRunbookMarkdownStat.isFile(), true);
    assert.equal(driveIntakeRunbookCsvStat.isFile(), true);
    assert.equal(dropDiagnosticStat.isFile(), true);
    assert.equal(dropDiagnosticMarkdownStat.isFile(), true);

    const template = await readFile(credentialSetup.templatePath, "utf8");
    const missingTemplate = await readFile(credentialSetup.missingTemplatePath, "utf8");
    const readme = await readFile(credentialSetup.readmePath, "utf8");
    const transferManifest = await readFile(credentialSetup.credentialTransferKitManifestPath, "utf8");
    const transferMarkdown = await readFile(credentialSetup.credentialTransferKitMarkdownPath, "utf8");
    const transferEnv = await readFile(credentialSetup.credentialTransferKitEnvPath, "utf8");
    const driveIntakeMarkdown = await readFile(credentialSetup.credentialDriveIntakeRunbookMarkdownPath, "utf8");
    const driveIntakeCsv = await readFile(credentialSetup.credentialDriveIntakeRunbookCsvPath, "utf8");
    const dropDiagnosticMarkdown = await readFile(credentialSetup.credentialDropDiagnosticMarkdownPath, "utf8");
    assert.ok(template.includes("GOOGLE_DRIVE_CLIENT_ID"));
    assert.ok(missingTemplate.includes("TIKTOK_CLIENT_KEY"));
    assert.ok(readme.includes("Fast Import"));
    assert.ok(readme.includes("All Missing Credentials Paste Pack"));
    assert.ok(readme.includes("Import Plan"));
    assert.ok(readme.includes("Safe Env File Audit"));
    assert.ok(readme.includes("Credential Drop Diagnostic"));
    assert.ok(readme.includes("Credential File Candidates"));
    assert.ok(readme.includes("Paste template"));
    assert.ok(readme.includes("JSON OAuth client"));
    assert.ok(readme.includes("GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET"));
    assert.ok(transferMarkdown.includes("Clippers Credential Transfer Kit"));
    assert.ok(transferMarkdown.includes("Drive search queries"));
    assert.ok(transferMarkdown.includes("Drive search URLs"));
    assert.ok(transferMarkdown.includes("https://drive.google.com/drive/search?q="));
    assert.ok(driveIntakeMarkdown.includes("Clippers Credential Drive Intake Runbook"));
    assert.ok(driveIntakeMarkdown.includes("Google OAuth client JSON"));
    assert.ok(driveIntakeMarkdown.includes("credentials/google-drive-keys.txt"));
    assert.ok(driveIntakeCsv.includes("drive_search_urls"));
    assert.ok(dropDiagnosticMarkdown.includes("Clippers Credential Drop Diagnostic"));
    assert.ok(dropDiagnosticMarkdown.includes("Allowed env vars"));
    assert.ok(transferEnv.includes("TIKTOK_CLIENT_KEY="));
    assert.ok(transferManifest.includes("credentialTransferKitItems") || transferManifest.includes("\"items\""));
    assert.equal(template.includes("drive-client-id"), false);
    assert.equal(missingTemplate.includes("drive-client-secret"), false);
    assert.equal(readme.includes("drive-client-secret"), false);
    assert.equal(readme.includes("drive-client-id"), false);
    assert.equal(credentialSetup.credentialPasteTemplate.includes("drive-client-secret"), false);
    assert.equal(credentialSetup.credentialTransferTemplate.includes("drive-client-secret"), false);
    assert.equal(transferMarkdown.includes("drive-client-secret"), false);
    assert.equal(transferEnv.includes("drive-client-id"), false);
    assert.equal(dropDiagnosticMarkdown.includes("drive-client-secret"), false);
  } finally {
    restoreEnv(snapshot);
  }
});

test("prepareClipperCredentialSetupCenter lists credential file candidates without reading secrets", async () => {
  const candidateDir = path.join(process.cwd(), "credentials");
  const nestedCandidateDir = path.join(candidateDir, "google-nested-test");
  await mkdir(candidateDir, { recursive: true });
  await mkdir(nestedCandidateDir, { recursive: true });
  const candidatePath = path.join(candidateDir, "google-oauth-client.test.json");
  const nestedCandidatePath = path.join(nestedCandidateDir, "client_secret_nested.test.json");
  const templatePath = path.join(candidateDir, "google-drive-keys.test.env.template");
  await writeFile(candidatePath, JSON.stringify({
    web: {
      client_id: "candidate-google-client-id",
      client_secret: "candidate-google-client-secret",
    },
  }));
  await writeFile(nestedCandidatePath, JSON.stringify({
    installed: {
      client_id: "nested-google-client-id",
      client_secret: "nested-google-client-secret",
    },
  }));
  await writeFile(templatePath, "GOOGLE_CLIENT_ID=\nGOOGLE_CLIENT_SECRET=\nGOOGLE_DRIVE_REFRESH_TOKEN=\n");

  try {
    const { credentialSetup } = await prepareClipperCredentialSetupCenter();
    const candidate = credentialSetup.credentialFileScans.find((file) => file.fileName === "google-oauth-client.test.json");
    const nestedCandidate = credentialSetup.credentialFileScans.find((file) => file.relativePath.endsWith("credentials/google-nested-test/client_secret_nested.test.json"));
    const ignoredTemplate = credentialSetup.credentialDropDiagnostic.ignoredTemplateFiles.find((file) => file.fileName === "google-drive-keys.test.env.template");
    assert.ok(candidate);
    assert.ok(nestedCandidate);
    assert.ok(ignoredTemplate);
    assert.ok(credentialSetup.credentialDropDirs.some((dir) => dir.endsWith("credentials")));
    assert.ok(credentialSetup.credentialDropDirs.some((dir) => dir.endsWith("secrets")));
    assert.equal(candidate.kind, "google_oauth_json");
    assert.equal(nestedCandidate.kind, "google_oauth_json");
    assert.equal(candidate.suggestedImportTarget, "google-youtube-oauth");
    assert.equal(credentialSetup.credentialFileScans.some((file) => file.fileName === "google-drive-keys.test.env.template"), false);
    assert.ok(credentialSetup.credentialDropDiagnostic.totals.templateFiles >= 1);
    assert.ok(ignoredTemplate.nextStep.includes("Template detectado"));
    assert.equal(JSON.stringify(candidate).includes("candidate-google-client-secret"), false);
    assert.equal(JSON.stringify(nestedCandidate).includes("nested-google-client-secret"), false);

    const readme = await readFile(credentialSetup.readmePath, "utf8");
    assert.ok(readme.includes("Credential File Candidates"));
    assert.ok(readme.includes("Credential drop dirs"));
    assert.ok(readme.includes("google-oauth-client.test.json"));
    assert.ok(readme.includes("credentials/google-nested-test/client_secret_nested.test.json"));
    const gitignore = await readFile(path.join(process.cwd(), ".gitignore"), "utf8");
    assert.ok(gitignore.includes("credentials/*"));
    assert.ok(gitignore.includes("secrets/*"));
    assert.equal(readme.includes("candidate-google-client-secret"), false);
    assert.equal(readme.includes("candidate-google-client-id"), false);
    assert.equal(readme.includes("nested-google-client-secret"), false);
    assert.equal(readme.includes("nested-google-client-id"), false);
  } finally {
    await unlink(candidatePath).catch(() => undefined);
    await unlink(templatePath).catch(() => undefined);
    await rm(nestedCandidateDir, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("prepareClipperCredentialDropStarter writes editable pending env files without overwriting", async () => {
  const starterPaths = [
    path.join(process.cwd(), "credentials", "clippers-google-youtube-drive.env.pending"),
    path.join(process.cwd(), "secrets", "clippers-meta-instagram.env.pending"),
    path.join(process.cwd(), "secrets", "clippers-tiktok.env.pending"),
    path.join(process.cwd(), "secrets", "clippers-token-vault.env.pending"),
  ];
  const previousFiles = new Map<string, string | null>();
  for (const filePath of starterPaths) {
    previousFiles.set(filePath, await readFile(filePath, "utf8").catch(() => null));
    await unlink(filePath).catch(() => undefined);
  }
  const envVars = [
    "CLIPPERS_TOKEN_ENCRYPTION_KEY",
    "TIKTOK_CLIENT_KEY",
    "TIKTOK_CLIENT_SECRET",
    "META_APP_ID",
    "META_APP_SECRET",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_DRIVE_REFRESH_TOKEN",
  ];
  const snapshot = snapshotEnv(envVars);
  clearEnv(envVars);

  try {
    const { credentialDropStarter, status } = await prepareClipperCredentialDropStarter();
    assert.equal(credentialDropStarter.status, "prepared");
    assert.equal(credentialDropStarter.totals.created, 4);
    assert.equal(credentialDropStarter.totals.missing, 0);
    assert.ok(status.credentialSetup.credentialDropStarter.files.some((file) => file.relativePath === "credentials/clippers-google-youtube-drive.env.pending"));
    assert.ok(status.credentialSetup.credentialFileScans.some((file) => file.relativePath === "credentials/clippers-google-youtube-drive.env.pending"));
    assert.ok(status.credentialSetup.credentialDropDiagnostic.totals.pendingEnvVars >= 7);
    assert.ok(status.credentialSetup.credentialDropDiagnostic.files.some((file) =>
      file.relativePath === "credentials/clippers-google-youtube-drive.env.pending"
        && file.pendingEnvVars.includes("GOOGLE_CLIENT_ID")
        && file.issue?.includes("Valores pendientes")
    ));

    const googleStarter = await readFile(path.join(process.cwd(), "credentials", "clippers-google-youtube-drive.env.pending"), "utf8");
    assert.ok(googleStarter.includes("GOOGLE_CLIENT_ID="));
    assert.ok(googleStarter.includes("GOOGLE_CLIENT_SECRET="));
    assert.ok(googleStarter.includes("GOOGLE_DRIVE_REFRESH_TOKEN="));
    assert.equal(JSON.stringify(credentialDropStarter).includes("do-not-overwrite-secret"), false);

    const tiktokPath = path.join(process.cwd(), "secrets", "clippers-tiktok.env.pending");
    await writeFile(tiktokPath, "TIKTOK_CLIENT_KEY=do-not-overwrite-secret\n");
    const second = await prepareClipperCredentialDropStarter();
    const secondTiktok = second.credentialDropStarter.files.find((file) => file.relativePath === "secrets/clippers-tiktok.env.pending");
    assert.equal(secondTiktok?.status, "exists");
    assert.equal(await readFile(tiktokPath, "utf8"), "TIKTOK_CLIENT_KEY=do-not-overwrite-secret\n");
    assert.equal(JSON.stringify(second.credentialDropStarter).includes("do-not-overwrite-secret"), false);
  } finally {
    for (const filePath of starterPaths) {
      const previous = previousFiles.get(filePath);
      if (previous === null) await unlink(filePath).catch(() => undefined);
      else await writeFile(filePath, previous, { mode: 0o600 });
    }
    restoreEnv(snapshot);
  }
});

test("importClipperCredentialDropFiles accepts KEY=value credential text files", async () => {
  const envPath = path.join(process.cwd(), "CEO_ASSISTANT_ENV");
  const previousFile = await readFile(envPath, "utf8").catch(() => null);
  const credentialDir = path.join(process.cwd(), "credentials");
  const textDropPath = path.join(credentialDir, "google-drive-keys.test.txt");
  const rootTextPath = path.join(process.cwd(), "google-drive-keys-root.test.txt");
  const envVars = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_DRIVE_REFRESH_TOKEN"];
  const snapshot = snapshotEnv(envVars);
  clearEnv(envVars);
  await mkdir(credentialDir, { recursive: true });
  await writeFile(textDropPath, [
    "GOOGLE_CLIENT_ID=text-google-client-id",
    "GOOGLE_CLIENT_SECRET=text-google-client-secret",
    "GOOGLE_DRIVE_REFRESH_TOKEN=text-google-refresh-token",
  ].join("\n"));
  await writeFile(rootTextPath, [
    "GOOGLE_CLIENT_ID=root-google-client-id",
    "GOOGLE_CLIENT_SECRET=root-google-client-secret",
  ].join("\n"));

  try {
    const { credentialSetup } = await prepareClipperCredentialSetupCenter();
    const dropCandidate = credentialSetup.credentialFileScans.find((file) => file.fileName === "google-drive-keys.test.txt");
    const rootCandidate = credentialSetup.credentialDropDiagnostic.files.find((file) => file.fileName === "google-drive-keys-root.test.txt");
    assert.equal(dropCandidate?.kind, "credential_text");
    assert.equal(rootCandidate?.location, "workspace_root");
    assert.equal(rootCandidate?.importEligible, false);
    assert.ok(rootCandidate?.nextStep.includes("credentials/"));
    assert.ok(credentialSetup.credentialDropDiagnostic.totals.importEligible >= 1);

    const { credentialDropImport, status } = await importClipperCredentialDropFiles();
    assert.deepEqual(credentialDropImport.acceptedEnvVars, ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_DRIVE_REFRESH_TOKEN"]);
    assert.ok(credentialDropImport.sourceFiles?.some((file) => file.endsWith("google-drive-keys.test.txt")));
    assert.ok(status.credentialDoctor.items.some((item) => item.id === "youtube-oauth" && item.status === "ready"));

    const rawEnv = await readFile(envPath, "utf8");
    assert.ok(rawEnv.includes("GOOGLE_CLIENT_ID=text-google-client-id"));
    const responseJson = JSON.stringify(credentialDropImport);
    for (const secretValue of ["text-google-client-id", "text-google-client-secret", "text-google-refresh-token", "root-google-client-id", "root-google-client-secret"]) {
      assert.equal(responseJson.includes(secretValue), false);
    }
  } finally {
    await unlink(textDropPath).catch(() => undefined);
    await unlink(rootTextPath).catch(() => undefined);
    if (previousFile === null) await unlink(envPath).catch(() => undefined);
    else await writeFile(envPath, previousFile);
    restoreEnv(snapshot);
  }
});

test("importClipperCredentialDropFiles accepts Drive-style credential JSON files", async () => {
  const envPath = path.join(process.cwd(), "CEO_ASSISTANT_ENV");
  const previousFile = await readFile(envPath, "utf8").catch(() => null);
  const credentialDir = path.join(process.cwd(), "credentials");
  const jsonDropPath = path.join(credentialDir, "clippers-social-secrets.test.json");
  const envVars = [
    "TIKTOK_CLIENT_KEY",
    "TIKTOK_CLIENT_SECRET",
    "META_APP_ID",
    "META_APP_SECRET",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_DRIVE_REFRESH_TOKEN",
  ];
  const snapshot = snapshotEnv(envVars);
  clearEnv(envVars);
  await mkdir(credentialDir, { recursive: true });
  await writeFile(jsonDropPath, JSON.stringify({
    env: {
      TIKTOK_CLIENT_KEY: "json-tiktok-client-key",
      META_APP_ID: "json-meta-app-id",
    },
    credentials: [
      { key: "TIKTOK_CLIENT_SECRET", value: "json-tiktok-client-secret" },
      { envVar: "META_APP_SECRET", secret: "json-meta-app-secret" },
      { name: "GOOGLE_CLIENT_ID", value: "json-google-client-id" },
      { name: "GOOGLE_CLIENT_SECRET", value: "json-google-client-secret" },
      { name: "GOOGLE_DRIVE_REFRESH_TOKEN", token: "json-google-refresh-token" },
    ],
  }, null, 2));

  try {
    const { credentialSetup } = await prepareClipperCredentialSetupCenter();
    const jsonCandidate = credentialSetup.credentialFileScans.find((file) => file.fileName === "clippers-social-secrets.test.json");
    assert.equal(jsonCandidate?.kind, "credential_json");
    assert.equal(jsonCandidate?.suggestedImportTarget, "credential-secrets-batch");
    assert.ok(credentialSetup.credentialDropDiagnostic.acceptedEnvVars.includes("TIKTOK_CLIENT_KEY"));
    assert.ok(credentialSetup.credentialDropDiagnostic.acceptedEnvVars.includes("META_APP_SECRET"));
    assert.ok(credentialSetup.credentialDropDiagnostic.acceptedEnvVars.includes("GOOGLE_DRIVE_REFRESH_TOKEN"));

    const { credentialDropImport, status } = await importClipperCredentialDropFiles();
    assert.deepEqual(credentialDropImport.acceptedEnvVars, envVars.sort());
    assert.ok(credentialDropImport.sourceFiles?.some((file) => file.endsWith("clippers-social-secrets.test.json")));
    assert.ok(status.credentialDoctor.items.some((item) => item.id === "tiktok-oauth" && item.status === "ready"));
    assert.ok(status.credentialDoctor.items.some((item) => item.id === "instagram-oauth" && item.status === "ready"));
    assert.ok(status.credentialDoctor.items.some((item) => item.id === "youtube-oauth" && item.status === "ready"));

    const rawEnv = await readFile(envPath, "utf8");
    assert.ok(rawEnv.includes("TIKTOK_CLIENT_KEY=json-tiktok-client-key"));
    const responseJson = JSON.stringify(credentialDropImport);
    for (const secretValue of [
      "json-tiktok-client-key",
      "json-tiktok-client-secret",
      "json-meta-app-id",
      "json-meta-app-secret",
      "json-google-client-id",
      "json-google-client-secret",
      "json-google-refresh-token",
    ]) {
      assert.equal(responseJson.includes(secretValue), false);
    }
  } finally {
    await unlink(jsonDropPath).catch(() => undefined);
    if (previousFile === null) await unlink(envPath).catch(() => undefined);
    else await writeFile(envPath, previousFile);
    restoreEnv(snapshot);
  }
});

test("prepareClipperCredentialSetupCenter accepts extended Google OAuth aliases", async () => {
  const googleSnapshot = snapshotEnv(GOOGLE_OAUTH_ALIAS_ENV_VARS);
  clearEnv(GOOGLE_OAUTH_ALIAS_ENV_VARS);
  process.env.GOOGLE_OAUTH_CLIENT_ID = "google-oauth-client-id";
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "google-oauth-client-secret";

  try {
    const { credentialSetup, status } = await prepareClipperCredentialSetupCenter();
    const googleItem = credentialSetup.items.find((item) => item.id === "google-youtube-oauth");
    assert.equal(googleItem?.status, "ready");
    assert.ok(googleItem?.configuredEnvVars.includes("GOOGLE_OAUTH_CLIENT_ID"));
    assert.ok(googleItem?.configuredEnvVars.includes("GOOGLE_OAUTH_CLIENT_SECRET"));
    assert.ok(credentialSetup.envFileScans.every((file) => file.relevantKeys.every((key) => !key.includes("secret"))));
    assert.ok(status.credentialChecks.some((check) => check.platform === "youtube" && check.status === "ready"));

    const template = await readFile(credentialSetup.templatePath, "utf8");
    const missingTemplate = await readFile(credentialSetup.missingTemplatePath, "utf8");
    assert.ok(template.includes("GOOGLE_OAUTH_CLIENT_ID"));
    assert.ok(template.includes("YOUTUBE_OAUTH_CLIENT_SECRET"));
    assert.equal(template.includes("google-oauth-client-secret"), false);
    assert.equal(missingTemplate.includes("GOOGLE_OAUTH_CLIENT_SECRET"), false);
  } finally {
    restoreEnv(googleSnapshot);
  }
});

test("reloadClipperCredentials loads CEO_ASSISTANT_ENV without exposing secret values", async () => {
  const envPath = path.join(process.cwd(), "CEO_ASSISTANT_ENV");
  const previousFile = await readFile(envPath, "utf8").catch(() => null);
  const originalGoogleClientId = process.env.GOOGLE_CLIENT_ID;
  const originalGoogleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const originalDriveClientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
  const originalDriveClientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  const originalTokenKey = process.env.CLIPPERS_TOKEN_ENCRYPTION_KEY;

  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GOOGLE_DRIVE_CLIENT_ID;
  delete process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  delete process.env.CLIPPERS_TOKEN_ENCRYPTION_KEY;

  await writeFile(envPath, [
    "GOOGLE_DRIVE_CLIENT_ID=test-drive-client-id",
    "GOOGLE_DRIVE_CLIENT_SECRET=test-drive-client-secret",
    "CLIPPERS_TOKEN_ENCRYPTION_KEY=test-token-key-with-more-than-32-chars",
  ].join("\n"));

  try {
    const { credentialReload, status } = await reloadClipperCredentials();
    assert.ok(credentialReload.loadedFiles.includes("CEO_ASSISTANT_ENV"));
    assert.ok(credentialReload.envFilesFound.includes("CEO_ASSISTANT_ENV"));
    assert.ok(credentialReload.credentialSetup.items.some((item) => item.id === "google-youtube-oauth" && item.status === "ready"));
    assert.ok(credentialReload.credentialSetup.items.some((item) => item.id === "token-vault" && item.status === "ready"));
    assert.equal(status.driveWorkspace.status, "needs_oauth");
    assert.ok(status.credentialChecks.some((check) => check.platform === "youtube" && check.status === "ready"));

    const readme = await readFile(credentialReload.credentialSetup.readmePath, "utf8").catch(() => "");
    assert.equal(readme.includes("test-drive-client-secret"), false);
    assert.equal(readme.includes("test-token-key"), false);
  } finally {
    if (previousFile === null) await unlink(envPath).catch(() => undefined);
    else await writeFile(envPath, previousFile);
    if (originalGoogleClientId) process.env.GOOGLE_CLIENT_ID = originalGoogleClientId;
    else delete process.env.GOOGLE_CLIENT_ID;
    if (originalGoogleClientSecret) process.env.GOOGLE_CLIENT_SECRET = originalGoogleClientSecret;
    else delete process.env.GOOGLE_CLIENT_SECRET;
    if (originalDriveClientId) process.env.GOOGLE_DRIVE_CLIENT_ID = originalDriveClientId;
    else delete process.env.GOOGLE_DRIVE_CLIENT_ID;
    if (originalDriveClientSecret) process.env.GOOGLE_DRIVE_CLIENT_SECRET = originalDriveClientSecret;
    else delete process.env.GOOGLE_DRIVE_CLIENT_SECRET;
    if (originalTokenKey) process.env.CLIPPERS_TOKEN_ENCRYPTION_KEY = originalTokenKey;
    else delete process.env.CLIPPERS_TOKEN_ENCRYPTION_KEY;
  }
});

test("reloadClipperCredentials loads extended local env files and reports aliases without values", async () => {
  const envPath = path.join(process.cwd(), ".env.development");
  const previousFile = await readFile(envPath, "utf8").catch(() => null);
  const envVars = [
    "GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_SECRET",
    "GOOGLE_OAUTH_REFRESH_TOKEN",
  ];
  const snapshot = snapshotEnv(envVars);
  clearEnv(envVars);

  await writeFile(envPath, [
    "GOOGLE_OAUTH_CLIENT_ID=development-google-client-id",
    "GOOGLE_OAUTH_CLIENT_SECRET=development-google-secret",
    "GOOGLE_OAUTH_REFRESH_TOKEN=development-refresh-token",
  ].join("\n"));

  try {
    const { credentialReload, status } = await reloadClipperCredentials();
    assert.ok(credentialReload.loadedFiles.includes(".env.development"));
    assert.equal(status.driveWorkspace.status, "needs_oauth");
    assert.ok(status.driveWorkspace.envDiagnostics.envFilesFound.includes(".env.development"));
    assert.ok(status.driveWorkspace.envDiagnostics.envFilesWithAcceptedAliases.some((file) =>
      file.fileName === ".env.development" &&
      file.aliases.includes("GOOGLE_OAUTH_CLIENT_ID") &&
      file.aliases.includes("GOOGLE_OAUTH_CLIENT_SECRET") &&
      file.aliases.includes("GOOGLE_OAUTH_REFRESH_TOKEN")
    ));
    assert.equal(JSON.stringify(status.driveWorkspace.envDiagnostics).includes("development-google-secret"), false);
    assert.equal(JSON.stringify(status.driveWorkspace.envDiagnostics).includes("development-refresh-token"), false);
  } finally {
    if (previousFile === null) await unlink(envPath).catch(() => undefined);
    else await writeFile(envPath, previousFile);
    restoreEnv(snapshot);
  }
});

test("prepareClipperDriveWorkspace writes safe Google Drive env template when keys are missing", async () => {
  const envVars = GOOGLE_OAUTH_ALIAS_ENV_VARS;
  const snapshot = snapshotEnv(envVars);
  clearEnv(envVars);
  let templatePath = "";

  try {
    const { driveWorkspace } = await prepareClipperDriveWorkspace();
    templatePath = driveWorkspace.envDiagnostics.credentialTemplatePath;

    assert.equal(driveWorkspace.status, "missing_keys");
    assert.ok(templatePath.endsWith("google-drive-env-template.env"));
    assert.ok(driveWorkspace.envDiagnostics.requiredEnvTemplateRows.includes("GOOGLE_DRIVE_REFRESH_TOKEN="));
    assert.equal(driveWorkspace.envDiagnostics.configuredClientIdAliases.length, 0);
    assert.equal(driveWorkspace.envDiagnostics.runtimeMissingGroups.length >= 2, true);

    const rawTemplate = await readFile(templatePath, "utf8");
    assert.ok(rawTemplate.includes("GOOGLE_CLIENT_ID="));
    assert.ok(rawTemplate.includes("GOOGLE_CLIENT_SECRET="));
    assert.ok(rawTemplate.includes("/api/google-drive/oauth/callback"));
    assert.equal(rawTemplate.includes("client_secret"), false);
    assert.equal(rawTemplate.includes("refresh-token"), false);
  } finally {
    if (templatePath) await unlink(templatePath).catch(() => undefined);
    restoreEnv(snapshot);
  }
});

test("prepareClipperDriveWorkspace ignores placeholder public redirect URLs", async () => {
  const envVars = [...GOOGLE_OAUTH_ALIAS_ENV_VARS, "PUBLIC_BASE_URL", "PORT"];
  const snapshot = snapshotEnv(envVars);
  clearEnv(envVars);
  process.env.GOOGLE_DRIVE_REDIRECT_URI = "<google-drive-redirect-uri>";
  process.env.PUBLIC_BASE_URL = "https://your-domain.example";
  process.env.PUBLIC_APP_URL = "https://your-domain.example";
  process.env.EXPO_PUBLIC_DOMAIN = "your-domain.example";
  process.env.PORT = "5019";

  try {
    const { driveWorkspace } = await prepareClipperDriveWorkspace();
    assert.equal(driveWorkspace.oauthSetup.configuredRedirectUri, null);
    assert.equal(driveWorkspace.oauthSetup.recommendedRedirectUris.some((uri) => uri.includes("your-domain.example")), false);
    assert.ok(driveWorkspace.oauthSetup.recommendedRedirectUris.includes("http://127.0.0.1:5019/api/google-drive/oauth/callback"));
  } finally {
    restoreEnv(snapshot);
  }
});

test("prepareClipperDriveWorkspace tells user to reload when Google keys are only in env files", async () => {
  const envPath = path.join(process.cwd(), ".env.production.local");
  const previousFile = await readFile(envPath, "utf8").catch(() => null);
  const snapshot = snapshotEnv(GOOGLE_OAUTH_ALIAS_ENV_VARS);
  clearEnv(GOOGLE_OAUTH_ALIAS_ENV_VARS);

  await writeFile(envPath, [
    "GOOGLE_WEB_CLIENT_ID=file-google-web-client-id",
    "GOOGLE_WEB_CLIENT_SECRET=file-google-web-client-secret",
  ].join("\n"));

  try {
    const { driveWorkspace } = await prepareClipperDriveWorkspace();
    assert.equal(driveWorkspace.status, "missing_keys");
    assert.equal(driveWorkspace.envDiagnostics.envFilesNeedReload, true);
    assert.ok(driveWorkspace.envDiagnostics.detectedAcceptedAliasesInFiles.includes("GOOGLE_WEB_CLIENT_ID"));
    assert.ok(driveWorkspace.envDiagnostics.detectedAcceptedAliasesInFiles.includes("GOOGLE_WEB_CLIENT_SECRET"));
    assert.ok(driveWorkspace.nextStep.includes("Reload keys"));
    assert.equal(JSON.stringify(driveWorkspace.envDiagnostics).includes("file-google-web-client-secret"), false);
  } finally {
    if (previousFile === null) await unlink(envPath).catch(() => undefined);
    else await writeFile(envPath, previousFile);
    restoreEnv(snapshot);
  }
});

test("prepareClipperCredentialDoctor reports platform aliases without secret values", async () => {
  const envPath = path.join(process.cwd(), "CEO_ASSISTANT_ENV");
  const tiktokDropPath = path.join(process.cwd(), "secrets", "clippers-tiktok.env.pending");
  const previousFile = await readFile(envPath, "utf8").catch(() => null);
  const previousTikTokDrop = await readFile(tiktokDropPath, "utf8").catch(() => null);
  const envVars = [
    "TIKTOK_CLIENT_KEY",
    "TIKTOK_CLIENT_ID",
    "TIKTOK_CLIENT_SECRET",
    "META_APP_ID",
    "META_APP_SECRET",
    "FACEBOOK_APP_ID",
    "FACEBOOK_APP_SECRET",
    "YOUTUBE_CLIENT_ID",
    "YOUTUBE_CLIENT_SECRET",
  ];
  const snapshot = snapshotEnv(envVars);
  clearEnv(envVars);
  process.env.TIKTOK_CLIENT_ID = "alias-tiktok-client-id";
  process.env.FACEBOOK_APP_ID = "alias-facebook-app-id";
  process.env.YOUTUBE_CLIENT_ID = "alias-youtube-client-id";
  process.env.YOUTUBE_CLIENT_SECRET = "alias-youtube-client-secret";
  await writeFile(envPath, [
    "TIKTOK_CLIENT_ID=alias-tiktok-client-id",
    "FACEBOOK_APP_ID=alias-facebook-app-id",
    "YOUTUBE_CLIENT_ID=alias-youtube-client-id",
    "YOUTUBE_CLIENT_SECRET=alias-youtube-client-secret",
  ].join("\n"));
  await mkdir(path.dirname(tiktokDropPath), { recursive: true });
  await writeFile(tiktokDropPath, [
    "TIKTOK_CLIENT_KEY=drop-tiktok-client-key",
    "TIKTOK_CLIENT_SECRET=",
  ].join("\n"));

  try {
    const { credentialDoctor, status } = await prepareClipperCredentialDoctor();
    assert.ok(credentialDoctor.manifestPath.endsWith("credential-doctor.json"));
    assert.ok(credentialDoctor.markdownPath.endsWith("credential-doctor.md"));
    assert.ok(credentialDoctor.repairWorksheetCsvPath.endsWith("credential-doctor-repair-worksheet.csv"));
    assert.ok(credentialDoctor.items.some((item) => item.id === "youtube-oauth" && item.status === "ready"));
    assert.ok(credentialDoctor.items.some((item) => item.id === "tiktok-oauth" && item.status === "partial" && item.configuredEnvVars.includes("TIKTOK_CLIENT_ID")));
    const tiktok = credentialDoctor.items.find((item) => item.id === "tiktok-oauth");
    assert.equal(tiktok?.dropTarget, "secrets/clippers-tiktok.env.pending");
    assert.equal(tiktok?.dropFileStatus, "pending_values");
    assert.deepEqual(tiktok?.dropFileReadyEnvVars, ["TIKTOK_CLIENT_KEY"]);
    assert.deepEqual(tiktok?.dropFilePendingEnvVars, ["TIKTOK_CLIENT_SECRET"]);
    assert.ok(status.commandCenter.steps.some((step) => step.id === "credential-doctor" && step.actionUrl === "/api/clippers/prepare-credential-doctor"));

    const rawManifest = await readFile(credentialDoctor.manifestPath, "utf8");
    const rawMarkdown = await readFile(credentialDoctor.markdownPath, "utf8");
    const rawRepairWorksheet = await readFile(credentialDoctor.repairWorksheetCsvPath, "utf8");
    assert.ok(rawManifest.includes("YOUTUBE_CLIENT_ID"));
    assert.ok(rawMarkdown.includes("FACEBOOK_APP_ID"));
    assert.ok(rawMarkdown.includes("Repair worksheet"));
    assert.ok(rawMarkdown.includes("Drop file status"));
    assert.ok(rawRepairWorksheet.includes("item_id,label,platform,status,drop_file_status,drop_file_env_vars,drop_file_ready_env_vars,drop_file_pending_env_vars"));
    assert.ok(rawRepairWorksheet.includes("TIKTOK_CLIENT_SECRET"));
    assert.ok(rawRepairWorksheet.includes("secrets/clippers-tiktok.env.pending"));
    assert.equal(rawManifest.includes("alias-youtube-client-secret"), false);
    assert.equal(rawMarkdown.includes("alias-tiktok-client-id"), false);
    assert.equal(rawMarkdown.includes("drop-tiktok-client-key"), false);
    assert.equal(rawRepairWorksheet.includes("alias-youtube-client-secret"), false);
    assert.equal(rawRepairWorksheet.includes("alias-tiktok-client-id"), false);
    assert.equal(rawRepairWorksheet.includes("drop-tiktok-client-key"), false);
  } finally {
    if (previousFile === null) await unlink(envPath).catch(() => undefined);
    else await writeFile(envPath, previousFile);
    if (previousTikTokDrop === null) await unlink(tiktokDropPath).catch(() => undefined);
    else await writeFile(tiktokDropPath, previousTikTokDrop);
    restoreEnv(snapshot);
  }
});

test("prepareClipperCredentialDoctor rejects placeholder runtime credentials", async () => {
  const envVars = [
    "TIKTOK_CLIENT_KEY",
    "TIKTOK_CLIENT_ID",
    "TIKTOK_CLIENT_SECRET",
    "META_APP_ID",
    "META_APP_SECRET",
    "FACEBOOK_APP_ID",
    "FACEBOOK_APP_SECRET",
    "YOUTUBE_CLIENT_ID",
    "YOUTUBE_CLIENT_SECRET",
    "GOOGLE_REFRESH_TOKEN",
    "CLIPPERS_TOKEN_ENCRYPTION_KEY",
  ];
  const snapshot = snapshotEnv(envVars);
  clearEnv(envVars);

  process.env.TIKTOK_CLIENT_KEY = "replace-with-tiktok-client-key";
  process.env.TIKTOK_CLIENT_SECRET = "your-tiktok-client-secret";
  process.env.META_APP_ID = "your-meta-app-id";
  process.env.META_APP_SECRET = "replace-with-meta-app-secret";
  process.env.YOUTUBE_CLIENT_ID = "replace-with-youtube-client-id";
  process.env.YOUTUBE_CLIENT_SECRET = "your-youtube-client-secret";
  process.env.GOOGLE_REFRESH_TOKEN = "replace-with-google-refresh-token";
  process.env.CLIPPERS_TOKEN_ENCRYPTION_KEY = "replace-with-32-plus-character-secret";

  try {
    const { credentialDoctor } = await prepareClipperCredentialDoctor();
    const tiktok = credentialDoctor.items.find((item) => item.id === "tiktok-oauth");
    const instagram = credentialDoctor.items.find((item) => item.id === "instagram-oauth");
    const youtube = credentialDoctor.items.find((item) => item.id === "youtube-oauth");
    const tokenVault = credentialDoctor.items.find((item) => item.id === "token-vault");

    assert.equal(tiktok?.status, "missing");
    assert.equal(instagram?.status, "missing");
    assert.equal(youtube?.status, "missing");
    assert.equal(tokenVault?.status, "missing");
    assert.deepEqual(tiktok?.configuredEnvVars, []);
    assert.deepEqual(youtube?.configuredEnvVars, []);
  } finally {
    restoreEnv(snapshot);
  }
});

test("recordClipperCredentialSecret upserts allowed keys without returning secret values", async () => {
  const envPath = path.join(process.cwd(), "CEO_ASSISTANT_ENV");
  const previousFile = await readFile(envPath, "utf8").catch(() => null);
  const originalMetaSecret = process.env.META_APP_SECRET;
  delete process.env.META_APP_SECRET;

  try {
    const { credentialSecret, status } = await recordClipperCredentialSecret({
      envVar: "META_APP_SECRET",
      value: "test-meta-secret-value",
    });

    assert.equal(credentialSecret.envVar, "META_APP_SECRET");
    assert.equal(credentialSecret.envFileName, "CEO_ASSISTANT_ENV");
    assert.ok(credentialSecret.configuredEnvVars.includes("META_APP_SECRET"));
    assert.ok(status.credentialDoctor.items.some((item) => item.id === "instagram-oauth" && item.configuredEnvVars.includes("META_APP_SECRET")));

    const rawEnv = await readFile(envPath, "utf8");
    assert.ok(rawEnv.includes("META_APP_SECRET=test-meta-secret-value"));

    const rawDoctor = await readFile(credentialSecret.credentialDoctor.manifestPath, "utf8");
    const rawReadme = await readFile(credentialSecret.credentialSetup.readmePath, "utf8");
    assert.equal(JSON.stringify(credentialSecret).includes("test-meta-secret-value"), false);
    assert.equal(rawDoctor.includes("test-meta-secret-value"), false);
    assert.equal(rawReadme.includes("test-meta-secret-value"), false);
  } finally {
    if (previousFile === null) await unlink(envPath).catch(() => undefined);
    else await writeFile(envPath, previousFile);
    if (originalMetaSecret) process.env.META_APP_SECRET = originalMetaSecret;
    else delete process.env.META_APP_SECRET;
  }
});

test("previewClipperCredentialSecretsBatch validates .env text without writing secrets", async () => {
  const envPath = path.join(process.cwd(), "CEO_ASSISTANT_ENV");
  const previousFile = await readFile(envPath, "utf8").catch(() => null);
  const originalTikTokKey = process.env.TIKTOK_CLIENT_KEY;
  delete process.env.TIKTOK_CLIENT_KEY;

  try {
    const { credentialSecretsBatchPreview } = await previewClipperCredentialSecretsBatch({
      envText: [
        "# Preview batch test",
        "TIKTOK_CLIENT_KEY=preview-tiktok-key",
        "NOT_ALLOWED_SECRET=bad-secret",
        "TIKTOK_CLIENT_SECRET=",
        "BROKEN_LINE",
      ].join("\n"),
    });

    assert.deepEqual(credentialSecretsBatchPreview.acceptedEnvVars, ["TIKTOK_CLIENT_KEY"]);
    assert.deepEqual(credentialSecretsBatchPreview.rejectedEnvVars, ["NOT_ALLOWED_SECRET"]);
    assert.equal(credentialSecretsBatchPreview.skippedLines >= 3, true);
    assert.equal(process.env.TIKTOK_CLIENT_KEY, undefined);

    const nextFile = await readFile(envPath, "utf8").catch(() => null);
    assert.equal(nextFile, previousFile);
    assert.equal(JSON.stringify(credentialSecretsBatchPreview).includes("preview-tiktok-key"), false);
    assert.equal(JSON.stringify(credentialSecretsBatchPreview).includes("bad-secret"), false);
  } finally {
    if (previousFile === null) await unlink(envPath).catch(() => undefined);
    else await writeFile(envPath, previousFile);
    if (originalTikTokKey) process.env.TIKTOK_CLIENT_KEY = originalTikTokKey;
    else delete process.env.TIKTOK_CLIENT_KEY;
  }
});

test("previewClipperCredentialSecretsBatch accepts Google OAuth client JSON without writing secrets", async () => {
  const envPath = path.join(process.cwd(), "CEO_ASSISTANT_ENV");
  const previousFile = await readFile(envPath, "utf8").catch(() => null);
  const envVars = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_DRIVE_REFRESH_TOKEN"];
  const snapshot = snapshotEnv(envVars);
  clearEnv(envVars);

  try {
    const { credentialSecretsBatchPreview } = await previewClipperCredentialSecretsBatch({
      envText: JSON.stringify({
        web: {
          client_id: "json-google-client-id",
          client_secret: "json-google-client-secret",
          refresh_token: "json-google-refresh-token",
          redirect_uris: ["https://example.com/api/google-drive/callback"],
        },
      }, null, 2),
    });

    assert.deepEqual(credentialSecretsBatchPreview.acceptedEnvVars, ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_DRIVE_REFRESH_TOKEN"]);
    assert.deepEqual(credentialSecretsBatchPreview.rejectedEnvVars, []);
    assert.equal(process.env.GOOGLE_CLIENT_ID, undefined);
    assert.equal(process.env.GOOGLE_CLIENT_SECRET, undefined);
    assert.equal(process.env.GOOGLE_DRIVE_REFRESH_TOKEN, undefined);

    const nextFile = await readFile(envPath, "utf8").catch(() => null);
    assert.equal(nextFile, previousFile);
    assert.equal(JSON.stringify(credentialSecretsBatchPreview).includes("json-google-client-secret"), false);
    assert.equal(JSON.stringify(credentialSecretsBatchPreview).includes("json-google-client-id"), false);
    assert.equal(JSON.stringify(credentialSecretsBatchPreview).includes("json-google-refresh-token"), false);
  } finally {
    if (previousFile === null) await unlink(envPath).catch(() => undefined);
    else await writeFile(envPath, previousFile);
    restoreEnv(snapshot);
  }
});

test("previewClipperCredentialSecretsBatch accepts nested Google OAuth exports without writing secrets", async () => {
  const envPath = path.join(process.cwd(), "CEO_ASSISTANT_ENV");
  const previousFile = await readFile(envPath, "utf8").catch(() => null);
  const envVars = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_DRIVE_REFRESH_TOKEN"];
  const snapshot = snapshotEnv(envVars);
  clearEnv(envVars);

  try {
    const { credentialSecretsBatchPreview } = await previewClipperCredentialSecretsBatch({
      envText: JSON.stringify({
        google: {
          oauth_client: [
            {
              client_id: "nested-google-client-id",
              client_secret: "nested-google-client-secret",
            },
          ],
          token: {
            refresh_token: "nested-google-refresh-token",
          },
        },
      }, null, 2),
    });

    assert.deepEqual(credentialSecretsBatchPreview.acceptedEnvVars, ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_DRIVE_REFRESH_TOKEN"]);
    assert.equal(process.env.GOOGLE_CLIENT_ID, undefined);
    assert.equal(process.env.GOOGLE_CLIENT_SECRET, undefined);
    assert.equal(process.env.GOOGLE_DRIVE_REFRESH_TOKEN, undefined);

    const nextFile = await readFile(envPath, "utf8").catch(() => null);
    assert.equal(nextFile, previousFile);
    const responseJson = JSON.stringify(credentialSecretsBatchPreview);
    for (const secretValue of ["nested-google-client-id", "nested-google-client-secret", "nested-google-refresh-token"]) {
      assert.equal(responseJson.includes(secretValue), false);
    }
  } finally {
    if (previousFile === null) await unlink(envPath).catch(() => undefined);
    else await writeFile(envPath, previousFile);
    restoreEnv(snapshot);
  }
});

test("recordClipperCredentialSecretsBatch imports .env text without returning secret values", async () => {
  const envPath = path.join(process.cwd(), "CEO_ASSISTANT_ENV");
  const previousFile = await readFile(envPath, "utf8").catch(() => null);
  const envVars = ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET", "META_APP_ID", "NOT_ALLOWED_SECRET"];
  const previousEnv = new Map(envVars.map((envVar) => [envVar, process.env[envVar]]));
  for (const envVar of envVars) delete process.env[envVar];

  try {
    const { credentialSecretsBatch, status } = await recordClipperCredentialSecretsBatch({
      envText: [
        "# Clippers batch test",
        "export TIKTOK_CLIENT_KEY=batch-tiktok-key",
        "TIKTOK_CLIENT_SECRET=\"batch-tiktok-secret\"",
        "META_APP_ID=batch-meta-id",
        "NOT_ALLOWED_SECRET=bad-secret",
        "BROKEN_LINE",
      ].join("\n"),
    });

    assert.deepEqual(credentialSecretsBatch.acceptedEnvVars, ["META_APP_ID", "TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"]);
    assert.deepEqual(credentialSecretsBatch.rejectedEnvVars, ["NOT_ALLOWED_SECRET"]);
    assert.equal(credentialSecretsBatch.skippedLines >= 2, true);
    assert.ok(credentialSecretsBatch.configuredEnvVars.includes("TIKTOK_CLIENT_KEY"));
    assert.ok(status.credentialDoctor.items.some((item) => item.id === "tiktok-oauth" && item.status === "ready"));

    const rawEnv = await readFile(envPath, "utf8");
    assert.ok(rawEnv.includes("TIKTOK_CLIENT_KEY=batch-tiktok-key"));
    assert.ok(rawEnv.includes("TIKTOK_CLIENT_SECRET=batch-tiktok-secret"));
    assert.ok(rawEnv.includes("META_APP_ID=batch-meta-id"));
    assert.equal(rawEnv.includes("NOT_ALLOWED_SECRET=bad-secret"), false);

    const rawDoctor = await readFile(credentialSecretsBatch.credentialDoctor.manifestPath, "utf8");
    const rawReadme = await readFile(credentialSecretsBatch.credentialSetup.readmePath, "utf8");
    const responseJson = JSON.stringify(credentialSecretsBatch);
    for (const secretValue of ["batch-tiktok-key", "batch-tiktok-secret", "batch-meta-id", "bad-secret"]) {
      assert.equal(responseJson.includes(secretValue), false);
      assert.equal(rawDoctor.includes(secretValue), false);
      assert.equal(rawReadme.includes(secretValue), false);
    }
  } finally {
    if (previousFile === null) await unlink(envPath).catch(() => undefined);
    else await writeFile(envPath, previousFile);
    for (const envVar of envVars) {
      const previous = previousEnv.get(envVar);
      if (previous) process.env[envVar] = previous;
      else delete process.env[envVar];
    }
  }
});

test("recordClipperCredentialSecretsBatch imports Google OAuth client JSON safely", async () => {
  const envPath = path.join(process.cwd(), "CEO_ASSISTANT_ENV");
  const previousFile = await readFile(envPath, "utf8").catch(() => null);
  const envVars = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"];
  const snapshot = snapshotEnv(envVars);
  clearEnv(envVars);

  try {
    const { credentialSecretsBatch, status } = await recordClipperCredentialSecretsBatch({
      envText: [
        "```json",
        JSON.stringify({
          installed: {
            client_id: "json-installed-google-client-id",
            client_secret: "json-installed-google-client-secret",
            redirect_uris: ["http://localhost"],
          },
        }, null, 2),
        "```",
      ].join("\n"),
    });

    assert.deepEqual(credentialSecretsBatch.acceptedEnvVars, ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]);
    assert.ok(credentialSecretsBatch.configuredEnvVars.includes("GOOGLE_CLIENT_ID"));
    assert.ok(credentialSecretsBatch.configuredEnvVars.includes("GOOGLE_CLIENT_SECRET"));
    assert.ok(status.credentialDoctor.items.some((item) => item.id === "youtube-oauth" && item.status === "ready"));

    const rawEnv = await readFile(envPath, "utf8");
    assert.ok(rawEnv.includes("GOOGLE_CLIENT_ID=json-installed-google-client-id"));
    assert.ok(rawEnv.includes("GOOGLE_CLIENT_SECRET=json-installed-google-client-secret"));
    assert.equal(JSON.stringify(credentialSecretsBatch).includes("json-installed-google-client-secret"), false);
    assert.equal(JSON.stringify(credentialSecretsBatch).includes("json-installed-google-client-id"), false);
  } finally {
    if (previousFile === null) await unlink(envPath).catch(() => undefined);
    else await writeFile(envPath, previousFile);
    restoreEnv(snapshot);
  }
});

test("importClipperCredentialDropFiles imports credential and secret drop files safely", async () => {
  const envPath = path.join(process.cwd(), "CEO_ASSISTANT_ENV");
  const previousFile = await readFile(envPath, "utf8").catch(() => null);
  const credentialDir = path.join(process.cwd(), "credentials");
  const secretDir = path.join(process.cwd(), "secrets");
  const nestedSecretDir = path.join(secretDir, "nested-drop-test");
  const googlePath = path.join(credentialDir, "google-oauth-drop.test.json");
  const googleTokenPath = path.join(credentialDir, "google-drive-token.test.json");
  const envDropPath = path.join(secretDir, "clipper-drop.test.env");
  const nestedEnvDropPath = path.join(nestedSecretDir, "meta-drop.test.env");
  const envVars = [
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_DRIVE_REFRESH_TOKEN",
    "META_APP_ID",
    "TIKTOK_CLIENT_KEY",
    "TIKTOK_CLIENT_SECRET",
    "NOT_ALLOWED_SECRET",
  ];
  const snapshot = snapshotEnv(envVars);
  clearEnv(envVars);
  await mkdir(credentialDir, { recursive: true });
  await mkdir(secretDir, { recursive: true });
  await mkdir(nestedSecretDir, { recursive: true });
  await writeFile(googlePath, JSON.stringify({
    web: {
      client_id: "drop-google-client-id",
      client_secret: "drop-google-client-secret",
    },
  }, null, 2));
  await writeFile(googleTokenPath, JSON.stringify({
    tokens: {
      refresh_token: "drop-google-refresh-token",
    },
  }, null, 2));
  await writeFile(envDropPath, [
    "TIKTOK_CLIENT_KEY=drop-tiktok-key",
    "TIKTOK_CLIENT_SECRET=drop-tiktok-secret",
    "NOT_ALLOWED_SECRET=drop-bad-secret",
  ].join("\n"));
  await writeFile(nestedEnvDropPath, [
    "META_APP_ID=drop-meta-app-id",
  ].join("\n"));

  try {
    const { credentialDropImport, status } = await importClipperCredentialDropFiles();
    assert.deepEqual(credentialDropImport.acceptedEnvVars, [
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
      "GOOGLE_DRIVE_REFRESH_TOKEN",
      "META_APP_ID",
      "TIKTOK_CLIENT_KEY",
      "TIKTOK_CLIENT_SECRET",
    ]);
    assert.deepEqual(credentialDropImport.rejectedEnvVars, ["NOT_ALLOWED_SECRET"]);
    assert.equal(credentialDropImport.filesImported, 4);
    assert.ok(credentialDropImport.sourceFiles?.some((file) => file.endsWith("google-oauth-drop.test.json")));
    assert.ok(credentialDropImport.sourceFiles?.some((file) => file.endsWith("google-drive-token.test.json")));
    assert.ok(credentialDropImport.sourceFiles?.some((file) => file.endsWith("clipper-drop.test.env")));
    assert.ok(credentialDropImport.sourceFiles?.some((file) => file.endsWith("secrets/nested-drop-test/meta-drop.test.env")));
    assert.ok(status.credentialDoctor.items.some((item) => item.id === "youtube-oauth" && item.status === "ready"));
    assert.ok(status.credentialDoctor.items.some((item) => item.id === "tiktok-oauth" && item.status === "ready"));

    const rawEnv = await readFile(envPath, "utf8");
    assert.ok(rawEnv.includes("GOOGLE_CLIENT_ID=drop-google-client-id"));
    assert.ok(rawEnv.includes("GOOGLE_DRIVE_REFRESH_TOKEN=drop-google-refresh-token"));
    assert.ok(rawEnv.includes("META_APP_ID=drop-meta-app-id"));
    assert.ok(rawEnv.includes("TIKTOK_CLIENT_SECRET=drop-tiktok-secret"));
    const responseJson = JSON.stringify(credentialDropImport);
    for (const secretValue of ["drop-google-client-secret", "drop-google-client-id", "drop-google-refresh-token", "drop-meta-app-id", "drop-tiktok-key", "drop-tiktok-secret", "drop-bad-secret"]) {
      assert.equal(responseJson.includes(secretValue), false);
    }
  } finally {
    await unlink(googlePath).catch(() => undefined);
    await unlink(googleTokenPath).catch(() => undefined);
    await unlink(envDropPath).catch(() => undefined);
    await rm(nestedSecretDir, { recursive: true, force: true }).catch(() => undefined);
    if (previousFile === null) await unlink(envPath).catch(() => undefined);
    else await writeFile(envPath, previousFile);
    restoreEnv(snapshot);
  }
});

test("importClipperCredentialDropFiles reports Google service account JSON as wrong credential type", async () => {
  const envPath = path.join(process.cwd(), "CEO_ASSISTANT_ENV");
  const previousFile = await readFile(envPath, "utf8").catch(() => null);
  const credentialDir = path.join(process.cwd(), "credentials");
  const serviceAccountPath = path.join(credentialDir, "google-service-account-drop.test.json");
  const envVars = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_DRIVE_REFRESH_TOKEN"];
  const snapshot = snapshotEnv(envVars);
  clearEnv(envVars);
  await mkdir(credentialDir, { recursive: true });
  await writeFile(serviceAccountPath, JSON.stringify({
    type: "service_account",
    client_id: "service-account-client-id",
    private_key: "-----BEGIN PRIVATE KEY-----\\nsecret\\n-----END PRIVATE KEY-----\\n",
  }, null, 2));

  try {
    await assert.rejects(
      () => importClipperCredentialDropFiles(),
      /No encontre archivos de credenciales importables/,
    );
    const { credentialSetup } = await prepareClipperCredentialSetupCenter();
    const serviceAccountError = credentialSetup.credentialDropDiagnostic.fileErrors.find((file) => file.relativePath.endsWith("google-service-account-drop.test.json"));
    assert.ok(serviceAccountError);
    assert.ok(serviceAccountError.reason.includes("service_account"));
    assert.equal(JSON.stringify(credentialSetup).includes("service-account-client-id"), false);
    assert.equal(JSON.stringify(credentialSetup).includes("PRIVATE KEY"), false);
  } finally {
    await unlink(serviceAccountPath).catch(() => undefined);
    if (previousFile === null) await unlink(envPath).catch(() => undefined);
    else await writeFile(envPath, previousFile);
    restoreEnv(snapshot);
  }
});

test("prepareClipperPermissionPack writes app review and OAuth setup files", async () => {
  const { pack, status } = await prepareClipperPermissionPack();

  assert.equal(status.permissionPack.status, "ready");
  assert.equal(pack.files.every((file) => file.exists), true);
  assert.ok(pack.files.some((file) => file.path.endsWith("tiktok-content-posting-api.md")));
  assert.ok(pack.files.some((file) => file.path.endsWith("redirect-uris.json")));

  const envFile = pack.files.find((file) => file.path.endsWith("oauth-env-template.env"));
  assert.ok(envFile);
  const envTemplate = await readFile(envFile.path, "utf8");
  assert.ok(envTemplate.includes("CLIPPERS_TOKEN_ENCRYPTION_KEY"));
  assert.equal(envTemplate.includes("plain-access-token"), false);

  const tiktokFile = pack.files.find((file) => file.path.endsWith("tiktok-content-posting-api.md"));
  assert.ok(tiktokFile);
  const tiktokReview = await readFile(tiktokFile.path, "utf8");
  assert.ok(tiktokReview.includes("Content Posting API"));
  assert.ok(tiktokReview.includes("/api/clippers/oauth/tiktok/callback"));
});

test("prepareClipperPermissionPack derives local redirect URIs from PORT when public base URL is absent", async () => {
  const originalPublicBaseUrl = process.env.PUBLIC_BASE_URL;
  const originalAppBaseUrl = process.env.APP_BASE_URL;
  const originalPort = process.env.PORT;
  const originalIgnoreStoredPublicBaseUrl = process.env.CLIPPERS_IGNORE_STORED_PUBLIC_BASE_URL;

  delete process.env.PUBLIC_BASE_URL;
  delete process.env.APP_BASE_URL;
  process.env.PORT = "5999";
  process.env.CLIPPERS_IGNORE_STORED_PUBLIC_BASE_URL = "true";

  try {
    const { pack } = await prepareClipperPermissionPack();
    const redirects = pack.files.find((file) => file.path.endsWith("redirect-uris.json"));
    assert.ok(redirects);
    const raw = await readFile(redirects.path, "utf8");
    assert.ok(raw.includes("http://127.0.0.1:5999/api/clippers/oauth/tiktok/callback"));
  } finally {
    if (originalPublicBaseUrl) process.env.PUBLIC_BASE_URL = originalPublicBaseUrl;
    else delete process.env.PUBLIC_BASE_URL;
    if (originalAppBaseUrl) process.env.APP_BASE_URL = originalAppBaseUrl;
    else delete process.env.APP_BASE_URL;
    if (originalPort) process.env.PORT = originalPort;
    else delete process.env.PORT;
    if (originalIgnoreStoredPublicBaseUrl) process.env.CLIPPERS_IGNORE_STORED_PUBLIC_BASE_URL = originalIgnoreStoredPublicBaseUrl;
    else delete process.env.CLIPPERS_IGNORE_STORED_PUBLIC_BASE_URL;
  }
});

test("prepareClipperAccountIdentityKit writes profiles, prompts and first post ideas", async () => {
  const { accountIdentityKit, status } = await prepareClipperAccountIdentityKit();

  try {
    assert.equal(accountIdentityKit.accounts.length, status.accounts.length);
    assert.equal(accountIdentityKit.totals.platformProfiles, status.accounts.length * 3);
    assert.ok(accountIdentityKit.accounts.every((account) => account.contentPillars.length >= 3));
    assert.ok(accountIdentityKit.accounts.every((account) => account.platforms.every((platform) => platform.profileImagePrompt.length > 20 && platform.firstPostIdeas.length >= 3)));
    assert.ok(status.commandCenter.steps.some((step) => step.id === "account-identity-kit" && step.actionUrl === "/api/clippers/prepare-account-identity-kit"));

    const rawManifest = await readFile(accountIdentityKit.manifestPath, "utf8");
    const rawMarkdown = await readFile(accountIdentityKit.markdownPath, "utf8");
    assert.ok(rawMarkdown.includes("Clippers Account Identity Kit"));
    assert.ok(rawManifest.includes("usernameAlternatives"));
    assert.equal(rawManifest.includes("client_secret"), false);
    assert.equal(rawMarkdown.includes("access_token"), false);
  } finally {
    await unlink(accountIdentityKit.manifestPath).catch(() => undefined);
    await unlink(accountIdentityKit.markdownPath).catch(() => undefined);
  }
});

test("prepareClipperAccountLaunchKit writes account creation manifest", async () => {
  const { accountLaunchKit, status } = await prepareClipperAccountLaunchKit();

  try {
    assert.equal(accountLaunchKit.tasks.length, status.accounts.length * 3);
    assert.ok(accountLaunchKit.kitPath.endsWith("account-launch-kit.json"));
    assert.ok(accountLaunchKit.markdownPath.endsWith("account-launch-kit.md"));
    assert.ok(accountLaunchKit.tasks.some((task) => task.platform === "tiktok" && task.profileLink.includes("tiktok.com")));
    assert.ok(accountLaunchKit.tasks.every((task) => task.bio.length > 20));
    assert.ok(accountLaunchKit.tasks.every((task) => task.checklist.some((step) => step.includes("OAuth"))));

    const kitStat = await stat(accountLaunchKit.kitPath);
    const markdownStat = await stat(accountLaunchKit.markdownPath);
    assert.equal(kitStat.isFile(), true);
    assert.equal(markdownStat.isFile(), true);

    const markdown = await readFile(accountLaunchKit.markdownPath, "utf8");
    assert.ok(markdown.includes("Clippers Account Launch Kit"));
    assert.ok(markdown.includes("Create account"));
  } finally {
    await unlink(accountLaunchKit.kitPath).catch(() => undefined);
    await unlink(accountLaunchKit.markdownPath).catch(() => undefined);
  }
});

test("prepareClipperAccountCreationPack writes executable account creation CSV and runbook", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.accountCreationPack.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.accountCreationPack.markdownPath, "utf8").catch(() => null);
  const previousCsv = await readFile(beforeStatus.accountCreationPack.csvPath, "utf8").catch(() => null);
  const previousClaimSheet = await readFile(beforeStatus.accountCreationPack.claimSheetPath, "utf8").catch(() => null);
  const previousClaimSheetCsv = await readFile(beforeStatus.accountCreationPack.claimSheetCsvPath, "utf8").catch(() => null);

  try {
    const { accountCreationPack, status } = await prepareClipperAccountCreationPack();
    assert.equal(accountCreationPack.items.length, status.accounts.reduce((sum, account) => sum + account.platformAccounts.length, 0));
    assert.ok(accountCreationPack.markdownPath.endsWith("account-creation-pack.md"));
    assert.ok(accountCreationPack.csvPath.endsWith("account-creation-pack.csv"));
    assert.ok(accountCreationPack.items.every((item) => item.signupUrl.startsWith("https://")));
    assert.ok(accountCreationPack.items.some((item) => item.platform === "youtube" && item.officialHelpUrl.includes("support.google.com")));
    assert.ok(accountCreationPack.items.every((item) => item.requiredInputs.length > 0 && item.completionHint.length > 20));
    assert.ok(accountCreationPack.items.every((item) => item.securityChecklist.length >= 4));
    assert.ok(accountCreationPack.items.every((item) => item.recoveryPlan.length >= 3));
    assert.ok(accountCreationPack.items.every((item) => item.platformProofRequired.length >= 4));
    assert.ok(accountCreationPack.items.some((item) => item.platform === "instagram" && item.platformProofRequired.some((proof) => proof.includes("Facebook Page"))));
    assert.ok(accountCreationPack.items.some((item) => item.platform === "youtube" && item.platformProofRequired.some((proof) => proof.includes("YouTube channel URL"))));
    assert.ok(accountCreationPack.items.every((item) => item.evidenceBatchRow.endsWith(',""')));
    assert.ok(accountCreationPack.items.every((item) => item.submittedEvidenceBatchRow.includes(",\"submitted\",")));
    assert.ok(accountCreationPack.items.every((item) => item.verifiedEvidenceBatchRow.includes(",\"verified\",")));
    assert.ok(accountCreationPack.items.every((item) => item.evidenceRecipeRow.includes("<real handle")));
    assert.ok(accountCreationPack.items.every((item) => item.copyPackage.length >= 5));
    assert.ok(accountCreationPack.items.every((item) => item.portalFormFields.length >= 5));
    assert.ok(accountCreationPack.items.every((item) => item.handleCheckUrls.length >= 2));
    assert.ok(accountCreationPack.items.every((item) => item.handleCheckUrls.some((url) => url.startsWith(item.profileLink))));
    assert.ok(accountCreationPack.items.every((item) => item.handleReservationPlan.length >= 4));
    assert.ok(accountCreationPack.items.every((item) => item.browserSessionChecklist.length >= 4));
    assert.ok(accountCreationPack.items.every((item) => item.evidenceCapturePlan.length >= 5));
    assert.ok(accountCreationPack.items.every((item) => item.operatorVaultChecklist.length >= 4));
    assert.ok(accountCreationPack.items.every((item) => item.postCreationNextActions.length >= 4));
    assert.equal(accountCreationPack.sessionOrder.length, accountCreationPack.items.length);
    assert.ok(accountCreationPack.sessionOrder.every((item) => item.requiredProof.length >= 4));
    assert.ok(accountCreationPack.sessionOrder.every((item) => item.copyPackage.some((field) => field.label === "bio")));
    assert.ok(accountCreationPack.sessionOrder.every((item) => item.portalFormFields.length > 0));
    assert.ok(accountCreationPack.sessionOrder.every((item) => item.handleCheckUrls.length >= 2));
    assert.ok(accountCreationPack.sessionOrder.every((item) => item.handleReservationPlan.length > 0));
    assert.ok(accountCreationPack.sessionOrder.every((item) => item.browserSessionChecklist.length > 0));
    assert.ok(accountCreationPack.sessionOrder.every((item) => item.evidenceCapturePlan.length > 0));
    assert.ok(accountCreationPack.sessionOrder.every((item) => item.submittedEvidenceBatchRow.includes(",\"submitted\",")));
    assert.ok(accountCreationPack.sessionOrder.every((item) => item.verifiedEvidenceBatchRow.includes(",\"verified\",")));
    assert.ok(accountCreationPack.sessionOrder.every((item) => item.operatorVaultChecklist.length >= 4));
    assert.ok(accountCreationPack.sessionOrder.every((item) => item.doneCriteria.length >= 5));
    assert.ok(accountCreationPack.sessionOrder.every((item) => item.evidenceRecipeRow.includes("<real handle")));
    assert.equal(accountCreationPack.claimSheet.length, accountCreationPack.items.length);
    assert.equal(accountCreationPack.platformBatches.length, 3);
    assert.equal(accountCreationPack.totals.platformBatches, accountCreationPack.platformBatches.length);
    assert.ok(accountCreationPack.platformBatches.some((batch) => batch.platform === "instagram" && batch.handles.includes("@sportsdaily")));
    assert.ok(accountCreationPack.platformBatches.every((batch) => batch.copyBlock.includes("Accounts:")));
    assert.ok(accountCreationPack.platformBatches.every((batch) => batch.evidenceRecipeRows.length === batch.profiles));
    assert.ok(accountCreationPack.platformBatches.every((batch) => batch.submittedEvidenceRows.every((row) => row.includes(",\"submitted\","))));
    assert.ok(accountCreationPack.platformBatches.every((batch) => batch.verifiedEvidenceRows.every((row) => row.includes(",\"verified\","))));
    assert.ok(accountCreationPack.platformBatches.every((batch) => batch.browserSessionChecklist.length >= 4));
    assert.ok(accountCreationPack.platformBatches.every((batch) => batch.operatorVaultChecklist.length >= 4));
    assert.ok(accountCreationPack.platformBatches.every((batch) => batch.doneCriteria.length >= 4));
    assert.ok(accountCreationPack.claimSheetPath.endsWith("account-claim-sheet.md"));
    assert.ok(accountCreationPack.claimSheetCsvPath.endsWith("account-claim-sheet.csv"));
    assert.ok(accountCreationPack.claimSheet.every((item) => item.vaultItemName.startsWith("Clippers/")));
    assert.ok(accountCreationPack.claimSheet.every((item) => item.loginIdentifierLabel.includes("login-email-or-phone-label")));
    assert.ok(accountCreationPack.claimSheet.every((item) => item.passwordVaultSlot.includes("/password")));
    assert.ok(accountCreationPack.claimSheet.every((item) => item.twoFactorSlot.includes("/2fa-method")));
    assert.ok(accountCreationPack.claimSheet.every((item) => item.handleCheckUrls.length >= 2));
    assert.ok(accountCreationPack.claimSheet.every((item) => item.preflightChecks.length >= 4));
    assert.ok(accountCreationPack.claimSheet.every((item) => item.claimSteps.length >= 5));
    assert.ok(accountCreationPack.claimSheet.every((item) => item.verificationSteps.length >= 5));
    assert.ok(accountCreationPack.claimSheet.every((item) => item.blockedUntil.length >= 4));
    assert.ok(accountCreationPack.evidenceBatchTemplate.includes('"kind","account_id","platform","status"'));
    assert.ok(status.commandCenter.steps.some((step) => step.id === "account-creation-pack" && step.actionUrl === "/api/clippers/prepare-account-creation-pack"));
    assert.ok(status.growthAudit.items.some((item) => item.id === "account-creation-pack"));

    const rawMarkdown = await readFile(accountCreationPack.markdownPath, "utf8");
    const rawCsv = await readFile(accountCreationPack.csvPath, "utf8");
    const rawClaimSheet = await readFile(accountCreationPack.claimSheetPath, "utf8");
    const rawClaimSheetCsv = await readFile(accountCreationPack.claimSheetCsvPath, "utf8");
    assert.ok(rawMarkdown.includes("Clippers Account Creation Pack"));
    assert.ok(rawMarkdown.includes("Platform Creation Batches"));
    assert.ok(rawMarkdown.includes("Account Creation Session"));
    assert.ok(rawMarkdown.includes("Claim Sheet"));
    assert.ok(rawMarkdown.includes("Launch Evidence Batch Template"));
    assert.ok(rawMarkdown.includes("Verification requirements"));
    assert.ok(rawMarkdown.includes("Security checklist"));
    assert.ok(rawMarkdown.includes("Recovery plan"));
    assert.ok(rawMarkdown.includes("Copy package"));
    assert.ok(rawMarkdown.includes("Portal form fields"));
    assert.ok(rawMarkdown.includes("Handle check URLs"));
    assert.ok(rawMarkdown.includes("Handle reservation plan"));
    assert.ok(rawMarkdown.includes("Browser session checklist"));
    assert.ok(rawMarkdown.includes("Evidence capture plan"));
    assert.ok(rawMarkdown.includes("Operator vault checklist"));
    assert.ok(rawMarkdown.includes("Platform proof required"));
    assert.ok(rawMarkdown.includes("Submitted evidence row"));
    assert.ok(rawMarkdown.includes("Evidence batch row"));
    assert.ok(rawMarkdown.includes("Evidence recipe row"));
    assert.ok(rawCsv.includes("signup_url"));
    assert.ok(rawCsv.includes("copy_package"));
    assert.ok(rawCsv.includes("portal_form_fields"));
    assert.ok(rawCsv.includes("handle_check_urls"));
    assert.ok(rawCsv.includes("handle_reservation_plan"));
    assert.ok(rawCsv.includes("browser_session_checklist"));
    assert.ok(rawCsv.includes("evidence_capture_plan"));
    assert.ok(rawCsv.includes("required_inputs"));
    assert.ok(rawCsv.includes("security_checklist"));
    assert.ok(rawCsv.includes("operator_vault_checklist"));
    assert.ok(rawCsv.includes("platform_batch_id"));
    assert.ok(rawCsv.includes("platform_proof_required"));
    assert.ok(rawCsv.includes("submitted_evidence_batch_row"));
    assert.ok(rawCsv.includes("evidence_batch_row"));
    assert.ok(rawCsv.includes("evidence_recipe_row"));
    assert.ok(rawClaimSheet.includes("Clippers Account Claim Sheet"));
    assert.ok(rawClaimSheet.includes("Vault item"));
    assert.ok(rawClaimSheet.includes("Handle check URLs"));
    assert.ok(rawClaimSheet.includes("Login identifier label"));
    assert.ok(rawClaimSheetCsv.includes("vault_item_name"));
    assert.ok(rawClaimSheetCsv.includes("handle_check_urls"));
    assert.ok(rawClaimSheetCsv.includes("login_identifier_label"));
    assert.equal(rawMarkdown.includes("client_secret"), false);
    assert.equal(rawCsv.includes("access_token"), false);
    assert.equal(rawClaimSheet.includes("client_secret"), false);
    assert.equal(rawClaimSheetCsv.includes("access_token"), false);
  } finally {
    if (previousManifest === null) await unlink(beforeStatus.accountCreationPack.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.accountCreationPack.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.accountCreationPack.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.accountCreationPack.markdownPath, previousMarkdown);
    if (previousCsv === null) await unlink(beforeStatus.accountCreationPack.csvPath).catch(() => undefined);
    else await writeFile(beforeStatus.accountCreationPack.csvPath, previousCsv);
    if (previousClaimSheet === null) await unlink(beforeStatus.accountCreationPack.claimSheetPath).catch(() => undefined);
    else await writeFile(beforeStatus.accountCreationPack.claimSheetPath, previousClaimSheet);
    if (previousClaimSheetCsv === null) await unlink(beforeStatus.accountCreationPack.claimSheetCsvPath).catch(() => undefined);
    else await writeFile(beforeStatus.accountCreationPack.claimSheetCsvPath, previousClaimSheetCsv);
  }
});

test("prepareClipperAccountSetupSession writes executable external account setup session", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.accountSetupSession.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.accountSetupSession.markdownPath, "utf8").catch(() => null);
  const previousCsv = await readFile(beforeStatus.accountSetupSession.csvPath, "utf8").catch(() => null);
  const previousAccountSetupEvidenceTemplate = await readFile(beforeStatus.accountSetupSession.sourceArtifacts.accountSetupEvidenceTemplatePath, "utf8").catch(() => null);

  try {
    const { accountSetupSession, status } = await prepareClipperAccountSetupSession();
    assert.ok(accountSetupSession.manifestPath.endsWith("account-setup-session.json"));
    assert.ok(accountSetupSession.markdownPath.endsWith("account-setup-session.md"));
    assert.ok(accountSetupSession.csvPath.endsWith("account-setup-session.csv"));
    assert.equal(accountSetupSession.items.length, status.accountCreationPack.sessionOrder.length);
    assert.equal(accountSetupSession.totals.accounts, accountSetupSession.items.length);
    assert.ok(accountSetupSession.totals.readyToCreate > 0 || accountSetupSession.totals.ready > 0 || accountSetupSession.totals.inProgress > 0);
    assert.ok(accountSetupSession.totals.portalUrls >= accountSetupSession.items.length);
    assert.ok(accountSetupSession.totals.evidenceRows >= accountSetupSession.items.length * 3);
    assert.ok(accountSetupSession.totals.vaultSlots >= accountSetupSession.items.length * 4);
    assert.ok(accountSetupSession.items.every((item) => item.signupUrl.startsWith("https://")));
    assert.ok(accountSetupSession.items.every((item) => item.handleCheckUrls.length >= 2));
    assert.ok(accountSetupSession.items.every((item) => item.vaultItemName.startsWith("Clippers/")));
    assert.ok(accountSetupSession.items.every((item) => item.submittedEvidenceBatchRow.includes(",\"submitted\",")));
    assert.ok(accountSetupSession.items.every((item) => item.verifiedEvidenceBatchRow.includes(",\"verified\",")));
    assert.ok(accountSetupSession.items.some((item) => item.platform === "instagram" && item.claimSteps.some((step) => step.includes("Professional") || step.includes("handle"))));
    assert.ok(accountSetupSession.sourceArtifacts.accountSetupEvidenceTemplatePath.endsWith("account-setup-evidence.csv"));
    assert.equal(status.accountSetupSession.manifestPath, accountSetupSession.manifestPath);

    const rawManifest = await readFile(accountSetupSession.manifestPath, "utf8");
    const rawMarkdown = await readFile(accountSetupSession.markdownPath, "utf8");
    const rawCsv = await readFile(accountSetupSession.csvPath, "utf8");
    const rawAccountSetupEvidenceTemplate = await readFile(accountSetupSession.sourceArtifacts.accountSetupEvidenceTemplatePath, "utf8");
    assert.ok(rawMarkdown.includes("Clippers Account Setup Session"));
    assert.ok(rawMarkdown.includes("Account Queue"));
    assert.ok(rawMarkdown.includes("Vault item"));
    assert.ok(rawMarkdown.includes("Handle check URLs"));
    assert.ok(rawMarkdown.includes("Account Setup Evidence Template"));
    assert.ok(rawCsv.includes("vault_item_name"));
    assert.ok(rawCsv.includes("handle_check_urls"));
    assert.ok(rawCsv.includes("submitted_evidence_batch_row"));
    assert.ok(rawManifest.includes("sourceArtifacts"));
    assert.ok(rawManifest.includes("accountSetupEvidenceTemplatePath"));
    assert.ok(rawAccountSetupEvidenceTemplate.startsWith("kind,account_id,platform,status,scope,app_identifier,public_base_url,notes"));
    assert.ok(rawAccountSetupEvidenceTemplate.includes("<real @"));
    assert.ok(rawAccountSetupEvidenceTemplate.includes(',"submitted",'));
    assert.ok(rawAccountSetupEvidenceTemplate.includes(',"verified",'));
    assert.equal(rawManifest.includes("access_token"), false);
    assert.equal(rawMarkdown.includes("client_secret"), false);
    assert.equal(rawCsv.includes("refresh_token"), false);
    assert.equal(rawAccountSetupEvidenceTemplate.includes("client_secret"), false);
  } finally {
    if (previousManifest === null) await unlink(beforeStatus.accountSetupSession.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.accountSetupSession.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.accountSetupSession.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.accountSetupSession.markdownPath, previousMarkdown);
    if (previousCsv === null) await unlink(beforeStatus.accountSetupSession.csvPath).catch(() => undefined);
    else await writeFile(beforeStatus.accountSetupSession.csvPath, previousCsv);
    if (previousAccountSetupEvidenceTemplate === null) await unlink(beforeStatus.accountSetupSession.sourceArtifacts.accountSetupEvidenceTemplatePath).catch(() => undefined);
    else await writeFile(beforeStatus.accountSetupSession.sourceArtifacts.accountSetupEvidenceTemplatePath, previousAccountSetupEvidenceTemplate);
  }
});

test("prepareClipperAccountEvidenceVault writes templates and evidence unlocks launch tasks", async () => {
  const { accountEvidence } = await prepareClipperAccountEvidenceVault();
  const evidencePath = `${accountEvidence.evidenceDir}/sports-daily-instagram.md`;
  const evidenceJsonPath = `${accountEvidence.evidenceDir}/sports-daily-instagram.json`;
  const previousEvidence = await readFile(evidencePath, "utf8").catch(() => null);
  const previousJsonEvidence = await readFile(evidenceJsonPath, "utf8").catch(() => null);
  await unlink(evidenceJsonPath).catch(() => undefined);

  try {
    assert.ok(accountEvidence.readmePath.endsWith("account-evidence/README.md"));
    assert.ok(accountEvidence.connectionKitManifestPath.endsWith("account-evidence/external-account-connection-kit.json"));
    assert.ok(accountEvidence.connectionKitMarkdownPath.endsWith("account-evidence/external-account-connection-kit.md"));
    assert.ok(accountEvidence.connectionKitCsvPath.endsWith("account-evidence/external-account-connection-kit.csv"));
    assert.ok(accountEvidence.connectionKitGeneratedAt);
    assert.ok(accountEvidence.launchEvidenceDropDir.endsWith("evidence-drop"));
    assert.ok(accountEvidence.launchEvidenceTemplatePath.endsWith("evidence-drop/launch-evidence-template.csv"));
    assert.ok(accountEvidence.launchEvidenceTemplateRows >= accountEvidence.totals.expected + 3);
    assert.ok(accountEvidence.launchEvidenceDropChecklist.length >= 5);
    assert.equal(accountEvidence.quickBatchRows.length, accountEvidence.totals.expected);
    assert.equal(accountEvidence.connectionKitPlatformBatches.length, 3);
    assert.ok(accountEvidence.connectionKitPlatformBatches.some((batch) => batch.platform === "tiktok" && batch.submittedDropFilePath.endsWith("accounts-tiktok-submitted.csv")));
    assert.ok(accountEvidence.connectionKitPlatformBatches.every((batch) => batch.verifiedDropFilePath.endsWith(`accounts-${batch.platform}-verified.csv`)));
    assert.ok(accountEvidence.connectionKitPlatformBatches.every((batch) => batch.submittedTemplateFilePath.endsWith(`accounts-${batch.platform}-submitted.csv`)));
    assert.ok(accountEvidence.connectionKitPlatformBatches.every((batch) => batch.verifiedTemplateFilePath.endsWith(`accounts-${batch.platform}-verified.csv`)));
    assert.ok(accountEvidence.connectionKitPlatformBatches.every((batch) => path.dirname(batch.submittedTemplateFilePath) !== path.dirname(batch.submittedDropFilePath)));
    assert.ok(accountEvidence.connectionKitPlatformBatches.every((batch) => batch.submittedDropTemplate.startsWith("kind,account_id,platform,status,scope")));
    assert.ok(accountEvidence.connectionKitPlatformBatches.every((batch) => batch.verifiedDropTemplate.includes("\"verified\"")));
    assert.ok(accountEvidence.quickBatchTemplate.startsWith("\"kind\",\"account_id\",\"platform\",\"status\""));
    assert.ok(accountEvidence.quickBatchTemplate.includes("sports-daily"));
    assert.ok(accountEvidence.quickBatchTemplate.includes("<real handle + profile URL + 2FA/security proof + screenshot/proof URL>"));
    assert.ok(accountEvidence.quickBatchChecklist.length >= 5);
    assert.equal(accountEvidence.quickBatchTemplate.toLowerCase().includes("client_secret"), false);
    assert.equal(accountEvidence.quickBatchTemplate.toLowerCase().includes("access_token"), false);
    const quickRow = accountEvidence.quickBatchRows.find((item) => item.id === "sports-daily-instagram");
    assert.ok(quickRow);
    assert.equal(quickRow.profileLink, "https://www.instagram.com/sportsdailyclips/");
    assert.ok(quickRow.signupUrl.includes("instagram.com"));
    assert.ok(quickRow.evidenceJsonPath.endsWith("account-evidence/sports-daily-instagram.json"));
    assert.ok(quickRow.evidenceMarkdownPath.endsWith("account-evidence/sports-daily-instagram.md"));
    assert.ok(quickRow.verifiedBatchRow.includes("verified"));
    assert.equal(accountEvidence.totals.expected > 0, true);
    const readmeStat = await stat(accountEvidence.readmePath);
    const templateStat = await stat(accountEvidence.launchEvidenceTemplatePath);
    const connectionKitManifestStat = await stat(accountEvidence.connectionKitManifestPath);
    const connectionKitMarkdownStat = await stat(accountEvidence.connectionKitMarkdownPath);
    const connectionKitCsvStat = await stat(accountEvidence.connectionKitCsvPath);
    const accountBatch = accountEvidence.connectionKitPlatformBatches[0];
    const submittedTemplateStat = await stat(accountBatch.submittedTemplateFilePath);
    const verifiedTemplateStat = await stat(accountBatch.verifiedTemplateFilePath);
    assert.equal(readmeStat.isFile(), true);
    assert.equal(templateStat.isFile(), true);
    assert.equal(connectionKitManifestStat.isFile(), true);
    assert.equal(connectionKitMarkdownStat.isFile(), true);
    assert.equal(connectionKitCsvStat.isFile(), true);
    assert.equal(submittedTemplateStat.isFile(), true);
    assert.equal(verifiedTemplateStat.isFile(), true);
    const rawReadme = await readFile(accountEvidence.readmePath, "utf8");
    assert.ok(rawReadme.includes("Account Evidence Quick Batch"));
    assert.ok(rawReadme.includes("Per-account proof checklist"));
    assert.equal(rawReadme.toLowerCase().includes("client_secret"), false);
    const rawConnectionKitManifest = await readFile(accountEvidence.connectionKitManifestPath, "utf8");
    const rawConnectionKitMarkdown = await readFile(accountEvidence.connectionKitMarkdownPath, "utf8");
    const rawConnectionKitCsv = await readFile(accountEvidence.connectionKitCsvPath, "utf8");
    assert.ok(rawConnectionKitMarkdown.includes("Clippers External Account Connection Kit"));
    assert.ok(rawConnectionKitMarkdown.includes("Platform Batches"));
    assert.ok(rawConnectionKitMarkdown.includes("accounts-tiktok-submitted.csv"));
    assert.ok(rawConnectionKitMarkdown.includes("Submitted template file"));
    assert.ok(rawConnectionKitMarkdown.includes("Verified template file"));
    assert.ok(rawConnectionKitMarkdown.includes("Submitted drop template"));
    assert.ok(rawConnectionKitMarkdown.includes("Verified import row"));
    assert.ok(rawConnectionKitMarkdown.includes("JSON drop path"));
    assert.ok(rawConnectionKitMarkdown.includes("sports-daily-instagram.json"));
    assert.ok(rawConnectionKitCsv.includes("verified_batch_row"));
    assert.ok(rawConnectionKitCsv.includes("platform_batch_id"));
    assert.ok(rawConnectionKitCsv.includes("submitted_template_file_path"));
    assert.ok(rawConnectionKitCsv.includes("verified_template_file_path"));
    assert.ok(rawConnectionKitCsv.includes("submitted_drop_file_path"));
    assert.ok(rawConnectionKitCsv.includes("verified_drop_file_path"));
    assert.ok(rawConnectionKitCsv.includes("evidence_json_path"));
    assert.ok(rawConnectionKitCsv.includes("evidence_markdown_path"));
    assert.ok(rawConnectionKitManifest.includes("quickBatchRows"));
    assert.ok(rawConnectionKitManifest.includes("connectionKitPlatformBatches"));
    assert.ok(rawConnectionKitManifest.includes("evidenceJsonPath"));
    assert.ok(rawConnectionKitManifest.includes("submittedTemplateFilePath"));
    const rawSubmittedTemplate = await readFile(accountBatch.submittedTemplateFilePath, "utf8");
    const rawTemplateReadme = await readFile(path.join(path.dirname(accountBatch.submittedTemplateFilePath), "README.md"), "utf8");
    assert.ok(rawSubmittedTemplate.startsWith("kind,account_id,platform,status,scope"));
    assert.ok(rawSubmittedTemplate.includes("<real profile URL"));
    assert.ok(rawTemplateReadme.includes("safe templates only"));
    assert.equal(rawConnectionKitManifest.toLowerCase().includes("client_secret"), false);
    assert.equal(rawConnectionKitMarkdown.toLowerCase().includes("refresh_token"), false);
    assert.equal(rawConnectionKitCsv.toLowerCase().includes("access_token"), false);
    const rawTemplate = await readFile(accountEvidence.launchEvidenceTemplatePath, "utf8");
    assert.ok(rawTemplate.includes("kind"));
    assert.ok(rawTemplate.includes("sports-daily"));
    assert.ok(rawTemplate.includes("developer_app"));
    assert.ok(rawTemplate.includes("permission"));
    assert.ok(rawTemplate.includes("<profile URL + screenshot/proof note"));

    await writeFile(evidencePath, [
      "status: verified",
      "notes: Cuenta creada con profile URL https://www.instagram.com/sportsdaily/, handle @sportsdaily visible, captura de perfil y 2FA guardado fuera del repo.",
    ].join("\n"));

    const status = await getClipperStatus();
    const evidence = status.accountEvidence.items.find((item) => item.id === "sports-daily-instagram");
    assert.ok(evidence);
    assert.equal(evidence.status, "verified");
    const quickStatus = status.accountEvidence.quickBatchRows.find((item) => item.id === "sports-daily-instagram");
    assert.ok(quickStatus);
    assert.equal(quickStatus.status, "verified");
    assert.ok(quickStatus.evidencePath?.endsWith("sports-daily-instagram.md"));

    const launchTask = status.accountLaunchKit.tasks.find((task) => task.id === "sports-daily-instagram");
    assert.ok(launchTask);
    assert.equal(launchTask.evidenceStatus, "verified");
    assert.notEqual(launchTask.status, "blocked");
  } finally {
    if (previousEvidence === null) await unlink(evidencePath).catch(() => undefined);
    else await writeFile(evidencePath, previousEvidence);
    if (previousJsonEvidence === null) await unlink(evidenceJsonPath).catch(() => undefined);
    else await writeFile(evidenceJsonPath, previousJsonEvidence);
  }
});

test("recordClipperAccountEvidence writes JSON evidence and unlocks launch task", async () => {
  const statusBefore = await getClipperStatus();
  const evidencePath = `${statusBefore.accountEvidence.evidenceDir}/meme-radar-youtube.json`;
  const previousOwnerProgress = await readFile(statusBefore.ownerConnectPack.progressRecordsPath, "utf8").catch(() => null);

  try {
    const { accountEvidence, status } = await recordClipperAccountEvidence({
      accountId: "meme-radar",
      platform: "youtube",
      status: "verified",
      notes: "Cuenta YouTube creada con handle @memeradar y profile URL https://youtube.com/@memeradar; 2FA guardado fuera del repo.",
    });
    const evidence = accountEvidence.items.find((item) => item.id === "meme-radar-youtube");
    assert.ok(evidence);
    assert.equal(evidence.status, "verified");
    assert.ok(evidence.evidencePath.endsWith("meme-radar-youtube.json"));

    const launchTask = status.accountLaunchKit.tasks.find((task) => task.id === "meme-radar-youtube");
    assert.ok(launchTask);
    assert.equal(launchTask.evidenceStatus, "verified");
    assert.ok(status.ownerConnectPack.items.some((item) =>
      item.id === "external-session-handoff-account-meme-radar-youtube" &&
      item.progressStatus === "done" &&
      item.progressEvidenceRows.some((row) => row.includes("meme-radar") && row.includes("youtube"))
    ));

    const raw = await readFile(evidencePath, "utf8");
    assert.equal(raw.includes("https://youtube.com/@memeradar"), true);

    await assert.rejects(
      () => recordClipperAccountEvidence({
        accountId: "meme-radar",
        platform: "youtube",
        status: "verified",
        notes: "<real handle + profile URL + 2FA/security proof + screenshot/proof URL>",
      }),
      /requiere evidencia real/
    );
    await assert.rejects(
      () => recordClipperAccountEvidence({
        accountId: "meme-radar",
        platform: "youtube",
        status: "verified",
        notes: "YouTube account @memeradar verified for test with profile proof and 2FA.",
      }),
      /requiere evidencia real/
    );
  } finally {
    await unlink(evidencePath).catch(() => undefined);
    if (previousOwnerProgress === null) await unlink(statusBefore.ownerConnectPack.progressRecordsPath).catch(() => undefined);
    else await writeFile(statusBefore.ownerConnectPack.progressRecordsPath, previousOwnerProgress);
  }
});

test("prepareClipperDeveloperAppEvidenceVault writes templates and reads approved app evidence", async () => {
  const { developerAppEvidence } = await prepareClipperDeveloperAppEvidenceVault();
  const evidencePath = `${developerAppEvidence.evidenceDir}/tiktok.json`;

  try {
    assert.equal(developerAppEvidence.totals.expected, 3);
    assert.ok(developerAppEvidence.readmePath.endsWith("developer-app-evidence/README.md"));
    assert.ok(developerAppEvidence.templateDir.endsWith("developer-app-evidence/templates"));
    assert.ok(developerAppEvidence.connectionKitManifestPath.endsWith("developer-app-evidence/developer-app-connection-kit.json"));
    assert.ok(developerAppEvidence.connectionKitMarkdownPath.endsWith("developer-app-evidence/developer-app-connection-kit.md"));
    assert.ok(developerAppEvidence.connectionKitCsvPath.endsWith("developer-app-evidence/developer-app-connection-kit.csv"));
    assert.ok(developerAppEvidence.connectionKitGeneratedAt);
    assert.equal(developerAppEvidence.connectionKitItems.length, 3);
    assert.equal(developerAppEvidence.connectionKitPlatformBatches.length, 3);
    assert.ok(developerAppEvidence.connectionKitTemplate.startsWith("\"kind\",\"account_id\",\"platform\",\"status\""));
    assert.ok(developerAppEvidence.connectionKitItems.some((item) => item.platform === "tiktok" && item.scopes.includes("video.publish")));
    assert.ok(developerAppEvidence.connectionKitItems.every((item) => item.redirectUri.includes("/api/clippers/oauth/")));
    assert.ok(developerAppEvidence.connectionKitItems.every((item) => item.submittedEvidenceRow.includes("\"developer_app\"")));
    assert.ok(developerAppEvidence.connectionKitPlatformBatches.some((batch) => batch.platform === "tiktok" && batch.submittedDropFilePath.endsWith("developer-app-tiktok-submitted.csv")));
    assert.ok(developerAppEvidence.connectionKitPlatformBatches.every((batch) => batch.approvedDropFilePath.endsWith(`developer-app-${batch.platform}-approved.csv`)));
    assert.ok(developerAppEvidence.connectionKitPlatformBatches.every((batch) => batch.submittedTemplateFilePath.endsWith(`developer-app-${batch.platform}-submitted.csv`)));
    assert.ok(developerAppEvidence.connectionKitPlatformBatches.every((batch) => batch.approvedTemplateFilePath.endsWith(`developer-app-${batch.platform}-approved.csv`)));
    assert.ok(developerAppEvidence.connectionKitPlatformBatches.every((batch) => path.dirname(batch.submittedTemplateFilePath) !== path.dirname(batch.submittedDropFilePath)));
    assert.ok(developerAppEvidence.connectionKitPlatformBatches.every((batch) => batch.submittedDropTemplate.startsWith("kind,account_id,platform,status,scope")));
    assert.ok(developerAppEvidence.connectionKitPlatformBatches.every((batch) => batch.approvedDropTemplate.includes("\"approved\"")));
    assert.ok(developerAppEvidence.connectionKitChecklist.length >= 5);

    const readmeStat = await stat(developerAppEvidence.readmePath);
    const kitManifestStat = await stat(developerAppEvidence.connectionKitManifestPath);
    const kitMarkdownStat = await stat(developerAppEvidence.connectionKitMarkdownPath);
    const kitCsvStat = await stat(developerAppEvidence.connectionKitCsvPath);
    const developerBatch = developerAppEvidence.connectionKitPlatformBatches[0];
    const submittedTemplateStat = await stat(developerBatch.submittedTemplateFilePath);
    const approvedTemplateStat = await stat(developerBatch.approvedTemplateFilePath);
    assert.equal(readmeStat.isFile(), true);
    assert.equal(kitManifestStat.isFile(), true);
    assert.equal(kitMarkdownStat.isFile(), true);
    assert.equal(kitCsvStat.isFile(), true);
    assert.equal(submittedTemplateStat.isFile(), true);
    assert.equal(approvedTemplateStat.isFile(), true);
    const rawKitManifest = await readFile(developerAppEvidence.connectionKitManifestPath, "utf8");
    const rawKitMarkdown = await readFile(developerAppEvidence.connectionKitMarkdownPath, "utf8");
    const rawKitCsv = await readFile(developerAppEvidence.connectionKitCsvPath, "utf8");
    assert.ok(rawKitMarkdown.includes("Clippers Developer App Connection Kit"));
    assert.ok(rawKitMarkdown.includes("Evidence Batch Template"));
    assert.ok(rawKitMarkdown.includes("Platform Batches"));
    assert.ok(rawKitMarkdown.includes("Submitted template file"));
    assert.ok(rawKitMarkdown.includes("Approved template file"));
    assert.ok(rawKitMarkdown.includes("Submitted drop template"));
    assert.ok(rawKitMarkdown.includes("developer-app-tiktok-submitted.csv"));
    assert.ok(rawKitCsv.includes("submitted_evidence_row"));
    assert.ok(rawKitCsv.includes("submitted_template_file_path"));
    assert.ok(rawKitCsv.includes("approved_template_file_path"));
    assert.ok(rawKitCsv.includes("submitted_drop_file_path"));
    assert.ok(rawKitCsv.includes("approved_drop_file_path"));
    assert.ok(rawKitManifest.includes("connectionKitItems"));
    assert.ok(rawKitManifest.includes("connectionKitPlatformBatches"));
    assert.ok(rawKitManifest.includes("submittedTemplateFilePath"));
    const rawSubmittedTemplate = await readFile(developerBatch.submittedTemplateFilePath, "utf8");
    const rawTemplateReadme = await readFile(path.join(path.dirname(developerBatch.submittedTemplateFilePath), "README.md"), "utf8");
    assert.ok(rawSubmittedTemplate.startsWith("kind,account_id,platform,status,scope"));
    assert.ok(rawSubmittedTemplate.includes("<"));
    assert.ok(rawTemplateReadme.includes("safe templates only"));
    assert.equal(rawKitManifest.includes("plain-access-token"), false);
    assert.equal(rawKitManifest.includes("plain-refresh-token"), false);
    assert.equal(rawKitMarkdown.toLowerCase().includes("access_token="), false);
    assert.equal(rawKitCsv.toLowerCase().includes("refresh_token="), false);

    await writeFile(evidencePath, JSON.stringify({
      status: "approved",
      appIdentifier: "test-tiktok-app",
      publicBaseUrl: "https://app.clipprreview.com",
      notes: "App review approved for automated clip publishing tests.",
    }, null, 2));

    const status = await getClipperStatus();
    const app = status.developerAppEvidence.items.find((item) => item.platform === "tiktok");
    assert.ok(app);
    assert.equal(app.status, "approved");
    assert.equal(app.appIdentifier, "test-tiktok-app");
    assert.equal(app.publicBaseUrl, "https://app.clipprreview.com");
    assert.ok(status.growthAudit.items.some((item) => item.id === "developer-app-evidence"));
    assert.ok(status.driveWorkspace.folders.some((folder) => folder.id === "developer-app-evidence"));
  } finally {
    await unlink(evidencePath).catch(() => undefined);
  }
});

test("recordClipperDeveloperAppEvidence writes app evidence without secrets", async () => {
  const statusBefore = await getClipperStatus();
  const evidencePath = `${statusBefore.developerAppEvidence.evidenceDir}/instagram.json`;
  const previousOwnerProgress = await readFile(statusBefore.ownerConnectPack.progressRecordsPath, "utf8").catch(() => null);

  try {
    const { developerAppEvidence, status } = await recordClipperDeveloperAppEvidence({
      platform: "instagram",
      status: "approved",
      appIdentifier: "meta-prod-001",
      publicBaseUrl: "https://app.clipprreview.com",
      notes: "Meta app review approved from test.",
    });
    const app = developerAppEvidence.items.find((item) => item.platform === "instagram");
    assert.ok(app);
    assert.equal(app.status, "approved");
    assert.equal(app.appIdentifier, "meta-prod-001");
    assert.equal(app.publicBaseUrl, "https://app.clipprreview.com");
    assert.ok(status.ownerConnectPack.items.some((item) =>
      item.id === "external-session-handoff-developer-app-instagram" &&
      item.progressStatus === "done" &&
      item.progressEvidenceRows.some((row) => row.includes("meta-prod-001"))
    ));

    const raw = await readFile(evidencePath, "utf8");
    assert.equal(raw.includes("client_secret"), false);
    assert.equal(raw.includes("access_token"), false);

    await assert.rejects(
      () => recordClipperDeveloperAppEvidence({
        platform: "instagram",
        status: "submitted",
        appIdentifier: "<developer app id/client key/project id>",
        publicBaseUrl: "http://127.0.0.1:5010",
        notes: "App creada o enviada a review; pendiente aprobacion.",
      }),
      /requiere evidencia real|URL publica HTTPS/
    );
  } finally {
    await unlink(evidencePath).catch(() => undefined);
    if (previousOwnerProgress === null) await unlink(statusBefore.ownerConnectPack.progressRecordsPath).catch(() => undefined);
    else await writeFile(statusBefore.ownerConnectPack.progressRecordsPath, previousOwnerProgress);
  }
});

test("prepareClipperPermissionTracker writes reviewed permission manifest", async () => {
  await prepareClipperPermissionPack();
  await prepareClipperAccountLaunchKit();
  const { permissionTracker, status } = await prepareClipperPermissionTracker();

  try {
    assert.equal(permissionTracker.items.length, status.permissionQueue.length);
    assert.ok(permissionTracker.trackerPath.endsWith("permission-tracker.json"));
    assert.ok(permissionTracker.markdownPath.endsWith("permission-tracker.md"));
    assert.ok(permissionTracker.items.some((item) => item.scope === "video.publish" && item.docsUrl.includes("developers.tiktok.com")));
    assert.ok(permissionTracker.items.some((item) => item.scope === "https://www.googleapis.com/auth/youtube.upload"));
    assert.ok(permissionTracker.items.every((item) => item.evidenceRequired.length > 0));
    assert.ok(permissionTracker.items.every((item) => item.evidenceBatchRow.startsWith('"permission"')));
    assert.ok(permissionTracker.items.every((item) => item.evidenceRecipeRow.includes("<permission request")));
    assert.ok(status.growthAudit.items.some((item) => item.id === "permission-tracker"));

    const trackerStat = await stat(permissionTracker.trackerPath);
    const markdownStat = await stat(permissionTracker.markdownPath);
    assert.equal(trackerStat.isFile(), true);
    assert.equal(markdownStat.isFile(), true);

    const markdown = await readFile(permissionTracker.markdownPath, "utf8");
    assert.ok(markdown.includes("Clippers Permission Tracker"));
    assert.ok(markdown.includes("Official Sources"));
    assert.ok(markdown.includes("Evidence recipe row"));
  } finally {
    await unlink(permissionTracker.trackerPath).catch(() => undefined);
    await unlink(permissionTracker.markdownPath).catch(() => undefined);
  }
});

test("prepareClipperPermissionRequestPack writes copy-ready scope requests", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.permissionRequestPack.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.permissionRequestPack.markdownPath, "utf8").catch(() => null);
  const previousCsv = await readFile(beforeStatus.permissionRequestPack.csvPath, "utf8").catch(() => null);

  try {
    const { permissionRequestPack, status } = await prepareClipperPermissionRequestPack();
    assert.equal(permissionRequestPack.items.length, status.permissionQueue.length);
    assert.ok(permissionRequestPack.markdownPath.endsWith("permission-request-pack.md"));
    assert.ok(permissionRequestPack.csvPath.endsWith("permission-request-pack.csv"));
    assert.ok(permissionRequestPack.items.some((item) => item.scope === "video.publish" && item.copyReadyJustification.includes("approval_required")));
    assert.ok(permissionRequestPack.items.some((item) => item.scope === "https://www.googleapis.com/auth/youtube.upload"));
    assert.ok(permissionRequestPack.items.some((item) => item.platform === "tiktok" && item.platformConstraints.some((constraint) => constraint.includes("Content Posting API"))));
    assert.ok(permissionRequestPack.items.some((item) => item.platform === "tiktok" && item.auditWarnings.some((warning) => warning.includes("private visibility"))));
    assert.ok(permissionRequestPack.items.some((item) => item.platform === "youtube" && item.platformConstraints.some((constraint) => constraint.includes("youtube.upload"))));
    assert.ok(permissionRequestPack.items.some((item) => item.platform === "youtube" && item.auditWarnings.some((warning) => warning.includes("private only"))));
    assert.ok(permissionRequestPack.items.every((item) => item.reviewerEvidence.some((evidence) => evidence.includes("Privacy Policy"))));
    assert.ok(permissionRequestPack.items.every((item) => item.officialReferenceUrl.startsWith("https://")));
    assert.ok(permissionRequestPack.items.every((item) => item.scopeRequestLine.includes(item.scope)));
    assert.ok(permissionRequestPack.items.every((item) => item.reviewerInstructions.includes("review")));
    assert.ok(permissionRequestPack.items.every((item) => item.officialApprovalChecklist.length >= 3));
    assert.ok(permissionRequestPack.items.every((item) => item.evidenceBatchRow.includes(item.scope)));
    assert.ok(permissionRequestPack.items.every((item) => item.evidenceRecipeRow.includes("<permission request")));
    assert.equal(permissionRequestPack.platformBatches.length, 3);
    assert.equal(permissionRequestPack.totals.platformBatches, permissionRequestPack.platformBatches.length);
    assert.ok(permissionRequestPack.platformBatches.some((batch) => batch.platform === "tiktok" && batch.scopes.includes("video.publish")));
    assert.ok(permissionRequestPack.platformBatches.every((batch) => batch.copyBlock.includes("Requested scopes")));
    assert.ok(permissionRequestPack.platformBatches.every((batch) => batch.evidenceRecipeRows.length === batch.permissions));
    assert.ok(permissionRequestPack.platformBatches.every((batch) => batch.requestedEvidenceRows.every((row) => row.includes("\"requested\""))));
    assert.ok(permissionRequestPack.platformBatches.every((batch) => batch.approvedEvidenceRows.every((row) => row.includes("\"approved\""))));
    assert.ok(permissionRequestPack.platformBatches.every((batch) => batch.requestedDropFilePath.endsWith(`permission-${batch.platform}-requested.csv`)));
    assert.ok(permissionRequestPack.platformBatches.every((batch) => batch.approvedDropFilePath.endsWith(`permission-${batch.platform}-approved.csv`)));
    assert.ok(permissionRequestPack.platformBatches.every((batch) => batch.requestedTemplateFilePath.endsWith(`permission-${batch.platform}-requested.csv`)));
    assert.ok(permissionRequestPack.platformBatches.every((batch) => batch.approvedTemplateFilePath.endsWith(`permission-${batch.platform}-approved.csv`)));
    assert.ok(permissionRequestPack.platformBatches.every((batch) => path.dirname(batch.requestedTemplateFilePath) !== path.dirname(batch.requestedDropFilePath)));
    assert.ok(permissionRequestPack.platformBatches.every((batch) => path.dirname(batch.approvedTemplateFilePath) !== path.dirname(batch.approvedDropFilePath)));
    assert.ok(permissionRequestPack.platformBatches.every((batch) => batch.requestedDropTemplate.startsWith("kind,account_id,platform,status,scope")));
    assert.ok(permissionRequestPack.platformBatches.every((batch) => batch.approvedDropTemplate.includes("\"approved\"")));
    assert.ok(permissionRequestPack.platformBatches.every((batch) => batch.submissionSteps.length >= 5));
    assert.ok(permissionRequestPack.platformBatches.every((batch) => batch.doneCriteria.length >= 3));
    assert.ok(permissionRequestPack.items.some((item) => item.requestReadiness === "blocked"));
    assert.ok(status.commandCenter.steps.some((step) => step.id === "permission-request-pack" && step.actionUrl === "/api/clippers/prepare-permission-request-pack"));
    assert.ok(status.growthAudit.items.some((item) => item.id === "permission-request-pack"));

    const rawMarkdown = await readFile(permissionRequestPack.markdownPath, "utf8");
    const rawCsv = await readFile(permissionRequestPack.csvPath, "utf8");
    const firstBatch = permissionRequestPack.platformBatches[0];
    const requestedTemplateRaw = await readFile(firstBatch.requestedTemplateFilePath, "utf8");
    const approvedTemplateRaw = await readFile(firstBatch.approvedTemplateFilePath, "utf8");
    const templateReadmeRaw = await readFile(path.join(path.dirname(firstBatch.requestedTemplateFilePath), "README.md"), "utf8");
    assert.ok(rawMarkdown.includes("Clippers Permission Request Pack"));
    assert.ok(rawMarkdown.includes("Copy-ready justification"));
    assert.ok(rawMarkdown.includes("Platform Submission Batches"));
    assert.ok(rawMarkdown.includes("Reviewer instructions"));
    assert.ok(rawMarkdown.includes("Official approval checklist"));
    assert.ok(rawMarkdown.includes("Evidence recipe row"));
    assert.ok(rawMarkdown.includes("Requested drop template"));
    assert.ok(rawMarkdown.includes("Approved drop template"));
    assert.ok(rawMarkdown.includes("permission-tiktok-requested.csv"));
    assert.ok(rawMarkdown.includes("Requested template file"));
    assert.ok(rawMarkdown.includes("Approved template file"));
    assert.ok(rawMarkdown.includes("Platform constraints"));
    assert.ok(rawMarkdown.includes("Audit / go-live warnings"));
    assert.ok(rawCsv.includes("developer_portal"));
    assert.ok(rawCsv.includes("platform_batch_id"));
    assert.ok(rawCsv.includes("request_readiness"));
    assert.ok(rawCsv.includes("official_reference_url"));
    assert.ok(rawCsv.includes("requested_template_file_path"));
    assert.ok(rawCsv.includes("approved_template_file_path"));
    assert.ok(rawCsv.includes("requested_drop_file_path"));
    assert.ok(rawCsv.includes("approved_drop_file_path"));
    assert.ok(rawCsv.includes("reviewer_instructions"));
    assert.ok(rawCsv.includes("platform_constraints"));
    assert.ok(rawCsv.includes("audit_warnings"));
    assert.ok(requestedTemplateRaw.startsWith("kind,account_id,platform,status,scope"));
    assert.ok(requestedTemplateRaw.includes("<permission request/review URL"));
    assert.ok(approvedTemplateRaw.includes("\"approved\""));
    assert.ok(templateReadmeRaw.includes("safe templates only"));
    assert.equal(rawMarkdown.includes("client_secret"), false);
    assert.equal(rawCsv.includes("access_token"), false);
  } finally {
    if (previousManifest === null) await unlink(beforeStatus.permissionRequestPack.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.permissionRequestPack.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.permissionRequestPack.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.permissionRequestPack.markdownPath, previousMarkdown);
    if (previousCsv === null) await unlink(beforeStatus.permissionRequestPack.csvPath).catch(() => undefined);
    else await writeFile(beforeStatus.permissionRequestPack.csvPath, previousCsv);
  }
});

test("recordClipperPermissionStatus persists permission review status without secrets", async () => {
  const recordsPath = __clipperInternals.permissionStatusRecordsPath;
  const statusBefore = await getClipperStatus();
  const previousRecords = await readFile(recordsPath, "utf8").catch(() => null);
  const previousOwnerProgress = await readFile(statusBefore.ownerConnectPack.progressRecordsPath, "utf8").catch(() => null);

  try {
    const { permissionStatusRecord, permissionTracker, status } = await recordClipperPermissionStatus({
      platform: "tiktok",
      scope: "video.publish",
      status: "approved",
      notes: "App review approved in TikTok portal; no secret values stored.",
    });

    assert.equal(permissionStatusRecord.status, "approved");
    assert.equal(permissionStatusRecord.scope, "video.publish");
    assert.ok(permissionTracker.items.some((item) =>
      item.platform === "tiktok" &&
      item.scope === "video.publish" &&
      item.status === "approved" &&
      item.statusSource === "manual_record"
    ));
    assert.ok(status.permissionTracker.totals.approved >= 1);
    assert.ok(status.ownerConnectPack.items.some((item) =>
      item.id === "external-session-handoff-permission-tiktok-video.publish" &&
      item.progressStatus === "done" &&
      item.progressEvidenceRows.some((row) => row.includes("video.publish"))
    ));

    const raw = await readFile(recordsPath, "utf8");
    assert.ok(raw.includes("video.publish"));
    assert.equal(raw.includes("client_secret"), false);
    assert.equal(raw.includes("access_token"), false);

    await assert.rejects(
      () => recordClipperPermissionStatus({
        platform: "tiktok",
        scope: "video.publish",
        status: "requested",
        notes: "Solicitado en developer portal.",
      }),
      /Permission notes requiere evidencia real/
    );
  } finally {
    if (previousRecords === null) {
      await unlink(recordsPath).catch(() => undefined);
    } else {
      await writeFile(recordsPath, previousRecords);
    }
    if (previousOwnerProgress === null) await unlink(statusBefore.ownerConnectPack.progressRecordsPath).catch(() => undefined);
    else await writeFile(statusBefore.ownerConnectPack.progressRecordsPath, previousOwnerProgress);
  }
});

test("previewClipperLaunchEvidenceBatch validates rows without writing evidence", async () => {
  const recordsPath = __clipperInternals.permissionStatusRecordsPath;
  const statusBefore = await getClipperStatus();
  const accountPath = `${statusBefore.accountEvidence.evidenceDir}/sports-daily-instagram.json`;
  const appPath = `${statusBefore.developerAppEvidence.evidenceDir}/instagram.json`;
  const memeFolder = statusBefore.sourceFolders.find((folder) => folder.category === "memes");
  const allowlistFolder = statusBefore.sourceFolders.find((folder) => folder.category === "allowlist");
  assert.ok(memeFolder);
  assert.ok(allowlistFolder);
  const sourcePath = `${memeFolder.path}/preview-rights.mp4`;
  const evidencePath = `${allowlistFolder.path}/preview-rights.md`;
  const previousAccount = await readFile(accountPath, "utf8").catch(() => null);
  const previousApp = await readFile(appPath, "utf8").catch(() => null);
  const previousRecords = await readFile(recordsPath, "utf8").catch(() => null);
  const previousEvidence = await readFile(evidencePath, "utf8").catch(() => null);
  await mkdir(memeFolder.path, { recursive: true });
  writeTinyTestVideo(sourcePath);
  await unlink(accountPath).catch(() => undefined);
  await unlink(appPath).catch(() => undefined);

  try {
    const { launchEvidenceBatchPreview, status } = await previewClipperLaunchEvidenceBatch({
      batchText: [
        "kind,account_id,platform,status,scope,app_identifier,public_base_url,notes",
        "account,sports-daily,instagram,verified,,,,Instagram account verified with profile screenshot",
        "developer_app,,instagram,submitted,,meta-prod-001,https://app.clipprreview.com,Meta app submitted for review",
        "permission,,instagram,requested,instagram_content_publish,,,Meta scope requested with review ticket",
        "source_rights,preview-rights.mp4,memes,owned_or_permissioned,preview-rights.mp4,,,Creator permission confirmed in writing; proof stored in secure drive under creator approval record",
        "permission,,instagram,requested,not.real.scope,,,Bad scope should reject",
        "permission,,tiktok,requested,video.publish,,,TikTok Content Posting API requested; attach app review evidence",
        "developer_app,,tiktok,submitted,,tiktok-app-id,http://127.0.0.1:5010,TikTok app review submitted with portal proof",
        "source_rights,preview-rights.mp4,memes,owned_or_permissioned,preview-rights.mp4,,,Permission confirmed",
      ].join("\n"),
    });

    assert.deepEqual(launchEvidenceBatchPreview.accepted, { accountEvidence: 1, developerApps: 1, permissions: 1, sourceRights: 1 });
    assert.equal(launchEvidenceBatchPreview.rejected.length, 4);
    assert.equal(launchEvidenceBatchPreview.rejected[0].kind, "permission");
    assert.ok(launchEvidenceBatchPreview.rejected.some((item) => item.reason.includes("requiere evidencia real")));
    assert.ok(launchEvidenceBatchPreview.rejected.some((item) => item.kind === "developer_app" && item.reason.includes("URL publica HTTPS")));
    assert.ok(launchEvidenceBatchPreview.rejected.some((item) => item.kind === "source_rights" && item.reason.includes("evidencia concreta")));
    assert.ok(launchEvidenceBatchPreview.nextStep.includes("Preview listo"));
    assert.equal(status.accountEvidence.items.some((item) => item.id === "sports-daily-instagram" && item.status === "verified"), false);

    const nextAccount = await readFile(accountPath, "utf8").catch(() => null);
    const nextApp = await readFile(appPath, "utf8").catch(() => null);
    const nextRecords = await readFile(recordsPath, "utf8").catch(() => null);
    const nextEvidence = await readFile(evidencePath, "utf8").catch(() => null);
    assert.equal(nextAccount, null);
    assert.equal(nextApp, null);
    assert.equal(nextRecords, previousRecords);
    assert.equal(nextEvidence, previousEvidence);
  } finally {
    await unlink(sourcePath).catch(() => undefined);
    if (previousEvidence === null) await unlink(evidencePath).catch(() => undefined);
    else await writeFile(evidencePath, previousEvidence);
    if (previousAccount === null) await unlink(accountPath).catch(() => undefined);
    else await writeFile(accountPath, previousAccount);
    if (previousApp === null) await unlink(appPath).catch(() => undefined);
    else await writeFile(appPath, previousApp);
    if (previousRecords === null) await unlink(recordsPath).catch(() => undefined);
    else await writeFile(recordsPath, previousRecords);
  }
});

test("recordClipperLaunchEvidenceBatch imports account app and permission evidence", async () => {
  const recordsPath = __clipperInternals.permissionStatusRecordsPath;
  const statusBefore = await getClipperStatus();
  const accountPath = `${statusBefore.accountEvidence.evidenceDir}/sports-daily-tiktok.json`;
  const appPath = `${statusBefore.developerAppEvidence.evidenceDir}/youtube.json`;
  const streamerFolder = statusBefore.sourceFolders.find((folder) => folder.category === "streamers");
  const allowlistFolder = statusBefore.sourceFolders.find((folder) => folder.category === "allowlist");
  assert.ok(streamerFolder);
  assert.ok(allowlistFolder);
  const sourcePath = `${streamerFolder.path}/launch-import-streamer.mp4`;
  const evidencePath = `${allowlistFolder.path}/launch-import-streamer.md`;
  const previousAccount = await readFile(accountPath, "utf8").catch(() => null);
  const previousApp = await readFile(appPath, "utf8").catch(() => null);
  const previousRecords = await readFile(recordsPath, "utf8").catch(() => null);
  const previousOwnerProgress = await readFile(statusBefore.ownerConnectPack.progressRecordsPath, "utf8").catch(() => null);
  const previousEvidence = await readFile(evidencePath, "utf8").catch(() => null);
  await mkdir(streamerFolder.path, { recursive: true });
  writeTinyTestVideo(sourcePath);

  try {
    const { launchEvidenceBatch, status } = await recordClipperLaunchEvidenceBatch({
      batchText: [
        "kind,account_id,platform,status,scope,app_identifier,public_base_url,notes",
        "account,sports-daily,tiktok,verified,,,,TikTok account handle @sportsdaily verified with profile URL https://www.tiktok.com/@sportsdaily and 2FA proof saved",
        "developer_app,,youtube,submitted,,youtube-prod-001,https://app.clipprreview.com,YouTube API app review submitted in Google Cloud portal with review ticket YT-123",
        "permission,,tiktok,requested,video.publish,,,TikTok scope requested",
        "source_rights,launch-import-streamer.mp4,streamers,owned_or_permissioned,launch-import-streamer.mp4,,,Creator permission confirmed for launch import; proof stored in secure drive",
        "permission,,tiktok,approved,not.real.scope,,,Bad scope should reject",
        "account,meme-radar,tiktok,verified,,,,Meme Radar handle=<handle>; verified=<proof link or note>",
        "developer_app,,instagram,submitted,,meta-app-id,http://localhost:5010,Meta app review submitted with portal proof",
        "source_rights,launch-import-streamer.mp4,streamers,owned_or_permissioned,launch-import-streamer.mp4,,,Permission confirmed",
      ].join("\n"),
    });

    assert.deepEqual(launchEvidenceBatch.accepted, { accountEvidence: 1, developerApps: 1, permissions: 1, sourceRights: 1 });
    assert.equal(launchEvidenceBatch.rejected.length, 4);
    assert.equal(launchEvidenceBatch.rejected[0].kind, "permission");
    assert.ok(launchEvidenceBatch.rejected.some((item) => item.reason.includes("requiere evidencia real")));
    assert.ok(launchEvidenceBatch.rejected.some((item) => item.kind === "developer_app" && item.reason.includes("URL publica HTTPS")));
    assert.ok(launchEvidenceBatch.rejected.some((item) => item.kind === "source_rights" && item.reason.includes("evidencia concreta")));
    assert.ok(status.accountEvidence.items.some((item) => item.id === "sports-daily-tiktok" && item.status === "verified"));
    assert.ok(status.developerAppEvidence.items.some((item) => item.platform === "youtube" && item.status === "submitted"));
    assert.ok(status.permissionTracker.items.some((item) => item.platform === "tiktok" && item.scope === "video.publish" && item.status === "requested"));
    assert.ok(status.productionQueue.sourceAssets.some((item) => item.fileName === "launch-import-streamer.mp4" && item.rightsStatus === "owned_or_permissioned"));
    assert.ok(status.ownerConnectPack.items.some((item) =>
      item.id === "external-session-handoff-account-sports-daily-tiktok"
      && item.progressStatus === "done"
      && item.progressEvidenceRows.some((row) => row.includes("sports-daily") && row.includes("tiktok"))
    ));
    assert.ok(status.ownerConnectPack.items.some((item) =>
      item.id === "external-session-handoff-developer-app-youtube"
      && item.progressStatus === "waiting"
      && item.progressEvidenceRows.some((row) => row.includes("youtube-prod-001"))
    ));
    assert.ok(status.ownerConnectPack.items.some((item) =>
      item.id === "external-session-handoff-permission-tiktok-video.publish"
      && item.progressStatus === "waiting"
      && item.progressEvidenceRows.some((row) => row.includes("video.publish"))
    ));

    const rawAccount = await readFile(accountPath, "utf8");
    const rawApp = await readFile(appPath, "utf8");
    const rawEvidence = await readFile(evidencePath, "utf8");
    const rawOwnerProgress = await readFile(statusBefore.ownerConnectPack.progressRecordsPath, "utf8");
    assert.ok(rawOwnerProgress.includes("external-session-handoff-account-sports-daily-tiktok"));
    assert.ok(rawOwnerProgress.includes("external-session-handoff-developer-app-youtube"));
    assert.ok(rawOwnerProgress.includes("external-session-handoff-permission-tiktok-video.publish"));
    assert.ok(rawEvidence.includes("launch-import-streamer.mp4"));
    const responseJson = JSON.stringify(launchEvidenceBatch);
    for (const forbidden of ["client_secret", "access_token", "plain-refresh-token"]) {
      assert.equal(rawAccount.includes(forbidden), false);
      assert.equal(rawApp.includes(forbidden), false);
      assert.equal(rawEvidence.includes(forbidden), false);
      assert.equal(rawOwnerProgress.includes(forbidden), false);
      assert.equal(responseJson.includes(forbidden), false);
    }
  } finally {
    await unlink(sourcePath).catch(() => undefined);
    if (previousEvidence === null) await unlink(evidencePath).catch(() => undefined);
    else await writeFile(evidencePath, previousEvidence);
    if (previousAccount === null) await unlink(accountPath).catch(() => undefined);
    else await writeFile(accountPath, previousAccount);
    if (previousApp === null) await unlink(appPath).catch(() => undefined);
    else await writeFile(appPath, previousApp);
    if (previousRecords === null) await unlink(recordsPath).catch(() => undefined);
    else await writeFile(recordsPath, previousRecords);
    if (previousOwnerProgress === null) await unlink(statusBefore.ownerConnectPack.progressRecordsPath).catch(() => undefined);
    else await writeFile(statusBefore.ownerConnectPack.progressRecordsPath, previousOwnerProgress);
  }
});

test("recordClipperLaunchEvidenceBatch strict mode blocks partial writes", async () => {
  const statusBefore = await getClipperStatus();
  const accountPath = `${statusBefore.accountEvidence.evidenceDir}/meme-radar-youtube.json`;
  const previousAccount = await readFile(accountPath, "utf8").catch(() => null);

  try {
    await unlink(accountPath).catch(() => undefined);
    const { launchEvidenceBatch, status } = await recordClipperLaunchEvidenceBatch({
      strict: true,
      batchText: [
        "kind,account_id,platform,status,scope,app_identifier,public_base_url,notes",
        "account,meme-radar,youtube,verified,,,,YouTube account handle @memeradar verified with channel URL https://www.youtube.com/@memeradar and 2FA proof saved",
        "permission,,tiktok,approved,not.real.scope,,,Bad scope should reject",
      ].join("\n"),
    });

    assert.equal(launchEvidenceBatch.strictImport, true);
    assert.equal(launchEvidenceBatch.strictBlocked, true);
    assert.equal(launchEvidenceBatch.accepted.accountEvidence, 1);
    assert.equal(launchEvidenceBatch.rejected.length, 1);
    assert.ok(launchEvidenceBatch.nextStep.includes("No escribi evidencia parcial"));
    assert.equal(await readFile(accountPath, "utf8").catch(() => null), null);
    assert.equal(status.accountEvidence.items.some((item) => item.id === "meme-radar-youtube" && item.status === "verified"), false);
  } finally {
    if (previousAccount === null) await unlink(accountPath).catch(() => undefined);
    else await writeFile(accountPath, previousAccount);
  }
});

test("importClipperLaunchEvidenceDropFiles imports CSV evidence files from evidence-drop", async () => {
  const recordsPath = __clipperInternals.permissionStatusRecordsPath;
  const statusBefore = await getClipperStatus();
  const dropDir = path.join(statusBefore.rootDir, "evidence-drop");
  const dropPath = path.join(dropDir, "launch-evidence-drop.test.csv");
  const localDropSyncTestPath = path.join(dropDir, "local-drop-sync-launch-evidence.test.csv");
  const ownerConnectEvidenceDropPath = path.join(dropDir, "owner-connect-evidence.csv");
  const accountPath = `${statusBefore.accountEvidence.evidenceDir}/streamer-pulse-instagram.json`;
  const appPath = `${statusBefore.developerAppEvidence.evidenceDir}/tiktok.json`;
  const previousAccount = await readFile(accountPath, "utf8").catch(() => null);
  const previousApp = await readFile(appPath, "utf8").catch(() => null);
  const previousRecords = await readFile(recordsPath, "utf8").catch(() => null);
  const previousOwnerConnectEvidenceDrop = await readFile(ownerConnectEvidenceDropPath, "utf8").catch(() => null);
  const previousLocalDropSyncTest = await readFile(localDropSyncTestPath, "utf8").catch(() => null);
  const previousOwnerProgress = await readFile(statusBefore.ownerConnectPack.progressRecordsPath, "utf8").catch(() => null);
  const previousDiagnostic = await readFile(statusBefore.launchEvidenceDropDiagnostic.manifestPath, "utf8").catch(() => null);
  const previousDiagnosticMarkdown = await readFile(statusBefore.launchEvidenceDropDiagnostic.markdownPath, "utf8").catch(() => null);
  const previousRepairWorksheet = await readFile(statusBefore.launchEvidenceDropDiagnostic.repairWorksheetCsvPath, "utf8").catch(() => null);
  await mkdir(dropDir, { recursive: true });
  await unlink(localDropSyncTestPath).catch(() => undefined);
  await unlink(ownerConnectEvidenceDropPath).catch(() => undefined);
  await writeFile(dropPath, [
    "kind,account_id,platform,status,scope,app_identifier,public_base_url,notes",
    "account,streamer-pulse,instagram,verified,,,,Instagram account handle @streamerpulse verified with profile URL https://www.instagram.com/streamerpulse/ and screenshot proof saved",
    "developer_app,,tiktok,submitted,,tiktok-content-api-prod-001,https://clips.robertmanzanilla.com,TikTok app review submitted in developer portal; proof stored in secure Drive folder and screenshot evidence saved outside repo",
    "permission,,youtube,requested,https://www.googleapis.com/auth/youtube.upload,,,YouTube upload scope requested in Google Cloud; review ticket YT-UPLOAD-123 and screenshot proof saved in Drive",
  ].join("\n"));

  try {
    const { launchEvidenceDropImport, status } = await importClipperLaunchEvidenceDropFiles();
    assert.deepEqual(launchEvidenceDropImport.accepted, { accountEvidence: 1, developerApps: 1, permissions: 1, sourceRights: 0 });
    assert.equal(launchEvidenceDropImport.filesScanned, 1);
    assert.equal(launchEvidenceDropImport.filesImported, 1);
    assert.ok(launchEvidenceDropImport.sourceFiles?.some((file) => file.endsWith("launch-evidence-drop.test.csv")));
    assert.equal(launchEvidenceDropImport.rejected.length, 0);
    assert.equal(launchEvidenceDropImport.fileErrors?.length || 0, 0);
    assert.ok(status.accountEvidence.items.some((item) => item.id === "streamer-pulse-instagram" && item.status === "verified"));
    assert.ok(status.developerAppEvidence.items.some((item) => item.platform === "tiktok" && item.status === "submitted"));
    assert.ok(status.permissionTracker.items.some((item) =>
      item.platform === "youtube" &&
      item.scope === "https://www.googleapis.com/auth/youtube.upload" &&
      item.status === "requested"
    ));

    const responseJson = JSON.stringify(launchEvidenceDropImport);
    assert.equal(responseJson.includes("client_secret"), false);
    assert.equal(responseJson.includes("access_token"), false);
  } finally {
    await unlink(dropPath).catch(() => undefined);
    if (previousLocalDropSyncTest === null) await unlink(localDropSyncTestPath).catch(() => undefined);
    else await writeFile(localDropSyncTestPath, previousLocalDropSyncTest);
    if (previousAccount === null) await unlink(accountPath).catch(() => undefined);
    else await writeFile(accountPath, previousAccount);
    if (previousApp === null) await unlink(appPath).catch(() => undefined);
    else await writeFile(appPath, previousApp);
    if (previousRecords === null) await unlink(recordsPath).catch(() => undefined);
    else await writeFile(recordsPath, previousRecords);
    if (previousOwnerConnectEvidenceDrop === null) await unlink(ownerConnectEvidenceDropPath).catch(() => undefined);
    else await writeFile(ownerConnectEvidenceDropPath, previousOwnerConnectEvidenceDrop);
    if (previousOwnerProgress === null) await unlink(statusBefore.ownerConnectPack.progressRecordsPath).catch(() => undefined);
    else await writeFile(statusBefore.ownerConnectPack.progressRecordsPath, previousOwnerProgress);
    if (previousDiagnostic === null) await unlink(statusBefore.launchEvidenceDropDiagnostic.manifestPath).catch(() => undefined);
    else await writeFile(statusBefore.launchEvidenceDropDiagnostic.manifestPath, previousDiagnostic);
    if (previousDiagnosticMarkdown === null) await unlink(statusBefore.launchEvidenceDropDiagnostic.markdownPath).catch(() => undefined);
    else await writeFile(statusBefore.launchEvidenceDropDiagnostic.markdownPath, previousDiagnosticMarkdown);
    if (previousRepairWorksheet === null) await unlink(statusBefore.launchEvidenceDropDiagnostic.repairWorksheetCsvPath).catch(() => undefined);
    else await writeFile(statusBefore.launchEvidenceDropDiagnostic.repairWorksheetCsvPath, previousRepairWorksheet);
  }
});

test("importClipperLaunchEvidenceDropFiles ignores Metricool approval evidence template", async () => {
  const statusBefore = await getClipperStatus();
  const dropDir = path.join(statusBefore.rootDir, "evidence-drop");
  const metricoolEvidencePath = path.join(dropDir, "metricool-approval-evidence-import.csv");
  const controlDropPath = path.join(dropDir, "launch-evidence-drop-metricool-ignore-control.test.csv");
  const noisyDropPaths = [
    path.join(dropDir, "owner-connect-evidence.fixpack.csv"),
    path.join(dropDir, "owner-connect-evidence.workbook.csv"),
    path.join(dropDir, "external-closeout-evidence-import.csv"),
  ];
  const accountPath = `${statusBefore.accountEvidence.evidenceDir}/streamer-pulse-youtube.json`;
  const previousMetricoolEvidence = await readFile(metricoolEvidencePath, "utf8").catch(() => null);
  const previousControlDrop = await readFile(controlDropPath, "utf8").catch(() => null);
  const previousNoisyDrops = await Promise.all(noisyDropPaths.map(async (filePath) => ({
    filePath,
    raw: await readFile(filePath, "utf8").catch(() => null),
  })));
  const previousAccount = await readFile(accountPath, "utf8").catch(() => null);
  const previousDiagnostic = await readFile(statusBefore.launchEvidenceDropDiagnostic.manifestPath, "utf8").catch(() => null);
  const previousDiagnosticMarkdown = await readFile(statusBefore.launchEvidenceDropDiagnostic.markdownPath, "utf8").catch(() => null);
  const previousRepairWorksheet = await readFile(statusBefore.launchEvidenceDropDiagnostic.repairWorksheetCsvPath, "utf8").catch(() => null);
  await mkdir(dropDir, { recursive: true });
  await Promise.all(noisyDropPaths.map((filePath) => unlink(filePath).catch(() => undefined)));
  await writeFile(controlDropPath, [
    "kind,account_id,platform,status,scope,app_identifier,public_base_url,notes",
    "account,streamer-pulse,youtube,verified,,,,Streamer Pulse YouTube account verified with channel URL https://www.youtube.com/@streamerpulse and proof screenshot saved outside repo",
  ].join("\n"));
  await writeFile(metricoolEvidencePath, [
    "metricool_queue_item_id,account_id,account_name,platform,metricool_brand_name,metricool_blog_id,scheduled_for,source_path,caption_seed,metricool_approval_url,published_post_url,final_status,views_24h,likes_24h,comments_24h,shares_24h,operator_notes",
    "metricool-test-001,sports-daily,Sports Daily Clips,tiktok,SPORT,6431687,2026-06-21T12:00:00.000Z,/tmp/source.mp4,Caption,<Metricool approval/scheduled URL after Robert approves>,<published post URL after live>,<approved|scheduled|published|rejected>,<views after 24h>,<likes after 24h>,<comments after 24h>,<shares after 24h>,<operator notes without tokens>",
  ].join("\n"));
  await writeFile(path.join(dropDir, "external-closeout-evidence-import.csv"), [
    "kind,account_id,platform,status,scope,app_identifier,public_base_url,redirect_uri,portal_url,docs_url,proof,notes",
    "permission,,tiktok,requested,video.publish,,,,https://developers.tiktok.com/,,<proof>,External closeout CSV should be ignored by generic launch evidence import",
  ].join("\n"));

  try {
    const { launchEvidenceDropImport } = await importClipperLaunchEvidenceDropFiles();
    assert.ok(launchEvidenceDropImport.sourceFiles?.some((file) => file.endsWith("launch-evidence-drop-metricool-ignore-control.test.csv")));
    assert.equal(launchEvidenceDropImport.sourceFiles?.some((file) => file.endsWith("metricool-approval-evidence-import.csv")), false);
    assert.equal(launchEvidenceDropImport.sourceFiles?.some((file) => file.endsWith("external-closeout-evidence-import.csv")), false);
    assert.equal(launchEvidenceDropImport.rejected.some((row) => row.identifier?.includes("metricool-test-001")), false);
  } finally {
    if (previousControlDrop === null) await unlink(controlDropPath).catch(() => undefined);
    else await writeFile(controlDropPath, previousControlDrop);
    for (const { filePath, raw } of previousNoisyDrops) {
      if (raw === null) await unlink(filePath).catch(() => undefined);
      else await writeFile(filePath, raw);
    }
    if (previousAccount === null) await unlink(accountPath).catch(() => undefined);
    else await writeFile(accountPath, previousAccount);
    if (previousMetricoolEvidence === null) await unlink(metricoolEvidencePath).catch(() => undefined);
    else await writeFile(metricoolEvidencePath, previousMetricoolEvidence);
    if (previousDiagnostic === null) await unlink(statusBefore.launchEvidenceDropDiagnostic.manifestPath).catch(() => undefined);
    else await writeFile(statusBefore.launchEvidenceDropDiagnostic.manifestPath, previousDiagnostic);
    if (previousDiagnosticMarkdown === null) await unlink(statusBefore.launchEvidenceDropDiagnostic.markdownPath).catch(() => undefined);
    else await writeFile(statusBefore.launchEvidenceDropDiagnostic.markdownPath, previousDiagnosticMarkdown);
    if (previousRepairWorksheet === null) await unlink(statusBefore.launchEvidenceDropDiagnostic.repairWorksheetCsvPath).catch(() => undefined);
    else await writeFile(statusBefore.launchEvidenceDropDiagnostic.repairWorksheetCsvPath, previousRepairWorksheet);
  }
});

test("importClipperLaunchEvidenceDropFiles blocks dirty evidence-drop without writing partial evidence", async () => {
  const statusBefore = await getClipperStatus();
  const dropDir = path.join(statusBefore.rootDir, "evidence-drop");
  const dropPath = path.join(dropDir, "launch-evidence-drop-blocked.test.csv");
  const ownerConnectEvidenceDropPath = path.join(dropDir, "owner-connect-evidence.csv");
  const accountPath = `${statusBefore.accountEvidence.evidenceDir}/sports-daily-youtube.json`;
  const previousAccount = await readFile(accountPath, "utf8").catch(() => null);
  const previousOwnerConnectEvidenceDrop = await readFile(ownerConnectEvidenceDropPath, "utf8").catch(() => null);
  const previousDiagnostic = await readFile(statusBefore.launchEvidenceDropDiagnostic.manifestPath, "utf8").catch(() => null);
  const previousDiagnosticMarkdown = await readFile(statusBefore.launchEvidenceDropDiagnostic.markdownPath, "utf8").catch(() => null);
  const previousRepairWorksheet = await readFile(statusBefore.launchEvidenceDropDiagnostic.repairWorksheetCsvPath, "utf8").catch(() => null);
  await mkdir(dropDir, { recursive: true });
  await unlink(ownerConnectEvidenceDropPath).catch(() => undefined);
  await unlink(accountPath).catch(() => undefined);
  await writeFile(dropPath, [
    "kind,account_id,platform,status,scope,app_identifier,public_base_url,notes",
    "account,sports-daily,youtube,verified,,,,<real handle + profile URL + screenshot proof>",
  ].join("\n"));

  try {
    const { launchEvidenceDropImport, status } = await importClipperLaunchEvidenceDropFiles();
    assert.equal(launchEvidenceDropImport.strictBlocked, true);
    assert.equal(launchEvidenceDropImport.filesImported, 0);
    assert.ok(launchEvidenceDropImport.nextStep.includes("No escribi evidencia parcial"));
    assert.ok(launchEvidenceDropImport.nextStep.includes("launch-evidence-drop-repair-worksheet.csv"));
    assert.equal(await readFile(accountPath, "utf8").catch(() => null), null);
    assert.equal(status.accountEvidence.items.some((item) => item.id === "sports-daily-youtube" && item.status === "verified"), false);
  } finally {
    await unlink(dropPath).catch(() => undefined);
    if (previousAccount === null) await unlink(accountPath).catch(() => undefined);
    else await writeFile(accountPath, previousAccount);
    if (previousOwnerConnectEvidenceDrop === null) await unlink(ownerConnectEvidenceDropPath).catch(() => undefined);
    else await writeFile(ownerConnectEvidenceDropPath, previousOwnerConnectEvidenceDrop);
    if (previousDiagnostic === null) await unlink(statusBefore.launchEvidenceDropDiagnostic.manifestPath).catch(() => undefined);
    else await writeFile(statusBefore.launchEvidenceDropDiagnostic.manifestPath, previousDiagnostic);
    if (previousDiagnosticMarkdown === null) await unlink(statusBefore.launchEvidenceDropDiagnostic.markdownPath).catch(() => undefined);
    else await writeFile(statusBefore.launchEvidenceDropDiagnostic.markdownPath, previousDiagnosticMarkdown);
    if (previousRepairWorksheet === null) await unlink(statusBefore.launchEvidenceDropDiagnostic.repairWorksheetCsvPath).catch(() => undefined);
    else await writeFile(statusBefore.launchEvidenceDropDiagnostic.repairWorksheetCsvPath, previousRepairWorksheet);
  }
});

test("prepareClipperPlatformReadinessMatrix writes per-platform blocker matrix", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.platformReadiness.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.platformReadiness.markdownPath, "utf8").catch(() => null);

  try {
    const { platformReadiness, status } = await prepareClipperPlatformReadinessMatrix();
    assert.equal(platformReadiness.items.length, 3);
    assert.equal(platformReadiness.totals.platforms, 3);
    assert.ok(platformReadiness.items.some((item) => item.platform === "tiktok" && item.developerPortalUrl.includes("developers.tiktok.com")));
    assert.ok(platformReadiness.items.every((item) => item.accountTasks > 0 && item.permissionsTotal > 0));
    assert.ok(status.commandCenter.steps.some((step) => step.id === "platform-readiness" && step.actionUrl === "/api/clippers/prepare-platform-readiness"));

    const rawManifest = await readFile(platformReadiness.manifestPath, "utf8");
    const rawMarkdown = await readFile(platformReadiness.markdownPath, "utf8");
    assert.ok(rawManifest.includes("tokenSaved"));
    assert.ok(rawMarkdown.includes("Clippers Platform Readiness Matrix"));
    assert.equal(rawManifest.includes("access_token"), false);
    assert.equal(rawMarkdown.includes("client_secret"), false);
  } finally {
    if (previousManifest === null) await unlink(beforeStatus.platformReadiness.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.platformReadiness.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.platformReadiness.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.platformReadiness.markdownPath, previousMarkdown);
  }
});

test("prepareClipperExternalSetupQueue writes prioritized external setup tasks", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.externalSetupQueue.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.externalSetupQueue.markdownPath, "utf8").catch(() => null);

  try {
    const { externalSetupQueue, status } = await prepareClipperExternalSetupQueue();
    assert.equal(externalSetupQueue.items.length >= 24, true);
    assert.ok(externalSetupQueue.items.some((item) => item.type === "account" && item.portalUrl.includes("signup")));
    assert.ok(externalSetupQueue.items.some((item) => item.type === "developer_app" && item.platform === "tiktok"));
    assert.ok(externalSetupQueue.items.some((item) => item.type === "permission" && item.scopes.includes("video.publish")));
    assert.ok(externalSetupQueue.items.some((item) => item.type === "oauth" && item.platform === "youtube"));
    assert.ok(externalSetupQueue.items.every((item) => item.requiredInputs.length >= 3));
    assert.ok(externalSetupQueue.items.every((item) => item.doneCriteria.length >= 3));
    assert.ok(externalSetupQueue.items.some((item) => item.type === "developer_app" && item.evidenceRecipeRow.includes("<real app/client id>")));
    assert.ok(externalSetupQueue.items.some((item) => item.type === "permission" && item.evidenceRecipeRow.includes("<real permission request/review URL")));
    assert.ok(externalSetupQueue.totals.critical > 0);
    assert.ok(status.commandCenter.steps.some((step) => step.id === "external-setup-queue" && step.actionUrl === "/api/clippers/prepare-external-setup-queue"));

    const rawManifest = await readFile(externalSetupQueue.manifestPath, "utf8");
    const rawMarkdown = await readFile(externalSetupQueue.markdownPath, "utf8");
    assert.ok(rawMarkdown.includes("Clippers External Setup Queue"));
    assert.ok(rawMarkdown.includes("Required inputs"));
    assert.ok(rawMarkdown.includes("Done criteria"));
    assert.ok(rawMarkdown.includes("Evidence recipe row"));
    assert.equal(rawManifest.includes("access_token"), false);
    assert.equal(rawMarkdown.includes("client_secret"), false);
  } finally {
    if (previousManifest === null) await unlink(beforeStatus.externalSetupQueue.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.externalSetupQueue.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.externalSetupQueue.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.externalSetupQueue.markdownPath, previousMarkdown);
  }
});

test("prepareClipperExternalExecutionHandoff writes batch-ready external handoff", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.externalExecutionHandoff.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.externalExecutionHandoff.markdownPath, "utf8").catch(() => null);
  const previousCsv = await readFile(beforeStatus.externalExecutionHandoff.csvPath, "utf8").catch(() => null);
  const previousBatch = await readFile(beforeStatus.externalExecutionHandoff.batchTemplatePath, "utf8").catch(() => null);

  try {
    const { externalExecutionHandoff, status } = await prepareClipperExternalExecutionHandoff();
    assert.ok(externalExecutionHandoff.manifestPath.endsWith("external-execution-handoff.json"));
    assert.ok(externalExecutionHandoff.markdownPath.endsWith("external-execution-handoff.md"));
    assert.ok(externalExecutionHandoff.csvPath.endsWith("external-execution-handoff.csv"));
    assert.ok(externalExecutionHandoff.batchTemplatePath.endsWith("external-execution-evidence-batch.csv"));
    assert.ok(externalExecutionHandoff.items.length > 0);
    assert.ok(externalExecutionHandoff.evidenceBatchTemplate.includes("kind,account_id,platform"));
    assert.equal(status.externalExecutionHandoff.manifestPath, externalExecutionHandoff.manifestPath);

    const rawMarkdown = await readFile(externalExecutionHandoff.markdownPath, "utf8");
    const rawCsv = await readFile(externalExecutionHandoff.csvPath, "utf8");
    const rawBatch = await readFile(externalExecutionHandoff.batchTemplatePath, "utf8");
    assert.ok(rawMarkdown.includes("Clippers External Execution Handoff"));
    assert.ok(rawMarkdown.includes("Launch Evidence Batch Template"));
    assert.ok(rawCsv.includes("unblock_condition"));
    assert.ok(rawBatch.startsWith("kind,account_id,platform,status,scope,app_identifier,public_base_url,notes"));
    assert.ok(rawBatch.includes("developer_app"));
    assert.equal(rawBatch.includes("<"), false);
    assert.equal(rawBatch.includes("\ncredential,"), false);
    assert.equal(rawBatch.includes("\noauth,"), false);
    assert.equal(rawMarkdown.includes("access_token"), false);
  } finally {
    if (previousManifest === null) await unlink(beforeStatus.externalExecutionHandoff.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.externalExecutionHandoff.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.externalExecutionHandoff.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.externalExecutionHandoff.markdownPath, previousMarkdown);
    if (previousCsv === null) await unlink(beforeStatus.externalExecutionHandoff.csvPath).catch(() => undefined);
    else await writeFile(beforeStatus.externalExecutionHandoff.csvPath, previousCsv);
    if (previousBatch === null) await unlink(beforeStatus.externalExecutionHandoff.batchTemplatePath).catch(() => undefined);
    else await writeFile(beforeStatus.externalExecutionHandoff.batchTemplatePath, previousBatch);
  }
});

test("prepareClipperExternalExecutionSession writes lane-based execution pack", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.externalExecutionSession.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.externalExecutionSession.markdownPath, "utf8").catch(() => null);
  const previousCsv = await readFile(beforeStatus.externalExecutionSession.csvPath, "utf8").catch(() => null);
  const previousEvidenceImport = await readFile(beforeStatus.externalExecutionSession.evidenceImportPath, "utf8").catch(() => null);

  try {
    const { externalExecutionSession, status } = await prepareClipperExternalExecutionSession();
    assert.ok(externalExecutionSession.manifestPath.endsWith("external-execution-session.json"));
    assert.ok(externalExecutionSession.markdownPath.endsWith("external-execution-session.md"));
    assert.ok(externalExecutionSession.csvPath.endsWith("external-execution-session.csv"));
    assert.ok(externalExecutionSession.evidenceImportPath.endsWith("external-execution-session-evidence-import.csv"));
    assert.equal(externalExecutionSession.items.length, status.externalExecutionHandoff.items.length);
    assert.ok(externalExecutionSession.totals.blocked > 0 || externalExecutionSession.totals.doNow > 0);
    assert.equal(externalExecutionSession.totals.importableEvidenceRows, externalExecutionSession.items.filter((item) => item.evidenceBatchRow && item.actionMode === "paste_evidence").length);
    assert.ok(externalExecutionSession.evidenceImportTemplate.startsWith("kind,account_id,platform,status,scope,app_identifier,public_base_url,notes"));
    assert.ok(externalExecutionSession.items.some((item) => item.actionMode === "paste_env" || item.actionMode === "paste_evidence"));
    assert.ok(externalExecutionSession.items.some((item) => item.actionMode === "paste_env" && item.executionUrl === "/clippers#credential-setup"));
    assert.ok(externalExecutionSession.items.some((item) => item.actionMode === "paste_evidence" && item.executionUrl === "/clippers#launch-evidence-batch"));
    assert.ok(externalExecutionSession.totals.doNow > 0);
    assert.ok(externalExecutionSession.items.some((item) => item.lane === "do_now" && item.actionMode === "paste_evidence"));
    assert.ok(externalExecutionSession.items.every((item) => item.laneReason.length > 0));
    assert.ok(externalExecutionSession.items.some((item) => item.evidenceRecipeRow.includes("<real handle")));
    assert.ok(externalExecutionSession.items.some((item) => item.evidenceRecipeRow.includes("<developer app id")));
    assert.ok(externalExecutionSession.items.some((item) => item.evidenceRecipeRow.includes("<permission request")));
    assert.ok(externalExecutionSession.items.every((item) => item.requiredInputs.length > 0));
    assert.ok(externalExecutionSession.items.every((item) => item.completionHint.length > 20));
    assert.equal(externalExecutionSession.items.every((item) => typeof item.evidenceImportReady === "boolean"), true);
    assert.equal(externalExecutionSession.unlockBoard.length, 3);
    assert.ok(externalExecutionSession.unlockBoard.every((item) => ["tiktok", "instagram", "youtube"].includes(item.platform)));
    assert.equal(externalExecutionSession.unlockBoard.reduce((sum, item) => sum + item.total, 0), externalExecutionSession.items.length);
    assert.ok(externalExecutionSession.unlockBoard.some((item) => item.nextEvidenceRows.length > 0));
    assert.ok(externalExecutionSession.unlockBoard.every((item) => item.nextStep.length > 20));
    assert.equal(externalExecutionSession.totals.portalBatches, externalExecutionSession.portalBatches.length);
    assert.ok(externalExecutionSession.portalBatches.length >= 6);
    assert.ok(externalExecutionSession.portalBatches.some((batch) => batch.type === "account" && batch.evidenceRows.length > 0));
    assert.ok(externalExecutionSession.portalBatches.some((batch) => batch.type === "credential" && batch.credentialTemplates.length > 0));
    assert.ok(externalExecutionSession.portalBatches.some((batch) => batch.type === "permission" && batch.importTemplate.startsWith("kind,account_id,platform,status")));
    assert.ok(externalExecutionSession.portalBatches.every((batch) => batch.operatorChecklist.length >= 3));
    assert.ok(externalExecutionSession.portalBatches.every((batch) => batch.nextStep.length > 10));
    assert.equal(externalExecutionSession.focusRun.status, "ready");
    assert.ok(externalExecutionSession.focusRun.items.length > 0);
    assert.ok(externalExecutionSession.focusRun.items.length <= 7);
    assert.ok(externalExecutionSession.focusRun.estimatedMinutes > 0);
    assert.ok(externalExecutionSession.focusRun.items.every((item) => item.estimatedMinutes > 0));
    assert.ok(externalExecutionSession.focusRun.items.every((item) => item.checklist.length >= 3));
    assert.ok(externalExecutionSession.focusRun.items.every((item) => item.doneCriteria.length >= 3));
    assert.ok(externalExecutionSession.focusRun.evidenceRows.length > 0 || externalExecutionSession.focusRun.credentialTemplates.length > 0);
    assert.ok(["not_prepared", "needs_operator", "complete"].includes(externalExecutionSession.closeoutRun.status));
    assert.ok(externalExecutionSession.closeoutRun.packPath.endsWith("clippers-external-closeout-pack.json"));
    assert.ok(externalExecutionSession.closeoutRun.evidenceCsvPath.endsWith("external-closeout-evidence-import.csv"));
    assert.equal(externalExecutionSession.closeoutRun.totals.metricoolReadyToSend, 0);
    assert.equal(externalExecutionSession.closeoutRun.metricoolPublishMode, "approval_required");
    if (externalExecutionSession.closeoutRun.status !== "not_prepared") {
      assert.equal(externalExecutionSession.closeoutRun.totals.rows, 16);
      assert.equal(externalExecutionSession.closeoutRun.nextItems.length, 8);
      assert.ok(externalExecutionSession.closeoutRun.nextItems.every((item) => item.proofPath.includes("external-closeout-proofs")));
      assert.ok(externalExecutionSession.closeoutRun.nextItems.every((item) => item.evidenceCsvRow.startsWith("\"")));
      assert.ok(externalExecutionSession.closeoutRun.nextItems.every((item) => item.evidenceCsvRow.split(",").length === 12));
      assert.equal(externalExecutionSession.closeoutRun.nextItems.some((item) => item.evidenceCsvRow.includes("<")), false);
    }
    assert.equal(status.externalExecutionSession.manifestPath, externalExecutionSession.manifestPath);
    assert.equal(status.platformWarRoom.items.length, 3);
    assert.equal(status.platformWarRoom.totals.platforms, 3);
    assert.ok(status.platformWarRoom.items.every((item) => ["tiktok", "instagram", "youtube"].includes(item.platform)));
    assert.ok(status.platformWarRoom.items.every((item) => item.evidenceRows.length >= item.accountEvidenceRows.length));
    assert.ok(status.platformWarRoom.items.every((item) => item.operatorSteps.length >= 5));
    assert.ok(status.platformWarRoom.items.every((item) => item.connectionChecklist.length >= 5));
    assert.ok(status.platformWarRoom.items.every((item) => item.evidenceChecklist.length >= 3));
    assert.ok(status.platformWarRoom.items.every((item) => item.safetyRules.some((rule) => rule.toLowerCase().includes("never paste"))));
    assert.ok(status.platformWarRoom.items.every((item) => item.afterConnectionSteps.length >= 3));
    assert.ok(status.platformWarRoom.items.some((item) => item.status !== "ready" && item.accountEvidenceRows.length > 0));
    assert.equal(status.platformWarRoom.accountConnectionRows.length, 9);
    assert.equal(status.platformWarRoom.totals.accountConnections, 9);
    assert.ok(status.platformWarRoom.accountConnectionRows.every((row) => row.accountEvidenceRow.startsWith("\"account\"")));
    assert.ok(status.platformWarRoom.accountConnectionRows.every((row) => row.accountEvidenceRow.endsWith("\"\"")));
    assert.ok(status.platformWarRoom.accountConnectionRows.every((row) => row.proofRequirements.length >= 4));
    assert.ok(status.platformWarRoom.accountConnectionRows.every((row) => row.postConnectActions.length >= 3));
    assert.ok(status.platformWarRoom.accountConnectionRows.some((row) => row.profileLink.includes("tiktok.com")));
    assert.equal(status.platformWarRoom.permissionApprovalRows.length, 6);
    assert.equal(status.platformWarRoom.totals.permissionApprovals, 6);
    assert.ok(status.platformWarRoom.permissionApprovalRows.every((row) => row.requestedEvidenceRow.startsWith("\"permission\"")));
    assert.ok(status.platformWarRoom.permissionApprovalRows.every((row) => row.approvedEvidenceRow.includes("\"approved\"")));
    assert.ok(status.platformWarRoom.permissionApprovalRows.every((row) => row.requestedEvidenceRow.endsWith("\"\"")));
    assert.ok(status.platformWarRoom.permissionApprovalRows.every((row) => row.approvedEvidenceRow.endsWith("\"\"")));
    assert.ok(status.platformWarRoom.permissionApprovalRows.every((row) => row.proofRequirements.length >= 4));
    assert.ok(status.platformWarRoom.permissionApprovalRows.some((row) => row.scope === "video.publish"));
    assert.ok(status.platformWarRoom.permissionApprovalRows.some((row) => row.scope === "https://www.googleapis.com/auth/youtube.upload"));
    assert.ok(status.platformWarRoom.totals.accountEvidenceRows >= 3);
    assert.ok(status.platformWarRoom.totals.permissionEvidenceRows >= 3);
    assert.ok(status.platformWarRoom.manifestPath.endsWith("platform-war-room.json"));
    assert.ok(status.platformWarRoom.markdownPath.endsWith("platform-war-room.md"));

    const rawManifest = await readFile(externalExecutionSession.manifestPath, "utf8");
    const rawMarkdown = await readFile(externalExecutionSession.markdownPath, "utf8");
    const rawWarRoomManifest = await readFile(status.platformWarRoom.manifestPath, "utf8");
    const rawWarRoomMarkdown = await readFile(status.platformWarRoom.markdownPath, "utf8");
    const rawCsv = await readFile(externalExecutionSession.csvPath, "utf8");
    const rawEvidenceImport = await readFile(externalExecutionSession.evidenceImportPath, "utf8");
    assert.ok(rawWarRoomManifest.includes("\"connectionChecklist\""));
    assert.ok(rawWarRoomManifest.includes("\"accountConnectionRows\""));
    assert.ok(rawWarRoomManifest.includes("\"permissionApprovalRows\""));
    assert.equal(rawWarRoomManifest.includes("2FA enabled; screenshot/proof saved"), false);
    assert.ok(rawWarRoomMarkdown.includes("Clippers Platform War Room"));
    assert.ok(rawWarRoomMarkdown.includes("Account Connection Matrix"));
    assert.ok(rawWarRoomMarkdown.includes("Permission Approval Matrix"));
    assert.ok(rawWarRoomMarkdown.includes("Connection checklist"));
    assert.ok(rawWarRoomMarkdown.includes("Safety rules"));
    assert.ok(rawMarkdown.includes("Clippers External Execution Session"));
    assert.ok(rawMarkdown.includes("Launch Evidence Import"));
    assert.ok(rawMarkdown.includes("External Closeout Run"));
    assert.ok(rawMarkdown.includes("Metricool: approval_required; ready_to_send 0"));
    assert.ok(rawMarkdown.includes("Focus Run"));
    assert.ok(rawMarkdown.includes("Unlock Board"));
    assert.ok(rawMarkdown.includes("Portal Batches"));
    assert.ok(rawMarkdown.includes("Required inputs"));
    assert.ok(rawMarkdown.includes("Lane reason"));
    assert.ok(rawMarkdown.includes("Evidence recipe row"));
    assert.ok(rawCsv.includes("action_mode"));
    assert.ok(rawCsv.includes("lane_reason"));
    assert.ok(rawCsv.includes("portal_batch_id"));
    assert.ok(rawCsv.includes("evidence_recipe_row"));
    assert.ok(rawCsv.includes("completion_hint"));
    assert.ok(rawCsv.includes("required_inputs"));
    assert.ok(rawCsv.includes("execution_url"));
    assert.ok(rawCsv.includes("evidence_import_ready"));
    assert.ok(rawMarkdown.includes("Execution URL"));
    assert.ok(rawMarkdown.includes("Evidence import ready"));
    assert.ok(rawEvidenceImport.startsWith("kind,account_id,platform,status,scope,app_identifier,public_base_url,notes"));
    assert.equal(rawEvidenceImport.includes("TIKTOK_CLIENT_SECRET"), false);
    assert.ok(rawManifest.includes("credentialTemplate"));
    assert.ok(rawManifest.includes("evidenceRecipeRow"));
    assert.ok(rawManifest.includes("requiredInputs"));
    assert.ok(rawManifest.includes("closeoutRun"));
    const rawUi = await readFile(path.join(process.cwd(), "client/src/pages/clippers.tsx"), "utf8");
    assert.ok(rawUi.includes('data-testid="clippers-external-closeout-run"'));
    assert.ok(rawUi.includes("Closeout evidence run"));
    assert.ok(rawManifest.includes("evidenceImportTemplate"));
    assert.ok(rawManifest.includes("unlockBoard"));
    assert.ok(rawManifest.includes("portalBatches"));
    assert.ok(rawManifest.includes("focusRun"));
    assert.ok(rawManifest.includes("operatorChecklist"));
    assert.ok(rawManifest.includes("importTemplate"));
    assert.equal(rawMarkdown.includes("access_token"), false);
    assert.equal(rawManifest.includes("client_secret"), false);
  } finally {
    if (previousManifest === null) await unlink(beforeStatus.externalExecutionSession.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.externalExecutionSession.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.externalExecutionSession.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.externalExecutionSession.markdownPath, previousMarkdown);
    if (previousCsv === null) await unlink(beforeStatus.externalExecutionSession.csvPath).catch(() => undefined);
    else await writeFile(beforeStatus.externalExecutionSession.csvPath, previousCsv);
    if (previousEvidenceImport === null) await unlink(beforeStatus.externalExecutionSession.evidenceImportPath).catch(() => undefined);
    else await writeFile(beforeStatus.externalExecutionSession.evidenceImportPath, previousEvidenceImport);
  }
});

test("prepareClipperGoLiveEvidenceBundle writes one import bundle for external launch evidence", async () => {
  const statusBefore = await getClipperStatus();
  const previousManifest = await readFile(statusBefore.goLiveEvidenceBundle.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(statusBefore.goLiveEvidenceBundle.markdownPath, "utf8").catch(() => null);
  const previousCsv = await readFile(statusBefore.goLiveEvidenceBundle.csvPath, "utf8").catch(() => null);

  try {
    const { goLiveEvidenceBundle, status } = await prepareClipperGoLiveEvidenceBundle();

    assert.equal(goLiveEvidenceBundle.status, "ready");
    assert.ok(goLiveEvidenceBundle.generatedAt);
    assert.ok(goLiveEvidenceBundle.manifestPath.endsWith("go-live-evidence-bundle.json"));
    assert.ok(goLiveEvidenceBundle.markdownPath.endsWith("go-live-evidence-bundle.md"));
    assert.ok(goLiveEvidenceBundle.csvPath.endsWith("go-live-evidence-bundle.csv"));
    assert.equal(goLiveEvidenceBundle.totals.accountRows, 9);
    assert.equal(goLiveEvidenceBundle.totals.starterRows, 18);
    assert.equal(goLiveEvidenceBundle.totals.approvalRows, 9);
    assert.equal(goLiveEvidenceBundle.sections.length, 4);
    assert.ok(goLiveEvidenceBundle.importTemplate.startsWith("kind,account_id,platform,status,scope,app_identifier,public_base_url,notes"));
    assert.ok(goLiveEvidenceBundle.starterRows.some((row) => row.includes("\"account\"")));
    assert.ok(goLiveEvidenceBundle.starterRows.some((row) => row.includes("\"developer_app\"") && row.includes("\"submitted\"")));
    assert.ok(goLiveEvidenceBundle.starterRows.some((row) => row.includes("\"permission\"") && row.includes("\"requested\"")));
    assert.ok(goLiveEvidenceBundle.approvalRows.some((row) => row.includes("\"approved\"")));
    assert.ok(goLiveEvidenceBundle.checklist.some((step) => step.toLowerCase().includes("never paste")));
    assert.equal(status.goLiveEvidenceBundle.manifestPath, goLiveEvidenceBundle.manifestPath);
    assert.equal(status.goLiveEvidenceBundle.totals.starterRows, goLiveEvidenceBundle.totals.starterRows);

    const manifestStat = await stat(goLiveEvidenceBundle.manifestPath);
    const markdownStat = await stat(goLiveEvidenceBundle.markdownPath);
    const csvStat = await stat(goLiveEvidenceBundle.csvPath);
    assert.equal(manifestStat.isFile(), true);
    assert.equal(markdownStat.isFile(), true);
    assert.equal(csvStat.isFile(), true);

    const rawManifest = await readFile(goLiveEvidenceBundle.manifestPath, "utf8");
    const rawMarkdown = await readFile(goLiveEvidenceBundle.markdownPath, "utf8");
    const rawCsv = await readFile(goLiveEvidenceBundle.csvPath, "utf8");
    assert.ok(rawMarkdown.includes("Clippers Go-Live Evidence Bundle"));
    assert.ok(rawMarkdown.includes("Starter Import Template"));
    assert.ok(rawCsv.includes("section_id"));
    assert.ok(rawManifest.includes("starterRows"));
    assert.equal(rawManifest.includes("plain-access-token"), false);
    assert.equal(rawMarkdown.toLowerCase().includes("access_token="), false);
    assert.equal(rawCsv.toLowerCase().includes("refresh_token="), false);
  } finally {
    if (previousManifest === null) await unlink(statusBefore.goLiveEvidenceBundle.manifestPath).catch(() => undefined);
    else await writeFile(statusBefore.goLiveEvidenceBundle.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(statusBefore.goLiveEvidenceBundle.markdownPath).catch(() => undefined);
    else await writeFile(statusBefore.goLiveEvidenceBundle.markdownPath, previousMarkdown);
    if (previousCsv === null) await unlink(statusBefore.goLiveEvidenceBundle.csvPath).catch(() => undefined);
    else await writeFile(statusBefore.goLiveEvidenceBundle.csvPath, previousCsv);
  }
});

test("prepareClipperExternalLaunchDossier groups external launch actions by platform", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.externalLaunchDossier.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.externalLaunchDossier.markdownPath, "utf8").catch(() => null);

  try {
    const { externalLaunchDossier, status } = await prepareClipperExternalLaunchDossier();
    assert.equal(externalLaunchDossier.platforms.length, 3);
    assert.equal(externalLaunchDossier.totals.platforms, 3);
    assert.ok(externalLaunchDossier.totals.blockedExternalItems > 0);
    assert.ok(externalLaunchDossier.totals.unlockInputs > 0);
    assert.equal(externalLaunchDossier.totals.permissionUnlocks, status.permissionQueue.length);
    assert.ok(externalLaunchDossier.platforms.some((item) => item.platform === "tiktok" && item.developerPortalUrl.includes("developers.tiktok.com")));
    assert.ok(externalLaunchDossier.platforms.every((item) => item.accountCreationUrl.startsWith("http") && item.criticalActions.length > 0));
    assert.ok(externalLaunchDossier.platforms.every((item) => item.blockedExternalItems > 0 && item.unlockInputs.length > 0 && item.sessionNextSteps.length > 0));
    assert.ok(externalLaunchDossier.platforms.every((item) => item.permissionUnlocks.length > 0 && item.permissionUnlocks.every((permission) => permission.requestPortalUrl.startsWith("https://") && permission.evidenceBatchRow.endsWith(',""'))));
    assert.ok(status.commandCenter.steps.some((step) => step.id === "external-launch-dossier" && step.actionUrl === "/api/clippers/prepare-external-launch-dossier"));

    const rawManifest = await readFile(externalLaunchDossier.manifestPath, "utf8");
    const rawMarkdown = await readFile(externalLaunchDossier.markdownPath, "utf8");
    assert.ok(rawMarkdown.includes("Clippers External Launch Dossier"));
    assert.ok(rawMarkdown.includes("Unlock inputs"));
    assert.ok(rawMarkdown.includes("Permission unlocks"));
    assert.ok(rawManifest.includes("developerPortalUrl"));
    assert.ok(rawManifest.includes("blockedExternalItems"));
    assert.ok(rawManifest.includes("permissionUnlocks"));
    assert.equal(rawManifest.includes("access_token"), false);
    assert.equal(rawMarkdown.includes("client_secret"), false);
  } finally {
    if (previousManifest === null) await unlink(beforeStatus.externalLaunchDossier.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.externalLaunchDossier.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.externalLaunchDossier.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.externalLaunchDossier.markdownPath, previousMarkdown);
  }
});

test("prepareClipperPlatformPortalChecklist writes consolidated portal actions", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.platformPortalChecklist.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.platformPortalChecklist.markdownPath, "utf8").catch(() => null);
  const previousCsv = await readFile(beforeStatus.platformPortalChecklist.csvPath, "utf8").catch(() => null);

  try {
    const { platformPortalChecklist, status } = await prepareClipperPlatformPortalChecklist();
    assert.equal(platformPortalChecklist.items.length, 3);
    assert.equal(platformPortalChecklist.totals.platforms, 3);
    assert.ok(platformPortalChecklist.totals.portalActions >= 3);
    assert.ok(platformPortalChecklist.totals.evidenceRows > 0);
    assert.ok(platformPortalChecklist.items.every((item) => item.portalUrls.some((url) => url.startsWith("https://"))));
    assert.ok(platformPortalChecklist.items.every((item) => item.completionCriteria.length >= 5));
    assert.ok(platformPortalChecklist.items.some((item) => item.evidenceBatchRows.length > 0));
    assert.ok(status.commandCenter.steps.some((step) => step.id === "platform-portal-checklist" && step.actionUrl === "/api/clippers/prepare-platform-portal-checklist"));

    const rawManifest = await readFile(platformPortalChecklist.manifestPath, "utf8");
    const rawMarkdown = await readFile(platformPortalChecklist.markdownPath, "utf8");
    const rawCsv = await readFile(platformPortalChecklist.csvPath, "utf8");
    assert.ok(rawMarkdown.includes("Clippers Platform Portal Checklist"));
    assert.ok(rawMarkdown.includes("Completion Criteria"));
    assert.ok(rawCsv.includes("evidence_batch_rows"));
    assert.ok(rawManifest.includes("portalUrls"));
    assert.equal(JSON.stringify(platformPortalChecklist).includes("client_secret"), false);
    assert.equal(rawManifest.includes("access_token"), false);
    assert.equal(rawMarkdown.includes("client_secret"), false);
  } finally {
    if (previousManifest === null) await unlink(beforeStatus.platformPortalChecklist.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.platformPortalChecklist.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.platformPortalChecklist.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.platformPortalChecklist.markdownPath, previousMarkdown);
    if (previousCsv === null) await unlink(beforeStatus.platformPortalChecklist.csvPath).catch(() => undefined);
    else await writeFile(beforeStatus.platformPortalChecklist.csvPath, previousCsv);
  }
});

test("prepareClipperGoLiveExecutionPack writes executable platform phases", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.goLiveExecutionPack.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.goLiveExecutionPack.markdownPath, "utf8").catch(() => null);

  try {
    const { goLiveExecutionPack, status } = await prepareClipperGoLiveExecutionPack();
    assert.equal(goLiveExecutionPack.platforms.length, 3);
    assert.equal(goLiveExecutionPack.totals.platforms, 3);
    assert.ok(goLiveExecutionPack.platforms.every((platform) => platform.phases.length >= 8));
    assert.equal(goLiveExecutionPack.metricoolMvp.bridge, "metricool");
    assert.equal(goLiveExecutionPack.metricoolMvp.realPublishEnabled, false);
    assert.equal(goLiveExecutionPack.metricoolMvp.approvalRequired, true);
    assert.ok(goLiveExecutionPack.platforms.some((platform) => platform.phases.some((phase) => phase.id.endsWith("developer-app") && phase.portalUrl?.startsWith("http"))));
    assert.ok(status.commandCenter.steps.some((step) => step.id === "go-live-execution-pack" && step.actionUrl === "/api/clippers/prepare-go-live-execution-pack"));
    assert.ok(status.growthAudit.items.some((item) => item.id === "go-live-execution-pack"));

    const rawManifest = await readFile(goLiveExecutionPack.manifestPath, "utf8");
    const rawMarkdown = await readFile(goLiveExecutionPack.markdownPath, "utf8");
    assert.ok(rawMarkdown.includes("Clippers Go-Live Execution Pack"));
    assert.ok(rawMarkdown.includes("Metricool MVP Lane"));
    assert.ok(rawManifest.includes("ready_to_execute") || rawManifest.includes("blocked"));
    assert.equal(rawManifest.includes("access_token"), false);
    assert.equal(rawMarkdown.includes("client_secret"), false);
  } finally {
    if (previousManifest === null) await unlink(beforeStatus.goLiveExecutionPack.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.goLiveExecutionPack.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.goLiveExecutionPack.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.goLiveExecutionPack.markdownPath, previousMarkdown);
  }
});

test("prepareClipperGoLiveCompletionAudit verifies full go-live requirements conservatively", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.goLiveCompletionAudit.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.goLiveCompletionAudit.markdownPath, "utf8").catch(() => null);
  const previousOperatorBrief = await readFile(beforeStatus.goLiveOperatorBrief.manifestPath, "utf8").catch(() => null);
  const previousOperatorBriefMarkdown = await readFile(beforeStatus.goLiveOperatorBrief.markdownPath, "utf8").catch(() => null);
  const previousEvidenceTemplatePaths = beforeStatus.goLiveCompletionAudit.externalSession.map((item) => item.evidenceDropPath);
  const previousEvidenceTemplates = await Promise.all(previousEvidenceTemplatePaths.map((templatePath) => readFile(templatePath, "utf8").catch(() => null)));
  const previousEvidenceTemplateReadmePath = path.join(path.dirname(previousEvidenceTemplatePaths[0] || beforeStatus.goLiveCompletionAudit.externalSessionCsvPath), "README.md");
  const previousEvidenceTemplateReadme = await readFile(previousEvidenceTemplateReadmePath, "utf8").catch(() => null);

  try {
    const { goLiveCompletionAudit, status } = await prepareClipperGoLiveCompletionAudit();
    assert.equal(goLiveCompletionAudit.requirements.length, 12);
    assert.equal(goLiveCompletionAudit.totals.requirements, goLiveCompletionAudit.requirements.length);
    assert.equal(goLiveCompletionAudit.readyToPublish, false);
    assert.equal(typeof goLiveCompletionAudit.launchModes?.metricoolMvpReady, "boolean");
    assert.equal(typeof goLiveCompletionAudit.launchModes?.approvalQueueReady, "boolean");
    assert.equal(goLiveCompletionAudit.launchModes?.directSocialApisRequiredForMvp, false);
    assert.equal(goLiveCompletionAudit.launchModes?.fullDirectApiReady, false);
    assert.ok(Array.isArray(goLiveCompletionAudit.launchModes?.metricoolMvpBlockers));
    assert.ok((goLiveCompletionAudit.launchModes?.directApiBacklog || []).length > 0);
    assert.equal(goLiveCompletionAudit.status === "blocked" || goLiveCompletionAudit.status === "partial", true);
    assert.ok(goLiveCompletionAudit.totals.blocked > 0);
    assert.ok(goLiveCompletionAudit.totals.externalRequired > 0);
    assert.ok(goLiveCompletionAudit.score >= 0 && goLiveCompletionAudit.score <= 100);
    assert.ok(goLiveCompletionAudit.requirements.some((item) => item.id === "accounts-created-verified" && item.phase === "accounts"));
    assert.ok(goLiveCompletionAudit.requirements.some((item) => item.id === "permissions-approved" && item.requiredEvidence.some((evidence) => evidence.includes("scope"))));
    assert.ok(goLiveCompletionAudit.requirements.some((item) => item.id === "official-permission-sources-verified" && ["blocked", "needs_evidence", "verified"].includes(item.status)));
    assert.ok(goLiveCompletionAudit.requirements.some((item) => item.id === "publishing-bridge-connected" && item.requiredEvidence.some((evidence) => evidence.includes("queued_for_approval"))));
    assert.ok(goLiveCompletionAudit.requirements.some((item) => item.id === "evidence-integrity-clean" && item.proofSource.endsWith("evidence-integrity-audit.md")));
    assert.ok(goLiveCompletionAudit.requirements.some((item) => item.id === "automation-reporting-ready" && item.phase === "optimization"));
    assert.ok(goLiveCompletionAudit.requirements.every((item) => item.currentEvidence.length > 10 && item.nextStep.length > 10));
    assert.equal(goLiveCompletionAudit.externalSession.length, goLiveCompletionAudit.requirements.length);
    assert.equal(goLiveCompletionAudit.totals.externalSessionItems, goLiveCompletionAudit.externalSession.length);
    assert.ok(goLiveCompletionAudit.totals.externalSessionPortalUrls > 0);
    assert.ok(goLiveCompletionAudit.totals.externalSessionEvidenceRows > 0);
    assert.ok(goLiveCompletionAudit.externalSession.some((item) => item.requirementId === "accounts-created-verified" && item.evidenceRows.some((row) => row.includes("account"))));
    assert.ok(goLiveCompletionAudit.externalSession.find((item) => item.requirementId === "accounts-created-verified")?.evidenceRows.every((row) => row.includes("<real handle")));
    assert.ok(goLiveCompletionAudit.externalSession.some((item) => item.requirementId === "permissions-approved" && item.portalUrls.some((url) => url.startsWith("http"))));
    assert.ok(goLiveCompletionAudit.externalSession.every((item) => item.operatorSteps.length > 0 && item.verificationCommand.includes("prepareClipperGoLiveCompletionAudit")));
    assert.ok(goLiveCompletionAudit.externalSession.every((item) => item.evidenceDropFileName.endsWith("-evidence.md")));
    assert.ok(goLiveCompletionAudit.externalSession.every((item) => item.evidenceDropPath.endsWith(item.evidenceDropFileName)));
    assert.ok(goLiveCompletionAudit.externalSession.every((item) => item.evidenceDropPath.includes(`${path.sep}evidence-drop${path.sep}go-live-proof-templates${path.sep}`)));
    assert.ok(goLiveCompletionAudit.externalSession.every((item) => item.evidenceCaptureTemplate.includes("Clippers Evidence Capture")));
    assert.ok(goLiveCompletionAudit.externalSession.every((item) => item.evidenceCaptureTemplate.includes("Do not paste passwords")));
    for (const item of goLiveCompletionAudit.externalSession) {
      const rawTemplate = await readFile(item.evidenceDropPath, "utf8");
      assert.ok(rawTemplate.includes(`Requirement ID: ${item.requirementId}`));
      assert.ok(rawTemplate.includes("Do not paste passwords"));
      assert.equal(rawTemplate.includes("client_secret"), false);
    }
    const rawTemplateReadme = await readFile(path.join(path.dirname(goLiveCompletionAudit.externalSession[0].evidenceDropPath), "README.md"), "utf8");
    assert.ok(rawTemplateReadme.includes("Clippers Go-Live Proof Templates"));
    assert.equal(status.goLiveCompletionAudit.manifestPath, goLiveCompletionAudit.manifestPath);
    assert.ok(status.goLiveOperatorBrief.manifestPath.endsWith("go-live-operator-brief.json"));
    assert.ok(status.goLiveOperatorBrief.markdownPath.endsWith("go-live-operator-brief.md"));
    assert.equal(status.goLiveOperatorBrief.lanes.length, 5);
    assert.ok(status.goLiveOperatorBrief.lanes.some((lane) => lane.id === "accounts" && lane.evidenceRows.length >= 3));
    assert.ok(status.goLiveOperatorBrief.lanes.some((lane) => lane.id === "content_supply" && lane.total >= lane.done));
    assert.ok(status.goLiveOperatorBrief.totals.accountConnectionsTotal >= status.goLiveOperatorBrief.totals.accountConnectionsReady);

    const rawManifest = await readFile(goLiveCompletionAudit.manifestPath, "utf8");
    const rawMarkdown = await readFile(goLiveCompletionAudit.markdownPath, "utf8");
    const rawExternalCsv = await readFile(goLiveCompletionAudit.externalSessionCsvPath, "utf8");
    const rawOperatorBrief = await readFile(status.goLiveOperatorBrief.manifestPath, "utf8");
    const rawOperatorBriefMarkdown = await readFile(status.goLiveOperatorBrief.markdownPath, "utf8");
    assert.ok(rawMarkdown.includes("Clippers Go-Live Completion Audit"));
    assert.ok(rawMarkdown.includes("External Go-Live Session"));
    assert.ok(rawMarkdown.includes("Required evidence"));
    assert.ok(rawMarkdown.includes("Evidence capture template"));
    assert.ok(rawMarkdown.includes("Evidence drop file"));
    assert.ok(rawMarkdown.includes("Ready for approval-gated launch: no"));
    assert.ok(rawMarkdown.includes("Metricool MVP ready:"));
    assert.ok(rawMarkdown.includes("Direct social APIs required for Metricool MVP: no"));
    assert.ok(rawMarkdown.includes("Direct API backlog"));
    assert.ok(rawExternalCsv.includes("requirement_id"));
    assert.ok(rawExternalCsv.includes("accounts-created-verified"));
    assert.ok(rawExternalCsv.includes("evidence_capture_template"));
    assert.ok(rawExternalCsv.includes("evidence_drop_file_name"));
    assert.ok(rawExternalCsv.includes("evidence_drop_path"));
    assert.ok(rawManifest.includes("\"readyToPublish\""));
    assert.ok(rawManifest.includes("\"requirements\""));
    assert.ok(rawOperatorBrief.includes("\"currentFocus\""));
    assert.ok(rawOperatorBriefMarkdown.includes("Clippers Go-Live Operator Brief"));
    assert.ok(rawOperatorBriefMarkdown.includes("Cuentas + permisos"));
    assert.equal(rawManifest.includes("access_token"), false);
    assert.equal(rawMarkdown.includes("client_secret"), false);
    assert.equal(rawExternalCsv.includes("refresh_token"), false);
    assert.equal(rawOperatorBrief.includes("access_token"), false);
    assert.equal(rawOperatorBriefMarkdown.includes("client_secret"), false);
  } finally {
    if (previousManifest === null) await unlink(beforeStatus.goLiveCompletionAudit.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.goLiveCompletionAudit.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.goLiveCompletionAudit.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.goLiveCompletionAudit.markdownPath, previousMarkdown);
    if (previousOperatorBrief === null) await unlink(beforeStatus.goLiveOperatorBrief.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.goLiveOperatorBrief.manifestPath, previousOperatorBrief);
    if (previousOperatorBriefMarkdown === null) await unlink(beforeStatus.goLiveOperatorBrief.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.goLiveOperatorBrief.markdownPath, previousOperatorBriefMarkdown);
    await Promise.all(previousEvidenceTemplatePaths.map(async (templatePath, index) => {
      const previousTemplate = previousEvidenceTemplates[index];
      if (previousTemplate === null) await unlink(templatePath).catch(() => undefined);
      else await writeFile(templatePath, previousTemplate);
    }));
    if (previousEvidenceTemplateReadme === null) await unlink(previousEvidenceTemplateReadmePath).catch(() => undefined);
    else await writeFile(previousEvidenceTemplateReadmePath, previousEvidenceTemplateReadme);
  }
});

test("prepareClipperGoLiveOperatorBrief writes focused operator lanes", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.goLiveOperatorBrief.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.goLiveOperatorBrief.markdownPath, "utf8").catch(() => null);

  try {
    const { goLiveOperatorBrief, status } = await prepareClipperGoLiveOperatorBrief();

    assert.equal(goLiveOperatorBrief.lanes.length, 5);
    assert.equal(goLiveOperatorBrief.totals.lanes, goLiveOperatorBrief.lanes.length);
    assert.ok(["blocked", "needs_action", "ready"].includes(goLiveOperatorBrief.status));
    assert.ok(goLiveOperatorBrief.currentFocus.length > 3);
    assert.ok(goLiveOperatorBrief.lanes.some((lane) => lane.id === "accounts" && lane.evidenceRows.length >= 3));
    assert.ok(goLiveOperatorBrief.lanes.some((lane) => lane.id === "credentials" && lane.artifactPath.includes("credential-drop-diagnostic")));
    assert.ok(goLiveOperatorBrief.lanes.some((lane) => lane.id === "content_supply" && lane.total >= lane.done));
    assert.equal(status.goLiveOperatorBrief.manifestPath, goLiveOperatorBrief.manifestPath);
    assert.ok(status.commandCenter.steps.some((step) => step.id === "go-live-operator-brief" && step.actionUrl === "/api/clippers/prepare-go-live-operator-brief"));

    const rawManifest = await readFile(goLiveOperatorBrief.manifestPath, "utf8");
    const rawMarkdown = await readFile(goLiveOperatorBrief.markdownPath, "utf8");
    assert.ok(rawMarkdown.includes("Clippers Go-Live Operator Brief"));
    assert.ok(rawMarkdown.includes("Cuentas + permisos"));
    assert.ok(rawMarkdown.includes("Videos fuente + derechos"));
    assert.ok(rawManifest.includes("\"currentFocus\""));
    assert.equal(rawManifest.includes("access_token"), false);
    assert.equal(rawMarkdown.includes("client_secret"), false);
  } finally {
    if (previousManifest === null) await unlink(beforeStatus.goLiveOperatorBrief.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.goLiveOperatorBrief.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.goLiveOperatorBrief.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.goLiveOperatorBrief.markdownPath, previousMarkdown);
  }
});

test("prepareClipperOfficialPermissionMatrix writes official scope references", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.officialPermissionMatrix.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.officialPermissionMatrix.markdownPath, "utf8").catch(() => null);
  const previousCsv = await readFile(beforeStatus.officialPermissionMatrix.csvPath, "utf8").catch(() => null);

  try {
    const { officialPermissionMatrix, status } = await prepareClipperOfficialPermissionMatrix();
    assert.equal(officialPermissionMatrix.items.length, 3);
    assert.ok(officialPermissionMatrix.csvPath.endsWith("official-permission-matrix.csv"));
    assert.equal(officialPermissionMatrix.totals.scopes, status.permissionQueue.length);
    assert.ok(officialPermissionMatrix.items.some((item) => item.platform === "tiktok" && item.scopes.some((scope) => scope.scope === "video.publish" && scope.requiredForAutopost)));
    assert.ok(officialPermissionMatrix.items.some((item) => item.platform === "instagram" && item.sourceStatus === "official_login_required"));
    assert.ok(officialPermissionMatrix.items.some((item) => item.platform === "youtube" && item.scopes.some((scope) => scope.scope.includes("youtube.upload"))));
    assert.ok(officialPermissionMatrix.items.every((item) => item.scopes.every((scope) => scope.requestPortalUrl.startsWith("https://"))));
    assert.ok(officialPermissionMatrix.items.every((item) => item.scopes.every((scope) => scope.officialReferenceUrl.startsWith("https://"))));
    assert.ok(officialPermissionMatrix.items.every((item) => item.scopes.every((scope) => scope.portalProduct.length > 8)));
    assert.ok(officialPermissionMatrix.items.every((item) => item.scopes.every((scope) => ["request_now", "human_login_recheck"].includes(scope.requestMode))));
    assert.ok(officialPermissionMatrix.items.every((item) => item.scopes.every((scope) => scope.ownerAction.length > 20)));
    assert.ok(officialPermissionMatrix.items.some((item) => item.platform === "instagram" && item.scopes.every((scope) => scope.requestMode === "human_login_recheck" && scope.humanBlocker?.includes("Meta Developers login"))));
    assert.ok(officialPermissionMatrix.items.some((item) => item.platform === "tiktok" && item.scopes.every((scope) => scope.requestMode === "request_now" && scope.humanBlocker === null)));
    assert.ok(officialPermissionMatrix.items.every((item) => item.scopes.every((scope) => scope.verifiedAt === "2026-06-23" && scope.verificationNote.length > 20)));
    assert.ok(officialPermissionMatrix.items.some((item) => item.platform === "instagram" && item.scopes.every((scope) => scope.verificationStatus === "official_login_required")));
    assert.ok(officialPermissionMatrix.items.every((item) => item.scopes.every((scope) => scope.verificationChecklist.length >= 3)));
    assert.ok(officialPermissionMatrix.items.some((item) => item.platform === "instagram" && item.scopes.some((scope) => scope.verificationChecklist.some((step) => step.includes("Log in to Meta Developers")))));
    assert.ok(officialPermissionMatrix.items.every((item) => item.scopes.every((scope) => scope.launchEvidenceBatchRow.startsWith("permission,,"))));
    assert.ok(officialPermissionMatrix.items.every((item) => item.scopes.every((scope) => scope.portalSubmissionSteps && scope.portalSubmissionSteps.length >= 6)));
    assert.ok(officialPermissionMatrix.items.every((item) => item.scopes.every((scope) => scope.approvalEvidenceBatchRow?.includes(",approved,"))));
    assert.ok(officialPermissionMatrix.items.every((item) => item.scopes.every((scope) => scope.postApprovalChecklist && scope.postApprovalChecklist.length >= 4)));
    assert.ok(officialPermissionMatrix.items.every((item) => item.scopes.every((scope) => scope.complianceRisk && scope.complianceRisk.includes(scope.scope))));
    assert.ok(officialPermissionMatrix.items.every((item) => item.scopes.every((scope) => scope.fallbackPlan && scope.fallbackPlan.length > 20)));
    assert.ok(officialPermissionMatrix.items.every((item) => item.scopes.every((scope) => scope.sourceAudit && scope.sourceAudit.lastCheckedAt === "2026-06-23")));
    assert.ok(officialPermissionMatrix.items.every((item) => item.scopes.every((scope) => scope.sourceAudit?.canonicalUrl === scope.officialReferenceUrl)));
    assert.ok(officialPermissionMatrix.items.some((item) => item.platform === "instagram" && item.scopes.every((scope) => scope.sourceAudit?.accessMode === "login_required" && scope.sourceAudit.needsHumanRecheck)));
    assert.ok(officialPermissionMatrix.items.some((item) => item.platform === "tiktok" && item.scopes.every((scope) => scope.sourceAudit?.accessMode === "public")));
    assert.ok(officialPermissionMatrix.items.some((item) => item.platform === "youtube" && item.scopes.every((scope) => scope.sourceAudit?.goLiveDecision === "ready_to_request")));
    assert.ok(officialPermissionMatrix.items.every((item) => item.scopes.every((scope) => (scope.sourceAudit?.publicEvidence.length || 0) >= 2)));
    assert.ok(officialPermissionMatrix.items.every((item) => item.scopes.every((scope) => scope.sourceProofPack && scope.sourceProofPack.verifiedClaims.length >= 3)));
    assert.ok(officialPermissionMatrix.items.some((item) => item.platform === "tiktok" && item.scopes.every((scope) => scope.sourceProofPack?.status === "ready_to_attach" && scope.sourceProofPack.submitDecision === "request_now")));
    assert.ok(officialPermissionMatrix.items.some((item) => item.platform === "youtube" && item.scopes.every((scope) => scope.sourceProofPack?.officialUrls.some((url) => url.includes("developers.google.com")))));
    assert.ok(officialPermissionMatrix.items.some((item) => item.platform === "instagram" && item.scopes.every((scope) => scope.sourceProofPack?.status === "login_required" && scope.sourceProofPack.blocker?.includes("Meta Developers login"))));
    assert.ok(officialPermissionMatrix.items.every((item) => item.scopes.every((scope) => scope.evidenceRequired.length > 0)));
    assert.ok(officialPermissionMatrix.items.every((item) => (item.publicLaunchBlockers || []).length >= 5));
    assert.ok(officialPermissionMatrix.items.every((item) => (item.minimumApprovalEvidence || []).length >= 4));
    assert.ok(officialPermissionMatrix.items.some((item) => item.platform === "tiktok" && (item.publicLaunchBlockers || []).some((blocker) => blocker.includes("video.publish"))));
    assert.ok(officialPermissionMatrix.items.some((item) => item.platform === "youtube" && (item.minimumApprovalEvidence || []).some((evidence) => evidence.includes("youtube.upload"))));
    assert.equal(officialPermissionMatrix.sourceBatches.length, 3);
    assert.equal(officialPermissionMatrix.totals.sourceBatches, officialPermissionMatrix.sourceBatches.length);
    assert.equal(officialPermissionMatrix.webProofTrail.length, 3);
    assert.ok(officialPermissionMatrix.webProofTrail.some((proof) => proof.platform === "tiktok" && proof.accessMode === "public" && proof.verifiedClaims.length >= 3));
    assert.ok(officialPermissionMatrix.webProofTrail.some((proof) => proof.platform === "instagram" && proof.accessMode === "login_required" && proof.nextHumanAction.includes("Log in")));
    assert.ok(officialPermissionMatrix.webProofTrail.every((proof) => proof.officialUrls.every((url) => url.startsWith("https://"))));
    assert.ok(officialPermissionMatrix.sourceBatches.some((batch) => batch.platform === "tiktok" && batch.accessMode === "public" && batch.submitDecision === "request_now"));
    assert.ok(officialPermissionMatrix.sourceBatches.some((batch) => batch.platform === "instagram" && batch.accessMode === "login_required" && batch.submitDecision === "human_login_recheck"));
    assert.ok(officialPermissionMatrix.sourceBatches.every((batch) => batch.launchEvidenceRows.length === batch.scopes.length));
    assert.ok(officialPermissionMatrix.sourceBatches.every((batch) => batch.approvalEvidenceRows.every((row) => row.includes(",approved,"))));
    assert.ok(officialPermissionMatrix.sourceBatches.every((batch) => batch.recheckSteps.length >= 4));
    assert.ok(officialPermissionMatrix.sourceBatches.every((batch) => batch.officialUrls.every((url) => url.startsWith("https://"))));
    assert.ok(status.commandCenter.steps.some((step) => step.id === "official-permission-matrix" && step.actionUrl === "/api/clippers/prepare-official-permission-matrix"));

    const rawManifest = await readFile(officialPermissionMatrix.manifestPath, "utf8");
    const rawMarkdown = await readFile(officialPermissionMatrix.markdownPath, "utf8");
    const rawCsv = await readFile(officialPermissionMatrix.csvPath, "utf8");
    assert.ok(rawMarkdown.includes("Clippers Official Permission Matrix"));
    assert.ok(rawMarkdown.includes("Web Proof Trail"));
    assert.ok(rawMarkdown.includes("Source Verification Batches"));
    assert.ok(rawManifest.includes("developers.tiktok.com"));
    assert.ok(rawManifest.includes("developers.google.com/youtube"));
    assert.ok(rawManifest.includes("officialReferenceUrl"));
    assert.ok(rawManifest.includes("portalProduct"));
    assert.ok(rawManifest.includes("humanBlocker"));
    assert.ok(rawMarkdown.includes("Portal product"));
    assert.ok(rawMarkdown.includes("Human blocker"));
    assert.ok(rawMarkdown.includes("Official reference"));
    assert.ok(rawManifest.includes("verificationChecklist"));
    assert.ok(rawMarkdown.includes("Verification checklist"));
    assert.ok(rawMarkdown.includes("Source proof pack"));
    assert.ok(rawManifest.includes("sourceProofPack"));
    assert.ok(rawManifest.includes("sourceBatches"));
    assert.ok(rawManifest.includes("webProofTrail"));
    assert.ok(rawManifest.includes("ready_to_attach"));
    assert.ok(rawManifest.includes("portalSubmissionSteps"));
    assert.ok(rawMarkdown.includes("Portal submission steps"));
    assert.ok(rawManifest.includes("sourceAudit"));
    assert.ok(rawMarkdown.includes("Source audit"));
    assert.ok(rawMarkdown.includes("Go-live decision"));
    assert.ok(rawMarkdown.includes("Public launch blockers"));
    assert.ok(rawMarkdown.includes("Minimum approval evidence"));
    assert.ok(rawManifest.includes("publicLaunchBlockers"));
    assert.ok(rawManifest.includes("minimumApprovalEvidence"));
    assert.ok(rawManifest.includes("approvalEvidenceBatchRow"));
    assert.ok(rawMarkdown.includes("Approval Evidence Batch"));
    assert.ok(rawManifest.includes("launchEvidenceBatchRow"));
    assert.ok(rawMarkdown.includes("Launch Evidence Batch"));
    assert.ok(rawCsv.includes("platform,label,source_status,scope"));
    assert.ok(rawCsv.includes("video.publish"));
    assert.ok(rawCsv.includes("youtube.upload"));
    assert.ok(rawCsv.includes("launch_evidence_batch_row"));
    assert.ok(rawCsv.includes("portal_product"));
    assert.ok(rawCsv.includes("human_blocker"));
    assert.ok(rawCsv.includes("web_proof_access_mode"));
    assert.ok(rawCsv.includes("web_proof_next_human_action"));
    assert.ok(rawCsv.includes("public_launch_blockers"));
    assert.ok(rawCsv.includes("minimum_approval_evidence"));
    assert.equal(rawManifest.includes("access_token"), false);
    assert.equal(rawMarkdown.includes("client_secret"), false);
    assert.equal(rawCsv.includes("refresh_token"), false);
  } finally {
    if (previousManifest === null) await unlink(beforeStatus.officialPermissionMatrix.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.officialPermissionMatrix.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.officialPermissionMatrix.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.officialPermissionMatrix.markdownPath, previousMarkdown);
    if (previousCsv === null) await unlink(beforeStatus.officialPermissionMatrix.csvPath).catch(() => undefined);
    else await writeFile(beforeStatus.officialPermissionMatrix.csvPath, previousCsv);
  }
});

test("prepareClipperPermissionSubmissionDossier writes unified platform submission dossier", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.permissionSubmissionDossier.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.permissionSubmissionDossier.markdownPath, "utf8").catch(() => null);
  const previousCsv = await readFile(beforeStatus.permissionSubmissionDossier.csvPath, "utf8").catch(() => null);

  try {
    const { permissionSubmissionDossier, status } = await prepareClipperPermissionSubmissionDossier();
    assert.ok(permissionSubmissionDossier.manifestPath.endsWith("permission-submission-dossier.json"));
    assert.ok(permissionSubmissionDossier.markdownPath.endsWith("permission-submission-dossier.md"));
    assert.ok(permissionSubmissionDossier.csvPath.endsWith("permission-submission-dossier.csv"));
    assert.equal(permissionSubmissionDossier.items.length, status.permissionRequestPack.platformBatches.length);
    assert.equal(permissionSubmissionDossier.totals.platforms, permissionSubmissionDossier.items.length);
    assert.equal(permissionSubmissionDossier.totals.scopes, status.permissionRequestPack.totals.permissions);
    assert.ok(status.officialPermissionMatrix.generatedAt && status.officialPermissionMatrix.generatedAt >= permissionSubmissionDossier.generatedAt.slice(0, 10));
    assert.ok(status.developerApplicationDrafts.generatedAt && status.developerApplicationDrafts.generatedAt >= permissionSubmissionDossier.generatedAt.slice(0, 10));
    assert.ok(permissionSubmissionDossier.totals.requestedRows >= status.permissionRequestPack.totals.platformBatches);
    assert.ok(permissionSubmissionDossier.totals.approvedRows >= status.permissionRequestPack.totals.platformBatches);
    assert.ok(permissionSubmissionDossier.items.some((item) => item.platform === "tiktok" && item.submitDecision === "request_now"));
    assert.ok(permissionSubmissionDossier.items.some((item) => item.platform === "youtube" && item.officialUrls.some((url) => url.startsWith("https://"))));
    assert.ok(permissionSubmissionDossier.items.some((item) => item.platform === "instagram" && item.status === "needs_login_recheck"));
    assert.ok(permissionSubmissionDossier.items.every((item) => item.copyBlock.includes("Requested scopes")));
    assert.ok(permissionSubmissionDossier.items.every((item) => item.requestedEvidenceRows.every((row) => row.includes("\"requested\""))));
    assert.ok(permissionSubmissionDossier.items.every((item) => item.approvedEvidenceRows.every((row) => row.includes("\"approved\""))));
    assert.ok(permissionSubmissionDossier.items.every((item) => item.requestedDropTemplate.startsWith("kind,account_id,platform,status,scope")));
    assert.ok(permissionSubmissionDossier.items.every((item) => item.requestedDropTemplate.includes("\"requested\"")));
    assert.ok(permissionSubmissionDossier.items.every((item) => item.approvedDropTemplate.includes("\"approved\"")));
    assert.equal(status.permissionSubmissionDossier.manifestPath, permissionSubmissionDossier.manifestPath);

    const rawManifest = await readFile(permissionSubmissionDossier.manifestPath, "utf8");
    const rawMarkdown = await readFile(permissionSubmissionDossier.markdownPath, "utf8");
    const rawCsv = await readFile(permissionSubmissionDossier.csvPath, "utf8");
    assert.ok(rawMarkdown.includes("Clippers Permission Submission Dossier"));
    assert.ok(rawMarkdown.includes("Requested evidence rows"));
    assert.ok(rawMarkdown.includes("Approved evidence rows"));
    assert.ok(rawMarkdown.includes("Requested drop template"));
    assert.ok(rawMarkdown.includes("Approved drop template"));
    assert.ok(rawManifest.includes("sourceArtifacts"));
    assert.ok(rawManifest.includes("requestedEvidenceRows"));
    assert.ok(rawManifest.includes("requestedDropTemplate"));
    assert.ok(rawCsv.includes("submit_decision"));
    assert.ok(rawCsv.includes("submission_steps"));
    assert.ok(rawCsv.includes("reviewer_evidence"));
    assert.ok(rawCsv.includes("requested_drop_template"));
    assert.ok(rawCsv.includes("approved_drop_template"));
    assert.ok(rawCsv.includes("done_criteria"));
    assert.ok(rawCsv.includes("Open developer portal"));
    assert.equal(rawManifest.includes("access_token"), false);
    assert.equal(rawMarkdown.includes("client_secret"), false);
    assert.equal(rawCsv.includes("refresh_token"), false);
  } finally {
    if (previousManifest === null) await unlink(beforeStatus.permissionSubmissionDossier.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.permissionSubmissionDossier.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.permissionSubmissionDossier.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.permissionSubmissionDossier.markdownPath, previousMarkdown);
    if (previousCsv === null) await unlink(beforeStatus.permissionSubmissionDossier.csvPath).catch(() => undefined);
    else await writeFile(beforeStatus.permissionSubmissionDossier.csvPath, previousCsv);
  }
});

test("prepareClipperPublisherConnectors writes platform publish preflight contracts", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.publisherConnectors.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.publisherConnectors.markdownPath, "utf8").catch(() => null);

  try {
    const { publisherConnectors, status } = await prepareClipperPublisherConnectors();
    assert.equal(publisherConnectors.items.length, 3);
    assert.ok(publisherConnectors.items.some((item) => item.platform === "tiktok" && item.endpoint.includes("open.tiktokapis.com") && item.requiredScopes.includes("video.publish")));
    assert.ok(publisherConnectors.items.some((item) => item.platform === "instagram" && item.endpoint.includes("graph.facebook.com") && item.mode === "media_publish"));
    assert.ok(publisherConnectors.items.some((item) => item.platform === "youtube" && item.endpoint.includes("googleapis.com/upload/youtube") && item.requiredScopes.some((scope) => scope.includes("youtube.upload"))));
    assert.ok(publisherConnectors.items.every((item) => item.payloadFields.length > 0 && item.preflightChecks.length > 0));
    assert.ok(publisherConnectors.items.every((item) => item.publishGate === "blocked" || item.goLiveChecks.every((check) => check.id && check.label)));
    assert.ok(publisherConnectors.items.some((item) => item.blockingCategories.includes("token")));
    assert.ok(publisherConnectors.items.every((item) => item.proofNeeded.length > 0 || item.status === "ready"));
    assert.ok(status.commandCenter.steps.some((step) => step.id === "publisher-connectors" && step.actionUrl === "/api/clippers/prepare-publisher-connectors"));

    const rawManifest = await readFile(publisherConnectors.manifestPath, "utf8");
    const rawMarkdown = await readFile(publisherConnectors.markdownPath, "utf8");
    assert.ok(rawMarkdown.includes("Clippers Publisher Connectors"));
    assert.ok(rawMarkdown.includes("Publish gate"));
    assert.ok(rawMarkdown.includes("Go-live checks"));
    assert.equal(rawManifest.includes("access_token_value"), false);
    assert.equal(rawMarkdown.includes("client_secret"), false);
  } finally {
    if (previousManifest === null) await unlink(beforeStatus.publisherConnectors.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.publisherConnectors.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.publisherConnectors.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.publisherConnectors.markdownPath, previousMarkdown);
  }
});

test("prepareClipperMetricoolPublishingPlan writes Sports and Memes Metricool launch channels", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.metricoolPublishing.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.metricoolPublishing.markdownPath, "utf8").catch(() => null);
  const previousCsv = await readFile(beforeStatus.metricoolPublishing.csvPath, "utf8").catch(() => null);
  const cachePath = path.join(process.cwd(), "marketing_command_center_data", "metricool-brands.json");
  const previousCache = await readFile(cachePath, "utf8").catch(() => null);
  const previousToken = process.env.METRICOOL_USER_TOKEN;
  const previousUserId = process.env.METRICOOL_USER_ID;
  const previousRequireApproval = process.env.METRICOOL_REQUIRE_APPROVAL_FOR_PUBLISH;
  process.env.METRICOOL_USER_TOKEN = "token_live";
  process.env.METRICOOL_USER_ID = "12345";
  process.env.METRICOOL_REQUIRE_APPROVAL_FOR_PUBLISH = "false";
  const fetchMock = mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
    data: [
      { id: 6431687, label: "SPORT", timezone: "America/New_York", networksData: { tiktokData: "streamersclipusa" } },
      { id: 6431685, label: "memes", timezone: "America/New_York", networksData: { tiktokData: "streamersclips" } },
    ],
  }), { status: 200, headers: { "content-type": "application/json" } }));

  try {
    const { metricoolPublishing, status } = await prepareClipperMetricoolPublishingPlan();
    assert.equal(metricoolPublishing.primaryBridge, "metricool");
    assert.equal(metricoolPublishing.channels.length, 2);
    assert.ok(metricoolPublishing.channels.some((channel) => channel.accountId === "sports-daily" && channel.metricoolBrandName === "SPORT" && channel.metricoolBlogId === "6431687"));
    assert.ok(metricoolPublishing.channels.some((channel) => channel.accountId === "meme-radar" && channel.metricoolBrandName === "memes" && channel.metricoolBlogId === "6431685"));
    assert.ok(metricoolPublishing.channels.every((channel) => channel.networks.includes("tiktok") && channel.networks.includes("instagram")));
    assert.ok(metricoolPublishing.channels.every((channel) => channel.connectedNetworks.includes("tiktok")));
    assert.ok(metricoolPublishing.channels.some((channel) => channel.accountId === "sports-daily" && channel.connectedProfileHandles.tiktok === "streamersclipusa" && channel.connectedProfileUrls.tiktok === "https://www.tiktok.com/@streamersclipusa"));
    assert.ok(metricoolPublishing.channels.some((channel) => channel.accountId === "meme-radar" && channel.connectedProfileHandles.tiktok === "streamersclips" && channel.connectedProfileUrls.tiktok === "https://www.tiktok.com/@streamersclips"));
    assert.ok(metricoolPublishing.channels.every((channel) => channel.connectPortalUrl === "https://app.metricool.com/"));
    assert.ok(metricoolPublishing.channels.every((channel) => channel.permissionsToGrant.some((permission) => permission.includes("Instagram"))));
    assert.ok(metricoolPublishing.channels.every((channel) => channel.connectionSteps.some((step) => step.includes("Volver a Clippers"))));
    assert.ok(metricoolPublishing.channels.every((channel) => channel.evidenceNeeded.some((evidence) => evidence.includes("Screenshot"))));
    assert.equal(metricoolPublishing.totals.readyForApprovalQueue, 2);
    assert.equal(metricoolPublishing.directPlatformApisNeeded, false);
    assert.equal(metricoolPublishing.requireApprovalForPublish, false);
    assert.equal(metricoolPublishing.effectiveApprovalGate, true);
    assert.equal(status.metricoolPublishing.primaryBridge, "metricool");
    assert.equal(status.metricoolPublishing.effectiveApprovalGate, true);
    assert.equal(fetchMock.mock.callCount(), 1);

    const rawManifest = await readFile(metricoolPublishing.manifestPath, "utf8");
    const rawMarkdown = await readFile(metricoolPublishing.markdownPath, "utf8");
    const rawCsv = await readFile(metricoolPublishing.csvPath, "utf8");
    assert.match(rawManifest, /SPORT/);
    assert.match(rawMarkdown, /memes/);
    assert.match(rawMarkdown, /Approval env preference: legacy override requested/);
    assert.match(rawMarkdown, /Effective approval gate: required/);
    assert.match(rawCsv, /sports-daily/);
    assert.doesNotMatch(rawManifest, /token_live|METRICOOL_USER_TOKEN=/);
  } finally {
    fetchMock.mock.restore();
    if (previousToken === undefined) delete process.env.METRICOOL_USER_TOKEN;
    else process.env.METRICOOL_USER_TOKEN = previousToken;
    if (previousUserId === undefined) delete process.env.METRICOOL_USER_ID;
    else process.env.METRICOOL_USER_ID = previousUserId;
    if (previousRequireApproval === undefined) delete process.env.METRICOOL_REQUIRE_APPROVAL_FOR_PUBLISH;
    else process.env.METRICOOL_REQUIRE_APPROVAL_FOR_PUBLISH = previousRequireApproval;
    if (previousManifest === null) await unlink(beforeStatus.metricoolPublishing.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.metricoolPublishing.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.metricoolPublishing.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.metricoolPublishing.markdownPath, previousMarkdown);
    if (previousCsv === null) await unlink(beforeStatus.metricoolPublishing.csvPath).catch(() => undefined);
    else await writeFile(beforeStatus.metricoolPublishing.csvPath, previousCsv);
    if (previousCache === null) await unlink(cachePath).catch(() => undefined);
    else await writeFile(cachePath, previousCache);
  }
});

test("prepareClipperMetricoolExecutionQueue maps automation posts to connected Metricool TikTok brands", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.metricoolExecutionQueue.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.metricoolExecutionQueue.markdownPath, "utf8").catch(() => null);
  const previousCsv = await readFile(beforeStatus.metricoolExecutionQueue.csvPath, "utf8").catch(() => null);
  const cachePath = path.join(process.cwd(), "marketing_command_center_data", "metricool-brands.json");
  const previousCache = await readFile(cachePath, "utf8").catch(() => null);
  const previousToken = process.env.METRICOOL_USER_TOKEN;
  const previousUserId = process.env.METRICOOL_USER_ID;
  const previousRealPublish = process.env.CLIPPERS_ENABLE_REAL_PUBLISH;
  const previousRequireApproval = process.env.METRICOOL_REQUIRE_APPROVAL_FOR_PUBLISH;
  process.env.METRICOOL_USER_TOKEN = "token_live";
  process.env.METRICOOL_USER_ID = "12345";
  process.env.CLIPPERS_ENABLE_REAL_PUBLISH = "true";
  process.env.METRICOOL_REQUIRE_APPROVAL_FOR_PUBLISH = "false";
  const fetchMock = mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
    data: [
      { id: 6431687, label: "SPORT", timezone: "America/New_York", networksData: { tiktok: { connected: true } } },
      { id: 6431685, label: "memes", timezone: "America/New_York", networksData: { tiktok: { connected: true } } },
    ],
  }), { status: 200, headers: { "content-type": "application/json" } }));

  try {
    await prepareClipperMetricoolPublishingPlan();
    await runClipperAutomationCycle({ publishMode: "auto_after_connection", riskTolerance: "growth" }, "metricool-exec-test");
    const { metricoolExecutionQueue, status } = await prepareClipperMetricoolExecutionQueue();

    assert.ok(metricoolExecutionQueue.items.length > 0);
    assert.ok(metricoolExecutionQueue.items.every((item) => item.platform === "tiktok"));
    assert.ok(metricoolExecutionQueue.items.every((item) => item.metricoolBlogId === "6431687" || item.metricoolBlogId === "6431685"));
    assert.ok(metricoolExecutionQueue.items.every((item) => item.requestSpec.bridge === "metricool"));
    assert.equal(metricoolExecutionQueue.realPublishEnabled, false);
    assert.equal(metricoolExecutionQueue.totals.readyToSend, 0);
    assert.ok(metricoolExecutionQueue.items.every((item) => item.status !== "ready_to_send" && item.canSendNow === false));
    assert.equal(metricoolExecutionQueue.sourceReadiness.totals.accounts, 2);
    assert.equal(metricoolExecutionQueue.sourceReadiness.totals.connectedNetworks, 2);
    assert.ok(metricoolExecutionQueue.sourceReadiness.totals.missingSourceAssets >= 0);
    assert.ok(metricoolExecutionQueue.sourceReadiness.categories.some((item) => item.accountId === "sports-daily" && item.category === "sports"));
    assert.ok(metricoolExecutionQueue.sourceReadiness.categories.some((item) => item.accountId === "meme-radar" && item.category === "memes"));
    assert.equal(metricoolExecutionQueue.sourceReadiness.categories.some((item) => item.category === "streamers"), false);
    assert.equal(status.metricoolExecutionQueue.manifestPath, metricoolExecutionQueue.manifestPath);

    const rawManifest = await readFile(metricoolExecutionQueue.manifestPath, "utf8");
    const rawMarkdown = await readFile(metricoolExecutionQueue.markdownPath, "utf8");
    const rawCsv = await readFile(metricoolExecutionQueue.csvPath, "utf8");
    assert.match(rawManifest, /metricool/);
    assert.match(rawManifest, /sourceReadiness/);
    assert.match(rawMarkdown, /Metricool Execution Queue/);
    assert.match(rawMarkdown, /Source Readiness/);
    assert.match(rawCsv, /tiktok/);
    assert.doesNotMatch(rawManifest, /token_live|METRICOOL_USER_TOKEN=/);
  } finally {
    fetchMock.mock.restore();
    if (previousToken === undefined) delete process.env.METRICOOL_USER_TOKEN;
    else process.env.METRICOOL_USER_TOKEN = previousToken;
    if (previousUserId === undefined) delete process.env.METRICOOL_USER_ID;
    else process.env.METRICOOL_USER_ID = previousUserId;
    if (previousRealPublish === undefined) delete process.env.CLIPPERS_ENABLE_REAL_PUBLISH;
    else process.env.CLIPPERS_ENABLE_REAL_PUBLISH = previousRealPublish;
    if (previousRequireApproval === undefined) delete process.env.METRICOOL_REQUIRE_APPROVAL_FOR_PUBLISH;
    else process.env.METRICOOL_REQUIRE_APPROVAL_FOR_PUBLISH = previousRequireApproval;
    if (previousManifest === null) await unlink(beforeStatus.metricoolExecutionQueue.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.metricoolExecutionQueue.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.metricoolExecutionQueue.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.metricoolExecutionQueue.markdownPath, previousMarkdown);
    if (previousCsv === null) await unlink(beforeStatus.metricoolExecutionQueue.csvPath).catch(() => undefined);
    else await writeFile(beforeStatus.metricoolExecutionQueue.csvPath, previousCsv);
    if (previousCache === null) await unlink(cachePath).catch(() => undefined);
    else await writeFile(cachePath, previousCache);
  }
});

test("prepareClipperMetricoolMvpLaunchPack separates approval queue MVP from full autopublish blockers", async () => {
  const beforeStatus = await getClipperStatus();
  const previousPublishingManifest = await readFile(beforeStatus.metricoolPublishing.manifestPath, "utf8").catch(() => null);
  const previousPublishingMarkdown = await readFile(beforeStatus.metricoolPublishing.markdownPath, "utf8").catch(() => null);
  const previousPublishingCsv = await readFile(beforeStatus.metricoolPublishing.csvPath, "utf8").catch(() => null);
  const previousQueueManifest = await readFile(beforeStatus.metricoolExecutionQueue.manifestPath, "utf8").catch(() => null);
  const previousQueueMarkdown = await readFile(beforeStatus.metricoolExecutionQueue.markdownPath, "utf8").catch(() => null);
  const previousQueueCsv = await readFile(beforeStatus.metricoolExecutionQueue.csvPath, "utf8").catch(() => null);
  const mvpManifestPath = path.join(process.cwd(), "clippers_workspace", "scheduled", "metricool-mvp-launch-pack.json");
  const mvpMarkdownPath = path.join(process.cwd(), "clippers_workspace", "scheduled", "metricool-mvp-launch-pack.md");
  const mvpCsvPath = path.join(process.cwd(), "clippers_workspace", "scheduled", "metricool-mvp-launch-pack.csv");
  const previousMvpManifest = await readFile(mvpManifestPath, "utf8").catch(() => null);
  const previousMvpMarkdown = await readFile(mvpMarkdownPath, "utf8").catch(() => null);
  const previousMvpCsv = await readFile(mvpCsvPath, "utf8").catch(() => null);
  const cachePath = path.join(process.cwd(), "marketing_command_center_data", "metricool-brands.json");
  const previousCache = await readFile(cachePath, "utf8").catch(() => null);
  const previousToken = process.env.METRICOOL_USER_TOKEN;
  const previousUserId = process.env.METRICOOL_USER_ID;
  const previousRealPublish = process.env.CLIPPERS_ENABLE_REAL_PUBLISH;
  const previousRequireApproval = process.env.METRICOOL_REQUIRE_APPROVAL_FOR_PUBLISH;
  process.env.METRICOOL_USER_TOKEN = "token_live";
  process.env.METRICOOL_USER_ID = "12345";
  process.env.CLIPPERS_ENABLE_REAL_PUBLISH = "true";
  process.env.METRICOOL_REQUIRE_APPROVAL_FOR_PUBLISH = "false";
  const fetchMock = mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
    data: [
      { id: 6431687, label: "SPORT", timezone: "America/New_York", networksData: { tiktok: { connected: true } } },
      { id: 6431685, label: "memes", timezone: "America/New_York", networksData: { tiktok: { connected: true } } },
    ],
  }), { status: 200, headers: { "content-type": "application/json" } }));

  try {
    await prepareMetricoolOwnedSourceFixtures();
    await prepareClipperMetricoolPublishingPlan();
    await runClipperAutomationCycle({ publishMode: "auto_after_connection", riskTolerance: "growth" }, "metricool-mvp-test");
    await prepareClipperSourceAcquisitionPlan();
    await prepareClipperProductionQueue();
    await prepareClipperMetricoolExecutionQueue();
    const { metricoolMvpLaunchPack, status } = await prepareClipperMetricoolMvpLaunchPack();

    assert.equal(metricoolMvpLaunchPack.mode, "metricool_approval_required_mvp");
    assert.equal(metricoolMvpLaunchPack.primaryBridge, "metricool");
    assert.equal(metricoolMvpLaunchPack.directPlatformApisNeeded, false);
    assert.equal(metricoolMvpLaunchPack.realPublishEnabled, false);
    assert.equal(metricoolMvpLaunchPack.approvalRequired, true);
    assert.equal(metricoolMvpLaunchPack.status, "ready_for_review");
    assert.equal(metricoolMvpLaunchPack.totals.accounts, 2);
    assert.equal(metricoolMvpLaunchPack.totals.readyAccounts, 2);
    assert.equal(metricoolMvpLaunchPack.totals.blockedAccounts, 0);
    assert.ok(metricoolMvpLaunchPack.totals.queuedForApproval > 0);
    assert.equal(metricoolMvpLaunchPack.totals.manualReadyPosts, 0);
    assert.ok(metricoolMvpLaunchPack.totals.rightsReadyAssets >= metricoolMvpLaunchPack.totals.minimumWeeklySourceAssets);
    assert.ok(metricoolMvpLaunchPack.targetAccounts.includes("Sports Daily Clips"));
    assert.ok(metricoolMvpLaunchPack.targetAccounts.includes("Meme Radar"));
    assert.ok(metricoolMvpLaunchPack.rows.every((row) => row.primaryNetwork === "tiktok"));
    assert.ok(metricoolMvpLaunchPack.rows.every((row) => row.status === "ready_for_review"));
    assert.ok(metricoolMvpLaunchPack.fullAutomationStillBlockedBy.some((item) => item.includes("developer app")));
    assert.ok(metricoolMvpLaunchPack.fullAutomationStillBlockedBy.some((item) => item.includes("account proof")));
    assert.ok(metricoolMvpLaunchPack.guardrails.some((guardrail) => guardrail.includes("does not auto-publish")));
    assert.equal(status.metricoolExecutionQueue.realPublishEnabled, false);
    assert.equal(status.metricoolExecutionQueue.totals.readyToSend, 0);

    const rawManifest = await readFile(metricoolMvpLaunchPack.manifestPath, "utf8");
    const rawMarkdown = await readFile(metricoolMvpLaunchPack.markdownPath, "utf8");
    const rawCsv = await readFile(metricoolMvpLaunchPack.csvPath, "utf8");
    assert.match(rawMarkdown, /Metricool MVP Launch Pack/);
    assert.match(rawMarkdown, /approval_required/);
    assert.match(rawCsv, /sports-daily/);
    assert.doesNotMatch(rawManifest, /token_live|METRICOOL_USER_TOKEN=/);
    assert.doesNotMatch(rawMarkdown, /token_live|METRICOOL_USER_TOKEN=/);
  } finally {
    fetchMock.mock.restore();
    if (previousToken === undefined) delete process.env.METRICOOL_USER_TOKEN;
    else process.env.METRICOOL_USER_TOKEN = previousToken;
    if (previousUserId === undefined) delete process.env.METRICOOL_USER_ID;
    else process.env.METRICOOL_USER_ID = previousUserId;
    if (previousRealPublish === undefined) delete process.env.CLIPPERS_ENABLE_REAL_PUBLISH;
    else process.env.CLIPPERS_ENABLE_REAL_PUBLISH = previousRealPublish;
    if (previousRequireApproval === undefined) delete process.env.METRICOOL_REQUIRE_APPROVAL_FOR_PUBLISH;
    else process.env.METRICOOL_REQUIRE_APPROVAL_FOR_PUBLISH = previousRequireApproval;
    if (previousPublishingManifest === null) await unlink(beforeStatus.metricoolPublishing.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.metricoolPublishing.manifestPath, previousPublishingManifest);
    if (previousPublishingMarkdown === null) await unlink(beforeStatus.metricoolPublishing.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.metricoolPublishing.markdownPath, previousPublishingMarkdown);
    if (previousPublishingCsv === null) await unlink(beforeStatus.metricoolPublishing.csvPath).catch(() => undefined);
    else await writeFile(beforeStatus.metricoolPublishing.csvPath, previousPublishingCsv);
    if (previousQueueManifest === null) await unlink(beforeStatus.metricoolExecutionQueue.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.metricoolExecutionQueue.manifestPath, previousQueueManifest);
    if (previousQueueMarkdown === null) await unlink(beforeStatus.metricoolExecutionQueue.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.metricoolExecutionQueue.markdownPath, previousQueueMarkdown);
    if (previousQueueCsv === null) await unlink(beforeStatus.metricoolExecutionQueue.csvPath).catch(() => undefined);
    else await writeFile(beforeStatus.metricoolExecutionQueue.csvPath, previousQueueCsv);
    if (previousMvpManifest === null) await unlink(mvpManifestPath).catch(() => undefined);
    else await writeFile(mvpManifestPath, previousMvpManifest);
    if (previousMvpMarkdown === null) await unlink(mvpMarkdownPath).catch(() => undefined);
    else await writeFile(mvpMarkdownPath, previousMvpMarkdown);
    if (previousMvpCsv === null) await unlink(mvpCsvPath).catch(() => undefined);
    else await writeFile(mvpCsvPath, previousMvpCsv);
    if (previousCache === null) await unlink(cachePath).catch(() => undefined);
    else await writeFile(cachePath, previousCache);
  }
});

test("prepareClipperMetricoolApprovalSession prepares operator evidence for queued Metricool approvals", async () => {
  const beforeStatus = await getClipperStatus();
  const approvalManifestPath = path.join(process.cwd(), "clippers_workspace", "scheduled", "metricool-approval-session.json");
  const approvalMarkdownPath = path.join(process.cwd(), "clippers_workspace", "scheduled", "metricool-approval-session.md");
  const approvalCsvPath = path.join(process.cwd(), "clippers_workspace", "scheduled", "metricool-approval-session.csv");
  const approvalEvidenceCsvPath = path.join(process.cwd(), "clippers_workspace", "evidence-drop", "metricool-approval-evidence-import.csv");
  const mvpManifestPath = path.join(process.cwd(), "clippers_workspace", "scheduled", "metricool-mvp-launch-pack.json");
  const mvpMarkdownPath = path.join(process.cwd(), "clippers_workspace", "scheduled", "metricool-mvp-launch-pack.md");
  const mvpCsvPath = path.join(process.cwd(), "clippers_workspace", "scheduled", "metricool-mvp-launch-pack.csv");
  const cachePath = path.join(process.cwd(), "marketing_command_center_data", "metricool-brands.json");
  const artifactPaths = [
    beforeStatus.metricoolPublishing.manifestPath,
    beforeStatus.metricoolPublishing.markdownPath,
    beforeStatus.metricoolPublishing.csvPath,
    beforeStatus.metricoolExecutionQueue.manifestPath,
    beforeStatus.metricoolExecutionQueue.markdownPath,
    beforeStatus.metricoolExecutionQueue.csvPath,
    mvpManifestPath,
    mvpMarkdownPath,
    mvpCsvPath,
    approvalManifestPath,
    approvalMarkdownPath,
    approvalCsvPath,
    approvalEvidenceCsvPath,
    cachePath,
  ];
  const previousArtifacts = new Map<string, string | null>();
  for (const filePath of artifactPaths) {
    previousArtifacts.set(filePath, await readFile(filePath, "utf8").catch(() => null));
  }
  const previousToken = process.env.METRICOOL_USER_TOKEN;
  const previousUserId = process.env.METRICOOL_USER_ID;
  const previousRealPublish = process.env.CLIPPERS_ENABLE_REAL_PUBLISH;
  const previousRequireApproval = process.env.METRICOOL_REQUIRE_APPROVAL_FOR_PUBLISH;
  process.env.METRICOOL_USER_TOKEN = "token_live";
  process.env.METRICOOL_USER_ID = "12345";
  process.env.CLIPPERS_ENABLE_REAL_PUBLISH = "true";
  process.env.METRICOOL_REQUIRE_APPROVAL_FOR_PUBLISH = "false";
  const fetchMock = mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
    data: [
      { id: 6431687, label: "SPORT", timezone: "America/New_York", networksData: { tiktok: { connected: true } } },
      { id: 6431685, label: "memes", timezone: "America/New_York", networksData: { tiktok: { connected: true } } },
    ],
  }), { status: 200, headers: { "content-type": "application/json" } }));

  try {
    await prepareMetricoolOwnedSourceFixtures();
    await prepareClipperMetricoolPublishingPlan();
    await runClipperAutomationCycle({ publishMode: "auto_after_connection", riskTolerance: "growth" }, "metricool-approval-session-test");
    await prepareClipperSourceAcquisitionPlan();
    await prepareClipperProductionQueue();
    const { metricoolExecutionQueue } = await prepareClipperMetricoolExecutionQueue();
    await prepareClipperMetricoolMvpLaunchPack();
    const { metricoolApprovalSession, status } = await prepareClipperMetricoolApprovalSession();
    const queuedForApproval = metricoolExecutionQueue.items.filter((item) => item.status === "queued_for_approval");

    assert.ok(queuedForApproval.length > 0);
    assert.equal(metricoolApprovalSession.status, "ready_for_operator");
    assert.equal(metricoolApprovalSession.realPublishEnabled, false);
    assert.equal(metricoolApprovalSession.approvalRequired, true);
    assert.ok(metricoolApprovalSession.totals.readyForReview > 0);
    assert.equal(metricoolApprovalSession.totals.blocked, 0);
    assert.equal(metricoolApprovalSession.totals.items, queuedForApproval.length);
    assert.deepEqual(metricoolApprovalSession.items.map((item) => item.id), queuedForApproval.map((item) => item.id));
    assert.ok(metricoolApprovalSession.items.every((item) => item.status === "ready_for_review"));
    assert.ok(metricoolApprovalSession.items.every((item) =>
      item.evidenceCaptureRow.includes("<published post URL after live>")
      && item.evidenceCaptureRow.includes("<metricool scheduled/approved/post URL>")
    ));
    assert.equal(status.metricoolApprovalSession.totals.items, metricoolApprovalSession.totals.items);
    assert.equal(status.metricoolApprovalSession.totals.readyForReview, metricoolApprovalSession.totals.readyForReview);

    const rawManifest = await readFile(metricoolApprovalSession.manifestPath, "utf8");
    const rawMarkdown = await readFile(metricoolApprovalSession.markdownPath, "utf8");
    const rawCsv = await readFile(metricoolApprovalSession.csvPath, "utf8");
    const rawEvidenceCsv = await readFile(metricoolApprovalSession.evidenceImportCsvPath, "utf8");
    assert.equal(metricoolApprovalSession.manifestPath, approvalManifestPath);
    assert.equal(metricoolApprovalSession.markdownPath, approvalMarkdownPath);
    assert.equal(metricoolApprovalSession.csvPath, approvalCsvPath);
    assert.equal(metricoolApprovalSession.evidenceImportCsvPath, approvalEvidenceCsvPath);
    assert.match(rawMarkdown, /Metricool Approval Session/);
    assert.match(rawCsv, /ready_for_review/);
    assert.ok(rawEvidenceCsv.split("\n")[0].includes("metricool_queue_item_id"));

    const rawArtifacts = [rawManifest, rawMarkdown, rawCsv, rawEvidenceCsv].join("\n");
    assert.doesNotMatch(rawArtifacts, /token_live|METRICOOL_USER_TOKEN|METRICOOL_USER_ID|client_secret|access_token_value/);
  } finally {
    fetchMock.mock.restore();
    if (previousToken === undefined) delete process.env.METRICOOL_USER_TOKEN;
    else process.env.METRICOOL_USER_TOKEN = previousToken;
    if (previousUserId === undefined) delete process.env.METRICOOL_USER_ID;
    else process.env.METRICOOL_USER_ID = previousUserId;
    if (previousRealPublish === undefined) delete process.env.CLIPPERS_ENABLE_REAL_PUBLISH;
    else process.env.CLIPPERS_ENABLE_REAL_PUBLISH = previousRealPublish;
    if (previousRequireApproval === undefined) delete process.env.METRICOOL_REQUIRE_APPROVAL_FOR_PUBLISH;
    else process.env.METRICOOL_REQUIRE_APPROVAL_FOR_PUBLISH = previousRequireApproval;
    for (const [filePath, previous] of previousArtifacts) {
      if (previous === null) await unlink(filePath).catch(() => undefined);
      else await writeFile(filePath, previous);
    }
  }
});

test("prepareClipperMetricoolApprovalReport audits queue evidence without counting queued as published", async () => {
  const beforeStatus = await getClipperStatus();
  const approvalEvidenceCsvPath = path.join(process.cwd(), "clippers_workspace", "evidence-drop", "metricool-approval-evidence-import.csv");
  const approvalReportPath = path.join(process.cwd(), "clippers_workspace", "reports", "metricool-approval-report.json");
  const approvalReportMarkdownPath = path.join(process.cwd(), "clippers_workspace", "reports", "metricool-approval-report.md");
  const approvalReportCsvPath = path.join(process.cwd(), "clippers_workspace", "reports", "metricool-approval-report.csv");
  const importedMetricsPath = path.join(process.cwd(), "clippers_workspace", "metrics", "metricool-approval-imported-metrics.csv");
  const metricsSummaryPath = path.join(process.cwd(), "clippers_workspace", "metrics", "metrics-summary.json");
  const artifactPaths = [
    beforeStatus.metricoolPublishing.manifestPath,
    beforeStatus.metricoolPublishing.markdownPath,
    beforeStatus.metricoolPublishing.csvPath,
    beforeStatus.metricoolExecutionQueue.manifestPath,
    beforeStatus.metricoolExecutionQueue.markdownPath,
    beforeStatus.metricoolExecutionQueue.csvPath,
    beforeStatus.metricoolApprovalSession.manifestPath,
    beforeStatus.metricoolApprovalSession.markdownPath,
    beforeStatus.metricoolApprovalSession.csvPath,
    approvalEvidenceCsvPath,
    approvalReportPath,
    approvalReportMarkdownPath,
    approvalReportCsvPath,
    importedMetricsPath,
    metricsSummaryPath,
    path.join(process.cwd(), "marketing_command_center_data", "metricool-brands.json"),
  ];
  const previousArtifacts = new Map<string, string | null>();
  for (const filePath of artifactPaths) {
    previousArtifacts.set(filePath, await readFile(filePath, "utf8").catch(() => null));
  }
  const previousToken = process.env.METRICOOL_USER_TOKEN;
  const previousUserId = process.env.METRICOOL_USER_ID;
  const previousRealPublish = process.env.CLIPPERS_ENABLE_REAL_PUBLISH;
  const previousRequireApproval = process.env.METRICOOL_REQUIRE_APPROVAL_FOR_PUBLISH;
  process.env.METRICOOL_USER_TOKEN = "token_live_report";
  process.env.METRICOOL_USER_ID = "12345";
  process.env.CLIPPERS_ENABLE_REAL_PUBLISH = "true";
  process.env.METRICOOL_REQUIRE_APPROVAL_FOR_PUBLISH = "false";
  const fetchMock = mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
    data: [
      { id: 6431687, label: "SPORT", timezone: "America/New_York", networksData: { tiktok: { connected: true } } },
      { id: 6431685, label: "memes", timezone: "America/New_York", networksData: { tiktok: { connected: true } } },
    ],
  }), { status: 200, headers: { "content-type": "application/json" } }));

  try {
    await prepareMetricoolOwnedSourceFixtures();
    await prepareClipperMetricoolPublishingPlan();
    await runClipperAutomationCycle({ publishMode: "auto_after_connection", riskTolerance: "growth" }, "metricool-approval-report-test");
    await prepareClipperSourceAcquisitionPlan();
    await prepareClipperProductionQueue();
    await prepareClipperMetricoolExecutionQueue();
    await prepareClipperMetricoolMvpLaunchPack();
    const { metricoolApprovalSession } = await prepareClipperMetricoolApprovalSession();
    const firstItem = metricoolApprovalSession.items[0];
    assert.ok(firstItem);

    await mkdir(path.dirname(approvalEvidenceCsvPath), { recursive: true });
    await writeFile(approvalEvidenceCsvPath, [
      "metricool_queue_item_id,account_id,account_name,platform,metricool_brand_name,metricool_blog_id,scheduled_for,source_path,caption_seed,metricool_approval_url,published_post_url,final_status,views_24h,likes_24h,comments_24h,shares_24h,operator_notes",
      `${firstItem.id},${firstItem.accountId},${firstItem.accountName},${firstItem.platform},${firstItem.metricoolBrandName},${firstItem.metricoolBlogId || ""},${firstItem.publishAt},${firstItem.sourcePath || ""},${firstItem.captionSeed},https://app.metricool.com/planner/post/${firstItem.id},https://www.tiktok.com/@sportsdaily/video/reportgood,published,4200,210,31,18,Public URL and 24h metrics captured from Metricool export`,
    ].join("\n"));
    await unlink(importedMetricsPath).catch(() => undefined);
    const metricsSummaryBeforeReport = await readFile(metricsSummaryPath, "utf8").catch(() => null);

    const { metricoolApprovalReport, status } = await prepareClipperMetricoolApprovalReport();

    assert.equal(metricoolApprovalReport.status, "ready_to_import");
    assert.equal(metricoolApprovalReport.realPublishEnabled, false);
    assert.equal(metricoolApprovalReport.approvalRequired, true);
    assert.equal(metricoolApprovalReport.totals.queueItems, metricoolApprovalSession.totals.items);
    assert.equal(metricoolApprovalReport.totals.readyForReview, metricoolApprovalSession.totals.readyForReview);
    assert.equal(metricoolApprovalReport.totals.imported, 1);
    assert.equal(metricoolApprovalReport.totals.publishedRows, 1);
    assert.equal(metricoolApprovalReport.totals.views, 4200);
    assert.ok(metricoolApprovalReport.totals.queueItems > metricoolApprovalReport.totals.publishedRows);
    assert.ok(metricoolApprovalReport.guardrails.some((guardrail) => guardrail.includes("queued_for_approval is not published")));
    assert.ok(metricoolApprovalReport.guardrails.some((guardrail) => guardrail.includes("Only the Import Metricool evidence action writes analytics")));
    assert.ok(metricoolApprovalReport.rows.some((row) => row.metricoolQueueItemId === firstItem.id && row.evidenceResult === "imported"));
    assert.ok(metricoolApprovalReport.rows.some((row) => row.metricoolQueueItemId === firstItem.id && row.nextStep.includes("run Import Metricool evidence")));
    assert.equal(status.metricoolApprovalReport.totals.imported, 1);
    assert.equal(await readFile(importedMetricsPath, "utf8").catch(() => null), null);
    assert.equal(await readFile(metricsSummaryPath, "utf8").catch(() => null), metricsSummaryBeforeReport);

    const rawReport = await readFile(metricoolApprovalReport.manifestPath, "utf8");
    const rawMarkdown = await readFile(metricoolApprovalReport.markdownPath, "utf8");
    const rawCsv = await readFile(metricoolApprovalReport.csvPath, "utf8");
    assert.match(rawMarkdown, /Metricool Approval Report/);
    assert.match(rawMarkdown, /Valid published evidence rows/);
    assert.doesNotMatch(rawMarkdown, /Imported into analytics/);
    assert.match(rawCsv, /reportgood/);
    assert.doesNotMatch([rawReport, rawMarkdown, rawCsv].join("\n"), /token_live_report|METRICOOL_USER_TOKEN|METRICOOL_USER_ID|client_secret|access_token_value/);
  } finally {
    fetchMock.mock.restore();
    if (previousToken === undefined) delete process.env.METRICOOL_USER_TOKEN;
    else process.env.METRICOOL_USER_TOKEN = previousToken;
    if (previousUserId === undefined) delete process.env.METRICOOL_USER_ID;
    else process.env.METRICOOL_USER_ID = previousUserId;
    if (previousRealPublish === undefined) delete process.env.CLIPPERS_ENABLE_REAL_PUBLISH;
    else process.env.CLIPPERS_ENABLE_REAL_PUBLISH = previousRealPublish;
    if (previousRequireApproval === undefined) delete process.env.METRICOOL_REQUIRE_APPROVAL_FOR_PUBLISH;
    else process.env.METRICOOL_REQUIRE_APPROVAL_FOR_PUBLISH = previousRequireApproval;
    for (const [filePath, previous] of previousArtifacts) {
      if (previous === null) await unlink(filePath).catch(() => undefined);
      else await writeFile(filePath, previous);
    }
  }
});

test("importClipperMetricoolApprovalEvidence converts published evidence into analytics metrics safely", async () => {
  const statusBefore = await getClipperStatus();
  const evidenceCsvPath = path.join(statusBefore.rootDir, "evidence-drop", "metricool-approval-evidence-import.csv");
  const importedMetricsPath = path.join(statusBefore.rootDir, "metrics", "metricool-approval-imported-metrics.csv");
  const metricsSummaryPath = path.join(statusBefore.rootDir, "metrics", "metrics-summary.json");
  const previousEvidence = await readFile(evidenceCsvPath, "utf8").catch(() => null);
  const previousImportedMetrics = await readFile(importedMetricsPath, "utf8").catch(() => null);
  const previousMetricsSummary = await readFile(metricsSummaryPath, "utf8").catch(() => null);
  await mkdir(path.dirname(evidenceCsvPath), { recursive: true });
  await mkdir(path.dirname(importedMetricsPath), { recursive: true });
  await writeFile(evidenceCsvPath, [
    "metricool_queue_item_id,account_id,account_name,platform,metricool_brand_name,metricool_blog_id,scheduled_for,source_path,caption_seed,metricool_approval_url,published_post_url,final_status,views_24h,likes_24h,comments_24h,shares_24h,operator_notes",
    "metricool-import-good,sports-daily,Sports Daily Clips,tiktok,SPORT,6431687,2026-06-21T12:00:00.000Z,/tmp/owned-sports.mp4,Great final-minute hook,https://app.metricool.com/planner/post/metricool-import-good,https://www.tiktok.com/@sportsdaily/video/metricoolimportgood,published,12500,700,82,44,Live post URL and 24h metrics captured from Metricool export",
    "metricool-import-pending,meme-radar,Meme Radar,tiktok,memes,6431685,2026-06-21T13:00:00.000Z,/tmp/owned-meme.mp4,Pending meme hook,https://app.metricool.com/planner/post/metricool-import-pending,,scheduled,0,0,0,0,Scheduled but not live yet",
    "metricool-import-planner-url,meme-radar,Meme Radar,tiktok,memes,6431685,2026-06-21T14:00:00.000Z,/tmp/owned-planner.mp4,Planner URL hook,https://app.metricool.com/planner/post/metricool-import-planner-url,https://app.metricool.com/planner/post/metricool-import-planner-url,published,999,9,9,9,Metricool planner URL is not a public post",
    "metricool-import-unknown-account,unknown-account,Unknown Account,tiktok,memes,6431685,2026-06-21T15:00:00.000Z,/tmp/owned-unknown.mp4,Unknown account hook,https://app.metricool.com/planner/post/metricool-import-unknown-account,https://www.tiktok.com/@memeradar/video/metricoolunknown,published,888,8,8,8,Unknown account must not fall back to first account",
    "metricool-import-secret,meme-radar,Meme Radar,tiktok,memes,6431685,2026-06-21T16:00:00.000Z,/tmp/owned-secret.mp4,Secret row hook,https://app.metricool.com/planner/post/metricool-import-secret,https://www.tiktok.com/@memeradar/video/metricoolsecret,published,999,9,9,9,api_key=should-not-be-stored",
  ].join("\n"));

  try {
    const { metricoolApprovalEvidenceImport, metrics, status } = await importClipperMetricoolApprovalEvidence();
    assert.equal(metricoolApprovalEvidenceImport.status, "imported");
    assert.equal(metricoolApprovalEvidenceImport.totals.rows, 5);
    assert.equal(metricoolApprovalEvidenceImport.totals.imported, 1);
    assert.equal(metricoolApprovalEvidenceImport.totals.pendingLive, 1);
    assert.equal(metricoolApprovalEvidenceImport.totals.rejected, 3);
    assert.equal(metricoolApprovalEvidenceImport.totals.views, 12500);
    assert.ok(metricoolApprovalEvidenceImport.rows.some((row) => row.metricoolQueueItemId === "metricool-import-secret" && row.result === "rejected"));
    assert.ok(metricoolApprovalEvidenceImport.rows.some((row) => row.metricoolQueueItemId === "metricool-import-planner-url" && row.result === "rejected" && row.reason === "published_post_url_not_platform_post"));
    assert.ok(metricoolApprovalEvidenceImport.rows.some((row) => row.metricoolQueueItemId === "metricool-import-unknown-account" && row.result === "rejected" && row.reason === "unknown_account_id"));
    assert.ok(metrics.records.some((record) => record.clipId === "https://www.tiktok.com/@sportsdaily/video/metricoolimportgood" && record.views === 12500));
    assert.ok(status.metrics.records.some((record) => record.clipId === "https://www.tiktok.com/@sportsdaily/video/metricoolimportgood"));

    const rawImportedMetrics = await readFile(importedMetricsPath, "utf8");
    assert.ok(rawImportedMetrics.includes("metricoolimportgood"));
    assert.equal(rawImportedMetrics.includes("api_key"), false);
    assert.equal(rawImportedMetrics.includes("metricoolsecret"), false);
    assert.equal(rawImportedMetrics.includes("metricool-import-planner-url"), false);

    await writeFile(evidenceCsvPath, [
      "metricool_queue_item_id,account_id,account_name,platform,metricool_brand_name,metricool_blog_id,scheduled_for,source_path,caption_seed,metricool_approval_url,published_post_url,final_status,views_24h,likes_24h,comments_24h,shares_24h,operator_notes",
      "metricool-import-pending-only,meme-radar,Meme Radar,tiktok,memes,6431685,2026-06-22T13:00:00.000Z,/tmp/owned-meme.mp4,Pending-only hook,https://app.metricool.com/planner/post/metricool-import-pending-only,,scheduled,0,0,0,0,Scheduled but not live yet",
    ].join("\n"));
    const secondImport = await importClipperMetricoolApprovalEvidence();
    assert.equal(secondImport.metricoolApprovalEvidenceImport.status, "needs_records");
    assert.equal(secondImport.metricoolApprovalEvidenceImport.totals.imported, 0);
    assert.equal(await readFile(importedMetricsPath, "utf8").catch(() => null), null);
    assert.equal(secondImport.metrics.records.some((record) => record.clipId === "https://www.tiktok.com/@sportsdaily/video/metricoolimportgood"), false);
  } finally {
    if (previousEvidence === null) await unlink(evidenceCsvPath).catch(() => undefined);
    else await writeFile(evidenceCsvPath, previousEvidence);
    if (previousImportedMetrics === null) await unlink(importedMetricsPath).catch(() => undefined);
    else await writeFile(importedMetricsPath, previousImportedMetrics);
    if (previousMetricsSummary === null) await unlink(metricsSummaryPath).catch(() => undefined);
    else await writeFile(metricsSummaryPath, previousMetricsSummary);
  }
});

test("prepareClipperGoLiveExecutionPack surfaces Metricool MVP without marking direct autopublish ready", async () => {
  const beforeStatus = await getClipperStatus();
  const mvpManifestPath = path.join(process.cwd(), "clippers_workspace", "scheduled", "metricool-mvp-launch-pack.json");
  const mvpMarkdownPath = path.join(process.cwd(), "clippers_workspace", "scheduled", "metricool-mvp-launch-pack.md");
  const mvpCsvPath = path.join(process.cwd(), "clippers_workspace", "scheduled", "metricool-mvp-launch-pack.csv");
  const approvalManifestPath = path.join(process.cwd(), "clippers_workspace", "scheduled", "metricool-approval-session.json");
  const approvalMarkdownPath = path.join(process.cwd(), "clippers_workspace", "scheduled", "metricool-approval-session.md");
  const approvalCsvPath = path.join(process.cwd(), "clippers_workspace", "scheduled", "metricool-approval-session.csv");
  const approvalEvidenceCsvPath = path.join(process.cwd(), "clippers_workspace", "evidence-drop", "metricool-approval-evidence-import.csv");
  const cachePath = path.join(process.cwd(), "marketing_command_center_data", "metricool-brands.json");
  const artifactPaths = [
    beforeStatus.metricoolPublishing.manifestPath,
    beforeStatus.metricoolPublishing.markdownPath,
    beforeStatus.metricoolPublishing.csvPath,
    beforeStatus.metricoolExecutionQueue.manifestPath,
    beforeStatus.metricoolExecutionQueue.markdownPath,
    beforeStatus.metricoolExecutionQueue.csvPath,
    mvpManifestPath,
    mvpMarkdownPath,
    mvpCsvPath,
    approvalManifestPath,
    approvalMarkdownPath,
    approvalCsvPath,
    approvalEvidenceCsvPath,
    beforeStatus.goLiveExecutionPack.manifestPath,
    beforeStatus.goLiveExecutionPack.markdownPath,
    cachePath,
  ];
  const previousArtifacts = new Map<string, string | null>();
  for (const filePath of artifactPaths) {
    previousArtifacts.set(filePath, await readFile(filePath, "utf8").catch(() => null));
  }
  const previousToken = process.env.METRICOOL_USER_TOKEN;
  const previousUserId = process.env.METRICOOL_USER_ID;
  const previousRealPublish = process.env.CLIPPERS_ENABLE_REAL_PUBLISH;
  const previousRequireApproval = process.env.METRICOOL_REQUIRE_APPROVAL_FOR_PUBLISH;
  process.env.METRICOOL_USER_TOKEN = "token_live";
  process.env.METRICOOL_USER_ID = "12345";
  process.env.CLIPPERS_ENABLE_REAL_PUBLISH = "true";
  process.env.METRICOOL_REQUIRE_APPROVAL_FOR_PUBLISH = "false";
  const fetchMock = mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
    data: [
      { id: 6431687, label: "SPORT", timezone: "America/New_York", networksData: { tiktok: { connected: true } } },
      { id: 6431685, label: "memes", timezone: "America/New_York", networksData: { tiktok: { connected: true } } },
    ],
  }), { status: 200, headers: { "content-type": "application/json" } }));

  try {
    await prepareMetricoolOwnedSourceFixtures();
    await prepareClipperMetricoolPublishingPlan();
    await runClipperAutomationCycle({ publishMode: "auto_after_connection", riskTolerance: "growth" }, "go-live-metricool-lane-test");
    await prepareClipperSourceAcquisitionPlan();
    await prepareClipperProductionQueue();
    await prepareClipperMetricoolExecutionQueue();
    await prepareClipperMetricoolMvpLaunchPack();
    await prepareClipperMetricoolApprovalSession();
    const { goLiveExecutionPack, status } = await prepareClipperGoLiveExecutionPack();

    assert.equal(goLiveExecutionPack.metricoolMvp.status, "ready_for_operator");
    assert.equal(goLiveExecutionPack.metricoolMvp.bridge, "metricool");
    assert.equal(goLiveExecutionPack.metricoolMvp.approvalRequired, true);
    assert.equal(goLiveExecutionPack.metricoolMvp.realPublishEnabled, false);
    assert.ok(goLiveExecutionPack.metricoolMvp.queuedForApproval > 0);
    assert.ok(goLiveExecutionPack.metricoolMvp.readyForReview > 0);
    assert.match(goLiveExecutionPack.metricoolMvp.nextStep, /full direct autopublish/);
    assert.doesNotMatch(goLiveExecutionPack.nextStep, /Metricool MVP ready/);
    assert.notEqual(goLiveExecutionPack.status, "ready");
    assert.equal(status.goLiveExecutionPack.metricoolMvp.status, "ready_for_operator");
    assert.equal(status.metricoolExecutionQueue.realPublishEnabled, false);
    assert.equal(status.metricoolExecutionQueue.totals.readyToSend, 0);
    assert.ok(status.goLiveCompletionAudit.requirements.some((item) =>
      item.id === "publishing-bridge-connected"
      && item.status === "verified"
      && item.currentEvidence.includes("queue=approval_required")
    ));
    assert.ok(status.goLiveCompletionAudit.requirements.some((item) =>
      item.id === "publisher-connectors-ready"
      && item.status === "verified"
      && item.currentEvidence.includes("queue=approval_required")
    ));

    const rawManifest = await readFile(goLiveExecutionPack.manifestPath, "utf8");
    const rawMarkdown = await readFile(goLiveExecutionPack.markdownPath, "utf8");
    assert.match(rawMarkdown, /Metricool MVP Lane/);
    assert.match(rawMarkdown, /full direct autopublish/);
    assert.doesNotMatch(rawManifest, /token_live|METRICOOL_USER_TOKEN|client_secret|access_token/);
    assert.doesNotMatch(rawMarkdown, /token_live|METRICOOL_USER_TOKEN|client_secret|access_token/);
  } finally {
    fetchMock.mock.restore();
    if (previousToken === undefined) delete process.env.METRICOOL_USER_TOKEN;
    else process.env.METRICOOL_USER_TOKEN = previousToken;
    if (previousUserId === undefined) delete process.env.METRICOOL_USER_ID;
    else process.env.METRICOOL_USER_ID = previousUserId;
    if (previousRealPublish === undefined) delete process.env.CLIPPERS_ENABLE_REAL_PUBLISH;
    else process.env.CLIPPERS_ENABLE_REAL_PUBLISH = previousRealPublish;
    if (previousRequireApproval === undefined) delete process.env.METRICOOL_REQUIRE_APPROVAL_FOR_PUBLISH;
    else process.env.METRICOOL_REQUIRE_APPROVAL_FOR_PUBLISH = previousRequireApproval;
    for (const [filePath, previous] of previousArtifacts) {
      if (previous === null) await unlink(filePath).catch(() => undefined);
      else await writeFile(filePath, previous);
    }
  }
});

test("getClipperStatus normalizes stale Metricool cache to approval-only", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.metricoolExecutionQueue.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.metricoolExecutionQueue.markdownPath, "utf8").catch(() => null);
  const previousCsv = await readFile(beforeStatus.metricoolExecutionQueue.csvPath, "utf8").catch(() => null);

  try {
    await writeFile(beforeStatus.metricoolExecutionQueue.manifestPath, JSON.stringify({
      status: "ready",
      generatedAt: new Date().toISOString(),
      sourceAutomationRunId: "stale-ready-cache",
      publishMode: "auto_after_connection",
      realPublishEnabled: true,
      sourceReadiness: {
        status: "ready",
        categories: [],
        totals: { accounts: 0, connectedNetworks: 0, dailyClipTarget: 0, weeklyTargetClips: 0, minimumWeeklySourceAssets: 0, rightsReadyAssets: 0, missingSourceAssets: 0 },
        nextStep: "stale cache",
      },
      items: [{
        id: "stale-ready-item",
        postId: "post-1",
        queueItemId: "queue-1",
        accountId: "sports-daily",
        accountName: "Sports Daily",
        platform: "tiktok",
        status: "ready_to_send",
        approvalRequired: false,
        canSendNow: true,
        metricoolBrandName: "SPORT",
        metricoolBlogId: "6431687",
        publishAt: new Date().toISOString(),
        sourcePath: "/tmp/source.mp4",
        hook: "stale",
        captionSeed: "stale",
        requestSpec: { bridge: "metricool", endpoint: "stale", method: "auto", payloadFields: [], mediaSource: "/tmp/source.mp4" },
        gates: [],
        blockers: [],
        nextStep: "stale",
      }],
      totals: { items: 1, blocked: 0, queuedForApproval: 0, readyToSend: 1, approvalRequired: 0 },
      nextStep: "stale",
    }, null, 2));

    const status = await getClipperStatus();
    assert.equal(status.metricoolExecutionQueue.realPublishEnabled, false);
    assert.equal(status.metricoolExecutionQueue.status, "approval_required");
    assert.equal(status.metricoolExecutionQueue.publishMode, "approval_required");
    assert.equal(status.metricoolExecutionQueue.totals.readyToSend, 0);
    assert.equal(status.metricoolExecutionQueue.totals.queuedForApproval, 1);
    assert.ok(status.metricoolExecutionQueue.items.every((item) =>
      item.status !== "ready_to_send" && item.approvalRequired === true && item.canSendNow === false
    ));

    const normalizedManifest = await readFile(status.metricoolExecutionQueue.manifestPath, "utf8");
    const normalizedMarkdown = await readFile(status.metricoolExecutionQueue.markdownPath, "utf8");
    const normalizedCsv = await readFile(status.metricoolExecutionQueue.csvPath, "utf8");
    assert.doesNotMatch(normalizedManifest, /ready_to_send|"realPublishEnabled": true|auto_after_connection/);
    assert.doesNotMatch(normalizedMarkdown, /ready_to_send|Real publish enabled: yes|Publish mode: auto_after_connection/);
    assert.doesNotMatch(normalizedCsv, /ready_to_send/);
    assert.match(normalizedManifest, /"realPublishEnabled": false/);
    assert.match(normalizedMarkdown, /Real publish enabled: no/);
    assert.match(normalizedCsv, /queued_for_approval/);
  } finally {
    if (previousManifest === null) await unlink(beforeStatus.metricoolExecutionQueue.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.metricoolExecutionQueue.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.metricoolExecutionQueue.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.metricoolExecutionQueue.markdownPath, previousMarkdown);
    if (previousCsv === null) await unlink(beforeStatus.metricoolExecutionQueue.csvPath).catch(() => undefined);
    else await writeFile(beforeStatus.metricoolExecutionQueue.csvPath, previousCsv);
  }
});

test("go-live completion audit receives normalized Metricool approval-only queue", async () => {
  const beforeStatus = await getClipperStatus();
  const previousPublishingManifest = await readFile(beforeStatus.metricoolPublishing.manifestPath, "utf8").catch(() => null);
  const previousQueueManifest = await readFile(beforeStatus.metricoolExecutionQueue.manifestPath, "utf8").catch(() => null);
  const previousQueueMarkdown = await readFile(beforeStatus.metricoolExecutionQueue.markdownPath, "utf8").catch(() => null);
  const previousQueueCsv = await readFile(beforeStatus.metricoolExecutionQueue.csvPath, "utf8").catch(() => null);
  const previousToken = process.env.METRICOOL_USER_TOKEN;
  const previousUserId = process.env.METRICOOL_USER_ID;
  process.env.METRICOOL_USER_TOKEN = "token_live";
  process.env.METRICOOL_USER_ID = "12345";
  const fetchMock = mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
    data: [
      { id: 6431687, label: "SPORT", timezone: "America/New_York", networksData: { tiktok: { connected: true } } },
      { id: 6431685, label: "memes", timezone: "America/New_York", networksData: { tiktok: { connected: true } } },
    ],
  }), { status: 200, headers: { "content-type": "application/json" } }));

  try {
    await prepareClipperMetricoolPublishingPlan();
    await writeFile(beforeStatus.metricoolExecutionQueue.manifestPath, JSON.stringify({
      status: "approval_required",
      generatedAt: new Date().toISOString(),
      sourceAutomationRunId: "unsafe-direct-send-cache",
      publishMode: "auto_after_connection",
      realPublishEnabled: true,
      sourceReadiness: {
        status: "ready",
        categories: [
          { accountId: "sports-daily", accountName: "Sports Daily Clips", category: "sports", connectedNetworks: ["tiktok"], dailyClipTarget: 8, weeklyTargetClips: 56, minimumWeeklySourceAssets: 28, rightsReadyAssets: 42, missingSourceAssets: 0, sourceDropDir: "clippers_workspace/source-drop/sports", nextStep: "ready" },
          { accountId: "meme-radar", accountName: "Meme Radar", category: "memes", connectedNetworks: ["tiktok"], dailyClipTarget: 6, weeklyTargetClips: 42, minimumWeeklySourceAssets: 21, rightsReadyAssets: 35, missingSourceAssets: 0, sourceDropDir: "clippers_workspace/source-drop/memes", nextStep: "ready" },
        ],
        totals: { accounts: 2, connectedNetworks: 2, dailyClipTarget: 14, weeklyTargetClips: 98, minimumWeeklySourceAssets: 49, rightsReadyAssets: 77, missingSourceAssets: 0 },
        nextStep: "unsafe cache",
      },
      items: [{
        id: "unsafe-ready-item",
        postId: "post-1",
        queueItemId: "queue-1",
        accountId: "sports-daily",
        accountName: "Sports Daily",
        platform: "tiktok",
        status: "ready_to_send",
        approvalRequired: false,
        canSendNow: true,
        metricoolBrandName: "SPORT",
        metricoolBlogId: "6431687",
        publishAt: new Date().toISOString(),
        sourcePath: "/tmp/source.mp4",
        hook: "unsafe",
        captionSeed: "unsafe",
        requestSpec: { bridge: "metricool", endpoint: "unsafe", method: "auto", payloadFields: [], mediaSource: "/tmp/source.mp4" },
        gates: [],
        blockers: [],
        nextStep: "unsafe",
      }],
      totals: { items: 1, blocked: 0, queuedForApproval: 1, readyToSend: 1, approvalRequired: 0 },
      nextStep: "unsafe",
    }, null, 2));

    const status = await getClipperStatus();
    const bridgeRequirement = status.goLiveCompletionAudit.requirements.find((item) => item.id === "publishing-bridge-connected");
    const publisherRequirement = status.goLiveCompletionAudit.requirements.find((item) => item.id === "publisher-connectors-ready");
    assert.equal(status.metricoolExecutionQueue.realPublishEnabled, false);
    assert.equal(status.metricoolExecutionQueue.publishMode, "approval_required");
    assert.equal(status.metricoolExecutionQueue.totals.readyToSend, 0);
    assert.equal(status.metricoolExecutionQueue.totals.queuedForApproval, 1);
    assert.ok(status.metricoolExecutionQueue.items.every((item) =>
      item.status === "queued_for_approval" && item.approvalRequired === true && item.canSendNow === false
    ));
    assert.equal(bridgeRequirement?.status, "verified");
    assert.equal(publisherRequirement?.status, "verified");
    assert.equal(bridgeRequirement?.blockers.some((blocker) => blocker.includes("ready_to_send")), false);
    assert.equal(publisherRequirement?.blockers.some((blocker) => blocker.includes("ready_to_send")), false);
  } finally {
    fetchMock.mock.restore();
    if (previousToken === undefined) delete process.env.METRICOOL_USER_TOKEN;
    else process.env.METRICOOL_USER_TOKEN = previousToken;
    if (previousUserId === undefined) delete process.env.METRICOOL_USER_ID;
    else process.env.METRICOOL_USER_ID = previousUserId;
    if (previousPublishingManifest === null) await unlink(beforeStatus.metricoolPublishing.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.metricoolPublishing.manifestPath, previousPublishingManifest);
    if (previousQueueManifest === null) await unlink(beforeStatus.metricoolExecutionQueue.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.metricoolExecutionQueue.manifestPath, previousQueueManifest);
    if (previousQueueMarkdown === null) await unlink(beforeStatus.metricoolExecutionQueue.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.metricoolExecutionQueue.markdownPath, previousQueueMarkdown);
    if (previousQueueCsv === null) await unlink(beforeStatus.metricoolExecutionQueue.csvPath).catch(() => undefined);
    else await writeFile(beforeStatus.metricoolExecutionQueue.csvPath, previousQueueCsv);
  }
});

test("go-live completion audit blocks Metricool MVP when source lanes are not ready", async () => {
  const beforeStatus = await getClipperStatus();
  const previousQueueManifest = await readFile(beforeStatus.metricoolExecutionQueue.manifestPath, "utf8").catch(() => null);
  const previousQueueMarkdown = await readFile(beforeStatus.metricoolExecutionQueue.markdownPath, "utf8").catch(() => null);
  const previousQueueCsv = await readFile(beforeStatus.metricoolExecutionQueue.csvPath, "utf8").catch(() => null);

  try {
    await writeFile(beforeStatus.metricoolExecutionQueue.manifestPath, JSON.stringify({
      status: "approval_required",
      generatedAt: new Date().toISOString(),
      sourceAutomationRunId: "blocked-source-readiness-cache",
      publishMode: "approval_required",
      realPublishEnabled: false,
      sourceReadiness: {
        status: "blocked",
        categories: [
          { accountId: "sports-daily", accountName: "Sports Daily Clips", category: "sports", connectedNetworks: ["tiktok"], dailyClipTarget: 8, weeklyTargetClips: 56, minimumWeeklySourceAssets: 28, rightsReadyAssets: 42, missingSourceAssets: 0, sourceDropDir: "clippers_workspace/source-drop/sports", nextStep: "ready" },
        ],
        totals: { accounts: 1, connectedNetworks: 1, dailyClipTarget: 8, weeklyTargetClips: 56, minimumWeeklySourceAssets: 28, rightsReadyAssets: 42, missingSourceAssets: 7 },
        nextStep: "Add memes source assets before claiming Metricool MVP.",
      },
      items: [{
        id: "approval-only-but-source-blocked",
        postId: "post-1",
        queueItemId: "queue-1",
        accountId: "sports-daily",
        accountName: "Sports Daily",
        platform: "tiktok",
        status: "queued_for_approval",
        approvalRequired: true,
        canSendNow: false,
        metricoolBrandName: "SPORT",
        metricoolBlogId: "6431687",
        publishAt: new Date().toISOString(),
        sourcePath: "/tmp/source.mp4",
        hook: "safe",
        captionSeed: "safe",
        requestSpec: { bridge: "metricool", endpoint: "approval", method: "approval_required", payloadFields: [], mediaSource: "/tmp/source.mp4" },
        gates: [],
        blockers: [],
        nextStep: "review first",
      }],
      totals: { items: 1, blocked: 0, queuedForApproval: 1, readyToSend: 0, approvalRequired: 1 },
      nextStep: "Queue exists but source readiness is blocked.",
    }, null, 2));

    const status = await getClipperStatus();
    assert.equal(status.goLiveCompletionAudit.launchModes?.metricoolMvpReady, false);
    assert.equal(status.goLiveCompletionAudit.launchModes?.approvalQueueReady, false);
    assert.ok(status.goLiveCompletionAudit.launchModes?.metricoolMvpBlockers.some((blocker) =>
      blocker.includes("source readiness") || blocker.includes("Fewer than two Metricool MVP lanes")
    ));
  } finally {
    if (previousQueueManifest === null) await unlink(beforeStatus.metricoolExecutionQueue.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.metricoolExecutionQueue.manifestPath, previousQueueManifest);
    if (previousQueueMarkdown === null) await unlink(beforeStatus.metricoolExecutionQueue.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.metricoolExecutionQueue.markdownPath, previousQueueMarkdown);
    if (previousQueueCsv === null) await unlink(beforeStatus.metricoolExecutionQueue.csvPath).catch(() => undefined);
    else await writeFile(beforeStatus.metricoolExecutionQueue.csvPath, previousQueueCsv);
  }
});

test("getClipperStatus rewrites Metricool publishMode-only stale artifacts", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.metricoolExecutionQueue.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.metricoolExecutionQueue.markdownPath, "utf8").catch(() => null);
  const previousCsv = await readFile(beforeStatus.metricoolExecutionQueue.csvPath, "utf8").catch(() => null);

  try {
    await writeFile(beforeStatus.metricoolExecutionQueue.manifestPath, JSON.stringify({
      status: "approval_required",
      generatedAt: new Date().toISOString(),
      sourceAutomationRunId: "publish-mode-only-stale-cache",
      publishMode: "auto_after_connection",
      realPublishEnabled: false,
      sourceReadiness: {
        status: "ready",
        categories: [],
        totals: { accounts: 0, connectedNetworks: 0, dailyClipTarget: 0, weeklyTargetClips: 0, minimumWeeklySourceAssets: 0, rightsReadyAssets: 0, missingSourceAssets: 0 },
        nextStep: "safe except publish mode",
      },
      items: [{
        id: "publish-mode-only-item",
        postId: "post-1",
        queueItemId: "queue-1",
        accountId: "sports-daily",
        accountName: "Sports Daily",
        platform: "tiktok",
        status: "queued_for_approval",
        approvalRequired: true,
        canSendNow: false,
        metricoolBrandName: "SPORT",
        metricoolBlogId: "6431687",
        publishAt: new Date().toISOString(),
        sourcePath: "/tmp/source.mp4",
        hook: "safe",
        captionSeed: "safe",
        requestSpec: { bridge: "metricool", endpoint: "approval", method: "approval_required", payloadFields: [], mediaSource: "/tmp/source.mp4" },
        gates: [],
        blockers: [],
        nextStep: "review first",
      }],
      totals: { items: 1, blocked: 0, queuedForApproval: 1, readyToSend: 0, approvalRequired: 1 },
      nextStep: "safe except publish mode",
    }, null, 2));

    const status = await getClipperStatus();
    assert.equal(status.metricoolExecutionQueue.status, "approval_required");
    assert.equal(status.metricoolExecutionQueue.publishMode, "approval_required");
    assert.equal(status.metricoolExecutionQueue.realPublishEnabled, false);
    assert.equal(status.metricoolExecutionQueue.totals.readyToSend, 0);
    assert.equal(status.metricoolExecutionQueue.totals.queuedForApproval, 1);

    const normalizedManifest = await readFile(status.metricoolExecutionQueue.manifestPath, "utf8");
    const normalizedMarkdown = await readFile(status.metricoolExecutionQueue.markdownPath, "utf8");
    assert.doesNotMatch(normalizedManifest, /auto_after_connection/);
    assert.doesNotMatch(normalizedMarkdown, /Publish mode: auto_after_connection/);
    assert.match(normalizedMarkdown, /Publish mode: approval_required/);
  } finally {
    if (previousManifest === null) await unlink(beforeStatus.metricoolExecutionQueue.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.metricoolExecutionQueue.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.metricoolExecutionQueue.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.metricoolExecutionQueue.markdownPath, previousMarkdown);
    if (previousCsv === null) await unlink(beforeStatus.metricoolExecutionQueue.csvPath).catch(() => undefined);
    else await writeFile(beforeStatus.metricoolExecutionQueue.csvPath, previousCsv);
  }
});

test("recordClipperMetricoolAccountEvidence records Metricool bridge evidence without verifying accounts", async () => {
  const beforeStatus = await getClipperStatus();
  const sportsPath = path.join(beforeStatus.accountEvidence.evidenceDir, "sports-daily-tiktok.json");
  const memesPath = path.join(beforeStatus.accountEvidence.evidenceDir, "meme-radar-tiktok.json");
  const previousSports = await readFile(sportsPath, "utf8").catch(() => null);
  const previousMemes = await readFile(memesPath, "utf8").catch(() => null);
  const previousOwnerProgress = await readFile(beforeStatus.ownerConnectPack.progressRecordsPath, "utf8").catch(() => null);
  const previousQueueManifest = await readFile(beforeStatus.metricoolExecutionQueue.manifestPath, "utf8").catch(() => null);
  const cachePath = path.join(process.cwd(), "marketing_command_center_data", "metricool-brands.json");
  const previousCache = await readFile(cachePath, "utf8").catch(() => null);
  const previousToken = process.env.METRICOOL_USER_TOKEN;
  const previousUserId = process.env.METRICOOL_USER_ID;
  process.env.METRICOOL_USER_TOKEN = "token_live";
  process.env.METRICOOL_USER_ID = "12345";
  const fetchMock = mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
    data: [
      { id: 6431687, label: "SPORT", timezone: "America/New_York", networksData: { tiktok: { connected: true } } },
      { id: 6431685, label: "memes", timezone: "America/New_York", networksData: { tiktok: { connected: true } } },
    ],
  }), { status: 200, headers: { "content-type": "application/json" } }));

  try {
    await writeFile(beforeStatus.metricoolExecutionQueue.manifestPath, JSON.stringify({
      status: "not_prepared",
      generatedAt: null,
      sourceAutomationRunId: null,
      publishMode: "approval_required",
      realPublishEnabled: false,
      sourceReadiness: {
        status: "blocked",
        categories: [],
        totals: { accounts: 0, connectedNetworks: 0, dailyClipTarget: 0, weeklyTargetClips: 0, minimumWeeklySourceAssets: 0, rightsReadyAssets: 0, missingSourceAssets: 0 },
        nextStep: "Prepare Metricool execution queue.",
      },
      items: [],
      totals: { items: 0, blocked: 0, queuedForApproval: 0, readyToSend: 0, approvalRequired: 0 },
      nextStep: "Prepare Metricool execution queue.",
    }, null, 2));
    const { metricoolAccountEvidence, status } = await recordClipperMetricoolAccountEvidence();
    assert.equal(metricoolAccountEvidence.recorded.length, 2);
    assert.ok(metricoolAccountEvidence.recorded.some((item) => item.accountId === "sports-daily" && item.platform === "tiktok"));
    assert.ok(metricoolAccountEvidence.recorded.some((item) => item.accountId === "meme-radar" && item.platform === "tiktok"));
    assert.ok(status.accountEvidence.items.some((item) => item.id === "sports-daily-tiktok" && item.status === "submitted"));
    assert.ok(status.accountEvidence.items.some((item) => item.id === "meme-radar-tiktok" && item.status === "submitted"));
    assert.ok(status.commandCenter.steps.some((step) => step.id === "metricool-publishing-bridge" && step.actionUrl === "/api/clippers/prepare-metricool-publishing-plan"));
    assert.ok(status.commandCenter.steps.some((step) =>
      step.id === "credential-setup"
      && step.status === "done"
      && step.label.includes("opcionales")
      && step.nextStep.includes("No necesitas TikTok/Meta/YouTube API keys")
    ));
    assert.ok(status.commandCenter.steps.some((step) =>
      step.id === "oauth-token-vault"
      && step.status === "done"
      && step.label.includes("opcional")
      && step.evidence.includes("direct platform API keys optional")
    ));
    assert.ok(status.commandCenter.steps.some((step) =>
      step.id === "permission-approvals"
      && step.status === "done"
      && step.label.includes("opcionales")
      && step.nextStep.includes("publicar por Metricool")
    ));
    assert.ok(status.commandCenter.steps.some((step) =>
      step.id === "drive-workspace"
      && step.status !== "blocked"
      && step.label.includes("opcional")
      && step.nextStep.includes("source-drop local")
    ));
    assert.ok(status.goLiveCompletionAudit.requirements.some((item) =>
      item.id === "publishing-bridge-connected"
      && item.status === "needs_evidence"
      && item.currentEvidence.includes("Metricool bridge=ready_for_approval_queue")
      && item.blockers.some((blocker) => blocker.includes("no queued_for_approval"))
    ));
    assert.ok(status.goLiveCompletionAudit.requirements.some((item) =>
      item.id === "publisher-connectors-ready"
      && item.status === "needs_evidence"
      && item.currentEvidence.includes("Metricool bridge=ready_for_approval_queue")
      && item.blockers.some((blocker) => blocker.includes("no queued_for_approval"))
    ));

    const rawSports = await readFile(sportsPath, "utf8");
    const rawMemes = await readFile(memesPath, "utf8");
    assert.match(rawSports, /Metricool live sync detected tiktok bridge connection/);
    assert.match(rawSports, /does not verify the external social account/);
    assert.match(rawMemes, /https:\/\/www\.tiktok\.com\/@memeradar/);
    assert.doesNotMatch(rawSports, /token_live|METRICOOL_USER_TOKEN=/);
    assert.equal(fetchMock.mock.callCount(), 1);
  } finally {
    fetchMock.mock.restore();
    if (previousToken === undefined) delete process.env.METRICOOL_USER_TOKEN;
    else process.env.METRICOOL_USER_TOKEN = previousToken;
    if (previousUserId === undefined) delete process.env.METRICOOL_USER_ID;
    else process.env.METRICOOL_USER_ID = previousUserId;
    if (previousSports === null) await unlink(sportsPath).catch(() => undefined);
    else await writeFile(sportsPath, previousSports);
    if (previousMemes === null) await unlink(memesPath).catch(() => undefined);
    else await writeFile(memesPath, previousMemes);
    if (previousOwnerProgress === null) await unlink(beforeStatus.ownerConnectPack.progressRecordsPath).catch(() => undefined);
    else await writeFile(beforeStatus.ownerConnectPack.progressRecordsPath, previousOwnerProgress);
    if (previousQueueManifest === null) await unlink(beforeStatus.metricoolExecutionQueue.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.metricoolExecutionQueue.manifestPath, previousQueueManifest);
    if (previousCache === null) await unlink(cachePath).catch(() => undefined);
    else await writeFile(cachePath, previousCache);
  }
});

test("prepareClipperPublisherExecutionQueue writes guarded publish ledger without secrets", async () => {
  await runClipperAutomationCycle({ publishMode: "approval_required", riskTolerance: "growth" }, "publisher-exec-test");
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.publisherExecutionQueue.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.publisherExecutionQueue.markdownPath, "utf8").catch(() => null);
  const previousCsv = await readFile(beforeStatus.publisherExecutionQueue.csvPath, "utf8").catch(() => null);

  try {
    const { publisherExecutionQueue, status } = await prepareClipperPublisherExecutionQueue();

    assert.ok(publisherExecutionQueue.manifestPath.endsWith("publisher-execution-queue.json"));
    assert.ok(publisherExecutionQueue.markdownPath.endsWith("publisher-execution-queue.md"));
    assert.ok(publisherExecutionQueue.csvPath.endsWith("publisher-execution-queue.csv"));
    assert.equal(publisherExecutionQueue.publishMode, "approval_required");
    assert.equal(publisherExecutionQueue.realPublishEnabled, false);
    assert.equal(publisherExecutionQueue.totals.items, status.automation.lastRun?.totals.posts);
    assert.ok(publisherExecutionQueue.totals.blocked > 0);
    assert.ok(publisherExecutionQueue.items.every((item) => item.approvalRequired));
    assert.ok(publisherExecutionQueue.items.every((item) => item.requestSpec.tokenSource === "encrypted_vault" || item.requestSpec.tokenSource === "missing"));
    assert.equal(status.publisherExecutionQueue.items.length, publisherExecutionQueue.items.length);
    assert.ok(status.commandCenter.steps.some((step) => step.id === "publisher-execution-queue" && step.actionUrl === "/api/clippers/prepare-publisher-execution-queue"));

    const rawManifest = await readFile(publisherExecutionQueue.manifestPath, "utf8");
    const rawMarkdown = await readFile(publisherExecutionQueue.markdownPath, "utf8");
    const rawCsv = await readFile(publisherExecutionQueue.csvPath, "utf8");
    assert.ok(rawMarkdown.includes("Clippers Publisher Execution Queue"));
    assert.ok(rawCsv.includes("token_source"));
    assert.equal(rawManifest.includes("plain-access-token"), false);
    assert.equal(rawManifest.includes("refresh_token"), false);
    assert.equal(rawMarkdown.includes("client_secret"), false);
  } finally {
    if (previousManifest === null) await unlink(beforeStatus.publisherExecutionQueue.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.publisherExecutionQueue.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.publisherExecutionQueue.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.publisherExecutionQueue.markdownPath, previousMarkdown);
    if (previousCsv === null) await unlink(beforeStatus.publisherExecutionQueue.csvPath).catch(() => undefined);
    else await writeFile(beforeStatus.publisherExecutionQueue.csvPath, previousCsv);
  }
});

test("cached publisher execution queue is normalized back to approval required", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.publisherExecutionQueue.manifestPath, "utf8").catch(() => null);
  const staleQueue = {
    status: "ready",
    generatedAt: new Date().toISOString(),
    manifestPath: beforeStatus.publisherExecutionQueue.manifestPath,
    markdownPath: beforeStatus.publisherExecutionQueue.markdownPath,
    csvPath: beforeStatus.publisherExecutionQueue.csvPath,
    sourceAutomationRunId: "stale-cache-test",
    publishMode: "auto_after_connection",
    realPublishEnabled: true,
    items: [{
      id: "stale-item",
      postId: "post-1",
      queueItemId: "queue-1",
      accountId: "sports-daily",
      accountName: "Sports Daily Clips",
      platform: "tiktok",
      status: "ready_to_send",
      approvalRequired: false,
      canSendNow: true,
      publishAt: new Date().toISOString(),
      endpoint: "/api/clippers/publish/tiktok",
      method: "POST",
      mode: "direct_api",
      sourcePath: "/tmp/fake.mp4",
      hook: "stale",
      captionSeed: "stale",
      requestSpec: {
        headers: ["Authorization: Bearer <encrypted_vault_token>"],
        payloadFields: ["video"],
        mediaSource: "local_source_file",
        tokenSource: "encrypted_vault",
      },
      gates: [],
      blockers: [],
      nextStep: "stale send",
    }],
    totals: { items: 1, blocked: 0, queuedForApproval: 0, readyToSend: 1, approvalRequired: 0 },
    nextStep: "stale ready",
  };

  try {
    await writeFile(beforeStatus.publisherExecutionQueue.manifestPath, JSON.stringify(staleQueue, null, 2));
    const status = await getClipperStatus();
    assert.equal(status.publisherExecutionQueue.status, "approval_required");
    assert.equal(status.publisherExecutionQueue.publishMode, "approval_required");
    assert.equal(status.publisherExecutionQueue.realPublishEnabled, false);
    assert.equal(status.publisherExecutionQueue.totals.readyToSend, 0);
    assert.equal(status.publisherExecutionQueue.totals.queuedForApproval, 1);
    assert.equal(status.publisherExecutionQueue.items[0].status, "queued_for_approval");
    assert.equal(status.publisherExecutionQueue.items[0].approvalRequired, true);
    assert.equal(status.publisherExecutionQueue.items[0].canSendNow, false);
  } finally {
    if (previousManifest === null) await unlink(beforeStatus.publisherExecutionQueue.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.publisherExecutionQueue.manifestPath, previousManifest);
  }
});

test("prepareClipperProductionUrlSetup writes redirect URI setup and blocks localhost go-live", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.productionUrlSetup.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.productionUrlSetup.markdownPath, "utf8").catch(() => null);
  const previousPublicBaseUrl = process.env.PUBLIC_BASE_URL;

  try {
    process.env.PUBLIC_BASE_URL = "http://127.0.0.1:5013";
    const { productionUrlSetup, status } = await prepareClipperProductionUrlSetup();
    assert.equal(productionUrlSetup.platforms.length, 3);
    assert.equal(productionUrlSetup.requiredEnvVar, "PUBLIC_BASE_URL");
    assert.equal(productionUrlSetup.requiredProtocol, "https");
    assert.equal(productionUrlSetup.productionUrlReady, false);
    assert.ok(productionUrlSetup.setupSession.length >= 5);
    assert.ok(productionUrlSetup.setupSession.every((item) => item.copyValue.length > 0 && item.doneCriteria.length > 0));
    assert.ok(productionUrlSetup.setupSession.every((item) => item.clipboardValues.length > 0 && item.verificationUrls.length > 0));
    assert.ok(productionUrlSetup.setupSession.every((item) => item.evidenceRecipeRow.includes("developer_app")));
    assert.ok(productionUrlSetup.saveChecklist.length >= 5);
    assert.ok(productionUrlSetup.endpointChecks.length >= 7);
    assert.ok(productionUrlSetup.setupSession.some((item) => item.id === "record-public-base-url" && item.copyValue.includes("PUBLIC_BASE_URL")));
    assert.ok(productionUrlSetup.blockers.some((blocker) => blocker.includes("PUBLIC_BASE_URL")));
    assert.ok(productionUrlSetup.platforms.every((platform) => platform.redirectUri.includes(`/api/clippers/oauth/${platform.platform}/callback`)));
    assert.ok(productionUrlSetup.platforms.every((platform) => platform.publicRedirectUri.includes(`/api/clippers/oauth/${platform.platform}/callback`)));
    assert.ok(productionUrlSetup.endpointChecks.filter((check) => check.id.endsWith("-callback")).every((check) => check.url.includes("preflight=1")));
    assert.ok(productionUrlSetup.platforms.every((platform) => platform.publicDemoUrl.includes("/clippers/review-demo")));
    assert.ok(productionUrlSetup.platforms.every((platform) => platform.publicLegalUrls.length === 2));
    assert.ok(productionUrlSetup.platforms.every((platform) => platform.evidenceRecipeRow.includes("<redirect URI + public URL evidence")));
    assert.ok(status.commandCenter.steps.some((step) => step.id === "production-url-setup" && step.actionUrl === "/api/clippers/prepare-production-url-setup"));

    const rawManifest = await readFile(productionUrlSetup.manifestPath, "utf8");
    const rawMarkdown = await readFile(productionUrlSetup.markdownPath, "utf8");
    assert.ok(rawMarkdown.includes("Clippers Production URL Setup"));
    assert.ok(rawMarkdown.includes("Production URL ready: no"));
    assert.ok(rawMarkdown.includes("Setup Session"));
    assert.ok(rawMarkdown.includes("Endpoint Checks"));
    assert.ok(rawMarkdown.includes("Save Checklist"));
    assert.ok(rawMarkdown.includes("Public redirect URI"));
    assert.ok(rawMarkdown.includes("Done criteria"));
    assert.ok(rawManifest.includes("PUBLIC_BASE_URL"));
    assert.ok(rawManifest.includes("setupSession"));
    assert.ok(rawManifest.includes("endpointChecks"));
    assert.equal(rawManifest.includes("client_secret"), false);
  } finally {
    if (previousPublicBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = previousPublicBaseUrl;
    if (previousManifest === null) await unlink(beforeStatus.productionUrlSetup.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.productionUrlSetup.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.productionUrlSetup.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.productionUrlSetup.markdownPath, previousMarkdown);
  }
});

test("verifyClipperProductionUrl writes endpoint evidence without secrets", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.productionUrlVerification.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.productionUrlVerification.markdownPath, "utf8").catch(() => null);
  const previousPublicBaseUrl = process.env.PUBLIC_BASE_URL;
  const originalFetch = globalThis.fetch;
  const lookupMock = mock.method(dns, "lookup", async () => [{ address: "203.0.113.10", family: 4 }]);

  try {
    process.env.PUBLIC_BASE_URL = "https://app.clipprreview.com";
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/api/clippers/oauth/")) {
        assert.ok(url.includes("preflight=1"));
        return new Response("", { status: 200 });
      }
      return new Response("<html>ok</html>", { status: 200 });
    }) as typeof fetch;

    const { productionUrlVerification, status } = await verifyClipperProductionUrl();
    assert.equal(productionUrlVerification.status, "pass");
    assert.equal(productionUrlVerification.publicBaseUrl, "https://app.clipprreview.com");
    assert.equal(productionUrlVerification.totals.endpoints, status.productionUrlSetup.endpointChecks.length);
    assert.equal(productionUrlVerification.totals.fail, 0);
    assert.equal(productionUrlVerification.totals.pass, productionUrlVerification.totals.endpoints);
    assert.equal(productionUrlVerification.dnsDiagnostic.status, "resolved");
    assert.equal(productionUrlVerification.dnsDiagnostic.rootDomain, "clipprreview.com");
    assert.equal(productionUrlVerification.dnsDiagnostic.isApexDomain, false);
    assert.deepEqual(productionUrlVerification.dnsDiagnostic.addresses, ["203.0.113.10"]);
    assert.ok(productionUrlVerification.dnsDiagnostic.suggestedRecords.some((record) => record.includes("app.clipprreview.com")));
    assert.ok(productionUrlVerification.dnsDiagnostic.recordCandidates.some((record) => record.id === "cloudflare-tunnel-cname" && record.copyLine.includes("CNAME")));
    assert.ok(productionUrlVerification.dnsDiagnostic.providerRecipes.some((recipe) => recipe.provider === "Cloudflare" && recipe.bestRecordId === "cloudflare-tunnel-cname"));
    assert.ok(productionUrlVerification.dnsDiagnostic.repairRunbook.some((step) => step.includes("Pick one DNS route")));
    assert.ok(productionUrlVerification.dnsDiagnostic.appReviewHoldChecklist.some((step) => step.includes("TikTok")));
    assert.ok(productionUrlVerification.dnsDiagnostic.propagationChecks.some((command) => command.includes("curl -I https://app.clipprreview.com/clippers")));
    assert.ok(productionUrlVerification.dnsDiagnostic.registrarChecklist.length >= 4);
    assert.ok(productionUrlVerification.dnsDiagnostic.blockedUntilResolved.some((action) => action.includes("app review")));
    assert.ok(productionUrlVerification.items.some((item) => item.id === "review-demo" && item.statusCode === 200));
    assert.ok(productionUrlVerification.items.some((item) => item.id === "tiktok-callback" && item.url.includes("preflight=1") && item.statusCode === 200 && item.status === "pass"));
    assert.ok(status.commandCenter.steps.some((step) => step.id === "production-url-verification" && step.actionUrl === "/api/clippers/verify-production-url"));

    const rawManifest = await readFile(productionUrlVerification.manifestPath, "utf8");
    const rawMarkdown = await readFile(productionUrlVerification.markdownPath, "utf8");
    assert.ok(rawMarkdown.includes("Clippers Production URL Verification"));
    assert.ok(rawMarkdown.includes("DNS Diagnostic"));
    assert.ok(rawMarkdown.includes("DNS repair runbook"));
    assert.ok(rawMarkdown.includes("Provider recipes"));
    assert.ok(rawMarkdown.includes("App review hold checklist"));
    assert.ok(rawMarkdown.includes("Record candidates"));
    assert.ok(rawMarkdown.includes("Propagation checks"));
    assert.ok(rawMarkdown.includes("Blocked until DNS resolves"));
    assert.ok(rawMarkdown.includes("Endpoint Evidence"));
    assert.ok(rawManifest.includes("dnsDiagnostic"));
    assert.ok(rawManifest.includes("recordCandidates"));
    assert.ok(rawManifest.includes("providerRecipes"));
    assert.ok(rawManifest.includes("repairRunbook"));
    assert.ok(rawManifest.includes("appReviewHoldChecklist"));
    assert.ok(rawManifest.includes("responseMs"));
    assert.equal(rawManifest.includes("access_token"), false);
    assert.equal(rawMarkdown.includes("client_secret"), false);
  } finally {
    lookupMock.mock.restore();
    globalThis.fetch = originalFetch;
    if (previousPublicBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = previousPublicBaseUrl;
    if (previousManifest === null) await unlink(beforeStatus.productionUrlVerification.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.productionUrlVerification.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.productionUrlVerification.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.productionUrlVerification.markdownPath, previousMarkdown);
  }
});

test("verifyClipperProductionUrl times out stuck DNS lookups", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.productionUrlVerification.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.productionUrlVerification.markdownPath, "utf8").catch(() => null);
  const previousPublicBaseUrl = process.env.PUBLIC_BASE_URL;
  const previousDnsTimeout = process.env.CLIPPERS_PRODUCTION_DNS_TIMEOUT_MS;
  const originalFetch = globalThis.fetch;
  const lookupMock = mock.method(dns, "lookup", async () => new Promise(() => undefined));

  try {
    process.env.PUBLIC_BASE_URL = "https://app.clipprreview.com";
    process.env.CLIPPERS_PRODUCTION_DNS_TIMEOUT_MS = "20";
    globalThis.fetch = (async () => {
      throw new Error("DNS unavailable");
    }) as typeof fetch;

    const startedAt = Date.now();
    const { productionUrlVerification } = await verifyClipperProductionUrl();

    assert.ok(Date.now() - startedAt < 2_000);
    assert.equal(productionUrlVerification.dnsDiagnostic.status, "unresolved");
    assert.ok(productionUrlVerification.dnsDiagnostic.error?.includes("DNS lookup timed out after 20ms"));
    assert.equal(productionUrlVerification.status, "fail");
    assert.equal(productionUrlVerification.totals.fail, productionUrlVerification.totals.endpoints);
    assert.ok(productionUrlVerification.nextStep.includes("Add or fix DNS records"));
    const { productionUrlSetup } = await prepareClipperProductionUrlSetup();
    assert.equal(productionUrlSetup.status, "partial");
    assert.ok(productionUrlSetup.nextStep.includes("Production URL Verification"));
    assert.ok(productionUrlSetup.setupSession
      .filter((item) => item.id.startsWith("register-"))
      .every((item) => item.status === "blocked" && item.nextStep.includes("fix DNS/endpoints")));

    const rawManifest = await readFile(productionUrlVerification.manifestPath, "utf8");
    const rawMarkdown = await readFile(productionUrlVerification.markdownPath, "utf8");
    assert.ok(rawManifest.includes("DNS lookup timed out"));
    assert.ok(rawMarkdown.includes("DNS lookup timed out"));
    assert.equal(rawManifest.includes("access_token"), false);
    assert.equal(rawMarkdown.includes("client_secret"), false);
  } finally {
    lookupMock.mock.restore();
    globalThis.fetch = originalFetch;
    if (previousPublicBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = previousPublicBaseUrl;
    if (previousDnsTimeout === undefined) delete process.env.CLIPPERS_PRODUCTION_DNS_TIMEOUT_MS;
    else process.env.CLIPPERS_PRODUCTION_DNS_TIMEOUT_MS = previousDnsTimeout;
    if (previousManifest === null) await unlink(beforeStatus.productionUrlVerification.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.productionUrlVerification.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.productionUrlVerification.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.productionUrlVerification.markdownPath, previousMarkdown);
  }
});

test("prepareClipperProductionUrlSetup blocks stale production URL verification", async () => {
  const beforeStatus = await getClipperStatus();
  const previousSetupManifest = await readFile(beforeStatus.productionUrlSetup.manifestPath, "utf8").catch(() => null);
  const previousSetupMarkdown = await readFile(beforeStatus.productionUrlSetup.markdownPath, "utf8").catch(() => null);
  const previousVerificationManifest = await readFile(beforeStatus.productionUrlVerification.manifestPath, "utf8").catch(() => null);
  const previousPublicBaseUrl = process.env.PUBLIC_BASE_URL;

  try {
    process.env.PUBLIC_BASE_URL = "https://app.clipprreview.com";
    await writeFile(beforeStatus.productionUrlVerification.manifestPath, JSON.stringify({
      status: "pass",
      generatedAt: "2020-01-01T00:00:00.000Z",
      publicBaseUrl: "https://app.clipprreview.com",
      productionUrlReady: true,
      dnsDiagnostic: { status: "resolved" },
      items: [],
      totals: { endpoints: 7, pass: 7, fail: 0, skipped: 0 },
      nextStep: "Public URL endpoints verified.",
    }, null, 2));

    const { productionUrlSetup } = await prepareClipperProductionUrlSetup();

    assert.equal(productionUrlSetup.status, "partial");
    assert.ok(productionUrlSetup.blockers.some((blocker) => blocker.includes("stale")));
    assert.ok(productionUrlSetup.nextStep.includes("Production URL Verification"));
    assert.ok(productionUrlSetup.setupSession
      .filter((item) => item.id.startsWith("register-"))
      .every((item) => item.status === "blocked"));
  } finally {
    if (previousPublicBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = previousPublicBaseUrl;
    if (previousSetupManifest === null) await unlink(beforeStatus.productionUrlSetup.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.productionUrlSetup.manifestPath, previousSetupManifest);
    if (previousSetupMarkdown === null) await unlink(beforeStatus.productionUrlSetup.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.productionUrlSetup.markdownPath, previousSetupMarkdown);
    if (previousVerificationManifest === null) await unlink(beforeStatus.productionUrlVerification.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.productionUrlVerification.manifestPath, previousVerificationManifest);
  }
});

test("prepareClipperProductionUrlSetup treats quick tunnels as temporary", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.productionUrlSetup.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.productionUrlSetup.markdownPath, "utf8").catch(() => null);
  const previousAppBaseUrl = process.env.APP_BASE_URL;
  const previousPublicBaseUrl = process.env.PUBLIC_BASE_URL;
  const previousIgnoreStoredPublicBaseUrl = process.env.CLIPPERS_IGNORE_STORED_PUBLIC_BASE_URL;

  try {
    delete process.env.APP_BASE_URL;
    process.env.PUBLIC_BASE_URL = "https://demo.trycloudflare.com";
    process.env.CLIPPERS_IGNORE_STORED_PUBLIC_BASE_URL = "true";
    const { productionUrlSetup } = await prepareClipperProductionUrlSetup();

    assert.equal(productionUrlSetup.productionUrlReady, true);
    assert.equal(productionUrlSetup.productionUrlStable, false);
    assert.equal(productionUrlSetup.productionUrlStability, "temporary_tunnel");
    assert.equal(productionUrlSetup.status, "partial");
    assert.ok(productionUrlSetup.blockers.some((blocker) => blocker.includes("tunel temporal")));
    assert.ok(productionUrlSetup.nextStep.includes("estable"));

    const rawMarkdown = await readFile(productionUrlSetup.markdownPath, "utf8");
    assert.ok(rawMarkdown.includes("Production URL stable: no (temporary_tunnel)"));
  } finally {
    if (previousAppBaseUrl === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = previousAppBaseUrl;
    if (previousPublicBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = previousPublicBaseUrl;
    if (previousIgnoreStoredPublicBaseUrl === undefined) delete process.env.CLIPPERS_IGNORE_STORED_PUBLIC_BASE_URL;
    else process.env.CLIPPERS_IGNORE_STORED_PUBLIC_BASE_URL = previousIgnoreStoredPublicBaseUrl;
    if (previousManifest === null) await unlink(beforeStatus.productionUrlSetup.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.productionUrlSetup.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.productionUrlSetup.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.productionUrlSetup.markdownPath, previousMarkdown);
  }
});

test("verifyClipperProductionLocalPreflight checks local app routes before tunneling", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.productionLocalPreflight.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.productionLocalPreflight.markdownPath, "utf8").catch(() => null);
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/api/clippers/oauth/")) {
        assert.ok(url.includes("preflight=1"));
        return new Response("", { status: 200 });
      }
      return new Response("<html>ok</html>", { status: 200 });
    }) as typeof fetch;

    const { productionLocalPreflight, status } = await verifyClipperProductionLocalPreflight();
    assert.equal(productionLocalPreflight.status, "pass");
    assert.equal(productionLocalPreflight.totals.pass, productionLocalPreflight.totals.endpoints);
    assert.equal(productionLocalPreflight.totals.fail, 0);
    assert.ok(productionLocalPreflight.localBaseUrl.includes("127.0.0.1"));
    assert.ok(productionLocalPreflight.publicUrlHandoff.publicBaseUrlTemplate.startsWith("PUBLIC_BASE_URL=https://"));
    assert.ok(productionLocalPreflight.publicUrlHandoff.registerAfterSave.length >= 3);
    assert.equal(status.productionLocalPreflight.status, "pass");
    assert.ok(status.productionLocalPreflight.items.some((item) => item.id === "review-demo" && item.status === "pass"));
    assert.ok(status.productionLocalPreflight.items.some((item) => item.id === "tiktok-callback" && item.url.includes("preflight=1") && item.statusCode === 200 && item.status === "pass"));

    const rawManifest = await readFile(productionLocalPreflight.manifestPath, "utf8");
    const rawMarkdown = await readFile(productionLocalPreflight.markdownPath, "utf8");
    assert.ok(rawMarkdown.includes("Clippers Local Production Preflight"));
    assert.ok(rawMarkdown.includes("Public URL Handoff"));
    assert.ok(rawMarkdown.includes("Local Endpoint Evidence"));
    assert.ok(rawManifest.includes("publicUrlHandoff"));
    assert.equal(rawManifest.includes("access_token"), false);
    assert.equal(rawMarkdown.includes("client_secret"), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousManifest === null) await unlink(beforeStatus.productionLocalPreflight.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.productionLocalPreflight.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.productionLocalPreflight.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.productionLocalPreflight.markdownPath, previousMarkdown);
  }
});

test("prepareClipperHttpsTunnelPlan writes public URL options and command center step", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.httpsTunnelPlan.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.httpsTunnelPlan.markdownPath, "utf8").catch(() => null);

  try {
    const { httpsTunnelPlan, status } = await prepareClipperHttpsTunnelPlan();
    assert.equal(httpsTunnelPlan.options.length >= 4, true);
    assert.equal(httpsTunnelPlan.recommendedOptionId, "cloudflare-tunnel");
    assert.equal(httpsTunnelPlan.localPort, process.env.PORT || "5010");
    assert.equal(httpsTunnelPlan.localOrigin, `http://127.0.0.1:${process.env.PORT || "5010"}`);
    assert.equal(httpsTunnelPlan.executionSession.length, httpsTunnelPlan.options.length);
    assert.ok(httpsTunnelPlan.executionSession.every((item) => item.commandSequence.length > 0 && item.doneCriteria.length >= 4));
    assert.ok(httpsTunnelPlan.executionSession.every((item) => item.publicBaseUrlTemplate.startsWith("PUBLIC_BASE_URL=https://")));
    assert.ok(httpsTunnelPlan.executionSession.every((item) => item.savePublicBaseUrlSteps.length >= 4));
    assert.ok(httpsTunnelPlan.executionSession.every((item) => item.endpointChecks.length >= 4));
    assert.ok(httpsTunnelPlan.executionSession.every((item) => item.evidenceToCapture.length >= 4));
    assert.ok(httpsTunnelPlan.executionSession.every((item) => item.registerAfterSave.length === 3));
    assert.ok(httpsTunnelPlan.executionSession.every((item) => item.stabilityChecklist.length >= 4));
    assert.ok(httpsTunnelPlan.executionSession.some((item) => item.optionId === "cloudflare-tunnel" && item.recommended));
    assert.ok(httpsTunnelPlan.options.some((option) => option.id === "cloudflare-tunnel" && option.localCommands.some((command) => command.includes("cloudflared"))));
    assert.ok(httpsTunnelPlan.options.every((option) => option.localCommands.every((command) => !command.includes("5013"))));
    assert.ok(httpsTunnelPlan.options.some((option) => option.id === "ngrok-reserved-domain" && option.portalUrl.includes("ngrok")));
    assert.ok(status.commandCenter.steps.some((step) => step.id === "https-tunnel-plan" && step.actionUrl === "/api/clippers/prepare-https-tunnel-plan"));
    assert.ok(status.growthAudit.items.some((item) => item.id === "https-tunnel-plan"));

    const rawManifest = await readFile(httpsTunnelPlan.manifestPath, "utf8");
    const rawMarkdown = await readFile(httpsTunnelPlan.markdownPath, "utf8");
    assert.ok(rawMarkdown.includes("Clippers HTTPS Tunnel / Deploy Plan"));
    assert.ok(rawMarkdown.includes("Execution Session"));
    assert.ok(rawMarkdown.includes("PUBLIC_BASE_URL template"));
    assert.ok(rawMarkdown.includes("Endpoint checks"));
    assert.ok(rawMarkdown.includes("Register after save"));
    assert.ok(rawMarkdown.includes("Rollback plan"));
    assert.ok(rawMarkdown.includes(`Local port: ${process.env.PORT || "5010"}`));
    assert.ok(rawManifest.includes("cloudflare-tunnel"));
    assert.ok(rawManifest.includes("executionSession"));
    assert.ok(rawManifest.includes("publicBaseUrlTemplate"));
    assert.equal(rawManifest.includes("5013"), false);
    assert.equal(rawManifest.includes("access_token"), false);
    assert.equal(rawMarkdown.includes("client_secret"), false);
  } finally {
    if (previousManifest === null) await unlink(beforeStatus.httpsTunnelPlan.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.httpsTunnelPlan.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.httpsTunnelPlan.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.httpsTunnelPlan.markdownPath, previousMarkdown);
  }
});

test("prepareClipperLegalPolicyPack writes public privacy and terms artifacts", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.legalPolicyPack.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.legalPolicyPack.markdownPath, "utf8").catch(() => null);
  const previousPrivacy = await readFile(beforeStatus.legalPolicyPack.privacyPath, "utf8").catch(() => null);
  const previousTerms = await readFile(beforeStatus.legalPolicyPack.termsPath, "utf8").catch(() => null);

  try {
    const { legalPolicyPack, status } = await prepareClipperLegalPolicyPack();
    assert.ok(legalPolicyPack.privacyUrl.endsWith("/clippers/legal/privacy"));
    assert.ok(legalPolicyPack.termsUrl.endsWith("/clippers/legal/terms"));
    assert.ok(status.commandCenter.steps.some((step) => step.id === "legal-policy-pack" && step.actionUrl === "/api/clippers/prepare-legal-policy-pack"));
    assert.ok(status.growthAudit.items.some((item) => item.id === "legal-policy-pack"));

    const rawPrivacy = await readFile(legalPolicyPack.privacyPath, "utf8");
    const rawTerms = await readFile(legalPolicyPack.termsPath, "utf8");
    const rawMarkdown = await readFile(legalPolicyPack.markdownPath, "utf8");
    assert.ok(rawPrivacy.includes("Clippers Privacy Policy"));
    assert.ok(rawTerms.includes("Clippers Terms of Service"));
    assert.ok(rawMarkdown.includes("Privacy Policy"));
    assert.equal(rawPrivacy.includes("access_token"), false);
    assert.equal(rawTerms.includes("client_secret"), false);
  } finally {
    if (previousManifest === null) await unlink(beforeStatus.legalPolicyPack.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.legalPolicyPack.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.legalPolicyPack.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.legalPolicyPack.markdownPath, previousMarkdown);
    if (previousPrivacy === null) await unlink(beforeStatus.legalPolicyPack.privacyPath).catch(() => undefined);
    else await writeFile(beforeStatus.legalPolicyPack.privacyPath, previousPrivacy);
    if (previousTerms === null) await unlink(beforeStatus.legalPolicyPack.termsPath).catch(() => undefined);
    else await writeFile(beforeStatus.legalPolicyPack.termsPath, previousTerms);
  }
});

test("prepareClipperAppReviewDemoPack writes public demo and screencast script without secrets", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.appReviewDemoPack.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.appReviewDemoPack.markdownPath, "utf8").catch(() => null);
  const previousScript = await readFile(beforeStatus.appReviewDemoPack.demoScriptPath, "utf8").catch(() => null);

  try {
    const { appReviewDemoPack, status } = await prepareClipperAppReviewDemoPack();
    assert.ok(appReviewDemoPack.demoUrl.endsWith("/clippers/review-demo"));
    assert.equal(appReviewDemoPack.steps.length >= 3, true);
    assert.ok(status.commandCenter.steps.some((step) => step.id === "app-review-demo-pack" && step.actionUrl === "/api/clippers/prepare-app-review-demo-pack"));
    assert.ok(status.growthAudit.items.some((item) => item.id === "app-review-demo-pack"));

    const rawManifest = await readFile(appReviewDemoPack.manifestPath, "utf8");
    const rawMarkdown = await readFile(appReviewDemoPack.markdownPath, "utf8");
    const rawScript = await readFile(appReviewDemoPack.demoScriptPath, "utf8");
    assert.ok(rawMarkdown.includes("Clippers App Review Demo Pack"));
    assert.ok(rawScript.includes("Rights Gate"));
    assert.ok(rawScript.includes("approval_required"));
    assert.equal(rawManifest.includes("client_secret"), false);
    assert.equal(rawMarkdown.includes("access_token"), false);
    assert.equal(rawScript.includes("refresh_token"), false);
  } finally {
    if (previousManifest === null) await unlink(beforeStatus.appReviewDemoPack.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.appReviewDemoPack.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.appReviewDemoPack.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.appReviewDemoPack.markdownPath, previousMarkdown);
    if (previousScript === null) await unlink(beforeStatus.appReviewDemoPack.demoScriptPath).catch(() => undefined);
    else await writeFile(beforeStatus.appReviewDemoPack.demoScriptPath, previousScript);
  }
});

test("prepareClipperDeveloperApplicationDrafts writes copy-ready developer app submissions", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.developerApplicationDrafts.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.developerApplicationDrafts.markdownPath, "utf8").catch(() => null);

  try {
    const { developerApplicationDrafts, status } = await prepareClipperDeveloperApplicationDrafts();
    assert.equal(developerApplicationDrafts.items.length, 3);
    assert.equal(developerApplicationDrafts.totals.platforms, 3);
    assert.ok(developerApplicationDrafts.totals.scopes >= 5);
    assert.equal(developerApplicationDrafts.creationSession.length, 3);
    assert.ok(developerApplicationDrafts.totals.sessionSteps >= 30);
    assert.ok(developerApplicationDrafts.creationSession.every((item) => item.portalFields.length >= 7));
    assert.ok(developerApplicationDrafts.creationSession.every((item) => item.evidenceNeeded.length >= 5));
    assert.ok(developerApplicationDrafts.creationSession.every((item) => item.doneCriteria.length >= 4));
    assert.ok(developerApplicationDrafts.creationSession.every((item) => item.credentialEnvGroups.length >= 2));
    assert.ok(developerApplicationDrafts.creationSession.every((item) => item.credentialCopyMap.length >= 2));
    assert.ok(developerApplicationDrafts.creationSession.every((item) => item.portalSubmissionSteps.length >= 10));
    assert.ok(developerApplicationDrafts.creationSession.every((item) => item.appVaultChecklist.length >= 5));
    assert.ok(developerApplicationDrafts.creationSession.every((item) => item.draftEvidenceBatchRow.includes(",\"draft\",")));
    assert.ok(developerApplicationDrafts.creationSession.every((item) => item.submittedEvidenceBatchRow.includes(",\"submitted\",")));
    assert.ok(developerApplicationDrafts.creationSession.every((item) => item.approvedEvidenceBatchRow.includes(",\"approved\",")));
    assert.ok(developerApplicationDrafts.creationSession.some((item) => item.platform === "tiktok" && item.credentialEnvGroups.some((group) => group.includes("TIKTOK_CLIENT_KEY"))));
    assert.ok(developerApplicationDrafts.items.every((item) => item.redirectUri.includes("/api/clippers/oauth/")));
    assert.ok(developerApplicationDrafts.items.every((item) => item.submissionAnswers.some((answer) => answer.prompt.includes("permissions"))));
    assert.ok(developerApplicationDrafts.items.every((item) => item.requiredInputs.length > 0 && item.completionHint.length > 20));
    assert.ok(developerApplicationDrafts.items.every((item) => item.portalFlow.length >= 5));
    assert.ok(developerApplicationDrafts.items.every((item) => item.approvalCriteria.length >= 4));
    assert.ok(developerApplicationDrafts.items.every((item) => item.postApprovalSteps.length >= 5));
    assert.ok(developerApplicationDrafts.items.every((item) => item.credentialCopyMap.length >= 2));
    assert.ok(developerApplicationDrafts.items.every((item) => item.portalSubmissionSteps.length >= 10));
    assert.ok(developerApplicationDrafts.items.every((item) => item.appVaultChecklist.length >= 5));
    assert.ok(developerApplicationDrafts.items.every((item) => item.draftEvidenceBatchRow.includes(",\"draft\",")));
    assert.ok(developerApplicationDrafts.items.every((item) => item.submittedEvidenceBatchRow.includes(",\"submitted\",")));
    assert.ok(developerApplicationDrafts.items.every((item) => item.approvedEvidenceBatchRow.includes(",\"approved\",")));
    assert.ok(developerApplicationDrafts.items.some((item) => item.platform === "instagram" && item.portalFlow.some((step) => step.includes("Meta Developers"))));
    assert.ok(developerApplicationDrafts.items.every((item) => item.evidenceBatchRow.startsWith('"developer_app"')));
    assert.ok(developerApplicationDrafts.items.every((item) => item.evidenceRecipeRow.includes("<developer app id")));
    assert.ok(developerApplicationDrafts.items.some((item) => item.platform === "youtube" && item.requestedScopes.includes("https://www.googleapis.com/auth/youtube.upload")));
    assert.ok(status.commandCenter.steps.some((step) => step.id === "developer-application-drafts" && step.actionUrl === "/api/clippers/prepare-developer-application-drafts"));
    assert.ok(status.growthAudit.items.some((item) => item.id === "developer-application-drafts"));

    const rawManifest = await readFile(developerApplicationDrafts.manifestPath, "utf8");
    const rawMarkdown = await readFile(developerApplicationDrafts.markdownPath, "utf8");
    assert.ok(rawMarkdown.includes("Clippers Developer Application Drafts"));
    assert.ok(rawMarkdown.includes("Official sources checked"));
    assert.ok(rawMarkdown.includes("Developer App Creation Session"));
    assert.ok(rawMarkdown.includes("Portal fields"));
    assert.ok(rawMarkdown.includes("Credential copy map"));
    assert.ok(rawMarkdown.includes("Portal submission steps"));
    assert.ok(rawMarkdown.includes("App vault checklist"));
    assert.ok(rawMarkdown.includes("Done criteria"));
    assert.ok(rawMarkdown.includes("Portal flow"));
    assert.ok(rawMarkdown.includes("Approval criteria"));
    assert.ok(rawMarkdown.includes("Post-approval steps"));
    assert.ok(rawMarkdown.includes("Evidence recipe row"));
    assert.ok(rawMarkdown.includes("Evidence batch row"));
    assert.ok(rawManifest.includes("requiredInputs"));
    assert.ok(rawManifest.includes("creationSession"));
    assert.ok(rawManifest.includes("credentialEnvGroups"));
    assert.ok(rawManifest.includes("credentialCopyMap"));
    assert.ok(rawManifest.includes("approvedEvidenceBatchRow"));
    assert.ok(rawMarkdown.includes("TikTok Content Posting API"));
    assert.equal(rawManifest.includes("client_secret"), false);
    assert.equal(rawMarkdown.includes("access_token_value"), false);
  } finally {
    if (previousManifest === null) await unlink(beforeStatus.developerApplicationDrafts.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.developerApplicationDrafts.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.developerApplicationDrafts.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.developerApplicationDrafts.markdownPath, previousMarkdown);
  }
});

test("recordClipperProductionPublicUrl requires public HTTPS and refreshes go-live artifacts", async () => {
  const envPath = path.join(process.cwd(), "CEO_ASSISTANT_ENV");
  const previousFile = await readFile(envPath, "utf8").catch(() => null);
  const originalPublicBaseUrl = process.env.PUBLIC_BASE_URL;
  const beforeStatus = await getClipperStatus();
  const publicUrlStorePath = path.join(beforeStatus.rootDir, "production-public-url.json");
  const previousPublicUrlStore = await readFile(publicUrlStorePath, "utf8").catch(() => null);
  const previousProductionUrl = await readFile(beforeStatus.productionUrlSetup.manifestPath, "utf8").catch(() => null);
  const previousOauth = await readFile(beforeStatus.oauthGoLive.manifestPath, "utf8").catch(() => null);
  const previousAppReview = await readFile(beforeStatus.appReviewSubmissionPack.manifestPath, "utf8").catch(() => null);
  const previousAppReviewDemo = await readFile(beforeStatus.appReviewDemoPack.manifestPath, "utf8").catch(() => null);
  const previousAppReviewDemoMarkdown = await readFile(beforeStatus.appReviewDemoPack.markdownPath, "utf8").catch(() => null);
  const previousAppReviewDemoScript = await readFile(beforeStatus.appReviewDemoPack.demoScriptPath, "utf8").catch(() => null);
  const previousDeveloperApplicationDrafts = await readFile(beforeStatus.developerApplicationDrafts.manifestPath, "utf8").catch(() => null);
  const previousDeveloperApplicationDraftsMarkdown = await readFile(beforeStatus.developerApplicationDrafts.markdownPath, "utf8").catch(() => null);
  const previousGoLive = await readFile(beforeStatus.goLiveExecutionPack.manifestPath, "utf8").catch(() => null);
  const previousLegal = await readFile(beforeStatus.legalPolicyPack.manifestPath, "utf8").catch(() => null);
  const previousPrivacy = await readFile(beforeStatus.legalPolicyPack.privacyPath, "utf8").catch(() => null);
  const previousTerms = await readFile(beforeStatus.legalPolicyPack.termsPath, "utf8").catch(() => null);

  try {
    await assert.rejects(
      () => recordClipperProductionPublicUrl({ publicBaseUrl: "http://127.0.0.1:5013" }),
      /publica HTTPS/
    );

    const { productionPublicUrl, status } = await recordClipperProductionPublicUrl({
      publicBaseUrl: "https://app.clipprreview.com/",
    });

    assert.equal(productionPublicUrl.publicBaseUrl, "https://app.clipprreview.com");
    assert.equal(productionPublicUrl.productionUrlSetup.productionUrlReady, true);
    assert.equal(productionPublicUrl.legalPolicyPack.productionUrlReady, true);
    assert.ok(productionPublicUrl.legalPolicyPack.privacyUrl.startsWith("https://app.clipprreview.com"));
    assert.equal(productionPublicUrl.appReviewDemoPack.productionUrlReady, true);
    assert.ok(productionPublicUrl.appReviewDemoPack.demoUrl.startsWith("https://app.clipprreview.com"));
    assert.equal(productionPublicUrl.developerApplicationDrafts.status, "ready");
    assert.ok(productionPublicUrl.developerApplicationDrafts.items.every((item) => item.redirectUri.startsWith("https://app.clipprreview.com")));
    assert.equal(productionPublicUrl.oauthGoLive.productionUrlReady, true);
    assert.ok(productionPublicUrl.appReviewSubmissionPack.items.every((item) => item.redirectUri.startsWith("https://app.clipprreview.com")));
    assert.ok(productionPublicUrl.appReviewSubmissionPack.items.every((item) => item.demoUrl.startsWith("https://app.clipprreview.com")));
    assert.ok(productionPublicUrl.goLiveExecutionPack.platforms.some((platform) => platform.phases.some((phase) => phase.id.endsWith("production-url") && phase.status === "done")));
    assert.equal(status.productionUrlSetup.productionUrlReady, true);

    assert.equal(productionPublicUrl.storageFileName, "production-public-url.json");
    assert.equal(productionPublicUrl.storagePath, publicUrlStorePath);
    const rawPublicUrlStore = await readFile(publicUrlStorePath, "utf8");
    assert.ok(rawPublicUrlStore.includes("https://app.clipprreview.com"));
    assert.ok(rawPublicUrlStore.includes("clippers_workspace"));
    const rawEnv = await readFile(envPath, "utf8").catch(() => null);
    assert.equal(rawEnv, previousFile);
    assert.equal(JSON.stringify(productionPublicUrl).includes("client_secret"), false);
  } finally {
    if (originalPublicBaseUrl) process.env.PUBLIC_BASE_URL = originalPublicBaseUrl;
    else delete process.env.PUBLIC_BASE_URL;
    if (previousFile === null) await unlink(envPath).catch(() => undefined);
    else await writeFile(envPath, previousFile);
    if (previousPublicUrlStore === null) await unlink(publicUrlStorePath).catch(() => undefined);
    else await writeFile(publicUrlStorePath, previousPublicUrlStore);
    if (previousProductionUrl === null) await unlink(beforeStatus.productionUrlSetup.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.productionUrlSetup.manifestPath, previousProductionUrl);
    if (previousOauth === null) await unlink(beforeStatus.oauthGoLive.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.oauthGoLive.manifestPath, previousOauth);
    if (previousAppReview === null) await unlink(beforeStatus.appReviewSubmissionPack.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.appReviewSubmissionPack.manifestPath, previousAppReview);
    if (previousAppReviewDemo === null) await unlink(beforeStatus.appReviewDemoPack.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.appReviewDemoPack.manifestPath, previousAppReviewDemo);
    if (previousAppReviewDemoMarkdown === null) await unlink(beforeStatus.appReviewDemoPack.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.appReviewDemoPack.markdownPath, previousAppReviewDemoMarkdown);
    if (previousAppReviewDemoScript === null) await unlink(beforeStatus.appReviewDemoPack.demoScriptPath).catch(() => undefined);
    else await writeFile(beforeStatus.appReviewDemoPack.demoScriptPath, previousAppReviewDemoScript);
    if (previousDeveloperApplicationDrafts === null) await unlink(beforeStatus.developerApplicationDrafts.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.developerApplicationDrafts.manifestPath, previousDeveloperApplicationDrafts);
    if (previousDeveloperApplicationDraftsMarkdown === null) await unlink(beforeStatus.developerApplicationDrafts.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.developerApplicationDrafts.markdownPath, previousDeveloperApplicationDraftsMarkdown);
    if (previousGoLive === null) await unlink(beforeStatus.goLiveExecutionPack.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.goLiveExecutionPack.manifestPath, previousGoLive);
    if (previousLegal === null) await unlink(beforeStatus.legalPolicyPack.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.legalPolicyPack.manifestPath, previousLegal);
    if (previousPrivacy === null) await unlink(beforeStatus.legalPolicyPack.privacyPath).catch(() => undefined);
    else await writeFile(beforeStatus.legalPolicyPack.privacyPath, previousPrivacy);
    if (previousTerms === null) await unlink(beforeStatus.legalPolicyPack.termsPath).catch(() => undefined);
    else await writeFile(beforeStatus.legalPolicyPack.termsPath, previousTerms);
  }
});

test("prepareClipperAppReviewSubmissionPack writes copy-ready review answers without secrets", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.appReviewSubmissionPack.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.appReviewSubmissionPack.markdownPath, "utf8").catch(() => null);

  try {
    const { appReviewSubmissionPack, status } = await prepareClipperAppReviewSubmissionPack();
    assert.equal(appReviewSubmissionPack.items.length, 3);
    assert.equal(appReviewSubmissionPack.totals.platforms, 3);
    assert.ok(appReviewSubmissionPack.totals.answers >= 12);
    assert.ok(appReviewSubmissionPack.items.every((item) => item.submissionAnswers.some((answer) => answer.prompt.includes("permissions"))));
    assert.ok(appReviewSubmissionPack.items.every((item) => item.demoUrl.endsWith("/clippers/review-demo")));
    assert.ok(appReviewSubmissionPack.items.some((item) => item.platform === "tiktok" && item.requestedScopes.includes("video.publish")));
    assert.ok(status.commandCenter.steps.some((step) => step.id === "app-review-submission-pack" && step.actionUrl === "/api/clippers/prepare-app-review-submission-pack"));

    const rawManifest = await readFile(appReviewSubmissionPack.manifestPath, "utf8");
    const rawMarkdown = await readFile(appReviewSubmissionPack.markdownPath, "utf8");
    assert.ok(rawMarkdown.includes("Clippers App Review Submission Pack"));
    assert.ok(rawMarkdown.includes("Submission answers"));
    assert.ok(rawMarkdown.includes("Demo URL"));
    assert.equal(rawManifest.includes("client_secret"), false);
    assert.equal(rawMarkdown.includes("access_token_value"), false);
  } finally {
    if (previousManifest === null) await unlink(beforeStatus.appReviewSubmissionPack.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.appReviewSubmissionPack.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.appReviewSubmissionPack.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.appReviewSubmissionPack.markdownPath, previousMarkdown);
  }
});

test("prepareClipperOAuthGoLivePreflight writes OAuth go-live gate without secrets", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.oauthGoLive.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.oauthGoLive.markdownPath, "utf8").catch(() => null);
  const previousPublicBaseUrl = process.env.PUBLIC_BASE_URL;

  try {
    process.env.PUBLIC_BASE_URL = "http://127.0.0.1:5013";
    const { oauthGoLive, status } = await prepareClipperOAuthGoLivePreflight();
    assert.equal(oauthGoLive.items.length, 3);
    assert.equal(oauthGoLive.totals.platforms, 3);
    assert.ok(oauthGoLive.publicBaseUrl.includes("5013") || oauthGoLive.publicBaseUrl.startsWith("http"));
    assert.equal(oauthGoLive.productionUrlReady, false);
    assert.ok(oauthGoLive.productionUrlNote.includes("PUBLIC_BASE_URL"));
    assert.ok(oauthGoLive.items.every((item) => item.productionUrlReady === false));
    assert.ok(oauthGoLive.items.every((item) => item.blockers.some((blocker) => blocker.includes("PUBLIC_BASE_URL"))));
    assert.ok(oauthGoLive.items.every((item) => item.redirectUri.includes(item.callbackPath)));
    assert.ok(oauthGoLive.items.some((item) => item.platform === "youtube" && item.permissionsTotal > 0));
    assert.ok(status.commandCenter.steps.some((step) => step.id === "oauth-go-live" && step.actionUrl === "/api/clippers/prepare-oauth-go-live"));

    const rawManifest = await readFile(oauthGoLive.manifestPath, "utf8");
    const rawMarkdown = await readFile(oauthGoLive.markdownPath, "utf8");
    assert.ok(rawMarkdown.includes("Clippers OAuth Go-Live Preflight"));
    assert.ok(rawMarkdown.includes("Production URL ready: no"));
    assert.ok(rawManifest.includes("redirectUri"));
    assert.equal(rawManifest.includes("access_token"), false);
    assert.equal(rawMarkdown.includes("client_secret"), false);
  } finally {
    if (previousPublicBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = previousPublicBaseUrl;
    if (previousManifest === null) await unlink(beforeStatus.oauthGoLive.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.oauthGoLive.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.oauthGoLive.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.oauthGoLive.markdownPath, previousMarkdown);
  }
});

test("prepareClipperOAuthConnectionPack writes per-account OAuth runbook without secrets", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.oauthConnectionPack.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.oauthConnectionPack.markdownPath, "utf8").catch(() => null);
  const previousCsv = await readFile(beforeStatus.oauthConnectionPack.csvPath, "utf8").catch(() => null);

  try {
    const { oauthConnectionPack, status } = await prepareClipperOAuthConnectionPack();
    const expectedConnections = status.accounts.reduce((sum, account) => sum + account.platformAccounts.length, 0);
    assert.equal(oauthConnectionPack.items.length, expectedConnections);
    assert.equal(oauthConnectionPack.totals.connections, expectedConnections);
    assert.equal(oauthConnectionPack.platformBatches.length, 3);
    assert.ok(oauthConnectionPack.platformBatches.some((batch) => batch.platform === "tiktok" && batch.connections > 0));
    assert.ok(oauthConnectionPack.platformBatches.every((batch) => batch.redirectUri.includes(batch.callbackPath)));
    assert.ok(oauthConnectionPack.platformBatches.every((batch) => batch.checklist.length >= 5));
    assert.ok(oauthConnectionPack.platformBatches.every((batch) => batch.requestedScopes.length > 0));
    assert.ok(oauthConnectionPack.markdownPath.endsWith("oauth-connection-pack.md"));
    assert.ok(oauthConnectionPack.csvPath.endsWith("oauth-connection-pack.csv"));
    assert.ok(oauthConnectionPack.items.every((item) => item.redirectUri.includes(item.callbackPath)));
    assert.ok(oauthConnectionPack.items.some((item) => item.platform === "youtube" && item.requestedScopes.some((scope) => scope.includes("youtube.upload"))));
    assert.ok(oauthConnectionPack.items.every((item) => item.evidenceToCapture.some((evidence) => evidence.includes("token"))));
    assert.ok(oauthConnectionPack.items.every((item) => item.requiredInputs.length > 0 && item.completionHint.length > 20));
    assert.ok(status.commandCenter.steps.some((step) => step.id === "oauth-connection-pack" && step.actionUrl === "/api/clippers/prepare-oauth-connection-pack"));
    assert.ok(status.growthAudit.items.some((item) => item.id === "oauth-connection-pack"));

    const rawManifest = await readFile(oauthConnectionPack.manifestPath, "utf8");
    const rawMarkdown = await readFile(oauthConnectionPack.markdownPath, "utf8");
    const rawCsv = await readFile(oauthConnectionPack.csvPath, "utf8");
    assert.ok(rawMarkdown.includes("Clippers OAuth Connection Pack"));
    assert.ok(rawMarkdown.includes("Platform Batches"));
    assert.ok(rawMarkdown.includes("Account Connections"));
    assert.ok(rawMarkdown.includes("Required inputs"));
    assert.ok(rawCsv.includes("platform_batch_id"));
    assert.ok(rawCsv.includes("redirect_uri"));
    assert.ok(rawCsv.includes("required_inputs"));
    assert.ok(rawManifest.includes("platformBatches"));
    assert.ok(rawManifest.includes("requiredInputs"));
    assert.equal(rawManifest.includes("client_secret"), false);
    assert.equal(rawMarkdown.includes("access_token_value"), false);
    assert.equal(rawCsv.includes("refresh_token"), false);
  } finally {
    if (previousManifest === null) await unlink(beforeStatus.oauthConnectionPack.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.oauthConnectionPack.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.oauthConnectionPack.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.oauthConnectionPack.markdownPath, previousMarkdown);
    if (previousCsv === null) await unlink(beforeStatus.oauthConnectionPack.csvPath).catch(() => undefined);
    else await writeFile(beforeStatus.oauthConnectionPack.csvPath, previousCsv);
  }
});

test("prepareClipperLaunchCommandCenter prepares all local launch artifacts and blocker map", async () => {
  const { commandCenter, status } = await prepareClipperLaunchCommandCenter(undefined, {
    clipsPerAccount: 2,
    publishMode: "approval_required",
    riskTolerance: "growth",
    weeklyTargetClips: 100,
  });

  try {
    assert.ok(commandCenter.manifestPath.endsWith("launch-command-center.json"));
    assert.ok(commandCenter.markdownPath.endsWith("launch-command-center.md"));
    assert.equal(commandCenter.totals.steps >= 8, true);
    assert.ok(commandCenter.steps.some((step) => step.id === "internal-setup" && step.status === "done"));
    assert.ok(commandCenter.steps.some((step) => step.id === "external-accounts"));
    assert.ok(commandCenter.steps.some((step) => step.id === "oauth-token-vault"));
    assert.ok(commandCenter.steps.some((step) => step.id === "go-live-operator-brief" && step.actionUrl === "/api/clippers/prepare-go-live-operator-brief"));
    assert.ok(commandCenter.steps.some((step) => step.id === "publisher-execution-queue" && step.actionUrl === "/api/clippers/prepare-publisher-execution-queue"));
    assert.equal(status.commandCenter.manifestPath, commandCenter.manifestPath);

    const manifestStat = await stat(commandCenter.manifestPath);
    const markdownStat = await stat(commandCenter.markdownPath);
    assert.equal(manifestStat.isFile(), true);
    assert.equal(markdownStat.isFile(), true);

    const markdown = await readFile(commandCenter.markdownPath, "utf8");
    assert.ok(markdown.includes("Clippers Launch Command Center"));
    assert.ok(markdown.includes("Cuentas reales por plataforma"));
    assert.ok(markdown.includes("Go-Live Operator Brief"));
    assert.ok(markdown.includes("Publisher Execution Queue"));
  } finally {
    await unlink(commandCenter.manifestPath).catch(() => undefined);
    await unlink(commandCenter.markdownPath).catch(() => undefined);
  }
});

test("prepareClipperBlockerResolutionPack writes prioritized unblock actions", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.blockerResolutionPack.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.blockerResolutionPack.markdownPath, "utf8").catch(() => null);
  const previousCsv = await readFile(beforeStatus.blockerResolutionPack.csvPath, "utf8").catch(() => null);

  try {
    const { blockerResolutionPack, status } = await prepareClipperBlockerResolutionPack();
    assert.ok(blockerResolutionPack.manifestPath.endsWith("blocker-resolution-pack.json"));
    assert.ok(blockerResolutionPack.markdownPath.endsWith("blocker-resolution-pack.md"));
    assert.ok(blockerResolutionPack.csvPath.endsWith("blocker-resolution-pack.csv"));
    assert.ok(blockerResolutionPack.actions.length > 0);
    assert.equal(blockerResolutionPack.actions[0].rank, 1);
    assert.ok(blockerResolutionPack.actions.some((action) => action.status === "blocked"));
    assert.ok(blockerResolutionPack.actions.every((action) => action.checklist.length >= 2));
    assert.ok(blockerResolutionPack.actions.every((action) => action.doneCriteria.length >= 2));
    assert.ok(blockerResolutionPack.actions.every((action) => action.unlockPhase && Array.isArray(action.dependsOn)));
    assert.ok(blockerResolutionPack.actions.every((action) => action.proofCommand.length > 0));
    assert.ok(blockerResolutionPack.actions.every((action) => action.executionMode && action.estimatedMinutes > 0));
    assert.ok(blockerResolutionPack.actions.some((action) => action.portalUrl?.startsWith("https://")));
    assert.ok(blockerResolutionPack.actions.some((action) => ["account", "developer_app", "permission"].includes(action.actionType) && action.evidenceImportRow.length > 0));
    assert.ok(blockerResolutionPack.evidenceBatchTemplate.includes("kind,account_id,platform,status"));
    assert.equal(status.blockerResolutionPack.manifestPath, blockerResolutionPack.manifestPath);

    const rawManifest = await readFile(blockerResolutionPack.manifestPath, "utf8");
    const rawMarkdown = await readFile(blockerResolutionPack.markdownPath, "utf8");
    const rawCsv = await readFile(blockerResolutionPack.csvPath, "utf8");
    assert.ok(rawMarkdown.includes("Clippers Blocker Resolution Pack"));
    assert.ok(rawMarkdown.includes("Unlock phase"));
    assert.ok(rawMarkdown.includes("Proof command"));
    assert.ok(rawMarkdown.includes("Unblock condition"));
    assert.ok(rawMarkdown.includes("Evidence Batch Template"));
    assert.ok(rawMarkdown.includes("Done criteria"));
    assert.ok(rawCsv.includes("unlock_phase"));
    assert.ok(rawCsv.includes("proof_command"));
    assert.ok(rawCsv.includes("execution_mode"));
    assert.ok(rawCsv.includes("portal_url"));
    assert.ok(rawCsv.includes("unblock_condition"));
    assert.equal(rawManifest.includes("access_token"), false);
    assert.equal(rawMarkdown.includes("client_secret"), false);
  } finally {
    if (previousManifest === null) await unlink(beforeStatus.blockerResolutionPack.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.blockerResolutionPack.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.blockerResolutionPack.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.blockerResolutionPack.markdownPath, previousMarkdown);
    if (previousCsv === null) await unlink(beforeStatus.blockerResolutionPack.csvPath).catch(() => undefined);
    else await writeFile(beforeStatus.blockerResolutionPack.csvPath, previousCsv);
  }
});

test("prepareClipperGoLiveAutopilotBrief writes unified next-action queue", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.goLiveAutopilotBrief.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.goLiveAutopilotBrief.markdownPath, "utf8").catch(() => null);
  const previousCsv = await readFile(beforeStatus.goLiveAutopilotBrief.csvPath, "utf8").catch(() => null);

  try {
    const { goLiveAutopilotBrief, status } = await prepareClipperGoLiveAutopilotBrief();
    assert.ok(goLiveAutopilotBrief.manifestPath.endsWith("go-live-autopilot-brief.json"));
    assert.ok(goLiveAutopilotBrief.markdownPath.endsWith("go-live-autopilot-brief.md"));
    assert.ok(goLiveAutopilotBrief.csvPath.endsWith("go-live-autopilot-brief.csv"));
    assert.ok(goLiveAutopilotBrief.actions.length > 0);
    assert.equal(goLiveAutopilotBrief.actions[0].rank, 1);
    assert.ok(goLiveAutopilotBrief.totals.actions >= goLiveAutopilotBrief.totals.inAppReady);
    assert.ok(goLiveAutopilotBrief.actions.every((action) => action.evidenceTemplate.length > 0));
    assert.ok(goLiveAutopilotBrief.actions.every((action) => action.agentId.length > 0 && action.subAgentName.length > 0));
    assert.ok(goLiveAutopilotBrief.actions.every((action) => action.mission.includes(action.label)));
    assert.ok(goLiveAutopilotBrief.actions.every((action) => action.operatorSteps.length >= 3));
    assert.ok(goLiveAutopilotBrief.actions.every((action) => action.handoffPayload.length >= 5));
    assert.ok(goLiveAutopilotBrief.actions.every((action) => action.evidenceRows.length > 0));
    assert.ok(goLiveAutopilotBrief.actions.every((action) => action.successSignals.length >= 2));
    assert.ok(goLiveAutopilotBrief.actions.every((action) => action.riskControls.length >= 2));
    assert.ok(goLiveAutopilotBrief.agentSessions.length > 0);
    assert.equal(goLiveAutopilotBrief.totals.agentSessions, goLiveAutopilotBrief.agentSessions.length);
    assert.ok(goLiveAutopilotBrief.agentSessions.every((session) => session.id.startsWith("agent-session-")));
    assert.ok(goLiveAutopilotBrief.agentSessions.every((session) => session.actionCount === session.actionIds.length));
    assert.ok(goLiveAutopilotBrief.agentSessions.every((session) => session.evidenceRows.length > 0));
    assert.ok(goLiveAutopilotBrief.agentSessions.every((session) => session.riskControls.length > 0));
    assert.ok(goLiveAutopilotBrief.actions.every((action) => goLiveAutopilotBrief.agentSessions.some((session) => session.actionIds.includes(action.id))));
    assert.equal(status.goLiveAutopilotBrief.manifestPath, goLiveAutopilotBrief.manifestPath);

    const rawManifest = await readFile(goLiveAutopilotBrief.manifestPath, "utf8");
    const rawMarkdown = await readFile(goLiveAutopilotBrief.markdownPath, "utf8");
    const rawCsv = await readFile(goLiveAutopilotBrief.csvPath, "utf8");
    assert.ok(rawMarkdown.includes("Clippers Go-Live Autopilot Brief"));
    assert.ok(rawMarkdown.includes("Agent Sessions"));
    assert.ok(rawMarkdown.includes("Sub-agent"));
    assert.ok(rawMarkdown.includes("Operator steps"));
    assert.ok(rawMarkdown.includes("Risk controls"));
    assert.ok(rawMarkdown.includes("Evidence template"));
    assert.ok(rawCsv.includes("agent_session_id"));
    assert.ok(rawCsv.includes("agent_id"));
    assert.ok(rawCsv.includes("operator_steps"));
    assert.ok(rawCsv.includes("risk_controls"));
    assert.ok(rawCsv.includes("evidence_template"));
    assert.equal(rawManifest.includes("access_token"), false);
    assert.equal(rawMarkdown.includes("client_secret"), false);
  } finally {
    if (previousManifest === null) await unlink(beforeStatus.goLiveAutopilotBrief.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.goLiveAutopilotBrief.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.goLiveAutopilotBrief.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.goLiveAutopilotBrief.markdownPath, previousMarkdown);
    if (previousCsv === null) await unlink(beforeStatus.goLiveAutopilotBrief.csvPath).catch(() => undefined);
    else await writeFile(beforeStatus.goLiveAutopilotBrief.csvPath, previousCsv);
  }
});

test("runClipperGoLiveAutopilot executes allowlisted in-app actions and writes run summary", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.goLiveAutopilotRun.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.goLiveAutopilotRun.markdownPath, "utf8").catch(() => null);

  try {
    const { goLiveAutopilotRun, status } = await runClipperGoLiveAutopilot({ maxActions: 1, resetCompleted: true });
    assert.ok(goLiveAutopilotRun.manifestPath.endsWith("go-live-autopilot-run.json"));
    assert.ok(goLiveAutopilotRun.markdownPath.endsWith("go-live-autopilot-run.md"));
    assert.equal(goLiveAutopilotRun.resetCompleted, true);
    assert.ok(goLiveAutopilotRun.availableInAppActions >= goLiveAutopilotRun.remainingInAppActions);
    assert.equal(goLiveAutopilotRun.alreadyCompletedInAppActions, 0);
    assert.equal(goLiveAutopilotRun.totals.attempted, 1);
    assert.ok(goLiveAutopilotRun.totals.completed + goLiveAutopilotRun.totals.skipped + goLiveAutopilotRun.totals.failed >= 1);
    assert.ok(Array.isArray(goLiveAutopilotRun.completedActionIds));
    assert.equal(status.goLiveAutopilotRun.manifestPath, goLiveAutopilotRun.manifestPath);

    const rawManifest = await readFile(goLiveAutopilotRun.manifestPath, "utf8");
    const rawMarkdown = await readFile(goLiveAutopilotRun.markdownPath, "utf8");
    assert.ok(rawMarkdown.includes("Clippers Go-Live Autopilot Run"));
    assert.ok(rawMarkdown.includes("Reset completed memory"));
    assert.ok(rawMarkdown.includes("In-app actions"));
    assert.ok(rawManifest.includes("remainingInAppActions"));
    assert.equal(rawManifest.includes("access_token"), false);
    assert.equal(rawMarkdown.includes("client_secret"), false);
  } finally {
    if (previousManifest === null) await unlink(beforeStatus.goLiveAutopilotRun.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.goLiveAutopilotRun.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.goLiveAutopilotRun.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.goLiveAutopilotRun.markdownPath, previousMarkdown);
  }
});

test("runClipperGoLiveAutopilot can refresh the operator brief action", async () => {
  const beforeStatus = await getClipperStatus();
  const previousRunManifest = await readFile(beforeStatus.goLiveAutopilotRun.manifestPath, "utf8").catch(() => null);
  const previousRunMarkdown = await readFile(beforeStatus.goLiveAutopilotRun.markdownPath, "utf8").catch(() => null);
  const previousBriefManifest = await readFile(beforeStatus.goLiveOperatorBrief.manifestPath, "utf8").catch(() => null);
  const previousBriefMarkdown = await readFile(beforeStatus.goLiveOperatorBrief.markdownPath, "utf8").catch(() => null);

  try {
    const { goLiveAutopilotBrief } = await prepareClipperGoLiveAutopilotBrief();
    const action = goLiveAutopilotBrief.actions.find((item) => item.localActionUrl === "/api/clippers/prepare-go-live-operator-brief");
    assert.ok(action);
    assert.equal(action.localActionUrl, "/api/clippers/prepare-go-live-operator-brief");

    const { goLiveAutopilotRun, status } = await runClipperGoLiveAutopilot({ actionId: action.id, resetCompleted: true });
    assert.equal(goLiveAutopilotRun.requestedActionId, action.id);
    assert.ok(goLiveAutopilotRun.items.some((item) => item.actionId === action.id && item.status === "completed"));
    assert.ok(goLiveAutopilotRun.completedActionIds.includes(action.id));
    assert.ok(status.goLiveOperatorBrief.generatedAt);

    const rawRun = await readFile(goLiveAutopilotRun.markdownPath, "utf8");
    const rawBrief = await readFile(status.goLiveOperatorBrief.markdownPath, "utf8");
    assert.ok(rawRun.includes("Go-Live Operator Brief regenerated."));
    assert.ok(rawBrief.includes("Clippers Go-Live Operator Brief"));
    assert.equal(rawRun.includes("access_token"), false);
    assert.equal(rawBrief.includes("client_secret"), false);
  } finally {
    if (previousRunManifest === null) await unlink(beforeStatus.goLiveAutopilotRun.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.goLiveAutopilotRun.manifestPath, previousRunManifest);
    if (previousRunMarkdown === null) await unlink(beforeStatus.goLiveAutopilotRun.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.goLiveAutopilotRun.markdownPath, previousRunMarkdown);
    if (previousBriefManifest === null) await unlink(beforeStatus.goLiveOperatorBrief.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.goLiveOperatorBrief.manifestPath, previousBriefManifest);
    if (previousBriefMarkdown === null) await unlink(beforeStatus.goLiveOperatorBrief.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.goLiveOperatorBrief.markdownPath, previousBriefMarkdown);
  }
});

test("runClipperGoLiveAutopilot advances past recently completed actions", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.goLiveAutopilotRun.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.goLiveAutopilotRun.markdownPath, "utf8").catch(() => null);

  try {
    const first = await runClipperGoLiveAutopilot({ maxActions: 1 });
    const second = await runClipperGoLiveAutopilot({ maxActions: 1 });
    const firstCompleted = first.goLiveAutopilotRun.items.find((item) => item.status === "completed");
    const secondCompleted = second.goLiveAutopilotRun.items.find((item) => item.status === "completed");
    if (firstCompleted && secondCompleted) {
      assert.notEqual(firstCompleted.actionId, secondCompleted.actionId);
    }
    assert.ok(second.goLiveAutopilotRun.completedActionIds.length >= first.goLiveAutopilotRun.completedActionIds.length);
  } finally {
    if (previousManifest === null) await unlink(beforeStatus.goLiveAutopilotRun.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.goLiveAutopilotRun.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.goLiveAutopilotRun.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.goLiveAutopilotRun.markdownPath, previousMarkdown);
  }
});

test("runClipperLocalDropSync safely skips empty drops and refreshes go-live state", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.localDropSync.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.localDropSync.markdownPath, "utf8").catch(() => null);

  try {
    const { localDropSync, status } = await runClipperLocalDropSync();
    assert.ok(localDropSync.manifestPath.endsWith("local-drop-sync.json"));
    assert.ok(localDropSync.markdownPath.endsWith("local-drop-sync.md"));
    assert.equal(localDropSync.items.length, 5);
    assert.equal(localDropSync.missingInputs.length, 3);
    assert.ok(localDropSync.items.some((item) => item.id === "credential_drop"));
    assert.ok(localDropSync.items.some((item) => item.id === "permission_template_drop"));
    assert.ok(localDropSync.items.some((item) => item.id === "launch_evidence_drop"));
    assert.ok(localDropSync.items.some((item) => item.id === "source_drop"));
    assert.ok(localDropSync.items.some((item) => item.id === "state_refresh" && item.status === "completed"));
    assert.ok(localDropSync.missingInputs.some((item) => item.id === "credentials" && item.dropDirs.some((dir) => dir === "credentials")));
    assert.ok(localDropSync.missingInputs.some((item) => item.id === "launch_evidence" && item.dropDirs.some((dir) => dir.includes("evidence-drop"))));
    assert.ok(localDropSync.missingInputs.some((item) => item.id === "source_videos" && item.dropDirs.some((dir) => dir.includes("source-drop/sports"))));
    assert.ok(localDropSync.totals.completed >= 1);
    assert.equal(status.localDropSync.manifestPath, localDropSync.manifestPath);
    assert.equal(status.localDropSync.missingInputs.length, 3);
    assert.ok(status.goLiveAutopilotBrief.actions.some((action) => action.localActionUrl === "/api/clippers/run-local-drop-sync"));

    const rawManifest = await readFile(localDropSync.manifestPath, "utf8");
    const rawMarkdown = await readFile(localDropSync.markdownPath, "utf8");
    assert.ok(rawMarkdown.includes("Clippers Local Drop Sync"));
    assert.ok(rawMarkdown.includes("Missing Input Checklist"));
    assert.ok(rawManifest.includes("permission_template_drop"));
    assert.ok(rawManifest.includes("state_refresh"));
    assert.ok(rawManifest.includes("source_videos"));
    assert.equal(rawManifest.includes("access_token"), false);
    assert.equal(rawMarkdown.includes("client_secret"), false);
  } finally {
    if (previousManifest === null) await unlink(beforeStatus.localDropSync.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.localDropSync.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.localDropSync.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.localDropSync.markdownPath, previousMarkdown);
  }
});

test("runClipperLocalDropSync imports launch evidence drop without failing", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.localDropSync.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.localDropSync.markdownPath, "utf8").catch(() => null);
  const evidenceDropDir = path.join(process.cwd(), "clippers_workspace", "evidence-drop");
  const testEvidencePath = path.join(evidenceDropDir, "local-drop-sync-launch-evidence.test.csv");
  const ownerConnectEvidenceDropPath = path.join(evidenceDropDir, "owner-connect-evidence.csv");
  const previousEvidenceDrop = await readFile(testEvidencePath, "utf8").catch(() => null);
  const previousOwnerConnectEvidenceDrop = await readFile(ownerConnectEvidenceDropPath, "utf8").catch(() => null);
  const accountEvidencePath = path.join(process.cwd(), "clippers_workspace", "account-evidence", "sports-daily-instagram.json");
  const previousAccountEvidence = await readFile(accountEvidencePath, "utf8").catch(() => null);
  const previousOwnerProgress = await readFile(beforeStatus.ownerConnectPack.progressRecordsPath, "utf8").catch(() => null);
  const previousDiagnostic = await readFile(beforeStatus.launchEvidenceDropDiagnostic.manifestPath, "utf8").catch(() => null);
  const previousDiagnosticMarkdown = await readFile(beforeStatus.launchEvidenceDropDiagnostic.markdownPath, "utf8").catch(() => null);
  const previousRepairWorksheet = await readFile(beforeStatus.launchEvidenceDropDiagnostic.repairWorksheetCsvPath, "utf8").catch(() => null);

  await mkdir(evidenceDropDir, { recursive: true });
  await unlink(ownerConnectEvidenceDropPath).catch(() => undefined);
  await writeFile(testEvidencePath, [
    "kind,account_id,platform,status,scope,app_identifier,public_base_url,notes",
    "\"account\",\"sports-daily\",\"instagram\",\"verified\",\"\",\"\",\"\",\"Instagram account @sportsdaily verified with profile URL https://www.instagram.com/sportsdaily/ and proof path stored outside repo.\"",
  ].join("\n"));

  try {
    const { localDropSync, status } = await runClipperLocalDropSync("local-drop-sync-launch-evidence-test");
    const launchEvidenceItem = localDropSync.items.find((item) => item.id === "launch_evidence_drop");

    assert.ok(launchEvidenceItem);
    assert.equal(launchEvidenceItem.status, "completed");
    assert.ok(launchEvidenceItem.message.includes("launch evidence rows accepted"));
    assert.ok(launchEvidenceItem.message.includes("account"));
    assert.ok(launchEvidenceItem.message.includes("app"));
    assert.ok(launchEvidenceItem.message.includes("permission"));
    assert.ok(launchEvidenceItem.message.includes("rejected"));
    assert.ok(launchEvidenceItem.message.includes("file errors"));
    assert.equal(launchEvidenceItem.message.includes("undefined"), false);
    assert.ok(localDropSync.launchEvidenceDrop);
    assert.equal(localDropSync.launchEvidenceDrop.accepted.accountEvidence >= 1, true);
    assert.equal(Array.isArray(localDropSync.launchEvidenceDrop.rejected), true);
    assert.equal(Array.isArray(localDropSync.launchEvidenceDrop.fileErrors), true);
    assert.ok(status.accountEvidence.items.some((item) => item.id === "sports-daily-instagram" && item.status === "verified"));

    const rawManifest = await readFile(localDropSync.manifestPath, "utf8");
    const rawMarkdown = await readFile(localDropSync.markdownPath, "utf8");
    assert.ok(rawManifest.includes("launch_evidence_drop"));
    assert.ok(rawManifest.includes("launchEvidenceDrop"));
    assert.ok(rawMarkdown.includes("Launch Evidence Drop"));
    assert.equal(rawManifest.includes("Cannot read properties of undefined"), false);
  } finally {
    if (previousEvidenceDrop === null) await unlink(testEvidencePath).catch(() => undefined);
    else await writeFile(testEvidencePath, previousEvidenceDrop);
    if (previousOwnerConnectEvidenceDrop === null) await unlink(ownerConnectEvidenceDropPath).catch(() => undefined);
    else await writeFile(ownerConnectEvidenceDropPath, previousOwnerConnectEvidenceDrop);
    if (previousAccountEvidence === null) await unlink(accountEvidencePath).catch(() => undefined);
    else await writeFile(accountEvidencePath, previousAccountEvidence);
    if (previousOwnerProgress === null) await unlink(beforeStatus.ownerConnectPack.progressRecordsPath).catch(() => undefined);
    else await writeFile(beforeStatus.ownerConnectPack.progressRecordsPath, previousOwnerProgress);
    if (previousManifest === null) await unlink(beforeStatus.localDropSync.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.localDropSync.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.localDropSync.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.localDropSync.markdownPath, previousMarkdown);
    if (previousDiagnostic === null) await unlink(beforeStatus.launchEvidenceDropDiagnostic.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.launchEvidenceDropDiagnostic.manifestPath, previousDiagnostic);
    if (previousDiagnosticMarkdown === null) await unlink(beforeStatus.launchEvidenceDropDiagnostic.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.launchEvidenceDropDiagnostic.markdownPath, previousDiagnosticMarkdown);
    if (previousRepairWorksheet === null) await unlink(beforeStatus.launchEvidenceDropDiagnostic.repairWorksheetCsvPath).catch(() => undefined);
    else await writeFile(beforeStatus.launchEvidenceDropDiagnostic.repairWorksheetCsvPath, previousRepairWorksheet);
  }
});

test("prepareClipperLaunchEvidenceFixPack writes correction queue for rejected evidence rows", async () => {
  const beforeStatus = await getClipperStatus();
  const evidenceDropDir = path.join(process.cwd(), "clippers_workspace", "evidence-drop");
  const ownerConnectEvidenceDropPath = path.join(evidenceDropDir, "owner-connect-evidence.csv");
  const previousOwnerConnectEvidenceDrop = await readFile(ownerConnectEvidenceDropPath, "utf8").catch(() => null);
  const previousLocalDropManifest = await readFile(beforeStatus.localDropSync.manifestPath, "utf8").catch(() => null);
  const previousLocalDropMarkdown = await readFile(beforeStatus.localDropSync.markdownPath, "utf8").catch(() => null);
  const previousManifest = await readFile(beforeStatus.launchEvidenceFixPack.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.launchEvidenceFixPack.markdownPath, "utf8").catch(() => null);
  const previousCsv = await readFile(beforeStatus.launchEvidenceFixPack.csvPath, "utf8").catch(() => null);
  const suggestedImportCsvPath = path.join(evidenceDropDir, "owner-connect-evidence.fixpack.csv");
  const previousSuggestedImportCsv = await readFile(suggestedImportCsvPath, "utf8").catch(() => null);
  const previousWorkbook = await readFile(beforeStatus.externalEvidenceWorkbook.manifestPath, "utf8").catch(() => null);
  const previousWorkbookMarkdown = await readFile(beforeStatus.externalEvidenceWorkbook.markdownPath, "utf8").catch(() => null);
  const previousWorkbookCsv = await readFile(beforeStatus.externalEvidenceWorkbook.csvPath, "utf8").catch(() => null);
  const previousWorkbookImportCsv = await readFile(beforeStatus.externalEvidenceWorkbook.importCsvPath, "utf8").catch(() => null);
  const publicUrlStorePath = path.join(beforeStatus.rootDir, "production-public-url.json");
  const previousPublicUrlStore = await readFile(publicUrlStorePath, "utf8").catch(() => null);
  const previousPublicBaseUrl = process.env.PUBLIC_BASE_URL;
  const previousIgnoreStoredPublicBaseUrl = process.env.CLIPPERS_IGNORE_STORED_PUBLIC_BASE_URL;

  await mkdir(evidenceDropDir, { recursive: true });
  await writeFile(publicUrlStorePath, JSON.stringify({
    publicBaseUrl: "https://app.clipprreview.com",
    updatedAt: "2026-06-20T00:00:00.000Z",
    storage: "clippers_workspace",
  }, null, 2));
  process.env.PUBLIC_BASE_URL = "https://your-domain.example";
  delete process.env.CLIPPERS_IGNORE_STORED_PUBLIC_BASE_URL;
  await writeFile(ownerConnectEvidenceDropPath, [
    "kind,account_id,platform,status,scope,app_identifier,public_base_url,notes",
    "account,sports-daily,instagram,verified,,,,",
    "developer_app,,tiktok,submitted,,tiktok-app-id,http://localhost:5000,Submitted with localhost URL",
    "permission,,youtube,requested,https://www.googleapis.com/auth/youtube.upload,,,",
  ].join("\n"));

  try {
    await runClipperLocalDropSync("launch-evidence-fix-pack-test");
    const { launchEvidenceFixPack, status } = await prepareClipperLaunchEvidenceFixPack("launch-evidence-fix-pack-test");

    assert.ok(launchEvidenceFixPack.manifestPath.endsWith("launch-evidence-fix-pack.json"));
    assert.ok(launchEvidenceFixPack.markdownPath.endsWith("launch-evidence-fix-pack.md"));
    assert.ok(launchEvidenceFixPack.csvPath.endsWith("launch-evidence-fix-pack.csv"));
    assert.ok(launchEvidenceFixPack.suggestedImportCsvPath.endsWith("owner-connect-evidence.fixpack.csv"));
    assert.equal(launchEvidenceFixPack.status, "needs_fix");
    assert.ok(launchEvidenceFixPack.totals.rejectedRows >= 0);
    assert.equal(launchEvidenceFixPack.totals.currentStateGaps > 0, true);
    assert.equal(launchEvidenceFixPack.totals.items >= launchEvidenceFixPack.totals.rejectedRows + launchEvidenceFixPack.totals.currentStateGaps, true);
    assert.ok(launchEvidenceFixPack.items.some((item) => item.fixCategory === "account_proof"));
    assert.ok(launchEvidenceFixPack.items.some((item) => item.fixCategory === "developer_app"));
    assert.ok(launchEvidenceFixPack.items.some((item) => item.fixCategory === "public_url"));
    assert.ok(launchEvidenceFixPack.items.some((item) => item.fixCategory === "permission_proof"));
    assert.ok(launchEvidenceFixPack.items.every((item) => item.suggestedReplacementRow.startsWith(item.kind)));
    if (launchEvidenceFixPack.totals.rejectedRows > 0) {
      assert.ok(launchEvidenceFixPack.items.some((item) => item.evidenceSource === "drop_rejected"));
    }
    assert.ok(launchEvidenceFixPack.items.some((item) => item.evidenceSource === "current_state_gap"));
    assert.ok(launchEvidenceFixPack.items.some((item) => item.suggestedReplacementRow.includes("<profile_url>")));
    assert.ok(launchEvidenceFixPack.items.some((item) => item.kind === "account" && item.suggestedReplacementRow.includes("sports-daily,instagram,verified")));
    assert.ok(launchEvidenceFixPack.items.some((item) => item.kind === "developer_app" && item.suggestedReplacementRow.includes(",tiktok,submitted,") && item.suggestedReplacementRow.includes("https://app.clipprreview.com")));
    assert.equal(launchEvidenceFixPack.items.some((item) => item.kind === "developer_app" && item.suggestedReplacementRow.includes("<https://your-domain.example>")), false);
    assert.ok(launchEvidenceFixPack.items.some((item) => item.kind === "permission" && item.suggestedReplacementRow.includes(",youtube,requested,https://www.googleapis.com/auth/youtube.upload,")));
    assert.equal(status.launchEvidenceFixPack.items.length, launchEvidenceFixPack.items.length);
    assert.equal(status.externalEvidenceWorkbook.status, "needs_evidence");
    assert.ok(status.externalEvidenceWorkbook.manifestPath.endsWith("external-evidence-workbook.json"));
    assert.ok(status.externalEvidenceWorkbook.markdownPath.endsWith("external-evidence-workbook.md"));
    assert.ok(status.externalEvidenceWorkbook.csvPath.endsWith("external-evidence-workbook.csv"));
    assert.ok(status.externalEvidenceWorkbook.importCsvPath.endsWith("owner-connect-evidence.workbook.csv"));
    assert.equal(status.externalEvidenceWorkbook.items.length, launchEvidenceFixPack.items.length);
    assert.ok(status.externalEvidenceWorkbook.totals.critical >= 1);
    assert.ok(status.externalEvidenceWorkbook.items.some((item) => item.fixCategory === "developer_app" && item.priority === "critical"));
    assert.ok(status.externalEvidenceWorkbook.items.every((item) => item.checklist.length >= 5));

    const rawMarkdown = await readFile(launchEvidenceFixPack.markdownPath, "utf8");
    const rawCsv = await readFile(launchEvidenceFixPack.csvPath, "utf8");
    const rawSuggestedImportCsv = await readFile(launchEvidenceFixPack.suggestedImportCsvPath, "utf8");
    const rawWorkbook = await readFile(status.externalEvidenceWorkbook.manifestPath, "utf8");
    const rawWorkbookMarkdown = await readFile(status.externalEvidenceWorkbook.markdownPath, "utf8");
    const rawWorkbookCsv = await readFile(status.externalEvidenceWorkbook.csvPath, "utf8");
    const rawWorkbookImportCsv = await readFile(status.externalEvidenceWorkbook.importCsvPath, "utf8");
    assert.ok(rawMarkdown.includes("Clippers Launch Evidence Fix Pack"));
    assert.ok(rawMarkdown.includes("Suggested import CSV"));
    assert.ok(rawMarkdown.includes("ignored by Local Sync"));
    assert.ok(rawMarkdown.includes("Suggested notes"));
    assert.ok(rawMarkdown.includes("Suggested replacement row"));
    assert.ok(rawMarkdown.includes("current-state gaps"));
    assert.ok(rawCsv.includes("evidence_source"));
    assert.ok(rawCsv.includes("required_fix"));
    assert.ok(rawCsv.includes("suggested_replacement_row"));
    assert.ok(rawSuggestedImportCsv.startsWith("kind,account_id,platform,status,scope,app_identifier,public_base_url,notes"));
    assert.ok(rawSuggestedImportCsv.includes("sports-daily,instagram,verified"));
    assert.ok(rawSuggestedImportCsv.includes("developer_app"));
    assert.ok(rawSuggestedImportCsv.includes("https://app.clipprreview.com"));
    assert.equal(rawSuggestedImportCsv.includes("<https://your-domain.example>"), false);
    assert.ok(rawSuggestedImportCsv.includes("permission"));
    assert.ok(rawWorkbook.includes("external-evidence"));
    assert.ok(rawWorkbookMarkdown.includes("Clippers External Evidence Workbook"));
    assert.ok(rawWorkbookMarkdown.includes("Single operator workbook"));
    assert.ok(rawWorkbookMarkdown.includes("https://app.clipprreview.com"));
    assert.ok(rawWorkbookCsv.includes("suggested_replacement_row"));
    assert.ok(rawWorkbookImportCsv.startsWith("kind,account_id,platform,status,scope,app_identifier,public_base_url,notes"));
    assert.ok(rawWorkbookImportCsv.includes("sports-daily,instagram,verified"));
    assert.ok(rawWorkbookImportCsv.includes("https://app.clipprreview.com"));
    assert.equal(rawWorkbookImportCsv.includes("<https://your-domain.example>"), false);
    assert.equal(rawMarkdown.includes("client_secret"), false);
    assert.equal(rawCsv.includes("access_token"), false);
    assert.equal(rawSuggestedImportCsv.includes("access_token"), false);
    assert.equal(rawSuggestedImportCsv.includes("client_secret"), false);
    assert.equal(rawWorkbookMarkdown.includes("client_secret"), false);
    assert.equal(rawWorkbookCsv.includes("access_token"), false);
    assert.equal(rawWorkbookImportCsv.includes("client_secret"), false);
  } finally {
    if (previousOwnerConnectEvidenceDrop === null) await unlink(ownerConnectEvidenceDropPath).catch(() => undefined);
    else await writeFile(ownerConnectEvidenceDropPath, previousOwnerConnectEvidenceDrop);
    if (previousLocalDropManifest === null) await unlink(beforeStatus.localDropSync.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.localDropSync.manifestPath, previousLocalDropManifest);
    if (previousLocalDropMarkdown === null) await unlink(beforeStatus.localDropSync.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.localDropSync.markdownPath, previousLocalDropMarkdown);
    if (previousManifest === null) await unlink(beforeStatus.launchEvidenceFixPack.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.launchEvidenceFixPack.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.launchEvidenceFixPack.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.launchEvidenceFixPack.markdownPath, previousMarkdown);
    if (previousCsv === null) await unlink(beforeStatus.launchEvidenceFixPack.csvPath).catch(() => undefined);
    else await writeFile(beforeStatus.launchEvidenceFixPack.csvPath, previousCsv);
    if (previousSuggestedImportCsv === null) await unlink(suggestedImportCsvPath).catch(() => undefined);
    else await writeFile(suggestedImportCsvPath, previousSuggestedImportCsv);
    if (previousWorkbook === null) await unlink(beforeStatus.externalEvidenceWorkbook.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.externalEvidenceWorkbook.manifestPath, previousWorkbook);
    if (previousWorkbookMarkdown === null) await unlink(beforeStatus.externalEvidenceWorkbook.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.externalEvidenceWorkbook.markdownPath, previousWorkbookMarkdown);
    if (previousWorkbookCsv === null) await unlink(beforeStatus.externalEvidenceWorkbook.csvPath).catch(() => undefined);
    else await writeFile(beforeStatus.externalEvidenceWorkbook.csvPath, previousWorkbookCsv);
    if (previousWorkbookImportCsv === null) await unlink(beforeStatus.externalEvidenceWorkbook.importCsvPath).catch(() => undefined);
    else await writeFile(beforeStatus.externalEvidenceWorkbook.importCsvPath, previousWorkbookImportCsv);
    if (previousPublicUrlStore === null) await unlink(publicUrlStorePath).catch(() => undefined);
    else await writeFile(publicUrlStorePath, previousPublicUrlStore);
    if (previousPublicBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = previousPublicBaseUrl;
    if (previousIgnoreStoredPublicBaseUrl === undefined) delete process.env.CLIPPERS_IGNORE_STORED_PUBLIC_BASE_URL;
    else process.env.CLIPPERS_IGNORE_STORED_PUBLIC_BASE_URL = previousIgnoreStoredPublicBaseUrl;
  }
});

test("prepareClipperDropzoneReadyPack writes safe intake board for missing go-live inputs", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.dropzoneReadyPack.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.dropzoneReadyPack.markdownPath, "utf8").catch(() => null);
  const previousCsv = await readFile(beforeStatus.dropzoneReadyPack.csvPath, "utf8").catch(() => null);
  const previousDiagnostic = await readFile(beforeStatus.launchEvidenceDropDiagnostic.manifestPath, "utf8").catch(() => null);
  const previousDiagnosticMarkdown = await readFile(beforeStatus.launchEvidenceDropDiagnostic.markdownPath, "utf8").catch(() => null);
  const previousRepairWorksheet = await readFile(beforeStatus.launchEvidenceDropDiagnostic.repairWorksheetCsvPath, "utf8").catch(() => null);
  const diagnosticDropPath = path.join(beforeStatus.rootDir, "evidence-drop", "launch-evidence-diagnostic.test.csv");
  const previousDiagnosticDrop = await readFile(diagnosticDropPath, "utf8").catch(() => null);

  try {
    await writeFile(diagnosticDropPath, [
      "kind,account_id,platform,status,scope,app_identifier,public_base_url,notes",
      "account,sports-daily,instagram,verified,,,,",
      "permission,,youtube,requested,https://www.googleapis.com/auth/youtube.upload,,,YouTube upload requested in portal without ticket or proof",
      "permission,,tiktok,requested,video.publish,,,TikTok Content Posting API requested with portal ticket TT-123 and proof screenshot path stored outside repo.",
    ].join("\n"));
    const { dropzoneReadyPack, status } = await prepareClipperDropzoneReadyPack();
    assert.ok(dropzoneReadyPack.manifestPath.endsWith("dropzone-ready-pack.json"));
    assert.ok(dropzoneReadyPack.markdownPath.endsWith("dropzone-ready-pack.md"));
    assert.ok(dropzoneReadyPack.csvPath.endsWith("dropzone-ready-pack.csv"));
    assert.equal(dropzoneReadyPack.items.length, 3);
    assert.ok(dropzoneReadyPack.items.some((item) => item.lane === "credentials"));
    assert.ok(dropzoneReadyPack.items.some((item) => item.lane === "launch_evidence"));
    assert.ok(dropzoneReadyPack.items.some((item) => item.lane === "source_videos"));
    assert.ok(dropzoneReadyPack.items.some((item) => item.lane === "launch_evidence" && item.expectedFiles.some((file) => file.endsWith("owner-connect-evidence.csv"))));
    const sourceDropzoneItem = dropzoneReadyPack.items.find((item) => item.lane === "source_videos");
    assert.ok(sourceDropzoneItem);
    assert.equal(sourceDropzoneItem.nextStep, status.sourceDropDiagnostic.nextStep);
    assert.equal(sourceDropzoneItem.sourceArtifactPath, status.sourceDropDiagnostic.repairWorksheetCsvPath);
    assert.ok(sourceDropzoneItem.blockers.some((blocker) => blocker.includes("source assets") || blocker.includes("source manifest rows") || blocker.includes("invalid/stub media")));
    assert.equal(sourceDropzoneItem.blockers.some((blocker) => blocker.includes("weekly source slots")), false);
    assert.ok(status.launchEvidenceDropDiagnostic.manifestPath.endsWith("launch-evidence-drop-diagnostic.json"));
    assert.ok(status.launchEvidenceDropDiagnostic.markdownPath.endsWith("launch-evidence-drop-diagnostic.md"));
    assert.ok(status.launchEvidenceDropDiagnostic.repairWorksheetCsvPath.endsWith("launch-evidence-drop-repair-worksheet.csv"));
    assert.ok(status.launchEvidenceDropDiagnostic.totals.pendingRows >= 1);
    assert.ok(status.launchEvidenceDropDiagnostic.rows.some((row) => row.sourceFile.endsWith("launch-evidence-diagnostic.test.csv") && row.status === "pending_values" && row.pendingFields.includes("notes")));
    assert.ok(status.launchEvidenceDropDiagnostic.rows.some((row) => row.sourceFile.endsWith("launch-evidence-diagnostic.test.csv") && row.status === "pending_values" && row.pendingFields.includes("notes_proof")));
    const launchEvidenceDropzoneItem = dropzoneReadyPack.items.find((item) => item.lane === "launch_evidence");
    assert.ok(launchEvidenceDropzoneItem);
    assert.equal(launchEvidenceDropzoneItem.nextStep, status.launchEvidenceDropDiagnostic.nextStep);
    assert.equal(launchEvidenceDropzoneItem.sourceArtifactPath, status.launchEvidenceDropDiagnostic.repairWorksheetCsvPath);
    assert.ok(launchEvidenceDropzoneItem.blockers.some((blocker) => blocker.includes("launch evidence rows")));
    assert.ok(dropzoneReadyPack.totals.dropDirs >= 3);
    assert.ok(dropzoneReadyPack.totals.expectedFiles > 0);
    assert.equal(status.dropzoneReadyPack.manifestPath, dropzoneReadyPack.manifestPath);

    const rawManifest = await readFile(dropzoneReadyPack.manifestPath, "utf8");
    const rawMarkdown = await readFile(dropzoneReadyPack.markdownPath, "utf8");
    const rawCsv = await readFile(dropzoneReadyPack.csvPath, "utf8");
    const rawDiagnosticMarkdown = await readFile(status.launchEvidenceDropDiagnostic.markdownPath, "utf8");
    const rawRepairWorksheet = await readFile(status.launchEvidenceDropDiagnostic.repairWorksheetCsvPath, "utf8");
    assert.ok(rawMarkdown.includes("Clippers Dropzone Ready Pack"));
    assert.ok(rawMarkdown.includes("Credential drop intake"));
    assert.ok(rawMarkdown.includes("Launch evidence drop intake"));
    assert.ok(rawMarkdown.includes("Rights-cleared source video drop intake"));
    assert.ok(rawCsv.includes("launch-evidence-drop-repair-worksheet.csv"));
    assert.ok(rawCsv.includes("source-drop-repair-worksheet.csv"));
    assert.ok(rawDiagnosticMarkdown.includes("Clippers Launch Evidence Drop Diagnostic"));
    assert.ok(rawDiagnosticMarkdown.includes("Pending rows"));
    assert.ok(rawDiagnosticMarkdown.includes("Repair worksheet"));
    assert.ok(rawRepairWorksheet.startsWith("source_file,row_index,kind,identifier,platform,scope,app_identifier,status,pending_fields"));
    assert.ok(rawRepairWorksheet.includes("notes_proof"));
    assert.ok(rawRepairWorksheet.includes("proof_needed"));
    assert.ok(rawRepairWorksheet.includes("portal_url"));
    assert.ok(rawRepairWorksheet.includes("suggested_evidence_row"));
    assert.ok(rawRepairWorksheet.includes("clippers_workspace/evidence-drop"));
    assert.equal(rawRepairWorksheet.includes(',permission,"""",'), false);
    assert.ok(rawCsv.includes("source_videos"));
    assert.equal(rawManifest.includes("access_token"), false);
    assert.equal(rawMarkdown.includes("client_secret="), false);
    assert.equal(rawCsv.includes("refresh_token="), false);
  } finally {
    if (previousManifest === null) await unlink(beforeStatus.dropzoneReadyPack.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.dropzoneReadyPack.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.dropzoneReadyPack.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.dropzoneReadyPack.markdownPath, previousMarkdown);
    if (previousCsv === null) await unlink(beforeStatus.dropzoneReadyPack.csvPath).catch(() => undefined);
    else await writeFile(beforeStatus.dropzoneReadyPack.csvPath, previousCsv);
    if (previousDiagnosticDrop === null) await unlink(diagnosticDropPath).catch(() => undefined);
    else await writeFile(diagnosticDropPath, previousDiagnosticDrop);
    if (previousDiagnostic === null) await unlink(beforeStatus.launchEvidenceDropDiagnostic.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.launchEvidenceDropDiagnostic.manifestPath, previousDiagnostic);
    if (previousDiagnosticMarkdown === null) await unlink(beforeStatus.launchEvidenceDropDiagnostic.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.launchEvidenceDropDiagnostic.markdownPath, previousDiagnosticMarkdown);
    if (previousRepairWorksheet === null) await unlink(beforeStatus.launchEvidenceDropDiagnostic.repairWorksheetCsvPath).catch(() => undefined);
    else await writeFile(beforeStatus.launchEvidenceDropDiagnostic.repairWorksheetCsvPath, previousRepairWorksheet);
  }
});

test("prepareClipperOwnerConnectPack writes one operator queue for external account connection", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.ownerConnectPack.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.ownerConnectPack.markdownPath, "utf8").catch(() => null);
  const previousCsv = await readFile(beforeStatus.ownerConnectPack.csvPath, "utf8").catch(() => null);
  const previousProgress = await readFile(beforeStatus.ownerConnectPack.progressRecordsPath, "utf8").catch(() => null);
  const ownerConnectEvidenceDropPath = path.join(beforeStatus.rootDir, "evidence-drop", "owner-connect-evidence.csv");
  const previousEvidenceDrop = await readFile(ownerConnectEvidenceDropPath, "utf8").catch(() => null);

  try {
    await unlink(ownerConnectEvidenceDropPath).catch(() => undefined);
    const { ownerConnectPack, status } = await prepareClipperOwnerConnectPack();
    assert.ok(ownerConnectPack.manifestPath.endsWith("owner-connect-pack.json"));
    assert.ok(ownerConnectPack.markdownPath.endsWith("owner-connect-pack.md"));
    assert.ok(ownerConnectPack.csvPath.endsWith("owner-connect-pack.csv"));
    assert.ok(ownerConnectPack.items.length >= status.externalExecutionSession.items.length);
    assert.ok(ownerConnectPack.items.some((item) => item.lane === "account"));
    assert.ok(ownerConnectPack.items.some((item) => item.lane === "developer_app"));
    assert.ok(ownerConnectPack.items.some((item) => item.lane === "permission"));
    assert.ok(ownerConnectPack.items.some((item) => item.lane === "credential"));
    assert.ok(ownerConnectPack.items.some((item) => item.lane === "source_video" || item.lane === "launch_evidence"));
    assert.ok(ownerConnectPack.totals.portalUrls > 0);
    assert.ok(ownerConnectPack.totals.evidenceRows > 0);
    assert.equal(status.ownerConnectPack.manifestPath, ownerConnectPack.manifestPath);
    assert.ok(status.ownerConnectPack.sourceArtifacts.permissionRequestPackPath.endsWith("permission-request-pack.md"));
    assert.equal(ownerConnectPack.sourceArtifacts.ownerConnectEvidenceDropPath, ownerConnectEvidenceDropPath);
    const rawEvidenceDrop = await readFile(ownerConnectEvidenceDropPath, "utf8");
    assert.ok(rawEvidenceDrop.startsWith("kind,account_id,platform,status,scope,app_identifier,public_base_url,notes"));
    assert.ok(rawEvidenceDrop.includes("\"account\"") || rawEvidenceDrop.includes("\"developer_app\"") || rawEvidenceDrop.includes("\"permission\""));
    assert.equal(rawEvidenceDrop.includes("client_secret"), false);

    const progressItem = ownerConnectPack.items.find((item) => item.status === "ready_to_execute") || ownerConnectPack.items[0];
    assert.ok(progressItem);
    const progressEvidenceRow = progressItem.evidenceRows[0] || "owner_connect_progress,system,manual,local tracker smoke row";
    const progressResult = await recordClipperOwnerConnectProgress({
      itemId: progressItem.id,
      status: "done",
      notes: "Created in portal; evidence still pending.",
      evidenceRows: [progressEvidenceRow],
    });
    const progressedItem = progressResult.ownerConnectPack.items.find((item) => item.id === progressItem.id);
    assert.equal(progressedItem?.progressStatus, "done");
    assert.equal(progressedItem?.progressNotes, "Created in portal; evidence still pending.");
    assert.ok(progressResult.ownerConnectPack.totals.progressRecords >= 1);
    assert.ok(progressResult.ownerConnectPack.totals.progressDone >= 1);
    assert.ok(progressResult.ownerConnectPack.progressRecordsPath.endsWith("owner-connect-progress.json"));

    const rawManifest = await readFile(progressResult.ownerConnectPack.manifestPath, "utf8");
    const rawMarkdown = await readFile(progressResult.ownerConnectPack.markdownPath, "utf8");
    const rawCsv = await readFile(progressResult.ownerConnectPack.csvPath, "utf8");
    const rawProgress = await readFile(progressResult.ownerConnectPack.progressRecordsPath, "utf8");
    assert.ok(rawMarkdown.includes("Clippers Owner Connect Pack"));
    assert.ok(rawMarkdown.includes("Execution Queue"));
    assert.ok(rawMarkdown.includes("Progress Records"));
    assert.ok(rawMarkdown.includes("Owner Connect Evidence Drop"));
    assert.ok(rawProgress.includes(progressItem.id));
    assert.ok(rawCsv.includes("ready_to_execute") || rawCsv.includes("blocked"));
    assert.equal(rawManifest.includes("access_token"), false);
    assert.equal(rawMarkdown.includes("client_secret"), false);
    assert.equal(rawCsv.includes("refresh_token"), false);
    assert.equal(rawProgress.includes("client_secret"), false);
  } finally {
    if (previousManifest === null) await unlink(beforeStatus.ownerConnectPack.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.ownerConnectPack.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.ownerConnectPack.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.ownerConnectPack.markdownPath, previousMarkdown);
    if (previousCsv === null) await unlink(beforeStatus.ownerConnectPack.csvPath).catch(() => undefined);
    else await writeFile(beforeStatus.ownerConnectPack.csvPath, previousCsv);
    if (previousProgress === null) await unlink(beforeStatus.ownerConnectPack.progressRecordsPath).catch(() => undefined);
    else await writeFile(beforeStatus.ownerConnectPack.progressRecordsPath, previousProgress);
    if (previousEvidenceDrop === null) await unlink(ownerConnectEvidenceDropPath).catch(() => undefined);
    else await writeFile(ownerConnectEvidenceDropPath, previousEvidenceDrop);
  }
});

test("prepareClipperRobertNextActions writes dynamic current-state action pack", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.robertNextActions.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.robertNextActions.markdownPath, "utf8").catch(() => null);
  const previousCsv = await readFile(beforeStatus.robertNextActions.csvPath, "utf8").catch(() => null);
  const connectNowPath = path.join(process.cwd(), "clippers_workspace", "ROBERT_CONNECT_NOW.md");
  const previousConnectNow = await readFile(connectNowPath, "utf8").catch(() => null);
  const externalPortalLauncherPath = path.join(process.cwd(), "clippers_workspace", "external-portal-launcher.html");
  const previousExternalPortalLauncher = await readFile(externalPortalLauncherPath, "utf8").catch(() => null);

  try {
    const { robertNextActions, status } = await prepareClipperRobertNextActions();
    const generatedDay = robertNextActions.generatedAt.slice(0, 10);
    assert.ok(robertNextActions.manifestPath.endsWith("ROBERT_NEXT_ACTIONS.json"));
    assert.ok(robertNextActions.markdownPath.endsWith("ROBERT_NEXT_ACTIONS.md"));
    assert.ok(robertNextActions.csvPath.endsWith("ROBERT_NEXT_ACTIONS.csv"));
    assert.ok(robertNextActions.connectNow.markdownPath.endsWith("ROBERT_CONNECT_NOW.md"));
    assert.equal(robertNextActions.externalCloseout.status, status.externalExecutionSession.closeoutRun.status);
    assert.equal(robertNextActions.externalCloseout.proofFilesNeedRealEvidence, status.externalExecutionSession.closeoutRun.totals.proofFilesNeedRealEvidence);
    assert.equal(robertNextActions.externalCloseout.operatorQueueItems, status.externalExecutionSession.closeoutRun.items.length);
    assert.equal(robertNextActions.externalCloseout.metricoolReadyToSend, 0);
    assert.ok(robertNextActions.externalCloseout.proofTodoPath.endsWith("clippers-external-closeout-proof-todo.md"));
    assert.ok(robertNextActions.externalCloseout.operatorQueuePath.endsWith("clippers-external-closeout-operator-queue.md"));
    assert.equal(status.externalExecutionSession.closeoutRun.nextItems[0]?.id, "developer_app:instagram");
    assert.equal(status.externalExecutionSession.closeoutRun.nextItems[0]?.requiredStatus, "submitted");
    assert.match(status.externalExecutionSession.closeoutRun.nextItems[0]?.evidenceCsvRow || "", /"developer_app","","instagram","submitted"/);
    assert.match(robertNextActions.externalCloseout.nextStep, /developer portal/);
    assert.equal(robertNextActions.nextStep, robertNextActions.externalCloseout.nextStep);
    assert.equal(robertNextActions.status, "blocked");
    assert.doesNotMatch(robertNextActions.nextStep, /Open Metricool/i);
    assert.notEqual(robertNextActions.items[0]?.id, "metricool-approval-session");
    assert.ok(robertNextActions.items[0]?.id.startsWith("external-closeout-"));
    assert.equal(robertNextActions.items[0]?.nextStep, robertNextActions.externalCloseout.nextStep);
    assert.equal(robertNextActions.items[0]?.priority, "critical");
    assert.equal(robertNextActions.items[0]?.lane, "external_portal");
    assert.match(robertNextActions.items[0]?.artifactPath || "", /clippers-external-closeout-operator-queue\.md|clippers-external-closeout-proof-todo\.md/);
    assert.ok(robertNextActions.items[0]?.evidenceRows.some((row) => row.includes("\"developer_app\",\"\",\"instagram\",\"submitted\"")));
    assert.equal(robertNextActions.connectNow.focusRun.status, status.externalExecutionSession.focusRun.status);
    assert.equal(robertNextActions.connectNow.focusRun.items.length, status.externalExecutionSession.focusRun.items.length);
    assert.ok(robertNextActions.connectNow.focusRun.label.length > 0);
    assert.ok(robertNextActions.connectNow.focusRun.items.length <= 7);
    assert.ok(robertNextActions.connectNow.focusRun.estimatedMinutes >= 0);
    assert.ok(robertNextActions.connectNow.pendingCredentialEnvVars.every((envVar) =>
      robertNextActions.connectNow.credentialTemplate.includes(`${envVar}=`)
    ));
    assert.ok(robertNextActions.connectNow.credentialTemplate.includes("TIKTOK_CLIENT_KEY="));
    assert.ok(robertNextActions.connectNow.credentialTemplate.includes("GOOGLE_DRIVE_REFRESH_TOKEN="));
    assert.ok(["ready_to_import", "needs_review", "move_candidates_to_drop_dir", "no_candidates"].includes(robertNextActions.connectNow.credentialCloseout.status));
    assert.ok(robertNextActions.connectNow.credentialCloseout.diagnosticPath.endsWith("credential-drop-diagnostic.md"));
    assert.equal(robertNextActions.connectNow.credentialCloseout.importReady, robertNextActions.connectNow.credentialCloseout.status === "ready_to_import" && robertNextActions.connectNow.credentialCloseout.acceptedEnvVars.length > 0);
    assert.ok(robertNextActions.connectNow.credentialCloseout.dropDirs.length >= 2);
    assert.ok(robertNextActions.connectNow.credentialCloseout.runtimeEnv.checkedEnvVars.includes("GOOGLE_CLIENT_ID"));
    assert.ok(robertNextActions.connectNow.credentialCloseout.runtimeEnv.checkedEnvVars.includes("GOOGLE_DRIVE_REFRESH_TOKEN"));
    assert.ok(robertNextActions.connectNow.credentialCloseout.runtimeEnv.missingEnvVars.every((envVar) =>
      robertNextActions.connectNow.credentialCloseout.runtimeEnv.checkedEnvVars.includes(envVar)
    ));
    assert.ok(robertNextActions.connectNow.credentialCloseout.runtimeEnv.configuredEnvVars.every((envVar) =>
      robertNextActions.connectNow.credentialCloseout.runtimeEnv.checkedEnvVars.includes(envVar)
    ));
    if (robertNextActions.connectNow.credentialCloseout.runtimeEnv.missingEnvVars.includes("GOOGLE_DRIVE_REFRESH_TOKEN")) {
      assert.ok(robertNextActions.connectNow.pendingCredentialEnvVars.includes("GOOGLE_DRIVE_REFRESH_TOKEN"));
      assert.ok(robertNextActions.connectNow.credentialCloseout.pendingEnvVars.includes("GOOGLE_DRIVE_REFRESH_TOKEN"));
    }
    assert.ok(robertNextActions.connectNow.credentialCloseout.totals.files >= 0);
    assert.ok(robertNextActions.connectNow.credentialCloseout.totals.pendingEnvVars >= robertNextActions.connectNow.credentialCloseout.pendingEnvVars.length);
    assert.ok(robertNextActions.connectNow.credentialCloseout.files.length <= 10);
    assert.ok(robertNextActions.connectNow.credentialCloseout.files.every((file) => file.relativePath && file.nextStep.length > 0));
    assert.ok(robertNextActions.connectNow.credentialCloseout.driveCredentialBridge.length > 0);
    assert.ok(robertNextActions.connectNow.credentialCloseout.driveCredentialBridge.some((item) =>
      item.driveSearchUrls.some((url) => url.startsWith("https://drive.google.com/drive/search?q="))
    ));
    assert.ok(robertNextActions.connectNow.credentialCloseout.driveCredentialBridge.some((item) =>
      item.localDropFileNames.some((fileName) => fileName.startsWith("credentials/") || fileName.startsWith("secrets/"))
    ));
    assert.ok(robertNextActions.connectNow.credentialCloseout.driveCredentialBridge.some((item) => item.missingSuggestedEnvVars.includes("GOOGLE_CLIENT_ID")));
    assert.equal(robertNextActions.connectNow.officialPermissionCloseout.status, status.officialPermissionMatrix.status);
    assert.ok(robertNextActions.connectNow.officialPermissionCloseout.matrixPath.endsWith("official-permission-matrix.md"));
    assert.ok(robertNextActions.connectNow.officialPermissionCloseout.csvPath.endsWith("official-permission-matrix.csv"));
    assert.equal(robertNextActions.connectNow.officialPermissionCloseout.totals.scopes, status.officialPermissionMatrix.totals.scopes);
    assert.equal(robertNextActions.connectNow.officialPermissionCloseout.totals.loginRequired, status.officialPermissionMatrix.totals.loginRequired);
    assert.ok(robertNextActions.connectNow.officialPermissionCloseout.sourceBatches.length === status.officialPermissionMatrix.sourceBatches.length);
    assert.ok(robertNextActions.connectNow.officialPermissionCloseout.sourceBatches.some((batch) => batch.platform === "instagram" && batch.accessMode === "login_required"));
    assert.ok(robertNextActions.connectNow.officialPermissionCloseout.sourceBatches.some((batch) => batch.platform === "tiktok" && batch.accessMode === "public"));
    assert.ok(robertNextActions.connectNow.officialPermissionCloseout.nextRows.length > 0);
    assert.ok(robertNextActions.connectNow.officialPermissionCloseout.approvalRows.length > 0);
    assert.ok(robertNextActions.connectNow.officialPermissionCloseout.webProofTrail.some((proof) => proof.platform === "youtube" && proof.officialUrls.some((url) => url.includes("developers.google.com"))));
    assert.equal(robertNextActions.connectNow.accountCloseout.status, status.ownerConnectPack.status);
    assert.ok(robertNextActions.connectNow.accountCloseout.markdownPath.endsWith("owner-connect-pack.md"));
    assert.ok(robertNextActions.connectNow.accountCloseout.csvPath.endsWith("owner-connect-pack.csv"));
    assert.ok(robertNextActions.connectNow.accountCloseout.evidenceDropPath.endsWith("owner-connect-evidence.csv"));
    assert.ok(robertNextActions.connectNow.accountCloseout.totals.items > 0);
    assert.ok(robertNextActions.connectNow.accountCloseout.totals.accounts > 0);
    assert.ok(robertNextActions.connectNow.accountCloseout.totals.developerApps > 0);
    assert.ok(robertNextActions.connectNow.accountCloseout.totals.permissions > 0);
    assert.ok(robertNextActions.connectNow.accountCloseout.portalUrls.length > 0);
    assert.ok(robertNextActions.connectNow.accountCloseout.evidenceRows.length > 0);
    assert.ok(robertNextActions.connectNow.accountCloseout.accountProofBridge.length > 0);
    assert.ok(robertNextActions.connectNow.accountCloseout.accountProofBridge.every((item) => item.evidenceRow.includes("\"account\"")));
    assert.ok(robertNextActions.connectNow.accountCloseout.accountProofBridge.some((item) => item.portalUrl?.startsWith("https://")));
    assert.ok(robertNextActions.connectNow.accountCloseout.accountProofBridge.every((item) => item.requiredProof.length >= 3));
    assert.ok(robertNextActions.connectNow.accountCloseout.appPermissionBridge.length > 0);
    assert.ok(robertNextActions.connectNow.accountCloseout.appPermissionBridge.some((item) => item.lane === "permission" && item.scopes.length > 0));
    assert.ok(robertNextActions.connectNow.accountCloseout.appPermissionBridge.some((item) => item.lane === "developer_app" || item.lane === "official_recheck"));
    assert.ok(robertNextActions.connectNow.accountCloseout.appPermissionBridge.every((item) => item.requiredProof.length >= 3));
    assert.ok(robertNextActions.connectNow.ownershipSplit.robertReady.length > 0);
    assert.ok(robertNextActions.connectNow.ownershipSplit.userRequired.length > 0);
    assert.ok(robertNextActions.connectNow.ownershipSplit.userRequired.some((item) => item.label.includes("accounts") || item.label.includes("permissions")));
    assert.ok(robertNextActions.connectNow.ownershipSplit.automationUnlockedBy.includes("OAuth tokens connected"));
    assert.ok(robertNextActions.connectNow.ownershipSplit.nextRobertAction.length > 0);
    assert.ok(robertNextActions.connectNow.ownershipSplit.nextUserAction.length > 0);
    assert.ok(["blocked", "needs_sources", "needs_connections", "ready"].includes(robertNextActions.connectNow.weeklyRunway.status));
    assert.ok(robertNextActions.connectNow.weeklyRunway.targetWeeklyClips >= 100);
    assert.ok(robertNextActions.connectNow.weeklyRunway.plannedDailyClips >= 15);
    assert.ok(robertNextActions.connectNow.weeklyRunway.configuredDailyClipTarget >= robertNextActions.connectNow.weeklyRunway.plannedDailyClips);
    assert.equal(robertNextActions.connectNow.weeklyRunway.categories.length, 3);
    assert.ok(robertNextActions.connectNow.weeklyRunway.categories.every((category) => category.sourceAssetGap >= 0 && category.nextStep.length > 0));
    assert.ok(robertNextActions.connectNow.weeklyRunway.weeklyMissingSlots >= 0);
    assert.ok(robertNextActions.connectNow.weeklyRunway.sourceAssetGap >= 0);
    assert.equal(robertNextActions.connectNow.platformLaunchBridge.length, 3);
    assert.deepEqual(
      robertNextActions.connectNow.platformLaunchBridge.map((item) => item.platform).sort(),
      ["instagram", "tiktok", "youtube"],
    );
    assert.ok(robertNextActions.connectNow.platformLaunchBridge.every((item) => item.handles.length > 0));
    assert.ok(robertNextActions.connectNow.platformLaunchBridge.every((item) => item.scopes.length > 0));
    assert.ok(robertNextActions.connectNow.platformLaunchBridge.every((item) => item.portalUrls.length >= 2));
    assert.ok(robertNextActions.connectNow.platformLaunchBridge.some((item) =>
      item.platform === "tiktok" &&
      (item.missingEnvVars.includes("TIKTOK_CLIENT_KEY") || item.missingEnvVars.length === 0)
    ));
    assert.ok(robertNextActions.connectNow.platformLaunchBridge.some((item) => item.platform === "instagram" && item.scopes.includes("instagram_content_publish")));
    assert.ok(robertNextActions.connectNow.platformLaunchBridge.some((item) => item.platform === "youtube" && item.scopes.includes("https://www.googleapis.com/auth/youtube.upload")));
    assert.ok(robertNextActions.connectNow.externalPortalLauncher.htmlPath.endsWith("external-portal-launcher.html"));
    assert.equal(robertNextActions.connectNow.externalPortalLauncher.url, "/clippers/external-portal-launcher");
    assert.ok(status.accountCreationPack.generatedAt && status.accountCreationPack.generatedAt >= generatedDay);
    assert.ok(status.accountSetupSession.generatedAt && status.accountSetupSession.generatedAt >= generatedDay);
    assert.ok(status.permissionSubmissionDossier.generatedAt && status.permissionSubmissionDossier.generatedAt >= generatedDay);
    assert.ok(status.externalExecutionSession.generatedAt && status.externalExecutionSession.generatedAt >= generatedDay);
    const clippersAgentSource = await readFile(path.join(process.cwd(), "server", "clippers-agent.ts"), "utf8");
    assert.ok(clippersAgentSource.includes("detached: true"));
    assert.ok(clippersAgentSource.includes("process.kill(-child.pid"));
    const externalCloseoutPack = JSON.parse(await readFile(path.join(process.cwd(), "clippers_workspace", "reports", "clippers-external-closeout-pack.json"), "utf8"));
    const externalCloseoutProofTodo = JSON.parse(await readFile(path.join(process.cwd(), "clippers_workspace", "reports", "clippers-external-closeout-proof-todo.json"), "utf8"));
    assert.ok(externalCloseoutPack.generatedAt && externalCloseoutPack.generatedAt >= generatedDay);
    assert.ok(externalCloseoutProofTodo.generatedAt && externalCloseoutProofTodo.generatedAt >= generatedDay);
    assert.equal(externalCloseoutPack.metricool.readyToSend, 0);
    assert.ok(robertNextActions.connectNow.externalPortalLauncher.totalPortals >= 3);
    assert.equal(robertNextActions.connectNow.externalPortalLauncher.doNow, status.externalExecutionSession.totals.doNow);
    assert.equal(robertNextActions.connectNow.externalPortalLauncher.blocked, status.externalExecutionSession.totals.blocked);
    assert.ok(robertNextActions.connectNow.externalPortalLauncher.accountTasks > 0);
    assert.ok(robertNextActions.connectNow.externalPortalLauncher.developerAppTasks > 0);
    assert.ok(robertNextActions.connectNow.externalPortalLauncher.permissionTasks > 0);
    assert.ok(robertNextActions.connectNow.externalPortalLauncher.credentialTasks > 0);
    assert.equal(robertNextActions.connectNow.externalPortalLauncher.closeoutRows, status.externalExecutionSession.closeoutRun.totals.rows);
    assert.equal(robertNextActions.connectNow.externalPortalLauncher.closeoutProofsNeeded, status.externalExecutionSession.closeoutRun.totals.proofFilesNeedRealEvidence);
    assert.equal(robertNextActions.connectNow.externalPortalLauncher.closeoutMetricoolReadyToSend, 0);
    assert.equal(robertNextActions.connectNow.externalPortalLauncher.closeoutArtifactSafety, status.externalExecutionSession.closeoutRun.artifactSafetyStatus);
    assert.equal(robertNextActions.connectNow.intakeConsole.status, status.dropzoneReadyPack.status);
    assert.equal(robertNextActions.connectNow.intakeConsole.totals.lanes, status.dropzoneReadyPack.items.length);
    assert.ok(robertNextActions.connectNow.intakeConsole.totals.blockers >= 0);
    assert.ok(robertNextActions.connectNow.intakeConsole.refreshSequence.includes("Run Activation Sweep"));
    assert.deepEqual(
      robertNextActions.connectNow.intakeConsole.lanes.map((lane) => lane.id).sort(),
      status.dropzoneReadyPack.items.map((item) => item.id).sort(),
    );
    assert.ok(robertNextActions.connectNow.intakeConsole.lanes.some((lane) =>
      lane.id === "credentials" &&
      lane.actionUrl === "/api/clippers/import-credential-drop-files" &&
      lane.dropDirs.some((dir) => dir.includes("credentials"))
    ));
    assert.ok(robertNextActions.connectNow.intakeConsole.lanes.some((lane) =>
      lane.id === "source_videos" &&
      lane.expectedFilesCount >= 0 &&
      lane.acceptedFormats.includes("mp4")
    ));
    assert.equal(robertNextActions.connectNow.postConnectActivationBridge.length, beforeStatus.accounts.reduce((sum, account) => sum + account.platformAccounts.length, 0));
    assert.ok(robertNextActions.connectNow.postConnectActivationBridge.every((lane) =>
      ["blocked", "waiting", "activation_ready", "ready"].includes(lane.status) &&
      lane.activationScore >= 0 &&
      lane.activationScore <= 100 &&
      lane.permissionsTotal > 0 &&
      lane.nextLocalActions.length > 0 &&
      lane.nextStep.length > 0
    ));
    assert.ok(robertNextActions.connectNow.postConnectActivationBridge.some((lane) => lane.platform === "tiktok" && lane.handle === "@sportsdaily"));
    assert.ok(robertNextActions.connectNow.postConnectActivationBridge.some((lane) => lane.blockers.length > 0));
    assert.ok(robertNextActions.connectNow.accountCloseout.nextItems.length <= 12);
    assert.ok(robertNextActions.connectNow.accountCloseout.nextItems.some((item) => item.lane === "account"));
    assert.ok(robertNextActions.connectNow.accountCloseout.nextItems.some((item) => item.lane === "developer_app" || item.lane === "permission"));
    assert.ok(robertNextActions.connectNow.evidenceTemplatePath.endsWith("owner-connect-evidence.fixpack.csv"));
    assert.ok(robertNextActions.connectNow.evidenceImportPath.endsWith("owner-connect-evidence.csv"));
    assert.ok(robertNextActions.connectNow.evidenceCloseout.total >= 0);
    assert.ok(robertNextActions.connectNow.evidenceCloseout.fixpackPath.endsWith("owner-connect-evidence.fixpack.csv"));
    assert.ok(robertNextActions.connectNow.evidenceCloseout.importTarget.endsWith("owner-connect-evidence.csv"));
    assert.ok(robertNextActions.connectNow.evidenceCloseout.byCategory.currentStateGaps >= 0);
    assert.ok(robertNextActions.connectNow.evidenceCloseout.byCategory.rejectedRows >= 0);
    if (robertNextActions.connectNow.evidenceCloseout.total > 0) {
      assert.ok(robertNextActions.connectNow.evidenceCloseout.nextRows.length > 0);
      assert.ok(robertNextActions.connectNow.evidenceCloseout.nextItems.length > 0);
      assert.ok(robertNextActions.connectNow.evidenceCloseout.importBridge.length > 0);
      assert.ok(robertNextActions.connectNow.evidenceCloseout.nextItems.every((item) => item.requiredFix.length > 0));
      assert.ok(robertNextActions.connectNow.evidenceCloseout.importBridge.every((batch) =>
        batch.count > 0 &&
        batch.rows.length === batch.count &&
        batch.requiredFixes.length > 0 &&
        batch.importTarget.endsWith("owner-connect-evidence.csv") &&
        batch.nextStep.includes("Launch Evidence Batch")
      ));
    }
    assert.equal(robertNextActions.connectNow.sourceCloseout.status, status.sourceSupplyDropKit.status);
    assert.equal(robertNextActions.connectNow.sourceCloseout.total, status.sourceSupplyDropKit.totals.items);
    assert.ok(robertNextActions.connectNow.sourceCloseout.markdownPath.endsWith("source-supply-drop-kit.md"));
    assert.ok(robertNextActions.connectNow.sourceCloseout.csvPath.endsWith("source-supply-drop-kit.csv"));
    assert.ok(robertNextActions.connectNow.sourceCloseout.sourceDropDir.endsWith("source-drop"));
    assert.ok(robertNextActions.connectNow.sourceCloseout.nextRows.length <= 10);
    assert.ok(robertNextActions.connectNow.sourceCloseout.rightsRows.length <= 10);
    assert.ok(robertNextActions.connectNow.sourceCloseout.trendRows.length <= 10);
    assert.equal(robertNextActions.connectNow.sourceCloseout.batches.length, status.sourceSupplyDropKit.categoryBatches.length);
    assert.deepEqual(
      robertNextActions.connectNow.sourceCloseout.batches.map((batch) => batch.category).sort(),
      status.sourceSupplyDropKit.categoryBatches.map((batch) => batch.category).sort(),
    );
    if (robertNextActions.connectNow.sourceCloseout.total > 0) {
      assert.ok(robertNextActions.connectNow.sourceCloseout.nextRows.some((row) => row.includes("owned_or_permissioned")));
      assert.ok(robertNextActions.connectNow.sourceCloseout.rightsRows.some((row) => row.includes("source_rights")));
      assert.ok(robertNextActions.connectNow.sourceCloseout.trendRows.some((row) => row.includes("approved_after_proof")));
      assert.ok(robertNextActions.connectNow.sourceCloseout.nextItems.every((item) => item.targetFileName.endsWith(".mp4")));
    }
    assert.equal(robertNextActions.connectNow.connectionTunnel.gates.length, 8);
    assert.deepEqual(
      robertNextActions.connectNow.connectionTunnel.gates.map((gate) => gate.id),
      ["credentials", "accounts", "developer_apps", "permissions", "oauth", "evidence", "sources", "publish"],
    );
    assert.ok(["blocked", "ready_to_execute", "waiting", "done"].includes(robertNextActions.connectNow.connectionTunnel.status));
    assert.ok(robertNextActions.connectNow.connectionTunnel.progress >= 0);
    assert.ok(robertNextActions.connectNow.connectionTunnel.progress <= 100);
    assert.ok(robertNextActions.connectNow.connectionTunnel.gates.every((gate) => gate.total >= 1));
    assert.ok(robertNextActions.connectNow.connectionTunnel.gates.every((gate) => gate.unlocks.length > 0));
    assert.ok(robertNextActions.connectNow.connectionTunnel.nextGate);
    assert.equal(robertNextActions.connectNow.connectionTunnel.nextStep, robertNextActions.connectNow.connectionTunnel.nextGate.nextStep);
    assert.ok(robertNextActions.connectNow.launchEvidenceTemplate.startsWith("kind,account_id,platform,status,scope,app_identifier,public_base_url,notes"));
    assert.ok(robertNextActions.connectNow.sourceIntakeTemplate.startsWith("category,title,url,source,platform,target_file_name,rights_status,evidence_link,priority,notes"));
    const configuredHandles = beforeStatus.accounts.flatMap((account) => account.platformAccounts.map((platformAccount) => platformAccount.handle));
    assert.ok(configuredHandles.length > 0);
    assert.deepEqual(
      robertNextActions.connectNow.accountHandles.map((item) => item.handle).sort(),
      configuredHandles.sort(),
    );
    assert.ok(robertNextActions.items.length > 0);
    assert.ok(robertNextActions.totals.actions >= robertNextActions.items.length);
    assert.ok(robertNextActions.totals.estimatedMinutes > 0);
    assert.ok(robertNextActions.items.some((item) => item.lane === "local_drop" || item.lane === "external_portal" || item.lane === "source_supply"));
    if (status.metricoolApprovalSession.status === "ready_for_operator") {
      const metricoolAction = robertNextActions.items.find((item) => item.id === "metricool-approval-session");
      assert.ok(metricoolAction);
      const externalCloseoutPending = robertNextActions.externalCloseout.operatorQueueItems > 0
        || robertNextActions.externalCloseout.proofFilesNeedRealEvidence > 0;
      if (externalCloseoutPending) {
        assert.ok(metricoolAction.rank > 1);
        assert.equal(metricoolAction.priority, "high");
        assert.equal(robertNextActions.nextStep, robertNextActions.externalCloseout.nextStep);
      } else {
        assert.equal(metricoolAction.rank, 1);
        assert.equal(metricoolAction.priority, "critical");
        assert.equal(robertNextActions.nextStep, metricoolAction.nextStep);
      }
      assert.equal(metricoolAction.status, "ready_to_execute");
      assert.equal(metricoolAction.actionUrl, "/api/clippers/prepare-metricool-approval-session");
      assert.equal(metricoolAction.portalUrl, "https://app.metricool.com/");
      assert.ok(metricoolAction.artifactPath?.endsWith("metricool-approval-session.md"));
      assert.ok(metricoolAction.evidenceRows.length > 0);
      assert.ok(metricoolAction.operatorSteps.some((step) => step.includes("ready_for_review")));
      assert.ok(metricoolAction.blockers.some((blocker) => blocker.includes("does not enable full direct autopublish")));
    }
    assert.ok(robertNextActions.items.some((item) => item.artifactPath?.endsWith("credential-doctor-repair-worksheet.csv")));
    const hasLaunchEvidenceAction = robertNextActions.items.some((item) =>
      item.artifactPath?.endsWith("launch-evidence-drop-repair-worksheet.csv") ||
      item.artifactPath?.endsWith("go-live-evidence-bundle.md")
    );
    assert.ok(hasLaunchEvidenceAction || status.launchEvidenceFixPack.totals.items === 0);
    assert.ok(robertNextActions.items.some((item) => item.artifactPath?.endsWith("source-drop-repair-worksheet.csv")));
    assert.ok(robertNextActions.items.every((item) => item.operatorSteps.length > 0));
    assert.equal(status.robertNextActions.manifestPath, robertNextActions.manifestPath);
    assert.equal(status.robertNextActions.markdownPath, robertNextActions.markdownPath);

    const rawManifest = await readFile(robertNextActions.manifestPath, "utf8");
    const rawMarkdown = await readFile(robertNextActions.markdownPath, "utf8");
    const rawCsv = await readFile(robertNextActions.csvPath, "utf8");
    const rawConnectNow = await readFile(robertNextActions.connectNow.markdownPath, "utf8");
    const rawPortalLauncher = await readFile(robertNextActions.connectNow.externalPortalLauncher.htmlPath, "utf8");
    assert.ok(rawMarkdown.includes("Clippers - Robert Next Actions"));
    assert.doesNotMatch(rawMarkdown, /^Status: ready$/m);
    assert.ok(rawMarkdown.includes("Connect Now Handoff"));
    assert.ok(rawMarkdown.includes("Credential closeout"));
    assert.ok(rawMarkdown.includes("Account closeout"));
    assert.ok(rawMarkdown.includes("Official permission closeout"));
    assert.ok(rawMarkdown.includes("Evidence closeout"));
    assert.ok(rawMarkdown.includes("Source closeout"));
    assert.ok(rawMarkdown.includes("Connection tunnel"));
    assert.ok(rawMarkdown.includes("Intake console"));
    assert.ok(rawMarkdown.includes("Priority Actions"));
    assert.ok(rawMarkdown.includes("Operator steps"));
    if (status.metricoolApprovalSession.status === "ready_for_operator") {
      assert.ok(rawMarkdown.includes("Review Metricool approval session"));
      assert.ok(rawCsv.includes("metricool-approval-session"));
      assert.ok(rawCsv.includes("metricool-approval-session.md"));
    }
    assert.ok(rawConnectNow.includes("Clippers: conectar cuentas y desbloquear go-live"));
    assert.ok(rawConnectNow.includes("Connection Tunnel"));
    assert.ok(rawConnectNow.includes("Credentials"));
    assert.ok(rawConnectNow.includes("Publish"));
    assert.ok(rawConnectNow.includes("Credential Closeout"));
    assert.ok(rawConnectNow.includes("Drive credential bridge"));
    assert.ok(rawConnectNow.includes("Official Permission Closeout"));
    assert.ok(rawConnectNow.includes("Meta"));
    assert.ok(rawConnectNow.includes("Account/App/Permission Closeout"));
    assert.ok(rawConnectNow.includes("Account proof bridge"));
    assert.ok(rawConnectNow.includes("App/permission bridge"));
    assert.ok(rawConnectNow.includes("Ownership Split"));
    assert.ok(rawConnectNow.includes("Robert-ready local actions"));
    assert.ok(rawConnectNow.includes("User-required external actions"));
    assert.ok(rawConnectNow.includes("Weekly Clip Runway"));
    assert.ok(rawConnectNow.includes("Target weekly clips"));
    assert.ok(rawConnectNow.includes("Platform Launch Bridge"));
    assert.ok(rawConnectNow.includes("TikTok"));
    assert.ok(rawConnectNow.includes("Instagram Reels"));
    assert.ok(rawConnectNow.includes("YouTube Shorts"));
    assert.ok(rawConnectNow.includes("External Portal Launcher"));
    assert.ok(rawConnectNow.includes("Go-Live Intake Console"));
    assert.ok(rawConnectNow.includes("Refresh sequence"));
    assert.ok(rawConnectNow.includes("Post-Connect Activation Bridge"));
    assert.ok(rawConnectNow.includes("Focus Run"));
    assert.ok(rawConnectNow.includes("External closeout rows"));
    assert.ok(rawConnectNow.includes("External closeout Metricool ready_to_send"));
    assert.ok(rawConnectNow.includes("Evidence Closeout"));
    assert.ok(rawConnectNow.includes("Evidence import bridge"));
    assert.ok(rawConnectNow.includes("Source Closeout"));
    assert.ok(configuredHandles.some((handle) => rawConnectNow.includes(handle)));
    assert.ok(rawConnectNow.includes("owner-connect-evidence.fixpack.csv"));
    assert.ok(rawConnectNow.includes("Local Drop Sync lo ignora"));
    assert.ok(rawCsv.includes("estimated_minutes"));
    assert.ok(rawCsv.includes("operator_steps"));
    assert.ok(rawCsv.includes("credential-doctor-repair-worksheet.csv"));
    assert.ok(rawCsv.includes("launch-evidence-drop-repair-worksheet.csv") || rawCsv.includes("go-live-evidence-bundle.md"));
    assert.ok(rawCsv.includes("source-drop-repair-worksheet.csv"));
    assert.equal(rawManifest.includes("access_token"), false);
    assert.equal(robertNextActions.connectNow.credentialTemplate.includes("client_secret="), false);
    assert.equal(JSON.stringify(robertNextActions.connectNow.credentialCloseout).includes("client_secret="), false);
    assert.equal(JSON.stringify(robertNextActions.connectNow.credentialCloseout).includes("refresh_token="), false);
    assert.equal(JSON.stringify(robertNextActions.connectNow.accountCloseout).includes("client_secret="), false);
    assert.equal(JSON.stringify(robertNextActions.connectNow.accountCloseout).includes("refresh_token="), false);
    assert.equal(JSON.stringify(robertNextActions.connectNow.sourceCloseout).includes("refresh_token="), false);
    assert.equal(robertNextActions.connectNow.launchEvidenceTemplate.includes("access_token"), false);
    assert.equal(robertNextActions.connectNow.sourceIntakeTemplate.includes("refresh_token"), false);
    assert.equal(JSON.stringify(robertNextActions.connectNow.focusRun).includes("access_token"), false);
    assert.ok(rawPortalLauncher.includes("Clippers External Portal Launcher"));
    assert.ok(rawPortalLauncher.includes("Closeout Evidence Run"));
    assert.ok(rawPortalLauncher.includes("Copy next closeout starter rows"));
    assert.ok(rawPortalLauncher.includes("External Closeout Evidence Import Gate"));
    assert.ok(rawPortalLauncher.includes("External Closeout Proof Todo"));
    assert.ok(rawPortalLauncher.includes("clippers_workspace/reports/clippers-external-closeout-proof-todo.md"));
    assert.ok(rawPortalLauncher.includes("/api/clippers/external-closeout-proof-todo"));
    assert.ok(rawPortalLauncher.includes("loadExternalCloseoutProofTodo"));
    assert.ok(rawPortalLauncher.includes("clippers_workspace/evidence-drop/external-closeout-evidence-import.csv"));
    assert.ok(rawPortalLauncher.includes("/api/clippers/preview-external-closeout-evidence-import"));
    assert.ok(rawPortalLauncher.includes("/api/clippers/apply-external-closeout-evidence-import"));
    assert.ok(rawPortalLauncher.includes("x-clippers-operator-confirm"));
    assert.ok(rawPortalLauncher.includes("Apply clean import"));
    assert.ok(rawPortalLauncher.includes("Account Creation Launcher"));
    assert.ok(rawPortalLauncher.includes("Credential Collection Launcher"));
    assert.ok(rawPortalLauncher.includes("Permission Request Launcher"));
    assert.ok(rawPortalLauncher.includes("Viral Source Hunt Launcher"));
    assert.ok(rawPortalLauncher.includes("Go-Live Intake Console"));
    assert.ok(rawPortalLauncher.includes("Import credential drop files"));
    assert.ok(rawPortalLauncher.includes("Run Activation Sweep"));
    assert.ok(rawPortalLauncher.includes("Launch Evidence Batch"));
    assert.ok(rawPortalLauncher.includes("Source Intake Batch"));
    assert.ok(rawPortalLauncher.includes("Rights Evidence Batch"));
    assert.ok(rawPortalLauncher.includes("source-drop"));
    assert.ok(rawPortalLauncher.includes("GOOGLE_CLIENT_ID"));
    assert.ok(rawPortalLauncher.includes("TIKTOK_CLIENT_KEY"));
    assert.ok(rawPortalLauncher.includes("META_APP_ID"));
    assert.ok(rawPortalLauncher.includes("@sportsdaily"));
    assert.ok(rawPortalLauncher.includes("@memeradar"));
    assert.ok(rawPortalLauncher.includes("@streamerpulse"));
    assert.ok(rawPortalLauncher.includes("Account proof row"));
    assert.ok(rawPortalLauncher.includes("developers.tiktok.com"));
    assert.ok(rawPortalLauncher.includes("developers.facebook.com"));
    assert.ok(rawPortalLauncher.includes("developers.google.com"));
    assert.ok(rawPortalLauncher.includes("target=\"_blank\""));
    assert.equal(rawPortalLauncher.includes("access_token"), false);
    assert.equal(rawPortalLauncher.includes("client_secret="), false);
    assert.equal(rawPortalLauncher.includes("refresh_token="), false);
    assert.equal(rawMarkdown.includes("client_secret="), false);
    assert.equal(rawCsv.includes("refresh_token="), false);
    assert.equal(rawConnectNow.includes("access_token"), false);
    assert.equal(rawConnectNow.includes("client_secret="), false);
    assert.equal(rawConnectNow.includes("refresh_token="), false);
  } finally {
    if (previousManifest === null) await unlink(beforeStatus.robertNextActions.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.robertNextActions.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.robertNextActions.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.robertNextActions.markdownPath, previousMarkdown);
    if (previousCsv === null) await unlink(beforeStatus.robertNextActions.csvPath).catch(() => undefined);
    else await writeFile(beforeStatus.robertNextActions.csvPath, previousCsv);
    if (previousConnectNow === null) await unlink(connectNowPath).catch(() => undefined);
    else await writeFile(connectNowPath, previousConnectNow);
    if (previousExternalPortalLauncher === null) await unlink(externalPortalLauncherPath).catch(() => undefined);
    else await writeFile(externalPortalLauncherPath, previousExternalPortalLauncher);
  }
});

test("runClipperExternalConnectAutopilot is visible from cached status", async () => {
  const beforeStatus = await getClipperStatus();
  const manifestPath = path.join(beforeStatus.rootDir, "external-connect-autopilot.json");
  const markdownPath = path.join(beforeStatus.rootDir, "external-connect-autopilot.md");
  const previousManifest = await readFile(manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(markdownPath, "utf8").catch(() => null);

  try {
    const { externalConnectAutopilot, status } = await runClipperExternalConnectAutopilot();
    assert.equal(status, null);
    assert.ok(externalConnectAutopilot.manifestPath.endsWith("external-connect-autopilot.json"));
    assert.ok(externalConnectAutopilot.markdownPath.endsWith("external-connect-autopilot.md"));
    assert.ok(externalConnectAutopilot.steps.length > 0);
    assert.equal(externalConnectAutopilot.totals.steps, externalConnectAutopilot.steps.length);
    assert.ok(externalConnectAutopilot.totals.blocked + externalConnectAutopilot.totals.completed + externalConnectAutopilot.totals.failed === externalConnectAutopilot.totals.steps);
    assert.equal(JSON.stringify(externalConnectAutopilot).includes("access_token"), false);
    assert.equal(JSON.stringify(externalConnectAutopilot).includes("client_secret="), false);

    const cachedStatus = await getClipperStatus();
    assert.ok(cachedStatus.externalConnectAutopilot);
    assert.equal(cachedStatus.externalConnectAutopilot.manifestPath, externalConnectAutopilot.manifestPath);
    assert.equal(cachedStatus.externalConnectAutopilot.markdownPath, externalConnectAutopilot.markdownPath);
    assert.equal(cachedStatus.externalConnectAutopilot.generatedAt, externalConnectAutopilot.generatedAt);
    assert.equal(cachedStatus.externalConnectAutopilot.totals.steps, externalConnectAutopilot.totals.steps);
    assert.equal(cachedStatus.externalConnectAutopilot.steps.length, externalConnectAutopilot.steps.length);

    const rawMarkdown = await readFile(externalConnectAutopilot.markdownPath, "utf8");
    assert.ok(rawMarkdown.includes("Clippers External Connect Autopilot"));
    assert.ok(rawMarkdown.includes("Source files needed"));
    assert.equal(rawMarkdown.includes("access_token"), false);
    assert.equal(rawMarkdown.includes("client_secret="), false);
  } finally {
    if (previousManifest === null) await unlink(manifestPath).catch(() => undefined);
    else await writeFile(manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(markdownPath).catch(() => undefined);
    else await writeFile(markdownPath, previousMarkdown);
  }
});

test("runClipperGoLivePrepSweep refreshes all local go-live packs conservatively", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.goLivePrepSweep.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.goLivePrepSweep.markdownPath, "utf8").catch(() => null);

  try {
    const { goLivePrepSweep, localDropSync, status } = await runClipperGoLivePrepSweep();
    assert.ok(goLivePrepSweep.manifestPath.endsWith("go-live-prep-sweep.json"));
    assert.ok(goLivePrepSweep.markdownPath.endsWith("go-live-prep-sweep.md"));
    assert.ok(goLivePrepSweep.items.length >= 8);
    assert.ok(goLivePrepSweep.items.some((item) => item.id === "bootstrap"));
    assert.ok(goLivePrepSweep.items.some((item) => item.id === "local_drop_sync"));
    assert.ok(goLivePrepSweep.items.some((item) => item.id === "go_live_refresh"));
    assert.ok(goLivePrepSweep.items.some((item) => item.id === "go_live_refresh" && item.message.includes("account setup session")));
    assert.ok(goLivePrepSweep.items.some((item) => item.id === "go_live_refresh" && item.message.includes("permission dossier")));
    assert.ok(goLivePrepSweep.items.some((item) => item.id === "go_live_refresh" && item.message.includes("Robert next actions")));
    assert.ok(goLivePrepSweep.items.some((item) => item.id === "sources_publish" && item.message.includes("publisher execution queue")));
    assert.ok(goLivePrepSweep.totals.completed >= 1);
    assert.ok(localDropSync);
    assert.equal(status.goLivePrepSweep.manifestPath, goLivePrepSweep.manifestPath);
    assert.equal(status.goLivePrepSweep.markdownPath, goLivePrepSweep.markdownPath);
    assert.ok(status.goLivePrepSweep.localDropSync);
    assert.ok(status.accountSetupSession.markdownPath.endsWith("account-setup-session.md"));
    assert.ok(status.permissionSubmissionDossier.markdownPath.endsWith("permission-submission-dossier.md"));
    assert.ok(status.robertNextActions.markdownPath.endsWith("ROBERT_NEXT_ACTIONS.md"));

    const rawManifest = await readFile(goLivePrepSweep.manifestPath, "utf8");
    const rawMarkdown = await readFile(goLivePrepSweep.markdownPath, "utf8");
    assert.ok(rawMarkdown.includes("Clippers Go-Live Prep Sweep"));
    assert.ok(rawMarkdown.includes("Local Drop Sync"));
    assert.ok(rawManifest.includes("go_live_refresh"));
    assert.ok(rawManifest.includes("account setup session"));
    assert.ok(rawManifest.includes("permission dossier"));
    assert.ok(rawManifest.includes("Robert next actions"));
    assert.ok(rawManifest.includes("publisher execution queue"));
    assert.ok(rawManifest.includes("local_drop_sync"));
    assert.equal(rawManifest.includes("access_token"), false);
    assert.equal(rawMarkdown.includes("client_secret"), false);
  } finally {
    if (previousManifest === null) await unlink(beforeStatus.goLivePrepSweep.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.goLivePrepSweep.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.goLivePrepSweep.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.goLivePrepSweep.markdownPath, previousMarkdown);
  }
});

test("runClipperPostConnectActivationSweep refreshes post-connect readiness safely", async () => {
  const postConnectManifestPath = path.join(process.cwd(), "clippers_workspace", "post-connect-activation-sweep.json");
  const postConnectMarkdownPath = path.join(process.cwd(), "clippers_workspace", "post-connect-activation-sweep.md");
  const previousManifest = await readFile(postConnectManifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(postConnectMarkdownPath, "utf8").catch(() => null);

  try {
    const { postConnectActivationSweep, goLivePrepSweep, localDropSync, robertNextActions, status } = await runClipperPostConnectActivationSweep();
    assert.ok(postConnectActivationSweep.manifestPath.endsWith("post-connect-activation-sweep.json"));
    assert.ok(postConnectActivationSweep.markdownPath.endsWith("post-connect-activation-sweep.md"));
    assert.equal(postConnectActivationSweep.prepSweepStatus, goLivePrepSweep.status);
    assert.equal(postConnectActivationSweep.localDropSyncStatus, localDropSync?.status || "not_run");
    assert.equal(postConnectActivationSweep.totalLanes, robertNextActions.connectNow.postConnectActivationBridge.length);
    assert.equal(postConnectActivationSweep.blockedLanes, robertNextActions.connectNow.postConnectActivationBridge.filter((lane) => lane.status === "blocked").length);
    assert.equal(postConnectActivationSweep.readyToPublish, status.goLiveCompletionAudit.readyToPublish);
    assert.ok(["ready", "needs_external_action", "needs_local_input", "blocked"].includes(postConnectActivationSweep.status));
    assert.ok(postConnectActivationSweep.artifactPaths.launcher.endsWith("external-portal-launcher.html"));
    assert.equal(postConnectActivationSweep.launcherUrl, "/clippers/external-portal-launcher");
    assert.ok(postConnectActivationSweep.artifactPaths.connectNow.endsWith("ROBERT_CONNECT_NOW.md"));
    assert.ok(postConnectActivationSweep.nextStep.length > 0);

    const rawManifest = await readFile(postConnectActivationSweep.manifestPath, "utf8");
    const rawMarkdown = await readFile(postConnectActivationSweep.markdownPath, "utf8");
    assert.ok(rawMarkdown.includes("Clippers Post-Connect Activation Sweep"));
    assert.ok(rawMarkdown.includes("Activation Lanes"));
    assert.ok(rawMarkdown.includes("Launcher URL"));
    assert.equal(rawManifest.includes("access_token"), false);
    assert.equal(rawManifest.includes("client_secret="), false);
    assert.equal(rawManifest.includes("refresh_token="), false);
    assert.equal(rawMarkdown.includes("access_token"), false);
    assert.equal(rawMarkdown.includes("client_secret="), false);
    assert.equal(rawMarkdown.includes("refresh_token="), false);
  } finally {
    if (previousManifest === null) await unlink(postConnectManifestPath).catch(() => undefined);
    else await writeFile(postConnectManifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(postConnectMarkdownPath).catch(() => undefined);
    else await writeFile(postConnectMarkdownPath, previousMarkdown);
  }
});

test("runClipperIntakeRefreshSweep writes operator intake refresh report safely", async () => {
  const intakeRefreshManifestPath = path.join(process.cwd(), "clippers_workspace", "intake-refresh-sweep.json");
  const intakeRefreshMarkdownPath = path.join(process.cwd(), "clippers_workspace", "intake-refresh-sweep.md");
  const previousManifest = await readFile(intakeRefreshManifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(intakeRefreshMarkdownPath, "utf8").catch(() => null);

  try {
    const { intakeRefreshSweep, postConnectActivationSweep, goLivePrepSweep, localDropSync, robertNextActions, status } = await runClipperIntakeRefreshSweep();
    assert.ok(intakeRefreshSweep.manifestPath.endsWith("intake-refresh-sweep.json"));
    assert.ok(intakeRefreshSweep.markdownPath.endsWith("intake-refresh-sweep.md"));
    assert.equal(intakeRefreshSweep.prepSweepStatus, goLivePrepSweep.status);
    assert.equal(intakeRefreshSweep.localDropSyncStatus, localDropSync?.status || "not_run");
    assert.equal(intakeRefreshSweep.postConnectStatus, postConnectActivationSweep.status);
    assert.equal(intakeRefreshSweep.readyToPublish, postConnectActivationSweep.readyToPublish);
    assert.equal(intakeRefreshSweep.intakeConsole.status, robertNextActions.connectNow.intakeConsole.status);
    assert.equal(intakeRefreshSweep.intakeConsole.totals.lanes, robertNextActions.connectNow.intakeConsole.totals.lanes);
    assert.ok(intakeRefreshSweep.refreshSequence.includes("Run Activation Sweep"));
    assert.ok(intakeRefreshSweep.completedSteps.length > 0);
    assert.ok(["ready", "needs_external_action", "needs_local_input", "blocked"].includes(intakeRefreshSweep.status));
    assert.ok(intakeRefreshSweep.artifactPaths.localDropSync === null || intakeRefreshSweep.artifactPaths.localDropSync.endsWith("local-drop-sync.md"));
    assert.ok(intakeRefreshSweep.artifactPaths.postConnectActivation.endsWith("post-connect-activation-sweep.md"));
    assert.ok(intakeRefreshSweep.artifactPaths.robertNextActions.endsWith("ROBERT_NEXT_ACTIONS.md"));
    assert.ok(intakeRefreshSweep.artifactPaths.connectNow.endsWith("ROBERT_CONNECT_NOW.md"));
    assert.ok(intakeRefreshSweep.artifactPaths.launcher.endsWith("external-portal-launcher.html"));
    assert.equal(status.robertNextActions.connectNow.intakeConsole.totals.lanes, intakeRefreshSweep.intakeConsole.totals.lanes);

    const rawManifest = await readFile(intakeRefreshSweep.manifestPath, "utf8");
    const rawMarkdown = await readFile(intakeRefreshSweep.markdownPath, "utf8");
    assert.ok(rawMarkdown.includes("Clippers Intake Refresh Sweep"));
    assert.ok(rawMarkdown.includes("Go-Live Intake Console") || rawMarkdown.includes("Intake Console"));
    assert.ok(rawMarkdown.includes("Refresh Sequence"));
    assert.ok(rawMarkdown.includes("Intake Lanes"));
    assert.equal(rawManifest.includes("access_token"), false);
    assert.equal(rawManifest.includes("client_secret="), false);
    assert.equal(rawManifest.includes("refresh_token="), false);
    assert.equal(rawMarkdown.includes("access_token"), false);
    assert.equal(rawMarkdown.includes("client_secret="), false);
    assert.equal(rawMarkdown.includes("refresh_token="), false);
  } finally {
    if (previousManifest === null) await unlink(intakeRefreshManifestPath).catch(() => undefined);
    else await writeFile(intakeRefreshManifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(intakeRefreshMarkdownPath).catch(() => undefined);
    else await writeFile(intakeRefreshMarkdownPath, previousMarkdown);
  }
});

test("prepareClipperIntakeKit writes safe templates for trends metrics allowlist and sources", async () => {
  const { intakeKit, status } = await prepareClipperIntakeKit();

  assert.equal(intakeKit.status, "prepared");
  assert.ok(intakeKit.readmePath.endsWith("intake-kit/README.md"));
  assert.ok(intakeKit.templateDir.endsWith("intake-kit/templates"));
  assert.ok(intakeKit.files.some((file) => file.id === "trend-opportunities" && file.destinationDir.endsWith("trends")));
  assert.ok(intakeKit.files.some((file) => file.id === "metrics-export" && file.destinationDir.endsWith("metrics")));
  assert.ok(intakeKit.files.every((file) => file.exists));
  assert.ok(status.commandCenter.steps.some((step) => step.id === "intake-kit"));

  const trendTemplate = intakeKit.files.find((file) => file.id === "trend-opportunities");
  assert.ok(trendTemplate);
  const trendTemplateText = await readFile(trendTemplate.path, "utf8");
  assert.ok(trendTemplateText.includes("category,platform,title,url"));

  const metricsTemplate = intakeKit.files.find((file) => file.id === "metrics-export");
  assert.ok(metricsTemplate);
  const metricsTemplateText = await readFile(metricsTemplate.path, "utf8");
  assert.ok(metricsTemplateText.includes("account_id,platform,clip_id,hook"));
});

test("recordClipperSourceIntakeBatch writes source tasks and rights batch rows", async () => {
  await bootstrapClipperWorkspace();
  const { sourceIntakeBatch, status } = await recordClipperSourceIntakeBatch({
    batchText: [
        "category,title,url,source,platform,target_file_name,rights_status,evidence_link,priority,notes",
        "sports,Last second comeback,https://example.com/comeback,@league,tiktok,comeback.mp4,owned_or_permissioned,https://drive.google.com/proof,high,Use fast scoreboard context",
        "memes,Loop format,https://example.com/meme,@creator,instagram,meme-loop.mp4,review_required,,medium,Needs creator approval",
        "streamers,Weak rights note,https://example.com/weak,@creator,youtube,weak-rights.mp4,owned_or_permissioned,Permission confirmed,low,Weak evidence should not unlock",
        "sports,Placeholder source,<approved source URL for sports-source-01.mp4>,<creator/rightsholder handle>,tiktok,sports-source-01.mp4,owned_or_permissioned,<proof URL/path/id for sports-source-01.mp4>,high,Should be skipped",
        ",,,,,,,,,",
      ].join("\n"),
  });

  try {
    assert.equal(sourceIntakeBatch.accepted, 3);
    assert.equal(sourceIntakeBatch.skipped, 2);
    assert.equal(sourceIntakeBatch.totals.sports, 1);
    assert.equal(sourceIntakeBatch.totals.memes, 1);
    assert.equal(sourceIntakeBatch.totals.streamers, 1);
    assert.equal(sourceIntakeBatch.totals.ownedOrPermissioned, 1);
    assert.equal(sourceIntakeBatch.totals.reviewRequired, 2);
    assert.ok(sourceIntakeBatch.items.some((item) => item.sourceRightsBatchRow?.startsWith("source_rights")));
    assert.equal(sourceIntakeBatch.items.find((item) => item.targetFileName === "weak-rights.mp4")?.sourceRightsBatchRow, null);
    assert.equal(sourceIntakeBatch.items.find((item) => item.targetFileName === "weak-rights.mp4")?.evidenceLink, null);
    assert.ok(sourceIntakeBatch.items.every((item) => item.targetSourcePath.includes("clippers_workspace/sources")));
    assert.ok(status.sourceHunt.items.length > 0);

    const rawManifest = await readFile(sourceIntakeBatch.manifestPath, "utf8");
    const rawCsv = await readFile(sourceIntakeBatch.csvPath, "utf8");
    const rawMarkdown = await readFile(sourceIntakeBatch.markdownPath, "utf8");
    assert.ok(rawCsv.includes("source_rights_batch_row"));
    assert.ok(rawMarkdown.includes("Clippers Source Intake Batch"));
    assert.ok(rawManifest.includes("targetSourcePath"));
    for (const forbidden of ["access_token", "client_secret", "plain-refresh-token"]) {
      assert.equal(rawManifest.includes(forbidden), false);
      assert.equal(rawCsv.includes(forbidden), false);
      assert.equal(rawMarkdown.includes(forbidden), false);
    }
  } finally {
    await unlink(sourceIntakeBatch.manifestPath).catch(() => undefined);
    await unlink(sourceIntakeBatch.csvPath).catch(() => undefined);
    await unlink(sourceIntakeBatch.markdownPath).catch(() => undefined);
  }
});

test("importClipperSourceDropFiles copies dropped videos into source folders", async () => {
  const status = await bootstrapClipperWorkspace();
  const sportsFolder = status.sourceFolders.find((folder) => folder.category === "sports");
  assert.ok(sportsFolder);
  const dropDir = path.join(status.rootDir, "source-drop", "sports");
  const dropPath = path.join(dropDir, "drop-highlight.test.mp4");
  const targetPath = path.join(sportsFolder.path, "drop-highlight-test.mp4");
  const previousDiagnostic = await readFile(path.join(status.rootDir, "source-drop-diagnostic.json"), "utf8").catch(() => null);
  const previousDiagnosticMarkdown = await readFile(path.join(status.rootDir, "source-drop-diagnostic.md"), "utf8").catch(() => null);
  const previousRepairWorksheet = await readFile(path.join(status.rootDir, "source-drop-repair-worksheet.csv"), "utf8").catch(() => null);
  let queuePath: string | null = null;
  await mkdir(dropDir, { recursive: true });
  writeTinyTestVideo(dropPath);

  try {
    const { sourceDropImport, status: nextStatus } = await importClipperSourceDropFiles();
    queuePath = sourceDropImport.queue.queuePath;
    assert.equal(sourceDropImport.filesScanned >= 1, true);
    assert.equal(sourceDropImport.manifestRows >= 0, true);
    assert.equal(sourceDropImport.rightsEvidenceWritten >= 0, true);
    assert.equal(sourceDropImport.imported >= 1, true);
    assert.ok(sourceDropImport.items.some((item) =>
      item.fileName === "drop-highlight-test.mp4" &&
      item.category === "sports" &&
      item.status === "imported" &&
      item.rightsStatus === "review_required" &&
      item.rightsEvidencePath === null
    ));
    const targetStat = await stat(targetPath);
    assert.equal(targetStat.isFile(), true);
    assert.ok(nextStatus.productionQueue.sourceAssets.some((asset) =>
      asset.fileName === "drop-highlight-test.mp4" &&
      asset.category === "sports" &&
      asset.rightsStatus === "review_required"
    ));
    assert.ok(nextStatus.sourceDropDiagnostic.manifestPath.endsWith("source-drop-diagnostic.json"));
    assert.ok(nextStatus.sourceDropDiagnostic.markdownPath.endsWith("source-drop-diagnostic.md"));
    assert.ok(nextStatus.sourceDropDiagnostic.repairWorksheetCsvPath.endsWith("source-drop-repair-worksheet.csv"));
    assert.ok(["ready_to_import", "needs_files", "needs_rights", "ready"].includes(nextStatus.sourceDropDiagnostic.status));
    assert.ok(nextStatus.sourceDropDiagnostic.categories.some((category) => category.category === "sports"));
    assert.ok(nextStatus.sourceDropDiagnostic.totals.currentSourceAssets >= nextStatus.sourceDropDiagnostic.totals.rightsReadyAssets);
    const rawDiagnostic = await readFile(nextStatus.sourceDropDiagnostic.manifestPath, "utf8");
    const rawDiagnosticMarkdown = await readFile(nextStatus.sourceDropDiagnostic.markdownPath, "utf8");
    const rawRepairWorksheet = await readFile(nextStatus.sourceDropDiagnostic.repairWorksheetCsvPath, "utf8");
    assert.ok(rawDiagnosticMarkdown.includes("Clippers Source Drop Diagnostic"));
    assert.ok(rawDiagnosticMarkdown.includes("Repair worksheet"));
    assert.ok(rawDiagnosticMarkdown.includes("Missing source assets"));
    assert.ok(rawDiagnostic.includes("source-drop-diagnostic"));
    assert.ok(rawRepairWorksheet.includes("type,category,source_file,expected_file,current_status,issue,proof_needed,viral_search_query,viral_search_url,recency_window,minimum_views,viral_signal,rights_gate,next_step"));
    assert.ok(rawRepairWorksheet.includes("file_needs_rights"));
    assert.ok(rawRepairWorksheet.includes("viral_search_url"));
    assert.ok(rawRepairWorksheet.includes("minimum_views"));
    assert.ok(rawRepairWorksheet.includes("rights_gate"));
    assert.equal(rawDiagnostic.includes("access_token"), false);
    assert.equal(rawDiagnosticMarkdown.includes("client_secret"), false);
    assert.equal(rawRepairWorksheet.includes("client_secret"), false);
  } finally {
    await unlink(dropPath).catch(() => undefined);
    await unlink(targetPath).catch(() => undefined);
    if (queuePath) await unlink(queuePath).catch(() => undefined);
    if (previousDiagnostic === null) await unlink(path.join(status.rootDir, "source-drop-diagnostic.json")).catch(() => undefined);
    else await writeFile(path.join(status.rootDir, "source-drop-diagnostic.json"), previousDiagnostic);
    if (previousDiagnosticMarkdown === null) await unlink(path.join(status.rootDir, "source-drop-diagnostic.md")).catch(() => undefined);
    else await writeFile(path.join(status.rootDir, "source-drop-diagnostic.md"), previousDiagnosticMarkdown);
    if (previousRepairWorksheet === null) await unlink(path.join(status.rootDir, "source-drop-repair-worksheet.csv")).catch(() => undefined);
    else await writeFile(path.join(status.rootDir, "source-drop-repair-worksheet.csv"), previousRepairWorksheet);
  }
});

test("importClipperSourceDropFiles creates allowlist evidence from source-drop manifest", async () => {
  const status = await bootstrapClipperWorkspace();
  const sportsFolder = status.sourceFolders.find((folder) => folder.category === "sports");
  assert.ok(sportsFolder);
  const dropDir = path.join(status.rootDir, "source-drop", "sports");
  const dropPath = path.join(dropDir, "drop-approved-cleanroom.mp4");
  const stubMp4Path = path.join(dropDir, "drop-approved-stub.mp4");
  const fakeAviPath = path.join(dropDir, "drop-approved-fake.avi");
  const manifestPath = path.join(dropDir, "source-drop-manifest.csv");
  const previousManifest = await readFile(manifestPath, "utf8").catch(() => null);
  const previousDiagnostic = await readFile(path.join(status.rootDir, "source-drop-diagnostic.json"), "utf8").catch(() => null);
  const previousDiagnosticMarkdown = await readFile(path.join(status.rootDir, "source-drop-diagnostic.md"), "utf8").catch(() => null);
  const previousRepairWorksheet = await readFile(path.join(status.rootDir, "source-drop-repair-worksheet.csv"), "utf8").catch(() => null);
  const importCleanupDirs = status.sourceFolders
    .filter((folder) => ["sports", "memes", "streamers", "allowlist"].includes(folder.category))
    .map((folder) => folder.path);
  const previousImportFiles = new Map(await Promise.all(importCleanupDirs.map(async (dir) => [
    dir,
    new Set(await readdir(dir).catch(() => [])),
  ] as const)));
  let queuePath: string | null = null;
  let targetPath: string | null = null;
  let evidencePath: string | null = null;
  await mkdir(dropDir, { recursive: true });
  writeTinyTestVideo(dropPath);
  await writeFile(stubMp4Path, "fake-video-for-source-drop-manifest-test");
  await writeFile(fakeAviPath, "not-a-real-video".repeat(200));
  await writeFile(manifestPath, [
    "category,title,url,source,platform,target_file_name,rights_status,evidence_link,priority,notes",
    "sports,Approved comeback,https://example.com/source,@league,tiktok,drop-approved-cleanroom.mp4,owned_or_permissioned,https://drive.google.com/file/proof,high,Official source proof stored in Drive",
    "sports,Stub MP4,https://example.com/source-stub,@league,tiktok,drop-approved-stub.mp4,owned_or_permissioned,https://drive.google.com/file/proof-stub,high,Stub should not create allowlist",
    "sports,Fake AVI,https://example.com/source-avi,@league,tiktok,drop-approved-fake.avi,owned_or_permissioned,https://drive.google.com/file/proof-avi,high,Unsupported fake container should not import",
    "",
  ].join("\n"));

  try {
    const { sourceDropImport, status: nextStatus } = await importClipperSourceDropFiles();
    queuePath = sourceDropImport.queue.queuePath;
    const imported = sourceDropImport.items.find((item) =>
      item.sourcePath === dropPath &&
      item.category === "sports" &&
      item.status === "imported"
    );
    assert.ok(imported);
    targetPath = imported.targetPath;
    evidencePath = imported.rightsEvidencePath;
    assert.equal(imported.fileName, "drop-approved-cleanroom.mp4");
    assert.equal(imported.rightsStatus, "owned_or_permissioned");
    assert.equal(imported.manifestPath, manifestPath);
    assert.equal(sourceDropImport.manifestFilesScanned >= 1, true);
    assert.equal(sourceDropImport.manifestRows >= 1, true);
    assert.equal(sourceDropImport.manifestMatched >= 1, true);
    assert.equal(sourceDropImport.rightsEvidenceWritten >= 1, true);
    assert.ok(evidencePath?.endsWith("drop-approved-cleanroom.md"));
    assert.ok(nextStatus.productionQueue.sourceAssets.some((asset) =>
      asset.fileName === "drop-approved-cleanroom.mp4" &&
      asset.category === "sports" &&
      asset.rightsStatus === "owned_or_permissioned" &&
      asset.evidencePath === evidencePath
    ));
    const skippedStub = sourceDropImport.items.find((item) => item.sourcePath === stubMp4Path);
    assert.equal(skippedStub?.status, "skipped");
    assert.equal(skippedStub?.rightsEvidencePath, null);
    assert.ok(skippedStub?.reason?.includes("Video invalido"));
    const diagnosticStub = nextStatus.sourceDropDiagnostic.files.find((item) => item.fileName === "drop-approved-stub.mp4");
    assert.ok(diagnosticStub);
    assert.equal(diagnosticStub.usableVideo, false);
    assert.equal(diagnosticStub.importEligible, false);
    assert.equal(diagnosticStub.manifestEvidenceReady, false);
    assert.match(diagnosticStub.issue || "", /video usable|pequeno/i);
    assert.equal(nextStatus.sourceDropDiagnostic.manifests.some((manifest) =>
      manifest.missingFiles.includes("drop-approved-stub.mp4")
    ), true);
    assert.equal(nextStatus.productionQueue.sourceAssets.some((asset) => asset.fileName === "drop-approved-stub.mp4"), false);
    assert.equal(sourceDropImport.items.some((item) => item.fileName === "drop-approved-fake.avi"), false);
    assert.equal(nextStatus.productionQueue.sourceAssets.some((asset) => asset.fileName === "drop-approved-fake.avi"), false);
    const rawEvidence = await readFile(evidencePath!, "utf8");
    assert.ok(rawEvidence.includes("source-drop-manifest"));
    assert.ok(rawEvidence.includes("https://drive.google.com/file/proof"));
    assert.equal(rawEvidence.includes("client_secret"), false);
  } finally {
    await unlink(dropPath).catch(() => undefined);
    await unlink(stubMp4Path).catch(() => undefined);
    await unlink(fakeAviPath).catch(() => undefined);
    if (targetPath) await unlink(targetPath).catch(() => undefined);
    if (evidencePath) await unlink(evidencePath).catch(() => undefined);
    if (queuePath) await unlink(queuePath).catch(() => undefined);
    for (const [dir, previousFiles] of previousImportFiles) {
      const currentFiles = await readdir(dir).catch(() => []);
      await Promise.all(currentFiles
        .filter((fileName) => !previousFiles.has(fileName))
        .map((fileName) => unlink(path.join(dir, fileName)).catch(() => undefined)));
    }
    if (previousManifest === null) await unlink(manifestPath).catch(() => undefined);
    else await writeFile(manifestPath, previousManifest);
    if (previousDiagnostic === null) await unlink(path.join(status.rootDir, "source-drop-diagnostic.json")).catch(() => undefined);
    else await writeFile(path.join(status.rootDir, "source-drop-diagnostic.json"), previousDiagnostic);
    if (previousDiagnosticMarkdown === null) await unlink(path.join(status.rootDir, "source-drop-diagnostic.md")).catch(() => undefined);
    else await writeFile(path.join(status.rootDir, "source-drop-diagnostic.md"), previousDiagnosticMarkdown);
    if (previousRepairWorksheet === null) await unlink(path.join(status.rootDir, "source-drop-repair-worksheet.csv")).catch(() => undefined);
    else await writeFile(path.join(status.rootDir, "source-drop-repair-worksheet.csv"), previousRepairWorksheet);
  }
});

test("prepareClipperProductionQueue scans assets and respects allowlist evidence", async () => {
  const status = await bootstrapClipperWorkspace();
  const sportsFolder = status.sourceFolders.find((folder) => folder.category === "sports");
  const allowlistFolder = status.sourceFolders.find((folder) => folder.category === "allowlist");
  assert.ok(sportsFolder);
  assert.ok(allowlistFolder);

  const sourcePath = `${sportsFolder.path}/queue-highlight.mp4`;
  const evidencePath = `${allowlistFolder.path}/queue-highlight.md`;
  let queuePath: string | null = null;
  await mkdir(sportsFolder.path, { recursive: true });
  await mkdir(allowlistFolder.path, { recursive: true });
  await writeFile(sourcePath, Buffer.concat([Buffer.from("0000ftypisom"), Buffer.alloc(12 * 1024)]));
  await writeFile(evidencePath, "# Permission\nOwned or explicitly permissioned test footage.");

  try {
    const { queue, status: nextStatus } = await prepareClipperProductionQueue();
    queuePath = queue.queuePath;
    assert.equal(queue.sourceAssets.some((asset) => asset.fileName === "queue-highlight.mp4" && asset.rightsStatus === "owned_or_permissioned"), true);
    assert.ok(queue.items.some((item) => item.category === "sports" && item.status === "draft_ready"));
    assert.equal(queue.items.length, status.accounts.reduce((sum, account) => sum + account.dailyClipTarget, 0));
    assert.ok(queue.items.every((item) => item.slotNumber >= 1));
    assert.ok(queue.items.every((item) => item.variantAngle.length > 0 && item.clipObjective.length > 0));
    assert.equal(nextStatus.productionQueue.queuePath?.endsWith(".json"), true);
  } finally {
    await unlink(sourcePath).catch(() => undefined);
    await unlink(evidencePath).catch(() => undefined);
    if (queuePath) await unlink(queuePath).catch(() => undefined);
  }
});

test("prepareClipperSourceAcquisitionPlan writes daily source gaps by category", async () => {
  const beforeStatus = await bootstrapClipperWorkspace();
  const previousManifest = await readFile(beforeStatus.sourceAcquisition.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.sourceAcquisition.markdownPath, "utf8").catch(() => null);

  try {
    const { sourceAcquisition, status } = await prepareClipperSourceAcquisitionPlan();
    const expectedDailySlots = status.accounts.reduce((sum, account) => sum + account.dailyClipTarget, 0);

    assert.equal(sourceAcquisition.totals.dailySlots, expectedDailySlots);
    assert.equal(sourceAcquisition.totals.targetWeeklyClips, 100);
    assert.equal(sourceAcquisition.totals.configuredWeeklySlots, expectedDailySlots * 7);
    assert.equal(sourceAcquisition.categories.reduce((sum, category) => sum + category.weeklyTargetSlots, 0), 100);
    assert.equal(sourceAcquisition.categories.length, 3);
    assert.ok(sourceAcquisition.categories.some((category) => category.category === "sports" && category.dailySlots >= 10));
    assert.ok(sourceAcquisition.categories.every((category) => category.minimumWeeklySourceAssets >= category.minimumRecommendedAssets));
    assert.ok(sourceAcquisition.categories.every((category) => category.searchBrief.length > 0));
    assert.ok(status.commandCenter.steps.some((step) => step.id === "source-supply" && step.actionUrl === "/api/clippers/prepare-source-acquisition"));

    const manifestStat = await stat(sourceAcquisition.manifestPath);
    const markdownStat = await stat(sourceAcquisition.markdownPath);
    assert.equal(manifestStat.isFile(), true);
    assert.equal(markdownStat.isFile(), true);

    const rawManifest = await readFile(sourceAcquisition.manifestPath, "utf8");
    const rawMarkdown = await readFile(sourceAcquisition.markdownPath, "utf8");
    assert.ok(rawManifest.includes("missingSourceSlots"));
    assert.ok(rawManifest.includes("weeklyMissingSourceSlots"));
    assert.ok(rawMarkdown.includes("Clippers Source Acquisition Plan"));
    assert.ok(rawMarkdown.includes("Weekly target clips"));
    assert.equal(rawManifest.includes("access_token"), false);
    assert.equal(rawMarkdown.includes("client_secret"), false);
  } finally {
    if (previousManifest === null) await unlink(beforeStatus.sourceAcquisition.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.sourceAcquisition.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.sourceAcquisition.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.sourceAcquisition.markdownPath, previousMarkdown);
  }
});

test("prepareClipperSourceSupplyDropKit writes intake-ready source rows", async () => {
  const beforeStatus = await bootstrapClipperWorkspace();
  const previousManifest = await readFile(beforeStatus.sourceSupplyDropKit.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.sourceSupplyDropKit.markdownPath, "utf8").catch(() => null);
  const previousCsv = await readFile(beforeStatus.sourceSupplyDropKit.csvPath, "utf8").catch(() => null);
  const starterManifestPaths = ["sports", "memes", "streamers"].map((category) => path.join(beforeStatus.rootDir, "source-drop", category, "source-drop-manifest.csv"));
  const previousStarterManifests = await Promise.all(starterManifestPaths.map((manifestPath) => readFile(manifestPath, "utf8").catch(() => null)));
  const starterReadmePaths = ["sports", "memes", "streamers"].map((category) => path.join(beforeStatus.rootDir, "source-drop", category, "README.md"));
  const previousStarterReadmes = await Promise.all(starterReadmePaths.map((readmePath) => readFile(readmePath, "utf8").catch(() => null)));

  try {
    await Promise.all(starterManifestPaths.map((manifestPath) => unlink(manifestPath).catch(() => undefined)));
    await Promise.all(starterReadmePaths.map((readmePath) => unlink(readmePath).catch(() => undefined)));
    const { sourceSupplyDropKit, status } = await prepareClipperSourceSupplyDropKit();
    const expectedItems = status.sourceAcquisition.categories.reduce((sum, category) => sum + Math.max(0, category.minimumWeeklySourceAssets - category.rightsReadyAssets), 0);

    assert.equal(sourceSupplyDropKit.items.length, expectedItems);
    assert.equal(sourceSupplyDropKit.totals.items, sourceSupplyDropKit.items.length);
    assert.equal(sourceSupplyDropKit.categoryBatches.length > 0, expectedItems > 0);
    assert.ok(sourceSupplyDropKit.categoryBatches.every((batch) => batch.items > 0));
    assert.ok(sourceSupplyDropKit.categoryBatches.every((batch) => batch.sourceDropManifestPath.endsWith(`${path.sep}source-drop${path.sep}${batch.category}${path.sep}source-drop-manifest.csv`)));
    assert.ok(sourceSupplyDropKit.categoryBatches.every((batch) => batch.sourceDropReadmePath.endsWith(`${path.sep}source-drop${path.sep}${batch.category}${path.sep}README.md`)));
    assert.ok(sourceSupplyDropKit.categoryBatches.every((batch) => batch.intakeBatchTemplate.startsWith("category,title,url,source,platform,target_file_name,rights_status,evidence_link,priority,notes")));
    assert.ok(sourceSupplyDropKit.categoryBatches.every((batch) => batch.trendCandidateBatchTemplate.startsWith("category,platform,title,url,source,posted_at,views,likes,comments,shares,rights,angle")));
    assert.ok(sourceSupplyDropKit.categoryBatches.every((batch) => batch.rightsEvidenceBatchTemplate.startsWith("kind,account_id,platform,status,scope")));
    assert.ok(sourceSupplyDropKit.intakeBatchTemplate.startsWith("category,title,url,source,platform,target_file_name,rights_status,evidence_link,priority,notes"));
    assert.ok(sourceSupplyDropKit.items.every((item) => item.intakeBatchRow.includes("owned_or_permissioned")));
    assert.ok(sourceSupplyDropKit.items.every((item) => item.sourceDropPath.includes(`${path.sep}source-drop${path.sep}${item.category}${path.sep}`)));
    assert.ok(sourceSupplyDropKit.categoryBatches.every((batch) => batch.sourceDropDir.endsWith(`${path.sep}source-drop${path.sep}${batch.category}`)));
    assert.ok(sourceSupplyDropKit.categoryBatches.every((batch) => batch.sourceDropPaths.every((dropPath) => dropPath.includes(`${path.sep}source-drop${path.sep}${batch.category}${path.sep}`))));
    assert.ok(sourceSupplyDropKit.items.every((item) => item.trendCandidateBatchRow.includes("approved_after_proof")));
    assert.ok(sourceSupplyDropKit.items.every((item) => item.rightsEvidenceBatchRow.includes("source_rights")));
    assert.ok(sourceSupplyDropKit.items.every((item) => item.evidenceLinkPlaceholder.includes("proof URL/path/id")));
    assert.ok(sourceSupplyDropKit.items.every((item) => item.requiredProof.length >= 4));
    assert.ok(sourceSupplyDropKit.items.every((item) => item.viralSearchQueries.length >= 3));
    assert.ok(sourceSupplyDropKit.items.every((item) => item.viralScoreChecklist.length >= 4));
    assert.ok(sourceSupplyDropKit.items.every((item) => item.rejectIf.length >= 4));
    assert.ok(sourceSupplyDropKit.items.every((item) => item.doneCriteria.some((criteria) => criteria.includes("Source Intake Batch"))));
    assert.ok(sourceSupplyDropKit.items.every((item) => item.doneCriteria.some((criteria) => criteria.includes("Trend Candidate Batch"))));
    assert.ok(sourceSupplyDropKit.items.every((item) => item.doneCriteria.some((criteria) => criteria.includes("Launch Evidence Batch"))));
    assert.ok(status.commandCenter.steps.some((step) => step.id === "source-supply-drop-kit" && step.actionUrl === "/api/clippers/prepare-source-supply-drop-kit"));
    assert.ok(status.sourceDropDiagnostic.manifests.length >= sourceSupplyDropKit.categoryBatches.length);
    assert.equal(status.sourceDropDiagnostic.totals.manifestFiles, status.sourceDropDiagnostic.manifests.length);
    assert.ok(status.sourceDropDiagnostic.totals.manifestRows >= sourceSupplyDropKit.items.length);
    assert.ok(status.sourceDropDiagnostic.totals.manifestPlaceholderRows >= sourceSupplyDropKit.items.length);
    assert.ok(status.sourceDropDiagnostic.totals.manifestMissingFiles >= sourceSupplyDropKit.items.length);
    assert.ok(
      status.sourceDropDiagnostic.nextStep.includes("source-drop manifests")
        || status.sourceDropDiagnostic.nextStep.includes("Coloca videos reales")
        || status.sourceDropDiagnostic.nextStep.includes("faltan permisos/evidencia")
        || status.sourceDropDiagnostic.nextStep.includes("invalidos/stub")
        || status.sourceDropDiagnostic.nextStep.includes("suficientes")
        || status.sourceDropDiagnostic.nextStep.includes("Source readiness")
        || status.sourceDropDiagnostic.nextStep.includes("listos para importar")
        || status.sourceDropDiagnostic.nextStep.includes("Source supply listo")
    );
    assert.equal(status.sourceDropDiagnostic.totals.invalidSourceAssets >= 0, true);
    assert.ok(expectedItems === 0 || status.sourceDropDiagnostic.categories.some((category) =>
      category.manifestPlaceholderRows > 0 &&
      (category.nextStep.includes("placeholder") || category.nextStep.includes("invalidos/stub"))
    ));

    const rawManifest = await readFile(sourceSupplyDropKit.manifestPath, "utf8");
    const rawMarkdown = await readFile(sourceSupplyDropKit.markdownPath, "utf8");
    const rawCsv = await readFile(sourceSupplyDropKit.csvPath, "utf8");
    assert.ok(rawMarkdown.includes("Clippers Source Supply Drop Kit"));
    assert.ok(rawMarkdown.includes("Source Intake Template"));
    assert.ok(rawMarkdown.includes("Category Batches"));
    if (expectedItems > 0) {
      assert.ok(rawMarkdown.includes("Source drop manifest"));
      assert.ok(rawMarkdown.includes("Source drop README"));
      assert.ok(rawMarkdown.includes("Rights evidence template"));
      assert.ok(rawMarkdown.includes("Viral search queries"));
      assert.ok(rawCsv.includes("category_batch_id"));
      assert.ok(rawCsv.includes("manifest_path"));
      assert.ok(rawCsv.includes("source_drop_readme_path"));
      assert.ok(rawCsv.includes("intake_batch_row"));
      assert.ok(rawCsv.includes("trend_candidate_batch_row"));
      assert.ok(rawCsv.includes("rights_evidence_batch_row"));
    }
    assert.ok(rawManifest.includes("categoryBatches"));
    assert.ok(rawManifest.includes("intakeBatchTemplate"));
    for (const batch of sourceSupplyDropKit.categoryBatches) {
      const starterManifest = await readFile(batch.sourceDropManifestPath, "utf8");
      assert.ok(starterManifest.startsWith("category,title,url,source,platform,target_file_name,rights_status,evidence_link,priority,notes"));
      assert.ok(starterManifest.includes(`${batch.category}-source-01.mp4`));
      assert.equal(starterManifest.includes("client_secret"), false);
      const starterReadme = await readFile(batch.sourceDropReadmePath, "utf8");
      assert.ok(starterReadme.includes(`Clippers Source Drop - ${batch.label}`));
      assert.ok(starterReadme.includes("Expected Files"));
      assert.ok(starterReadme.includes("Safety Rules"));
      assert.ok(starterReadme.includes("source-drop-manifest.csv"));
      assert.equal(starterReadme.includes("access_token"), false);
    }
    assert.equal(rawManifest.includes("access_token"), false);
    assert.equal(rawMarkdown.includes("client_secret"), false);
    assert.equal(rawCsv.includes("refresh_token"), false);
  } finally {
    if (previousManifest === null) await unlink(beforeStatus.sourceSupplyDropKit.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.sourceSupplyDropKit.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.sourceSupplyDropKit.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.sourceSupplyDropKit.markdownPath, previousMarkdown);
    if (previousCsv === null) await unlink(beforeStatus.sourceSupplyDropKit.csvPath).catch(() => undefined);
    else await writeFile(beforeStatus.sourceSupplyDropKit.csvPath, previousCsv);
    await Promise.all(starterManifestPaths.map(async (manifestPath, index) => {
      const previousStarterManifest = previousStarterManifests[index];
      if (previousStarterManifest === null) await unlink(manifestPath).catch(() => undefined);
      else await writeFile(manifestPath, previousStarterManifest);
    }));
    await Promise.all(starterReadmePaths.map(async (readmePath, index) => {
      const previousStarterReadme = previousStarterReadmes[index];
      if (previousStarterReadme === null) await unlink(readmePath).catch(() => undefined);
      else await writeFile(readmePath, previousStarterReadme);
    }));
  }
});

test("prepareClipperSourceDiscoveryHandoff joins viral searches to missing source assets", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.sourceDiscoveryHandoff.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.sourceDiscoveryHandoff.markdownPath, "utf8").catch(() => null);
  const previousCsv = await readFile(beforeStatus.sourceDiscoveryHandoff.csvPath, "utf8").catch(() => null);

  try {
    const { sourceDiscoveryHandoff, status } = await prepareClipperSourceDiscoveryHandoff();
    assert.ok(sourceDiscoveryHandoff.manifestPath.endsWith("source-discovery-handoff.json"));
    assert.ok(sourceDiscoveryHandoff.markdownPath.endsWith("source-discovery-handoff.md"));
    assert.ok(sourceDiscoveryHandoff.csvPath.endsWith("source-discovery-handoff.csv"));
    assert.equal(sourceDiscoveryHandoff.totals.items, sourceDiscoveryHandoff.items.length);
    assert.equal(sourceDiscoveryHandoff.totals.items, status.sourceSupplyDropKit.totals.items);
    assert.ok(sourceDiscoveryHandoff.totals.discoveryLinks >= sourceDiscoveryHandoff.items.length);
    assert.ok(sourceDiscoveryHandoff.totals.targetCandidates >= sourceDiscoveryHandoff.items.length);
    assert.ok(sourceDiscoveryHandoff.items.every((item) => item.discoveryUrl.startsWith("https://")));
    assert.ok(sourceDiscoveryHandoff.items.every((item) => item.intakeBatchRow.includes("owned_or_permissioned")));
    assert.ok(sourceDiscoveryHandoff.items.every((item) => item.trendCandidateBatchRow.includes("approved_after_proof")));
    assert.ok(sourceDiscoveryHandoff.items.every((item) => item.rightsEvidenceBatchRow.includes("source_rights")));
    assert.ok(sourceDiscoveryHandoff.items.every((item) => item.proofChecklist.length >= 4));
    assert.ok(sourceDiscoveryHandoff.items.every((item) => item.rejectIf.length >= 4));
    assert.equal(status.sourceDiscoveryHandoff.manifestPath, sourceDiscoveryHandoff.manifestPath);
    assert.equal(status.sourceDiscoveryHandoff.totals.items, sourceDiscoveryHandoff.totals.items);

    const rawManifest = await readFile(sourceDiscoveryHandoff.manifestPath, "utf8");
    const rawMarkdown = await readFile(sourceDiscoveryHandoff.markdownPath, "utf8");
    const rawCsv = await readFile(sourceDiscoveryHandoff.csvPath, "utf8");
    assert.ok(rawMarkdown.includes("Clippers Source Discovery Handoff"));
    assert.ok(rawMarkdown.includes("Unified operator queue"));
    assert.ok(rawCsv.includes("discovery_url"));
    assert.equal(rawManifest.includes("access_token"), false);
    assert.equal(rawMarkdown.includes("client_secret="), false);
    assert.equal(rawCsv.includes("refresh_token="), false);
  } finally {
    if (previousManifest === null) await unlink(beforeStatus.sourceDiscoveryHandoff.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.sourceDiscoveryHandoff.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.sourceDiscoveryHandoff.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.sourceDiscoveryHandoff.markdownPath, previousMarkdown);
    if (previousCsv === null) await unlink(beforeStatus.sourceDiscoveryHandoff.csvPath).catch(() => undefined);
    else await writeFile(beforeStatus.sourceDiscoveryHandoff.csvPath, previousCsv);
  }
});

test("prepareClipperSourceScout writes rights-gated candidates and refreshes Metricool queue", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.sourceScout.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.sourceScout.markdownPath, "utf8").catch(() => null);
  const previousCsv = await readFile(beforeStatus.sourceScout.csvPath, "utf8").catch(() => null);
  const previousTrendSummary = await readFile(beforeStatus.trendRadar.summaryPath, "utf8").catch(() => null);
  const trendsDir = beforeStatus.trendRadar.trendsDir;
  const previousTrendFiles = new Set(await readdir(trendsDir).catch(() => []));
  const previousMetricoolQueue = await readFile(beforeStatus.metricoolExecutionQueue.manifestPath, "utf8").catch(() => null);
  const previousMetricoolMarkdown = await readFile(beforeStatus.metricoolExecutionQueue.markdownPath, "utf8").catch(() => null);
  const previousMetricoolCsv = await readFile(beforeStatus.metricoolExecutionQueue.csvPath, "utf8").catch(() => null);

  try {
    await prepareMetricoolOwnedSourceFixtures();
    await prepareClipperSourceAcquisitionPlan();
    await prepareClipperProductionQueue();
    await prepareClipperViralDiscoveryPack();
    await prepareClipperSourceDiscoveryHandoff();
    const { sourceScout, trendCandidatesBatch, metricoolExecutionQueue, status } = await prepareClipperSourceScout();

    assert.ok(sourceScout.manifestPath.endsWith("source-scout-candidates.json"));
    assert.ok(sourceScout.markdownPath.endsWith("source-scout-candidates.md"));
    assert.ok(sourceScout.csvPath.endsWith("source-scout-candidates.csv"));
    assert.equal(sourceScout.status, "ready_for_review");
    assert.ok(sourceScout.candidates.length > 0);
    assert.equal(sourceScout.totals.candidates, sourceScout.candidates.length);
    assert.ok(sourceScout.totals.blockedRights >= 0);
    assert.ok(sourceScout.candidates.every((candidate) => candidate.sourceUrl.startsWith("https://")));
    assert.ok(sourceScout.candidates.every((candidate) => candidate.sourceUrlKind === "discovery_search" || candidate.sourceUrlKind === "exact_video_or_post"));
    assert.ok(sourceScout.candidates.every((candidate) => candidate.rightsStatus === "review_required" || candidate.canUseNow === false || candidate.publishGate !== "ready_for_intake"));
    assert.ok(sourceScout.candidates.every((candidate) => candidate.trendCandidateBatchRow.includes("review_required") || candidate.trendCandidateBatchRow.includes("approved_after_proof")));
    assert.ok(sourceScout.candidates.every((candidate) => candidate.rightsEvidenceNeeded.length >= 3));
    assert.equal(sourceScout.totals.metricoolFit, sourceScout.candidates.filter((candidate) => candidate.metricoolFit).length);
    assert.ok(sourceScout.totals.metricoolFit <= sourceScout.candidates.length);
    assert.ok(sourceScout.candidates.filter((candidate) => candidate.category === "streamers").every((candidate) => candidate.metricoolFit === false));
    assert.ok(status.sourceDropDiagnostic.totals.missingSourceAssets >= 0);
    assert.ok(sourceScout.candidates.filter((candidate) => candidate.source === "metricool_source_readiness").every((candidate) => candidate.sourceDropPath?.split(path.sep).includes("source-drop")));
    const exactSourceUrls = new Set(sourceScout.candidates.filter((candidate) => candidate.sourceUrlKind === "exact_video_or_post").map((candidate) => candidate.sourceUrl));
    if (trendCandidatesBatch) {
      assert.equal(trendCandidatesBatch.accepted <= exactSourceUrls.size, true);
    }
    assert.equal(metricoolExecutionQueue.realPublishEnabled, false);
    assert.ok(metricoolExecutionQueue.totals.blocked >= 0);
    assert.equal(status.sourceScout.manifestPath, sourceScout.manifestPath);
    assert.equal(status.metricoolExecutionQueue.realPublishEnabled, false);
    const secondRun = await prepareClipperSourceScout();
    assert.equal(secondRun.trendCandidatesBatch, null);

    const rawManifest = await readFile(sourceScout.manifestPath, "utf8");
    const rawMarkdown = await readFile(sourceScout.markdownPath, "utf8");
    const rawCsv = await readFile(sourceScout.csvPath, "utf8");
    assert.ok(rawMarkdown.includes("Clippers Source Scout Candidates"));
    assert.ok(rawMarkdown.includes("Rights Checker blocks"));
    assert.ok(rawCsv.includes("source_url"));
    assert.ok(rawCsv.includes("source_url_kind"));
    assert.ok(rawCsv.includes("target_file_name"));
    assert.ok(rawMarkdown.includes("Source drop path"));
    assert.equal(rawManifest.includes("access_token"), false);
    assert.equal(rawMarkdown.includes("client_secret"), false);
    assert.equal(rawCsv.includes("refresh_token"), false);
  } finally {
    if (previousManifest === null) await unlink(beforeStatus.sourceScout.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.sourceScout.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.sourceScout.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.sourceScout.markdownPath, previousMarkdown);
    if (previousCsv === null) await unlink(beforeStatus.sourceScout.csvPath).catch(() => undefined);
    else await writeFile(beforeStatus.sourceScout.csvPath, previousCsv);
    if (previousTrendSummary === null) await unlink(beforeStatus.trendRadar.summaryPath).catch(() => undefined);
    else await writeFile(beforeStatus.trendRadar.summaryPath, previousTrendSummary);
    const afterTrendFiles = await readdir(trendsDir).catch(() => []);
    await Promise.all(afterTrendFiles
      .filter((fileName) => !previousTrendFiles.has(fileName) && fileName.startsWith("trend-candidates-"))
      .map((fileName) => unlink(path.join(trendsDir, fileName)).catch(() => undefined)));
    if (previousMetricoolQueue === null) await unlink(beforeStatus.metricoolExecutionQueue.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.metricoolExecutionQueue.manifestPath, previousMetricoolQueue);
    if (previousMetricoolMarkdown === null) await unlink(beforeStatus.metricoolExecutionQueue.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.metricoolExecutionQueue.markdownPath, previousMetricoolMarkdown);
    if (previousMetricoolCsv === null) await unlink(beforeStatus.metricoolExecutionQueue.csvPath).catch(() => undefined);
    else await writeFile(beforeStatus.metricoolExecutionQueue.csvPath, previousMetricoolCsv);
  }
});

test("prepareClipperSourceScoutPermissionPack writes outreach and intake rows without publishing", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(path.join(beforeStatus.rootDir, "source-scout-permission-pack.json"), "utf8").catch(() => null);
  const previousMarkdown = await readFile(path.join(beforeStatus.rootDir, "source-scout-permission-pack.md"), "utf8").catch(() => null);
  const previousCsv = await readFile(path.join(beforeStatus.rootDir, "source-scout-permission-pack.csv"), "utf8").catch(() => null);

  try {
    await prepareClipperSourceScout();
    const { sourceScoutPermissionPack, status } = await prepareClipperSourceScoutPermissionPack();

    assert.ok(sourceScoutPermissionPack.manifestPath.endsWith("source-scout-permission-pack.json"));
    assert.ok(sourceScoutPermissionPack.markdownPath.endsWith("source-scout-permission-pack.md"));
    assert.ok(sourceScoutPermissionPack.csvPath.endsWith("source-scout-permission-pack.csv"));
    assert.equal(sourceScoutPermissionPack.totals.candidates, status.sourceScout.totals.candidates);
    assert.ok(sourceScoutPermissionPack.totals.readyToContact >= 0);
    assert.ok(sourceScoutPermissionPack.items.every((item) => item.outreachMessage.includes("written approval")));
    assert.ok(sourceScoutPermissionPack.items.every((item) => item.sourceScoutIntakeCsvRow.includes("owned_or_permissioned")));
    assert.equal(status.metricoolExecutionQueue.realPublishEnabled, false);
    assert.equal(status.sourceScoutPermissionPack.manifestPath, sourceScoutPermissionPack.manifestPath);

    const rawMarkdown = await readFile(sourceScoutPermissionPack.markdownPath, "utf8");
    const rawCsv = await readFile(sourceScoutPermissionPack.csvPath, "utf8");
    assert.ok(rawMarkdown.includes("does not grant rights"));
    assert.ok(rawCsv.includes("official_source_policy_url"));
    assert.ok(rawCsv.includes("source_scout_intake_csv_row"));
    assert.equal(rawMarkdown.includes("client_secret"), false);
    assert.equal(rawCsv.includes("refresh_token"), false);
  } finally {
    if (previousManifest === null) await unlink(path.join(beforeStatus.rootDir, "source-scout-permission-pack.json")).catch(() => undefined);
    else await writeFile(path.join(beforeStatus.rootDir, "source-scout-permission-pack.json"), previousManifest);
    if (previousMarkdown === null) await unlink(path.join(beforeStatus.rootDir, "source-scout-permission-pack.md")).catch(() => undefined);
    else await writeFile(path.join(beforeStatus.rootDir, "source-scout-permission-pack.md"), previousMarkdown);
    if (previousCsv === null) await unlink(path.join(beforeStatus.rootDir, "source-scout-permission-pack.csv")).catch(() => undefined);
    else await writeFile(path.join(beforeStatus.rootDir, "source-scout-permission-pack.csv"), previousCsv);
  }
});

test("source scout permission policy requires Twitch streamer rights beyond clips API scope", () => {
  const policy = __clipperInternals.sourceScoutOfficialSourcePolicy({
    category: "streamers",
  } as any);

  assert.equal(policy.officialSourcePolicyPlatform, "twitch");
  assert.equal(policy.officialSourcePermissionScope, "clips:edit");
  assert.ok(policy.officialSourcePolicyUrl.includes("dev.twitch.tv"));
  assert.ok(policy.officialSourceRules.some((rule: string) => rule.includes("does not grant repost rights")));
  assert.ok(policy.officialSourceRules.some((rule: string) => rule.includes("broadcaster, creator, or rightsholder permission")));
  assert.ok(policy.officialSourceRules.some((rule: string) => rule.includes("delegated off-platform reuse rights")));
  assert.ok(policy.officialSourceNextAction.includes("not reuse rights"));

  const sportsPolicy = __clipperInternals.sourceScoutOfficialSourcePolicy({
    category: "sports",
  } as any);
  assert.equal(sportsPolicy.officialSourcePolicyPlatform, null);
  assert.deepEqual(sportsPolicy.officialSourceRules, []);
});

test("prepareClipperSourceScoutWorkQueue writes prioritized blocker queue without publishing", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(path.join(beforeStatus.rootDir, "source-scout-work-queue.json"), "utf8").catch(() => null);
  const previousMarkdown = await readFile(path.join(beforeStatus.rootDir, "source-scout-work-queue.md"), "utf8").catch(() => null);
  const previousCsv = await readFile(path.join(beforeStatus.rootDir, "source-scout-work-queue.csv"), "utf8").catch(() => null);

  try {
    await prepareClipperSourceScout();
    await prepareClipperSourceScoutPermissionPack();
    await prepareClipperWeeklyProductionFunnel();
    const { sourceScoutWorkQueue, status } = await prepareClipperSourceScoutWorkQueue();

    assert.ok(sourceScoutWorkQueue.manifestPath.endsWith("source-scout-work-queue.json"));
    assert.ok(sourceScoutWorkQueue.markdownPath.endsWith("source-scout-work-queue.md"));
    assert.ok(sourceScoutWorkQueue.csvPath.endsWith("source-scout-work-queue.csv"));
    assert.equal(status.sourceScoutWorkQueue.manifestPath, sourceScoutWorkQueue.manifestPath);
    assert.ok(sourceScoutWorkQueue.totals.items > 0);
    assert.ok(sourceScoutWorkQueue.totals.exactUrlIntake > 0 || sourceScoutWorkQueue.totals.rightsEvidence > 0 || sourceScoutWorkQueue.totals.sourceFile > 0 || sourceScoutWorkQueue.totals.metricoolApproval > 0);
    assert.ok(sourceScoutWorkQueue.items.every((item) => item.type !== "metricool_approval" || item.publishGate === "approval_required"));
    assert.ok(sourceScoutWorkQueue.items.every((item) => item.type !== "exact_url_intake" || item.sourceUrlKind === "discovery_search"));
    assert.ok(sourceScoutWorkQueue.items.every((item) => !item.intakeCsvRow || item.intakeCsvRow.includes("<paste exact video/post URL>") || item.sourceUrlKind === "exact_video_or_post"));
    assert.equal(status.metricoolExecutionQueue.realPublishEnabled, false);
    assert.equal(status.metricoolExecutionQueue.totals.readyToSend, 0);

    const rawMarkdown = await readFile(sourceScoutWorkQueue.markdownPath, "utf8");
    const rawCsv = await readFile(sourceScoutWorkQueue.csvPath, "utf8");
    assert.ok(rawMarkdown.includes("does not create accounts, grant permissions, or publish automatically"));
    assert.ok(rawMarkdown.includes("Exact URL intake"));
    assert.ok(rawCsv.includes("intake_csv_row"));
    assert.equal(rawMarkdown.includes("client_secret"), false);
    assert.equal(rawCsv.includes("refresh_token"), false);
  } finally {
    if (previousManifest === null) await unlink(path.join(beforeStatus.rootDir, "source-scout-work-queue.json")).catch(() => undefined);
    else await writeFile(path.join(beforeStatus.rootDir, "source-scout-work-queue.json"), previousManifest);
    if (previousMarkdown === null) await unlink(path.join(beforeStatus.rootDir, "source-scout-work-queue.md")).catch(() => undefined);
    else await writeFile(path.join(beforeStatus.rootDir, "source-scout-work-queue.md"), previousMarkdown);
    if (previousCsv === null) await unlink(path.join(beforeStatus.rootDir, "source-scout-work-queue.csv")).catch(() => undefined);
    else await writeFile(path.join(beforeStatus.rootDir, "source-scout-work-queue.csv"), previousCsv);
  }
});

test("prepareClipperSourceScoutExactUrlKit writes search links for discovery leads without claiming exact URLs", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(path.join(beforeStatus.rootDir, "source-scout-exact-url-kit.json"), "utf8").catch(() => null);
  const previousMarkdown = await readFile(path.join(beforeStatus.rootDir, "source-scout-exact-url-kit.md"), "utf8").catch(() => null);
  const previousCsv = await readFile(path.join(beforeStatus.rootDir, "source-scout-exact-url-kit.csv"), "utf8").catch(() => null);

  try {
    await prepareClipperSourceScout();
    await prepareClipperSourceScoutWorkQueue();
    const { sourceScoutExactUrlKit, status } = await prepareClipperSourceScoutExactUrlKit();

    assert.ok(sourceScoutExactUrlKit.manifestPath.endsWith("source-scout-exact-url-kit.json"));
    assert.ok(sourceScoutExactUrlKit.markdownPath.endsWith("source-scout-exact-url-kit.md"));
    assert.ok(sourceScoutExactUrlKit.csvPath.endsWith("source-scout-exact-url-kit.csv"));
    assert.equal(status.sourceScoutExactUrlKit.manifestPath, sourceScoutExactUrlKit.manifestPath);
    assert.equal(sourceScoutExactUrlKit.totals.items, sourceScoutExactUrlKit.items.length);
    assert.ok(sourceScoutExactUrlKit.items.every((item) => item.currentUrlKind === "discovery_search"));
    assert.ok(sourceScoutExactUrlKit.items.every((item) => item.platformSearchUrl.startsWith("https://")));
    assert.ok(sourceScoutExactUrlKit.items.every((item) => item.googleSearchUrl.includes("google.com/search")));
    assert.ok(sourceScoutExactUrlKit.items.every((item) => item.intakeCsvRow.includes("<paste exact video/post URL>")));
    assert.ok(sourceScoutExactUrlKit.items.every((item) => item.validationChecklist.some((check) => check.includes("Reject search"))));
    assert.equal(status.metricoolExecutionQueue.realPublishEnabled, false);
    assert.equal(status.metricoolExecutionQueue.totals.readyToSend, 0);

    const rawMarkdown = await readFile(sourceScoutExactUrlKit.markdownPath, "utf8");
    const rawCsv = await readFile(sourceScoutExactUrlKit.csvPath, "utf8");
    assert.ok(rawMarkdown.includes("does not verify rights, create accounts, or publish anything"));
    assert.ok(sourceScoutExactUrlKit.totals.items === 0 || rawMarkdown.includes("Platform search"));
    assert.ok(rawCsv.includes("platform_search_url"));
    assert.equal(rawMarkdown.includes("client_secret"), false);
    assert.equal(rawCsv.includes("refresh_token"), false);
  } finally {
    if (previousManifest === null) await unlink(path.join(beforeStatus.rootDir, "source-scout-exact-url-kit.json")).catch(() => undefined);
    else await writeFile(path.join(beforeStatus.rootDir, "source-scout-exact-url-kit.json"), previousManifest);
    if (previousMarkdown === null) await unlink(path.join(beforeStatus.rootDir, "source-scout-exact-url-kit.md")).catch(() => undefined);
    else await writeFile(path.join(beforeStatus.rootDir, "source-scout-exact-url-kit.md"), previousMarkdown);
    if (previousCsv === null) await unlink(path.join(beforeStatus.rootDir, "source-scout-exact-url-kit.csv")).catch(() => undefined);
    else await writeFile(path.join(beforeStatus.rootDir, "source-scout-exact-url-kit.csv"), previousCsv);
  }
});

test("prepareClipperSourceScoutDailySprint writes daily lead and exact URL gaps without fake readiness", async () => {
  const beforeStatus = await getClipperStatus();
  const artifactNames = [
    "source-scout-candidates.json",
    "source-scout-candidates.md",
    "source-scout-candidates.csv",
    "source-scout-work-queue.json",
    "source-scout-work-queue.md",
    "source-scout-work-queue.csv",
    "source-scout-exact-url-kit.json",
    "source-scout-exact-url-kit.md",
    "source-scout-exact-url-kit.csv",
    "source-scout-daily-sprint.json",
    "source-scout-daily-sprint.md",
    "source-scout-daily-sprint.csv",
    "weekly-production-funnel.json",
    "weekly-production-funnel.md",
    "weekly-production-funnel.csv",
  ];
  const previousArtifacts = new Map<string, string | null>();
  for (const fileName of artifactNames) {
    const filePath = path.join(beforeStatus.rootDir, fileName);
    previousArtifacts.set(filePath, await readFile(filePath, "utf8").catch(() => null));
  }

  try {
    const { sourceScoutDailySprint, status } = await prepareClipperSourceScoutDailySprint();

    assert.ok(sourceScoutDailySprint.manifestPath.endsWith("source-scout-daily-sprint.json"));
    assert.ok(sourceScoutDailySprint.markdownPath.endsWith("source-scout-daily-sprint.md"));
    assert.ok(sourceScoutDailySprint.csvPath.endsWith("source-scout-daily-sprint.csv"));
    assert.equal(status.sourceScoutDailySprint.manifestPath, sourceScoutDailySprint.manifestPath);
    assert.equal(sourceScoutDailySprint.targets.dailyScoutLeads, 45);
    assert.equal(sourceScoutDailySprint.targets.dailyExactUrls, 30);
    assert.equal(sourceScoutDailySprint.targets.metricoolApprovalMin, 14);
    assert.equal(sourceScoutDailySprint.targets.metricoolApprovalMax, 16);
    assert.equal(sourceScoutDailySprint.totals.currentScoutLeads, status.sourceScout.totals.candidates);
    assert.equal(sourceScoutDailySprint.totals.currentExactUrls, status.weeklyProductionFunnel.totals.exactUrls);
    assert.equal(sourceScoutDailySprint.totals.exactUrlTasks, status.sourceScoutExactUrlKit.totals.items);
    assert.ok(sourceScoutDailySprint.totals.leadGap >= 0);
    assert.ok(sourceScoutDailySprint.totals.exactUrlGap >= 0);
    assert.ok(sourceScoutDailySprint.guardrails.some((guardrail) => guardrail.includes("Discovery/search")));
    assert.ok(sourceScoutDailySprint.categoryRows.some((row) => row.category === "sports" && row.leadTarget > 0 && row.exactUrlTarget > 0));
    assert.ok(sourceScoutDailySprint.categoryRows.some((row) => row.category === "memes" && row.leadTarget > 0 && row.exactUrlTarget > 0));
    assert.ok(sourceScoutDailySprint.categoryRows.every((row) => row.intakeTemplateRows.every((templateRow) => templateRow.includes("<paste exact video/post URL only>"))));
    assert.ok(sourceScoutDailySprint.searchMissions.length > 0);
    assert.ok(sourceScoutDailySprint.searchMissions.every((mission) => mission.searchUrl.startsWith("https://")));
    assert.ok(sourceScoutDailySprint.searchMissions.every((mission) => mission.trendCandidateBatchRows.length > 0));
    assert.ok(sourceScoutDailySprint.searchMissions.every((mission) => mission.trendCandidateBatchRows.every((row) => row.includes("<paste exact video/post URL only>"))));
    assert.ok(sourceScoutDailySprint.searchMissions.every((mission) => mission.trendCandidateBatchRows.every((row) => row.split(",")[1] === mission.platform)));
    assert.ok(sourceScoutDailySprint.searchMissions.every((mission) => mission.validationChecklist.some((check) => check.includes("Reject search"))));
    const youtubeMission = sourceScoutDailySprint.searchMissions.find((mission) => mission.query.includes("site:youtube.com"));
    const instagramMission = sourceScoutDailySprint.searchMissions.find((mission) => mission.query.includes("site:instagram.com"));
    if (youtubeMission) {
      assert.equal(youtubeMission.platform, "youtube");
      assert.ok(youtubeMission.searchUrl.includes("youtube.com/results"));
    }
    if (instagramMission) {
      assert.equal(instagramMission.platform, "instagram");
      assert.ok(instagramMission.searchUrl.includes("google.com/search"));
      assert.ok(decodeURIComponent(instagramMission.searchUrl).includes("site:instagram.com/reel"));
    }
    const sportsTemplate = sourceScoutDailySprint.categoryRows.find((row) => row.category === "sports")?.intakeTemplateRows[0];
    if (sportsTemplate) {
      const cells = sportsTemplate.split(",");
      assert.equal(cells[0], "");
      assert.ok(cells[1].includes("<paste viral sports title"));
      assert.equal(cells[2], "sports");
      assert.equal(cells[3], "tiktok");
      assert.equal(cells[4], "<paste exact video/post URL only>");
      assert.equal(cells[6], "review_required");
    }
    assert.ok(await readFile(path.join(beforeStatus.rootDir, "source-scout-exact-url-kit.md"), "utf8"));
    assert.ok(await readFile(path.join(beforeStatus.rootDir, "weekly-production-funnel.md"), "utf8"));
    assert.equal(status.metricoolExecutionQueue.realPublishEnabled, false);
    assert.equal(status.metricoolExecutionQueue.totals.readyToSend, 0);

    const rawMarkdown = await readFile(sourceScoutDailySprint.markdownPath, "utf8");
    const rawCsv = await readFile(sourceScoutDailySprint.csvPath, "utf8");
    assert.ok(rawMarkdown.includes("without fake readiness"));
    assert.ok(rawMarkdown.includes("Discovery/search/explore/hashtag URLs never count"));
    assert.ok(rawMarkdown.includes("Search Missions"));
    assert.ok(rawMarkdown.includes("Trend Candidates Batch rows"));
    assert.ok(rawCsv.includes("lead_gap"));
    assert.ok(rawCsv.includes("trend_candidate_batch_rows"));
    assert.equal(rawMarkdown.includes("access_token"), false);
    assert.equal(rawCsv.includes("client_secret"), false);
  } finally {
    for (const [filePath, previous] of previousArtifacts) {
      if (previous === null) await unlink(filePath).catch(() => undefined);
      else await writeFile(filePath, previous);
    }
  }
});

test("prepareClipperSourceScoutSourceFileKit writes source-drop checklist without fake media", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(path.join(beforeStatus.rootDir, "source-scout-source-file-kit.json"), "utf8").catch(() => null);
  const previousMarkdown = await readFile(path.join(beforeStatus.rootDir, "source-scout-source-file-kit.md"), "utf8").catch(() => null);
  const previousCsv = await readFile(path.join(beforeStatus.rootDir, "source-scout-source-file-kit.csv"), "utf8").catch(() => null);

  try {
    await prepareClipperSourceScout();
    await prepareClipperSourceScoutWorkQueue();
    const { sourceScoutSourceFileKit, status } = await prepareClipperSourceScoutSourceFileKit();

    assert.ok(sourceScoutSourceFileKit.manifestPath.endsWith("source-scout-source-file-kit.json"));
    assert.ok(sourceScoutSourceFileKit.markdownPath.endsWith("source-scout-source-file-kit.md"));
    assert.ok(sourceScoutSourceFileKit.csvPath.endsWith("source-scout-source-file-kit.csv"));
    assert.equal(status.sourceScoutSourceFileKit.manifestPath, sourceScoutSourceFileKit.manifestPath);
    assert.ok(sourceScoutSourceFileKit.totals.items >= 0);
    assert.equal(sourceScoutSourceFileKit.totals.items, sourceScoutSourceFileKit.totals.missingSourceFiles + sourceScoutSourceFileKit.totals.existingSourceFiles);
    assert.ok(sourceScoutSourceFileKit.items.every((item) => item.expectedSourcePath.includes(path.join("source-drop", item.category))));
    assert.ok(sourceScoutSourceFileKit.items.every((item) => item.manifestRow.includes("owned_or_permissioned") || item.manifestRow.includes("review_required")));
    assert.ok(sourceScoutSourceFileKit.items.every((item) => item.checklist.some((check) => check.includes("do not use placeholder"))));
    assert.equal(status.metricoolExecutionQueue.realPublishEnabled, false);
    assert.equal(status.metricoolExecutionQueue.totals.readyToSend, 0);

    const rawMarkdown = await readFile(sourceScoutSourceFileKit.markdownPath, "utf8");
    const rawCsv = await readFile(sourceScoutSourceFileKit.csvPath, "utf8");
    assert.ok(rawMarkdown.includes("does not create fake videos"));
    if (sourceScoutSourceFileKit.totals.items > 0) assert.ok(rawMarkdown.includes("Manifest row"));
    assert.ok(rawCsv.includes("expected_source_path"));
    assert.equal(rawMarkdown.includes("client_secret"), false);
    assert.equal(rawCsv.includes("refresh_token"), false);
  } finally {
    if (previousManifest === null) await unlink(path.join(beforeStatus.rootDir, "source-scout-source-file-kit.json")).catch(() => undefined);
    else await writeFile(path.join(beforeStatus.rootDir, "source-scout-source-file-kit.json"), previousManifest);
    if (previousMarkdown === null) await unlink(path.join(beforeStatus.rootDir, "source-scout-source-file-kit.md")).catch(() => undefined);
    else await writeFile(path.join(beforeStatus.rootDir, "source-scout-source-file-kit.md"), previousMarkdown);
    if (previousCsv === null) await unlink(path.join(beforeStatus.rootDir, "source-scout-source-file-kit.csv")).catch(() => undefined);
    else await writeFile(path.join(beforeStatus.rootDir, "source-scout-source-file-kit.csv"), previousCsv);
  }
});

test("prepareClipperSourceScoutSourceFileKit does not count fake local media as existing", async () => {
  const beforeStatus = await getClipperStatus();
  const trendsDir = beforeStatus.trendRadar.trendsDir;
  const allowlistPath = path.join(beforeStatus.rootDir, "allowlist", "https-www-tiktok-com-creator-video-6234567890123456789.md");
  const fakeDropPath = path.join(beforeStatus.rootDir, "source-drop", "memes", "memes-fake-source-file-kit.mp4");
  const previousTrendSummary = await readFile(beforeStatus.trendRadar.summaryPath, "utf8").catch(() => null);
  const previousManifest = await readFile(path.join(beforeStatus.rootDir, "source-scout-source-file-kit.json"), "utf8").catch(() => null);
  const previousMarkdown = await readFile(path.join(beforeStatus.rootDir, "source-scout-source-file-kit.md"), "utf8").catch(() => null);
  const previousCsv = await readFile(path.join(beforeStatus.rootDir, "source-scout-source-file-kit.csv"), "utf8").catch(() => null);
  const previousTrendFiles = new Set(await readdir(trendsDir).catch(() => []));

  await mkdir(path.dirname(allowlistPath), { recursive: true });
  await mkdir(path.dirname(fakeDropPath), { recursive: true });
  await writeFile(allowlistPath, "# Permission\nCreator proof stored for source file kit fake media test.");
  await writeFile(fakeDropPath, "not-a-real-mp4".repeat(200));

  try {
    await recordClipperTrendCandidatesBatch({
      batchText: [
        "category,platform,title,url,source,posted_at,views,likes,comments,shares,rights,angle",
        "memes,tiktok,Fake source file kit,https://www.tiktok.com/@creator/video/6234567890123456789,@creator,2026-06-20T20:00:00Z,999999999999,0,0,0,approved,Proof exists but source file is fake",
      ].join("\n"),
    });
    await prepareClipperSourceScout();
    await prepareClipperSourceScoutWorkQueue();
    const { sourceScoutSourceFileKit } = await prepareClipperSourceScoutSourceFileKit();
    const item = sourceScoutSourceFileKit.items.find((candidate) => candidate.title === "Fake source file kit");
    assert.ok(item);
    assert.equal(item.sourceFileExists, false);
    assert.equal(sourceScoutSourceFileKit.status, "blocked");
  } finally {
    await unlink(allowlistPath).catch(() => undefined);
    await unlink(fakeDropPath).catch(() => undefined);
    const afterTrendFiles = await readdir(trendsDir).catch(() => []);
    await Promise.all(afterTrendFiles
      .filter((fileName) => !previousTrendFiles.has(fileName) && fileName.startsWith("trend-candidates-"))
      .map((fileName) => unlink(path.join(trendsDir, fileName)).catch(() => undefined)));
    if (previousTrendSummary === null) await unlink(beforeStatus.trendRadar.summaryPath).catch(() => undefined);
    else await writeFile(beforeStatus.trendRadar.summaryPath, previousTrendSummary);
    if (previousManifest === null) await unlink(path.join(beforeStatus.rootDir, "source-scout-source-file-kit.json")).catch(() => undefined);
    else await writeFile(path.join(beforeStatus.rootDir, "source-scout-source-file-kit.json"), previousManifest);
    if (previousMarkdown === null) await unlink(path.join(beforeStatus.rootDir, "source-scout-source-file-kit.md")).catch(() => undefined);
    else await writeFile(path.join(beforeStatus.rootDir, "source-scout-source-file-kit.md"), previousMarkdown);
    if (previousCsv === null) await unlink(path.join(beforeStatus.rootDir, "source-scout-source-file-kit.csv")).catch(() => undefined);
    else await writeFile(path.join(beforeStatus.rootDir, "source-scout-source-file-kit.csv"), previousCsv);
  }
});

test("source scout URL classifier separates exact posts from discovery searches", () => {
  assert.ok(__clipperInternals.exactSourceUrlRejectReason("https://www.tiktok.com/search?q=sports"));
  assert.equal(__clipperInternals.exactSourceUrlRejectReason("https://www.youtube.com/shorts/abc123"), null);
  assert.equal(__clipperInternals.exactSourceUrlRejectReason("https://www.instagram.com/reel/abc123/"), null);
  assert.ok(__clipperInternals.exactSourceUrlRejectReason("https://www.youtube.com/results?search_query=memes"));
  assert.ok(__clipperInternals.exactSourceUrlRejectReason("https://www.youtube.com/watch?v="));
  assert.ok(__clipperInternals.exactSourceUrlRejectReason("https://www.youtube.com/shorts/"));
  assert.ok(__clipperInternals.exactSourceUrlRejectReason("https://www.instagram.com/reel/"));
  assert.ok(__clipperInternals.exactSourceUrlRejectReason("https://evil-tiktok.com/@creator/video/1234567890123456789"));
  assert.ok(__clipperInternals.exactSourceUrlRejectReason("https://example.com/comeback"));
});

test("source scout exact URL counting dedupes candidates already recorded in intake", () => {
  const count = __clipperInternals.sourceScoutUniqueExactUrlCount({
    sourceScout: {
      candidates: [
        {
          id: "candidate-1",
          category: "sports",
          platform: "tiktok",
          title: "Same exact URL",
          sourceUrl: "https://www.tiktok.com/@sportsdaily/video/1234567890123456789",
          sourceUrlKind: "exact_video_or_post",
        },
        {
          id: "candidate-2",
          category: "sports",
          platform: "tiktok",
          title: "Discovery lead",
          sourceUrl: "https://www.tiktok.com/search?q=sports",
          sourceUrlKind: "discovery_search",
        },
      ],
    },
    sourceScoutIntake: {
      items: [
        {
          candidateId: "candidate-1",
          category: "sports",
          platform: "tiktok",
          title: "Same exact URL",
          sourceUrl: "https://www.tiktok.com/@sportsdaily/video/1234567890123456789",
          sourceUrlKind: "exact_video_or_post",
          decision: "blocked_rights",
        },
        {
          candidateId: "",
          category: "sports",
          platform: "tiktok",
          title: "Second exact URL",
          sourceUrl: "https://www.tiktok.com/@sportsdaily/video/9999999999999999999?share=1",
          sourceUrlKind: "exact_video_or_post",
          decision: "blocked_rights",
        },
        {
          candidateId: "",
          category: "memes",
          platform: "tiktok",
          title: "Other category",
          sourceUrl: "https://www.tiktok.com/@memeradar/video/8888888888888888888",
          sourceUrlKind: "exact_video_or_post",
          decision: "blocked_rights",
        },
      ],
    },
  });
  const sportsCount = __clipperInternals.sourceScoutUniqueExactUrlCount({
    category: "sports",
    sourceScout: {
      candidates: [
        {
          id: "candidate-1",
          category: "sports",
          platform: "tiktok",
          title: "Same exact URL",
          sourceUrl: "https://www.tiktok.com/@sportsdaily/video/1234567890123456789",
          sourceUrlKind: "exact_video_or_post",
        },
      ],
    },
    sourceScoutIntake: {
      items: [
        {
          candidateId: "candidate-1",
          category: "sports",
          platform: "tiktok",
          title: "Same exact URL",
          sourceUrl: "https://www.tiktok.com/@sportsdaily/video/1234567890123456789",
          sourceUrlKind: "exact_video_or_post",
          decision: "blocked_rights",
        },
      ],
    },
  });
  const youtubeWatchCount = __clipperInternals.sourceScoutUniqueExactUrlCount({
    sourceScout: {
      candidates: [],
    },
    sourceScoutIntake: {
      items: [
        {
          candidateId: "",
          category: "sports",
          platform: "youtube",
          title: "Watch A",
          sourceUrl: "https://www.youtube.com/watch?v=aaa111&utm_source=share",
          sourceUrlKind: "exact_video_or_post",
          decision: "blocked_rights",
        },
        {
          candidateId: "",
          category: "sports",
          platform: "youtube",
          title: "Watch B",
          sourceUrl: "https://www.youtube.com/watch?v=bbb222&utm_source=share",
          sourceUrlKind: "exact_video_or_post",
          decision: "blocked_rights",
        },
      ],
    },
  });
  assert.equal(count, 3);
  assert.equal(sportsCount, 1);
  assert.equal(youtubeWatchCount, 2);
});

test("source asset scanner flags fixture-like file names as non-production artifacts", () => {
  assert.equal(__clipperInternals.sourceAssetLooksTestArtifact("drop-approved-test-2.mp4"), true);
  assert.equal(__clipperInternals.sourceAssetLooksTestArtifact("source-scout-ready-test-intake.mp4"), true);
  assert.equal(__clipperInternals.sourceAssetLooksTestArtifact("sports-owned-01.mp4"), false);
  assert.equal(__clipperInternals.sourceAssetLooksTestArtifact("queue-highlight.mp4"), false);
});

test("source rights evidence rejects bare status words", () => {
  assert.throws(() => __clipperInternals.requireSourceRightsEvidence("licensed"), /evidencia concreta|palabra de estado/i);
  assert.throws(() => __clipperInternals.requireSourceRightsEvidence("owner note"), /evidencia concreta|palabra de estado/i);
  assert.throws(() => __clipperInternals.requireSourceRightsEvidence("approved"), /evidencia concreta|palabra de estado/i);
  assert.equal(
    __clipperInternals.requireSourceRightsEvidence("owner note path: /tmp/owned-source-proof.md"),
    "owner note path: /tmp/owned-source-proof.md",
  );
});

test("source scout evidence validation rejects weak proof and accepts concrete creator permission", () => {
  assert.throws(() => __clipperInternals.validateSourceScoutEvidence({
    requestedStatus: "owned_or_permissioned",
    sourceUrlKind: "exact_video_or_post",
    proof: "",
    notes: "Creator gave permission in writing for short-form use.",
    evidenceType: "creator_permission",
    sourceFileExists: false,
  }), /evidencia concreta|requiere/i);
  assert.throws(() => __clipperInternals.validateSourceScoutEvidence({
    requestedStatus: "owned_or_permissioned",
    sourceUrlKind: "exact_video_or_post",
    proof: "<paste proof>",
    notes: "Creator gave permission in writing for short-form use.",
    evidenceType: "creator_permission",
    sourceFileExists: false,
  }), /evidencia concreta|requiere/i);
  assert.throws(() => __clipperInternals.validateSourceScoutEvidence({
    requestedStatus: "owned_or_permissioned",
    sourceUrlKind: "exact_video_or_post",
    proof: "https://example.com/proof",
    notes: "Creator gave permission in writing for short-form use.",
    evidenceType: "creator_permission",
    sourceFileExists: false,
  }), /placeholder|ejemplo|evidencia real/i);
  assert.doesNotThrow(() => __clipperInternals.validateSourceScoutEvidence({
    requestedStatus: "owned_or_permissioned",
    sourceUrlKind: "exact_video_or_post",
    proof: "https://drive.google.com/file/d/source-scout-proof",
    notes: "Creator permission confirmed in writing for TikTok clips and edited reposts.",
    evidenceType: "creator_permission",
    sourceFileExists: false,
  }));
});

test("rights evidence ledger does not report ready when prepared with zero items", () => {
  const summary = __clipperInternals.buildRightsEvidenceLedgerSummary({
    sourceScoutIntake: { items: [] },
    productionQueue: { sourceAssets: [] },
    preparedAt: "2026-06-22T00:00:00.000Z",
  } as any);

  assert.equal(summary.status, "not_prepared");
  assert.equal(summary.totals.items, 0);
  assert.equal(summary.totals.ready, 0);
  assert.match(summary.nextStep, /Record Source Scout intake|source-drop assets/i);
});

test("prepareClipperRightsEvidenceLedger audits proof and source-file blockers without fake readiness", async () => {
  const beforeStatus = await getClipperStatus();
  const artifactPaths = [
    path.join(beforeStatus.rootDir, "source-scout-intake.json"),
    path.join(beforeStatus.rootDir, "source-scout-intake.md"),
    path.join(beforeStatus.rootDir, "source-scout-intake.csv"),
    path.join(beforeStatus.rootDir, "rights-evidence-ledger.json"),
    path.join(beforeStatus.rootDir, "rights-evidence-ledger.md"),
    path.join(beforeStatus.rootDir, "rights-evidence-ledger.csv"),
    path.join(beforeStatus.rootDir, "source-drop", "sports", "source-drop-manifest.csv"),
    path.join(beforeStatus.rootDir, "source-drop", "memes", "source-drop-manifest.csv"),
    path.join(beforeStatus.rootDir, "source-drop", "streamers", "source-drop-manifest.csv"),
    path.join(beforeStatus.rootDir, "trends", "trend-radar-summary.json"),
    path.join(beforeStatus.rootDir, "scheduled", "metricool-execution-queue.json"),
    path.join(beforeStatus.rootDir, "scheduled", "metricool-execution-queue.md"),
    path.join(beforeStatus.rootDir, "scheduled", "metricool-execution-queue.csv"),
  ];
  const trendsDir = path.join(beforeStatus.rootDir, "trends");
  const previousTrendCandidateFiles = new Set(
    (await readdir(trendsDir).catch(() => []))
      .filter((fileName) => /^trend-candidates-\d{4}-\d{2}-\d{2}t/i.test(fileName)),
  );
  const previousArtifacts = new Map<string, string | null>();
  for (const filePath of artifactPaths) {
    previousArtifacts.set(filePath, await readFile(filePath, "utf8").catch(() => null));
  }
  const fixtureSourcePath = path.join(beforeStatus.rootDir, "sources", "sports", "ledger-fixture-test.mp4");
  const fixtureEvidencePath = path.join(beforeStatus.rootDir, "allowlist", "ledger-fixture-test.md");
  const previousFixtureSource = await readFile(fixtureSourcePath).catch(() => null);
  const previousFixtureEvidence = await readFile(fixtureEvidencePath, "utf8").catch(() => null);

  try {
    writeTinyTestVideo(fixtureSourcePath);
    await writeFile(fixtureEvidencePath, [
      "# Fixture source rights evidence",
      "",
      "status: owned_or_permissioned",
      "notes: Test fixture evidence should never count as production readiness or block the operational ledger.",
      "",
    ].join("\n"));
    await recordClipperSourceScoutIntake({
      records: [
        {
          title: "Ledger missing source file",
          category: "memes",
          platform: "tiktok",
          url: "https://www.tiktok.com/@creator/video/4234567890123456789",
          source: "@creator",
          status: "owned_or_permissioned",
          evidence_type: "creator_permission",
          proof: "Drive proof access_token=ledger-secret-token client_secret: ledger-secret-client",
          notes: "Creator permission confirmed in writing for edited short-form reposting on our account.",
          target_file_name: "ledger-missing-source.mp4",
          source_drop_path: path.join(beforeStatus.rootDir, "source-drop", "memes", "ledger-missing-source.mp4"),
        },
        {
          title: "Ledger review required",
          category: "sports",
          platform: "youtube",
          url: "https://www.youtube.com/shorts/ledgerreviewrequired",
          source: "Official-looking channel",
          status: "review_required",
          views: "240000",
        },
        {
          title: "Ledger recreate from discovery search",
          category: "memes",
          platform: "tiktok",
          url: "https://www.tiktok.com/search?q=caption%20meme%20trend",
          source: "trend search",
          status: "recreate_only",
          recreate_plan: "Recreate only the caption pattern with original script, generated visuals and owned narration.",
        },
        {
          title: "Ledger missing proof",
          category: "memes",
          platform: "tiktok",
          url: "https://www.tiktok.com/@creator/video/5234567890123456789",
          source: "@creator",
          status: "owned_or_permissioned",
          evidence_type: "creator_permission",
          notes: "Creator permission is claimed here but proof URL is missing and must stay blocked.",
        },
      ],
    });

    const { rightsEvidenceLedger, status } = await prepareClipperRightsEvidenceLedger();
    const missingSource = rightsEvidenceLedger.items.find((item) => item.title === "Ledger missing source file");
    const reviewRequired = rightsEvidenceLedger.items.find((item) => item.title === "Ledger review required");
    const recreateFromDiscovery = rightsEvidenceLedger.items.find((item) => item.title === "Ledger recreate from discovery search");
    const missingProof = rightsEvidenceLedger.items.find((item) => item.title === "Ledger missing proof");
    const fixture = rightsEvidenceLedger.items.find((item) => item.title === "ledger-fixture-test.mp4");

    assert.ok(rightsEvidenceLedger.manifestPath.endsWith("rights-evidence-ledger.json"));
    assert.ok(rightsEvidenceLedger.markdownPath.endsWith("rights-evidence-ledger.md"));
    assert.ok(rightsEvidenceLedger.csvPath.endsWith("rights-evidence-ledger.csv"));
    assert.equal(status.rightsEvidenceLedger.manifestPath, rightsEvidenceLedger.manifestPath);
    assert.equal(rightsEvidenceLedger.status, "blocked");
    assert.ok(rightsEvidenceLedger.totals.blocked >= 2);
    assert.ok(rightsEvidenceLedger.totals.missingSourceFile >= 1);
    assert.ok(rightsEvidenceLedger.totals.reviewRequired >= 1);
    assert.ok(rightsEvidenceLedger.totals.missingProof >= 1);
    assert.equal(missingSource?.issue, "missing_source_file");
    assert.equal(missingSource?.evidenceAccepted, true);
    assert.equal(missingSource?.sourceFileExists, false);
    assert.equal(missingSource?.evidencePath?.includes("ledger-secret-token"), false);
    assert.equal(reviewRequired?.issue, "review_required");
    assert.equal(reviewRequired?.severity, "blocked");
    assert.equal(recreateFromDiscovery?.sourceUrlKind, "discovery_search");
    assert.equal(recreateFromDiscovery?.issue, "missing_source_file");
    assert.equal(recreateFromDiscovery?.evidenceAccepted, true);
    assert.equal(recreateFromDiscovery?.severity, "blocked");
    assert.equal(missingProof?.issue, "missing_proof");
    assert.equal(missingProof?.severity, "blocked");
    assert.equal(missingProof?.evidencePath, null);
    assert.equal(fixture, undefined);
    assert.ok(rightsEvidenceLedger.items.every((item) => item.severity !== "ready" || (item.evidenceAccepted && item.sourceFileExists)));
    assert.equal(status.metricoolExecutionQueue.realPublishEnabled, false);
    assert.equal(status.metricoolExecutionQueue.totals.readyToSend, 0);

    const rawMarkdown = await readFile(rightsEvidenceLedger.markdownPath, "utf8");
    const rawCsv = await readFile(rightsEvidenceLedger.csvPath, "utf8");
    const rawManifest = await readFile(rightsEvidenceLedger.manifestPath, "utf8");
    assert.ok(rawMarkdown.includes("does not publish"));
    assert.ok(rawCsv.includes("repair_csv_row"));
    assert.equal([rawManifest, rawMarkdown, rawCsv].join("\n").includes("ledger-secret-token"), false);
    assert.equal([rawManifest, rawMarkdown, rawCsv].join("\n").includes("ledger-secret-client"), false);
    assert.ok([rawManifest, rawMarkdown, rawCsv].join("\n").includes("access_token=[redacted]"));
    assert.ok([rawManifest, rawMarkdown, rawCsv].join("\n").includes("client_secret: [redacted]"));
  } finally {
    if (previousFixtureSource === null) await unlink(fixtureSourcePath).catch(() => undefined);
    else await writeFile(fixtureSourcePath, previousFixtureSource);
    if (previousFixtureEvidence === null) await unlink(fixtureEvidencePath).catch(() => undefined);
    else await writeFile(fixtureEvidencePath, previousFixtureEvidence);
    for (const [filePath, previous] of previousArtifacts) {
      if (previous === null) await unlink(filePath).catch(() => undefined);
      else await writeFile(filePath, previous);
    }
    const nextTrendCandidateFiles = (await readdir(trendsDir).catch(() => []))
      .filter((fileName) => /^trend-candidates-\d{4}-\d{2}-\d{2}t/i.test(fileName));
    for (const fileName of nextTrendCandidateFiles) {
      if (!previousTrendCandidateFiles.has(fileName)) {
        await unlink(path.join(trendsDir, fileName)).catch(() => undefined);
      }
    }
  }
});

test("recordClipperSourceScoutIntake enforces gates before Metricool approval", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(path.join(beforeStatus.rootDir, "source-scout-intake.json"), "utf8").catch(() => null);
  const previousMarkdown = await readFile(path.join(beforeStatus.rootDir, "source-scout-intake.md"), "utf8").catch(() => null);
  const previousCsv = await readFile(path.join(beforeStatus.rootDir, "source-scout-intake.csv"), "utf8").catch(() => null);
  const dropDir = path.join(beforeStatus.rootDir, "source-drop", "memes");
  const dropPath = path.join(dropDir, "source-scout-ready-test-intake.mp4");
  const weakRecreateDropPath = path.join(dropDir, "source-scout-weak-recreate-intake.mp4");
  const strongRecreateDropPath = path.join(dropDir, "source-scout-strong-recreate-intake.mp4");
  const manifestPath = path.join(dropDir, "source-drop-manifest.csv");
  const previousDrop = await readFile(dropPath, "utf8").catch(() => null);
  const previousWeakRecreateDrop = await readFile(weakRecreateDropPath, "utf8").catch(() => null);
  const previousStrongRecreateDrop = await readFile(strongRecreateDropPath, "utf8").catch(() => null);
  const previousDropManifest = await readFile(manifestPath, "utf8").catch(() => null);
  const importCleanupDirs = beforeStatus.sourceFolders
    .filter((folder) => ["sports", "memes", "streamers", "allowlist"].includes(folder.category))
    .map((folder) => folder.path);
  const previousImportFiles = new Map(await Promise.all(importCleanupDirs.map(async (dir) => [
    dir,
    new Set(await readdir(dir).catch(() => [])),
  ] as const)));

  await mkdir(dropDir, { recursive: true });
  writeTinyTestVideo(dropPath);
  writeTinyTestVideo(weakRecreateDropPath);
  writeTinyTestVideo(strongRecreateDropPath);

  try {
    const { sourceScoutIntake, metricoolExecutionQueue, status } = await recordClipperSourceScoutIntake({
      records: [
        {
          title: "Bad search URL",
          category: "memes",
          platform: "tiktok",
          url: "https://www.tiktok.com/search?q=viral%20meme",
          source: "@creator",
          status: "owned_or_permissioned",
          evidence_type: "creator_permission",
          proof: "https://drive.google.com/file/d/proof-search",
          notes: "Creator permission confirmed in writing for this exact usage.",
        },
        {
          title: "Needs permission exact",
          category: "memes",
          platform: "tiktok",
          url: "https://www.tiktok.com/@creator/video/1234567890123456789",
          source: "@creator",
          status: "review_required",
          views: "100000",
        },
        {
          title: "Recreate from search URL",
          category: "memes",
          platform: "tiktok",
          url: "https://www.tiktok.com/search?q=viral%20meme%20format",
          source: "trend search",
          status: "recreate_only",
          recreate_plan: "Recreate only the joke structure with original captions, generated background visuals, owned voiceover narration and no raw source footage.",
        },
        {
          title: "Weak recreate with source file",
          category: "memes",
          platform: "tiktok",
          url: "https://www.tiktok.com/search?q=weak%20meme%20format",
          source: "trend search",
          status: "recreate_only",
          recreate_plan: "Make our own version.",
          target_file_name: "source-scout-weak-recreate-intake.mp4",
          source_drop_path: weakRecreateDropPath,
        },
        {
          title: "Ready recreate from search",
          category: "memes",
          platform: "tiktok",
          url: "https://www.tiktok.com/search?q=caption%20meme%20format",
          source: "trend search",
          status: "recreate_only",
          recreate_plan: "Recreate only the caption pattern with original script, generated visual background, owned voiceover narration and no raw source video reuse.",
          target_file_name: "source-scout-strong-recreate-intake.mp4",
          source_drop_path: strongRecreateDropPath,
        },
        {
          title: "Recreate plan",
          category: "memes",
          platform: "tiktok",
          url: "https://www.tiktok.com/@creator/video/2234567890123456789",
          source: "@creator",
          status: "recreate_only",
          recreate_plan: "Recreate the POV format with original captions, generated background visuals, owned voiceover narration and no raw source footage.",
        },
        {
          title: "Ready permissioned exact",
          category: "memes",
          platform: "tiktok",
          url: "https://www.tiktok.com/@creator/video/3234567890123456789",
          source: "@creator",
          status: "owned_or_permissioned",
          evidence_type: "creator_permission",
          proof: "https://drive.google.com/file/d/proof-ready",
          notes: "Creator permission confirmed in writing for edited short-form reposting.",
          target_file_name: "source-scout-ready-test-intake.mp4",
          source_drop_path: dropPath,
          views: "500000",
          likes: "25000",
          comments: "1000",
          shares: "5000",
        },
      ],
    });

    assert.equal(sourceScoutIntake.totals.items, 7);
    assert.equal(sourceScoutIntake.items.find((item) => item.title === "Bad search URL")?.decision, "rejected");
    assert.equal(sourceScoutIntake.items.find((item) => item.title === "Needs permission exact")?.publishGate, "blocked_rights");
    const recreateFromSearch = sourceScoutIntake.items.find((item) => item.title === "Recreate from search URL");
    assert.equal(recreateFromSearch?.sourceUrlKind, "discovery_search");
    assert.equal(recreateFromSearch?.decision, "blocked_source_file");
    assert.equal(recreateFromSearch?.publishGate, "blocked_source_file");
    assert.equal(recreateFromSearch?.rejectReason, null);
    assert.equal(recreateFromSearch?.evidenceType, "recreate_plan_approved");
    assert.ok(recreateFromSearch?.evidencePath?.includes("ownership note: approved recreate plan"));
    const weakRecreate = sourceScoutIntake.items.find((item) => item.title === "Weak recreate with source file");
    assert.equal(weakRecreate?.decision, "rejected");
    assert.equal(weakRecreate?.publishGate, "blocked_rights");
    assert.ok(weakRecreate?.rejectReason?.includes("plan mas especifico"));
    const readyRecreate = sourceScoutIntake.items.find((item) => item.title === "Ready recreate from search");
    assert.equal(readyRecreate?.sourceUrlKind, "discovery_search");
    assert.equal(readyRecreate?.decision, "ready_for_intake");
    assert.equal(readyRecreate?.publishGate, "ready_for_intake");
    assert.equal(readyRecreate?.evidenceType, "recreate_plan_approved");
    assert.equal(readyRecreate?.sourceFileExists, true);
    assert.ok(readyRecreate?.sourceDropManifestPath?.endsWith("source-drop-manifest.csv"));
    assert.ok(readyRecreate?.nextStep.includes("archivo propio"));
    assert.equal(sourceScoutIntake.items.find((item) => item.title === "Recreate plan")?.publishGate, "blocked_source_file");
    const ready = sourceScoutIntake.items.find((item) => item.title === "Ready permissioned exact");
    assert.equal(ready?.publishGate, "ready_for_intake");
    assert.equal(ready?.decision, "ready_for_intake");
    assert.equal(ready?.evidenceType, "creator_permission");
    assert.equal(ready?.sourceFileExists, true);
    assert.ok((ready?.viralScore || 0) > 0);
    assert.equal(metricoolExecutionQueue.realPublishEnabled, false);
    assert.equal(status.metricoolExecutionQueue.realPublishEnabled, false);
    assert.equal(status.sourceScoutIntake.totals.items, sourceScoutIntake.totals.items);
    assert.ok(status.weeklyProductionFunnel.manifestPath.endsWith("weekly-production-funnel.json"));
    assert.ok(status.weeklyProductionFunnel.totals.exactUrls >= sourceScoutIntake.totals.exactUrls);
    assert.ok(status.weeklyProductionFunnel.totals.blockedRights >= 1);
    assert.ok(status.weeklyProductionFunnel.totals.blockedSourceFile >= 1);
    assert.equal(status.weeklyProductionFunnel.totals.publishedCount, status.metrics.totals.clips);

    const rawMarkdown = await readFile(sourceScoutIntake.markdownPath, "utf8");
    const rawCsv = await readFile(sourceScoutIntake.csvPath, "utf8");
    assert.ok(rawMarkdown.includes("ready_for_intake"));
    assert.ok(rawMarkdown.includes("Evidence type"));
    assert.ok(rawCsv.includes("evidence_type"));
    assert.equal(rawMarkdown.includes("client_secret"), false);
  } finally {
    if (previousManifest === null) await unlink(path.join(beforeStatus.rootDir, "source-scout-intake.json")).catch(() => undefined);
    else await writeFile(path.join(beforeStatus.rootDir, "source-scout-intake.json"), previousManifest);
    if (previousMarkdown === null) await unlink(path.join(beforeStatus.rootDir, "source-scout-intake.md")).catch(() => undefined);
    else await writeFile(path.join(beforeStatus.rootDir, "source-scout-intake.md"), previousMarkdown);
    if (previousCsv === null) await unlink(path.join(beforeStatus.rootDir, "source-scout-intake.csv")).catch(() => undefined);
    else await writeFile(path.join(beforeStatus.rootDir, "source-scout-intake.csv"), previousCsv);
    if (previousDrop === null) await unlink(dropPath).catch(() => undefined);
    else await writeFile(dropPath, previousDrop);
    if (previousWeakRecreateDrop === null) await unlink(weakRecreateDropPath).catch(() => undefined);
    else await writeFile(weakRecreateDropPath, previousWeakRecreateDrop);
    if (previousStrongRecreateDrop === null) await unlink(strongRecreateDropPath).catch(() => undefined);
    else await writeFile(strongRecreateDropPath, previousStrongRecreateDrop);
    if (previousDropManifest === null) await unlink(manifestPath).catch(() => undefined);
    else await writeFile(manifestPath, previousDropManifest);
    for (const [dir, previousFiles] of previousImportFiles) {
      const currentFiles = await readdir(dir).catch(() => []);
      await Promise.all(currentFiles
        .filter((fileName) => !previousFiles.has(fileName))
        .map((fileName) => unlink(path.join(dir, fileName)).catch(() => undefined)));
    }
  }
});

test("recordClipperSourceScoutIntake upserts without dropping existing intake items", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(path.join(beforeStatus.rootDir, "source-scout-intake.json"), "utf8").catch(() => null);
  const previousMarkdown = await readFile(path.join(beforeStatus.rootDir, "source-scout-intake.md"), "utf8").catch(() => null);
  const previousCsv = await readFile(path.join(beforeStatus.rootDir, "source-scout-intake.csv"), "utf8").catch(() => null);

  try {
    const first = await recordClipperSourceScoutIntake({
      records: [{
        title: "First exact needs rights",
        category: "memes",
        platform: "tiktok",
        url: "https://www.tiktok.com/@creator/video/4234567890123456789",
        source: "@creator",
        status: "review_required",
        views: "1000",
      }],
    });
    assert.ok(first.sourceScoutIntake.items.some((item) => item.title === "First exact needs rights"));

    const second = await recordClipperSourceScoutIntake({
      records: [{
        title: "Second exact needs rights",
        category: "sports",
        platform: "tiktok",
        url: "https://www.tiktok.com/@team/video/5234567890123456789",
        source: "@team",
        status: "review_required",
        views: "2000",
      }],
    });
    assert.ok(second.sourceScoutIntake.items.some((item) => item.title === "First exact needs rights"));
    assert.ok(second.sourceScoutIntake.items.some((item) => item.title === "Second exact needs rights"));
    assert.equal(second.sourceScoutIntake.items.filter((item) => item.title === "First exact needs rights").length, 1);
    assert.equal(second.metricoolExecutionQueue.realPublishEnabled, false);
  } finally {
    if (previousManifest === null) await unlink(path.join(beforeStatus.rootDir, "source-scout-intake.json")).catch(() => undefined);
    else await writeFile(path.join(beforeStatus.rootDir, "source-scout-intake.json"), previousManifest);
    if (previousMarkdown === null) await unlink(path.join(beforeStatus.rootDir, "source-scout-intake.md")).catch(() => undefined);
    else await writeFile(path.join(beforeStatus.rootDir, "source-scout-intake.md"), previousMarkdown);
    if (previousCsv === null) await unlink(path.join(beforeStatus.rootDir, "source-scout-intake.csv")).catch(() => undefined);
    else await writeFile(path.join(beforeStatus.rootDir, "source-scout-intake.csv"), previousCsv);
  }
});

test("cached Source Scout intake status downgrades when source file disappears", async () => {
  const beforeStatus = await getClipperStatus();
  const manifestPath = path.join(beforeStatus.rootDir, "source-scout-intake.json");
  const markdownPath = path.join(beforeStatus.rootDir, "source-scout-intake.md");
  const csvPath = path.join(beforeStatus.rootDir, "source-scout-intake.csv");
  const missingSourcePath = path.join(beforeStatus.rootDir, "source-drop", "memes", "missing-ready-source.mp4");
  const previousManifest = await readFile(manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(markdownPath, "utf8").catch(() => null);
  const previousCsv = await readFile(csvPath, "utf8").catch(() => null);

  try {
    await writeFile(manifestPath, JSON.stringify({
      status: "ready",
      generatedAt: new Date().toISOString(),
      manifestPath,
      markdownPath,
      csvPath,
      items: [{
        id: "cached-ready-missing-file",
        candidateId: null,
        category: "memes",
        platform: "tiktok",
        title: "Cached ready missing file",
        sourceUrl: "https://www.tiktok.com/@creator/video/7234567890123456789",
        sourceUrlKind: "exact_video_or_post",
        source: "@creator",
        postedAt: null,
        views: 1000,
        likes: 0,
        comments: 0,
        shares: 0,
        viralScore: 1000,
        requestedStatus: "owned_or_permissioned",
        rightsStatus: "owned_or_permissioned",
        decision: "ready_for_intake",
        publishGate: "ready_for_intake",
        targetFileName: "missing-ready-source.mp4",
        sourceDropPath: missingSourcePath,
        sourceFileExists: true,
        targetSourcePath: missingSourcePath,
        targetSourceExists: true,
        evidencePath: "https://drive.google.com/file/d/source-scout-proof",
        evidenceType: "creator_permission",
        evidenceAccepted: true,
        recreatePlan: null,
        metricoolFit: true,
        trendCandidateBatchRow: "",
        sourceDropManifestPath: null,
        importedSourcePath: null,
        nextStep: "Previously ready.",
        rejectReason: null,
      }],
      totals: { items: 1, accepted: 1, rejected: 0, readyForIntake: 1, blockedRights: 0, blockedSourceFile: 0, recreateOnly: 0, exactUrls: 1, discoveryRejected: 0, metricoolFit: 1 },
      nextStep: "Previously ready.",
    }, null, 2));

    const nextStatus = await getClipperStatus();
    assert.equal(nextStatus.sourceScoutIntake.status, "partial");
    assert.equal(nextStatus.sourceScoutIntake.totals.readyForIntake, 0);
    assert.equal(nextStatus.sourceScoutIntake.totals.blockedSourceFile, 1);
    assert.equal(nextStatus.sourceScoutIntake.items[0]?.decision, "blocked_source_file");
    assert.equal(nextStatus.sourceScoutIntake.items[0]?.sourceFileExists, false);
  } finally {
    if (previousManifest === null) await unlink(manifestPath).catch(() => undefined);
    else await writeFile(manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(markdownPath).catch(() => undefined);
    else await writeFile(markdownPath, previousMarkdown);
    if (previousCsv === null) await unlink(csvPath).catch(() => undefined);
    else await writeFile(csvPath, previousCsv);
  }
});

test("weekly production funnel helpers keep readiness honest", () => {
  assert.deepEqual(__clipperInternals.weeklyFunnelDailyTargets(), {
    monday: 14,
    tuesday: 14,
    wednesday: 14,
    thursday: 14,
    friday: 16,
    saturday: 14,
    sunday: 14,
  });
  assert.equal(__clipperInternals.weeklyFunnelStatus(29, true, false), "blocked");
  assert.equal(__clipperInternals.weeklyFunnelStatus(30, true, false), "behind");
  assert.equal(__clipperInternals.weeklyFunnelStatus(79, true, false), "behind");
  assert.equal(__clipperInternals.weeklyFunnelStatus(80, true, false), "on_track");
  assert.equal(__clipperInternals.weeklyFunnelStatus(120, true, true), "scaling");
  assert.equal(__clipperInternals.weeklyFunnelStatus(120, true, false), "on_track");
});

test("prepareClipperWeeklyProductionFunnel writes guarded 100 clips funnel", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.weeklyProductionFunnel.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.weeklyProductionFunnel.markdownPath, "utf8").catch(() => null);
  const previousCsv = await readFile(beforeStatus.weeklyProductionFunnel.csvPath, "utf8").catch(() => null);

  try {
    const { weeklyProductionFunnel, status } = await prepareClipperWeeklyProductionFunnel();

    assert.ok(weeklyProductionFunnel.manifestPath.endsWith("weekly-production-funnel.json"));
    assert.ok(weeklyProductionFunnel.markdownPath.endsWith("weekly-production-funnel.md"));
    assert.ok(weeklyProductionFunnel.csvPath.endsWith("weekly-production-funnel.csv"));
    assert.equal(weeklyProductionFunnel.targetWeeklyClips, 100);
    assert.equal(weeklyProductionFunnel.totals.publishedCount, status.metrics.totals.clips);
    assert.ok(weeklyProductionFunnel.totals.metricoolApprovalQueued >= 0);
    assert.ok(weeklyProductionFunnel.categoryRows.some((row) => row.category === "sports" && row.targetWeeklyClips >= 50));
    assert.ok(weeklyProductionFunnel.categoryRows.some((row) => row.category === "memes" && row.targetWeeklyClips >= 35));
    assert.equal(status.weeklyProductionFunnel.manifestPath, weeklyProductionFunnel.manifestPath);
    assert.equal(status.weeklyProductionFunnel.totals.publishedCount, status.metrics.totals.clips);

    const rawMarkdown = await readFile(weeklyProductionFunnel.markdownPath, "utf8");
    const rawCsv = await readFile(weeklyProductionFunnel.csvPath, "utf8");
    assert.ok(rawMarkdown.includes("Queued is not published"));
    assert.ok(rawCsv.includes("metricool_approval_queued"));
    assert.equal(rawMarkdown.includes("client_secret"), false);
  } finally {
    if (previousManifest === null) await unlink(beforeStatus.weeklyProductionFunnel.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.weeklyProductionFunnel.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.weeklyProductionFunnel.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.weeklyProductionFunnel.markdownPath, previousMarkdown);
    if (previousCsv === null) await unlink(beforeStatus.weeklyProductionFunnel.csvPath).catch(() => undefined);
    else await writeFile(beforeStatus.weeklyProductionFunnel.csvPath, previousCsv);
  }
});

test("prepareClipperSourceIngestionSprint is visible from cached status", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.sourceIngestionSprint.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.sourceIngestionSprint.markdownPath, "utf8").catch(() => null);
  const previousCsv = await readFile(beforeStatus.sourceIngestionSprint.csvPath, "utf8").catch(() => null);

  try {
    const { sourceIngestionSprint } = await prepareClipperSourceIngestionSprint();
    const status = await getClipperStatus();

    assert.ok(sourceIngestionSprint.manifestPath.endsWith("source-ingestion-sprint.json"));
    assert.ok(sourceIngestionSprint.markdownPath.endsWith("source-ingestion-sprint.md"));
    assert.ok(sourceIngestionSprint.csvPath.endsWith("source-ingestion-sprint.csv"));
    assert.equal(status.sourceIngestionSprint.manifestPath, sourceIngestionSprint.manifestPath);
    assert.equal(status.sourceIngestionSprint.status, sourceIngestionSprint.status);
    assert.equal(status.sourceIngestionSprint.totals.items, sourceIngestionSprint.totals.items);
    assert.equal(status.sourceIngestionSprint.totals.filesNeeded, sourceIngestionSprint.totals.filesNeeded);
    assert.ok(sourceIngestionSprint.items.every((item) => item.viralSearchUrl.startsWith("https://")));
    assert.ok(sourceIngestionSprint.items.every((item) => item.intakeBatchRow.includes("owned_or_permissioned")));
    assert.ok(sourceIngestionSprint.items.every((item) => item.proofNeeded.length > 0));

    const rawManifest = await readFile(sourceIngestionSprint.manifestPath, "utf8");
    const rawMarkdown = await readFile(sourceIngestionSprint.markdownPath, "utf8");
    const rawCsv = await readFile(sourceIngestionSprint.csvPath, "utf8");
    assert.ok(rawMarkdown.includes("Clippers Source Ingestion Sprint"));
    assert.ok(rawCsv.includes("manifest_path"));
    assert.equal(rawManifest.includes("access_token"), false);
    assert.equal(rawMarkdown.includes("client_secret="), false);
    assert.equal(rawCsv.includes("refresh_token="), false);
  } finally {
    if (previousManifest === null) await unlink(beforeStatus.sourceIngestionSprint.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.sourceIngestionSprint.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.sourceIngestionSprint.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.sourceIngestionSprint.markdownPath, previousMarkdown);
    if (previousCsv === null) await unlink(beforeStatus.sourceIngestionSprint.csvPath).catch(() => undefined);
    else await writeFile(beforeStatus.sourceIngestionSprint.csvPath, previousCsv);
  }
});

test("prepareClipperSourceHuntSheet writes 30-slot daily hunt CSV and markdown", async () => {
  const status = await bootstrapClipperWorkspace();
  const huntDate = "2026-06-17";
  let manifestPath = "";
  let csvPath = "";
  let markdownPath = "";

  try {
    const { sourceHunt, status: nextStatus } = await prepareClipperSourceHuntSheet({ huntDate });
    manifestPath = sourceHunt.manifestPath;
    csvPath = sourceHunt.csvPath;
    markdownPath = sourceHunt.markdownPath;
    const expectedDailySlots = status.accounts.reduce((sum, account) => sum + account.dailyClipTarget, 0);

    assert.equal(sourceHunt.huntDate, huntDate);
    assert.equal(sourceHunt.items.length, expectedDailySlots);
    assert.equal(sourceHunt.totals.items, expectedDailySlots);
    assert.ok(sourceHunt.items.every((item) => item.suggestedSearch.length > 0 && item.evidenceNeeded.length > 0));
    assert.ok(sourceHunt.items.every((item) => item.viralSearchQueries.length >= 3));
    assert.ok(sourceHunt.items.every((item) => item.viralSearchUrls.every((url) => url.startsWith("https://www.google.com/search?"))));
    assert.ok(sourceHunt.items.every((item) => item.recencyWindow.includes("24-72")));
    assert.ok(sourceHunt.items.every((item) => item.minimumViralSignal.length > 0));
    assert.ok(sourceHunt.items.every((item) => item.viralScoreChecklist.length >= 4));
    assert.ok(sourceHunt.items.every((item) => item.rejectIf.length >= 4));
    assert.ok(sourceHunt.items.every((item) => item.targetFileName.endsWith(".mp4")));
    assert.ok(sourceHunt.items.every((item) => item.sourceDropPath.includes(`${path.sep}source-drop${path.sep}${item.category}${path.sep}`)));
    assert.ok(sourceHunt.items.every((item) => item.sourceDropManifestPath.endsWith(`${path.sep}source-drop${path.sep}${item.category}${path.sep}source-drop-manifest.csv`)));
    assert.ok(sourceHunt.items.every((item) => item.sourceDropManifestRow.includes(item.targetFileName)));
    assert.ok(sourceHunt.items.every((item) => item.sourceDropManifestRow.includes("owned_or_permissioned")));
    assert.ok(sourceHunt.items.every((item) => item.requiredInputs.length > 0 && item.completionHint.length > 0));
    assert.ok(sourceHunt.items.every((item) => item.sourceRightsRecordTemplate.includes("rights_status")));
    assert.ok(sourceHunt.csvPath.endsWith(`source-hunt-${huntDate}.csv`));
    assert.ok(nextStatus.sourceHunt.csvPath.includes("source-hunt-"));
    assert.ok(nextStatus.commandCenter.steps.some((step) => step.id === "daily-source-hunt" && step.actionUrl === "/api/clippers/prepare-source-hunt"));

    const rawCsv = await readFile(csvPath, "utf8");
    const rawMarkdown = await readFile(markdownPath, "utf8");
    const rawManifest = await readFile(manifestPath, "utf8");
    assert.ok(rawCsv.includes("hunt_date,status,category"));
    assert.ok(rawMarkdown.includes("Clippers Source Hunt Sheet"));
    assert.ok(rawMarkdown.includes("Viral search queries"));
    assert.ok(rawMarkdown.includes("Minimum viral signal"));
    assert.ok(rawMarkdown.includes("Source drop manifest row"));
    assert.ok(rawMarkdown.includes("Required inputs:"));
    assert.ok(rawCsv.includes("viral_search_urls"));
    assert.ok(rawCsv.includes("minimum_viral_signal"));
    assert.ok(rawCsv.includes("source_drop_manifest_row"));
    assert.ok(rawCsv.includes("completion_hint"));
    assert.ok(rawManifest.includes("needsSource"));
    assert.equal(rawCsv.includes("access_token"), false);
    assert.equal(rawMarkdown.includes("client_secret"), false);
  } finally {
    if (manifestPath) await unlink(manifestPath).catch(() => undefined);
    if (csvPath) await unlink(csvPath).catch(() => undefined);
    if (markdownPath) await unlink(markdownPath).catch(() => undefined);
  }
});

test("prepareClipperViralDiscoveryPack writes daily viral search queue", async () => {
  const previousStatus = await getClipperStatus();
  const previousManifest = await readFile(previousStatus.viralDiscovery.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(previousStatus.viralDiscovery.markdownPath, "utf8").catch(() => null);
  const previousCsv = await readFile(previousStatus.viralDiscovery.csvPath, "utf8").catch(() => null);

  try {
    const { viralDiscovery, status } = await prepareClipperViralDiscoveryPack({ discoveryDate: "2026-06-17" });

    assert.equal(viralDiscovery.status, "ready");
    assert.equal(viralDiscovery.discoveryDate, "2026-06-17");
    assert.equal(viralDiscovery.items.length, 27);
    assert.equal(viralDiscovery.totals.mustScan, 9);
    assert.equal(viralDiscovery.totals.watch, 9);
    assert.equal(viralDiscovery.totals.experimental, 9);
    assert.equal(viralDiscovery.sessionOrder.length, viralDiscovery.items.length);
    assert.equal(viralDiscovery.sessionOrder[0].rank, 1);
    assert.ok(viralDiscovery.totals.targetCandidates >= 50);
    assert.ok(viralDiscovery.totals.scanMinutes > 0);
    assert.ok(viralDiscovery.sessionOrder.every((item) => item.targetCandidates >= 1 && item.minimumViews > 0 && item.scanMinutes > 0));
    assert.ok(viralDiscovery.sessionOrder.every((item) => item.captureChecklist.length >= 5));
    assert.ok(viralDiscovery.sessionOrder.every((item) => item.scoreFormula.includes("viral_score")));
    assert.ok(viralDiscovery.items.every((item) => item.searchUrl.startsWith("https://") && item.viralSignals.length >= 3));
    assert.ok(viralDiscovery.items.every((item) => item.trendImportRow.includes("PASTE_TITLE") && item.trendImportRow.includes("review")));
    assert.ok(viralDiscovery.items.some((item) => item.category === "streamers" && item.rightsGate.includes("permission")));
    assert.equal(status.viralDiscovery.csvPath, viralDiscovery.csvPath);

    const rawManifest = await readFile(viralDiscovery.manifestPath, "utf8");
    const rawMarkdown = await readFile(viralDiscovery.markdownPath, "utf8");
    const rawCsv = await readFile(viralDiscovery.csvPath, "utf8");
    assert.ok(rawMarkdown.includes("Clippers Viral Discovery Pack"));
    assert.ok(rawMarkdown.includes("Scan Session"));
    assert.ok(rawMarkdown.includes("Capture checklist"));
    assert.ok(rawCsv.includes("date,priority,category,platform"));
    assert.ok(rawCsv.includes("target_candidates"));
    assert.ok(rawCsv.includes("minimum_views"));
    assert.ok(rawCsv.includes("trend_import_row"));
    assert.ok(rawMarkdown.includes("Trend import row"));
    assert.ok(rawManifest.includes("sessionOrder"));
    assert.ok(rawManifest.includes("must_scan"));
    assert.ok(rawManifest.includes("trendImportRow"));
    assert.equal(rawManifest.includes("access_token"), false);
    assert.equal(rawMarkdown.includes("client_secret"), false);
  } finally {
    if (previousManifest === null) await unlink(previousStatus.viralDiscovery.manifestPath).catch(() => undefined);
    else await writeFile(previousStatus.viralDiscovery.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(previousStatus.viralDiscovery.markdownPath).catch(() => undefined);
    else await writeFile(previousStatus.viralDiscovery.markdownPath, previousMarkdown);
    if (previousCsv === null) await unlink(previousStatus.viralDiscovery.csvPath).catch(() => undefined);
    else await writeFile(previousStatus.viralDiscovery.csvPath, previousCsv);
  }
});

test("prepareClipperRightsOutreachPack writes creator permission outreach templates", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.rightsOutreach.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.rightsOutreach.markdownPath, "utf8").catch(() => null);
  const previousTemplates = await readFile(beforeStatus.rightsOutreach.templatesPath, "utf8").catch(() => null);

  try {
    const { rightsOutreach, status } = await prepareClipperRightsOutreachPack();
    assert.equal(rightsOutreach.templates.length, 3);
    assert.ok(rightsOutreach.templates.every((template) => template.message.includes("allowlist")));
    assert.ok(rightsOutreach.items.every((item) => item.outreachMessage.length > 0 && item.permissionRecordTemplate.includes("rights_status")));
    assert.ok(rightsOutreach.items.every((item) => item.requiredInputs.length > 0 && item.completionHint.length > 0));
    assert.ok(status.commandCenter.steps.some((step) => step.id === "rights-outreach" && step.actionUrl === "/api/clippers/prepare-rights-outreach"));

    const rawManifest = await readFile(rightsOutreach.manifestPath, "utf8");
    const rawMarkdown = await readFile(rightsOutreach.markdownPath, "utf8");
    const rawTemplates = await readFile(rightsOutreach.templatesPath, "utf8");
    assert.ok(rawMarkdown.includes("Clippers Creator Rights Outreach Pack"));
    assert.ok(rawMarkdown.includes("Completion hint:"));
    assert.ok(rawTemplates.includes("Clippers Rights Outreach Templates"));
    assert.ok(rawManifest.includes("permissionRecordTemplate"));
    assert.equal(rawManifest.includes("access_token"), false);
    assert.equal(rawMarkdown.includes("client_secret"), false);
  } finally {
    if (previousManifest === null) await unlink(beforeStatus.rightsOutreach.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.rightsOutreach.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.rightsOutreach.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.rightsOutreach.markdownPath, previousMarkdown);
    if (previousTemplates === null) await unlink(beforeStatus.rightsOutreach.templatesPath).catch(() => undefined);
    else await writeFile(beforeStatus.rightsOutreach.templatesPath, previousTemplates);
  }
});

test("recordClipperSourceRights writes allowlist evidence and unlocks source asset", async () => {
  const status = await bootstrapClipperWorkspace();
  const memeFolder = status.sourceFolders.find((folder) => folder.category === "memes");
  const allowlistFolder = status.sourceFolders.find((folder) => folder.category === "allowlist");
  assert.ok(memeFolder);
  assert.ok(allowlistFolder);

  const sourcePath = `${memeFolder.path}/permissioned-meme.mp4`;
  const evidencePath = `${allowlistFolder.path}/permissioned-meme.md`;
  let initialQueuePath: string | null = null;
  let queuePath: string | null = null;
  await mkdir(memeFolder.path, { recursive: true });
  writeTinyTestVideo(sourcePath);

  try {
    const initialQueue = await prepareClipperProductionQueue();
    initialQueuePath = initialQueue.queue.queuePath;
    const asset = initialQueue.queue.sourceAssets.find((item) => item.fileName === "permissioned-meme.mp4");
    assert.ok(asset);
    assert.equal(asset.rightsStatus, "review_required");

    await assert.rejects(
      () => recordClipperSourceRights({
        assetId: asset.id,
        rightsStatus: "owned_or_permissioned",
        notes: "Creator permission confirmed for test.",
      }),
      /evidencia concreta/,
    );

    const { sourceRights, queue, status: nextStatus } = await recordClipperSourceRights({
      assetId: asset.id,
      rightsStatus: "owned_or_permissioned",
      notes: "Creator permission confirmed in writing; proof path /secure-drive/permissioned-meme-approval.png; license approved for edited short-form use; no tokens or secrets.",
    });
    queuePath = queue.queuePath;

    assert.equal(sourceRights.fileName, "permissioned-meme.mp4");
    assert.equal(sourceRights.rightsStatus, "owned_or_permissioned");
    assert.equal(sourceRights.evidencePath, evidencePath);
    assert.ok(queue.sourceAssets.some((item) => item.fileName === "permissioned-meme.mp4" && item.rightsStatus === "owned_or_permissioned"));
    assert.ok(nextStatus.productionQueue.sourceAssets.some((item) => item.fileName === "permissioned-meme.mp4" && item.evidencePath === evidencePath));

    const raw = await readFile(evidencePath, "utf8");
    assert.ok(raw.includes("permissioned-meme.mp4"));
    assert.equal(raw.includes("access_token"), false);
    assert.equal(raw.includes("client_secret"), false);
  } finally {
    await unlink(sourcePath).catch(() => undefined);
    await unlink(evidencePath).catch(() => undefined);
    if (initialQueuePath) await unlink(initialQueuePath).catch(() => undefined);
    if (queuePath) await unlink(queuePath).catch(() => undefined);
  }
});

test("prepareClipperDraftSpecs writes editable draft specs for rights-cleared queue items", async () => {
  const status = await bootstrapClipperWorkspace();
  const sportsFolder = status.sourceFolders.find((folder) => folder.category === "sports");
  const allowlistFolder = status.sourceFolders.find((folder) => folder.category === "allowlist");
  assert.ok(sportsFolder);
  assert.ok(allowlistFolder);

  const sourcePath = `${sportsFolder.path}/000-draft-ready-highlight.mp4`;
  const evidencePath = `${allowlistFolder.path}/000-draft-ready-highlight.md`;
  const previousManifest = await readFile(status.draftSpecs.manifestPath, "utf8").catch(() => null);
  let queuePath: string | null = null;
  let manifestPath: string | null = null;
  const createdDraftPaths: string[] = [];
  await mkdir(sportsFolder.path, { recursive: true });
  await mkdir(allowlistFolder.path, { recursive: true });
  writeTinyTestVideo(sourcePath);
  await writeFile(evidencePath, "# Permission\nOwned or permissioned source for draft specs.");

  try {
    const { draftSpecs, status: nextStatus } = await prepareClipperDraftSpecs();
    manifestPath = draftSpecs.manifestPath;
    queuePath = nextStatus.productionQueue.queuePath;
    createdDraftPaths.push(...draftSpecs.items.flatMap((item) => [item.draftPath, item.markdownPath]));

    assert.equal(draftSpecs.status, "ready");
    assert.ok(draftSpecs.items.length >= 10);
    assert.ok(draftSpecs.items.some((item) => item.sourcePath === sourcePath && item.evidencePath === evidencePath));
    assert.ok(draftSpecs.items.every((item) => item.slotNumber >= 1 && item.variantAngle && item.clipObjective));
    assert.equal(nextStatus.draftSpecs.totals.readyForEdit, draftSpecs.totals.readyForEdit);

    const first = draftSpecs.items.find((item) => item.sourcePath === sourcePath);
    assert.ok(first);
    const rawJson = await readFile(first.draftPath, "utf8");
    const rawMarkdown = await readFile(first.markdownPath, "utf8");
    assert.ok(rawJson.includes("ready_for_edit"));
    assert.ok(rawJson.includes("clipObjective"));
    assert.ok(rawMarkdown.includes("QA Checklist"));
    assert.ok(rawMarkdown.includes("Variant angle"));
    assert.equal(rawJson.includes("access_token"), false);
    assert.equal(rawMarkdown.includes("client_secret"), false);
  } finally {
    await unlink(sourcePath).catch(() => undefined);
    await unlink(evidencePath).catch(() => undefined);
    for (const draftPath of createdDraftPaths) {
      await unlink(draftPath).catch(() => undefined);
    }
    if (queuePath) await unlink(queuePath).catch(() => undefined);
    if (manifestPath && previousManifest === null) await unlink(manifestPath).catch(() => undefined);
    if (manifestPath && previousManifest !== null) await writeFile(manifestPath, previousManifest);
  }
});

test("renderClipperDraftVideos renders mp4 clips from rights-cleared draft specs", async () => {
  const status = await bootstrapClipperWorkspace();
  const sportsFolder = status.sourceFolders.find((folder) => folder.category === "sports");
  const allowlistFolder = status.sourceFolders.find((folder) => folder.category === "allowlist");
  assert.ok(sportsFolder);
  assert.ok(allowlistFolder);

  const sourcePath = `${sportsFolder.path}/render-ready-highlight.mp4`;
  const evidencePath = `${allowlistFolder.path}/render-ready-highlight.md`;
  await mkdir(sportsFolder.path, { recursive: true });
  await mkdir(allowlistFolder.path, { recursive: true });
  writeTinyTestVideo(sourcePath);
  await writeFile(evidencePath, "# Permission\nOwned or permissioned source for render test.");
  const previousAccountPath = `${status.accountEvidence.evidenceDir}/sports-daily-tiktok.json`;
  const previousAccount = await readFile(previousAccountPath, "utf8").catch(() => null);

  try {
    await recordClipperAccountEvidence({
      accountId: "sports-daily",
      platform: "tiktok",
      status: "verified",
      notes: "TikTok account @sportsdaily verified with profile URL https://www.tiktok.com/@sportsdaily, redacted profile screenshot proof and 2FA proof stored outside repo.",
    });
    const { renderedClips } = await renderClipperDraftVideos({ maxClips: 1, durationSeconds: 3 });

    assert.equal(renderedClips.totals.attempted, 1);
    assert.equal(renderedClips.totals.rendered, 1);
    assert.equal(renderedClips.status, "ready");
    assert.ok(renderedClips.items[0].outputPath.endsWith(".mp4"));
    const outputStat = await stat(renderedClips.items[0].outputPath);
    assert.equal(outputStat.isFile(), true);
    assert.ok(outputStat.size > 1000);

    const rawManifest = await readFile(renderedClips.manifestPath, "utf8");
    assert.ok(rawManifest.includes("render-ready-highlight.mp4"));
    assert.equal(rawManifest.includes("access_token"), false);
    const clippersAgentSource = await readFile(path.join(process.cwd(), "server", "clippers-agent.ts"), "utf8");
    assert.ok(clippersAgentSource.includes("CLIPPER_FFMPEG_TIMEOUT_MS"));
    assert.ok(clippersAgentSource.includes("killClipperFfmpegProcess"));
    assert.ok(clippersAgentSource.includes("ffmpeg timed out after"));

    const { publishingPackage } = await prepareClipperPublishingPackage();
    assert.ok(publishingPackage.items.length >= 1);
    assert.ok(publishingPackage.totals.readyForManual >= 1);
    assert.ok(publishingPackage.items.some((item) => item.platform === "tiktok" && item.status === "ready_for_manual"));
    const rawPublishingCsv = await readFile(publishingPackage.csvPath, "utf8");
    const rawPublishingMarkdown = await readFile(publishingPackage.markdownPath, "utf8");
    assert.ok(rawPublishingCsv.includes("video_path"));
    assert.ok(rawPublishingMarkdown.includes("Clippers Publishing Package"));
    assert.equal(rawPublishingCsv.includes("client_secret"), false);
  } finally {
    await unlink(sourcePath).catch(() => undefined);
    await unlink(evidencePath).catch(() => undefined);
    if (previousAccount === null) await unlink(previousAccountPath).catch(() => undefined);
    else await writeFile(previousAccountPath, previousAccount);
    await unlink(`${status.rootDir}/scheduled/publishing-package.json`).catch(() => undefined);
    await unlink(`${status.rootDir}/scheduled/publishing-package.md`).catch(() => undefined);
    await unlink(`${status.rootDir}/scheduled/publishing-package.csv`).catch(() => undefined);
    const latestManifest = await readFile(`${status.rootDir}/rendered/rendered-clips-latest.json`, "utf8").catch(() => null);
    if (latestManifest) {
      const parsed = JSON.parse(latestManifest) as { items?: Array<{ outputPath?: string }> };
      for (const item of parsed.items || []) {
        if (item.outputPath) await unlink(item.outputPath).catch(() => undefined);
      }
      await unlink(`${status.rootDir}/rendered/rendered-clips-latest.json`).catch(() => undefined);
    }
  }
});

test("prepareClipperManualPostingPack writes CSV and command center step", async () => {
  const status = await bootstrapClipperWorkspace();
  const sportsFolder = status.sourceFolders.find((folder) => folder.category === "sports");
  const allowlistFolder = status.sourceFolders.find((folder) => folder.category === "allowlist");
  assert.ok(sportsFolder);
  assert.ok(allowlistFolder);

  const sourcePath = `${sportsFolder.path}/000-manual-ready-highlight.mp4`;
  const evidencePath = `${allowlistFolder.path}/000-manual-ready-highlight.md`;
  await mkdir(sportsFolder.path, { recursive: true });
  await mkdir(allowlistFolder.path, { recursive: true });
  writeTinyTestVideo(sourcePath);
  await writeFile(evidencePath, "# Permission\nOwned or permissioned source for manual posting.");

  try {
    const { manualPostingPack, status: nextStatus } = await prepareClipperManualPostingPack();

    assert.equal(manualPostingPack.manifestPath.endsWith("manual-posting-pack.json"), true);
    assert.equal(manualPostingPack.csvPath.endsWith("manual-posting-pack.csv"), true);
    assert.ok(manualPostingPack.items.some((item) => item.sourcePath === sourcePath));
    assert.ok(manualPostingPack.items.every((item) => item.caption.length > 0 && item.checklist.length >= 3));
    assert.equal(manualPostingPack.weeklyRunway.targetWeeklyPosts, 100);
    assert.ok(manualPostingPack.weeklyRunway.recommendedDailyReadyPosts >= 14);
    assert.ok(manualPostingPack.weeklyRunway.gapToTarget >= 0);
    assert.ok(manualPostingPack.unblockSession.every((item) => item.requiredEvidence.length >= 3 && item.doneCriteria.length >= 3));
    assert.ok(manualPostingPack.unblockSession.some((item) => item.sourceFolder.includes("clippers_workspace")));
    assert.ok(nextStatus.commandCenter.steps.some((step) => step.id === "manual-posting-pack"));
    assert.ok(nextStatus.growthAudit.items.some((item) => item.id === "manual-posting-pack"));

    const rawCsv = await readFile(manualPostingPack.csvPath, "utf8");
    const rawMarkdown = await readFile(manualPostingPack.markdownPath, "utf8");
    assert.ok(rawCsv.includes("account_id"));
    assert.ok(rawCsv.includes("source_folder"));
    assert.ok(rawMarkdown.includes("Weekly Runway"));
    assert.ok(rawMarkdown.includes("Unblock Session"));
    assert.ok(rawMarkdown.includes("Done criteria"));
    assert.ok(rawMarkdown.includes("Manual Posting Pack"));
    assert.equal(rawCsv.includes("access_token"), false);
    assert.equal(rawMarkdown.includes("client_secret"), false);
  } finally {
    await unlink(sourcePath).catch(() => undefined);
    await unlink(evidencePath).catch(() => undefined);
  }
});

test("runClipperAutomationCycle writes schedule and reports blockers", async () => {
  const userId = "clipper-owner-a";
  const { automation, status } = await runClipperAutomationCycle({
    publishMode: "approval_required",
    clipsPerAccount: 2,
  }, userId);

  try {
    assert.equal(automation.schedulePath.endsWith(".json"), true);
    assert.equal(automation.reportPath.endsWith(".json"), true);
    assert.ok(automation.totals.posts >= status.accounts.length);
    assert.ok(automation.totals.blocked >= status.accounts.length);
    assert.equal(automation.totals.weeklyTargetClips, 100);
    assert.equal(automation.totals.dailyTargetPosts, 15);
    assert.equal(automation.totals.posts, automation.totals.dailyTargetPosts);
    assert.ok(automation.totals.backlogPosts >= 0);
    assert.equal(automation.totals.gapToDailyTarget, 0);
    assert.ok(automation.blockers.length > 0);
    assert.ok(automation.recommendations.some((recommendation) => recommendation.includes("100/semana")));

    const scheduleStat = await stat(automation.schedulePath);
    const reportStat = await stat(automation.reportPath);
    assert.equal(scheduleStat.isFile(), true);
    assert.equal(reportStat.isFile(), true);
    const rawReport = JSON.parse(await readFile(automation.reportPath, "utf8")) as { userId?: string; summary?: string };
    assert.equal(rawReport.userId, userId);
    assert.ok(rawReport.summary?.includes("15/15"));
  } finally {
    await unlink(automation.schedulePath).catch(() => undefined);
    await unlink(automation.reportPath).catch(() => undefined);
    await unlink(automation.queuePath).catch(() => undefined);
  }
});

test("prepareClipperAnalyticsReportingPack writes analytics export runbook without secrets", async () => {
  const beforeStatus = await bootstrapClipperWorkspace();
  const previousManifest = await readFile(beforeStatus.analyticsReportingPack.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.analyticsReportingPack.markdownPath, "utf8").catch(() => null);
  const previousCsv = await readFile(beforeStatus.analyticsReportingPack.csvPath, "utf8").catch(() => null);
  const starterTargetPath = beforeStatus.analyticsReportingPack.items[0]?.targetPath;
  assert.ok(starterTargetPath);
  const previousStarterCsv = await readFile(starterTargetPath, "utf8").catch(() => null);
  await unlink(starterTargetPath).catch(() => undefined);

  try {
    const { analyticsReportingPack, status } = await prepareClipperAnalyticsReportingPack();

    assert.equal(analyticsReportingPack.items.length, status.accounts.length * 3);
    assert.equal(analyticsReportingPack.totals.exports, analyticsReportingPack.items.length);
    assert.equal(analyticsReportingPack.totals.accounts, status.accounts.length);
    assert.equal(analyticsReportingPack.totals.metricsFiles >= 1, true);
    assert.ok(analyticsReportingPack.importTemplate.startsWith("account_id,platform,clip_id,hook"));
    assert.ok(analyticsReportingPack.items.every((item) => item.minimumFields.includes("views")));
    assert.ok(analyticsReportingPack.items.every((item) => item.targetPath.endsWith(`${item.accountId}-${item.platform}-analytics.csv`)));
    assert.ok(analyticsReportingPack.runbook.some((step) => step.includes("export analytics")));
    assert.ok(status.commandCenter.steps.some((step) => step.id === "analytics-reporting-pack" && step.actionUrl === "/api/clippers/prepare-analytics-reporting-pack"));

    const rawManifest = await readFile(analyticsReportingPack.manifestPath, "utf8");
    const rawMarkdown = await readFile(analyticsReportingPack.markdownPath, "utf8");
    const rawCsv = await readFile(analyticsReportingPack.csvPath, "utf8");
    assert.ok(rawMarkdown.includes("Clippers Analytics Reporting Pack"));
    assert.ok(rawMarkdown.includes("Import Template"));
    assert.ok(rawCsv.includes("import_row_template"));
    assert.ok(rawManifest.includes("weeklyViewsGoal"));
    const rawStarterCsv = await readFile(starterTargetPath, "utf8");
    assert.ok(rawStarterCsv.startsWith("account_id,platform,clip_id,hook"));
    assert.equal(rawManifest.includes("access_token"), false);
    assert.equal(rawMarkdown.includes("client_secret"), false);
    assert.equal(rawCsv.includes("refresh_token"), false);
  } finally {
    if (previousManifest === null) await unlink(beforeStatus.analyticsReportingPack.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.analyticsReportingPack.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.analyticsReportingPack.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.analyticsReportingPack.markdownPath, previousMarkdown);
    if (previousCsv === null) await unlink(beforeStatus.analyticsReportingPack.csvPath).catch(() => undefined);
    else await writeFile(beforeStatus.analyticsReportingPack.csvPath, previousCsv);
    if (previousStarterCsv === null) await unlink(starterTargetPath).catch(() => undefined);
    else await writeFile(starterTargetPath, previousStarterCsv);
  }
});

test("prepareClipperAutomationSchedule writes daily runbook manifest", async () => {
  const { automationSchedule, status } = await prepareClipperAutomationSchedule({
    clipsPerAccount: 5,
    publishMode: "approval_required",
    riskTolerance: "growth",
    dailyRunTime: "08:30",
    weeklyTargetClips: 100,
  });

  try {
    assert.equal(automationSchedule.status, "prepared");
    assert.equal(automationSchedule.weeklyTargetClips, 100);
    assert.ok(automationSchedule.runbook.some((step) => step.includes("Trend Radar")));
    const scheduleStat = await stat(automationSchedule.manifestPath);
    assert.equal(scheduleStat.isFile(), true);
    assert.ok(status.growthAudit.items.some((item) => item.id === "daily-automation" && item.status !== "critical"));
  } finally {
    await unlink(automationSchedule.manifestPath).catch(() => undefined);
  }
});

test("ingestClipperMetrics imports CSV exports and updates optimizer summary", async () => {
  const status = await bootstrapClipperWorkspace();
  const metricsFolder = status.sourceFolders.find((folder) => folder.category === "metrics");
  assert.ok(metricsFolder);
  await mkdir(metricsFolder.path, { recursive: true });
  const metricsPath = `${metricsFolder.path}/sample-metrics.csv`;
  const summaryPath = `${metricsFolder.path}/metrics-summary.json`;
  await writeFile(metricsPath, [
    "account_id,platform,clip_id,hook,views,likes,comments,shares,saves,retention",
    "sports-daily,tiktok,clip-1,La jugada que cambio todo,1250000,54000,2100,8400,3200,71%",
    "meme-radar,instagram,clip-2,POV internet hoy,220000,12000,900,2600,1100,48%",
  ].join("\n"));

  try {
    const { metrics, status: nextStatus } = await ingestClipperMetrics();
    assert.equal(metrics.status, "ready");
    assert.equal(metrics.records.length >= 2, true);
    assert.equal(metrics.totals.views >= 1_470_000, true);
    assert.ok(metrics.accountPerformance.some((account) => account.accountId === "sports-daily" && account.status === "scaling"));
    assert.ok(metrics.recommendations.some((recommendation) => recommendation.includes("Duplicar formato ganador")));
    assert.ok(nextStatus.growthAudit.items.some((item) => item.id === "metrics-loop" && item.status === "ready"));
  } finally {
    await unlink(metricsPath).catch(() => undefined);
    await unlink(summaryPath).catch(() => undefined);
  }
});

test("ingestClipperTrends ranks recent opportunities and gates rights", async () => {
  const status = await bootstrapClipperWorkspace();
  const trendsFolder = status.sourceFolders.find((folder) => folder.category === "trends");
  const allowlistFolder = status.sourceFolders.find((folder) => folder.category === "allowlist");
  assert.ok(trendsFolder);
  assert.ok(allowlistFolder);
  await mkdir(trendsFolder.path, { recursive: true });
  await mkdir(allowlistFolder.path, { recursive: true });
  const trendsPath = `${trendsFolder.path}/trend-candidates-2099-01-01T00-00-00-000Z.csv`;
  const staleSummaryPath = `${trendsFolder.path}/trend-radar-summary 2.json`;
  const evidencePath = `${allowlistFolder.path}/https-example-com-sports-clip-1.md`;
  const permissionedDuplicateEvidencePath = `${allowlistFolder.path}/https-example-com-permissioned-duplicate.md`;
  await writeFile(evidencePath, "# Permission\nApproved source for test trend.");
  await writeFile(permissionedDuplicateEvidencePath, "# Permission\nApproved source for duplicate priority test.");
  await writeFile(trendsPath, [
    "category,platform,title,url,source,posted_at,views,likes,comments,shares,rights",
    "sports,tiktok,Game winner angle,https://example.com/sports-clip-1,@league,2026-06-17T01:00:00Z,900000,42000,1800,12000,approved",
    "sports,tiktok,Approved without proof,https://example.com/sports-clip-no-proof,@league,2026-06-17T01:00:00Z,500000,12000,800,4000,approved",
    "memes,instagram,New meme format,https://example.com/meme-clip-2,@creator,2026-06-10T01:00:00Z,300000,10000,500,800,review",
    "sports,youtube,YouTube first exact video,https://www.youtube.com/watch?v=abc123&utm_source=test,@channel,2026-06-17T01:00:00Z,100000,1000,100,100,review",
    "sports,youtube,YouTube second exact video,https://www.youtube.com/watch?v=xyz789&utm_source=test,@channel,2026-06-17T01:00:00Z,110000,1000,100,100,review",
    "sports,tiktok,Permissioned duplicate,https://example.com/permissioned-duplicate,@league,2026-06-17T01:00:00Z,200000,1000,100,100,approved",
    "sports,tiktok,Higher score duplicate without proof,https://example.com/permissioned-duplicate?utm_source=copy,@league,2026-06-17T01:00:00Z,9000000,1000,100,100,review",
  ].join("\n"));
  await writeFile(staleSummaryPath, JSON.stringify({
    records: [
      {
        category: "sports",
        platform: "tiktok",
        title: "stale summary should not import",
        url: "https://example.com/stale-summary",
        views: 999999999,
      },
    ],
  }));

  try {
    const { trendRadar, status: nextStatus } = await ingestClipperTrends();
    assert.equal(trendRadar.status, "ready");
    assert.equal(trendRadar.files.some((file) => file.fileName === "trend-radar-summary 2.json"), false);
    assert.equal(trendRadar.candidates.some((candidate) => candidate.url === "https://example.com/stale-summary"), false);
    assert.equal(trendRadar.candidates.length >= 2, true);
    const permissionedCandidate = trendRadar.candidates.find((candidate) => candidate.url === "https://example.com/sports-clip-1");
    assert.equal(permissionedCandidate?.rightsStatus, "owned_or_permissioned");
    const noProofCandidate = trendRadar.candidates.find((candidate) => candidate.url === "https://example.com/sports-clip-no-proof");
    assert.equal(noProofCandidate?.rightsStatus, "review_required");
    assert.ok(noProofCandidate?.nextStep.includes("falta evidencia local verificable"));
    assert.ok(trendRadar.candidates.some((candidate) => candidate.url?.includes("v=abc123")));
    assert.ok(trendRadar.candidates.some((candidate) => candidate.url?.includes("v=xyz789")));
    const permissionedDuplicate = trendRadar.candidates.find((candidate) => candidate.url?.startsWith("https://example.com/permissioned-duplicate"));
    assert.equal(permissionedDuplicate?.rightsStatus, "owned_or_permissioned");
    assert.ok(trendRadar.recommendations.some((recommendation) => recommendation.includes("Prioridad")));
    assert.ok(nextStatus.growthAudit.items.some((item) => item.id === "trend-radar" && item.status === "ready"));
  } finally {
    await unlink(trendsPath).catch(() => undefined);
    await unlink(staleSummaryPath).catch(() => undefined);
    await unlink(evidencePath).catch(() => undefined);
    await unlink(permissionedDuplicateEvidencePath).catch(() => undefined);
    await unlink(`${trendsFolder.path}/trend-radar-summary.json`).catch(() => undefined);
  }
});

test("recordClipperTrendCandidatesBatch imports candidates and refreshes radar", async () => {
  const status = await bootstrapClipperWorkspace();
  const trendsFolder = status.sourceFolders.find((folder) => folder.category === "trends");
  assert.ok(trendsFolder);
  const previousSummary = await readFile(status.trendRadar.summaryPath, "utf8").catch(() => null);
  let importedPath = "";

  try {
    const { trendCandidatesBatch, status: nextStatus } = await recordClipperTrendCandidatesBatch({
      batchText: [
        "category,platform,title,url,source,posted_at,views,likes,comments,shares,rights,angle",
        "sports,tiktok,Last second comeback,https://example.com/comeback,@team,2026-06-17T09:00:00Z,1500000,80000,5000,22000,approved,Use scoreboard tension",
        "memes,instagram,POV everyone today,https://example.com/meme,@creator,2026-06-17T08:30:00Z,350000,20000,1200,9000,review,Fast relatable hook",
        "sports,tiktok,Placeholder trend,<approved source URL for sports-source-01.mp4>,<creator/rightsholder handle>,<posted_at ISO>,<views>,<likes>,<comments>,<shares>,approved_after_proof,Should be skipped",
        ",,,,,,,,,,,",
      ].join("\n"),
    });
    importedPath = trendCandidatesBatch.filePath;

    assert.equal(trendCandidatesBatch.accepted, 2);
    assert.equal(trendCandidatesBatch.skipped, 2);
    assert.equal(trendCandidatesBatch.trendRadar.status, "needs_review");
    const importedCandidate = trendCandidatesBatch.trendRadar.candidates.find((candidate) => candidate.title === "Last second comeback");
    assert.ok(importedCandidate);
    assert.equal(importedCandidate.rightsStatus, "review_required");
    assert.ok(nextStatus.trendRadar.candidates.some((candidate) => candidate.url === "https://example.com/comeback" && candidate.rightsStatus === "review_required"));

    const rawImport = await readFile(importedPath, "utf8");
    const rawSummary = await readFile(nextStatus.trendRadar.summaryPath, "utf8");
    assert.ok(rawImport.includes("Last second comeback"));
    assert.equal(rawImport.includes("access_token"), false);
    assert.equal(rawSummary.includes("client_secret"), false);
  } finally {
    if (importedPath) await unlink(importedPath).catch(() => undefined);
    if (previousSummary === null) await unlink(status.trendRadar.summaryPath).catch(() => undefined);
    else await writeFile(status.trendRadar.summaryPath, previousSummary);
  }
});

test("prepareClipperTrendRightsOutreachPack writes outreach for review-required trends", async () => {
  const status = await bootstrapClipperWorkspace();
  const previousSummary = await readFile(status.trendRadar.summaryPath, "utf8").catch(() => null);
  const previousPack = await readFile(status.trendRightsOutreach.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(status.trendRightsOutreach.markdownPath, "utf8").catch(() => null);
  const previousCsv = await readFile(status.trendRightsOutreach.csvPath, "utf8").catch(() => null);
  let importedPath = "";

  try {
    const { trendCandidatesBatch } = await recordClipperTrendCandidatesBatch({
      batchText: [
        "category,platform,title,url,source,posted_at,views,likes,comments,shares,rights,angle",
        "streamers,tiktok,Streamer rage moment,https://example.com/streamer-rage,@streamer,2026-06-20T20:00:00Z,999999999999,30000,4000,13000,review,Clip the reaction buildup",
        "sports,youtube,Official team highlight,https://example.com/team-highlight,@team,2026-06-17T08:00:00Z,900000,50000,3000,9000,approved,Official source recap",
      ].join("\n"),
    });
    importedPath = trendCandidatesBatch.filePath;

    const { trendRightsOutreach, status: nextStatus } = await prepareClipperTrendRightsOutreachPack();
    assert.equal(trendRightsOutreach.status, "partial");
    assert.equal(trendRightsOutreach.totals.reviewRequired >= 1, true);
    assert.ok(trendRightsOutreach.items.some((item) => item.title === "Streamer rage moment" && item.outreachMessage.includes("permission")));
    assert.ok(trendRightsOutreach.items.every((item) => item.remixBrief.includes(item.title)));
    assert.ok(trendRightsOutreach.items.every((item) => item.ownedAssetPlan.length >= 4));
    assert.ok(trendRightsOutreach.items.every((item) => item.scriptBeats.length >= 5));
    assert.ok(trendRightsOutreach.items.every((item) => item.publishSafetyChecklist.some((step) => step.includes("No publicar raw footage"))));
    assert.ok(nextStatus.commandCenter.steps.some((step) => step.id === "trend-rights-outreach"));

    const rawManifest = await readFile(trendRightsOutreach.manifestPath, "utf8");
    const rawMarkdown = await readFile(trendRightsOutreach.markdownPath, "utf8");
    const rawCsv = await readFile(trendRightsOutreach.csvPath, "utf8");
    assert.ok(rawMarkdown.includes("Clippers Trend Rights Outreach Pack"));
    assert.ok(rawMarkdown.includes("Permission record template"));
    assert.ok(rawMarkdown.includes("Owned/remix-safe brief"));
    assert.ok(rawMarkdown.includes("Publish safety checklist"));
    assert.ok(rawCsv.includes("evidence_file"));
    assert.ok(rawCsv.includes("remix_brief"));
    assert.ok(rawCsv.includes("publish_safety_checklist"));
    assert.ok(rawCsv.includes("permission_record_template"));
    assert.ok(rawManifest.includes("permissionRecordTemplate"));
    assert.ok(rawManifest.includes("ownedAssetPlan"));
    assert.equal(rawManifest.includes("access_token"), false);
    assert.equal(rawMarkdown.includes("client_secret"), false);
  } finally {
    if (importedPath) await unlink(importedPath).catch(() => undefined);
    if (previousSummary === null) await unlink(status.trendRadar.summaryPath).catch(() => undefined);
    else await writeFile(status.trendRadar.summaryPath, previousSummary);
    if (previousPack === null) await unlink(status.trendRightsOutreach.manifestPath).catch(() => undefined);
    else await writeFile(status.trendRightsOutreach.manifestPath, previousPack);
    if (previousMarkdown === null) await unlink(status.trendRightsOutreach.markdownPath).catch(() => undefined);
    else await writeFile(status.trendRightsOutreach.markdownPath, previousMarkdown);
    if (previousCsv === null) await unlink(status.trendRightsOutreach.csvPath).catch(() => undefined);
    else await writeFile(status.trendRightsOutreach.csvPath, previousCsv);
  }
});

test("buildClipperConnectActions blocks missing OAuth credentials", () => {
  const originalTikTokKey = process.env.TIKTOK_CLIENT_KEY;
  const googleSnapshot = snapshotEnv(GOOGLE_OAUTH_ALIAS_ENV_VARS);
  delete process.env.TIKTOK_CLIENT_KEY;
  clearEnv(GOOGLE_OAUTH_ALIAS_ENV_VARS);

  try {
    const actions = buildClipperConnectActions();
    assert.equal(actions.find((action) => action.platform === "tiktok")?.status, "blocked");
    assert.equal(actions.find((action) => action.platform === "youtube")?.authUrl, null);
  } finally {
    if (originalTikTokKey) process.env.TIKTOK_CLIENT_KEY = originalTikTokKey;
    else delete process.env.TIKTOK_CLIENT_KEY;
    restoreEnv(googleSnapshot);
  }
});

test("buildClipperConnectActions creates OAuth URL when env is present", () => {
  const originalTikTokKey = process.env.TIKTOK_CLIENT_KEY;
  const originalTikTokSecret = process.env.TIKTOK_CLIENT_SECRET;
  process.env.TIKTOK_CLIENT_KEY = "test-client-key";
  process.env.TIKTOK_CLIENT_SECRET = "test-client-secret";

  try {
    const action = buildClipperConnectActions().find((item) => item.platform === "tiktok");
    assert.equal(action?.status, "ready");
    assert.ok(action?.authUrl?.includes("client_key=test-client-key"));
    assert.ok(action?.authUrl?.includes("video.publish"));
  } finally {
    if (originalTikTokKey) process.env.TIKTOK_CLIENT_KEY = originalTikTokKey;
    else delete process.env.TIKTOK_CLIENT_KEY;
    if (originalTikTokSecret) process.env.TIKTOK_CLIENT_SECRET = originalTikTokSecret;
    else delete process.env.TIKTOK_CLIENT_SECRET;
  }
});

test("recordClipperOAuthCallback stores hashed OAuth metadata and updates account state", async () => {
  const oauthConnectionsPath = path.join(process.cwd(), "clippers_workspace", "oauth-connections.json");
  const originalConnections = await readFile(oauthConnectionsPath, "utf8").catch(() => null);

  try {
    const connection = await recordClipperOAuthCallback({
      platform: "tiktok",
      code: "sample-auth-code",
      state: "clippers-tiktok",
    }, "owner-oauth-test");

    assert.equal(connection.status, "code_received");
    assert.equal(connection.ownerUserId, "owner-oauth-test");
    assert.equal(connection.codeHash, __clipperInternals.hashOAuthCode("sample-auth-code"));
    assert.notEqual(connection.codeHash, "sample-auth-code");

    const status = await getClipperStatus();
    assert.ok(status.oauthConnections.some((item) => item.platform === "tiktok" && item.ownerUserId === "owner-oauth-test" && item.status === "code_received"));
    assert.ok(status.accounts.some((account) =>
      account.platformAccounts.some((platformAccount) => platformAccount.platform === "tiktok" && platformAccount.status === "needs_review")
    ));
  } finally {
    if (originalConnections !== null) await writeFile(oauthConnectionsPath, originalConnections);
    else await unlink(oauthConnectionsPath).catch(() => undefined);
  }
});

test("TikTok OAuth state and vault records stay scoped per account", async () => {
  const originalKey = process.env.CLIPPERS_TOKEN_ENCRYPTION_KEY;
  const originalTikTokKey = process.env.TIKTOK_CLIENT_KEY;
  const originalTikTokSecret = process.env.TIKTOK_CLIENT_SECRET;
  const beforeStatus = await getClipperStatus();
  const vaultPath = beforeStatus.tokenVault.vaultPath;
  const oauthConnectionsPath = path.join(beforeStatus.rootDir, "oauth-connections.json");
  const originalVault = await readFile(vaultPath, "utf8").catch(() => null);
  const originalConnections = await readFile(oauthConnectionsPath, "utf8").catch(() => null);
  process.env.CLIPPERS_TOKEN_ENCRYPTION_KEY = "test-encryption-key-with-more-than-32-chars";
  process.env.TIKTOK_CLIENT_KEY = "test-client-key";
  process.env.TIKTOK_CLIENT_SECRET = "test-client-secret";

  try {
    const authUrl = __clipperInternals.buildPlatformAuthUrl("tiktok", "meme-radar");
    assert.ok(authUrl);
    assert.equal(new URL(authUrl).searchParams.get("state"), "clippers-tiktok-meme-radar");

    await saveClipperTokenPayload("tiktok", {
      access_token: "sports-access-token",
      refresh_token: "sports-refresh-token",
      open_id: "sports-open-id",
    }, "sports-daily");
    await saveClipperTokenPayload("tiktok", {
      access_token: "meme-access-token",
      refresh_token: "meme-refresh-token",
      open_id: "meme-open-id",
    }, "meme-radar");

    const status = await getClipperStatus();
    assert.ok(status.tokenVault.records.some((record) => record.platform === "tiktok" && record.accountId === "sports-daily"));
    assert.ok(status.tokenVault.records.some((record) => record.platform === "tiktok" && record.accountId === "meme-radar"));

    const connection = await recordClipperOAuthCallback({
      platform: "tiktok",
      error: "test-no-exchange",
      state: "clippers-tiktok-meme-radar",
    });
    assert.equal(connection.accountId, "meme-radar");
  } finally {
    if (originalKey) process.env.CLIPPERS_TOKEN_ENCRYPTION_KEY = originalKey;
    else delete process.env.CLIPPERS_TOKEN_ENCRYPTION_KEY;
    if (originalTikTokKey) process.env.TIKTOK_CLIENT_KEY = originalTikTokKey;
    else delete process.env.TIKTOK_CLIENT_KEY;
    if (originalTikTokSecret) process.env.TIKTOK_CLIENT_SECRET = originalTikTokSecret;
    else delete process.env.TIKTOK_CLIENT_SECRET;
    if (originalVault !== null) await writeFile(vaultPath, originalVault);
    else await unlink(vaultPath).catch(() => undefined);
    if (originalConnections !== null) await writeFile(oauthConnectionsPath, originalConnections);
    else await unlink(oauthConnectionsPath).catch(() => undefined);
  }
});

test("buildTokenExchangeRequest targets official token endpoints", () => {
  const originalTikTokKey = process.env.TIKTOK_CLIENT_KEY;
  const originalTikTokSecret = process.env.TIKTOK_CLIENT_SECRET;
  const originalGoogleClientId = process.env.GOOGLE_CLIENT_ID;
  const originalGoogleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  process.env.TIKTOK_CLIENT_KEY = "test-client-key";
  process.env.TIKTOK_CLIENT_SECRET = "test-client-secret";
  process.env.GOOGLE_CLIENT_ID = "google-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "google-client-secret";

  try {
    const tiktok = __clipperInternals.buildTokenExchangeRequest("tiktok", "auth-code");
    assert.equal(tiktok.url, "https://open.tiktokapis.com/v2/oauth/token/");
    assert.equal(tiktok.method, "POST");
    assert.ok(tiktok.body?.includes("grant_type=authorization_code"));
    assert.ok(tiktok.body?.includes("client_key=test-client-key"));

    const youtube = __clipperInternals.buildTokenExchangeRequest("youtube", "auth-code");
    assert.equal(youtube.url, "https://oauth2.googleapis.com/token");
    assert.equal(youtube.method, "POST");
    assert.ok(youtube.body?.includes("client_id=google-client-id"));
  } finally {
    if (originalTikTokKey) process.env.TIKTOK_CLIENT_KEY = originalTikTokKey;
    else delete process.env.TIKTOK_CLIENT_KEY;
    if (originalTikTokSecret) process.env.TIKTOK_CLIENT_SECRET = originalTikTokSecret;
    else delete process.env.TIKTOK_CLIENT_SECRET;
    if (originalGoogleClientId) process.env.GOOGLE_CLIENT_ID = originalGoogleClientId;
    else delete process.env.GOOGLE_CLIENT_ID;
    if (originalGoogleClientSecret) process.env.GOOGLE_CLIENT_SECRET = originalGoogleClientSecret;
    else delete process.env.GOOGLE_CLIENT_SECRET;
  }
});

test("saveClipperTokenPayload encrypts token payloads before writing the vault", async () => {
  const originalKey = process.env.CLIPPERS_TOKEN_ENCRYPTION_KEY;
  const beforeStatus = await getClipperStatus();
  const vaultPath = beforeStatus.tokenVault.vaultPath;
  const originalVault = await readFile(vaultPath, "utf8").catch(() => null);
  process.env.CLIPPERS_TOKEN_ENCRYPTION_KEY = "test-encryption-key-with-more-than-32-chars";

  try {
    const summary = await saveClipperTokenPayload("youtube", {
      access_token: "plain-access-token",
      refresh_token: "plain-refresh-token",
      token_type: "Bearer",
      scope: "https://www.googleapis.com/auth/youtube.upload",
      expires_in: 3600,
      sub: "youtube-subject",
    }, "owner-token-test");
    assert.equal(summary.platform, "youtube");
    assert.equal(summary.ownerUserId, "owner-token-test");
    assert.equal(summary.tokenType, "Bearer");

    const status = await getClipperStatus();
    const rawVault = await readFile(status.tokenVault.vaultPath, "utf8");
    assert.equal(rawVault.includes("plain-access-token"), false);
    assert.equal(rawVault.includes("plain-refresh-token"), false);
    assert.ok(status.tokenVault.records.some((record) => record.platform === "youtube" && record.ownerUserId === "owner-token-test" && record.status === "saved"));
  } finally {
    if (originalKey) process.env.CLIPPERS_TOKEN_ENCRYPTION_KEY = originalKey;
    else delete process.env.CLIPPERS_TOKEN_ENCRYPTION_KEY;
    if (originalVault !== null) await writeFile(vaultPath, originalVault);
    else await unlink(vaultPath).catch(() => undefined);
  }
});
