import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { access } from "node:fs/promises";
import { mkdir, readFile, rename, rm, symlink, unlink, writeFile } from "node:fs/promises";
import test from "node:test";
import path from "node:path";

const rootDir = path.join(process.cwd(), "clippers_workspace");
const queuePath = path.join(rootDir, "scheduled", "metricool-execution-queue.json");
const queueMarkdownPath = path.join(rootDir, "scheduled", "metricool-execution-queue.md");
const queueCsvPath = path.join(rootDir, "scheduled", "metricool-execution-queue.csv");
const regexEscape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const safePublicBaseUrl = "https://app.clipprreview.com";
let workspaceBackupPath: string | null = null;

const sliceRequired = (content: string, startNeedle: string, endNeedle: string) => {
  const start = content.indexOf(startNeedle);
  assert.notEqual(start, -1, `Missing start marker: ${startNeedle}`);
  const end = content.indexOf(endNeedle, start + startNeedle.length);
  assert.notEqual(end, -1, `Missing end marker after ${startNeedle}: ${endNeedle}`);
  return content.slice(start, end);
};

const pathExists = async (filePath: string) => {
  return access(filePath).then(() => true, () => false);
};

const writeFileIfMissing = async (filePath: string, content: string) => {
  if (await pathExists(filePath)) return;
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
};

const writeJsonIfMissing = async (filePath: string, value: unknown) => {
  await writeFileIfMissing(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

const writeTinyTestVideo = (outputPath: string) => {
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
};

const isolateClipperWorkspace = async () => {
  if (!(await pathExists(rootDir))) return;
  workspaceBackupPath = path.join(process.cwd(), `.clippers_workspace.test-backup-${process.pid}-${Date.now()}`);
  await rename(rootDir, workspaceBackupPath);
};

const restoreClipperWorkspace = async () => {
  await rm(rootDir, { recursive: true, force: true });
  if (workspaceBackupPath && await pathExists(workspaceBackupPath)) {
    await rename(workspaceBackupPath, rootDir);
  }
};

const developerConnectionItem = (
  platform: string,
  label: string,
  missingEnvVars: string[],
  scopes: string[],
) => ({
  platform,
  label,
  status: "missing",
  appIdentifier: null,
  publicBaseUrl: null,
  redirectUri: `${safePublicBaseUrl}/api/clippers/oauth/${platform}/callback`,
  missingEnvVars,
  scopes,
  nextStep: `Create ${label} developer app and import submitted evidence row with real proof.`,
});

const officialSourceItem = (
  platform: string,
  sourceStatus: string,
  accessMode: string,
  submitDecision: string,
  scopes: string[],
  officialUrls: string[],
  verifiedClaim: string,
) => ({
  platform,
  label: `${platform} permission source verification`,
  sourceStatus,
  accessMode,
  submitDecision,
  scopes,
  officialUrls,
  verifiedClaims: [verifiedClaim],
  reviewerEvidence: [`Attach ${platform} portal proof after the operator completes the action.`],
  recheckSteps: [`Recheck the official ${platform} portal before importing proof.`],
  blockers: [],
  nextStep: "Official source is identified; attach real non-secret proof before approval.",
});

const writeOwnedSourceFixture = async (category: "sports" | "memes", fileName: string) => {
  const categoryDir = path.join(rootDir, "source-drop", category);
  const sourcePath = path.join(categoryDir, fileName);
  const evidencePath = path.join(categoryDir, `owned-${category}-production-notes.md`);
  const allowlistPath = path.join(rootDir, "allowlist", `${path.parse(fileName).name}.md`);
  await mkdir(categoryDir, { recursive: true });
  await mkdir(path.dirname(allowlistPath), { recursive: true });
  writeTinyTestVideo(sourcePath);
  await writeFile(evidencePath, [
    "status: owned_source",
    `asset: ${fileName}`,
    `The source video ${fileName} is owned source generated locally for Clippers test coverage.`,
    `This evidence explicitly covers ${fileName} and confirms original generated material only.`,
    "Restrictions: no third-party footage, no league footage, no raw streamer clips, no copyrighted music, no broadcast footage, no scraped footage.",
    "Created_by: local clippers test fixture; no external creator material is included.",
    "",
  ].join("\n"));
  await writeFile(path.join(categoryDir, "source-drop-manifest.csv"), [
    "target_file_name,rights_status,evidence_link",
    `${fileName},owned_or_permissioned,owner note path: ${evidencePath}`,
    "",
  ].join("\n"));
  await writeFile(allowlistPath, [
    `# Source Rights Evidence: ${fileName}`,
    "",
    "status: owned_or_permissioned",
    `category: ${category}`,
    `asset_id: owned-source:${category}:${fileName}`,
    `source_path: ${sourcePath}`,
    "source: test-source-drop-manifest",
    `manifest_evidence_path: ${evidencePath}`,
    `resolved_evidence_path: ${evidencePath}`,
    "",
    "Notes:",
    [
      `Owned source generated locally for ${category};`,
      `owner note path ${evidencePath};`,
      "no third-party footage, no league footage, no raw streamer clips, no copyrighted music, no broadcast footage, no scraped footage;",
      `asset ${fileName};`,
      "approved only for draft creation and Metricool approval_required queue review.",
    ].join(" "),
    "",
  ].join("\n"));
};

const ensureClipperScriptFixtures = async () => {
  await isolateClipperWorkspace();
  await mkdir(path.join(rootDir, "reports"), { recursive: true });
  await mkdir(path.join(rootDir, "evidence-drop", "external-closeout-proofs"), { recursive: true });
  await writeOwnedSourceFixture("sports", "sports-owned-01.mp4");
  await writeOwnedSourceFixture("memes", "memes-owned-01.mp4");

  await writeJsonIfMissing(path.join(rootDir, "production-public-url.json"), {
    publicBaseUrl: safePublicBaseUrl,
    updatedAt: "2026-06-20T00:00:00.000Z",
    storage: "test-fixture",
  });
  await writeJsonIfMissing(path.join(rootDir, "config.json"), {
    accounts: [
      {
        id: "sports-daily",
        name: "Sports Daily Clips",
        category: "sports",
        platforms: ["tiktok", "instagram", "youtube"],
        dailyClipTarget: 10,
        weeklyViewsGoal: 1_000_000,
        lastWeekViews: 0,
        status: "active",
        contentPolicy: "Owned, licensed, permissioned or recreated sports clips only.",
        platformAccounts: [
          {
            platform: "tiktok",
            handle: "@sportsdaily",
            displayName: "Sports Daily Clips",
            status: "ready",
            requiredScopes: ["video.publish", "video.upload"],
            missingSteps: [],
            notes: "Fixture lane connected through Metricool approval_required mode.",
          },
          {
            platform: "instagram",
            handle: "@sportsdaily",
            displayName: "Sports Daily Clips",
            status: "not_created",
            requiredScopes: ["instagram_basic", "instagram_content_publish", "pages_show_list"],
            missingSteps: ["Connect Instagram profile and import real proof."],
            notes: "External account proof still required.",
          },
          {
            platform: "youtube",
            handle: "@sportsdaily",
            displayName: "Sports Daily Clips",
            status: "not_created",
            requiredScopes: ["https://www.googleapis.com/auth/youtube.upload"],
            missingSteps: ["Connect YouTube channel and import real proof."],
            notes: "External account proof still required.",
          },
        ],
      },
      {
        id: "meme-radar",
        name: "Meme Radar",
        category: "memes",
        platforms: ["tiktok", "instagram", "youtube"],
        dailyClipTarget: 12,
        weeklyViewsGoal: 1_000_000,
        lastWeekViews: 0,
        status: "active",
        contentPolicy: "Owned, licensed, permissioned or recreated meme clips only.",
        platformAccounts: [
          {
            platform: "tiktok",
            handle: "@memeradar",
            displayName: "Meme Radar",
            status: "ready",
            requiredScopes: ["video.publish", "video.upload"],
            missingSteps: [],
            notes: "Fixture lane connected through Metricool approval_required mode.",
          },
          {
            platform: "instagram",
            handle: "@memeradar",
            displayName: "Meme Radar",
            status: "not_created",
            requiredScopes: ["instagram_basic", "instagram_content_publish", "pages_show_list"],
            missingSteps: ["Connect Instagram profile and import real proof."],
            notes: "External account proof still required.",
          },
          {
            platform: "youtube",
            handle: "@memeradar",
            displayName: "Meme Radar",
            status: "not_created",
            requiredScopes: ["https://www.googleapis.com/auth/youtube.upload"],
            missingSteps: ["Connect YouTube channel and import real proof."],
            notes: "External account proof still required.",
          },
        ],
      },
      {
        id: "streamer-pulse",
        name: "Streamer Pulse",
        category: "streamers",
        platforms: ["tiktok", "instagram", "youtube"],
        dailyClipTarget: 3,
        weeklyViewsGoal: 1_000_000,
        lastWeekViews: 0,
        status: "needs_connection",
        contentPolicy: "Streamer commentary only with permission or recreate-only source plans.",
        platformAccounts: [
          {
            platform: "tiktok",
            handle: "@streamerpulse",
            displayName: "Streamer Pulse",
            status: "not_created",
            requiredScopes: ["video.publish", "video.upload"],
            missingSteps: ["Connect TikTok profile and import real proof."],
            notes: "External account proof still required.",
          },
          {
            platform: "instagram",
            handle: "@streamerpulse",
            displayName: "Streamer Pulse",
            status: "not_created",
            requiredScopes: ["instagram_basic", "instagram_content_publish", "pages_show_list"],
            missingSteps: ["Connect Instagram profile and import real proof."],
            notes: "External account proof still required.",
          },
          {
            platform: "youtube",
            handle: "@streamerpulse",
            displayName: "Streamer Pulse",
            status: "not_created",
            requiredScopes: ["https://www.googleapis.com/auth/youtube.upload"],
            missingSteps: ["Connect YouTube channel and import real proof."],
            notes: "External account proof still required.",
          },
        ],
      },
    ],
    sources: [
      {
        id: "owned-test-source",
        label: "Safe owned test source folder",
        type: "owned_folder",
        freshness: "test",
        rightsMode: "owned",
        status: "planned",
      },
    ],
  });

  await writeJsonIfMissing(queuePath, {
    status: "approval_required",
    generatedAt: "2026-06-23T10:00:00.000Z",
    publishMode: "approval_required",
    realPublishEnabled: false,
    sourceReadiness: {
      status: "ready",
      categories: [
        {
          accountId: "sports-daily",
          accountName: "Sports Daily Clips",
          category: "sports",
          connectedNetworks: ["tiktok"],
          dailyClipTarget: 10,
          weeklyTargetClips: 70,
          minimumWeeklySourceAssets: 1,
          rightsReadyAssets: 0,
          missingSourceAssets: 1,
        },
        {
          accountId: "meme-radar",
          accountName: "Meme Radar",
          category: "memes",
          connectedNetworks: ["tiktok"],
          dailyClipTarget: 12,
          weeklyTargetClips: 84,
          minimumWeeklySourceAssets: 1,
          rightsReadyAssets: 0,
          missingSourceAssets: 1,
        },
      ],
      totals: {
        accounts: 2,
        connectedNetworks: 2,
        dailyClipTarget: 22,
        weeklyTargetClips: 154,
        minimumWeeklySourceAssets: 2,
        rightsReadyAssets: 0,
        missingSourceAssets: 2,
      },
      localOwnedSourceTotals: { sports: 0, memes: 0, streamers: 0, total: 0 },
      nextStep: "Run source readiness sync to derive real fixture-owned assets.",
    },
    totals: {
      queuedForApproval: 2,
      readyToSend: 0,
    },
    items: [
      {
        id: "test-meme-approval",
        postId: "test-meme-post",
        accountId: "meme-radar",
        accountName: "Meme Radar",
        platform: "tiktok",
        status: "queued_for_approval",
        approvalRequired: true,
        canSendNow: false,
        gates: [
          {
            id: "approval-required",
            label: "Metricool approval required",
            done: true,
            evidence: "Fixture remains in approval_required mode.",
          },
        ],
        blockers: [],
        nextStep: "Manual Metricool approval required before any publishing.",
      },
      {
        id: "test-sports-approval",
        postId: "test-sports-post",
        accountId: "sports-daily",
        accountName: "Sports Daily Clips",
        platform: "tiktok",
        status: "queued_for_approval",
        approvalRequired: true,
        canSendNow: false,
        gates: [
          {
            id: "approval-required",
            label: "Metricool approval required",
            done: true,
            evidence: "Fixture remains in approval_required mode.",
          },
        ],
        blockers: [],
        nextStep: "Manual Metricool approval required before any publishing.",
      },
    ],
  });
  await writeFileIfMissing(queueMarkdownPath, "# Metricool Execution Queue\n\nStatus: approval_required\n");
  await writeFileIfMissing(queueCsvPath, "id,account_id,platform,status,approval_required,can_send_now\n");

  await writeJsonIfMissing(path.join(rootDir, "account-evidence", "sports-daily-tiktok.json"), {
    status: "verified",
    accountId: "sports-daily",
    accountName: "Sports Daily Clips",
    platform: "tiktok",
    handle: "@sportsdaily",
    notes: "Metricool connected TikTok lane is verified for the safe test fixture; no secrets stored.",
  });
  await writeJsonIfMissing(path.join(rootDir, "account-evidence", "meme-radar-tiktok.json"), {
    status: "verified",
    accountId: "meme-radar",
    accountName: "Meme Radar",
    platform: "tiktok",
    handle: "@memeradar",
    notes: "Metricool connected TikTok lane is verified for the safe test fixture; no secrets stored.",
  });

  await writeJsonIfMissing(path.join(rootDir, "developer-app-evidence", "developer-app-connection-kit.json"), {
    status: "empty",
    generatedAt: "2026-06-23T10:00:00.000Z",
    connectionKitItems: [
      developerConnectionItem("tiktok", "TikTok", ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"], ["video.publish", "video.upload"]),
      developerConnectionItem("instagram", "Instagram Reels", ["META_APP_ID", "META_APP_SECRET"], ["instagram_basic", "instagram_content_publish", "pages_show_list"]),
      developerConnectionItem("youtube", "YouTube Shorts", ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"], ["https://www.googleapis.com/auth/youtube.upload"]),
    ],
  });

  await writeJsonIfMissing(path.join(rootDir, "official-permission-source-audit.json"), {
    status: "needs_review",
    generatedAt: "2026-06-23T10:00:00.000Z",
    markdownPath: path.join(rootDir, "official-permission-source-audit.md"),
    items: [
      officialSourceItem(
        "tiktok",
        "official_verified",
        "public",
        "request_now",
        ["video.publish", "video.upload"],
        [
          "https://developers.tiktok.com/doc/content-posting-api-get-started/",
          "https://developers.tiktok.com/doc/tiktok-api-scopes/",
        ],
        "Official TikTok Direct Post API reference lists video.publish as the Direct Post scope.",
      ),
      officialSourceItem(
        "instagram",
        "official_login_required",
        "login_required",
        "human_login_recheck",
        ["instagram_content_publish", "instagram_basic", "pages_show_list"],
        [
          "https://developers.facebook.com/docs/instagram-platform/content-publishing/",
          "https://developers.facebook.com/docs/permissions/reference/instagram_content_publish/",
          "https://developers.facebook.com/docs/instagram-platform/",
        ],
        "Meta developer documentation requires an authenticated developer review before approval can be claimed.",
      ),
      officialSourceItem(
        "youtube",
        "official_verified",
        "public",
        "request_now",
        ["https://www.googleapis.com/auth/youtube.upload"],
        [
          "https://developers.google.com/youtube/v3/docs/videos/insert",
          "https://developers.google.com/youtube/v3/guides/authentication",
        ],
        "Official YouTube videos.insert reference supports uploads through the YouTube Data API.",
      ),
    ],
  });

  await writeFileIfMissing(
    path.join(rootDir, "evidence-drop", "external-closeout-evidence-import.csv"),
    "kind,account_id,platform,status,scope,app_identifier,public_base_url,redirect_uri,portal_url,docs_url,proof,notes\n",
  );

  const proofTodoPath = path.join(rootDir, "reports", "clippers-external-closeout-proof-todo.json");
  if (!(await pathExists(proofTodoPath))) {
    const closeoutPack = spawnSync(process.execPath, ["script/clippers-external-closeout-pack.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(closeoutPack.status, 0, closeoutPack.stderr || closeoutPack.stdout);
  }

  const sourceReadinessSync = spawnSync(process.execPath, ["script/clippers-sync-metricool-source-readiness.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(sourceReadinessSync.status, 0, sourceReadinessSync.stderr || sourceReadinessSync.stdout);
};

test.before(async () => {
  await ensureClipperScriptFixtures();
});

test.after(async () => {
  await restoreClipperWorkspace();
});

test("owned source rights dry-run feeds Metricool source readiness sync without fake readiness", async () => {
  const originalQueue = await readFile(queuePath, "utf8").catch(() => null);
  const originalMarkdown = await readFile(queueMarkdownPath, "utf8").catch(() => null);
  const originalCsv = await readFile(queueCsvPath, "utf8").catch(() => null);

  try {
    const dryRun = spawnSync(process.execPath, ["script/clippers-record-owned-source-rights.mjs", "--dry-run"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(dryRun.status, 0, dryRun.stderr || dryRun.stdout);
    const audit = JSON.parse(dryRun.stdout);
    assert.equal(audit.realPublishEnabled, false);
    assert.equal(audit.publishMode, "approval_required");
    assert.equal(audit.rightsReady, audit.byCategory.sports.rightsReady + audit.byCategory.memes.rightsReady + audit.byCategory.streamers.rightsReady);
    assert.equal(audit.evidenceProblems, 0);
    assert.equal(audit.registrationPending, 0);

    const sync = spawnSync(process.execPath, ["script/clippers-sync-metricool-source-readiness.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(sync.status, 0, sync.stderr || sync.stdout);
    const synced = JSON.parse(sync.stdout);
    assert.equal(synced.realPublishEnabled, false);
    assert.equal(synced.publishMode, "approval_required");
    assert.equal(synced.localOwnedSourceTotals.total, audit.rightsReady);

    const queue = JSON.parse(await readFile(queuePath, "utf8"));
    assert.equal(queue.realPublishEnabled, false);
    assert.equal(queue.publishMode, "approval_required");
    assert.equal(queue.totals.readyToSend, 0);
    assert.equal(queue.sourceReadiness.localOwnedSourceTotals.total, audit.rightsReady);
    assert.equal(
      queue.sourceReadiness.totals.rightsReadyAssets,
      queue.sourceReadiness.categories.reduce((sum, category) => sum + category.rightsReadyAssets, 0),
    );
    assert.ok(queue.items.every((item) =>
      item.approvalRequired === true && item.canSendNow === false && item.status !== "ready_to_send"
    ));

    const syncScript = await readFile(path.join(process.cwd(), "script/clippers-sync-metricool-source-readiness.mjs"), "utf8");
    assert.ok(syncScript.includes("rightsAuditTimeoutMs"));
    assert.ok(syncScript.includes("detached: true"));
    assert.ok(syncScript.includes("process.kill(-child.pid"));
    assert.ok(syncScript.includes('child.kill("SIGKILL")'));
  } finally {
    if (originalQueue !== null) await writeFile(queuePath, originalQueue);
    else await unlink(queuePath).catch(() => undefined);
    if (originalMarkdown !== null) await writeFile(queueMarkdownPath, originalMarkdown);
    else await unlink(queueMarkdownPath).catch(() => undefined);
    if (originalCsv !== null) await writeFile(queueCsvPath, originalCsv);
    else await unlink(queueCsvPath).catch(() => undefined);
  }
});

test("account permission readiness reports Metricool MVP without claiming direct API approval", async () => {
  const result = spawnSync(process.execPath, ["script/clippers-account-permission-readiness.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "metricool_mvp_ready_with_external_blockers");
  assert.equal(output.launchMode, "metricool_approval_required");
  assert.equal(output.directSocialApisRequired, false);
  assert.equal(output.verifiedAccounts, 2);
  assert.equal(output.accountProfiles, 9);
  assert.equal(output.metricoolReadyLanes, 2);
  assert.equal(output.directApiReadyLanes, 0);
  assert.ok(output.externalProofsNeedEvidence > 0);
  assert.ok(output.externalEvidenceRepairRows > 0);
  assert.ok(output.fullReadinessPercent < 100);
  assert.ok(output.fullReadinessMissing > 0);
  assert.ok(output.nextEvidenceRows > 0);
  assert.ok(output.connectedMetricoolRightsReadyAssets > 0);
  assert.ok(output.localOwnedSourceAssets >= 0);

  const readiness = JSON.parse(await readFile(path.join(rootDir, "account-permission-readiness.json"), "utf8"));
  assert.equal(readiness.status, "metricool_mvp_ready_with_external_blockers");
  assert.equal(readiness.launchMode, "metricool_approval_required");
  assert.equal(readiness.directSocialApisRequired, false);
  assert.ok(readiness.externalCloseout.proofFilesNeedRealEvidence > 0);
  assert.ok(readiness.externalCloseout.nextEvidenceRows > 0);
  assert.match(readiness.externalCloseout.evidenceImportCsvPath, /external-closeout-evidence-import\.csv$/);
  assert.equal(readiness.sourceReadiness.connectedMetricoolRightsReadyAssets, output.connectedMetricoolRightsReadyAssets);
  assert.equal(readiness.sourceReadiness.localOwnedSourceAssets, output.localOwnedSourceAssets);
  assert.equal(readiness.fullReadinessGap.status, "metricool_mvp_ready_with_external_blockers");
  assert.equal(readiness.fullReadinessGap.percent, output.fullReadinessPercent);
  assert.ok(readiness.fullReadinessGap.missing > 0);
  assert.ok(readiness.fullReadinessGap.rows.some((row) => row.id === "external_proofs" && row.missing > 0));
  assert.ok(readiness.nextEvidenceDrop.rows > 0);
  assert.equal(readiness.nextEvidenceDrop.source, "external_closeout");
  assert.ok(readiness.nextEvidenceDrop.previewRows[0].includes("developer_app"));
  assert.ok(readiness.nextEvidenceDrop.previewCards.length > 0);
  assert.equal(readiness.nextEvidenceDrop.previewCards[0].kind, "developer_app");
  assert.equal(readiness.nextEvidenceDrop.previewCards[0].platform, "instagram");
  assert.match(readiness.nextEvidenceDrop.previewCards[0].proofPath, /external-closeout-proofs\/developer_app-instagram\.md$/);
  assert.match(readiness.nextEvidenceDrop.previewCards[0].nextStep, /real non-secret evidence/i);
  assert.match(readiness.nextEvidenceDrop.previewCards[0].copyText, /Missing fields: app_identifier, proof/);
  assert.match(readiness.nextEvidenceDrop.previewCards[0].copyText, /Proof file:/);
  const readinessMarkdown = await readFile(path.join(rootDir, "account-permission-readiness.md"), "utf8");
  assert.match(readinessMarkdown, /Full Readiness Gap/);
  assert.match(readinessMarkdown, /Preview rows:/);
  assert.match(readinessMarkdown, /Preview cards:/);
  assert.equal(readiness.totals.developerAppsApproved, 0);
  assert.equal(readiness.totals.permissionGroupsApproved, 0);
  assert.ok(readiness.accountRows.some((row) =>
    row.accountId === "sports-daily"
    && row.platform === "tiktok"
    && row.readyForMetricoolApproval === true
    && row.directApiReady === false
    && row.nextStep.includes("Ready for Metricool approval_required")
    && row.directApiBacklog.some((blocker) => blocker.includes("developer app not approved"))
  ));
  assert.ok(readiness.accountRows.some((row) =>
    row.accountId === "streamer-pulse"
    && row.platform === "tiktok"
    && row.accountStatus !== "verified"
    && row.readyForMetricoolApproval === false
  ));

  const nextEvidenceCsv = await readFile(path.join(rootDir, "account-permission-next-evidence.csv"), "utf8");
  assert.ok(nextEvidenceCsv.startsWith("kind,account_id,platform,status,scope,app_identifier,public_base_url,redirect_uri,portal_url,docs_url,proof,notes"));
  assert.match(nextEvidenceCsv, /external-closeout-proofs\/developer_app-instagram\.md/);
  assert.match(nextEvidenceCsv, /https:\/\/app\.clipprreview\.com\/api\/clippers\/oauth\/instagram\/callback/);
  assert.doesNotMatch(nextEvidenceCsv, /CLIENT_SECRET|client_secret|password=|refresh_token|access_token/);
});

test("operational readiness keeps MVP separate from full external readiness", async () => {
  const result = spawnSync(process.execPath, ["script/clippers-operational-readiness.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "metricool_mvp_ready");
  assert.equal(output.metricoolMvpReady, true);
  assert.equal(output.fullDirectApiReady, false);
  assert.equal(output.readyToSend, 0);
  assert.equal(output.metricoolMvpBlockers, 0);
  assert.ok(output.directApiBacklog > 0);

  const report = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-operational-readiness.json"), "utf8"));
  assert.equal(report.status, "metricool_mvp_ready");
  assert.equal(report.mvp.launchMode, "metricool_approval_required");
  assert.equal(report.mvp.directSocialApisRequired, false);
  assert.equal(report.metricool.realPublishEnabled, false);
  assert.equal(report.metricool.publishMode, "approval_required");
  assert.equal(report.metricool.readyToSend, 0);
  assert.equal(report.accounts.directApiReadyLanes, 0);
  assert.deepEqual(report.metricoolMvpBlockers, []);
  assert.ok(report.directApiBacklog.some((blocker) => blocker.includes("direct API publishing remains blocked")));
});

test("external closeout pack lists remaining account developer and permission actions", async () => {
  const result = spawnSync(process.execPath, ["script/clippers-external-closeout-pack.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "blocked_external_actions");
  assert.equal(output.accounts, 7);
  assert.equal(output.developerApps, 3);
  assert.equal(output.permissions, 6);
  assert.equal(output.tasks, 16);
  assert.equal(output.goLiveAuditStatus, "blocked_external_actions");
  assert.ok(output.goLiveAuditBlockedGates > 0);
  assert.equal(output.proofFilesNeedRealEvidence, 16);
  assert.match(output.proofTodoPath, /clippers-external-closeout-proof-todo\.md$/);
  assert.match(output.operatorQueuePath, /clippers-external-closeout-operator-queue\.md$/);
  assert.match(output.goLiveAuditPath, /clippers-external-go-live-audit\.md$/);
  assert.match(output.actionSheetPath, /clippers-external-operator-action-sheet\.md$/);
  assert.match(output.nextWorkRunPath, /clippers-external-next-work-run\.md$/);

  const pack = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-external-closeout-pack.json"), "utf8"));
  assert.equal(pack.metricool.readyToSend, 0);
  assert.equal(pack.metricool.publishMode, "approval_required");
  assert.ok(pack.paths.proofDir.endsWith("external-closeout-proofs"));
  assert.ok(!pack.blockers.some((blocker) => blocker.includes("Local app is not listening")));
  assert.ok(pack.tasks.some((task) => task.id === "account:streamer-pulse:tiktok" && task.priority === "critical"));
  assert.ok(pack.tasks.some((task) => task.id === "developer_app:tiktok" && task.missingEnvVars.includes("TIKTOK_CLIENT_KEY")));
  assert.ok(pack.tasks.some((task) => task.id === "permission:tiktok:video.publish"));
  assert.ok(pack.tasks.every((task) => task.proofPath && task.proofPath.includes("external-closeout-proofs")));
  assert.equal(pack.totals.proofFilesNeedRealEvidence, 16);
  assert.equal(pack.artifactSafety.status, "clean");
  assert.equal(pack.artifactSafety.scanned, 19);
  assert.equal(pack.artifactSafety.findings.length, 0);
  assert.equal(pack.paths.actionSheetMarkdown.endsWith("clippers-external-operator-action-sheet.md"), true);
  assert.equal(pack.paths.nextWorkRunMarkdown.endsWith("clippers-external-next-work-run.md"), true);
  assert.equal(pack.paths.nextWorkRunCsv.endsWith("clippers-external-next-work-run.csv"), true);
  assert.equal(pack.actionSheet.status, "needs_operator");
  assert.equal(pack.actionSheet.totals.rows, 16);
  assert.equal(pack.actionSheet.totals.developerApps, 3);
  assert.equal(pack.actionSheet.totals.permissions, 6);
  assert.equal(pack.actionSheet.totals.accounts, 7);
  assert.equal(pack.actionSheet.nextAction.id, "developer_app:instagram");
  assert.equal(pack.actionSheet.accountSetupCards.length, 7);
  assert.ok(pack.actionSheet.accountSetupCards.some((card) => card.id === "account:sports-daily:instagram" && card.metricoolBridgeNeeded === true));
  assert.ok(pack.actionSheet.accountSetupCards.every((card) => card.copyNote.includes("Do not store login credentials")));
  assert.equal(pack.actionSheet.developerAppCards.length, 3);
  assert.ok(pack.actionSheet.developerAppCards.some((card) => card.platform === "tiktok" && card.redirectUri.includes("/api/clippers/oauth/tiktok/callback")));
  assert.ok(pack.actionSheet.developerAppCards.every((card) => card.copyNote.includes("approval_required")));
  assert.equal(pack.actionSheet.permissionRequestCards.length, 6);
  assert.ok(pack.actionSheet.permissionRequestCards.some((card) => card.scope === "video.publish" && card.copyNote.includes("approval_required")));
  assert.equal(pack.actionSheet.workSession.status, "needs_operator");
  assert.equal(pack.actionSheet.workSession.label, "Next 45-minute closeout work run");
  assert.equal(pack.actionSheet.workSession.rows[0].id, "developer_app:instagram");
  assert.equal(pack.actionSheet.workSession.rows.length, 5);
  assert.equal(pack.nextWorkRun.status, "needs_operator");
  assert.equal(pack.nextWorkRun.paths.markdown.endsWith("clippers-external-next-work-run.md"), true);
  assert.equal(pack.nextWorkRun.rows[0].id, "developer_app:instagram");
  assert.equal(pack.nextWorkRun.rows.length, 5);
  assert.ok(pack.nextWorkRun.portalSessions.length >= 3);
  assert.ok(pack.nextWorkRun.portalSessions.some((session) => session.platform === "instagram" && session.actions >= 1));
  assert.ok(pack.nextWorkRun.portalSessions.every((session) => session.copyPacket.includes("Evidence CSV fields to fill:")));
  assert.ok(pack.nextWorkRun.portalSessions.every((session) => session.evidenceStarterRows.length > 0));
  assert.ok(pack.actionSheet.workSession.validateCommand.includes("clippers:import-external-closeout-evidence"));
  assert.ok(pack.actionSheet.workSession.applyReadyCommand.includes("--apply-ready"));
  assert.ok(pack.actionSheet.workSession.rows.every((row) => row.copyPacket.includes("Evidence CSV fields to fill:")));
  assert.equal(JSON.stringify(pack.actionSheet.workSession).includes("client_secret"), false);
  assert.equal(pack.actionSheet.officialSourceCards.length, 6);
  assert.ok(pack.actionSheet.officialSourceCards.some((card) => card.scope === "video.publish" && card.sourceStatus === "official_verified"));
  assert.ok(pack.actionSheet.officialSourceCards.some((card) => card.scope === "instagram_content_publish" && card.accessMode === "login_required"));
  assert.ok(pack.actionSheet.officialSourceCards.some((card) => card.scope === "https://www.googleapis.com/auth/youtube.upload" && card.primaryOfficialUrl.includes("developers.google.com/youtube")));
  assert.ok(pack.actionSheet.guardrails.some((item) => item.includes("Metricool remains approval_required")));
  assert.equal(pack.goLiveAudit.status, "blocked_external_actions");
  assert.equal(pack.goLiveAudit.totals.operatorActions, 16);
  assert.equal(pack.goLiveAudit.totals.proofFilesNeedRealEvidence, 16);
  assert.equal(pack.goLiveAudit.totals.metricoolReadyToSend, 0);
  assert.equal(pack.goLiveAudit.totals.workBlocks, 3);
  assert.ok(pack.goLiveAudit.totals.estimatedOperatorMinutes > 0);
  assert.equal(pack.goLiveAudit.totals.evidenceRepairRows, 16);
  assert.equal(pack.goLiveAudit.evidenceRepairQueue.length, 16);
  assert.equal(pack.goLiveAudit.evidenceRepairQueue[0].id, pack.tasks[0].id);
  assert.equal(pack.goLiveAudit.evidenceRepairQueue[0].proofPath, pack.tasks[0].proofPath);
  assert.ok(pack.goLiveAudit.evidenceRepairQueue.every((row) => row.reason.length > 0));
  assert.ok(pack.goLiveAudit.evidenceRepairQueue[0].copyPacket.includes("Repair action:"));
  assert.ok(pack.goLiveAudit.evidenceRepairQueue[0].copyPacket.includes("Evidence CSV fields to fill:"));
  assert.ok(pack.goLiveAudit.evidenceRepairQueue[0].copyPacket.includes("Do not paste private credentials"));
  assert.equal(pack.goLiveAudit.evidenceRepairQueue[0].copyPacket.includes("client_secret"), false);
  assert.equal(pack.goLiveAudit.workBlocks.length, 3);
  assert.ok(pack.goLiveAudit.workBlocks.some((block) => block.id === "developer_apps" && block.actions === 3));
  assert.ok(pack.goLiveAudit.workBlocks.some((block) => block.id === "permissions" && block.actions === 6));
  assert.ok(pack.goLiveAudit.workBlocks.some((block) => block.id === "accounts" && block.actions === 7));
  assert.ok(pack.goLiveAudit.workBlocks.every((block) => block.doneCriteria.length >= 3));
  assert.equal(pack.goLiveAudit.gates.some((gate) => gate.id === "metricool_publish_mode" && gate.status === "verified"), true);
  assert.equal(pack.goLiveAudit.gates.some((gate) => gate.id === "external_actions" && gate.status === "blocked"), true);
  assert.equal(pack.goLiveAudit.gates.some((gate) => gate.id === "evidence_import" && gate.status === "blocked"), true);
  assert.equal(pack.goLiveAudit.nextAction.id, "developer_app:instagram");
  assert.ok(pack.tasks.every((task) => task.proofStatus === "needs_real_proof"));
  assert.equal(pack.proofTodo.length, 16);
  assert.ok(pack.proofTodo.every((row) => !row.requiredCsvStatus.includes("_or_")));
  assert.ok(pack.proofTodo.some((row) => row.id === "developer_app:tiktok" && row.requiredCsvStatus === "submitted"));
  assert.ok(pack.proofTodo.some((row) => row.id === "developer_app:tiktok" && row.requiredCsvFields.includes("app_identifier")));
  assert.ok(pack.proofTodo.some((row) => row.id === "developer_app:tiktok" && row.missingCsvFields.includes("app_identifier")));
  assert.ok(pack.proofTodo.some((row) => row.id === "developer_app:tiktok" && row.requiredCsvFields.includes("public_base_url")));
  assert.ok(pack.proofTodo.some((row) => row.id === "developer_app:tiktok" && row.blockers.some((blocker) => blocker.includes("app_identifier"))));
  assert.ok(pack.proofTodo.some((row) => row.id === "permission:tiktok:video.publish" && row.requiredCsvStatus === "requested"));
  assert.ok(pack.proofTodo.some((row) => row.id === "permission:tiktok:video.publish" && row.requiredCsvFields.includes("scope")));
  assert.ok(pack.proofTodo.some((row) => row.id === "permission:tiktok:video.publish" && row.blockers.some((blocker) => blocker.includes("proof stub"))));
  assert.ok(pack.proofTodo.some((row) => row.id === "account:streamer-pulse:tiktok" && row.requiredCsvStatus === "verified"));
  assert.equal(pack.operatorQueue.length, 16);
  assert.equal(pack.operatorQueue[0].id, "developer_app:instagram");
  assert.equal(pack.operatorQueue[0].rank, 1);
  assert.ok(pack.operatorQueue[0].operatorAction.includes("developer portal"));
  assert.ok(pack.operatorQueue.some((row) => row.id === "developer_app:tiktok" && row.missingCsvFields.includes("app_identifier")));

  const evidenceCsv = await readFile(path.join(rootDir, "evidence-drop/external-closeout-evidence-import.csv"), "utf8");
  assert.match(evidenceCsv, /kind,account_id,platform,status,scope,app_identifier,public_base_url,redirect_uri,portal_url,docs_url,proof,notes/);
  assert.match(evidenceCsv, /permission.*video\.publish/);
  assert.match(evidenceCsv, /external-closeout-proofs/);
  assert.doesNotMatch(evidenceCsv, /submitted_or_approved|requested_or_approved/);
  assert.match(evidenceCsv, /developer_app","[^"]*","tiktok","submitted/);
  assert.match(evidenceCsv, /permission","[^"]*","tiktok","requested","video\.publish/);
  const firstProof = await readFile(pack.tasks[0].proofPath, "utf8");
  assert.match(firstProof, /needs_real_proof/);
  assert.match(firstProof, /Safe proof examples/);
  assert.match(firstProof, /Completion checklist/);
  assert.match(firstProof, /Evidence CSV fields to fill/);
  assert.match(firstProof, /- status: verified/);
  const proofTodo = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-external-closeout-proof-todo.json"), "utf8"));
  assert.equal(proofTodo.rows.length, 16);
  assert.equal(proofTodo.artifactSafety.status, "clean");
  assert.equal(proofTodo.operatorQueue.length, 16);
  assert.equal(proofTodo.totals.proofFilesFilled, 0);
  assert.equal(proofTodo.rows.some((row) => row.readyToApply === true), false);
  const proofTodoCsv = await readFile(path.join(rootDir, "reports/clippers-external-closeout-proof-todo.csv"), "utf8");
  assert.match(proofTodoCsv, /required_csv_status/);
  assert.match(proofTodoCsv, /required_csv_fields/);
  assert.match(proofTodoCsv, /ready_to_apply/);
  assert.match(proofTodoCsv, /blockers/);
  assert.match(proofTodoCsv, /app_identifier/);
  assert.doesNotMatch(proofTodoCsv, /submitted_or_approved|requested_or_approved/);
  const proofTodoMarkdown = await readFile(path.join(rootDir, "reports/clippers-external-closeout-proof-todo.md"), "utf8");
  assert.match(proofTodoMarkdown, /Clippers External Closeout Proof Todo/);
  assert.match(proofTodoMarkdown, /Do not paste tokens/);
  const operatorQueue = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-external-closeout-operator-queue.json"), "utf8"));
  assert.equal(operatorQueue.rows.length, 16);
  assert.equal(operatorQueue.artifactSafety.status, "clean");
  assert.equal(operatorQueue.totals.critical, 10);
  assert.match(operatorQueue.nextStep, /developer portal|account\/profile/);
  const operatorQueueCsv = await readFile(path.join(rootDir, "reports/clippers-external-closeout-operator-queue.csv"), "utf8");
  assert.match(operatorQueueCsv, /missing_csv_fields/);
  assert.match(operatorQueueCsv, /operator_action/);
  const operatorQueueMarkdown = await readFile(path.join(rootDir, "reports/clippers-external-closeout-operator-queue.md"), "utf8");
  assert.match(operatorQueueMarkdown, /Clippers External Closeout Operator Queue/);
  assert.match(operatorQueueMarkdown, /shortest safe queue/);
  const goLiveAudit = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-external-go-live-audit.json"), "utf8"));
  assert.equal(goLiveAudit.status, "blocked_external_actions");
  assert.equal(goLiveAudit.totals.blocked > 0, true);
  assert.equal(goLiveAudit.nextAction.id, "developer_app:instagram");
  const goLiveAuditCsv = await readFile(path.join(rootDir, "reports/clippers-external-go-live-audit.csv"), "utf8");
  assert.match(goLiveAuditCsv, /artifact_safety/);
  assert.match(goLiveAuditCsv, /metricool_publish_mode/);
  assert.match(goLiveAuditCsv, /work_block/);
  assert.match(goLiveAuditCsv, /developer_apps/);
  assert.match(goLiveAuditCsv, /evidence_repair/);
  const goLiveAuditMarkdown = await readFile(path.join(rootDir, "reports/clippers-external-go-live-audit.md"), "utf8");
  assert.match(goLiveAuditMarkdown, /Clippers External Go-Live Audit/);
  assert.match(goLiveAuditMarkdown, /does not enable automatic publishing/);
  assert.match(goLiveAuditMarkdown, /Work Blocks/);
  assert.match(goLiveAuditMarkdown, /Developer apps/);
  assert.match(goLiveAuditMarkdown, /Evidence Repair Queue/);
  assert.match(goLiveAuditMarkdown, /Copy packet:/);
  const actionSheet = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-external-operator-action-sheet.json"), "utf8"));
  assert.equal(actionSheet.rows.length, 16);
  assert.equal(actionSheet.blocks.length, 3);
  assert.equal(actionSheet.accountSetupCards.length, 7);
  assert.equal(actionSheet.developerAppCards.length, 3);
  assert.equal(actionSheet.permissionRequestCards.length, 6);
  assert.equal(actionSheet.officialSourceCards.length, 6);
  assert.equal(actionSheet.portalCloseoutBoard.length, 3);
  assert.ok(actionSheet.portalCloseoutBoard.some((card) => card.platform === "instagram" && card.actions > 0));
  assert.ok(actionSheet.portalCloseoutBoard.some((card) => card.platform === "tiktok" && card.critical > 0));
  assert.ok(actionSheet.portalCloseoutBoard.some((card) => card.platform === "youtube" && card.evidenceStarterRows.some((row) => row.includes("youtube"))));
  assert.ok(actionSheet.portalCloseoutBoard.every((card) => card.checklist.some((item) => item.includes("approval_required"))));
  assert.ok(actionSheet.portalCloseoutBoard.every((card) => card.evidenceStarterRows.length === card.actions));
  assert.ok(actionSheet.officialSourceCards.every((card) => card.permissionProofPath.includes("external-closeout-proofs")));
  assert.ok(actionSheet.officialSourceCards.some((card) => card.scope === "video.upload" && card.submitDecision === "request_now"));
  assert.equal(actionSheet.nextAction.id, "developer_app:instagram");
  assert.ok(actionSheet.rows.every((row) => row.copyPacket.includes("Evidence CSV fields to fill:")));
  const actionSheetCsv = await readFile(path.join(rootDir, "reports/clippers-external-operator-action-sheet.csv"), "utf8");
  assert.match(actionSheetCsv, /operator_action/);
  assert.match(actionSheetCsv, /proof_path/);
  const actionSheetMarkdown = await readFile(path.join(rootDir, "reports/clippers-external-operator-action-sheet.md"), "utf8");
  assert.match(actionSheetMarkdown, /Clippers External Operator Action Sheet/);
  assert.match(actionSheetMarkdown, /This is the working sheet/);
  assert.match(actionSheetMarkdown, /Next Work Run/);
  assert.match(actionSheetMarkdown, /Apply ready/);
  assert.match(actionSheetMarkdown, /Account Setup Cards/);
  assert.match(actionSheetMarkdown, /Setup note:/);
  assert.match(actionSheetMarkdown, /Developer App Cards/);
  assert.match(actionSheetMarkdown, /Portal Closeout Board/);
  assert.match(actionSheetMarkdown, /App review use case:/);
  assert.match(actionSheetMarkdown, /Permission Request Cards/);
  assert.match(actionSheetMarkdown, /Review note:/);
  assert.match(actionSheetMarkdown, /Official Permission Source Cards/);
  assert.match(actionSheetMarkdown, /Verified claims:/);
  assert.match(actionSheetMarkdown, /Recheck steps:/);
  assert.match(actionSheetMarkdown, /Copy packet:/);
  assert.doesNotMatch(actionSheetMarkdown, /Auto-send/);
  const nextWorkRun = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-external-next-work-run.json"), "utf8"));
  assert.equal(nextWorkRun.status, "needs_operator");
  assert.equal(nextWorkRun.rows.length, 5);
  assert.equal(nextWorkRun.rows[0].id, "developer_app:instagram");
  const nextWorkRunMarkdown = await readFile(path.join(rootDir, "reports/clippers-external-next-work-run.md"), "utf8");
  assert.match(nextWorkRunMarkdown, /Clippers External Next Work Run/);
  assert.match(nextWorkRunMarkdown, /Apply ready/);
  assert.match(nextWorkRunMarkdown, /Portal Sessions/);
  assert.match(nextWorkRunMarkdown, /Copy packet:/);
  assert.match(nextWorkRunMarkdown, /Evidence CSV fields to fill:/);
  const nextWorkRunCsv = await readFile(path.join(rootDir, "reports/clippers-external-next-work-run.csv"), "utf8");
  assert.match(nextWorkRunCsv, /order,id,lane,platform,required_status.*copy_packet/);
  assert.match(nextWorkRunCsv, /developer_app:instagram/);
  const productionPublicUrl = JSON.parse(await readFile(path.join(rootDir, "production-public-url.json"), "utf8")).publicBaseUrl.replace(/\/$/, "");
  const productionPublicUrlPattern = regexEscape(productionPublicUrl);
  const developerProof = await readFile(path.join(rootDir, "evidence-drop/external-closeout-proofs/developer_app-tiktok.md"), "utf8");
  assert.match(developerProof, /App identifier\/client key\/project ID is public-safe/);
  assert.match(developerProof, /No client private value/);
  assert.match(developerProof, /Evidence CSV fields to fill/);
  assert.match(developerProof, /- app_identifier:/);
  assert.match(developerProof, new RegExp(`- public_base_url: ${productionPublicUrlPattern}`));
  assert.match(developerProof, new RegExp(`- redirect_uri: ${productionPublicUrlPattern}/api/clippers/oauth/tiktok/callback`));

  const importer = await readFile(path.join(process.cwd(), "script/clippers-import-external-closeout-evidence.ts"), "utf8");
  assert.match(importer, /const batchRejected = batchResult\?\.launchEvidenceBatch\.rejected\.length \|\| 0/);
  assert.match(importer, /batchRejected === 0/);
  assert.match(importer, /rejected\.length \|\| strictBlocked \|\| batchRejected/);
  assert.match(importer, /--apply-ready/);
  assert.match(importer, /partial_ready_to_apply/);
  assert.match(importer, /partial_import_applied/);

  const source = await readFile(path.join(process.cwd(), "script/clippers-external-closeout-pack.mjs"), "utf8");
  assert.match(source, /const blocked = tasks\.length > 0 \|\| safeOperationalBlockers\.length > 0/);
  assert.match(source, /status: blocked \? "blocked_external_actions" : "ready_for_final_review"/);

  const routes = await readFile(path.join(process.cwd(), "server/routes.ts"), "utf8");
  assert.match(routes, /\/api\/clippers\/external-closeout-proof-todo/);
  assert.match(routes, /\/api\/clippers\/external-closeout-operator-queue/);
  assert.match(routes, /\/api\/clippers\/external-closeout-next-action/);
  assert.match(routes, /\/api\/clippers\/external-next-work-run/);
  assert.match(routes, /\/api\/clippers\/prepare-external-next-work-run/);
  assert.match(routes, /externalCloseoutOperatorQueue/);
  assert.match(routes, /externalCloseoutNextAction/);
  assert.match(routes, /externalCloseoutNextWorkRun/);
  assert.match(routes, /copyPacket/);
  assert.match(routes, /Do not paste passwords/);
  assert.match(routes, /External Closeout Proof Todo/);
  assert.match(routes, /External Go-Live Audit \+ Repair Queue/);
  assert.match(routes, /data-proof-todo-action="load"/);
  assert.match(routes, /data-go-live-audit-action="load"/);
  assert.match(routes, /loadExternalCloseoutProofTodo/);
  assert.match(routes, /loadExternalGoLiveAudit/);
  assert.match(routes, /Operator queue/);
  assert.match(routes, /Repair rows/);
  assert.match(routes, /First repair copy packet/);
  assert.match(routes, /\/api\/clippers\/preview-external-closeout-evidence-import/);
  assert.match(routes, /\/api\/clippers\/apply-external-closeout-evidence-import/);
  assert.match(routes, /\/api\/clippers\/apply-ready-external-closeout-evidence-import/);
  assert.match(routes, /x-clippers-operator-confirm/);
  assert.match(routes, /apply-ready-external-closeout-evidence/);
  assert.match(routes, /Apply ready rows/);
  assert.match(routes, /data-closeout-action="apply-ready"/);
  assert.match(routes, /Operator confirmation header required/);
  assert.match(routes, /await runClipperExternalCloseoutPack\(\)/);
  assert.match(routes, /externalCloseoutOperatorQueue: await readClipperExternalCloseoutOperatorQueue\(\)/);
  assert.match(routes, /externalCloseoutNextWorkRun: await readClipperExternalCloseoutNextWorkRun\(\)/);
  assert.match(routes, /Failed to prepare clippers external next work run/);

  const ui = await readFile(path.join(process.cwd(), "client/src/pages/clippers.tsx"), "utf8");
  assert.match(ui, /queryKey: \["\/api\/clippers\/external-closeout-proof-todo"\]/);
  assert.match(ui, /queryKey: \["\/api\/clippers\/external-closeout-operator-queue"\]/);
  assert.match(ui, /queryKey: \["\/api\/clippers\/external-closeout-next-action"\]/);
  assert.match(ui, /queryKey: \["\/api\/clippers\/external-next-work-run"\]/);
  assert.match(ui, /\/api\/clippers\/prepare-external-next-work-run/);
  assert.match(ui, /data-testid="clippers-external-closeout-proof-todo"/);
  assert.match(ui, /data-testid="clippers-external-closeout-operator-queue"/);
  assert.match(ui, /data-testid="clippers-external-closeout-next-action"/);
  assert.match(ui, /data-testid="clippers-external-action-sheet"/);
  assert.match(ui, /External Operator Action Sheet/);
  assert.match(ui, /data-testid="clippers-external-work-run"/);
  assert.match(ui, /data-testid="prepare-clippers-external-next-work-run-button"/);
  assert.match(ui, /visibleExternalNextWorkRun/);
  assert.match(ui, /workSession/);
  assert.match(ui, /nextWorkRunMarkdown/);
  assert.match(ui, /targetMinutes/);
  assert.match(ui, /Apply ready/);
  assert.match(ui, /data-testid="clippers-external-portal-closeout-board"/);
  assert.match(ui, /portalCloseoutBoard/);
  assert.match(ui, /Account setup cards/);
  assert.match(ui, /Developer app cards/);
  assert.match(ui, /Permission request cards/);
  assert.match(ui, /Official source cards/);
  assert.match(ui, /officialSourceCards/);
  assert.match(ui, /data-testid="clippers-external-go-live-audit"/);
  assert.match(ui, /data-testid="clippers-external-go-live-work-blocks"/);
  assert.match(ui, /data-testid="clippers-external-go-live-repair-queue"/);
  assert.match(ui, /\(externalCloseoutPack\.goLiveAudit\.evidenceRepairQueue \|\| \[\]\)\.slice\(0, 8\)/);
  assert.match(ui, /<details/);
  assert.match(ui, /row\.copyPacket/);
  assert.match(ui, /External Go-Live Audit/);
  assert.match(ui, /externalCloseoutNextAction\.copyPacket/);
  assert.match(ui, /Operator Queue/);
  assert.match(ui, /Artifact safety/);
  assert.match(ui, /row\.blockers\.slice\(0, 2\)/);
  assert.match(ui, /data-testid="clippers-external-closeout-evidence-import"/);
  assert.match(ui, /data-testid="preview-clippers-external-closeout-evidence-import-button"/);
  assert.match(ui, /data-testid="apply-clippers-external-closeout-evidence-import-button"/);
  assert.match(ui, /data-testid="apply-ready-clippers-external-closeout-evidence-import-button"/);
  assert.match(ui, /data-testid="clippers-external-closeout-accepted-rows"/);
  assert.match(ui, /Apply ready/);
  assert.match(ui, /Accepted rows ready for apply/);
  assert.match(ui, /Copy starter/);
  assert.match(ui, /row\.safeProofStarter/);
  assert.match(ui, /x-clippers-operator-confirm/);
  assert.match(ui, /setQueryData\(\["\/api\/clippers\/external-closeout-operator-queue"\]/);
});

test("external closeout pack redacts unsafe official source-card fields", async () => {
  const auditPath = path.join(rootDir, "official-permission-source-audit.json");
  const originalAudit = await readFile(auditPath, "utf8");
  const audit = JSON.parse(originalAudit);
  audit.markdownPath = "https://proof.example/report?access=unsafe-source-audit";
  audit.items[0].sourceStatus = "client_secret";
  audit.items[0].accessMode = "cookie";
  audit.items[0].submitDecision = "api_key";
  audit.items[0].officialUrls = ["https://developers.tiktok.com/doc/content-posting-api-get-started/?access=unsafe-source"];
  audit.items[0].verifiedClaims = ["Official claim with https://example.com/proof?signature=unsafe-source"];

  try {
    await writeFile(auditPath, JSON.stringify(audit, null, 2));
    const result = spawnSync(process.execPath, ["script/clippers-external-closeout-pack.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const actionSheet = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-external-operator-action-sheet.json"), "utf8"));
    const tiktokSourceCard = actionSheet.officialSourceCards.find((card) => card.scope === "video.publish");
    assert.ok(tiktokSourceCard);
    assert.equal(tiktokSourceCard.sourceStatus, "[redacted unsafe official source reference]");
    assert.equal(tiktokSourceCard.accessMode, "[redacted unsafe official source reference]");
    assert.equal(tiktokSourceCard.submitDecision, "[redacted unsafe official source reference]");
    assert.deepEqual(tiktokSourceCard.officialUrls, ["[redacted unsafe official source reference]"]);
    assert.equal(tiktokSourceCard.primaryOfficialUrl, "[redacted unsafe official source reference]");
    assert.equal(tiktokSourceCard.sourceAuditPath, "[redacted unsafe official source reference]");
    assert.deepEqual(tiktokSourceCard.verifiedClaims, ["[redacted unsafe official source reference]"]);

    const actionSheetMarkdown = await readFile(path.join(rootDir, "reports/clippers-external-operator-action-sheet.md"), "utf8");
    assert.doesNotMatch(actionSheetMarkdown, /unsafe-source|unsafe-source-audit|client_secret|api_key|signature=/);
  } finally {
    await writeFile(auditPath, originalAudit);
    const restore = spawnSync(process.execPath, ["script/clippers-external-closeout-pack.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(restore.status, 0, restore.stderr || restore.stdout);
  }
});

test("external closeout evidence importer rejects placeholders without applying", async () => {
  const packResult = spawnSync(process.execPath, ["script/clippers-external-closeout-pack.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(packResult.status, 0, packResult.stderr || packResult.stdout);

  const result = spawnSync(process.execPath, ["--import", "tsx", "script/clippers-import-external-closeout-evidence.ts"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "blocked_invalid_evidence");
  assert.equal(output.applied, 0);
  assert.ok(output.rejected > 0);

  const report = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-external-closeout-evidence-import-report.json"), "utf8"));
  assert.equal(report.mode, "preview");
  assert.ok(report.rejected.some((row) => row.reason.includes("Proof file todavia contiene placeholders") || row.reason.includes("Status ambiguo")));
});

test("external closeout pack maps filled proof fields into evidence CSV", async () => {
  const proofPath = path.join(rootDir, "evidence-drop/external-closeout-proofs/developer_app-tiktok.md");
  const previousProof = await readFile(proofPath, "utf8");
  const filledProof = previousProof
    .replace("Status: needs_real_proof", "Status: proof_file_filled")
    .replace("Proof URL or secure local evidence path: <paste real proof URL or secure local evidence path>", "Proof URL or secure local evidence path: https://developers.tiktok.com/apps/tiktok-app-123")
    .replace("Portal/ticket/case/profile reference: <paste real reference>", "Portal/ticket/case/profile reference: TikTok app tiktok-app-123 submitted")
    .replace("Operator notes: <write at least one sentence confirming the external portal action is real>", "Operator notes: TikTok developer app was submitted in the official portal and proof is stored without secrets.")
    .replace(/- app_identifier:\s*$/m, "- app_identifier: tiktok-app-123")
    .replace("- proof: <paste real proof URL or local proof file path>", "- proof: https://developers.tiktok.com/apps/tiktok-app-123")
    .replace("- notes: <write one sentence confirming the portal action and where proof lives>", "- notes: TikTok developer app was submitted in the official portal and proof is stored without secrets.");

  try {
    await writeFile(proofPath, filledProof);
    const result = spawnSync(process.execPath, ["script/clippers-external-closeout-pack.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const evidenceCsv = await readFile(path.join(rootDir, "evidence-drop/external-closeout-evidence-import.csv"), "utf8");
    assert.match(evidenceCsv, /developer_app","[^"]*","tiktok","submitted","[^"]*","tiktok-app-123"/);
    assert.match(evidenceCsv, /https:\/\/developers\.tiktok\.com\/apps\/tiktok-app-123/);
    const proofTodo = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-external-closeout-proof-todo.json"), "utf8"));
    const row = proofTodo.rows.find((item) => item.id === "developer_app:tiktok");
    assert.equal(row.proofStatus, "proof_file_filled");
    assert.equal(row.blockers.some((blocker) => blocker.includes("app_identifier")), false);
  } finally {
    await writeFile(proofPath, previousProof);
    spawnSync(process.execPath, ["script/clippers-external-closeout-pack.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  }
});

test("external closeout pack blocks proof field secrets before writing reports", async () => {
  const proofPath = path.join(rootDir, "evidence-drop/external-closeout-proofs/developer_app-tiktok.md");
  const previousProof = await readFile(proofPath, "utf8");
  const unsafeProof = previousProof
    .replace("Status: needs_real_proof", "Status: proof_file_filled")
    .replace("Proof URL or secure local evidence path: <paste real proof URL or secure local evidence path>", "Proof URL or secure local evidence path: https://developers.tiktok.com/apps/tiktok-app-123?token=unsafe")
    .replace("Portal/ticket/case/profile reference: <paste real reference>", "Portal/ticket/case/profile reference: TikTok app tiktok-app-123 submitted")
    .replace("Operator notes: <write at least one sentence confirming the external portal action is real>", "Operator notes: TikTok developer app was submitted with client_secret accidentally pasted and must be blocked.")
    .replace(/- app_identifier:\s*$/m, "- app_identifier: tiktok-app-123")
    .replace("- proof: <paste real proof URL or local proof file path>", "- proof: https://developers.tiktok.com/apps/tiktok-app-123?token=unsafe")
    .replace("- notes: <write one sentence confirming the portal action and where proof lives>", "- notes: TikTok developer app was submitted with client_secret accidentally pasted and must be blocked.");

  try {
    await writeFile(proofPath, unsafeProof);
    const result = spawnSync(process.execPath, ["script/clippers-external-closeout-pack.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const evidenceCsv = await readFile(path.join(rootDir, "evidence-drop/external-closeout-evidence-import.csv"), "utf8");
    const pack = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-external-closeout-pack.json"), "utf8"));
    const proofTodo = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-external-closeout-proof-todo.json"), "utf8"));
    assert.equal(JSON.stringify(pack).includes("token=unsafe"), false);
    assert.equal(JSON.stringify(pack).includes("client_secret"), false);
    assert.equal(pack.artifactSafety.status, "blocked_sensitive_artifact");
    assert.ok(pack.artifactSafety.findings.length > 0);
    assert.equal(evidenceCsv.includes("token=unsafe"), false);
    assert.equal(evidenceCsv.includes("client_secret"), false);
    const row = proofTodo.rows.find((item) => item.id === "developer_app:tiktok");
    assert.equal(row.proofStatus, "needs_real_proof");
    assert.ok(row.blockers.some((blocker) => blocker.includes("sensitive token")));
  } finally {
    await writeFile(proofPath, previousProof);
    spawnSync(process.execPath, ["script/clippers-external-closeout-pack.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  }
});

test("external closeout pack keeps unsafe filled proof rows in operator queue", async () => {
  const proofPath = path.join(rootDir, "evidence-drop/external-closeout-proofs/developer_app-tiktok.md");
  const previousProof = await readFile(proofPath, "utf8");
  const unsafeProof = previousProof
    .replace("Status: needs_real_proof", "Status: proof_file_filled")
    .replace("Proof URL or secure local evidence path: <paste real proof URL or secure local evidence path>", "Proof URL or secure local evidence path: https://localhost/proof")
    .replace("Portal/ticket/case/profile reference: <paste real reference>", "Portal/ticket/case/profile reference: TikTok app tiktok-app-123 submitted")
    .replace("Operator notes: <write at least one sentence confirming the external portal action is real>", "Operator notes: TikTok developer app was submitted in the official portal but the public URL still needs a real production domain.")
    .replace(/- app_identifier:\s*$/m, "- app_identifier: tiktok-app-123")
    .replace(/- public_base_url: https:\/\/[^\s]+/, "- public_base_url: https://localhost:5010")
    .replace("- proof: <paste real proof URL or local proof file path>", "- proof: https://localhost/proof")
    .replace("- notes: <write one sentence confirming the portal action and where proof lives>", "- notes: TikTok developer app was submitted in the official portal but public proof URL still points to localhost.");

  try {
    await writeFile(proofPath, unsafeProof);
    const result = spawnSync(process.execPath, ["script/clippers-external-closeout-pack.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const proofTodo = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-external-closeout-proof-todo.json"), "utf8"));
    const row = proofTodo.rows.find((item) => item.id === "developer_app:tiktok");
    assert.equal(row.proofStatus, "proof_file_filled");
    assert.equal(row.readyToApply, false);
    assert.ok(row.blockers.some((blocker) => blocker.includes("public_base_url")));
    assert.ok(row.blockers.some((blocker) => blocker.includes("proof URL")));
    const operatorQueue = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-external-closeout-operator-queue.json"), "utf8"));
    assert.ok(operatorQueue.rows.some((item) => item.id === "developer_app:tiktok"));
  } finally {
    await writeFile(proofPath, previousProof);
    spawnSync(process.execPath, ["script/clippers-external-closeout-pack.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  }
});

test("external closeout pack keeps unsafe local proof paths in operator queue", async () => {
  const proofPath = path.join(rootDir, "evidence-drop/external-closeout-proofs/developer_app-tiktok.md");
  const shortLocalProofPath = path.join(rootDir, "evidence-drop/external-closeout-proofs/short-local-proof.md");
  const previousProof = await readFile(proofPath, "utf8");
  const unsafeProof = previousProof
    .replace("Status: needs_real_proof", "Status: proof_file_filled")
    .replace("Proof URL or secure local evidence path: <paste real proof URL or secure local evidence path>", `Proof URL or secure local evidence path: ${shortLocalProofPath}`)
    .replace("Portal/ticket/case/profile reference: <paste real reference>", "Portal/ticket/case/profile reference: TikTok app tiktok-app-123 submitted")
    .replace("Operator notes: <write at least one sentence confirming the external portal action is real>", "Operator notes: TikTok developer app was submitted in the official portal and local proof is referenced.")
    .replace(/- app_identifier:\s*$/m, "- app_identifier: tiktok-app-123")
    .replace("- proof: <paste real proof URL or local proof file path>", `- proof: ${shortLocalProofPath}`)
    .replace("- notes: <write one sentence confirming the portal action and where proof lives>", "- notes: TikTok developer app was submitted in the official portal and local proof is referenced.");

  try {
    await writeFile(shortLocalProofPath, "too short");
    await writeFile(proofPath, unsafeProof);
    const result = spawnSync(process.execPath, ["script/clippers-external-closeout-pack.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const proofTodo = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-external-closeout-proof-todo.json"), "utf8"));
    const row = proofTodo.rows.find((item) => item.id === "developer_app:tiktok");
    assert.equal(row.proofStatus, "proof_file_filled");
    assert.equal(row.readyToApply, false);
    assert.ok(row.blockers.some((blocker) => blocker.includes("local proof file is too short")));
    const operatorQueue = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-external-closeout-operator-queue.json"), "utf8"));
    assert.ok(operatorQueue.rows.some((item) => item.id === "developer_app:tiktok"));
  } finally {
    await writeFile(proofPath, previousProof);
    await unlink(shortLocalProofPath).catch(() => undefined);
    spawnSync(process.execPath, ["script/clippers-external-closeout-pack.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  }
});

test("external closeout pack keeps non-closeout statuses in operator queue", async () => {
  const proofPath = path.join(rootDir, "evidence-drop/external-closeout-proofs/developer_app-tiktok.md");
  const previousProof = await readFile(proofPath, "utf8");
  const rejectedProof = previousProof
    .replace("Status: needs_real_proof", "Status: proof_file_filled")
    .replace("Proof URL or secure local evidence path: <paste real proof URL or secure local evidence path>", "Proof URL or secure local evidence path: https://developers.tiktok.com/apps/tiktok-app-123")
    .replace("Portal/ticket/case/profile reference: <paste real reference>", "Portal/ticket/case/profile reference: TikTok app tiktok-app-123 rejected")
    .replace("Operator notes: <write at least one sentence confirming the external portal action is real>", "Operator notes: TikTok developer app was rejected in the official portal and must stay in the operator queue.")
    .replace(/- app_identifier:\s*$/m, "- app_identifier: tiktok-app-123")
    .replace("- status: submitted", "- status: rejected")
    .replace("- proof: <paste real proof URL or local proof file path>", "- proof: https://developers.tiktok.com/apps/tiktok-app-123")
    .replace("- notes: <write one sentence confirming the portal action and where proof lives>", "- notes: TikTok developer app was rejected in the official portal and must stay in the operator queue.");

  try {
    await writeFile(proofPath, rejectedProof);
    const result = spawnSync(process.execPath, ["script/clippers-external-closeout-pack.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const proofTodo = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-external-closeout-proof-todo.json"), "utf8"));
    const row = proofTodo.rows.find((item) => item.id === "developer_app:tiktok");
    assert.equal(row.proofStatus, "proof_file_filled");
    assert.equal(row.readyToApply, false);
    assert.ok(row.blockers.some((blocker) => blocker.includes("status must be one of submitted, approved")));
    const operatorQueue = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-external-closeout-operator-queue.json"), "utf8"));
    assert.ok(operatorQueue.rows.some((item) => item.id === "developer_app:tiktok"));
  } finally {
    await writeFile(proofPath, previousProof);
    spawnSync(process.execPath, ["script/clippers-external-closeout-pack.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  }
});

test("external closeout evidence importer previews clean rows for strict apply", async () => {
  const evidenceCsvPath = path.join(rootDir, "evidence-drop/external-closeout-evidence-import.csv");
  const previousCsv = await readFile(evidenceCsvPath, "utf8").catch(() => null);
  const cleanCsv = [
    "kind,account_id,platform,status,scope,app_identifier,public_base_url,redirect_uri,portal_url,docs_url,proof,notes",
    "account,meme-radar,youtube,verified,,,,,https://www.youtube.com/create_channel,,https://drive.google.com/file/d/meme-radar-youtube-proof/view,YouTube channel verified with manager proof and 2FA evidence stored outside repo",
    "developer_app,,youtube,submitted,,youtube-prod-001,https://app.clipprreview.com,https://app.clipprreview.com/api/clippers/oauth/youtube/callback,https://console.cloud.google.com/apis/library/youtube.googleapis.com,,https://console.cloud.google.com/cloud-resource-manager?project=youtube-prod-001,Evidence from YouTube ticket YT-123 confirms app review submitted without secrets",
    "permission,,tiktok,requested,video.publish,,,,https://developers.tiktok.com/,https://developers.tiktok.com/doc/content-posting-api-get-started/,https://developers.tiktok.com/apps/tiktok-prod-001/review,TikTok video.publish scope requested with reviewer note for owned clips approval queue",
  ].join("\n") + "\n";

  try {
    await writeFile(evidenceCsvPath, cleanCsv);
    const result = spawnSync(process.execPath, ["--import", "tsx", "script/clippers-import-external-closeout-evidence.ts"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, "ready_to_apply");
    assert.equal(output.accepted, 3);
    assert.equal(output.rejected, 0);
    assert.equal(output.applied, 0);

    const report = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-external-closeout-evidence-import-report.json"), "utf8"));
    assert.equal(report.nextStep.includes("--apply"), true);
    assert.equal(JSON.stringify(report).includes("client_secret"), false);
    assert.equal(JSON.stringify(report).includes("access_token"), false);
  } finally {
    if (previousCsv === null) await unlink(evidenceCsvPath).catch(() => undefined);
    else await writeFile(evidenceCsvPath, previousCsv);
  }
});

test("external closeout evidence importer can apply accepted rows while leaving rejected rows blocked", async () => {
  const evidenceCsvPath = path.join(rootDir, "evidence-drop/external-closeout-evidence-import.csv");
  const accountEvidencePath = path.join(rootDir, "account-evidence/meme-radar-youtube.json");
  const previousCsv = await readFile(evidenceCsvPath, "utf8").catch(() => null);
  const previousAccountEvidence = await readFile(accountEvidencePath, "utf8").catch(() => null);
  const partialCsv = [
    "kind,account_id,platform,status,scope,app_identifier,public_base_url,redirect_uri,portal_url,docs_url,proof,notes",
    "account,meme-radar,youtube,verified,,,,,https://www.youtube.com/create_channel,,https://drive.google.com/file/d/meme-radar-youtube-proof/view,YouTube account verified by Robert with manager access and non-secret proof reference",
    "permission,,tiktok,requested,video.publish,,,,https://developers.tiktok.com/,https://developers.tiktok.com/doc/content-posting-api-get-started/,https://developers.tiktok.com/apps/tiktok-prod-001/review,ok",
  ].join("\n") + "\n";

  try {
    await writeFile(evidenceCsvPath, partialCsv);
    const preview = spawnSync(process.execPath, ["--import", "tsx", "script/clippers-import-external-closeout-evidence.ts"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(preview.status, 0, preview.stderr || preview.stdout);
    const previewOutput = JSON.parse(preview.stdout);
    assert.equal(previewOutput.status, "partial_ready_to_apply");
    assert.equal(previewOutput.accepted, 1);
    assert.equal(previewOutput.rejected, 1);
    assert.equal(previewOutput.applied, 0);

    const applyReady = spawnSync(process.execPath, ["--import", "tsx", "script/clippers-import-external-closeout-evidence.ts", "--apply-ready"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(applyReady.status, 0, applyReady.stderr || applyReady.stdout);
    const applyReadyOutput = JSON.parse(applyReady.stdout);
    assert.equal(applyReadyOutput.status, "partial_import_applied");
    assert.equal(applyReadyOutput.accepted, 1);
    assert.equal(applyReadyOutput.rejected, 1);
    assert.equal(applyReadyOutput.applied, 1);

    const report = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-external-closeout-evidence-import-report.json"), "utf8"));
    assert.equal(report.mode, "apply_ready");
    assert.ok(report.nextStep.includes("filas rechazadas restantes"));
    assert.equal(report.repairSummary.status, "needs_repair");
    assert.equal(report.repairSummary.totalRejected, 1);
    assert.ok(report.repairSummary.topReasons.length > 0);
    assert.ok(report.repairSummary.nextStep.includes("Fix CSV row"));
    assert.match(report.repairSummary.nextRepairPacket, /Next evidence repair:/);
    assert.match(report.repairSummary.nextRepairPacket, /Proof file:/);
    assert.match(report.repairSummary.nextRepairPacket, /CSV row template:/);
    assert.match(report.repairSummary.nextRepairCsvRowTemplate, /permission/);
    assert.match(report.repairSummary.nextRepairCsvRowTemplate, /video\.publish/);
    assert.match(report.repairQueue[0].csvRowTemplate, /permission/);
    assert.match(report.repairQueue[0].csvRowTemplate, /video\.publish/);
    assert.equal(report.paths.repairTemplatesCsv.endsWith("clippers-external-closeout-repair-row-templates.csv"), true);
    const repairTemplatesCsv = await readFile(report.paths.repairTemplatesCsv, "utf8");
    assert.match(repairTemplatesCsv, /source_csv_row,closeout_id,lane,platform,account_id,scope,required_status,proof_path,replacement_csv_row/);
    assert.match(repairTemplatesCsv, /video\.publish/);
    assert.equal(report.paths.repairWorkPacketJson.endsWith("clippers-external-closeout-repair-work-packet.json"), true);
    assert.equal(report.paths.repairWorkPacketMarkdown.endsWith("clippers-external-closeout-repair-work-packet.md"), true);
    const repairWorkPacket = JSON.parse(await readFile(report.paths.repairWorkPacketJson, "utf8"));
    assert.equal(repairWorkPacket.totalItems, report.repairQueue.length);
    assert.ok(repairWorkPacket.groups.length > 0);
    assert.match(JSON.stringify(repairWorkPacket), /video\.publish/);
    assert.equal(/token=|client_secret=|api_key=|session=|bearer\s+[a-z0-9._-]+/i.test(JSON.stringify(repairWorkPacket)), false);
    const accountEvidence = JSON.parse(await readFile(accountEvidencePath, "utf8"));
    assert.equal(accountEvidence.status, "verified");
    assert.match(accountEvidence.notes, /meme-radar-youtube-proof/);
  } finally {
    if (previousCsv === null) await unlink(evidenceCsvPath).catch(() => undefined);
    else await writeFile(evidenceCsvPath, previousCsv);
    if (previousAccountEvidence === null) await unlink(accountEvidencePath).catch(() => undefined);
    else await writeFile(accountEvidencePath, previousAccountEvidence);
  }
});

test("external closeout evidence importer rejects secrets in persisted fields", async () => {
  const evidenceCsvPath = path.join(rootDir, "evidence-drop/external-closeout-evidence-import.csv");
  const previousCsv = await readFile(evidenceCsvPath, "utf8").catch(() => null);
  const unsafeCsv = [
    "kind,account_id,platform,status,scope,app_identifier,public_base_url,redirect_uri,portal_url,docs_url,proof,notes",
    "developer_app,,youtube,submitted,," +
      "sk-secret-test-value,https://app.clipprreview.com?api_key=unsafe," +
      "https://app.clipprreview.com/api/clippers/oauth/youtube/callback," +
      "https://console.cloud.google.com/apis/library/youtube.googleapis.com,," +
      "https://console.cloud.google.com/cloud-resource-manager?project=youtube-prod-001," +
      "YouTube app review submitted with normal portal proof",
  ].join("\n") + "\n";

  try {
    await writeFile(evidenceCsvPath, unsafeCsv);
    const result = spawnSync(process.execPath, ["--import", "tsx", "script/clippers-import-external-closeout-evidence.ts"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, "blocked_invalid_evidence");
    assert.equal(output.accepted, 0);
    assert.equal(output.rejected, 1);
    assert.equal(output.applied, 0);

    const report = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-external-closeout-evidence-import-report.json"), "utf8"));
    assert.ok(report.rejected.some((row) => row.reason.includes("secreto/token/password/cookie")));
    assert.equal(JSON.stringify(report).includes("sk-secret-test-value"), false);
    assert.equal(JSON.stringify(report).includes("api_key=unsafe"), false);
  } finally {
    if (previousCsv === null) await unlink(evidenceCsvPath).catch(() => undefined);
    else await writeFile(evidenceCsvPath, previousCsv);
  }
});

test("external closeout evidence importer rejects non-closeout statuses with valid proof", async () => {
  const evidenceCsvPath = path.join(rootDir, "evidence-drop/external-closeout-evidence-import.csv");
  const previousCsv = await readFile(evidenceCsvPath, "utf8").catch(() => null);
  const wrongStatusCsv = [
    "kind,account_id,platform,status,scope,app_identifier,public_base_url,redirect_uri,portal_url,docs_url,proof,notes",
    "account,meme-radar,youtube,submitted,,,,,https://www.youtube.com/create_channel,,https://drive.google.com/file/d/meme-radar-youtube-proof/view,Submitted account proof is not enough for external closeout until account is verified",
    "developer_app,,youtube,draft,,youtube-prod-001,https://app.clipprreview.com,https://app.clipprreview.com/api/clippers/oauth/youtube/callback,https://console.cloud.google.com/apis/library/youtube.googleapis.com,,https://console.cloud.google.com/cloud-resource-manager?project=youtube-prod-001,Draft app proof is not enough for external closeout until app is submitted or approved",
    "permission,,tiktok,blocked,video.publish,,,,https://developers.tiktok.com/,https://developers.tiktok.com/doc/content-posting-api-get-started/,https://developers.tiktok.com/apps/tiktok-prod-001/review,Blocked permission proof is not enough for external closeout until permission is requested or approved",
  ].join("\n") + "\n";

  try {
    await writeFile(evidenceCsvPath, wrongStatusCsv);
    const result = spawnSync(process.execPath, ["--import", "tsx", "script/clippers-import-external-closeout-evidence.ts"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, "blocked_invalid_evidence");
    assert.equal(output.accepted, 0);
    assert.equal(output.rejected, 3);
    assert.equal(output.applied, 0);

    const report = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-external-closeout-evidence-import-report.json"), "utf8"));
    assert.ok(report.rejected.some((row) => row.reason.includes("Account closeout status debe ser verified")));
    assert.ok(report.rejected.some((row) => row.reason.includes("Developer app closeout status debe ser submitted o approved")));
    assert.ok(report.rejected.some((row) => row.reason.includes("Permission closeout status debe ser requested o approved")));
  } finally {
    if (previousCsv === null) await unlink(evidenceCsvPath).catch(() => undefined);
    else await writeFile(evidenceCsvPath, previousCsv);
  }
});

test("external closeout evidence importer rejects weak notes with valid proof", async () => {
  const evidenceCsvPath = path.join(rootDir, "evidence-drop/external-closeout-evidence-import.csv");
  const previousCsv = await readFile(evidenceCsvPath, "utf8").catch(() => null);
  const weakNotesCsv = [
    "kind,account_id,platform,status,scope,app_identifier,public_base_url,redirect_uri,portal_url,docs_url,proof,notes",
    "account,meme-radar,youtube,verified,,,,,https://www.youtube.com/create_channel,,https://drive.google.com/file/d/meme-radar-youtube-proof/view,ok",
    "developer_app,,youtube,submitted,,youtube-prod-001,https://app.clipprreview.com,https://app.clipprreview.com/api/clippers/oauth/youtube/callback,https://console.cloud.google.com/apis/library/youtube.googleapis.com,,https://console.cloud.google.com/cloud-resource-manager?project=youtube-prod-001,approved",
    "permission,,tiktok,requested,video.publish,,,,https://developers.tiktok.com/,https://developers.tiktok.com/doc/content-posting-api-get-started/,https://developers.tiktok.com/apps/tiktok-prod-001/review,<paste notes here>",
    "permission,,youtube,requested,https://www.googleapis.com/auth/youtube.upload,,,,https://console.cloud.google.com/,https://developers.google.com/youtube/v3/guides/uploading_a_video,https://console.cloud.google.com/apis/credentials,too short",
  ].join("\n") + "\n";

  try {
    await writeFile(evidenceCsvPath, weakNotesCsv);
    const result = spawnSync(process.execPath, ["--import", "tsx", "script/clippers-import-external-closeout-evidence.ts"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, "blocked_invalid_evidence");
    assert.equal(output.accepted, 0);
    assert.equal(output.rejected, 4);
    assert.equal(output.applied, 0);

    const report = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-external-closeout-evidence-import-report.json"), "utf8"));
    assert.ok(report.rejected.some((row) => row.reason.includes("al menos 20 caracteres")));
    assert.ok(report.rejected.some((row) => row.reason.includes("ok/yes/done/approved")));
    assert.ok(report.rejected.some((row) => row.reason.includes("placeholder")));
  } finally {
    if (previousCsv === null) await unlink(evidenceCsvPath).catch(() => undefined);
    else await writeFile(evidenceCsvPath, previousCsv);
  }
});

test("external closeout evidence importer rejects fake accounts scopes and generic notes", async () => {
  const evidenceCsvPath = path.join(rootDir, "evidence-drop/external-closeout-evidence-import.csv");
  const proofTodoPath = path.join(rootDir, "reports/clippers-external-closeout-proof-todo.json");
  const previousCsv = await readFile(evidenceCsvPath, "utf8").catch(() => null);
  const previousProofTodo = await readFile(proofTodoPath, "utf8").catch(() => null);
  const fakeCsv = [
    "kind,account_id,platform,status,scope,app_identifier,public_base_url,redirect_uri,portal_url,docs_url,proof,notes",
    "account,fake-account,youtube,verified,,,,,https://www.youtube.com/create_channel,,https://drive.google.com/file/d/fake-account-proof/view,Fake account verified in official portal with non-secret proof reference",
    "permission,,tiktok,requested,fake.scope,,,,https://developers.tiktok.com/,https://developers.tiktok.com/doc/content-posting-api-get-started/,https://developers.tiktok.com/apps/tiktok-prod-001/review,Fictitious scope requested in official portal with non-secret proof reference",
    "developer_app,,youtube,submitted,,youtube-prod-001,https://app.clipprreview.com,https://app.clipprreview.com/api/clippers/oauth/youtube/callback,https://console.cloud.google.com/apis/library/youtube.googleapis.com,,https://console.cloud.google.com/cloud-resource-manager?project=youtube-prod-001,The proof is attached in external portal and stored externally",
  ].join("\n") + "\n";

  try {
    const proofTodo = JSON.parse(previousProofTodo || "{}");
    proofTodo.rows = [
      ...(Array.isArray(proofTodo.rows) ? proofTodo.rows : []),
      { lane: "account", accountId: "fake-account", platform: "youtube", requiredCsvStatus: "verified" },
      { lane: "permission", platform: "tiktok", scope: "fake.scope", requiredCsvStatus: "requested" },
    ];
    await writeFile(proofTodoPath, JSON.stringify(proofTodo, null, 2));
    await writeFile(evidenceCsvPath, fakeCsv);
    const result = spawnSync(process.execPath, ["--import", "tsx", "script/clippers-import-external-closeout-evidence.ts"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, "blocked_invalid_evidence");
    assert.equal(output.accepted, 0);
    assert.equal(output.rejected, 3);
    assert.equal(output.applied, 0);

    const report = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-external-closeout-evidence-import-report.json"), "utf8"));
    assert.ok(report.rejected.some((row) => row.reason.includes("cuentas inventadas")));
    assert.ok(report.rejected.some((row) => row.reason.includes("permiso inventado")));
    assert.ok(report.rejected.some((row) => row.reason.includes("accion externa concreta")));
  } finally {
    if (previousCsv === null) await unlink(evidenceCsvPath).catch(() => undefined);
    else await writeFile(evidenceCsvPath, previousCsv);
    if (previousProofTodo === null) await unlink(proofTodoPath).catch(() => undefined);
    else await writeFile(proofTodoPath, previousProofTodo);
  }
});

test("external closeout evidence importer mirrors strict developer app apply validation", async () => {
  const evidenceCsvPath = path.join(rootDir, "evidence-drop/external-closeout-evidence-import.csv");
  const previousCsv = await readFile(evidenceCsvPath, "utf8").catch(() => null);
  const unsafeCsv = [
    "kind,account_id,platform,status,scope,app_identifier,public_base_url,redirect_uri,portal_url,docs_url,proof,notes",
    "developer_app,,youtube,draft,,,https://app.clipprreview.com,https://app.clipprreview.com/api/clippers/oauth/youtube/callback,https://console.cloud.google.com/apis/library/youtube.googleapis.com,,https://console.cloud.google.com/cloud-resource-manager?project=youtube-prod-001,Draft app still needs the real project id before preview can be ready",
    "developer_app,,tiktok,submitted,,tiktok-prod-001,https://localhost:5010,https://localhost:5010/api/clippers/oauth/tiktok/callback,https://developers.tiktok.com/,,https://developers.tiktok.com/apps/tiktok-prod-001,Submitted app with localhost public base URL must not be ready",
  ].join("\n") + "\n";

  try {
    await writeFile(evidenceCsvPath, unsafeCsv);
    const result = spawnSync(process.execPath, ["--import", "tsx", "script/clippers-import-external-closeout-evidence.ts"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, "blocked_invalid_evidence");
    assert.equal(output.accepted, 0);
    assert.equal(output.rejected, 2);
    assert.equal(output.applied, 0);

    const report = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-external-closeout-evidence-import-report.json"), "utf8"));
    assert.ok(report.rejected.some((row) => row.reason.includes("Developer app closeout status debe ser submitted o approved")));
    assert.ok(report.rejected.some((row) => row.reason.includes("public_base_url HTTPS publico real")));
  } finally {
    if (previousCsv === null) await unlink(evidenceCsvPath).catch(() => undefined);
    else await writeFile(evidenceCsvPath, previousCsv);
  }
});

test("external closeout evidence importer redacts unsafe proof-todo redirect metadata from repair template", async () => {
  const evidenceCsvPath = path.join(rootDir, "evidence-drop/external-closeout-evidence-import.csv");
  const proofTodoPath = path.join(rootDir, "reports/clippers-external-closeout-proof-todo.json");
  const previousCsv = await readFile(evidenceCsvPath, "utf8").catch(() => null);
  const previousProofTodo = await readFile(proofTodoPath, "utf8").catch(() => null);
  const unsafeCsv = [
    "kind,account_id,platform,status,scope,app_identifier,public_base_url,redirect_uri,portal_url,docs_url,proof,notes",
    "developer_app,,tiktok,submitted,,tiktok-prod-001,https://localhost:5010,https://localhost:5010/api/clippers/oauth/tiktok/callback?token=unsafe,https://developers.tiktok.com/,,https://developers.tiktok.com/apps/tiktok-prod-001,Submitted app with localhost public base URL must not be ready",
  ].join("\n") + "\n";

  try {
    const proofTodo = JSON.parse(previousProofTodo || "{}");
    proofTodo.rows = (Array.isArray(proofTodo.rows) ? proofTodo.rows : []).map((row) => {
      if (row.id !== "developer_app:tiktok") return row;
      return {
        ...row,
        redirectUri: "https://localhost:5010/api/clippers/oauth/tiktok/callback?token=unsafe",
      };
    });
    await writeFile(proofTodoPath, JSON.stringify(proofTodo, null, 2));
    await writeFile(evidenceCsvPath, unsafeCsv);
    const result = spawnSync(process.execPath, ["--import", "tsx", "script/clippers-import-external-closeout-evidence.ts"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, "blocked_invalid_evidence");
    assert.equal(output.accepted, 0);
    assert.equal(output.rejected, 1);

    const report = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-external-closeout-evidence-import-report.json"), "utf8"));
    assert.match(report.repairSummary.nextRepairCsvRowTemplate, /developer_app/);
    assert.match(report.repairQueue[0].csvRowTemplate, /developer_app/);
    assert.match(report.repairSummary.nextRepairCsvRowTemplate, /<paste public https base url>/);
    assert.match(report.repairQueue[0].csvRowTemplate, /<paste public https base url>/);
    assert.doesNotMatch(report.repairSummary.nextRepairCsvRowTemplate, /https:\/\/localhost|token=unsafe/);
    assert.doesNotMatch(report.repairSummary.nextRepairPacket, /https:\/\/localhost|token=unsafe/);
    assert.doesNotMatch(report.repairQueue[0].csvRowTemplate, /https:\/\/localhost|token=unsafe/);
  } finally {
    if (previousCsv === null) await unlink(evidenceCsvPath).catch(() => undefined);
    else await writeFile(evidenceCsvPath, previousCsv);
    if (previousProofTodo === null) await unlink(proofTodoPath).catch(() => undefined);
    else await writeFile(proofTodoPath, previousProofTodo);
  }
});

test("external closeout evidence importer rejects unsafe remote proof URLs", async () => {
  const evidenceCsvPath = path.join(rootDir, "evidence-drop/external-closeout-evidence-import.csv");
  const previousCsv = await readFile(evidenceCsvPath, "utf8").catch(() => null);
  const unsafeCsv = [
    "kind,account_id,platform,status,scope,app_identifier,public_base_url,redirect_uri,portal_url,docs_url,proof,notes",
    "account,meme-radar,youtube,verified,,,,,https://www.youtube.com/create_channel,,http://localhost:5010/proof,Localhost proof should not count as external evidence",
    "permission,,tiktok,requested,video.publish,,,,https://developers.tiktok.com/,https://developers.tiktok.com/doc/content-posting-api-get-started/,https://proof.example.com/tiktok-video-publish,Example domain proof should not count as real evidence",
    "account,sports-daily,youtube,verified,,,,,https://www.youtube.com/create_channel,,https://localhost/proof,HTTPS localhost proof should not count as external evidence",
    "account,streamer-pulse,youtube,verified,,,,,https://www.youtube.com/create_channel,,https://127.0.0.1/proof,HTTPS loopback proof should not count as external evidence",
    "permission,,tiktok,requested,video.upload,,,,https://developers.tiktok.com/,https://developers.tiktok.com/doc/content-posting-api-get-started/,https://[::1]/proof,IPv6 loopback proof should not count as external evidence",
    "permission,,instagram,requested,instagram_content_publish,,,,https://developers.facebook.com/,https://developers.facebook.com/docs/instagram-platform/,https://test/proof,Bare test proof should not count as real evidence",
    "developer_app,,youtube,submitted,,youtube-prod-001,https://app.clipprreview.com,https://app.clipprreview.com/api/clippers/oauth/youtube/callback,https://console.cloud.google.com/apis/library/youtube.googleapis.com,,https://console.cloud.google.com/proof?token=unsafe,Proof URL query token should be rejected",
  ].join("\n") + "\n";

  try {
    await writeFile(evidenceCsvPath, unsafeCsv);
    const result = spawnSync(process.execPath, ["--import", "tsx", "script/clippers-import-external-closeout-evidence.ts"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, "blocked_invalid_evidence");
    assert.equal(output.accepted, 0);
    assert.equal(output.rejected, 7);

    const report = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-external-closeout-evidence-import-report.json"), "utf8"));
    assert.ok(report.rejected.some((row) => row.reason.includes("HTTPS")));
    assert.ok(report.rejected.some((row) => row.reason.includes("dominio publico real")));
    assert.ok(report.rejected.some((row) => row.reason.includes("secreto/token/password/cookie")));
    assert.equal(JSON.stringify(report).includes("token=unsafe"), false);
  } finally {
    if (previousCsv === null) await unlink(evidenceCsvPath).catch(() => undefined);
    else await writeFile(evidenceCsvPath, previousCsv);
  }
});

test("external closeout evidence importer validates local proof files without symlink escape", async () => {
  const evidenceCsvPath = path.join(rootDir, "evidence-drop/external-closeout-evidence-import.csv");
  const proofDir = path.join(rootDir, "evidence-drop", "test-proofs");
  const cleanProofPath = path.join(proofDir, "clean-proof.md");
  const shortProofPath = path.join(proofDir, "short-proof.md");
  const placeholderProofPath = path.join(proofDir, "stub-proof.md");
  const secretProofPath = path.join(proofDir, "secret-proof.md");
  const queryTokenProofPath = path.join(proofDir, "query-token-proof.md");
  const missingProofPath = path.join(proofDir, "missing-proof.md");
  const symlinkPath = path.join(proofDir, "escape-proof.md");
  const outsideProofPath = path.join("/private/tmp", "clippers-proof-escape.md");
  const previousCsv = await readFile(evidenceCsvPath, "utf8").catch(() => null);

  try {
    await mkdir(proofDir, { recursive: true });
    await writeFile(cleanProofPath, "Robert verified the channel ownership in the official portal on 2026-06-22. Case MC-456 confirms manager access and the approval record matches the external account.");
    await writeFile(shortProofPath, "too short");
    await writeFile(placeholderProofPath, "Status: needs_real_proof\nProof URL: <paste real proof URL or secure local evidence path>\nThis stub must not pass validation.");
    await writeFile(secretProofPath, "Robert verified the channel ownership in the official portal on 2026-06-22. access_token should never be stored here.");
    await writeFile(queryTokenProofPath, "Robert verified the portal action and stored the official ticket reference. The proof link https://platform.example.com/review?token=unsafe should be rejected because signed/tokenized proof URLs must not be stored.");
    await writeFile(outsideProofPath, "This outside workspace file is long enough to prove that symlink escapes must be rejected by realpath validation.");
    await symlink(outsideProofPath, symlinkPath).catch(() => undefined);

    const localCsv = [
      "kind,account_id,platform,status,scope,app_identifier,public_base_url,redirect_uri,portal_url,docs_url,proof,notes",
      `account,meme-radar,youtube,verified,,,,,https://www.youtube.com/create_channel,,${cleanProofPath},Clean local proof should preview as accepted`,
      `account,sports-daily,youtube,verified,,,,,https://www.youtube.com/create_channel,,${shortProofPath},Short local proof should be rejected`,
      `account,streamer-pulse,youtube,verified,,,,,https://www.youtube.com/create_channel,,${placeholderProofPath},Stub local proof should be rejected by proof content validation`,
      `permission,,tiktok,requested,video.publish,,,,https://developers.tiktok.com/,https://developers.tiktok.com/doc/content-posting-api-get-started/,${secretProofPath},Secret local proof should be rejected`,
      `permission,,instagram,requested,instagram_basic,,,,https://developers.facebook.com/,https://developers.facebook.com/docs/instagram-platform/,${queryTokenProofPath},Query-token local proof should be rejected`,
      `permission,,tiktok,requested,video.upload,,,,https://developers.tiktok.com/,https://developers.tiktok.com/doc/content-posting-api-get-started/,${missingProofPath},Missing local proof should be rejected`,
      `developer_app,,youtube,submitted,,youtube-prod-001,https://app.clipprreview.com,https://app.clipprreview.com/api/clippers/oauth/youtube/callback,https://console.cloud.google.com/apis/library/youtube.googleapis.com,,${symlinkPath},Symlink escape should be rejected`,
    ].join("\n") + "\n";

    await writeFile(evidenceCsvPath, localCsv);
    const result = spawnSync(process.execPath, ["--import", "tsx", "script/clippers-import-external-closeout-evidence.ts"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, "partial_ready_to_apply");
    assert.equal(output.accepted, 1);
    assert.equal(output.rejected, 6);

    const report = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-external-closeout-evidence-import-report.json"), "utf8"));
    assert.ok(report.rejected.some((row) => row.reason.includes("demasiado corto")));
    assert.ok(report.rejected.some((row) => row.reason.includes("placeholders")));
    assert.ok(report.rejected.some((row) => row.reason.includes("secreto/token/password/cookie")));
    assert.ok(report.rejected.some((row) => row.reason.includes("no existe")));
    assert.ok(report.rejected.some((row) => row.reason.includes("fuera de clippers_workspace")));
  } finally {
    if (previousCsv === null) await unlink(evidenceCsvPath).catch(() => undefined);
    else await writeFile(evidenceCsvPath, previousCsv);
    await unlink(cleanProofPath).catch(() => undefined);
    await unlink(shortProofPath).catch(() => undefined);
    await unlink(placeholderProofPath).catch(() => undefined);
    await unlink(secretProofPath).catch(() => undefined);
    await unlink(queryTokenProofPath).catch(() => undefined);
    await unlink(missingProofPath).catch(() => undefined);
    await unlink(symlinkPath).catch(() => undefined);
    await unlink(outsideProofPath).catch(() => undefined);
  }
});

test("rights registration rejects unsafe Metricool queue state", async () => {
  const originalQueue = await readFile(queuePath, "utf8");
  try {
    const queue = JSON.parse(originalQueue);
    queue.status = "approval_required";
    queue.publishMode = "auto_after_connection";
    queue.realPublishEnabled = false;
    queue.totals = { ...(queue.totals || {}), readyToSend: 1 };
    queue.items = [{ id: "unsafe-test-item", status: "ready_to_send", canSendNow: true }];
    await writeFile(queuePath, JSON.stringify(queue, null, 2));

    const result = spawnSync(process.execPath, ["script/clippers-record-owned-source-rights.mjs", "--dry-run"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stderr}\n${result.stdout}`, /publishMode is not explicitly approval_required|readyToSend items|can send now/);
  } finally {
    await writeFile(queuePath, originalQueue);
  }
});

test("account permission readiness rejects unsafe Metricool queue state", async () => {
  const originalQueue = await readFile(queuePath, "utf8");
  const accountPath = path.join(rootDir, "account-permission-readiness.json");
  const originalAccount = await readFile(accountPath, "utf8").catch(() => null);
  try {
    const queue = JSON.parse(originalQueue);
    queue.status = "approval_required";
    queue.publishMode = "auto_after_connection";
    queue.realPublishEnabled = false;
    queue.totals = { ...(queue.totals || {}), queuedForApproval: 14, readyToSend: 1 };
    queue.items = [{ id: "unsafe-test-item", status: "ready_to_send", canSendNow: true }];
    await writeFile(queuePath, JSON.stringify(queue, null, 2));

    const result = spawnSync(process.execPath, ["script/clippers-account-permission-readiness.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, "blocked");
    assert.equal(output.metricoolReadyLanes, 0);

    const readiness = JSON.parse(await readFile(accountPath, "utf8"));
    assert.equal(readiness.sourceReadiness.guardSafe, false);
    assert.ok(readiness.sourceReadiness.blockers.some((blocker) => blocker.includes("publishMode") || blocker.includes("readyToSend") || blocker.includes("can send now")));
  } finally {
    await writeFile(queuePath, originalQueue);
    if (originalAccount !== null) await writeFile(accountPath, originalAccount);
  }
});

test("operational readiness blocks unsafe Metricool auto-publish state", async () => {
  const reportPath = path.join(rootDir, "reports/clippers-operational-readiness.json");
  const originalQueue = await readFile(queuePath, "utf8");
  const originalReport = await readFile(reportPath, "utf8").catch(() => null);
  try {
    const queue = JSON.parse(originalQueue);
    queue.status = "approval_required";
    queue.publishMode = "auto_after_connection";
    queue.realPublishEnabled = true;
    queue.totals = { ...(queue.totals || {}), queuedForApproval: 14, readyToSend: 1 };
    queue.items = [{ id: "unsafe-operational-item", status: "ready_to_send", canSendNow: true }];
    await writeFile(queuePath, JSON.stringify(queue, null, 2));

    const result = spawnSync(process.execPath, ["script/clippers-operational-readiness.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, "blocked");
    assert.equal(output.metricoolMvpReady, false);
    assert.ok(output.metricoolMvpBlockers > 0);

    const report = JSON.parse(await readFile(reportPath, "utf8"));
    assert.equal(report.mvp.metricoolReady, false);
    assert.ok(report.metricoolMvpBlockers.some((blocker) => blocker.includes("realPublishEnabled") || blocker.includes("publishMode") || blocker.includes("readyToSend") || blocker.includes("can send now")));
  } finally {
    await writeFile(queuePath, originalQueue);
    if (originalReport !== null) await writeFile(reportPath, originalReport);
  }
});

test("operational readiness rejects stale account readiness when source readiness is blocked", async () => {
  const accountPath = path.join(rootDir, "account-permission-readiness.json");
  const reportPath = path.join(rootDir, "reports/clippers-operational-readiness.json");
  const originalAccount = await readFile(accountPath, "utf8");
  const originalQueue = await readFile(queuePath, "utf8");
  const originalReport = await readFile(reportPath, "utf8").catch(() => null);
  try {
    const queue = JSON.parse(originalQueue);
    queue.sourceReadiness = {
      ...(queue.sourceReadiness || {}),
      status: "blocked",
      totals: { ...(queue.sourceReadiness?.totals || {}), rightsReadyAssets: 0 },
      categories: [],
    };
    queue.totals = { ...(queue.totals || {}), queuedForApproval: 14, readyToSend: 0 };
    queue.status = "approval_required";
    queue.publishMode = "approval_required";
    queue.realPublishEnabled = false;
    await writeFile(queuePath, JSON.stringify(queue, null, 2));

    const result = spawnSync(process.execPath, ["script/clippers-operational-readiness.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.metricoolMvpReady, false);
    assert.equal(output.fullDirectApiReady, false);

    const report = JSON.parse(await readFile(reportPath, "utf8"));
    assert.equal(report.sources.sourceReadinessReady, false);
    assert.ok(report.blockers.some((blocker) => blocker.includes("source readiness")));
  } finally {
    await writeFile(accountPath, originalAccount);
    await writeFile(queuePath, originalQueue);
    if (originalReport !== null) await writeFile(reportPath, originalReport);
  }
});

test("operational readiness refreshes stale account permission readiness before reporting", async () => {
  const accountPath = path.join(rootDir, "account-permission-readiness.json");
  const reportPath = path.join(rootDir, "reports/clippers-operational-readiness.json");
  const originalAccount = await readFile(accountPath, "utf8");
  const originalReport = await readFile(reportPath, "utf8").catch(() => null);
  try {
    await writeFile(accountPath, JSON.stringify({
      status: "metricool_mvp_ready",
      totals: {
        accountProfiles: 9,
        verifiedAccounts: 9,
        metricoolReadyLanes: 9,
        directApiReadyLanes: 9,
        developerApps: 3,
        developerAppsApproved: 3,
        permissionGroups: 3,
        permissionGroupsApproved: 3,
      },
      sourceReadiness: {
        localOwnedSourceAssets: 999,
        connectedMetricoolRightsReadyAssets: 999,
        realPublishEnabled: false,
        publishMode: "approval_required",
      },
    }, null, 2));

    const result = spawnSync(process.execPath, ["script/clippers-operational-readiness.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    assert.equal(report.accounts.directApiReadyLanes, 0);
    assert.equal(report.fullDirectApiReady, false);
    assert.notEqual(report.accounts.verified, 9);
  } finally {
    await writeFile(accountPath, originalAccount);
    if (originalReport !== null) await writeFile(reportPath, originalReport);
  }
});

test("Clippers UI refreshes account permission readiness after evidence activation refresh", async () => {
  const page = await readFile(path.join(process.cwd(), "client/src/pages/clippers.tsx"), "utf8");
  assert.ok(page.includes("interface ClipperOperationalReadinessSummary"));
  assert.ok(page.includes("interface ClipperExternalCloseoutPackSummary"));
  assert.ok(page.includes("interface ClipperExternalCloseoutProofTodoSummary"));
  assert.ok(page.includes("interface ClipperExternalCloseoutOperatorQueueSummary"));
  assert.ok(page.includes("interface ClipperExternalCloseoutNextActionSummary"));
  assert.ok(page.includes("interface ClipperExternalCloseoutArtifactSafety"));
  assert.ok(page.includes('queryKey: ["/api/clippers/operational-readiness"]'));
  assert.ok(page.includes('queryKey: ["/api/clippers/external-closeout-pack"]'));
  assert.ok(page.includes('queryKey: ["/api/clippers/external-closeout-proof-todo"]'));
  assert.ok(page.includes('queryKey: ["/api/clippers/external-closeout-operator-queue"]'));
  assert.ok(page.includes('queryKey: ["/api/clippers/external-closeout-next-action"]'));
  assert.ok(page.includes('fetch("/api/clippers/prepare-operational-readiness", { method: "POST" })'));
  assert.ok(page.includes('fetch("/api/clippers/prepare-external-closeout-pack", { method: "POST" })'));
  assert.ok(page.includes('data-testid="clippers-operational-readiness"'));
  assert.ok(page.includes('data-testid="clippers-external-closeout-pack"'));
  assert.ok(page.includes('data-testid="clippers-external-closeout-proof-todo"'));
  assert.ok(page.includes('data-testid="clippers-external-closeout-operator-queue"'));
  assert.ok(page.includes('data-testid="clippers-external-closeout-next-action"'));
  assert.ok(page.includes('data-testid="clippers-external-work-run"'));
  assert.ok(page.includes('data-testid="clippers-external-work-run-steps"'));
  assert.ok(page.includes('data-testid="clippers-external-work-run-portal-sessions"'));
  assert.ok(page.includes('data-testid="copy-clippers-external-work-run-button"'));
  assert.ok(page.includes('data-testid="clippers-external-closeout-repair-summary"'));
  assert.ok(page.includes('data-testid="copy-clippers-external-next-repair-button"'));
  assert.ok(page.includes('data-testid="copy-clippers-external-next-repair-csv-button"'));
  assert.ok(page.includes('data-testid="copy-clippers-external-repair-row-csv-button"'));
  assert.ok(page.includes('data-testid="clippers-full-readiness-gap"'));
  assert.ok(page.includes('data-testid="clippers-next-evidence-drop"'));
  assert.ok(page.includes('data-testid="clippers-next-evidence-cards"'));
  assert.ok(page.includes('data-testid="prepare-clippers-external-closeout-pack-button"'));
  assert.ok(page.includes("fullReadinessGap"));
  assert.ok(page.includes("previewCards"));
  assert.ok(page.includes("copyText"));
  assert.ok(page.includes("nextEvidenceDrop"));
  assert.ok(page.includes("nextRepairCsvRowTemplate"));
  assert.ok(page.includes("csvRowTemplate"));
  assert.ok(page.includes("repairTemplatesCsv"));
  assert.ok(page.includes("repairWorkPacketMarkdown"));
  assert.ok(page.includes("Repair templates CSV"));
  assert.ok(page.includes("Repair work packet"));
  assert.ok(page.includes("/api/clippers/external-closeout-repair-work-packet"));
  assert.ok(page.includes("Operational Readiness"));
  assert.ok(page.includes("External Closeout Pack"));
  assert.ok(page.includes("Copy run"));
  assert.ok(page.includes("more external actions in"));
  assert.ok(page.includes("External closeout"));
  assert.ok(page.includes("Evidence CSV rows"));
  assert.ok(page.includes("Strict import CSV"));
  assert.ok(page.includes("Uses external evidence import schema"));
  assert.ok(page.includes("status.robertNextActions.externalCloseout.proofFilesNeedRealEvidence"));
  assert.ok(page.includes("status.robertNextActions.externalCloseout.operatorQueueItems"));
  assert.ok(page.includes("Direct APIs"));
  assert.ok(page.includes("Direct API backlog"));
  assert.ok(page.includes("Metricool MVP launch mode"));
  assert.ok(page.includes("Ready queue"));
  assert.ok(page.includes('data-testid="clippers-external-portal-closeout-board"'));
  assert.ok(page.includes("more Metricool MVP blockers in"));
  const accountRowsBlock = sliceRequired(
    page,
    "accountPermissionReadiness.accountRows.map((row) =>",
    "Permission gates",
  );
  assert.ok(accountRowsBlock.includes("row.blockers.slice(0, 3)"));
  assert.ok(accountRowsBlock.includes("more account blockers in"));

  const readinessHelperBlock = sliceRequired(
    page,
    "const refreshAccountPermissionReadinessCache = async () =>",
    "const refreshPostConnectActivationState = async",
  );
  assert.ok(readinessHelperBlock.includes('queryClient.setQueryData(["/api/clippers/account-permission-readiness"], readinessData.accountPermissionReadiness)'));

  const activationRefreshBlock = sliceRequired(
    page,
    "const refreshPostConnectActivationState = async",
    "const refreshSourceRunwayState = async",
  );
  assert.ok(activationRefreshBlock.includes("await refreshAccountPermissionReadinessCache()"));
  assert.ok(activationRefreshBlock.includes('queryClient.setQueryData(["/api/clippers/account-permission-readiness"], null)'));
  assert.ok(activationRefreshBlock.includes("Readiness pendiente"));

  const credentialRefreshBlock = sliceRequired(
    page,
    "const refreshCredentialOauthRunwayState = async",
    "const runMutation = useMutation",
  );
  assert.ok(credentialRefreshBlock.includes("await refreshAccountPermissionReadinessCache()"));
  assert.ok(credentialRefreshBlock.includes('queryClient.setQueryData(["/api/clippers/account-permission-readiness"], null)'));
  assert.ok(credentialRefreshBlock.includes("Readiness pendiente"));

  const postConnectMutationBlock = sliceRequired(
    page,
    "const postConnectActivationSweepMutation = useMutation",
    "const intakeRefreshSweepMutation = useMutation",
  );
  assert.ok(postConnectMutationBlock.includes("void refreshAccountPermissionReadinessCache().catch"));
  assert.ok(postConnectMutationBlock.includes('queryClient.setQueryData(["/api/clippers/account-permission-readiness"], null)'));

  const routes = await readFile(path.join(process.cwd(), "server/routes.ts"), "utf8");
  assert.ok(routes.includes('runClipperJsonScript("script/clippers-operational-readiness.mjs", "Operational readiness")'));
  assert.ok(routes.includes("runClipperExternalCloseoutPack"));
  assert.ok(routes.includes('app.get("/api/clippers/operational-readiness"'));
  assert.ok(routes.includes('app.post("/api/clippers/prepare-operational-readiness"'));
  assert.ok(routes.includes('app.get("/api/clippers/external-closeout-pack"'));
  assert.ok(routes.includes('app.post("/api/clippers/prepare-external-closeout-pack"'));
  assert.ok(routes.includes('app.get("/api/clippers/external-closeout-proof-todo"'));
  assert.ok(routes.includes('app.get("/api/clippers/external-closeout-operator-queue"'));
  assert.ok(routes.includes('app.get("/api/clippers/external-closeout-next-action"'));
  assert.ok(routes.includes('app.get("/api/clippers/external-closeout-repair-work-packet"'));
  assert.ok(routes.includes("CLIPPER_ROUTE_SCRIPT_TIMEOUT_MS"));
  assert.ok(routes.includes('child.kill("SIGKILL")'));
  assert.ok(routes.includes("detached: true"));
  assert.ok(routes.includes("process.kill(-child.pid"));
  const operationalReadinessScript = await readFile(path.join(process.cwd(), "script/clippers-operational-readiness.mjs"), "utf8");
  assert.ok(operationalReadinessScript.includes("jsonScriptTimeoutMs"));
  assert.ok(operationalReadinessScript.includes("nestedJsonScriptTimeoutMs = 60_000"));
  assert.ok(operationalReadinessScript.includes('child.kill("SIGKILL")'));
  assert.ok(operationalReadinessScript.includes("detached: true"));
  assert.ok(operationalReadinessScript.includes("process.kill(-child.pid"));
  const externalCloseoutScript = await readFile(path.join(process.cwd(), "script/clippers-external-closeout-pack.mjs"), "utf8");
  assert.ok(externalCloseoutScript.includes("jsonScriptTimeoutMs"));
  assert.ok(externalCloseoutScript.includes("nestedJsonScriptTimeoutMs = 90_000"));
  assert.ok(externalCloseoutScript.includes('child.kill("SIGKILL")'));
  assert.ok(externalCloseoutScript.includes("detached: true"));
  assert.ok(externalCloseoutScript.includes("process.kill(-child.pid"));
  const activationRouteBlock = sliceRequired(
    routes,
    'app.post("/api/clippers/run-post-connect-activation-sweep"',
    'app.post("/api/clippers/run-intake-refresh-sweep"',
  );
  assert.ok(activationRouteBlock.includes("status: result.status"));
});

test("owned source generator commands have timeout and process group cleanup", async () => {
  const generatorScripts = [
    "script/clippers-generate-owned-gap-sources.mjs",
    "script/clippers-generate-owned-meme-sources.ts",
    "script/clippers-generate-owned-sports-streamer-sources.ts",
    "script/clippers-generate-owned-weekly-backlog-sources.ts",
  ];

  for (const scriptPath of generatorScripts) {
    const source = await readFile(path.join(process.cwd(), scriptPath), "utf8");
    assert.ok(source.includes("commandTimeoutMs"), `${scriptPath} should define a command timeout`);
    assert.ok(source.includes("detached: true"), `${scriptPath} should run child processes in a process group`);
    assert.ok(source.includes("process.kill(-child.pid"), `${scriptPath} should kill the process group on timeout`);
    assert.ok(source.includes('child.kill("SIGKILL")'), `${scriptPath} should fall back to direct child kill`);
    assert.ok(source.includes("timed out after"), `${scriptPath} should report timeout failures`);
  }
});
