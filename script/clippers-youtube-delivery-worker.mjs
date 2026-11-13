#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { packageYouTubeUploads } from "./clippers-youtube-upload-packager.mjs";
import { runYouTubePublishWorker } from "./clippers-youtube-publish-worker.mjs";

const EMPTY_LOCK_STALE_MS = 30 * 60 * 1000;
const YOUTUBE_URL = /^https:\/\/(?:www\.)?youtube\.com\/watch\?v=[A-Za-z0-9_-]{6,32}$/;
const clean = (value) => String(value ?? "").trim();

async function atomicJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, filePath);
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error?.code === "EPERM"; }
}

async function acquireLock(lockPath) {
  await mkdir(path.dirname(lockPath), { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() })}\n`);
      return handle;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const [existing, info] = await Promise.all([
        readFile(lockPath, "utf8").then(JSON.parse).catch(() => null),
        lstat(lockPath).catch(() => null),
      ]);
      const pid = Number(existing?.pid);
      const staleEmpty = info?.size === 0 && Date.now() - info.mtimeMs > EMPTY_LOCK_STALE_MS;
      if (processAlive(pid) || (!pid && !staleEmpty)) throw new Error("youtube_delivery_worker_already_running");
      await rm(lockPath, { force: true });
    }
  }
  throw new Error("youtube_delivery_worker_lock_unavailable");
}

async function readDeliveryConfig(configPath) {
  const absolute = path.resolve(configPath);
  const info = await lstat(absolute);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("config_must_be_regular_file");
  if ((info.mode & 0o777) !== 0o600) throw new Error("config_must_be_owner_only_0600");
  const config = JSON.parse(await readFile(absolute, "utf8"));
  const workspaceRoot = path.resolve(path.dirname(absolute), clean(config?.workspaceRoot));
  if (!clean(config?.workspaceRoot)) throw new Error("workspace_root_required");
  return { absolute, workspaceRoot };
}

function safeUrls(publishReport) {
  return (Array.isArray(publishReport?.items) ? publishReport.items : [])
    .filter((item) => item?.status === "uploaded" && YOUTUBE_URL.test(clean(item.youtubeUrl)))
    .map((item) => ({ itemId: clean(item.itemId), lane: clean(item.lane), privacyStatus: clean(item.privacyStatus), youtubeUrl: clean(item.youtubeUrl) }));
}

export async function runYouTubeDeliveryWorker(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const configPath = options.configPath;
  if (!configPath) throw new Error("delivery_config_required");
  const { absolute, workspaceRoot } = await readDeliveryConfig(configPath);
  const reportPath = path.join(workspaceRoot, "reports", "youtube-delivery-worker-latest.json");
  const lockPath = path.join(workspaceRoot, "reports", "youtube-delivery-worker.lock");
  const base = {
    schemaVersion: 1,
    runId: randomUUID(),
    startedAt: now.toISOString(),
    configFile: absolute,
    apiCostUsd: 0,
    paidSpendAllowed: false,
  };
  let lock;
  try {
    lock = await acquireLock(lockPath);
  } catch (error) {
    const report = { ...base, finishedAt: new Date().toISOString(), status: "blocked", stage: "lock", blockers: [clean(error?.message) || "delivery_lock_failed"], published: 0, publicUrls: [] };
    await atomicJson(reportPath, report);
    return { ...report, reportPath };
  }
  try {
    let packaging;
    try {
      packaging = await (options.packageUploads || packageYouTubeUploads)({
        configPath: absolute,
        now,
        operations: options.packagerOperations || {},
      });
    } catch (error) {
      const report = { ...base, finishedAt: new Date().toISOString(), status: "blocked", stage: "packaging", blockers: [clean(error?.message) || "packaging_failed"], packaging: null, publishing: null, published: 0, publicUrls: [] };
      await atomicJson(reportPath, report);
      return { ...report, reportPath };
    }
    if (packaging?.status !== "completed") {
      const blockers = Array.isArray(packaging?.blocked)
        ? packaging.blocked.map((row) => clean(row?.blocker)).filter(Boolean)
        : [];
      const report = { ...base, finishedAt: new Date().toISOString(), status: "blocked", stage: "packaging", blockers: blockers.length ? [...new Set(blockers)] : ["packaging_not_completed"], packaging, publishing: null, published: 0, publicUrls: [] };
      await atomicJson(reportPath, report);
      return { ...report, reportPath };
    }
    const queueFile = clean(packaging.queueFile);
    if (!queueFile) {
      const report = { ...base, finishedAt: new Date().toISOString(), status: "blocked", stage: "packaging", blockers: ["reviewed_queue_not_produced"], packaging, publishing: null, published: 0, publicUrls: [] };
      await atomicJson(reportPath, report);
      return { ...report, reportPath };
    }
    let publishing;
    try {
      publishing = await (options.publishUploads || runYouTubePublishWorker)({
        workspaceRoot,
        queueFile,
        env: options.env || process.env,
        now,
        ...(options.publishOptions || {}),
      });
    } catch {
      publishing = { status: "blocked", blockers: ["unexpected_publish_worker_failure"], uploaded: 0, uncertain: 0, items: [] };
    }
    const urls = safeUrls(publishing);
    const uncertain = Number(publishing?.uncertain || 0);
    const status = uncertain > 0 || publishing?.status === "completed_with_uncertain_outcomes"
      ? "completed_with_uncertain_outcomes"
      : publishing?.status === "completed" ? "completed" : "completed_with_blockers";
    const report = {
      ...base,
      finishedAt: new Date().toISOString(),
      status,
      stage: "publishing",
      blockers: Array.isArray(publishing?.blockers) ? [...new Set(publishing.blockers.map(clean).filter(Boolean))] : [],
      packaging: { status: packaging.status, packaged: Number(packaging.packaged || 0), queueFile },
      publishing: { status: clean(publishing?.status) || "blocked", queued: Number(publishing?.queued || 0), uploaded: Number(publishing?.uploaded || 0), uncertain, blocked: Number(publishing?.blocked || 0) },
      published: urls.length,
      publicUrls: urls,
    };
    await atomicJson(reportPath, report);
    return { ...report, reportPath };
  } finally {
    await lock.close().catch(() => {});
    await rm(lockPath, { force: true }).catch(() => {});
  }
}

function cliValue(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const configPath = cliValue("config");
  runYouTubeDeliveryWorker({ configPath })
    .then((result) => {
      process.stdout.write(`${JSON.stringify({ status: result.status, stage: result.stage, reportPath: result.reportPath, published: result.published }, null, 2)}\n`);
      if (result.status !== "completed") process.exitCode = 2;
    })
    .catch((error) => {
      process.stdout.write(`${JSON.stringify({ status: "blocked", blockers: [clean(error?.message) || "unexpected_delivery_worker_failure"], apiCostUsd: 0 }, null, 2)}\n`);
      process.exitCode = 1;
    });
}
