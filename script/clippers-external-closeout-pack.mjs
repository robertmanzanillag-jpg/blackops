import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const rootDir = path.join(process.cwd(), "clippers_workspace");
const reportsDir = path.join(rootDir, "reports");
const accountReadinessPath = path.join(rootDir, "account-permission-readiness.json");
const operationalReadinessPath = path.join(reportsDir, "clippers-operational-readiness.json");
const outJsonPath = path.join(reportsDir, "clippers-external-closeout-pack.json");
const outMarkdownPath = path.join(reportsDir, "clippers-external-closeout-pack.md");
const outCsvPath = path.join(reportsDir, "clippers-external-closeout-pack.csv");
const proofTodoJsonPath = path.join(reportsDir, "clippers-external-closeout-proof-todo.json");
const proofTodoMarkdownPath = path.join(reportsDir, "clippers-external-closeout-proof-todo.md");
const proofTodoCsvPath = path.join(reportsDir, "clippers-external-closeout-proof-todo.csv");
const operatorQueueJsonPath = path.join(reportsDir, "clippers-external-closeout-operator-queue.json");
const operatorQueueMarkdownPath = path.join(reportsDir, "clippers-external-closeout-operator-queue.md");
const operatorQueueCsvPath = path.join(reportsDir, "clippers-external-closeout-operator-queue.csv");
const goLiveAuditJsonPath = path.join(reportsDir, "clippers-external-go-live-audit.json");
const goLiveAuditMarkdownPath = path.join(reportsDir, "clippers-external-go-live-audit.md");
const goLiveAuditCsvPath = path.join(reportsDir, "clippers-external-go-live-audit.csv");
const actionSheetJsonPath = path.join(reportsDir, "clippers-external-operator-action-sheet.json");
const actionSheetMarkdownPath = path.join(reportsDir, "clippers-external-operator-action-sheet.md");
const actionSheetCsvPath = path.join(reportsDir, "clippers-external-operator-action-sheet.csv");
const nextWorkRunJsonPath = path.join(reportsDir, "clippers-external-next-work-run.json");
const nextWorkRunMarkdownPath = path.join(reportsDir, "clippers-external-next-work-run.md");
const nextWorkRunCsvPath = path.join(reportsDir, "clippers-external-next-work-run.csv");
const evidenceImportReportPath = path.join(reportsDir, "clippers-external-closeout-evidence-import-report.json");
const officialPermissionSourceAuditPath = path.join(rootDir, "official-permission-source-audit.json");
const evidenceCsvPath = path.join(rootDir, "evidence-drop", "external-closeout-evidence-import.csv");
const proofDir = path.join(rootDir, "evidence-drop", "external-closeout-proofs");
const productionPublicUrlPath = path.join(rootDir, "production-public-url.json");
const secretPattern = /\b(access[_-]?token|refresh[_-]?token|client[_-]?secret|api[_-]?key|password|passcode|cookie|session|bearer|recovery[_ -]?code|private[_ -]?key)\b|sk-[A-Za-z0-9_-]{12,}/i;
const secretQueryParamPattern = /(^|[?&;])(token|code|auth|signature|sig|signed|secret|key|api_key|apikey|access|session)=/i;
const placeholderPattern = /<[^>]+>|paste .* proof|submitted_or_approved|requested_or_approved|do not store passwords|placeholder|todo|tbd/i;
const jsonScriptTimeoutMs = 120_000;
const nestedJsonScriptTimeoutMs = 90_000;

function killScriptProcess(child) {
  if (child.pid) {
    try {
      process.kill(-child.pid, "SIGKILL");
      return;
    } catch {
      // Fall back to killing only the direct child when process groups are unavailable.
    }
  }
  child.kill("SIGKILL");
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function readJsonOptional(filePath) {
  try {
    return await readJson(filePath);
  } catch {
    return null;
  }
}

function runJsonScript(scriptPath, label, timeoutMs = jsonScriptTimeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd: process.cwd(),
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      killScriptProcess(child);
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => finish(() => reject(error)));
    child.on("close", (code) => {
      finish(() => {
        if (code !== 0) {
          reject(new Error(`${label} failed with code ${code}${stderr ? `\n${stderr}` : ""}`));
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch (error) {
          reject(new Error(`${label} returned invalid JSON: ${error.message}`));
        }
      });
    });
  });
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function artifactSafetyFindings(artifacts) {
  return artifacts.flatMap((artifact) => {
    const findings = [];
    if (secretPattern.test(artifact.content)) findings.push("secret_keyword_or_key_pattern");
    if (secretQueryParamPattern.test(artifact.content)) findings.push("tokenized_or_signed_query_param");
    return findings.map((reason) => ({ path: artifact.path, reason }));
  });
}

function proofFileName(task) {
  return `${task.id.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase()}.md`;
}

function proofPathFor(task) {
  return path.join(proofDir, proofFileName(task));
}

function requiredCsvStatus(task) {
  if (task.lane === "account") return "verified";
  if (task.lane === "developer_app") return "submitted";
  if (task.lane === "permission") return "requested";
  return "";
}

function requiredCsvFields(task) {
  if (task.lane === "account") return ["account_id", "platform", "status", "proof", "notes"];
  if (task.lane === "developer_app") return ["platform", "status", "app_identifier", "public_base_url", "redirect_uri", "proof", "notes"];
  return ["platform", "status", "scope", "proof", "notes"];
}

function renderProofFieldTemplate(task) {
  const fieldDefaults = {
    account_id: task.accountId || "",
    platform: task.platform || "",
    status: requiredCsvStatus(task),
    scope: task.scope || "",
    app_identifier: "",
    public_base_url: task.redirectUri && task.redirectUri.startsWith("https://") ? new URL(task.redirectUri).origin : "",
    redirect_uri: task.redirectUri || "",
    proof: "<paste real proof URL or local proof file path>",
    notes: "<write one sentence confirming the portal action and where proof lives>",
  };
  return [
    "Evidence CSV fields to fill:",
    ...requiredCsvFields(task).map((field) => `- ${field}: ${fieldDefaults[field] || ""}`),
    "",
  ].join("\n");
}

function parseProofFields(raw) {
  const fields = {};
  let insideFields = false;
  for (const line of raw.split(/\r?\n/)) {
    if (line.trim() === "Evidence CSV fields to fill:") {
      insideFields = true;
      continue;
    }
    if (insideFields && !line.trim()) break;
    if (!insideFields) continue;
    const match = line.match(/^\s*-\s*([a-z_]+):\s*(.*)$/);
    if (match) {
      const value = match[2].trim();
      fields[match[1]] = secretPattern.test(value) || secretQueryParamPattern.test(value) ? "" : value;
    }
  }
  return fields;
}

function proofFieldValue(task, field, fallback = "") {
  const value = task.proofFields?.[field];
  return value && !/^<[^>]+>$/.test(value) ? value : fallback;
}

function looksPlaceholder(value) {
  return !String(value || "").trim() || placeholderPattern.test(String(value || ""));
}

function safeOriginFromRedirect(redirectUri) {
  try {
    const url = new URL(redirectUri);
    return url.protocol === "https:" ? url.origin : "";
  } catch {
    return "";
  }
}

function isBlockedPublicHost(hostname) {
  return hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "0.0.0.0" ||
    hostname.startsWith("127.") ||
    hostname.startsWith("10.") ||
    hostname.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname) ||
    hostname.endsWith(".localhost") ||
    hostname === "example" ||
    hostname === "example.com" ||
    hostname.endsWith(".example.com") ||
    hostname === "test" ||
    hostname.endsWith(".example") ||
    hostname === "invalid" ||
    hostname.endsWith(".test") ||
    hostname.endsWith(".invalid");
}

function isProductionPublicBaseUrl(value) {
  if (!/^https:\/\//i.test(value || "")) return false;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return !isBlockedPublicHost(hostname) && hostname.includes(".");
  } catch {
    return false;
  }
}

async function readStoredPublicBaseUrl() {
  const stored = await readJsonOptional(productionPublicUrlPath);
  const publicBaseUrl = typeof stored?.publicBaseUrl === "string" ? stored.publicBaseUrl.trim() : "";
  if (isProductionPublicBaseUrl(publicBaseUrl)) return publicBaseUrl.replace(/\/$/, "");
  const envPublicBaseUrl = typeof process.env.PUBLIC_BASE_URL === "string" ? process.env.PUBLIC_BASE_URL.trim() : "";
  return isProductionPublicBaseUrl(envPublicBaseUrl) ? envPublicBaseUrl.replace(/\/$/, "") : "";
}

function closeoutRedirectUri(platform, existingRedirectUri, publicBaseUrl) {
  const existingOrigin = safeOriginFromRedirect(existingRedirectUri || "");
  if (existingOrigin && isProductionPublicBaseUrl(existingOrigin)) return existingRedirectUri;
  return publicBaseUrl && platform ? `${publicBaseUrl}/api/clippers/oauth/${platform}/callback` : (existingRedirectUri || "");
}

function acceptableCloseoutStatuses(task) {
  if (task.lane === "account") return ["verified"];
  if (task.lane === "developer_app") return ["submitted", "approved"];
  if (task.lane === "permission") return ["requested", "approved"];
  return [requiredCsvStatus(task)].filter(Boolean);
}

async function proofReferenceBlocker(task) {
  const proof = proofFieldValue(task, "proof", "");
  if (looksPlaceholder(proof)) return "fill proof with a real URL or local evidence path before it can leave the operator queue";
  if (secretPattern.test(proof) || secretQueryParamPattern.test(proof)) return "proof reference contains sensitive token/secret/cookie/signature text";
  if (/^https?:\/\//i.test(proof)) {
    try {
      const url = new URL(proof);
      const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
      const singleLabelHost = !hostname.includes(".") && hostname !== "drive.google.com";
      if (url.protocol !== "https:") return "proof URL must use HTTPS";
      if (isBlockedPublicHost(hostname) || singleLabelHost) return "proof URL must use a real public domain, not localhost/example/test";
      if (secretQueryParamPattern.test(url.search)) return "proof URL appears to contain token/code/signature query parameters";
      return "";
    } catch {
      return "proof URL is not valid";
    }
  }
  const absolute = path.isAbsolute(proof) ? proof : path.resolve(process.cwd(), proof);
  const relative = path.relative(rootDir, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return "local proof path must stay inside clippers_workspace";
  const [realRoot, realProof] = await Promise.all([
    realpath(rootDir).catch(() => null),
    realpath(absolute).catch(() => null),
  ]);
  if (!realRoot || !realProof) return "local proof file does not exist or cannot be read";
  const realRelative = path.relative(realRoot, realProof);
  if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) return "local proof file resolves outside clippers_workspace";
  const raw = await readFile(realProof, "utf8").catch(() => null);
  if (!raw) return "local proof file does not exist or cannot be read";
  if (raw.length < 80) return "local proof file is too short to prove a real portal action";
  if (placeholderPattern.test(raw) || /needs_real_proof/i.test(raw)) return "local proof file still contains placeholders or needs_real_proof";
  if (secretPattern.test(raw) || secretQueryParamPattern.test(raw)) return "local proof file contains sensitive token/secret/cookie/signature text";
  return "";
}

function hasProofStubMarkers(raw) {
  return /Status:\s*needs_real_proof/i.test(raw)
    || /:\s*<[^>]+>/i.test(raw);
}

function proofSafetyBlocker(raw) {
  return secretPattern.test(raw) || secretQueryParamPattern.test(raw)
    ? "proof file contains sensitive token/secret/cookie/signature text; remove it before generating reports"
    : "";
}

function safeArtifactText(value) {
  return String(value || "")
    .replace(/secreto\/token\/password\/cookie/gi, "sensitive credential-like text")
    .replace(/token\/secret\/cookie\/signature/gi, "sensitive credential-like text")
    .replace(/\bpasswords?\b/gi, "sensitive values")
    .replace(/\bcookies?\b/gi, "browser credentials")
    .replace(/\bclient secrets?\b/gi, "developer app private values")
    .replace(/\bOAuth tokens?\b/gi, "OAuth private values")
    .replace(/\brecovery codes?\b/gi, "recovery private values");
}

function safeSourceCardText(value) {
  return safeArtifactText(value)
    .replace(/\bbearer\b/gi, "authorized")
    .replace(/\btokens?\b/gi, "OAuth private values");
}

function safeSourceCardField(value, fallback = "") {
  const raw = String(value || fallback).trim();
  if (!raw) return "";
  if (secretPattern.test(raw) || secretQueryParamPattern.test(raw)) {
    return "[redacted unsafe official source reference]";
  }
  return safeSourceCardText(raw);
}

function safeSourceCardList(values) {
  return (values || [])
    .map((value) => safeSourceCardField(value))
    .filter(Boolean);
}

function proofCompletionChecklist(task) {
  const base = [
    "The external portal action is complete or submitted in the official portal.",
    "The proof reference is a public/non-secret URL, ticket ID or local proof file inside clippers_workspace.",
    "Operator notes explain the real action, date and portal location in 20+ characters.",
  ];
  if (task.lane === "developer_app") {
    return [
      ...base,
      "App identifier/client key/project ID is public-safe and copied into app_identifier.",
      "public_base_url and redirect_uri match the production callback configured in the portal.",
      "No client private value, OAuth private value, browser credential or recovery private value is stored.",
    ];
  }
  if (task.lane === "permission") {
    return [
      ...base,
      "Scope name in the CSV exactly matches the portal permission or app-review scope.",
      "Use-case note mentions owned/permissioned clips and Metricool approval_required publishing.",
      "requested means submitted and waiting; approved means the portal already granted the scope.",
    ];
  }
  if (task.lane === "account") {
    return [
      ...base,
      "Profile/channel URL is real and belongs to the expected Clippers account.",
      "Manager/owner proof is referenced without storing login details or private screenshots.",
      "Metricool connected-profile proof is included when this platform is part of the launch lane.",
    ];
  }
  return base;
}

function proofEvidenceExamples(task) {
  if (task.lane === "developer_app") {
    return [
      "Portal app overview URL or ticket URL that shows the app identifier.",
      "App review/submission reference showing requested or approved posting access.",
      "Production callback URL confirmation matching the redirect URI below.",
    ];
  }
  if (task.lane === "permission") {
    return [
      "Portal review URL, request ID, case ID or approval page for the exact scope.",
      "Non-secret screenshot reference stored outside this repo, or a safe local proof note.",
      "Reviewer/use-case note showing why this permission is needed for owned/permissioned clips.",
    ];
  }
  if (task.lane === "account") {
    return [
      "Profile/channel URL for the exact account.",
      "Account manager/owner proof reference without credentials.",
      "Metricool connected-profile proof reference when applicable.",
    ];
  }
  return ["Real non-secret proof reference from the official portal."];
}

function renderProofStub(task) {
  return [
    `# ${task.id}`,
    "",
    "Status: needs_real_proof",
    "",
    "Fill this file with real non-secret evidence before running Apply.",
    "",
    "Required evidence:",
    ...task.evidenceRequired.map((item) => `- ${item}`),
    "",
    "Safe proof examples:",
    ...proofEvidenceExamples(task).map((item) => `- ${item}`),
    "",
    "Completion checklist:",
    ...proofCompletionChecklist(task).map((item) => `- [ ] ${item}`),
    "",
    "Paste real proof below. Do not paste login details, browser credentials, developer app private values, OAuth private values, recovery private values or private screenshots.",
    "",
    "Proof URL or secure local evidence path: <paste real proof URL or secure local evidence path>",
    "Portal/ticket/case/profile reference: <paste real reference>",
    "Operator notes: <write at least one sentence confirming the external portal action is real>",
    "",
    renderProofFieldTemplate(task),
    `Portal: ${task.portalUrl || "n/a"}`,
    task.docsUrl ? `Docs: ${task.docsUrl}` : "",
    task.redirectUri ? `Redirect URI: ${task.redirectUri}` : "",
    `Next step: ${task.nextStep}`,
    "",
  ].filter(Boolean).join("\n");
}

async function writeProofStubs(tasks) {
  await mkdir(proofDir, { recursive: true });
  return Promise.all(tasks.map(async (task) => {
    const proofPath = proofPathFor(task);
    const existing = await readFile(proofPath, "utf8").catch(() => null);
    const existingIsStub = existing && hasProofStubMarkers(existing);
    const proofRaw = !existing || existingIsStub ? renderProofStub(task) : existing;
    if (!existing || existingIsStub) await writeFile(proofPath, proofRaw);
    const proofSafety = proofSafetyBlocker(proofRaw);
    const proofFields = parseProofFields(proofRaw);
    const proofStatus = hasProofStubMarkers(proofRaw) || proofSafety
      ? "needs_real_proof"
      : "proof_file_filled";
    const taskWithProof = { ...task, proofPath, proofStatus, proofSafetyBlocker: proofSafety, proofFields };
    const proofReferenceSafetyBlocker = await proofReferenceBlocker(taskWithProof);
    return { ...taskWithProof, proofReferenceSafetyBlocker };
  }));
}

function accountTask(row) {
  return {
    id: `account:${row.accountId}:${row.platform}`,
    lane: "account",
    priority: row.accountId === "streamer-pulse" && row.platform === "tiktok" ? "critical" : "high",
    platform: row.platform,
    accountId: row.accountId,
    accountName: row.accountName,
    currentStatus: row.accountStatus,
    targetStatus: "verified",
    portalUrl: row.platform === "tiktok"
      ? "https://www.tiktok.com/signup"
      : row.platform === "instagram"
        ? "https://www.instagram.com/accounts/emailsignup/"
        : "https://www.youtube.com/create_channel",
    evidenceRequired: [
      "real profile/channel URL",
      "account owner/manager proof",
      "2FA or recovery method proof without secrets",
      "Metricool connected profile proof when applicable",
    ],
    safeNotes: "Do not store passwords, recovery codes, cookies, tokens, or private screenshots in this repo.",
    nextStep: row.nextStep,
  };
}

function developerTask(row, publicBaseUrl = "") {
  return {
    id: `developer_app:${row.platform}`,
    lane: "developer_app",
    priority: "critical",
    platform: row.platform,
    accountId: "",
    accountName: row.label,
    currentStatus: row.status,
    targetStatus: "submitted_or_approved",
    portalUrl: row.platform === "tiktok"
      ? "https://developers.tiktok.com/"
      : row.platform === "instagram"
        ? "https://developers.facebook.com/"
        : "https://console.cloud.google.com/apis/library/youtube.googleapis.com",
    redirectUri: closeoutRedirectUri(row.platform, row.redirectUri, publicBaseUrl),
    evidenceRequired: [
      "developer app id/client key/project id",
      "public HTTPS callback URL configured in portal",
      "portal screenshot/ticket URL without secrets",
      "approved status proof when available",
    ],
    missingEnvVars: row.missingEnvVars || [],
    safeNotes: "Import only identifiers and proof links; never paste client secrets into evidence CSVs.",
    nextStep: row.nextStep,
  };
}

function permissionTasks(row) {
  return (row.items || row.scopes.map((scope) => ({ scope, status: row.status, nextStep: row.nextStep }))).map((item) => ({
    id: `permission:${row.platform}:${item.scope}`,
    lane: "permission",
    priority: "critical",
    platform: row.platform,
    accountId: "",
    accountName: row.label,
    currentStatus: item.status || row.status,
    targetStatus: "requested_or_approved",
    scope: item.scope,
    portalUrl: item.developerPortalUrl || row.developerPortalUrl,
    docsUrl: item.docsUrl || row.docsUrl,
    evidenceRequired: [
      "permission request/review URL",
      "approval screenshot or portal/ticket note without secrets",
      "reviewer use-case note showing owned/permissioned content and approval_required publishing",
    ],
    safeNotes: "Blocked permissions keep Direct API disabled; Metricool approval_required can continue for connected TikTok lanes.",
    nextStep: item.nextStep || row.nextStep,
  }));
}

function evidenceRow(task) {
  const fallbackPublicBaseUrl = task.redirectUri && task.redirectUri.startsWith("https://")
    ? new URL(task.redirectUri).origin
    : "";
  const publicBaseUrl = proofFieldValue(task, "public_base_url", fallbackPublicBaseUrl);
  const proof = proofFieldValue(task, "proof", task.proofPath || `<paste ${task.lane} proof URL or local secure evidence path>`);
  const notes = proofFieldValue(task, "notes", `${task.safeNotes} Fill proof file before applying: ${task.proofPath || "missing"}`);
  return [
    task.lane,
    proofFieldValue(task, "account_id", task.accountId || ""),
    proofFieldValue(task, "platform", task.platform || ""),
    proofFieldValue(task, "status", requiredCsvStatus(task)),
    proofFieldValue(task, "scope", task.scope || ""),
    proofFieldValue(task, "app_identifier", ""),
    publicBaseUrl,
    proofFieldValue(task, "redirect_uri", task.redirectUri || ""),
    task.portalUrl || "",
    task.docsUrl || "",
    proof,
    notes,
  ].map(csvCell).join(",");
}

function proofTodoBlockers(task, requiredCsvFields) {
  const blockers = [];
  if (task.proofStatus === "needs_real_proof") blockers.push("replace proof stub with real non-secret evidence");
  if (task.proofSafetyBlocker) blockers.push(task.proofSafetyBlocker);
  if (task.proofReferenceSafetyBlocker) blockers.push(task.proofReferenceSafetyBlocker);
  const proofStatusValue = proofFieldValue(task, "status", requiredCsvStatus(task)).toLowerCase();
  if (!acceptableCloseoutStatuses(task).includes(proofStatusValue)) {
    blockers.push(`status must be one of ${acceptableCloseoutStatuses(task).join(", ")} before this action can leave the operator queue`);
  }
  if (task.lane === "developer_app" && !proofFieldValue(task, "app_identifier")) blockers.push("fill app_identifier from the developer portal");
  if (task.lane === "developer_app" && !isProductionPublicBaseUrl(proofFieldValue(task, "public_base_url", safeOriginFromRedirect(task.redirectUri || "")))) {
    blockers.push("fill public_base_url with a real public HTTPS production URL, not localhost/private/example/test");
  }
  if (task.lane === "developer_app" && !task.redirectUri) blockers.push("confirm public HTTPS redirect_uri");
  if (task.lane === "permission" && !task.scope) blockers.push("fill permission scope");
  if (task.lane === "account" && (!task.accountId || !task.platform)) blockers.push("fill account_id and platform");
  const missingFieldSummary = requiredCsvFields.filter((field) => {
    if (field === "proof") return task.proofStatus === "needs_real_proof";
    if (field === "app_identifier") return task.lane === "developer_app" && !proofFieldValue(task, "app_identifier");
    if (field === "scope") return task.lane === "permission" && !task.scope;
    return false;
  });
  if (missingFieldSummary.length) blockers.push(`CSV fields still need real values: ${missingFieldSummary.join(", ")}`);
  return Array.from(new Set(blockers));
}

function missingProofTodoFields(task, requiredCsvFields) {
  return requiredCsvFields.filter((field) => {
    if (field === "proof") return task.proofStatus === "needs_real_proof";
    if (field === "app_identifier") return task.lane === "developer_app" && !proofFieldValue(task, "app_identifier");
    if (field === "scope") return task.lane === "permission" && !task.scope;
    if (field === "account_id") return task.lane === "account" && !task.accountId;
    if (field === "platform") return !task.platform;
    return false;
  });
}

function operatorActionFor(row) {
  if (row.lane === "developer_app") {
    return `Open ${row.platform} developer portal, create or submit the app, copy the public app identifier, then fill ${row.proofPath}.`;
  }
  if (row.lane === "permission") {
    return `Open ${row.platform} developer portal, request or confirm ${row.scope}, then fill ${row.proofPath}.`;
  }
  return `Open the ${row.platform} account/profile, verify ownership or Metricool connection, then fill ${row.proofPath}.`;
}

function proofTodoRow(task) {
  const fields = requiredCsvFields(task);
  const blockers = proofTodoBlockers(task, fields);
  const missingCsvFields = missingProofTodoFields(task, fields);
  return {
    id: task.id,
    lane: task.lane,
    priority: task.priority,
    platform: task.platform || "",
    accountId: task.accountId || "",
    scope: task.scope || "",
    proofStatus: task.proofStatus,
    proofPath: task.proofPath,
    requiredCsvStatus: requiredCsvStatus(task),
    requiredCsvFields: fields,
    allowedCsvStatuses: task.lane === "account"
      ? ["verified", "submitted", "blocked"]
      : task.lane === "developer_app"
        ? ["submitted", "approved", "rejected", "draft"]
        : ["requested", "approved", "blocked"],
    portalUrl: task.portalUrl || "",
    docsUrl: task.docsUrl || "",
    redirectUri: task.redirectUri || "",
    requiredEvidence: task.evidenceRequired,
    safeNotes: task.safeNotes,
    blockers,
    missingCsvFields,
    readyToApply: blockers.length === 0,
    nextStep: task.nextStep,
    csvEditHint: `Set status to ${requiredCsvStatus(task)} and fill ${fields.join(", ")} only after replacing the proof stub with real non-secret evidence.`,
  };
}

function buildOperatorQueue(proofTodo) {
  const priorityScore = { critical: 0, high: 1 };
  const laneScore = { developer_app: 0, permission: 1, account: 2 };
  return proofTodo
    .filter((row) => !row.readyToApply)
    .sort((a, b) => (
      (priorityScore[a.priority] ?? 9) - (priorityScore[b.priority] ?? 9) ||
      (laneScore[a.lane] ?? 9) - (laneScore[b.lane] ?? 9) ||
      a.id.localeCompare(b.id)
    ))
    .map((row, index) => ({
      rank: index + 1,
      id: row.id,
      lane: row.lane,
      priority: row.priority,
      platform: row.platform,
      accountId: row.accountId,
      scope: row.scope,
      proofPath: row.proofPath,
      proofStatus: row.proofStatus,
      requiredCsvStatus: row.requiredCsvStatus,
      missingCsvFields: row.missingCsvFields,
      blockers: row.blockers,
      portalUrl: row.portalUrl,
      docsUrl: row.docsUrl,
      redirectUri: row.redirectUri,
      operatorAction: operatorActionFor(row),
      csvEditHint: row.csvEditHint,
      nextStep: row.nextStep,
    }));
}

function renderProofTodoMarkdown(summary) {
  const rows = summary.proofTodo.map((row) => [
    `### ${row.id}`,
    "",
    `- Priority: ${row.priority}`,
    `- Proof status: ${row.proofStatus}`,
    `- Proof file: ${row.proofPath}`,
    `- Required CSV status: ${row.requiredCsvStatus}`,
    `- Required CSV fields: ${row.requiredCsvFields.join(", ")}`,
    `- Allowed statuses: ${row.allowedCsvStatuses.join(", ")}`,
    `- Portal: ${row.portalUrl || "n/a"}`,
    row.docsUrl ? `- Docs: ${row.docsUrl}` : null,
    row.redirectUri ? `- Redirect URI: ${row.redirectUri}` : null,
    `- Evidence required: ${row.requiredEvidence.join(" | ")}`,
    `- Safe notes: ${row.safeNotes}`,
    `- Ready to apply: ${row.readyToApply ? "yes" : "no"}`,
    `- Blockers: ${row.blockers.join(" | ") || "none"}`,
    `- Next step: ${row.nextStep}`,
    "",
  ].filter(Boolean).join("\n"));
  return [
    "# Clippers External Closeout Proof Todo",
    "",
    `Generated: ${summary.generatedAt}`,
    "",
    "Use this as the operator checklist for the external portals. Do not paste tokens, passwords, cookies, client secrets, recovery codes, or private screenshots.",
    "",
    `Evidence CSV: ${summary.paths.evidenceCsv}`,
    `Proof dir: ${summary.paths.proofDir}`,
    "",
    "## Totals",
    "",
    `- Todo rows: ${summary.proofTodo.length}`,
    `- Proof files needing real evidence: ${summary.totals.proofFilesNeedRealEvidence}`,
    `- Proof files filled: ${summary.totals.proofFilesFilled}`,
    "",
    "## Rows",
    "",
    ...rows,
  ].join("\n");
}

function renderProofTodoCsv(summary) {
  const header = ["id", "lane", "priority", "platform", "account_id", "scope", "proof_status", "proof_path", "required_csv_status", "required_csv_fields", "allowed_csv_statuses", "ready_to_apply", "blockers", "portal_url", "docs_url", "redirect_uri", "next_step"];
  const rows = summary.proofTodo.map((row) => [
    row.id,
    row.lane,
    row.priority,
    row.platform,
    row.accountId,
    row.scope,
    row.proofStatus,
    row.proofPath,
    row.requiredCsvStatus,
    row.requiredCsvFields.join("|"),
    row.allowedCsvStatuses.join("|"),
    row.readyToApply ? "yes" : "no",
    row.blockers.join(" | "),
    row.portalUrl,
    row.docsUrl,
    row.redirectUri,
    row.nextStep,
  ].map(csvCell).join(","));
  return `${header.join(",")}\n${rows.join("\n")}\n`;
}

function renderOperatorQueueMarkdown(summary) {
  const rows = summary.operatorQueue.map((row) => [
    `### ${row.rank}. ${row.id}`,
    "",
    `- Priority: ${row.priority}`,
    `- Lane: ${row.lane}`,
    `- Platform: ${row.platform || "n/a"}`,
    row.scope ? `- Scope: ${row.scope}` : null,
    `- Operator action: ${row.operatorAction}`,
    `- Proof file: ${row.proofPath}`,
    `- Missing CSV fields: ${row.missingCsvFields.join(", ") || "none"}`,
    `- Required CSV status: ${row.requiredCsvStatus}`,
    `- Portal: ${row.portalUrl || "n/a"}`,
    row.docsUrl ? `- Docs: ${row.docsUrl}` : null,
    row.redirectUri ? `- Redirect URI: ${row.redirectUri}` : null,
    `- Blockers: ${row.blockers.join(" | ") || "none"}`,
    "",
  ].filter(Boolean).join("\n"));
  return [
    "# Clippers External Closeout Operator Queue",
    "",
    `Generated: ${summary.generatedAt}`,
    "",
    "This is the shortest safe queue for finishing the real external portal work. Do not paste secrets, tokens, cookies, recovery codes, client secrets or private screenshots.",
    "",
    `Evidence CSV: ${summary.paths.evidenceCsv}`,
    `Proof dir: ${summary.paths.proofDir}`,
    "",
    "## Totals",
    "",
    `- Queue rows: ${summary.operatorQueue.length}`,
    `- Critical: ${summary.operatorQueue.filter((row) => row.priority === "critical").length}`,
    `- High: ${summary.operatorQueue.filter((row) => row.priority === "high").length}`,
    "",
    "## Queue",
    "",
    ...rows,
  ].join("\n");
}

function renderOperatorQueueCsv(summary) {
  const header = ["rank", "id", "lane", "priority", "platform", "account_id", "scope", "proof_path", "proof_status", "required_csv_status", "missing_csv_fields", "blockers", "portal_url", "docs_url", "redirect_uri", "operator_action", "next_step"];
  const rows = summary.operatorQueue.map((row) => [
    row.rank,
    row.id,
    row.lane,
    row.priority,
    row.platform,
    row.accountId,
    row.scope,
    row.proofPath,
    row.proofStatus,
    row.requiredCsvStatus,
    row.missingCsvFields.join("|"),
    row.blockers.join(" | "),
    row.portalUrl,
    row.docsUrl,
    row.redirectUri,
    row.operatorAction,
    row.nextStep,
  ].map(csvCell).join(","));
  return `${header.join(",")}\n${rows.join("\n")}\n`;
}

function renderMarkdown(summary) {
  const taskLines = summary.tasks.map((task) => [
    `### ${task.id}`,
    "",
    `- Priority: ${task.priority}`,
    `- Lane: ${task.lane}`,
    `- Current -> target: ${task.currentStatus} -> ${task.targetStatus}`,
    `- Portal: ${task.portalUrl || "n/a"}`,
    task.docsUrl ? `- Docs: ${task.docsUrl}` : null,
    task.redirectUri ? `- Redirect URI: ${task.redirectUri}` : null,
    `- Proof file: ${task.proofPath}`,
    `- Proof status: ${task.proofStatus}`,
    task.missingEnvVars?.length ? `- Missing env vars: ${task.missingEnvVars.join(", ")}` : null,
    `- Evidence required: ${task.evidenceRequired.join(" | ")}`,
    `- Next step: ${task.nextStep}`,
    "",
  ].filter(Boolean).join("\n"));
  return [
    "# Clippers External Closeout Pack",
    "",
    `Generated: ${summary.generatedAt}`,
    `Status: ${summary.status}`,
    "",
    "This pack lists only external actions still needed before full go-live. It does not claim accounts, app approvals, permissions, or publishing are complete.",
    "",
    "## Totals",
    "",
    `- Tasks: ${summary.totals.tasks}`,
    `- Critical: ${summary.totals.critical}`,
    `- High: ${summary.totals.high}`,
    `- Account tasks: ${summary.totals.accounts}`,
    `- Developer app tasks: ${summary.totals.developerApps}`,
    `- Permission tasks: ${summary.totals.permissions}`,
    `- Proof files needing real evidence: ${summary.totals.proofFilesNeedRealEvidence}`,
    `- Metricool queued for approval: ${summary.metricool.queuedForApproval}`,
    `- Metricool ready queue: ${summary.metricool.readyToSend}`,
    "",
    "## Blockers",
    "",
    ...summary.blockers.map((blocker) => `- ${blocker}`),
    "",
    "## Evidence Import",
    "",
    `CSV: ${summary.paths.evidenceCsv}`,
    `Proof dir: ${summary.paths.proofDir}`,
    "",
    "## Tasks",
    "",
    ...taskLines,
  ].join("\n");
}

function renderTaskCsv(summary) {
  const header = ["id", "lane", "priority", "platform", "account_id", "account_name", "current_status", "target_status", "scope", "portal_url", "docs_url", "redirect_uri", "proof_path", "proof_status", "next_step"];
  const rows = summary.tasks.map((task) => [
    task.id,
    task.lane,
    task.priority,
    task.platform || "",
    task.accountId || "",
    task.accountName || "",
    task.currentStatus,
    task.targetStatus,
    task.scope || "",
    task.portalUrl || "",
    task.docsUrl || "",
    task.redirectUri || "",
    task.proofPath || "",
    task.proofStatus || "",
    task.nextStep,
  ].map(csvCell).join(","));
  return `${header.join(",")}\n${rows.join("\n")}\n`;
}

function renderEvidenceCsv(summary) {
  return [
    "kind,account_id,platform,status,scope,app_identifier,public_base_url,redirect_uri,portal_url,docs_url,proof,notes",
    ...summary.tasks.map(evidenceRow),
  ].join("\n") + "\n";
}

function buildCloseoutWorkBlocks(operatorQueue) {
  const definitions = [
    {
      id: "developer_apps",
      label: "Developer apps",
      lane: "developer_app",
      estimatedMinutes: 45,
      doneCriteria: [
        "App identifier recorded for every developer app row in this block.",
        "Production public_base_url and redirect_uri match the portal configuration.",
        "Proof files contain real non-secret portal proof before evidence import.",
      ],
    },
    {
      id: "permissions",
      label: "Permission requests",
      lane: "permission",
      estimatedMinutes: 60,
      doneCriteria: [
        "Permission request or approval proof recorded for every scope in this block.",
        "Use-case notes mention owned/permissioned content and Metricool approval_required publishing.",
        "No OAuth tokens, client secrets, signed URLs or private screenshots are stored.",
      ],
    },
    {
      id: "accounts",
      label: "Account/profile verification",
      lane: "account",
      estimatedMinutes: 75,
      doneCriteria: [
        "Account/profile ownership or manager proof recorded for every account row.",
        "Metricool connected-profile proof recorded when the platform is part of the MVP lane.",
        "2FA/recovery proof is referenced without storing recovery codes.",
      ],
    },
  ];
  return definitions
    .map((definition) => {
      const rows = operatorQueue.filter((row) => row.lane === definition.lane);
      const portalUrls = Array.from(new Set(rows.map((row) => row.portalUrl).filter(Boolean)));
      return {
        id: definition.id,
        label: definition.label,
        lane: definition.lane,
        status: rows.length ? "needs_operator" : "complete",
        estimatedMinutes: rows.length ? definition.estimatedMinutes : 0,
        actions: rows.length,
        critical: rows.filter((row) => row.priority === "critical").length,
        high: rows.filter((row) => row.priority === "high").length,
        firstActionId: rows[0]?.id || "",
        firstAction: rows[0]?.operatorAction || "No actions remain for this block.",
        portalUrls,
        proofPaths: rows.map((row) => row.proofPath),
        missingCsvFields: Array.from(new Set(rows.flatMap((row) => row.missingCsvFields || []))),
        csvStatuses: Array.from(new Set(rows.map((row) => row.requiredCsvStatus).filter(Boolean))),
        doneCriteria: definition.doneCriteria,
        nextStep: rows[0]?.operatorAction || "Block complete. Refresh External Closeout Pack after evidence import.",
      };
    })
    .filter((block) => block.actions > 0);
}

function buildEvidenceRepairQueue(summary, evidenceImport) {
  const rejectedRows = evidenceImport?.rejected || [];
  const rejectedByTaskId = new Map();
  const unmappedRejectedRows = [];
  for (const rejected of rejectedRows) {
    const sourceTask = Number.isInteger(rejected.index) ? summary.tasks[rejected.index - 2] : null;
    if (sourceTask) rejectedByTaskId.set(sourceTask.id, rejected);
    else unmappedRejectedRows.push(rejected);
  }
  const repairRows = summary.tasks
    .filter((sourceTask) => rejectedByTaskId.has(sourceTask.id) || summary.operatorQueue.some((row) => row.id === sourceTask.id))
    .map((sourceTask) => {
    const rejected = rejectedByTaskId.get(sourceTask.id);
    const proofTodo = summary.proofTodo.find((row) => row.id === sourceTask.id) || null;
    const operatorQueueRow = summary.operatorQueue.find((row) => row.id === sourceTask.id) || null;
    const requiredStatus = proofTodo?.requiredCsvStatus || (sourceTask ? requiredCsvStatus(sourceTask) : "");
    const requiredFields = proofTodo?.requiredCsvFields || (sourceTask ? requiredCsvFields(sourceTask) : []);
    const proofPath = sourceTask?.proofPath || "";
    const csvRowLabel = rejected?.index || "pending validation";
    const copyPacket = [
      `Repair action: ${sourceTask.id}`,
      `CSV row: ${csvRowLabel}`,
      `Required status: ${requiredStatus}`,
      `Proof file: ${proofPath}`,
      `Portal: ${sourceTask.portalUrl || "n/a"}`,
      sourceTask.docsUrl ? `Docs: ${sourceTask.docsUrl}` : null,
      sourceTask.redirectUri ? `Redirect URI: ${sourceTask.redirectUri}` : null,
      "",
      "Paste into proof file only after the portal action is real:",
      "Status: proof_file_filled",
      "Proof URL or secure local evidence path: <real public proof URL or local proof file inside clippers_workspace>",
      "Portal/ticket/case/profile reference: <real portal app id, ticket, case, profile or request id>",
      "Operator notes: <one clear sentence confirming the external portal action and where proof lives>",
      "",
      "Evidence CSV fields to fill:",
      ...requiredFields.map((field) => {
        if (field === "status") return `- status: ${requiredStatus}`;
        if (field === "platform") return `- platform: ${sourceTask.platform || ""}`;
        if (field === "account_id") return `- account_id: ${sourceTask.accountId || ""}`;
        if (field === "scope") return `- scope: ${sourceTask.scope || ""}`;
        if (field === "public_base_url") return `- public_base_url: ${sourceTask.redirectUri ? safeOriginFromRedirect(sourceTask.redirectUri) : ""}`;
        if (field === "redirect_uri") return `- redirect_uri: ${sourceTask.redirectUri || ""}`;
        return `- ${field}: <real ${field}>`;
      }),
      "",
      "Do not paste private credentials, browser credential values, developer app private values, OAuth private values, recovery private values, signed URLs or private screenshots.",
    ].filter(Boolean).join("\n");
    const safeReason = safeArtifactText(rejected?.reason || "Evidence import rejected this row.");
    const safeBlockers = (proofTodo?.blockers || []).map(safeArtifactText);
    return {
      rank: 0,
      csvRow: rejected?.index || null,
      id: sourceTask.id,
      source: rejected ? "evidence_import" : "operator_queue",
      lane: sourceTask.lane || rejected?.kind || "unknown",
      platform: sourceTask?.platform || "",
      requiredCsvStatus: requiredStatus,
      proofPath,
      reason: rejected ? safeReason : "Action remains in operator queue and still needs real non-secret evidence.",
      missingCsvFields: proofTodo?.missingCsvFields || [],
      blockers: safeBlockers,
      operatorAction: operatorQueueRow?.operatorAction || (sourceTask ? operatorActionFor(proofTodo || sourceTask) : "Open the evidence CSV and fix this rejected row."),
      nextStep: proofTodo?.csvEditHint || operatorQueueRow?.csvEditHint || "Fix the rejected evidence row, then run Validate again.",
      copyPacket,
    };
  });
  const unmappedRows = unmappedRejectedRows.map((rejected, index) => ({
    rank: 0,
    csvRow: rejected.index || null,
    id: `unmapped:${index + 1}`,
    source: "evidence_import",
    lane: rejected.kind || "unknown",
    platform: "",
    requiredCsvStatus: "",
    proofPath: "",
    reason: safeArtifactText(rejected.reason || "Evidence import rejected this row."),
    missingCsvFields: [],
    blockers: [],
    operatorAction: "Open the evidence CSV and fix this rejected row.",
    nextStep: "Fix the rejected evidence row, then run Validate again.",
    copyPacket: "",
  }));
  return [...repairRows, ...unmappedRows].map((row, index) => ({ ...row, rank: index + 1 }));
}

function buildGoLiveAudit(summary, artifactSafety, evidenceImport) {
  const evidenceStatus = evidenceImport?.status || "empty";
  const evidenceTotals = evidenceImport?.totals || {
    rowsScanned: 0,
    accepted: 0,
    rejected: 0,
    applied: 0,
  };
  const gates = [
    {
      id: "artifact_safety",
      label: "Generated artifacts have no sensitive token patterns",
      status: artifactSafety.status === "clean" ? "verified" : "blocked",
      blocker: artifactSafety.status === "clean" ? "" : `${artifactSafety.findings.length} sensitive artifact finding(s) must be removed.`,
    },
    {
      id: "external_actions",
      label: "All external accounts, developer apps, and permissions are closed out",
      status: summary.operatorQueue.length === 0 ? "verified" : "blocked",
      blocker: summary.operatorQueue.length === 0 ? "" : `${summary.operatorQueue.length} operator action(s) still need real portal work.`,
    },
    {
      id: "proof_files",
      label: "All proof stubs were replaced with real non-secret evidence",
      status: summary.totals.proofFilesNeedRealEvidence === 0 ? "verified" : "blocked",
      blocker: summary.totals.proofFilesNeedRealEvidence === 0 ? "" : `${summary.totals.proofFilesNeedRealEvidence} proof file(s) still need real evidence.`,
    },
    {
      id: "evidence_import",
      label: "Evidence CSV has been validated and applied",
      status: evidenceStatus === "import_applied" ? "verified" : "blocked",
      blocker: evidenceStatus === "import_applied"
        ? ""
        : `Evidence import is ${evidenceStatus}; accepted ${evidenceTotals.accepted}, rejected ${evidenceTotals.rejected}, applied ${evidenceTotals.applied}.`,
    },
    {
      id: "metricool_publish_mode",
      label: "Metricool stays approval_required with no automatic sending",
      status: summary.metricool.publishMode === "approval_required" && summary.metricool.readyToSend === 0 ? "verified" : "blocked",
      blocker: summary.metricool.publishMode === "approval_required" && summary.metricool.readyToSend === 0
        ? ""
        : `Metricool publish mode is ${summary.metricool.publishMode}; readyToSend is ${summary.metricool.readyToSend}.`,
    },
    {
      id: "direct_api_gate",
      label: "Direct API publishing is not treated as ready until accounts, apps, permissions and evidence are verified",
      status: summary.status === "ready_for_final_review" ? "verified" : "blocked",
      blocker: summary.status === "ready_for_final_review" ? "" : "Full Direct API go-live is still blocked by external actions or proof evidence.",
    },
  ];
  const blockedGates = gates.filter((gate) => gate.status !== "verified");
  const nextAction = summary.operatorQueue[0] || null;
  const workBlocks = buildCloseoutWorkBlocks(summary.operatorQueue);
  const evidenceRepairQueue = buildEvidenceRepairQueue(summary, evidenceImport);
  return {
    status: blockedGates.length === 0 ? "ready_for_final_review" : "blocked_external_actions",
    generatedAt: summary.generatedAt,
    paths: {
      json: goLiveAuditJsonPath,
      markdown: goLiveAuditMarkdownPath,
      csv: goLiveAuditCsvPath,
      closeoutPack: summary.paths.markdown,
      operatorQueue: summary.paths.operatorQueueMarkdown,
      proofTodo: summary.paths.proofTodoMarkdown,
      evidenceImport: evidenceImport?.paths?.markdown || path.join(reportsDir, "clippers-external-closeout-evidence-import-report.md"),
    },
    totals: {
      gates: gates.length,
      verified: gates.length - blockedGates.length,
      blocked: blockedGates.length,
      operatorActions: summary.operatorQueue.length,
      proofFilesNeedRealEvidence: summary.totals.proofFilesNeedRealEvidence,
      evidenceAccepted: evidenceTotals.accepted,
      evidenceRejected: evidenceTotals.rejected,
      evidenceApplied: evidenceTotals.applied,
      metricoolQueuedForApproval: summary.metricool.queuedForApproval,
      metricoolReadyToSend: summary.metricool.readyToSend,
      workBlocks: workBlocks.length,
      estimatedOperatorMinutes: workBlocks.reduce((sum, block) => sum + block.estimatedMinutes, 0),
      evidenceRepairRows: evidenceRepairQueue.length,
    },
    gates,
    workBlocks,
    evidenceRepairQueue,
    nextAction,
    nextStep: nextAction
      ? nextAction.operatorAction
      : blockedGates[0]?.blocker || "All external gates are clean. Run final browser QA before changing any publish mode.",
  };
}

function renderGoLiveAuditMarkdown(audit) {
  const gateLines = audit.gates.map((gate) => [
    `### ${gate.id}`,
    "",
    `- Status: ${gate.status}`,
    `- Gate: ${gate.label}`,
    `- Blocker: ${gate.blocker || "none"}`,
    "",
  ].join("\n"));
  const workBlockLines = audit.workBlocks.map((block) => [
    `### ${block.label}`,
    "",
    `- Status: ${block.status}`,
    `- Actions: ${block.actions}`,
    `- Estimated minutes: ${block.estimatedMinutes}`,
    `- First action: ${block.firstAction}`,
    `- Portal URLs: ${block.portalUrls.join(" | ") || "n/a"}`,
    `- Missing CSV fields: ${block.missingCsvFields.join(", ") || "none"}`,
    `- Proof files: ${block.proofPaths.slice(0, 5).join(" | ")}`,
    block.proofPaths.length > 5 ? `- More proof files: ${block.proofPaths.length - 5}` : null,
    "- Done criteria:",
    ...block.doneCriteria.map((item) => `  - ${item}`),
    "",
  ].filter(Boolean).join("\n"));
  const repairLines = audit.evidenceRepairQueue.map((row) => [
    `### ${row.rank}. ${row.id}`,
    "",
    `- CSV row: ${row.csvRow || "unknown"}`,
    `- Lane: ${row.lane}`,
    `- Platform: ${row.platform || "n/a"}`,
    `- Required status: ${row.requiredCsvStatus || "n/a"}`,
    `- Reason: ${row.reason}`,
    `- Proof file: ${row.proofPath || "n/a"}`,
    `- Missing CSV fields: ${row.missingCsvFields.join(", ") || "none"}`,
    `- Next step: ${row.nextStep}`,
    "",
    "Copy packet:",
    "```text",
    row.copyPacket || "n/a",
    "```",
    "",
  ].join("\n"));
  return [
    "# Clippers External Go-Live Audit",
    "",
    `Generated: ${audit.generatedAt}`,
    `Status: ${audit.status}`,
    "",
    "This is the compact final gate before any external publishing change. It does not enable automatic publishing.",
    "",
    "## Totals",
    "",
    `- Gates: ${audit.totals.gates}`,
    `- Verified: ${audit.totals.verified}`,
    `- Blocked: ${audit.totals.blocked}`,
    `- Operator actions: ${audit.totals.operatorActions}`,
    `- Proof files needing real evidence: ${audit.totals.proofFilesNeedRealEvidence}`,
    `- Evidence accepted/rejected/applied: ${audit.totals.evidenceAccepted}/${audit.totals.evidenceRejected}/${audit.totals.evidenceApplied}`,
    `- Metricool queued for approval: ${audit.totals.metricoolQueuedForApproval}`,
    `- Metricool ready to send: ${audit.totals.metricoolReadyToSend}`,
    `- Work blocks: ${audit.totals.workBlocks}`,
    `- Estimated operator minutes: ${audit.totals.estimatedOperatorMinutes}`,
    `- Evidence repair rows: ${audit.totals.evidenceRepairRows}`,
    "",
    "## Next Action",
    "",
    audit.nextAction
      ? `- ${audit.nextAction.id}: ${audit.nextAction.operatorAction}`
      : `- ${audit.nextStep}`,
    "",
    "## Work Blocks",
    "",
    ...(workBlockLines.length ? workBlockLines : ["- No operator work blocks remain."]),
    "",
    "## Evidence Repair Queue",
    "",
    ...(repairLines.length ? repairLines : ["- No rejected evidence rows."]),
    "",
    "## Gates",
    "",
    ...gateLines,
  ].join("\n");
}

function renderGoLiveAuditCsv(audit) {
  const header = ["kind", "id", "label", "status", "actions", "estimated_minutes", "blocker_or_next_step"];
  const rows = [
    ...audit.gates.map((gate) => [
      "gate",
      gate.id,
      gate.label,
      gate.status,
      "",
      "",
      gate.blocker,
    ]),
    ...audit.workBlocks.map((block) => [
      "work_block",
      block.id,
      block.label,
      block.status,
      block.actions,
      block.estimatedMinutes,
      block.nextStep,
    ]),
    ...audit.evidenceRepairQueue.map((row) => [
      "evidence_repair",
      row.id,
      `CSV row ${row.csvRow || "unknown"}`,
      "blocked",
      "",
      "",
      row.reason,
    ]),
  ].map((row) => row.map(csvCell).join(","));
  return `${header.join(",")}\n${rows.join("\n")}\n`;
}

function sourceAuditForPermission(officialPermissionSourceAudit, row, scope) {
  const items = officialPermissionSourceAudit?.items || [];
  return items.find((item) => item.platform === row.platform && (item.scopes || []).includes(scope)) || null;
}

function buildPortalCloseoutBoard(rows, summary) {
  const platformOrder = { instagram: 0, tiktok: 1, youtube: 2 };
  const laneOrder = { developer_app: 0, permission: 1, account: 2 };
  const grouped = new Map();
  for (const row of rows) {
    const platform = row.platform || "mixed";
    if (!grouped.has(platform)) grouped.set(platform, []);
    grouped.get(platform).push(row);
  }
  return Array.from(grouped.entries())
    .sort(([a], [b]) => (platformOrder[a] ?? 9) - (platformOrder[b] ?? 9) || a.localeCompare(b))
    .map(([platform, platformRows], index) => {
      const sortedRows = [...platformRows].sort((a, b) => (
        (laneOrder[a.lane] ?? 9) - (laneOrder[b.lane] ?? 9) ||
        a.rank - b.rank
      ));
      const sourceTasks = sortedRows
        .map((row) => summary.tasks.find((task) => task.id === row.id))
        .filter(Boolean);
      const portalUrls = Array.from(new Set(sortedRows.map((row) => row.portalUrl).filter(Boolean)));
      const docsUrls = Array.from(new Set(sortedRows.map((row) => row.docsUrl).filter(Boolean)));
      const accountIds = Array.from(new Set(sortedRows.map((row) => row.accountId).filter(Boolean)));
      const scopes = Array.from(new Set(sourceTasks.map((task) => task.scope).filter(Boolean)));
      const proofPaths = sortedRows.map((row) => row.proofPath).filter(Boolean);
      const missingCsvFields = Array.from(new Set(sortedRows.flatMap((row) => row.missingCsvFields || [])));
      const evidenceStarterRows = sourceTasks.map(evidenceRow);
      const firstRow = sortedRows[0] || null;
      return {
        rank: index + 1,
        id: `portal:${platform}`,
        platform,
        status: sortedRows.length ? "needs_operator" : "complete",
        actions: sortedRows.length,
        developerApps: sortedRows.filter((row) => row.lane === "developer_app").length,
        permissions: sortedRows.filter((row) => row.lane === "permission").length,
        accounts: sortedRows.filter((row) => row.lane === "account").length,
        critical: sortedRows.filter((row) => row.priority === "critical").length,
        high: sortedRows.filter((row) => row.priority === "high").length,
        portalUrls,
        docsUrls,
        accountIds,
        scopes,
        proofPaths,
        missingCsvFields,
        evidenceStarterRows,
        nextActionId: firstRow?.id || "",
        nextAction: firstRow?.operatorAction || "No portal actions remain for this platform.",
        checklist: [
          `Open the official ${platform} portal link before editing proof files.`,
          "Complete the portal action and save only a non-secret proof reference.",
          "Fill the matching proof file and external-closeout-evidence-import.csv starter row.",
          "Run Validate before Apply; Metricool stays approval_required with ready_to_send 0.",
        ],
      };
    });
}

function buildOperatorActionSheet(summary, audit, officialPermissionSourceAudit = null) {
  const rows = audit.evidenceRepairQueue.map((row) => {
    const task = summary.tasks.find((item) => item.id === row.id) || {};
    const block = audit.workBlocks.find((item) => item.lane === row.lane) || null;
    return {
      rank: row.rank,
      id: row.id,
      lane: row.lane,
      block: block?.label || row.lane,
      priority: task.priority || "high",
      platform: row.platform || task.platform || "",
      accountId: task.accountId || "",
      requiredStatus: row.requiredCsvStatus,
      portalUrl: task.portalUrl || "",
      docsUrl: task.docsUrl || "",
      redirectUri: task.redirectUri || "",
      proofPath: row.proofPath,
      missingCsvFields: row.missingCsvFields,
      blockers: row.blockers,
      operatorAction: row.operatorAction,
      nextStep: row.nextStep,
      copyPacket: row.copyPacket,
    };
  });
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const sessionRows = summary.operatorQueue
    .slice(0, 5)
    .map((queueRow) => rowById.get(queueRow.id) || null)
    .filter(Boolean);
  const workSession = {
    status: sessionRows.length ? "needs_operator" : "complete",
    label: "Next 45-minute closeout work run",
    targetMinutes: 45,
    actions: sessionRows.length,
    evidenceCsvPath: summary.paths.evidenceCsv,
    validateCommand: "npm run clippers:import-external-closeout-evidence",
    applyReadyCommand: "npm run clippers:import-external-closeout-evidence -- --apply-ready",
    steps: [
      "Open each official portal and complete only the real external action.",
      "Fill the matching proof markdown with non-secret proof references.",
      "Update external-closeout-evidence-import.csv for only rows with real proof.",
      "Run Validate, then Apply ready rows if at least one row is accepted.",
    ],
    rows: sessionRows.map((row, index) => ({
      order: index + 1,
      id: row.id,
      lane: row.lane,
      platform: row.platform,
      requiredStatus: row.requiredStatus,
      portalUrl: row.portalUrl,
      docsUrl: row.docsUrl,
      redirectUri: row.redirectUri,
      proofPath: row.proofPath,
      missingCsvFields: row.missingCsvFields,
      operatorAction: row.operatorAction,
      nextStep: row.nextStep,
      copyPacket: row.copyPacket,
    })),
    guardrails: [
      "Keep platform private values, browser state data, login details, and private screenshots outside this repo.",
      "Do not mark approved/requested/verified until the portal action is actually done.",
      "Apply ready rows may import valid rows while rejected rows remain blocked.",
    ],
  };
  const permissionRequestCards = rows
    .filter((row) => row.lane === "permission")
    .map((row) => ({
      id: row.id,
      platform: row.platform,
      scope: row.requiredStatus ? summary.tasks.find((task) => task.id === row.id)?.scope || "" : "",
      requiredStatus: row.requiredStatus,
      portalUrl: row.portalUrl,
      docsUrl: row.docsUrl,
      prerequisite: row.platform === "youtube"
        ? "Google Cloud OAuth app and YouTube Data API enabled."
        : row.platform === "instagram"
          ? "Meta app plus Instagram/Facebook asset connected in Business settings."
          : row.platform === "tiktok"
            ? "TikTok developer app with public redirect URI and content posting product access."
            : "Developer app and platform account connected.",
      useCase: "Publish owned, licensed, or permissioned short-form clips through an approval_required workflow. No automatic publishing is enabled until Robert explicitly approves.",
      evidenceNeeded: [
        "Portal request or approval URL/ticket.",
        "Screenshot/proof path without private screenshots or credentials.",
        "Reviewer note confirming owned/permissioned content and approval_required publishing.",
      ],
      copyNote: [
        `Request ${row.platform} permission ${summary.tasks.find((task) => task.id === row.id)?.scope || row.id}.`,
        "Use case: owned or permissioned short-form clips, scheduled through Metricool approval_required.",
        "Evidence: save request/approval ticket and proof path, without credentials or private values.",
      ].join(" "),
      proofPath: row.proofPath,
      nextStep: row.operatorAction,
    }));
  const officialSourceCards = permissionRequestCards.map((card) => {
    const sourceAudit = sourceAuditForPermission(officialPermissionSourceAudit, card, card.scope);
    const officialUrls = safeSourceCardList(sourceAudit?.officialUrls || [card.docsUrl].filter(Boolean));
    const primaryOfficialUrl = officialUrls[0] || "";
    const sourceStatus = safeSourceCardField(sourceAudit?.sourceStatus, card.docsUrl ? "source_url_available" : "needs_source_check");
    const accessMode = safeSourceCardField(sourceAudit?.accessMode, card.platform === "instagram" ? "login_required" : "public");
    const submitDecision = safeSourceCardField(sourceAudit?.submitDecision, "recheck_before_request");
    const claims = (sourceAudit?.verifiedClaims || []).map((item) => safeSourceCardField(item));
    const reviewerEvidence = (sourceAudit?.reviewerEvidence || [
      "Open the official platform source and capture a non-private proof reference.",
      "Confirm the requested scope exists for this app/account before submitting.",
      "Attach approval_required demo evidence and rights-gate evidence.",
    ]).map((item) => safeSourceCardField(item));
    const recheckSteps = (sourceAudit?.recheckSteps || [
      "Open the official docs or developer portal.",
      "Confirm the scope name and product requirement.",
      "Save the non-private proof reference in the closeout proof file.",
    ]).map((item) => safeSourceCardField(item));
    return {
      id: `official_source:${card.platform}:${card.scope}`,
      platform: card.platform,
      scope: card.scope,
      sourceStatus,
      accessMode,
      submitDecision,
      officialUrls,
      primaryOfficialUrl,
      requestPortalUrl: safeSourceCardField(card.portalUrl),
      permissionProofPath: card.proofPath,
      sourceAuditPath: safeSourceCardField(officialPermissionSourceAudit?.markdownPath),
      verifiedClaims: claims,
      reviewerEvidence,
      recheckSteps,
      nextStep: accessMode === "login_required"
        ? "Human login recheck required in the official developer portal before importing requested evidence."
        : "Open the official docs, attach the source proof pack, then import requested evidence after the portal action.",
    };
  });
  const accountSetupCards = rows
    .filter((row) => row.lane === "account")
    .map((row) => {
      const expectedHandle = row.accountId
        ? row.platform === "youtube"
          ? `@${row.accountId.replace(/-/g, "")}`
          : `@${row.accountId.replace(/-/g, ".")}`
        : "";
      return {
        id: row.id,
        accountId: row.accountId,
        platform: row.platform,
        requiredStatus: row.requiredStatus,
        portalUrl: row.portalUrl,
        expectedHandle,
        metricoolBridgeNeeded: row.accountId === "sports-daily" || row.accountId === "meme-radar",
        evidenceNeeded: [
          "Public profile/channel URL.",
          "Ownership or manager proof reference without private screenshots.",
          "2FA/recovery method proof reference without recovery values.",
          ...(row.accountId === "sports-daily" || row.accountId === "meme-radar" ? ["Metricool connected-profile proof for the MVP publishing bridge."] : []),
        ],
        copyNote: [
          `Create or verify ${row.platform} account for ${row.accountId}.`,
          expectedHandle ? `Expected handle hint: ${expectedHandle}.` : "",
          "Record public profile URL, owner/manager proof, and Metricool connected-profile proof when required.",
          "Do not store login credentials, recovery values, cookies, or private screenshots.",
        ].filter(Boolean).join(" "),
        proofPath: row.proofPath,
        nextStep: row.operatorAction,
      };
    });
  const developerAppCards = rows
    .filter((row) => row.lane === "developer_app")
    .map((row) => {
      const task = summary.tasks.find((item) => item.id === row.id) || {};
      return {
        id: row.id,
        platform: row.platform,
        requiredStatus: row.requiredStatus,
        portalUrl: row.portalUrl,
        redirectUri: row.redirectUri,
        publicBaseUrl: row.redirectUri ? safeOriginFromRedirect(row.redirectUri) : "",
        missingEnvVars: task.missingEnvVars || [],
        appIdentifierField: row.platform === "youtube" ? "GOOGLE_CLIENT_ID / OAuth client id" : row.platform === "instagram" ? "META_APP_ID" : "TIKTOK_CLIENT_KEY / app id",
        appReviewUseCase: "Short-form clipping workspace for owned, licensed, or permissioned content. Publishing remains approval_required through Metricool until Robert explicitly enables any real posting.",
        evidenceNeeded: [
          "Developer app id/client key/project id.",
          "Public redirect URI registered in the platform portal.",
          "Portal app review/request URL or ticket.",
          "Proof path without private screenshots, app private values, or credentials.",
        ],
        copyNote: [
          `Create ${row.platform} developer app.`,
          row.redirectUri ? `Register redirect URI ${row.redirectUri}.` : "",
          "Use case: owned/permissioned short-form clips with approval_required publishing.",
          "Record only public identifiers and proof paths; keep app private values out of artifacts.",
        ].filter(Boolean).join(" "),
        proofPath: row.proofPath,
        nextStep: row.operatorAction,
      };
    });
  const blocks = audit.workBlocks.map((block) => ({
    id: block.id,
    label: block.label,
    lane: block.lane,
    actions: rows.filter((row) => row.lane === block.lane).length,
    estimatedMinutes: block.estimatedMinutes,
    firstActionId: block.firstActionId,
    portalUrls: block.portalUrls,
    missingCsvFields: block.missingCsvFields,
    doneCriteria: block.doneCriteria,
    nextStep: block.nextStep,
  }));
  const portalCloseoutBoard = buildPortalCloseoutBoard(rows, summary);
  return {
    status: rows.length ? "needs_operator" : "complete",
    generatedAt: summary.generatedAt,
    paths: {
      json: actionSheetJsonPath,
      markdown: actionSheetMarkdownPath,
      csv: actionSheetCsvPath,
      evidenceCsv: summary.paths.evidenceCsv,
      proofDir: summary.paths.proofDir,
      goLiveAudit: summary.paths.goLiveAuditMarkdown,
    },
    totals: {
      rows: rows.length,
      critical: rows.filter((row) => row.priority === "critical").length,
      high: rows.filter((row) => row.priority === "high").length,
      developerApps: rows.filter((row) => row.lane === "developer_app").length,
      permissions: rows.filter((row) => row.lane === "permission").length,
      accounts: rows.filter((row) => row.lane === "account").length,
      estimatedMinutes: audit.totals.estimatedOperatorMinutes,
    },
    nextAction: summary.operatorQueue[0] || rows[0] || null,
    blocks,
    accountSetupCards,
    developerAppCards,
    permissionRequestCards,
    officialSourceCards,
    portalCloseoutBoard,
    workSession,
    rows,
    guardrails: [
      "Do the portal action first; only then paste proof into the proof file and evidence CSV.",
      "Do not store passwords, cookies, recovery codes, OAuth private values, developer app private values, or signed private URLs.",
      "Metricool remains approval_required; this sheet does not enable automatic publishing.",
    ],
  };
}

function renderActionSheetMarkdown(sheet) {
  const workSessionLines = sheet.workSession && sheet.workSession.rows ? [
    "## Next Work Run",
    "",
    `- Status: ${sheet.workSession.status}`,
    `- Label: ${sheet.workSession.label}`,
    `- Target minutes: ${sheet.workSession.targetMinutes}`,
    `- Actions: ${sheet.workSession.actions}`,
    `- Evidence CSV: ${sheet.workSession.evidenceCsvPath}`,
    `- Validate: ${sheet.workSession.validateCommand}`,
    `- Apply ready: ${sheet.workSession.applyReadyCommand}`,
    "",
    "Steps:",
    ...sheet.workSession.steps.map((item) => `- [ ] ${item}`),
    "",
    "Guardrails:",
    ...sheet.workSession.guardrails.map((item) => `- ${item}`),
    "",
    "Rows:",
    ...sheet.workSession.rows.flatMap((row) => [
      `### ${row.order}. ${row.id}`,
      "",
      `- Lane: ${row.lane}`,
      `- Platform: ${row.platform || "n/a"}`,
      `- Required status: ${row.requiredStatus || "n/a"}`,
      `- Portal: ${row.portalUrl || "n/a"}`,
      row.docsUrl ? `- Docs: ${row.docsUrl}` : null,
      row.redirectUri ? `- Redirect URI: ${row.redirectUri}` : null,
      `- Proof file: ${row.proofPath || "n/a"}`,
      `- Missing CSV fields: ${row.missingCsvFields.join(", ") || "none"}`,
      `- Operator action: ${row.operatorAction}`,
      "",
      "Copy packet:",
      "```text",
      row.copyPacket || "n/a",
      "```",
      "",
    ].filter(Boolean)),
    "",
  ] : [];
  const blockLines = sheet.blocks.map((block) => [
    `### ${block.label}`,
    "",
    `- Actions: ${block.actions}`,
    `- Estimated minutes: ${block.estimatedMinutes}`,
    `- First action: ${block.firstActionId || "none"}`,
    `- Portal URLs: ${block.portalUrls.join(" | ") || "n/a"}`,
    `- Missing CSV fields: ${block.missingCsvFields.join(", ") || "none"}`,
    `- Next step: ${block.nextStep}`,
    "",
  ].join("\n"));
  const portalBoardLines = (sheet.portalCloseoutBoard || []).map((card) => [
    `### ${card.rank}. ${card.platform}`,
    "",
    `- Status: ${card.status}`,
    `- Actions: ${card.actions}`,
    `- Developer apps / permissions / accounts: ${card.developerApps}/${card.permissions}/${card.accounts}`,
    `- Critical / high: ${card.critical}/${card.high}`,
    `- Portal URLs: ${card.portalUrls.join(" | ") || "n/a"}`,
    `- Docs URLs: ${card.docsUrls.join(" | ") || "n/a"}`,
    `- Accounts: ${card.accountIds.join(", ") || "n/a"}`,
    `- Scopes: ${card.scopes.join(", ") || "n/a"}`,
    `- Missing CSV fields: ${card.missingCsvFields.join(", ") || "none"}`,
    `- Next action: ${card.nextActionId || "none"} - ${card.nextAction}`,
    "",
    "Checklist:",
    ...card.checklist.map((item) => `- [ ] ${item}`),
    "",
    "Proof files:",
    ...(card.proofPaths.length ? card.proofPaths.map((item) => `- ${item}`) : ["- n/a"]),
    "",
    "Evidence starter rows:",
    "```csv",
    ...card.evidenceStarterRows,
    "```",
    "",
  ].join("\n"));
  const rowLines = sheet.rows.map((row) => [
    `### ${row.rank}. ${row.id}`,
    "",
    `- Lane: ${row.lane}`,
    `- Priority: ${row.priority}`,
    `- Platform: ${row.platform || "n/a"}`,
    `- Required status: ${row.requiredStatus || "n/a"}`,
    `- Portal: ${row.portalUrl || "n/a"}`,
    row.docsUrl ? `- Docs: ${row.docsUrl}` : null,
    row.redirectUri ? `- Redirect URI: ${row.redirectUri}` : null,
    `- Proof file: ${row.proofPath || "n/a"}`,
    `- Missing CSV fields: ${row.missingCsvFields.join(", ") || "none"}`,
    `- Operator action: ${row.operatorAction}`,
    `- Next step: ${row.nextStep}`,
    "",
    "Copy packet:",
    "```text",
    row.copyPacket || "n/a",
    "```",
    "",
  ].filter(Boolean).join("\n"));
  const permissionLines = sheet.permissionRequestCards.map((card) => [
    `### ${card.platform}: ${card.scope}`,
    "",
    `- Required status: ${card.requiredStatus}`,
    `- Portal: ${card.portalUrl || "n/a"}`,
    `- Docs: ${card.docsUrl || "n/a"}`,
    `- Prerequisite: ${card.prerequisite}`,
    `- Proof file: ${card.proofPath}`,
    `- Next step: ${card.nextStep}`,
    "",
    "Review note:",
    "```text",
    card.copyNote,
    "```",
    "",
    "Evidence needed:",
    ...card.evidenceNeeded.map((item) => `- ${item}`),
    "",
  ].join("\n"));
  const officialSourceLines = sheet.officialSourceCards.map((card) => [
    `### ${card.platform}: ${card.scope}`,
    "",
    `- Source status: ${card.sourceStatus}`,
    `- Access mode: ${card.accessMode}`,
    `- Submit decision: ${card.submitDecision}`,
    `- Primary official URL: ${card.primaryOfficialUrl || "n/a"}`,
    `- Request portal: ${card.requestPortalUrl || "n/a"}`,
    `- Permission proof file: ${card.permissionProofPath}`,
    card.sourceAuditPath ? `- Source audit: ${card.sourceAuditPath}` : null,
    `- Next step: ${card.nextStep}`,
    "",
    "Official URLs:",
    ...(card.officialUrls.length ? card.officialUrls.map((item) => `- ${item}`) : ["- n/a"]),
    "",
    "Verified claims:",
    ...(card.verifiedClaims.length ? card.verifiedClaims.map((item) => `- ${item}`) : ["- Recheck required in official portal."]),
    "",
    "Reviewer evidence:",
    ...card.reviewerEvidence.map((item) => `- ${item}`),
    "",
    "Recheck steps:",
    ...card.recheckSteps.map((item) => `- ${item}`),
    "",
  ].filter(Boolean).join("\n"));
  const accountLines = sheet.accountSetupCards.map((card) => [
    `### ${card.accountId}: ${card.platform}`,
    "",
    `- Required status: ${card.requiredStatus}`,
    `- Portal: ${card.portalUrl || "n/a"}`,
    `- Expected handle hint: ${card.expectedHandle || "n/a"}`,
    `- Metricool bridge proof needed: ${card.metricoolBridgeNeeded ? "yes" : "not for MVP"}`,
    `- Proof file: ${card.proofPath}`,
    `- Next step: ${card.nextStep}`,
    "",
    "Setup note:",
    "```text",
    card.copyNote,
    "```",
    "",
    "Evidence needed:",
    ...card.evidenceNeeded.map((item) => `- ${item}`),
    "",
  ].join("\n"));
  const developerAppLines = sheet.developerAppCards.map((card) => [
    `### ${card.platform}`,
    "",
    `- Required status: ${card.requiredStatus}`,
    `- Portal: ${card.portalUrl || "n/a"}`,
    `- Public base URL: ${card.publicBaseUrl || "n/a"}`,
    `- Redirect URI: ${card.redirectUri || "n/a"}`,
    `- App identifier field: ${card.appIdentifierField}`,
    `- Missing env vars: ${card.missingEnvVars.join(", ") || "none"}`,
    `- Proof file: ${card.proofPath}`,
    `- Next step: ${card.nextStep}`,
    "",
    "App review use case:",
    "```text",
    card.appReviewUseCase,
    "```",
    "",
    "Setup note:",
    "```text",
    card.copyNote,
    "```",
    "",
    "Evidence needed:",
    ...card.evidenceNeeded.map((item) => `- ${item}`),
    "",
  ].join("\n"));
  return [
    "# Clippers External Operator Action Sheet",
    "",
    `Generated: ${sheet.generatedAt}`,
    `Status: ${sheet.status}`,
    "",
    "This is the working sheet for the remaining external portal actions. It is not publishing approval.",
    "",
    "## Totals",
    "",
    `- Rows: ${sheet.totals.rows}`,
    `- Critical: ${sheet.totals.critical}`,
    `- Developer apps: ${sheet.totals.developerApps}`,
    `- Permissions: ${sheet.totals.permissions}`,
    `- Accounts: ${sheet.totals.accounts}`,
    `- Estimated minutes: ${sheet.totals.estimatedMinutes}`,
    "",
    "## Guardrails",
    "",
    ...sheet.guardrails.map((item) => `- ${item}`),
    "",
    ...workSessionLines,
    "## Blocks",
    "",
    ...(blockLines.length ? blockLines : ["- No operator blocks remain."]),
    "",
    "## Portal Closeout Board",
    "",
    ...(portalBoardLines.length ? portalBoardLines : ["- No portal closeout actions remain."]),
    "",
    "## Account Setup Cards",
    "",
    ...(accountLines.length ? accountLines : ["- No account setup actions remain."]),
    "",
    "## Developer App Cards",
    "",
    ...(developerAppLines.length ? developerAppLines : ["- No developer app actions remain."]),
    "",
    "## Permission Request Cards",
    "",
    ...(permissionLines.length ? permissionLines : ["- No permission requests remain."]),
    "",
    "## Official Permission Source Cards",
    "",
    ...(officialSourceLines.length ? officialSourceLines : ["- No official permission source checks remain."]),
    "",
    "## Rows",
    "",
    ...(rowLines.length ? rowLines : ["- No operator actions remain."]),
    "",
  ].join("\n");
}

function renderActionSheetCsv(sheet) {
  const header = ["rank", "id", "lane", "priority", "platform", "required_status", "portal_url", "docs_url", "redirect_uri", "proof_path", "missing_csv_fields", "operator_action", "next_step"];
  const rows = sheet.rows.map((row) => [
    row.rank,
    row.id,
    row.lane,
    row.priority,
    row.platform,
    row.requiredStatus,
    row.portalUrl,
    row.docsUrl,
    row.redirectUri,
    row.proofPath,
    row.missingCsvFields.join("|"),
    row.operatorAction,
    row.nextStep,
  ].map(csvCell).join(","));
  return `${header.join(",")}\n${rows.join("\n")}\n`;
}

function renderWorkRunMarkdown(workRun) {
  const portalSessionLines = (workRun.portalSessions || []).map((session) => [
    `### ${session.platform}`,
    "",
    `- Actions: ${session.actions}`,
    `- Portal: ${session.portalUrl || "n/a"}`,
    session.docsUrl ? `- Docs: ${session.docsUrl}` : null,
    `- Missing CSV fields: ${session.missingCsvFields.join(", ") || "none"}`,
    "",
    "Proof files:",
    ...(session.proofPaths.length ? session.proofPaths.map((item) => `- ${item}`) : ["- n/a"]),
    "",
    "Evidence starter rows:",
    "```csv",
    ...session.evidenceStarterRows,
    "```",
    "",
    "Copy packet:",
    "```text",
    session.copyPacket || "n/a",
    "```",
    "",
  ].filter(Boolean).join("\n"));
  const rowLines = workRun.rows.map((row) => [
    `### ${row.order}. ${row.id}`,
    "",
    `- Lane: ${row.lane}`,
    `- Platform: ${row.platform || "n/a"}`,
    `- Required status: ${row.requiredStatus || "n/a"}`,
    `- Portal: ${row.portalUrl || "n/a"}`,
    row.docsUrl ? `- Docs: ${row.docsUrl}` : null,
    row.redirectUri ? `- Redirect URI: ${row.redirectUri}` : null,
    `- Proof file: ${row.proofPath || "n/a"}`,
    `- Missing CSV fields: ${row.missingCsvFields.join(", ") || "none"}`,
    `- Operator action: ${row.operatorAction}`,
    `- Next step: ${row.nextStep}`,
    "",
    "Copy packet:",
    "```text",
    row.copyPacket || "n/a",
    "```",
    "",
  ].filter(Boolean).join("\n"));
  return [
    "# Clippers External Next Work Run",
    "",
    `Generated: ${workRun.generatedAt}`,
    `Status: ${workRun.status}`,
    `Label: ${workRun.label}`,
    `Target minutes: ${workRun.targetMinutes}`,
    `Actions: ${workRun.actions}`,
    "",
    "## Commands",
    "",
    `- Validate: ${workRun.validateCommand}`,
    `- Apply ready: ${workRun.applyReadyCommand}`,
    `- Evidence CSV: ${workRun.evidenceCsvPath}`,
    "",
    "## Steps",
    "",
    ...workRun.steps.map((item) => `- [ ] ${item}`),
    "",
    "## Guardrails",
    "",
    ...workRun.guardrails.map((item) => `- ${item}`),
    "",
    "## Portal Sessions",
    "",
    ...(portalSessionLines.length ? portalSessionLines : ["- No portal sessions remain."]),
    "",
    "## Rows",
    "",
    ...(rowLines.length ? rowLines : ["- No operator actions remain."]),
    "",
  ].join("\n");
}

function renderWorkRunCsv(workRun) {
  const header = ["order", "id", "lane", "platform", "required_status", "portal_url", "docs_url", "redirect_uri", "proof_path", "missing_csv_fields", "operator_action", "next_step", "copy_packet"];
  const rows = workRun.rows.map((row) => [
    row.order,
    row.id,
    row.lane,
    row.platform,
    row.requiredStatus,
    row.portalUrl,
    row.docsUrl || "",
    row.redirectUri || "",
    row.proofPath,
    row.missingCsvFields.join("|"),
    row.operatorAction,
    row.nextStep,
    row.copyPacket || "",
  ].map(csvCell).join(","));
  return `${header.join(",")}\n${rows.join("\n")}\n`;
}

function buildWorkRunPortalSessions(workRun, tasks) {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const groups = new Map();
  for (const row of workRun.rows || []) {
    const platform = row.platform || "all";
    const key = `${platform}:${row.portalUrl || ""}`;
    const group = groups.get(key) || {
      platform,
      portalUrl: row.portalUrl || "",
      docsUrl: row.docsUrl || "",
      rows: [],
      proofPaths: [],
      missingCsvFields: new Set(),
      evidenceStarterRows: [],
    };
    const task = taskById.get(row.id);
    group.rows.push(row);
    if (row.proofPath) group.proofPaths.push(row.proofPath);
    for (const field of row.missingCsvFields || []) group.missingCsvFields.add(field);
    if (task) group.evidenceStarterRows.push(evidenceRow(task));
    groups.set(key, group);
  }
  return Array.from(groups.values()).map((group, index) => ({
    rank: index + 1,
    id: `portal:${group.platform}:${index + 1}`,
    platform: group.platform,
    portalUrl: group.portalUrl,
    docsUrl: group.docsUrl,
    actions: group.rows.length,
    rowIds: group.rows.map((row) => row.id),
    proofPaths: Array.from(new Set(group.proofPaths)),
    missingCsvFields: Array.from(group.missingCsvFields),
    evidenceStarterRows: group.evidenceStarterRows,
    copyPacket: group.rows.map((row) => row.copyPacket).filter(Boolean).join("\n\n---\n\n"),
    nextStep: group.rows[0]?.operatorAction || "No portal actions remain for this session.",
  }));
}

async function main() {
  await mkdir(reportsDir, { recursive: true });
  await mkdir(path.dirname(evidenceCsvPath), { recursive: true });
  await runJsonScript("script/clippers-operational-readiness.mjs", "Operational readiness", nestedJsonScriptTimeoutMs);
  const accountReadiness = await readJson(accountReadinessPath);
  const operationalReadiness = await readJson(operationalReadinessPath);
  const evidenceImport = await readJsonOptional(evidenceImportReportPath);
  const officialPermissionSourceAudit = await readJsonOptional(officialPermissionSourceAuditPath);
  const publicBaseUrl = await readStoredPublicBaseUrl();
  const accountTasks = accountReadiness.accountRows.filter((row) => row.accountStatus !== "verified").map(accountTask);
  const developerTasks = accountReadiness.developerRows.filter((row) => row.status !== "approved").map((row) => developerTask(row, publicBaseUrl));
  const permissionTaskRows = accountReadiness.permissionRows.filter((row) => row.status !== "approved").flatMap(permissionTasks);
  const tasks = await writeProofStubs([...accountTasks, ...developerTasks, ...permissionTaskRows]);
  const proofTodo = tasks.map(proofTodoRow);
  const operatorQueue = buildOperatorQueue(proofTodo);
  const safeOperationalBlockers = (operationalReadiness.blockers || []).filter((blocker) => !String(blocker).includes("Local app is not listening"));
  const blocked = tasks.length > 0 || safeOperationalBlockers.length > 0;
  const summary = {
    status: blocked ? "blocked_external_actions" : "ready_for_final_review",
    generatedAt: new Date().toISOString(),
    paths: {
      json: outJsonPath,
      markdown: outMarkdownPath,
      csv: outCsvPath,
      proofTodoJson: proofTodoJsonPath,
      proofTodoMarkdown: proofTodoMarkdownPath,
      proofTodoCsv: proofTodoCsvPath,
      operatorQueueJson: operatorQueueJsonPath,
      operatorQueueMarkdown: operatorQueueMarkdownPath,
      operatorQueueCsv: operatorQueueCsvPath,
      goLiveAuditJson: goLiveAuditJsonPath,
      goLiveAuditMarkdown: goLiveAuditMarkdownPath,
      goLiveAuditCsv: goLiveAuditCsvPath,
      actionSheetJson: actionSheetJsonPath,
      actionSheetMarkdown: actionSheetMarkdownPath,
      actionSheetCsv: actionSheetCsvPath,
      nextWorkRunJson: nextWorkRunJsonPath,
      nextWorkRunMarkdown: nextWorkRunMarkdownPath,
      nextWorkRunCsv: nextWorkRunCsvPath,
      evidenceCsv: evidenceCsvPath,
      proofDir,
    },
    blockers: safeOperationalBlockers,
    metricool: {
      queuedForApproval: operationalReadiness.metricool?.queuedForApproval || 0,
      readyToSend: operationalReadiness.metricool?.readyToSend || 0,
      publishMode: operationalReadiness.metricool?.publishMode || "unknown",
    },
    totals: {
      tasks: tasks.length,
      critical: tasks.filter((task) => task.priority === "critical").length,
      high: tasks.filter((task) => task.priority === "high").length,
      accounts: accountTasks.length,
      developerApps: developerTasks.length,
      permissions: permissionTaskRows.length,
      proofFilesNeedRealEvidence: tasks.filter((task) => task.proofStatus === "needs_real_proof").length,
      proofFilesFilled: tasks.filter((task) => task.proofStatus === "proof_file_filled").length,
    },
    tasks,
    proofTodo,
    operatorQueue,
    nextStep: blocked
      ? "Complete these external portal actions, replace proof stubs with real non-secret evidence, then validate the evidence import gate."
      : "Run final browser QA and keep Metricool approval_required until Robert explicitly enables real publishing.",
  };
  const closeoutMarkdown = renderMarkdown(summary);
  const closeoutCsv = renderTaskCsv(summary);
  const proofTodoJson = JSON.stringify({
    generatedAt: summary.generatedAt,
    status: summary.status,
    paths: summary.paths,
    totals: summary.totals,
    rows: summary.proofTodo,
    operatorQueue: summary.operatorQueue,
  }, null, 2);
  const proofTodoMarkdown = renderProofTodoMarkdown(summary);
  const proofTodoCsv = renderProofTodoCsv(summary);
  const operatorQueueJson = JSON.stringify({
    generatedAt: summary.generatedAt,
    status: summary.status,
    paths: summary.paths,
    totals: {
      rows: summary.operatorQueue.length,
      critical: summary.operatorQueue.filter((row) => row.priority === "critical").length,
      high: summary.operatorQueue.filter((row) => row.priority === "high").length,
    },
    rows: summary.operatorQueue,
    nextStep: summary.operatorQueue[0]?.operatorAction || summary.nextStep,
  }, null, 2);
  const operatorQueueMarkdown = renderOperatorQueueMarkdown(summary);
  const operatorQueueCsv = renderOperatorQueueCsv(summary);
  const evidenceCsv = renderEvidenceCsv(summary);
  const preliminaryAudit = buildGoLiveAudit(summary, { status: "clean", scanned: 0, findings: [] }, evidenceImport);
  const preliminaryAuditMarkdown = renderGoLiveAuditMarkdown(preliminaryAudit);
  const preliminaryAuditCsv = renderGoLiveAuditCsv(preliminaryAudit);
  const preliminaryAuditJson = JSON.stringify(preliminaryAudit, null, 2);
  const preliminaryActionSheet = buildOperatorActionSheet(summary, preliminaryAudit, officialPermissionSourceAudit);
  const preliminaryActionSheetJson = JSON.stringify(preliminaryActionSheet, null, 2);
  const preliminaryActionSheetMarkdown = renderActionSheetMarkdown(preliminaryActionSheet);
  const preliminaryActionSheetCsv = renderActionSheetCsv(preliminaryActionSheet);
  const preliminaryWorkRunBase = { ...preliminaryActionSheet.workSession, generatedAt: summary.generatedAt, paths: { json: nextWorkRunJsonPath, markdown: nextWorkRunMarkdownPath, csv: nextWorkRunCsvPath } };
  const preliminaryWorkRun = { ...preliminaryWorkRunBase, portalSessions: buildWorkRunPortalSessions(preliminaryWorkRunBase, summary.tasks) };
  const preliminaryWorkRunJson = JSON.stringify(preliminaryWorkRun, null, 2);
  const preliminaryWorkRunMarkdown = renderWorkRunMarkdown(preliminaryWorkRun);
  const preliminaryWorkRunCsv = renderWorkRunCsv(preliminaryWorkRun);
  const artifactSafety = {
    status: "clean",
    scanned: 18,
    findings: artifactSafetyFindings([
      { path: outMarkdownPath, content: closeoutMarkdown },
      { path: outCsvPath, content: closeoutCsv },
      { path: proofTodoJsonPath, content: proofTodoJson },
      { path: proofTodoMarkdownPath, content: proofTodoMarkdown },
      { path: proofTodoCsvPath, content: proofTodoCsv },
      { path: operatorQueueJsonPath, content: operatorQueueJson },
      { path: operatorQueueMarkdownPath, content: operatorQueueMarkdown },
      { path: operatorQueueCsvPath, content: operatorQueueCsv },
      { path: goLiveAuditJsonPath, content: preliminaryAuditJson },
      { path: goLiveAuditMarkdownPath, content: preliminaryAuditMarkdown },
      { path: goLiveAuditCsvPath, content: preliminaryAuditCsv },
      { path: actionSheetJsonPath, content: preliminaryActionSheetJson },
      { path: actionSheetMarkdownPath, content: preliminaryActionSheetMarkdown },
      { path: actionSheetCsvPath, content: preliminaryActionSheetCsv },
      { path: nextWorkRunJsonPath, content: preliminaryWorkRunJson },
      { path: nextWorkRunMarkdownPath, content: preliminaryWorkRunMarkdown },
      { path: nextWorkRunCsvPath, content: preliminaryWorkRunCsv },
      { path: evidenceCsvPath, content: evidenceCsv },
    ]),
  };
  artifactSafety.status = artifactSafety.findings.length ? "blocked_sensitive_artifact" : "clean";
  const preliminarySummaryJson = JSON.stringify({ ...summary, artifactSafety }, null, 2);
  artifactSafety.findings = [
    ...artifactSafety.findings,
    ...artifactSafetyFindings([{ path: outJsonPath, content: preliminarySummaryJson }]),
  ];
  artifactSafety.scanned = 19;
  artifactSafety.status = artifactSafety.findings.length ? "blocked_sensitive_artifact" : "clean";
  const goLiveAudit = buildGoLiveAudit(summary, artifactSafety, evidenceImport);
  const actionSheet = buildOperatorActionSheet(summary, goLiveAudit, officialPermissionSourceAudit);
  const nextWorkRunBase = { ...actionSheet.workSession, generatedAt: summary.generatedAt, paths: { json: nextWorkRunJsonPath, markdown: nextWorkRunMarkdownPath, csv: nextWorkRunCsvPath } };
  const nextWorkRun = { ...nextWorkRunBase, portalSessions: buildWorkRunPortalSessions(nextWorkRunBase, summary.tasks) };
  const finalSummary = { ...summary, artifactSafety, goLiveAudit, actionSheet, nextWorkRun };
  await writeFile(outJsonPath, JSON.stringify(finalSummary, null, 2));
  await writeFile(outMarkdownPath, closeoutMarkdown);
  await writeFile(outCsvPath, closeoutCsv);
  await writeFile(proofTodoJsonPath, JSON.stringify({
    ...JSON.parse(proofTodoJson),
    artifactSafety,
  }, null, 2));
  await writeFile(proofTodoMarkdownPath, proofTodoMarkdown);
  await writeFile(proofTodoCsvPath, proofTodoCsv);
  await writeFile(operatorQueueJsonPath, JSON.stringify({
    ...JSON.parse(operatorQueueJson),
    artifactSafety,
  }, null, 2));
  await writeFile(operatorQueueMarkdownPath, operatorQueueMarkdown);
  await writeFile(operatorQueueCsvPath, operatorQueueCsv);
  await writeFile(goLiveAuditJsonPath, JSON.stringify(goLiveAudit, null, 2));
  await writeFile(goLiveAuditMarkdownPath, renderGoLiveAuditMarkdown(goLiveAudit));
  await writeFile(goLiveAuditCsvPath, renderGoLiveAuditCsv(goLiveAudit));
  await writeFile(actionSheetJsonPath, JSON.stringify(actionSheet, null, 2));
  await writeFile(actionSheetMarkdownPath, renderActionSheetMarkdown(actionSheet));
  await writeFile(actionSheetCsvPath, renderActionSheetCsv(actionSheet));
  await writeFile(nextWorkRunJsonPath, JSON.stringify(nextWorkRun, null, 2));
  await writeFile(nextWorkRunMarkdownPath, renderWorkRunMarkdown(nextWorkRun));
  await writeFile(nextWorkRunCsvPath, renderWorkRunCsv(nextWorkRun));
  await writeFile(evidenceCsvPath, evidenceCsv);
  console.log(JSON.stringify({
    status: summary.status,
    goLiveAuditStatus: goLiveAudit.status,
    goLiveAuditBlockedGates: goLiveAudit.totals.blocked,
    tasks: summary.totals.tasks,
    critical: summary.totals.critical,
    high: summary.totals.high,
    accounts: summary.totals.accounts,
    developerApps: summary.totals.developerApps,
    permissions: summary.totals.permissions,
    proofFilesNeedRealEvidence: summary.totals.proofFilesNeedRealEvidence,
    reportPath: outMarkdownPath,
    proofTodoPath: proofTodoMarkdownPath,
    operatorQueuePath: operatorQueueMarkdownPath,
    goLiveAuditPath: goLiveAuditMarkdownPath,
    actionSheetPath: actionSheetMarkdownPath,
    nextWorkRunPath: nextWorkRunMarkdownPath,
    evidenceCsvPath,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
