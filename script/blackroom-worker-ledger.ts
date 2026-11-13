import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  BLACKROOM_WORKER_LEDGER_PATH,
  assertSafeConfirmedDeletion,
  createBlackRoomWorkerLedger,
  markBlackRoomNetworkUncertain,
  markBlackRoomNetworkBlocked,
  confirmBlackRoomNetworkReceipt,
  discardBlackRoomUnpublishedReservation,
  resetBlackRoomNetworkAttempt,
  scheduleBlackRoomLedgerEntry,
  reserveBlackRoomLedgerEntry,
  updateBlackRoomLedgerEntry,
  type BlackRoomWorkerLedger,
} from "../server/blackroom-local-worker";
import { BLACKROOM_QUEUE_PATH } from "../server/blackroom-daily-queue";

const projectDir = process.cwd();
const ledgerPath = path.join(projectDir, BLACKROOM_WORKER_LEDGER_PATH);
const lockPath = `${ledgerPath}.lock`;
const queuePath = path.join(projectDir, process.env.BLACKROOM_QUEUE_PATH || BLACKROOM_QUEUE_PATH);
const arg = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const networkArg = () => {
  const network = arg("--network");
  if (network !== "tiktok" && network !== "facebook" && network !== "youtube") throw new Error("network must be tiktok, facebook, or youtube");
  return network;
};

async function readLedger(): Promise<BlackRoomWorkerLedger> {
  try { return JSON.parse(await readFile(ledgerPath, "utf8")); }
  catch (error: any) { if (error?.code === "ENOENT") return createBlackRoomWorkerLedger(); throw error; }
}

async function writeLedger(ledger: BlackRoomWorkerLedger): Promise<void> {
  await mkdir(path.dirname(ledgerPath), { recursive: true });
  const temporary = `${ledgerPath}.tmp`;
  await writeFile(temporary, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
  await rename(temporary, ledgerPath);
}

async function acquireLock() {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(lockPath, "wx");
      await handle.write(String(process.pid));
      return handle;
    } catch (error: any) {
      if (error?.code !== "EEXIST") throw error;
      const existingPid = Number((await readFile(lockPath, "utf8").catch(() => "0")).trim());
      let alive = false;
      if (Number.isInteger(existingPid) && existingPid > 0) {
        try { process.kill(existingPid, 0); alive = true; } catch { alive = false; }
      } else {
        const lockStat = await stat(lockPath).catch(() => null);
        alive = Boolean(lockStat && Date.now() - lockStat.mtimeMs < 30_000);
      }
      if (alive || attempt > 0) throw new Error("ledger is locked by an active process");
      await unlink(lockPath).catch(() => undefined);
    }
  }
  throw new Error("failed to acquire ledger lock");
}

async function main(): Promise<void> {
  await mkdir(path.dirname(ledgerPath), { recursive: true });
  const lock = await acquireLock();
  try {
    const ledger = await readLedger();
    let result;
    if (process.argv.includes("--reserve")) {
      const language = arg("--language");
      const format = arg("--format");
      const durationSeconds = Number(arg("--duration"));
      const renderPathInput = arg("--render") || "";
      const sourcePathInput = arg("--source") || "";
      const targetNetworks = String(arg("--networks") || "").split(",")
        .filter((network): network is "tiktok" | "facebook" | "youtube" =>
          network === "tiktok" || network === "facebook" || network === "youtube");
      const creativeStrategy = arg("--creative-strategy") || "drop_first";
      if (!["drop_first", "instant_drop", "build_then_drop", "crowd_reaction_first", "context_open_loop"].includes(creativeStrategy)) throw new Error("unsupported creative strategy");
      if (language !== "en" && language !== "es") throw new Error("language must be en or es");
      if (format !== "vertical" && format !== "horizontal") throw new Error("format must be vertical or horizontal");
      if (![15, 30, 60, 120, 300, 600].includes(durationSeconds)) throw new Error("unsupported duration");
      if (!renderPathInput || !sourcePathInput) throw new Error("render and source paths are required");
      const queue = JSON.parse(await readFile(queuePath, "utf8"));
      const sourceHistory = Array.isArray(queue.sourceHistory) ? queue.sourceHistory : [];
      result = reserveBlackRoomLedgerEntry(ledger, {
        jobId: arg("--job") || "", slot: arg("--slot") || "", videoId: arg("--video") || "",
        sourceVideoTitle: arg("--source-title") || undefined,
        dj: arg("--dj") || "", language, format,
        targetNetworks,
        durationSeconds: durationSeconds as 15 | 30 | 60 | 120 | 300 | 600,
        segmentStartSeconds: Number(arg("--segment-start")), segmentEndSeconds: Number(arg("--segment-end")),
        creativeStrategy: creativeStrategy as any,
        dropOffsetSeconds: Number.isFinite(Number(arg("--drop-offset"))) ? Number(arg("--drop-offset")) : undefined,
        hookFamily: arg("--hook-family") || creativeStrategy,
        captionVariant: arg("--caption-variant") || undefined,
        creativeArmId: arg("--creative-arm-id") || undefined,
        learningTestId: arg("--learning-test-id") || undefined,
        learningReference: arg("--learning-reference") || undefined,
        learningDecisionIds: arg("--learning-decisions")?.slice(0, 300) || undefined,
        allocationMode: arg("--allocation-mode") === "exploit" ? "exploit" : "explore",
        caption: arg("--caption") || "",
        renderPath: path.resolve(renderPathInput), sourcePath: path.resolve(sourcePathInput),
      }, sourceHistory);
      await writeLedger(ledger);
    } else if (process.argv.includes("--confirm")) {
      result = updateBlackRoomLedgerEntry(ledger, arg("--reservation") || "", { status: "confirmed", metricoolId: arg("--metricool-id") || "" });
      await writeLedger(ledger);
    } else if (process.argv.includes("--uncertain")) {
      result = updateBlackRoomLedgerEntry(ledger, arg("--reservation") || "", {
        status: "uncertain",
        publicationDateTime: arg("--publication-date-time"),
      });
      await writeLedger(ledger);
    } else if (process.argv.includes("--network-uncertain")) {
      const entry = ledger.entries.find((candidate) => candidate.reservationId === arg("--reservation"));
      if (!entry) throw new Error("reservation not found");
      result = markBlackRoomNetworkUncertain(entry, networkArg(), arg("--publication-date-time") || "");
      await writeLedger(ledger);
    } else if (process.argv.includes("--network-blocked")) {
      const entry = ledger.entries.find((candidate) => candidate.reservationId === arg("--reservation"));
      if (!entry) throw new Error("reservation not found");
      result = markBlackRoomNetworkBlocked(entry, networkArg());
      await writeLedger(ledger);
    } else if (process.argv.includes("--network-confirm")) {
      const entry = ledger.entries.find((candidate) => candidate.reservationId === arg("--reservation"));
      if (!entry) throw new Error("reservation not found");
      result = confirmBlackRoomNetworkReceipt(entry, networkArg(), arg("--metricool-id") || "");
      await writeLedger(ledger);
    } else if (process.argv.includes("--network-reset")) {
      const entry = ledger.entries.find((candidate) => candidate.reservationId === arg("--reservation"));
      if (!entry) throw new Error("reservation not found");
      result = resetBlackRoomNetworkAttempt(entry, networkArg());
      await writeLedger(ledger);
    } else if (process.argv.includes("--schedule")) {
      const entry = ledger.entries.find((candidate) => candidate.reservationId === arg("--reservation"));
      if (!entry) throw new Error("reservation not found");
      result = scheduleBlackRoomLedgerEntry(entry, arg("--publication-date-time") || "");
      await writeLedger(ledger);
    } else if (process.argv.includes("--discard-unpublished")) {
      result = discardBlackRoomUnpublishedReservation(ledger, arg("--reservation") || "");
      await writeLedger(ledger);
    } else if (process.argv.includes("--delete-confirmed")) {
      const entry = ledger.entries.find((candidate) => candidate.reservationId === arg("--reservation"));
      if (!entry) throw new Error("reservation not found");
      const safePath = assertSafeConfirmedDeletion(projectDir, entry, arg("--file") || "");
      await unlink(safePath);
      result = { deleted: safePath };
    } else throw new Error("Expected a BlackRoom ledger operation");
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await lock.close();
    await unlink(lockPath).catch(() => undefined);
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
