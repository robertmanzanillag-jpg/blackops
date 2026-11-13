import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const rootDir = path.join(process.cwd(), "clippers_workspace");
const accountEvidenceDir = path.join(rootDir, "account-evidence");
const outJsonPath = path.join(rootDir, "account-permission-readiness.json");
const outMarkdownPath = path.join(rootDir, "account-permission-readiness.md");
const outCsvPath = path.join(rootDir, "account-permission-readiness.csv");
const evidenceDropPath = path.join(rootDir, "account-permission-next-evidence.csv");
const externalCloseoutProofTodoPath = path.join(rootDir, "reports", "clippers-external-closeout-proof-todo.json");

const accounts = [
  { accountId: "sports-daily", accountName: "Sports Daily Clips", category: "sports", handle: "@sportsdaily" },
  { accountId: "meme-radar", accountName: "Meme Radar", category: "memes", handle: "@memeradar" },
  { accountId: "streamer-pulse", accountName: "Streamer Pulse", category: "streamers", handle: "@streamerpulse" },
];

const platforms = [
  {
    platform: "tiktok",
    label: "TikTok",
    accountUrl: "https://www.tiktok.com/signup",
    developerPortalUrl: "https://developers.tiktok.com/",
    requiredScopes: ["video.publish", "video.upload"],
    directApiDocsUrl: "https://developers.tiktok.com/doc/content-posting-api-get-started/",
    uploadDocsUrl: "https://developers.tiktok.com/doc/content-posting-api-get-started-upload-content",
    officialResearch: [
      "Direct post requires a registered TikTok developer app, Content Posting API product, approved video.publish scope and target-user authorization.",
      "Draft upload requires approved video.upload scope and target-user authorization.",
      "Unaudited TikTok clients can be restricted to private visibility until platform audit is completed.",
    ],
  },
  {
    platform: "instagram",
    label: "Instagram Reels",
    accountUrl: "https://www.instagram.com/accounts/emailsignup/",
    developerPortalUrl: "https://developers.facebook.com/",
    requiredScopes: ["instagram_basic", "instagram_content_publish", "pages_show_list"],
    directApiDocsUrl: "https://developers.facebook.com/docs/instagram-platform/content-publishing/",
    uploadDocsUrl: null,
    officialResearch: [
      "Use Meta developer/app review flow for Instagram publishing scopes.",
      "Account must be eligible for Instagram publishing and connected through the required Meta/Instagram setup before direct API posting.",
      "Verify the exact current App Review prompts inside Meta Developers before marking any Instagram permission approved.",
    ],
  },
  {
    platform: "youtube",
    label: "YouTube Shorts",
    accountUrl: "https://www.youtube.com/create_channel",
    developerPortalUrl: "https://console.cloud.google.com/apis/library/youtube.googleapis.com",
    requiredScopes: ["https://www.googleapis.com/auth/youtube.upload"],
    directApiDocsUrl: "https://developers.google.com/youtube/v3/docs/videos/insert",
    uploadDocsUrl: null,
    officialResearch: [
      "videos.insert uploads media and requires OAuth authorization such as youtube.upload.",
      "Google states uploads from unverified API projects created after 2020-07-28 can be restricted to private until audit.",
      "Each target channel must authorize the OAuth client before uploads are allowed.",
    ],
  },
];

async function readJson(filePath, fallback = null) {
  const raw = await readFile(filePath, "utf8").catch(() => null);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function evidencePathFor(accountId, platform) {
  return path.join(accountEvidenceDir, `${accountId}-${platform}.json`);
}

function permissionStatusFor(permissionTracker, platform, scopes) {
  const items = Array.isArray(permissionTracker?.items) ? permissionTracker.items : [];
  const relevant = scopes.map((scope) => items.find((item) => item.platform === platform && item.scope === scope) || {
    platform,
    scope,
    status: "missing",
    blockers: [`No permission tracker item found for ${platform} ${scope}.`],
  });
  const approved = relevant.filter((item) => item.status === "approved").length;
  const requested = relevant.filter((item) => item.status === "requested" || item.status === "submitted").length;
  const blocked = relevant.length - approved - requested;
  return {
    status: approved === relevant.length ? "approved" : requested > 0 ? "requested" : "blocked",
    approved,
    requested,
    blocked,
    items: relevant.map((item) => ({
      scope: item.scope,
      status: item.status || "missing",
      nextStep: item.nextStep || (Array.isArray(item.blockers) ? item.blockers[0] : null) || "Submit real portal evidence.",
      docsUrl: item.docsUrl || null,
      developerPortalUrl: item.developerPortalUrl || null,
    })),
  };
}

function developerAppStatusFor(developerKit, platform) {
  const items = Array.isArray(developerKit?.connectionKitItems) ? developerKit.connectionKitItems : [];
  const item = items.find((candidate) => candidate.platform === platform);
  if (!item) {
    return {
      status: "missing",
      missingEnvVars: [],
      appIdentifier: null,
      redirectUri: null,
      nextStep: `Create ${platform} developer app and import evidence.`,
    };
  }
  return {
    status: item.status || "missing",
    missingEnvVars: item.missingEnvVars || [],
    appIdentifier: item.appIdentifier || null,
    redirectUri: item.redirectUri || null,
    nextStep: item.nextStep || `Import ${platform} developer app evidence.`,
  };
}

function metricoolConnectionFor(queue, account, platform) {
  const categories = Array.isArray(queue?.sourceReadiness?.categories) ? queue.sourceReadiness.categories : [];
  const row = categories.find((category) => category.category === account.category || category.accountId === account.accountId);
  const connectedNetworks = Array.isArray(row?.connectedNetworks) ? row.connectedNetworks : [];
  return {
    connected: connectedNetworks.includes(platform),
    connectedNetworks,
    rightsReadyAssets: row?.rightsReadyAssets || 0,
    localOwnedSourceTotals: queue?.sourceReadiness?.localOwnedSourceTotals || {},
  };
}

function metricoolQueueGuard(queue) {
  const items = Array.isArray(queue?.items) ? queue.items : [];
  const unsafeItem = items.find((item) => item?.canSendNow === true || item?.status === "ready_to_send");
  const connectedCategories = Array.isArray(queue?.sourceReadiness?.categories) ? queue.sourceReadiness.categories : [];
  return {
    safe: queue?.realPublishEnabled === false
      && queue?.publishMode === "approval_required"
      && queue?.status === "approval_required"
      && (queue?.totals?.readyToSend || 0) === 0
      && !unsafeItem
      && queue?.sourceReadiness?.status === "ready"
      && (queue?.sourceReadiness?.totals?.rightsReadyAssets || 0) > 0
      && connectedCategories.length > 0,
    blockers: [
      queue?.realPublishEnabled !== false ? "Metricool realPublishEnabled is not false" : null,
      queue?.publishMode !== "approval_required" ? "Metricool publishMode is not approval_required" : null,
      queue?.status !== "approval_required" ? "Metricool status is not approval_required" : null,
      (queue?.totals?.readyToSend || 0) !== 0 ? "Metricool queue has readyToSend items" : null,
      unsafeItem ? "Metricool queue contains item(s) that can send now" : null,
      queue?.sourceReadiness?.status !== "ready" ? "Metricool source readiness is not ready" : null,
      (queue?.sourceReadiness?.totals?.rightsReadyAssets || 0) <= 0 ? "Metricool source readiness has no rights-ready assets" : null,
      connectedCategories.length === 0 ? "Metricool source readiness has no connected lanes" : null,
    ].filter(Boolean),
  };
}

function progressRow(id, label, ready, total, nextStep) {
  const normalizedTotal = Math.max(0, Number(total) || 0);
  const normalizedReady = Math.max(0, Math.min(Number(ready) || 0, normalizedTotal));
  const missing = Math.max(0, normalizedTotal - normalizedReady);
  return {
    id,
    label,
    ready: normalizedReady,
    total: normalizedTotal,
    missing,
    percent: normalizedTotal > 0 ? Math.round((normalizedReady / normalizedTotal) * 100) : 100,
    status: missing === 0 ? "ready" : normalizedReady > 0 ? "partial" : "blocked",
    nextStep,
  };
}

const externalEvidenceHeader = "kind,account_id,platform,status,scope,app_identifier,public_base_url,redirect_uri,portal_url,docs_url,proof,notes";

function publicBaseUrlFromRedirect(redirectUri) {
  if (!redirectUri) return "";
  try {
    const url = new URL(redirectUri);
    return `${url.protocol}//${url.host}`;
  } catch {
    return "";
  }
}

function closeoutRowsForEvidenceDrop(externalCloseout) {
  const rows = Array.isArray(externalCloseout?.operatorQueue) && externalCloseout.operatorQueue.length
    ? externalCloseout.operatorQueue
    : Array.isArray(externalCloseout?.rows)
      ? externalCloseout.rows
      : [];
  return rows.map((row) => [
    row.lane || "",
    row.accountId || "",
    row.platform || "",
    row.requiredCsvStatus || "",
    row.scope || "",
    "",
    publicBaseUrlFromRedirect(row.redirectUri),
    row.redirectUri || "",
    row.portalUrl || "",
    row.docsUrl || "",
    row.proofPath || "",
    [
      row.safeNotes || "Do not store passwords, recovery codes, cookies, tokens, or private screenshots in this repo.",
      row.csvEditHint || row.operatorAction || row.nextStep || "Replace proof stub with real non-secret evidence before applying.",
    ].filter(Boolean).join(" "),
  ].map(csvCell).join(","));
}

function closeoutCardsForEvidenceDrop(externalCloseout) {
  const rows = Array.isArray(externalCloseout?.operatorQueue) && externalCloseout.operatorQueue.length
    ? externalCloseout.operatorQueue
    : Array.isArray(externalCloseout?.rows)
      ? externalCloseout.rows
      : [];
  return rows.map((row, index) => {
    const card = {
      id: row.id || `${row.lane || "evidence"}-${row.platform || "all"}-${index + 1}`,
      index: index + 1,
      kind: row.lane || "",
      accountId: row.accountId || "",
      platform: row.platform || "",
      status: row.requiredCsvStatus || "",
      scope: row.scope || "",
      publicBaseUrl: publicBaseUrlFromRedirect(row.redirectUri),
      redirectUri: row.redirectUri || "",
      portalUrl: row.portalUrl || "",
      docsUrl: row.docsUrl || "",
      proofPath: row.proofPath || "",
      missingFields: row.missingCsvFields || [],
      nextStep: row.csvEditHint || row.operatorAction || row.nextStep || "Add real non-secret evidence before importing.",
    };
    return {
      ...card,
      copyText: [
        `Evidence task: ${card.id}`,
        `Kind: ${card.kind || "evidence"}`,
        `Platform: ${card.platform || "all"}`,
        card.accountId ? `Account: ${card.accountId}` : null,
        card.scope ? `Scope: ${card.scope}` : null,
        `Target status: ${card.status || "pending"}`,
        card.portalUrl ? `Portal: ${card.portalUrl}` : null,
        card.docsUrl ? `Docs: ${card.docsUrl}` : null,
        card.redirectUri ? `Redirect URI: ${card.redirectUri}` : null,
        `Proof file: ${card.proofPath || "missing"}`,
        card.missingFields.length ? `Missing fields: ${card.missingFields.join(", ")}` : null,
        `Next step: ${card.nextStep}`,
      ].filter(Boolean).join("\n"),
    };
  });
}

function nextEvidenceRows(accountRows, permissionRows, developerRows, externalCloseout = {}) {
  const externalRows = closeoutRowsForEvidenceDrop(externalCloseout);
  if (externalRows.length > 0) {
    return `${[externalEvidenceHeader, ...externalRows].join("\n")}\n`;
  }
  const rows = [externalEvidenceHeader];
  for (const row of accountRows.filter((item) => item.accountStatus !== "verified")) {
    rows.push([
      "account",
      row.accountId,
      row.platform,
      "verified",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      `<real ${row.handle} profile URL + verification proof + 2FA/recovery proof + screenshot/proof URL>`,
    ].map(csvCell).join(","));
  }
  for (const row of developerRows.filter((item) => item.status !== "approved")) {
    rows.push([
      "developer_app",
      "",
      row.platform,
      "submitted",
      "",
      `<${row.platform} app id/client key/project id>`,
      publicBaseUrlFromRedirect(row.redirectUri) || "<public https app URL>",
      row.redirectUri || "",
      platforms.find((platform) => platform.platform === row.platform)?.developerPortalUrl || "",
      platforms.find((platform) => platform.platform === row.platform)?.directApiDocsUrl || "",
      "",
      "Developer app submitted for review; include portal screenshot/ticket URL without secrets.",
    ].map(csvCell).join(","));
  }
  for (const row of permissionRows.filter((item) => item.status !== "approved")) {
    for (const scope of row.scopes) {
      rows.push([
        "permission",
        "",
        row.platform,
        "requested",
        scope,
        "",
        "",
        "",
        row.developerPortalUrl,
        row.docsUrl,
        "",
        "<permission request/review URL, approval screenshot, ticket, email, or portal note>",
      ].map(csvCell).join(","));
    }
  }
  return `${rows.join("\n")}\n`;
}

function renderMarkdown(summary) {
  const accountLines = summary.accountRows.map((row) => [
    `### ${row.accountName} / ${row.platform}`,
    "",
    `- Account status: ${row.accountStatus}`,
    `- Metricool connected: ${row.metricoolConnected ? "yes" : "no"}`,
    `- Connected rights-ready assets for category: ${row.metricoolRightsReadyAssets}`,
    `- Ready for Metricool approval queue: ${row.readyForMetricoolApproval ? "yes" : "no"}`,
    `- Direct API ready: ${row.directApiReady ? "yes" : "no"}`,
    `- Direct API backlog: ${row.directApiBacklog.length ? row.directApiBacklog.join("; ") : "none"}`,
    `- Evidence path: ${row.evidencePath}`,
    `- Next step: ${row.nextStep}`,
    "",
  ].join("\n"));
  const permissionLines = summary.permissionRows.map((row) => [
    `### ${row.label}`,
    "",
    `- Status: ${row.status}`,
    `- Approved/requested/blocked scopes: ${row.approved}/${row.requested}/${row.blocked}`,
    `- Required scopes: ${row.scopes.join(", ")}`,
    `- Developer portal: ${row.developerPortalUrl}`,
    `- Docs: ${row.docsUrl}`,
    `- Next step: ${row.nextStep}`,
    "",
  ].join("\n"));
  const gapLines = summary.fullReadinessGap.rows.map((row) => [
    `### ${row.label}`,
    "",
    `- Status: ${row.status}`,
    `- Ready/missing/total: ${row.ready}/${row.missing}/${row.total}`,
    `- Percent: ${row.percent}%`,
    `- Next step: ${row.nextStep}`,
    "",
  ].join("\n"));
  return [
    "# Clippers Account + Permission Readiness",
    "",
    `Generated: ${summary.generatedAt}`,
    `Status: ${summary.status}`,
    "",
    "This pack does not create external accounts, store secrets or claim platform approval. It tells the operator exactly what is ready and what proof is still missing.",
    "",
    "## Totals",
    "",
    `- Launch mode: ${summary.launchMode}`,
    `- Direct social APIs required for MVP: ${summary.directSocialApisRequired ? "yes" : "no"}`,
    `- Account/platform profiles verified: ${summary.totals.verifiedAccounts}/${summary.totals.accountProfiles}`,
    `- Metricool-connected approval lanes ready: ${summary.totals.metricoolReadyLanes}`,
    `- Direct API-ready lanes: ${summary.totals.directApiReadyLanes}`,
    `- Developer apps approved: ${summary.totals.developerAppsApproved}/${summary.totals.developerApps}`,
    `- Permission groups approved: ${summary.totals.permissionGroupsApproved}/${summary.totals.permissionGroups}`,
    `- External proof files needing real evidence: ${summary.externalCloseout.proofFilesNeedRealEvidence}`,
    `- External evidence repair rows: ${summary.externalCloseout.evidenceRepairRows}`,
    `- Local owned source assets: ${summary.sourceReadiness.localOwnedSourceAssets}`,
    `- Connected Metricool rights-ready assets: ${summary.sourceReadiness.connectedMetricoolRightsReadyAssets}`,
    "",
    "## Full Readiness Gap",
    "",
    `- Status: ${summary.fullReadinessGap.status}`,
    `- Ready/missing/total: ${summary.fullReadinessGap.ready}/${summary.fullReadinessGap.missing}/${summary.fullReadinessGap.total}`,
    `- Percent: ${summary.fullReadinessGap.percent}%`,
    `- Next step: ${summary.fullReadinessGap.nextStep}`,
    "",
    ...gapLines,
    "## Accounts",
    "",
    ...accountLines,
    "## Permissions",
    "",
    ...permissionLines,
    "## External Closeout",
    "",
    `- Status: ${summary.externalCloseout.status}`,
    `- Proof files needing real evidence: ${summary.externalCloseout.proofFilesNeedRealEvidence}`,
    `- Evidence repair rows: ${summary.externalCloseout.evidenceRepairRows}`,
    `- Operator actions: ${summary.externalCloseout.operatorActions}`,
    `- Next action: ${summary.externalCloseout.nextActionId || "none"}`,
    `- Next step: ${summary.externalCloseout.nextStep}`,
    "",
    "## Official Research",
    "",
    ...summary.officialResearch.map((item) => `- ${item.platform}: ${item.notes.join(" ")} Source: ${item.docsUrl}`),
    "",
    "## Next Evidence Drop",
    "",
    `Use: ${summary.nextEvidenceDropPath}`,
    `Rows: ${summary.nextEvidenceDrop.rows}`,
    `Source: ${summary.nextEvidenceDrop.source}`,
    `Next step: ${summary.nextEvidenceDrop.nextStep}`,
    `Schema: ${externalEvidenceHeader}`,
    "",
    "Preview rows:",
    "```csv",
    ...summary.nextEvidenceDrop.previewRows,
    "```",
    "",
    "Preview cards:",
    "",
    ...summary.nextEvidenceDrop.previewCards.map((card) => [
      `- ${card.id}: ${card.kind} / ${card.platform || "all"} / ${card.status}`,
      `  Next step: ${card.nextStep}`,
      `  Proof: ${card.proofPath || "missing"}`,
    ].join("\n")),
    "",
    "## Next Step",
    "",
    summary.nextStep,
    "",
  ].join("\n");
}

function renderCsv(summary) {
  return [
    "account_id,account_name,category,platform,account_status,metricool_connected,metricool_rights_ready_assets,ready_for_metricool_approval,direct_api_ready,next_step",
    ...summary.accountRows.map((row) => [
      row.accountId,
      row.accountName,
      row.category,
      row.platform,
      row.accountStatus,
      row.metricoolConnected ? "yes" : "no",
      row.metricoolRightsReadyAssets,
      row.readyForMetricoolApproval ? "yes" : "no",
      row.directApiReady ? "yes" : "no",
      row.nextStep,
    ].map(csvCell).join(",")),
    "",
  ].join("\n");
}

async function main() {
  await mkdir(rootDir, { recursive: true });
  const queue = await readJson(path.join(rootDir, "scheduled", "metricool-execution-queue.json"), {});
  const permissionTracker = await readJson(path.join(rootDir, "permission-tracker.json"), {});
  const developerKit = await readJson(path.join(rootDir, "developer-app-evidence", "developer-app-connection-kit.json"), {});
  const externalCloseout = await readJson(externalCloseoutProofTodoPath, {});
  const permissionRows = platforms.map((platform) => {
    const permission = permissionStatusFor(permissionTracker, platform.platform, platform.requiredScopes);
    return {
      platform: platform.platform,
      label: platform.label,
      status: permission.status,
      approved: permission.approved,
      requested: permission.requested,
      blocked: permission.blocked,
      scopes: platform.requiredScopes,
      docsUrl: platform.directApiDocsUrl,
      developerPortalUrl: platform.developerPortalUrl,
      items: permission.items,
      nextStep: permission.items.find((item) => item.status !== "approved")?.nextStep || "Permissions approved; keep evidence current.",
    };
  });
  const developerRows = platforms.map((platform) => ({
    platform: platform.platform,
    label: platform.label,
    ...developerAppStatusFor(developerKit, platform.platform),
  }));
  const metricoolGuard = metricoolQueueGuard(queue);

  const accountRows = [];
  for (const account of accounts) {
    for (const platform of platforms) {
      const evidencePath = evidencePathFor(account.accountId, platform.platform);
      const evidence = await readJson(evidencePath, {});
      const metricool = metricoolConnectionFor(queue, account, platform.platform);
      const permissionRow = permissionRows.find((row) => row.platform === platform.platform);
      const developerRow = developerRows.find((row) => row.platform === platform.platform);
      const accountStatus = evidence?.status === "verified" ? "verified" : evidence?.status || "missing";
      const readyForMetricoolApproval = accountStatus === "verified"
        && metricool.connected
        && metricool.rightsReadyAssets > 0
        && metricoolGuard.safe;
      const directApiReady = accountStatus === "verified"
        && developerRow?.status === "approved"
        && permissionRow?.status === "approved";
      const metricoolBlockers = [
        accountStatus !== "verified" ? "account evidence not verified" : null,
        !metricool.connected ? "not connected in Metricool for this platform" : null,
        metricool.connected && metricool.rightsReadyAssets <= 0 ? "no rights-ready source assets for this category" : null,
        metricool.connected && !metricoolGuard.safe ? metricoolGuard.blockers[0] || "Metricool queue guard is blocked" : null,
      ].filter(Boolean);
      const directApiBacklog = [
        developerRow?.status !== "approved" ? `${platform.platform} developer app not approved` : null,
        permissionRow?.status !== "approved" ? `${platform.platform} permissions not approved` : null,
      ].filter(Boolean);
      accountRows.push({
        accountId: account.accountId,
        accountName: account.accountName,
        category: account.category,
        platform: platform.platform,
        label: platform.label,
        handle: account.handle,
        accountStatus,
        evidencePath,
        profileUrl: evidence?.profileUrl || evidence?.profileLink || null,
        metricoolConnected: metricool.connected,
        metricoolConnectedNetworks: metricool.connectedNetworks,
        metricoolRightsReadyAssets: metricool.rightsReadyAssets,
        readyForMetricoolApproval,
        directApiReady,
        blockers: metricoolBlockers,
        metricoolBlockers,
        directApiBacklog,
        nextStep: metricoolBlockers[0] || "Ready for Metricool approval_required review; direct APIs are future scale work.",
      });
    }
  }

  const totals = {
    accountProfiles: accountRows.length,
    verifiedAccounts: accountRows.filter((row) => row.accountStatus === "verified").length,
    metricoolReadyLanes: accountRows.filter((row) => row.readyForMetricoolApproval).length,
    directApiReadyLanes: accountRows.filter((row) => row.directApiReady).length,
    developerApps: developerRows.length,
    developerAppsApproved: developerRows.filter((row) => row.status === "approved").length,
    permissionGroups: permissionRows.length,
    permissionGroupsApproved: permissionRows.filter((row) => row.status === "approved").length,
  };
  const localOwnedSourceAssets = queue?.sourceReadiness?.localOwnedSourceTotals?.total || 0;
  const connectedMetricoolRightsReadyAssets = queue?.sourceReadiness?.totals?.rightsReadyAssets || 0;
  const externalProofsNeedEvidence = externalCloseout?.totals?.proofFilesNeedRealEvidence || 0;
  const externalOperatorActions = externalCloseout?.totals?.tasks || externalCloseout?.rows?.length || 0;
  const externalEvidenceRepairRows = externalProofsNeedEvidence;
  const metricoolMvpReady = totals.metricoolReadyLanes >= 2 && connectedMetricoolRightsReadyAssets > 0;
  const fullReadinessGapRows = [
    progressRow("accounts", "Account profiles", totals.verifiedAccounts, totals.accountProfiles, accountRows.find((row) => row.accountStatus !== "verified")?.nextStep || "All account profiles verified."),
    progressRow("metricool", "Metricool approval lanes", totals.metricoolReadyLanes, Math.min(2, totals.accountProfiles), "Keep SPORT and memes connected in Metricool approval_required mode."),
    progressRow("developer_apps", "Developer apps", totals.developerAppsApproved, totals.developerApps, developerRows.find((row) => row.status !== "approved")?.nextStep || "All developer apps approved."),
    progressRow("permissions", "Platform permission groups", totals.permissionGroupsApproved, totals.permissionGroups, permissionRows.find((row) => row.status !== "approved")?.nextStep || "All platform permissions approved."),
    progressRow("external_proofs", "External proof files", Math.max(0, externalOperatorActions - externalProofsNeedEvidence), externalOperatorActions, externalCloseout?.operatorQueue?.[0]?.operatorAction || "All external proof files are complete."),
    progressRow("direct_api", "Direct API lanes", totals.directApiReadyLanes, totals.accountProfiles, "Keep Direct API blocked until accounts, developer apps, permissions and proof imports are all verified."),
  ];
  const fullReadinessMissing = fullReadinessGapRows.reduce((sum, row) => sum + row.missing, 0);
  const fullReadinessTotal = fullReadinessGapRows.reduce((sum, row) => sum + row.total, 0);
  const nextEvidenceCsv = nextEvidenceRows(accountRows, permissionRows, developerRows, externalCloseout);
  const nextEvidenceCsvLines = nextEvidenceCsv.trim().split(/\r?\n/).filter(Boolean);
  const nextEvidenceDataRows = nextEvidenceCsvLines.slice(1);
  const nextEvidenceCards = closeoutCardsForEvidenceDrop(externalCloseout);
  const status = metricoolMvpReady
    ? externalProofsNeedEvidence > 0 || totals.directApiReadyLanes < totals.accountProfiles
      ? "metricool_mvp_ready_with_external_blockers"
      : "metricool_mvp_ready"
    : "blocked";
  const summary = {
    status,
    generatedAt: new Date().toISOString(),
    launchMode: "metricool_approval_required",
    directSocialApisRequired: false,
    paths: {
      json: outJsonPath,
      markdown: outMarkdownPath,
      csv: outCsvPath,
    },
    accountRows,
    permissionRows,
    developerRows,
    sourceReadiness: {
      localOwnedSourceAssets,
      connectedMetricoolRightsReadyAssets,
      realPublishEnabled: queue?.realPublishEnabled === true,
      publishMode: queue?.publishMode || queue?.status || "unknown",
      queueStatus: queue?.status || "unknown",
      readyToSend: queue?.totals?.readyToSend || 0,
      guardSafe: metricoolGuard.safe,
      blockers: metricoolGuard.blockers,
    },
    fullReadinessGap: {
      status: fullReadinessMissing === 0 ? "ready" : metricoolMvpReady ? "metricool_mvp_ready_with_external_blockers" : "blocked",
      ready: fullReadinessTotal - fullReadinessMissing,
      total: fullReadinessTotal,
      missing: fullReadinessMissing,
      percent: fullReadinessTotal > 0 ? Math.round(((fullReadinessTotal - fullReadinessMissing) / fullReadinessTotal) * 100) : 100,
      rows: fullReadinessGapRows,
      nextStep: fullReadinessGapRows.find((row) => row.missing > 0)?.nextStep || "All account, permission and external proof gates are ready.",
    },
    externalCloseout: {
      status: externalCloseout?.status || "not_prepared",
      proofFilesNeedRealEvidence: externalProofsNeedEvidence,
      evidenceRepairRows: externalEvidenceRepairRows,
      operatorActions: externalOperatorActions,
      nextEvidenceRows: closeoutRowsForEvidenceDrop(externalCloseout).length,
      evidenceImportCsvPath: externalCloseout?.paths?.evidenceCsv || null,
      nextActionId: externalCloseout?.operatorQueue?.[0]?.id || externalCloseout?.rows?.[0]?.id || null,
      nextStep: externalCloseout?.operatorQueue?.[0]?.operatorAction || externalCloseout?.rows?.[0]?.nextStep || "Prepare external closeout pack and import real non-secret evidence.",
    },
    officialResearch: platforms.map((platform) => ({
      platform: platform.platform,
      docsUrl: platform.directApiDocsUrl,
      uploadDocsUrl: platform.uploadDocsUrl,
      notes: platform.officialResearch,
    })),
    totals,
    nextEvidenceDrop: {
      path: evidenceDropPath,
      rows: nextEvidenceDataRows.length,
      header: nextEvidenceCsvLines[0] || externalEvidenceHeader,
      previewRows: nextEvidenceDataRows.slice(0, 5),
      cards: nextEvidenceCards,
      previewCards: nextEvidenceCards.slice(0, 5),
      source: nextEvidenceDataRows.length > 0 && externalOperatorActions > 0 ? "external_closeout" : "account_permission_readiness",
      nextStep: nextEvidenceDataRows.length > 0
        ? "Fill only rows backed by real non-secret proof, then run the external closeout evidence import preview."
        : "No next evidence rows remain.",
    },
    nextEvidenceDropPath: evidenceDropPath,
    nextStep: status === "metricool_mvp_ready"
      ? "Open Metricool and manually review approved queued clips; all external blockers are clear."
      : status === "metricool_mvp_ready_with_external_blockers"
        ? "Use Metricool in approval_required mode for connected lanes. Complete developer apps and permissions later only if you want direct API publishing."
        : "Create/connect missing external accounts and import real account/developer/permission evidence before enabling more lanes.",
  };

  await writeFile(outJsonPath, JSON.stringify(summary, null, 2));
  await writeFile(outMarkdownPath, renderMarkdown(summary));
  await writeFile(outCsvPath, renderCsv(summary));
  await writeFile(evidenceDropPath, nextEvidenceCsv);
  console.log(JSON.stringify({
    status: summary.status,
    launchMode: summary.launchMode,
    directSocialApisRequired: summary.directSocialApisRequired,
    verifiedAccounts: totals.verifiedAccounts,
    accountProfiles: totals.accountProfiles,
    metricoolReadyLanes: totals.metricoolReadyLanes,
    directApiReadyLanes: totals.directApiReadyLanes,
    externalProofsNeedEvidence,
    externalEvidenceRepairRows,
    fullReadinessPercent: summary.fullReadinessGap.percent,
    fullReadinessMissing: summary.fullReadinessGap.missing,
    nextEvidenceRows: summary.nextEvidenceDrop.rows,
    connectedMetricoolRightsReadyAssets,
    localOwnedSourceAssets,
    nextEvidenceDropPath: evidenceDropPath,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
