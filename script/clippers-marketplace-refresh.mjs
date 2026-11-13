import { spawn } from "node:child_process";
import { lstat, mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PROVIDER_ALIASES = new Map([
  ["vyro", "vyro"],
  ["whop", "whop"],
  ["content rewards", "content_rewards"],
  ["content-rewards", "content_rewards"],
  ["content_rewards", "content_rewards"],
  ["clipping", "clipping"],
  ["clipping.net", "clipping"],
]);
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_STDOUT_BYTES = 5 * 1024 * 1024;
const MAX_CLOCK_SKEW_MS = 5 * 60_000;
const FORBIDDEN_ENV_PATTERN = /(?:OPENAI|ANTHROPIC|GEMINI|GOOGLE_API_KEY|AWS_|STRIPE|PAYMENT|BILLING|CREDIT|CARD)/i;
const ADAPTER_ENV_PATTERN = /^CLIPPERS_MARKETPLACE_(?:VYRO|WHOP|CONTENT_REWARDS|CLIPPING)_[A-Z0-9_]+$/;

function text(value) {
  return String(value ?? "").trim();
}

function providerName(value) {
  return PROVIDER_ALIASES.get(text(value).toLowerCase()) || null;
}

function isoDate(value) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function atomicJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(tempPath, filePath);
}

async function safeExecutable(command) {
  if (!path.isAbsolute(command)) return false;
  const [stats, resolved] = await Promise.all([
    lstat(command).catch(() => null),
    realpath(command).catch(() => null),
  ]);
  return Boolean(stats?.isFile() && !stats.isSymbolicLink() && resolved === command);
}

function adapterEnvironment(adapter) {
  const names = Array.isArray(adapter.envAllowlist) ? adapter.envAllowlist : [];
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    LANG: process.env.LANG,
  };
  for (const name of names) {
    if (!ADAPTER_ENV_PATTERN.test(text(name)) || FORBIDDEN_ENV_PATTERN.test(text(name))) continue;
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  return Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined));
}

function executeAdapter(adapter, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(adapter.command, adapter.args, {
      env: adapterEnvironment(adapter),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let overflow = false;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    child.stdout.on("data", (chunk) => {
      if (overflow) return;
      stdout += chunk.toString("utf8");
      if (Buffer.byteLength(stdout) > MAX_STDOUT_BYTES) {
        overflow = true;
        stdout = "";
        child.kill("SIGKILL");
      }
    });
    // Stderr is deliberately discarded: adapters may write tokens or session details there.
    child.stderr.resume();
    child.on("error", (error) => finish({ ok: false, reason: error.code === "ENOENT" ? "adapter_not_found" : "adapter_start_failed" }));
    child.on("close", (code, signal) => {
      if (overflow) return finish({ ok: false, reason: "adapter_output_too_large" });
      if (signal === "SIGKILL") return finish({ ok: false, reason: "adapter_timeout" });
      if (code !== 0) return finish({ ok: false, reason: "adapter_exit_nonzero", exitCode: code });
      finish({ ok: true, stdout });
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
  });
}

function validateCampaign(campaign) {
  if (!campaign || typeof campaign !== "object" || Array.isArray(campaign)) return "campaign_not_object";
  if (!text(campaign.id)) return "campaign_id_missing";
  if (!text(campaign.title)) return "campaign_title_missing";
  if (campaign.active !== true) return "campaign_not_active";
  if (campaign.joined !== true) return "campaign_not_joined";
  if (!isoDate(campaign.expiresAt)) return "campaign_expiry_missing";
  if (!isoDate(campaign.rightsExpiresAt || campaign.rights?.expiresAt || campaign.expiresAt)) return "rights_expiry_missing";
  if (!/^https:\/\//i.test(text(campaign.sourceUrl))) return "authorized_source_missing";
  if (!text(campaign.rightsEvidencePath || campaign.rights?.evidencePath)) return "rights_evidence_path_missing";
  if (campaign.evidenceVerified !== true && campaign.rightsVerified !== true && campaign.rights?.verified !== true) return "rights_not_attested";
  if (!Array.isArray(campaign.compatibleAccounts) && !Array.isArray(campaign.allowedAccounts) && !text(campaign.accountHandle)) return "compatible_account_missing";
  if (!Number.isFinite(Number(campaign.payoutCpm)) || Number(campaign.payoutCpm) <= 0) return "payout_cpm_missing";
  if (!Number.isFinite(Number(campaign.minViewsPerPost)) || Number(campaign.minViewsPerPost) < 0) return "minimum_views_missing";
  return null;
}

function validateSnapshot(value, expectedProvider, now) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, reason: "snapshot_not_object" };
  const marketplace = providerName(value.marketplace);
  if (marketplace !== expectedProvider) return { ok: false, reason: "snapshot_provider_mismatch" };
  const observedAt = isoDate(value.observedAt);
  if (!observedAt) return { ok: false, reason: "snapshot_observed_at_missing" };
  const observedMs = Date.parse(observedAt);
  if (Math.abs(now.getTime() - observedMs) > MAX_CLOCK_SKEW_MS) return { ok: false, reason: observedMs > now.getTime() ? "snapshot_from_future" : "snapshot_not_fresh" };
  if (!Array.isArray(value.campaigns)) return { ok: false, reason: "snapshot_campaigns_missing" };
  for (const campaign of value.campaigns) {
    const reason = validateCampaign(campaign);
    if (reason) return { ok: false, reason };
  }
  return {
    ok: true,
    snapshot: {
      schemaVersion: 1,
      marketplace,
      observedAt,
      campaigns: value.campaigns,
    },
  };
}

function providerReport(provider, status, reason, attempts = []) {
  return { provider, status, reason, attempts };
}

export async function runMarketplaceRefresh(options = {}) {
  const configRoot = path.resolve(options.configRoot || process.env.CLIPPERS_CONFIG_ROOT || process.cwd());
  const workspaceRoot = path.resolve(options.workspaceRoot || process.env.CLIPPERS_WORKSPACE_ROOT || path.join(configRoot, "clippers_workspace"));
  const configuredPath = options.configPath || process.env.CLIPPERS_MARKETPLACE_REFRESH_CONFIG || "clippers-marketplace-refresh.json";
  const configPath = path.isAbsolute(configuredPath) ? configuredPath : path.resolve(configRoot, configuredPath);
  const snapshotDir = path.resolve(options.snapshotDir || path.join(workspaceRoot, "research", "marketplace-snapshots"));
  const reportPath = path.resolve(options.reportPath || path.join(workspaceRoot, "reports", "marketplace-refresh-report.json"));
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const defaultTimeoutMs = positiveInteger(options.timeoutMs ?? process.env.CLIPPERS_MARKETPLACE_REFRESH_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  if (!Number.isFinite(now.getTime())) throw new Error("invalid refresh timestamp");

  let config;
  try {
    config = options.config || JSON.parse(await readFile(configPath, "utf8"));
  } catch (error) {
    const report = {
      schemaVersion: 1, generatedAt: now.toISOString(), status: "blocked", reason: error?.code === "ENOENT" ? "config_missing" : "config_invalid",
      providers: [], summary: { configured: 0, refreshed: 0, blocked: 0, campaignsObserved: 0 }, costUsd: 0,
    };
    await atomicJson(reportPath, report);
    return report;
  }
  if (config?.schemaVersion !== 1 || !Array.isArray(config.providers)) {
    const report = { schemaVersion: 1, generatedAt: now.toISOString(), status: "blocked", reason: "config_schema_invalid", providers: [], summary: { configured: 0, refreshed: 0, blocked: 0, campaignsObserved: 0 }, costUsd: 0 };
    await atomicJson(reportPath, report);
    return report;
  }

  const providerResults = [];
  for (const entry of config.providers) {
    const provider = providerName(entry?.provider);
    if (!provider) {
      providerResults.push(providerReport(text(entry?.provider) || "unknown", "blocked", "provider_unsupported"));
      continue;
    }
    if (entry.enabled === false) {
      providerResults.push(providerReport(provider, "skipped", "provider_disabled"));
      continue;
    }
    if (entry.authorized !== true) {
      providerResults.push(providerReport(provider, "blocked", "provider_not_authorized"));
      continue;
    }
    const adapters = Array.isArray(entry.adapters) ? entry.adapters : [];
    if (!adapters.length) {
      providerResults.push(providerReport(provider, "blocked", "adapter_missing"));
      continue;
    }
    const attempts = [];
    let refreshed = null;
    for (let index = 0; index < adapters.length; index += 1) {
      const adapter = adapters[index];
      const command = text(adapter?.command);
      const args = Array.isArray(adapter?.args) && adapter.args.every((arg) => typeof arg === "string") ? adapter.args : null;
      if (!command || !args || !(await safeExecutable(command))) {
        attempts.push({ adapter: index + 1, status: "failed", reason: "adapter_command_unsafe" });
        continue;
      }
      const timeoutMs = positiveInteger(adapter.timeoutMs, defaultTimeoutMs);
      const result = await (options.executeAdapter || executeAdapter)({ ...adapter, command, args }, timeoutMs);
      if (!result.ok) {
        attempts.push({ adapter: index + 1, status: "failed", reason: result.reason, ...(Number.isInteger(result.exitCode) ? { exitCode: result.exitCode } : {}) });
        continue;
      }
      let parsed;
      try {
        parsed = JSON.parse(result.stdout);
      } catch {
        attempts.push({ adapter: index + 1, status: "failed", reason: "adapter_json_invalid" });
        continue;
      }
      const validated = validateSnapshot(parsed, provider, now);
      if (!validated.ok) {
        attempts.push({ adapter: index + 1, status: "failed", reason: validated.reason });
        continue;
      }
      await atomicJson(path.join(snapshotDir, `${provider}.json`), validated.snapshot);
      attempts.push({ adapter: index + 1, status: "succeeded", campaignsObserved: validated.snapshot.campaigns.length });
      refreshed = validated.snapshot;
      break;
    }
    providerResults.push(refreshed
      ? { provider, status: "refreshed", reason: null, campaignsObserved: refreshed.campaigns.length, attempts }
      : providerReport(provider, "blocked", attempts.at(-1)?.reason || "all_adapters_failed", attempts));
  }

  const refreshed = providerResults.filter((row) => row.status === "refreshed");
  const report = {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    status: refreshed.length ? "ready" : "blocked",
    reason: refreshed.length ? null : "no_provider_refreshed",
    providers: providerResults,
    summary: {
      configured: config.providers.length,
      refreshed: refreshed.length,
      blocked: providerResults.filter((row) => row.status === "blocked").length,
      campaignsObserved: refreshed.reduce((sum, row) => sum + row.campaignsObserved, 0),
    },
    costUsd: 0,
  };
  await atomicJson(reportPath, report);
  return report;
}

async function main() {
  try {
    const report = await runMarketplaceRefresh();
    console.log(JSON.stringify({ status: report.status, ...report.summary, report: "reports/marketplace-refresh-report.json", costUsd: 0 }, null, 2));
    if (report.status !== "ready") process.exitCode = 2;
  } catch (error) {
    console.error(JSON.stringify({ status: "failed", reason: "refresh_fatal", costUsd: 0 }));
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
