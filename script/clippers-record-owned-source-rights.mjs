import { spawn } from "node:child_process";
import { mkdir, open, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const rootDir = path.join(process.cwd(), "clippers_workspace");
const sourceDropDir = path.join(rootDir, "source-drop");
const allowlistDir = path.join(rootDir, "allowlist");
const metricoolQueuePath = path.join(rootDir, "scheduled", "metricool-execution-queue.json");
const force = process.argv.includes("--force");
const dryRun = process.argv.includes("--dry-run");
const evidenceReadTimeoutMs = Number(process.env.CLIPPERS_EVIDENCE_READ_TIMEOUT_MS || "5000");
const evidenceContentCache = new Map();
const manifestCache = new Map();
const minUsableSourceVideoBytes = 8 * 1024;

const rules = [
  {
    category: "sports",
    pattern: /^sports-owned-(\d{2})(?:-\d+)?\.mp4$/,
    primaryEvidenceFile: "owned-sports-production-notes.md",
    weeklyEvidenceFile: "owned-weekly-backlog-production-notes-v2.md",
    weeklyStartsAt: 12,
    accountLabel: "Sports Daily",
    restrictions: "no league footage, broadcast footage, team footage, athlete likenesses, copyrighted music, scraped highlights, or platform-private material",
  },
  {
    category: "memes",
    pattern: /^memes-owned-(\d{2})(?:-\d+)?\.mp4$/,
    primaryEvidenceFile: "owned-meme-production-notes-v2.md",
    weeklyEvidenceFile: "owned-weekly-backlog-production-notes.md",
    weeklyStartsAt: 15,
    accountLabel: "Meme Radar",
    restrictions: "no third-party footage, creator clips, sports broadcasts, streamer clips, licensed music, watermarked reposts, or platform-private material",
  },
  {
    category: "streamers",
    pattern: /^streamers-owned-(\d{2})(?:-\d+)?\.mp4$/,
    primaryEvidenceFile: "owned-streamers-production-notes.md",
    weeklyEvidenceFile: "owned-weekly-backlog-production-notes.md",
    weeklyStartsAt: 10,
    accountLabel: "Streamer Pulse",
    restrictions: "no raw streamer clips, creator likenesses, copyrighted music, cookies, tokens, passwords, private screenshots, or scraped footage",
  },
];

function ruleForAsset(category, fileName) {
  const rule = rules.find((item) => item.category === category);
  if (!rule) return null;
  const match = fileName.match(rule.pattern);
  if (!match) return null;
  return { rule, sourceNumber: Number(match[1]) };
}

function fallbackEvidencePathFor(rule, sourceNumber) {
  const evidenceFile = sourceNumber >= rule.weeklyStartsAt ? rule.weeklyEvidenceFile : rule.primaryEvidenceFile;
  return path.join(sourceDropDir, rule.category, evidenceFile);
}

function replacementEvidencePathFor(evidencePath) {
  const parsed = path.parse(evidencePath);
  return path.join(parsed.dir, `${parsed.name}-v2${parsed.ext}`);
}

async function resolveReadableEvidencePath(evidencePath) {
  const replacementPath = replacementEvidencePathFor(evidencePath);
  if (await stat(replacementPath).then((file) => file.isFile()).catch(() => false)) return replacementPath;
  return evidencePath;
}

function rightsNoteFor(audit) {
  return [
    `Owned source generated locally for ${audit.rule.accountLabel};`,
    `owner note path ${audit.evidencePath};`,
    `${audit.rule.restrictions};`,
    `asset ${audit.fileName};`,
    "approved only for draft creation and Metricool approval_required queue review.",
  ].join(" ");
}

function allowlistPathFor(fileName) {
  return path.join(allowlistDir, `${path.parse(fileName).name}.md`);
}

async function allowlistExists(fileName) {
  return stat(allowlistPathFor(fileName)).then((file) => file.isFile()).catch(() => false);
}

async function validateAllowlistFile(fileName, audit = null) {
  const allowlistPath = allowlistPathFor(fileName);
  const evidence = await readTextFileWithTimeout(allowlistPath);
  if (evidence.error) return `${allowlistPath} could not be read: ${evidence.error}`;
  const content = evidence.content;
  if (!/status:\s*owned_or_permissioned/i.test(content)) return `${allowlistPath} is not owned_or_permissioned`;
  if (audit) {
    if (!content.includes(`asset_id: owned-source:${audit.category}:${audit.fileName}`)) return `${allowlistPath} does not match asset_id ${audit.fileName}`;
    if (!content.includes(`source_path: ${path.join(sourceDropDir, audit.category, audit.fileName)}`)) return `${allowlistPath} does not match source_path ${audit.fileName}`;
    if (!content.includes(`owner note path ${audit.evidencePath}`)) return `${allowlistPath} points to a stale evidence path`;
  }
  if (!/Metricool approval_required/i.test(content)) return `${allowlistPath} does not preserve approval_required guardrail`;
  if (/realPublishEnabled:\s*true|ready_to_send|autopublish/i.test(content)) return `${allowlistPath} contains unsafe publish wording`;
  return null;
}

async function readMetricoolPublishGuard() {
  const raw = await readFile(metricoolQueuePath, "utf8").catch((error) => {
    throw new Error(`Metricool execution queue could not be read: ${error?.message || "read failed"}`);
  });
  if (!raw.trim()) throw new Error("Metricool execution queue is empty; refusing to register rights without approval_required proof.");
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.realPublishEnabled !== false) {
      throw new Error("Metricool realPublishEnabled is not explicitly false.");
    }
    if (parsed?.publishMode !== "approval_required") {
      throw new Error("Metricool publishMode is not explicitly approval_required.");
    }
    if (parsed?.status !== "approval_required") {
      throw new Error("Metricool queue status is not explicitly approval_required.");
    }
    if ((parsed?.totals?.readyToSend || 0) !== 0) {
      throw new Error("Metricool queue has readyToSend items; approval_required guard is not safe.");
    }
    const unsafeItem = Array.isArray(parsed?.items)
      ? parsed.items.find((item) => item?.canSendNow === true || item?.status === "ready_to_send")
      : null;
    if (unsafeItem) {
      throw new Error(`Metricool queue item ${unsafeItem.id || unsafeItem.queueItemId || "unknown"} can send now; approval_required guard is not safe.`);
    }
    return {
      realPublishEnabled: parsed.realPublishEnabled,
      publishMode: parsed.publishMode,
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Metricool execution queue is invalid JSON: ${error.message}`);
    }
    throw error;
  }
}

function renderSourceRightsEvidence(audit) {
  const recordedAt = new Date().toISOString();
  const assetId = `owned-source:${audit.category}:${audit.fileName}`;
  const sourcePath = path.join(sourceDropDir, audit.category, audit.fileName);
  return [
    `# Source Rights Evidence: ${audit.fileName}`,
    "",
    "status: owned_or_permissioned",
    `category: ${audit.category}`,
    `asset_id: ${assetId}`,
    `source_path: ${sourcePath}`,
    `recorded_at: ${recordedAt}`,
    "source: source-drop-manifest",
    `manifest_evidence_path: ${audit.manifestEvidencePath}`,
    `resolved_evidence_path: ${audit.evidencePath}`,
    "",
    "Notes:",
    rightsNoteFor(audit),
    "",
    "Checklist:",
    "- [x] Source reviewed by Rights Gate.",
    "- [x] Permission, ownership, license, or creator approval was confirmed outside this file.",
    "- [ ] If this is third-party content, store sensitive proof/screenshots in the secure drive, not in git.",
    "",
  ].join("\n");
}

function parseCsvLine(line) {
  const cells = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && quoted && line[index + 1] === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(cell);
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells;
}

function extractEvidencePath(evidenceLink) {
  return evidenceLink.replace(/^owner note path:\s*/i, "").trim();
}

async function loadManifestRowsForCategory(category) {
  if (manifestCache.has(category)) return manifestCache.get(category);
  const manifestPath = path.join(sourceDropDir, category, "source-drop-manifest.csv");
  const raw = await readFile(manifestPath, "utf8").catch(() => "");
  const lines = raw.split(/\r?\n/).filter((line) => line.trim());
  const header = parseCsvLine(lines.shift() || "");
  const rows = new Map();
  const targetFileNameIndex = header.indexOf("target_file_name");
  const evidenceLinkIndex = header.indexOf("evidence_link");
  const rightsStatusIndex = header.indexOf("rights_status");
  for (const line of lines) {
    const cells = parseCsvLine(line);
    const fileName = cells[targetFileNameIndex];
    if (!fileName) continue;
    rows.set(fileName, {
      rightsStatus: cells[rightsStatusIndex] || "",
      evidencePath: extractEvidencePath(cells[evidenceLinkIndex] || ""),
      manifestPath,
    });
  }
  manifestCache.set(category, rows);
  return rows;
}

function evidenceCoversAsset(content, fileName, sourceNumber) {
  if (content.includes(fileName)) return true;
  const prefix = fileName.replace(/-\d{2}(?:-\d+)?\.mp4$/, "");
  const rangePattern = new RegExp(`${prefix}-([0-9]{2})\\.mp4\\s+through\\s+${prefix}-([0-9]{2})\\.mp4`, "i");
  const rangeMatch = content.match(rangePattern);
  if (!rangeMatch) return false;
  const start = Number(rangeMatch[1]);
  const end = Number(rangeMatch[2]);
  return sourceNumber >= start && sourceNumber <= end;
}

async function validateEvidenceFile(audit) {
  if (!audit.manifestEvidencePath) return `${audit.fileName} is missing source-drop-manifest evidence_link`;
  if (audit.manifestRightsStatus !== "owned_or_permissioned") return `${audit.fileName} manifest rights_status is not owned_or_permissioned`;
  const evidence = await readEvidenceFile(audit.evidencePath);
  if (evidence.error) return `${audit.evidencePath} could not be read: ${evidence.error}`;
  const content = evidence.content;
  if (!content.trim()) return `${audit.evidencePath} is missing or empty`;
  if (content.trim().length < 120) return `${audit.evidencePath} is too short to prove owned-source restrictions`;
  if (/\b(not owned|not original|not generated|not locally generated|contains third-party|includes third-party|contains copyrighted|includes copyrighted|uses broadcast footage|includes broadcast footage|contains broadcast footage|uses raw streamer|includes raw streamer|contains scraped footage|includes scraped footage)\b/i.test(content)) {
    return `${audit.evidencePath} describes disallowed or non-owned source material`;
  }
  if (!/(status:\s*owned_source|owned source generated locally|original generated|generated locally|created_by:\s*local clippers|source videos are original generated)/i.test(content)) {
    return `${audit.evidencePath} does not describe owned/generated source provenance`;
  }
  if (!/(no third-party|no league footage|no raw streamer|no streamer raw clips|no copyrighted music|no broadcast footage|no scraped footage)/i.test(content)) {
    return `${audit.evidencePath} does not include explicit no-third-party/copyright/raw-footage restrictions`;
  }
  if (!evidenceCoversAsset(content, audit.fileName, audit.sourceNumber)) {
    return `${audit.evidencePath} does not explicitly cover ${audit.fileName}`;
  }
  return null;
}

async function validateSourceMediaFile(audit) {
  const sourcePath = path.join(sourceDropDir, audit.category, audit.fileName);
  const fileStat = await stat(sourcePath).catch(() => null);
  if (!fileStat?.isFile()) return `${sourcePath} is missing or is not a file`;
  if (fileStat.size < minUsableSourceVideoBytes) return `${sourcePath} is too small to be a usable source video`;
  const ext = path.extname(sourcePath).toLowerCase();
  if (![".mp4", ".mov", ".m4v"].includes(ext)) return `${sourcePath} has unsupported source extension ${ext || "none"}`;
  const handle = await open(sourcePath, "r").catch(() => null);
  if (!handle) return `${sourcePath} could not be opened for media validation`;
  const head = Buffer.alloc(64);
  const bytesRead = await handle.read(head, 0, head.length, 0)
    .then((result) => result.bytesRead)
    .catch(() => 0)
    .finally(() => handle.close().catch(() => undefined));
  if (bytesRead <= 0) return `${sourcePath} could not be read for media validation`;
  if (!head.subarray(0, bytesRead).includes(Buffer.from("ftyp"))) {
    return `${sourcePath} does not look like a usable MP4/MOV source video`;
  }
  return null;
}

async function readEvidenceFile(evidencePath) {
  if (evidenceContentCache.has(evidencePath)) return evidenceContentCache.get(evidencePath);
  const contentPromise = readTextFileWithTimeout(evidencePath);
  evidenceContentCache.set(evidencePath, contentPromise);
  return contentPromise;
}

async function readTextFileWithTimeout(filePath) {
  return new Promise((resolve) => {
    const child = spawn("head", ["-c", "8192", filePath], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ content: "", error: `read timed out after ${evidenceReadTimeoutMs}ms` });
    }, evidenceReadTimeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      clearTimeout(timeout);
      resolve({ content: "", error: error.message || "read failed" });
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve({ content: stdout, error: null });
      else resolve({ content: "", error: stderr.trim() || `head exited with code ${code}` });
    });
  });
}

async function writeAllowlistFile(fileName, content) {
  await mkdir(allowlistDir, { recursive: true });
  const finalPath = allowlistPathFor(fileName);
  const tempPath = path.join(allowlistDir, `.${path.parse(fileName).name}.${process.pid}.${Date.now()}.tmp`);
  await writeFile(tempPath, content);
  await rename(tempPath, finalPath);
}

async function scanOwnedSourceDropFiles() {
  const audits = [];
  for (const rule of rules) {
    const categoryDir = path.join(sourceDropDir, rule.category);
    const manifestRows = await loadManifestRowsForCategory(rule.category);
    const fileNames = await readdir(categoryDir).catch(() => []);
    for (const fileName of fileNames) {
      const match = ruleForAsset(rule.category, fileName);
      if (!match) continue;
      const manifestRow = manifestRows.get(fileName);
      const manifestEvidencePath = manifestRow?.evidencePath || fallbackEvidencePathFor(rule, match.sourceNumber);
      const evidencePath = await resolveReadableEvidencePath(manifestEvidencePath);
      const audit = {
        category: rule.category,
        fileName,
        rule,
        sourceNumber: match.sourceNumber,
        manifestPath: manifestRow?.manifestPath || path.join(sourceDropDir, rule.category, "source-drop-manifest.csv"),
        manifestRightsStatus: manifestRow?.rightsStatus || "",
        manifestEvidencePath,
        evidencePath,
      };
      audits.push({
        ...audit,
        evidenceProblem: await validateEvidenceFile(audit),
        mediaProblem: await validateSourceMediaFile(audit),
      });
    }
  }
  return audits.sort((left, right) => left.category.localeCompare(right.category) || left.fileName.localeCompare(right.fileName));
}

function emptyCategoryCounts() {
  const byCategory = new Map();
  for (const rule of rules) byCategory.set(rule.category, { scanned: 0, pending: 0, recorded: 0, evidenceProblems: 0, rightsReady: 0 });
  return byCategory;
}

async function runDryRun() {
  const metricoolGuard = await readMetricoolPublishGuard();
  const audits = await scanOwnedSourceDropFiles();
  const byCategory = emptyCategoryCounts();
  const allowlistProblems = [];
  for (const audit of audits) {
    const row = byCategory.get(audit.category);
    row.scanned += 1;
    if (!await allowlistExists(audit.fileName)) {
      row.pending += 1;
    } else {
      const allowlistProblem = await validateAllowlistFile(audit.fileName, audit);
      if (allowlistProblem) {
        row.pending += 1;
        allowlistProblems.push({ fileName: audit.fileName, allowlistProblem });
      } else if (!audit.evidenceProblem && !audit.mediaProblem) {
        row.rightsReady += 1;
      }
    }
    if (audit.evidenceProblem || audit.mediaProblem) row.evidenceProblems += 1;
  }
  const evidenceProblems = audits.filter((audit) => audit.evidenceProblem || audit.mediaProblem);
  console.log(JSON.stringify({
    dryRun,
    mode: "filesystem_evidence_audit",
    scanned: audits.length,
    evidenceReady: audits.length - evidenceProblems.length,
    evidenceProblems: evidenceProblems.length,
    registrationPending: Array.from(byCategory.values()).reduce((sum, row) => sum + row.pending, 0),
    rightsReady: Array.from(byCategory.values()).reduce((sum, row) => sum + row.rightsReady, 0),
    byCategory: Object.fromEntries(byCategory),
    sampleProblems: evidenceProblems.slice(0, 10).map((audit) => ({
      ...audit,
      evidenceProblem: audit.evidenceProblem || audit.mediaProblem,
    })),
    sampleAllowlistProblems: allowlistProblems.slice(0, 10),
    realPublishEnabled: metricoolGuard.realPublishEnabled,
    publishMode: metricoolGuard.publishMode,
    nextStep: evidenceProblems.length || allowlistProblems.length
      ? "Fix source-drop production notes before registering owned source rights."
      : "Filesystem evidence is ready; run without --dry-run to register guarded allowlist rights.",
  }, null, 2));
}

async function runRegistration() {
  const metricoolGuard = await readMetricoolPublishGuard();
  const audits = await scanOwnedSourceDropFiles();
  const pendingAudits = [];
  const byCategory = emptyCategoryCounts();

  for (const audit of audits) {
    const row = byCategory.get(audit.category);
    row.scanned += 1;
    let allowlistProblem = "forced refresh";
    if (!force) {
      allowlistProblem = await allowlistExists(audit.fileName)
        ? await validateAllowlistFile(audit.fileName, audit)
        : "missing allowlist evidence";
    }
    if (force || allowlistProblem) {
      row.pending += 1;
      pendingAudits.push(audit);
    }
  }

  const missingEvidence = [];
  for (const audit of pendingAudits) {
    if (audit.evidenceProblem || audit.mediaProblem) missingEvidence.push(`${audit.fileName} -> ${audit.evidenceProblem || audit.mediaProblem}`);
  }
  if (missingEvidence.length) {
    throw new Error(`Owned source evidence file(s) missing:\n${missingEvidence.join("\n")}`);
  }

  await mkdir(allowlistDir, { recursive: true });
  for (const audit of pendingAudits) {
    await writeAllowlistFile(audit.fileName, renderSourceRightsEvidence(audit));
    byCategory.get(audit.category).recorded += 1;
  }

  let rightsReady = 0;
  for (const audit of audits) {
    if (await allowlistExists(audit.fileName) && !audit.mediaProblem && !await validateAllowlistFile(audit.fileName, audit)) rightsReady += 1;
  }

  console.log(JSON.stringify({
    dryRun,
    force,
    mode: "filesystem_allowlist_registration",
    scanned: audits.length,
    pending: pendingAudits.length,
    recorded: pendingAudits.length,
    rightsReady,
    byCategory: Object.fromEntries(byCategory),
    realPublishEnabled: metricoolGuard.realPublishEnabled,
    publishMode: metricoolGuard.publishMode,
  }, null, 2));
}

if (dryRun) runDryRun().catch((error) => {
  console.error(error);
  process.exit(1);
});
else runRegistration().catch((error) => {
  console.error(error);
  process.exit(1);
});
