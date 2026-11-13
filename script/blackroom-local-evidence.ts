import { readFile, writeFile, rename, readdir, open, lstat } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { homedir } from "node:os";
import { withBlackRoomQueueLock } from "../server/blackroom-daily-queue";
import { assessLocalBlackRoomExports, emptyEvidence, type EvidenceArchive } from "../server/blackroom-local-evidence";
import { buildBlackRoomPublicationExperiments } from "./blackroom-remote-sync.mjs";
import { emptyCalendarReceipts, manualClips, manualClipCandidates, reconcileManualObservations, type CalendarReceipts } from "../server/blackroom-manual-observations";
import { collectBlackRoomPublicationReceipts } from "./blackroom-publication-collector";

async function jsonFile(file: string, missing: unknown) {
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch (err: any) { if (err?.code === "ENOENT") return missing; throw err; }
}

async function saveAtomic(file: string, data: unknown) {
  const temp = file + "." + process.pid + ".tmp";
  await writeFile(temp, JSON.stringify(data), { mode: 0o600 });
  await rename(temp, file);
}

/** Only this workflow's durable receipt names are discovered. Do not scan the
 * user's general documents, follow symlinks, or import unrelated JSON exports. */
export async function manualReceiptPaths(agentDir: string, env = process.env, home = homedir()) {
  if (env.BLACKROOM_MANUAL_RECEIPTS_PATH) return env.BLACKROOM_MANUAL_RECEIPTS_PATH.split(path.delimiter).filter(Boolean).slice(0,16);
  const outputDir = path.join(home, "Documents", "black room", "output");
  const directory = await lstat(outputDir).catch((error:any)=>{if(error?.code==="ENOENT")return null;throw error;});
  if (!directory?.isDirectory() || directory.isSymbolicLink()) return [path.join(agentDir,"manual-planner-receipts.json")];
  const entries = await readdir(outputDir, { withFileTypes:true }).catch((error:any) => {
    if(error?.code === "ENOENT") return [];
    throw error;
  });
  return [path.join(agentDir,"manual-planner-receipts.json"), ...entries.filter(e=>e.isFile()
    && /^blackroom-(?:observaciones|recibos)-\d{4}-\d{2}-\d{2}(?:-[a-z0-9-]+)?\.json$/.test(e.name))
    .map(e=>e.name).sort().slice(-15).map(name=>path.join(outputDir,name))];
}

async function readManualReceipt(file: string) {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW).catch((error:any)=>{if(error?.code==="ENOENT")return null;throw error;});
  if (!handle) return null;
  try {
    const stat = await handle.stat();
    if(!stat.isFile() || stat.size>2_000_000)throw new Error("Manual receipt exceeds limit or is not regular");
    const buffer=Buffer.alloc(2_000_001);let offset=0;
    while(offset<buffer.length){const {bytesRead}=await handle.read(buffer,offset,buffer.length-offset,null);if(!bytesRead)break;offset+=bytesRead;}
    if(offset>2_000_000)throw new Error("Manual receipt exceeds limit");
    return JSON.parse(buffer.subarray(0,offset).toString("utf8"));
  } finally {await handle.close();}
}

/** Read-only calendar acquisition is opt-in (enabled by the recurring CLI).
 * No scheduling, publication, worker ledger or queue-state writes.
 * A dedicated file lock covers the complete archive->report transaction. */
export async function refreshLocalBlackRoomEvidence(root: string, agentDir: string, now = new Date(),
  options: { collectPublications?: boolean; env?: NodeJS.ProcessEnv; fetcher?: typeof fetch; home?: string } = {}) {
  const archiveFile = path.join(agentDir, "local-ceo-evidence.json");
  return withBlackRoomQueueLock(archiveFile, async () => {
    const prior = await jsonFile(archiveFile, emptyEvidence()) as EvidenceArchive;
    if (prior?.version !== 1 || !Array.isArray(prior.posts) || !Array.isArray(prior.snapshots)) throw new Error("Invalid local evidence archive");
    const latest = await jsonFile(path.join(root, "latest-export.json"), null);
    if (!latest || !Array.isArray(latest.imports)) throw new Error("Verified BlackRoom export unavailable");
    const ledger = await jsonFile(path.join(agentDir, "worker-ledger.json"), { entries: [] });
    if (!Array.isArray(ledger?.entries)) throw new Error("Invalid BlackRoom receipt ledger");
    const { archive, report } = assessLocalBlackRoomExports(prior, latest.imports, buildBlackRoomPublicationExperiments(ledger), now);
    // A planner receipt without an official platform ID is pending context,
    // never a measurement or evidence for the controlled hook experiment.
    const keys = new Set<string>();
    const receiptPaths = await manualReceiptPaths(agentDir,options.env || process.env, options.home);
    let unreadableReceiptFiles = 0;
    const documents: unknown[] = [];
    for (const file of receiptPaths) {
      const manual = await readManualReceipt(file).catch(() => { unreadableReceiptFiles++; return null; });
      documents.push(manual);
      if (String(manual?.brandId) === "6585226" && manual?.state === "scheduled_not_published" && Array.isArray(manual.rows)) {
        for (const row of manual.rows.slice(-2000)) {
          if (!/^\d+$/.test(String(row?.plannerId || "")) || !Array.isArray(row.networks)) continue;
          for (const net of row.networks) if (["tiktok", "facebook", "youtube"].includes(net)) keys.add(row.plannerId + ":" + net);
        }
      }
    }
    const registryPath = path.join(agentDir,"manual-clip-registry.json");
    const oldRegistry = await jsonFile(registryPath, {version:1,rows:[]}) as {version:number;rows:any[]};
    if(oldRegistry.version!==1 || !Array.isArray(oldRegistry.rows))throw new Error("Invalid manual clip registry");
    const newRows = manualClipCandidates(documents).map(({network,...row})=>({...row,networks:[network]}));
    // Store only normalized creative metadata, never captions, publicationEvidence
    // or credentials. Conflicting versions remain present for quarantine.
    const registryRows = [...new Map([...oldRegistry.rows,...newRows].map(row=>[JSON.stringify(row),row])).values()]
      .filter(row=>typeof row?.scheduledLocal==="string" && row.scheduledLocal.slice(0,10)>=new Date(now.getTime()-90*86400000).toISOString().slice(0,10))
      .slice(-10_000);
    const registryDoc = {brandId:"6585226",state:"scheduled_not_published",rows:registryRows};
    const clips = manualClips([registryDoc]);
    for(const clip of clips)keys.add(clip.plannerId+":"+clip.network);
    const calendarPath = path.join(agentDir, "publication-receipts.json");
    let calendar = await jsonFile(calendarPath, emptyCalendarReceipts()) as CalendarReceipts;
    if (options.collectPublications) {
      calendar = await collectBlackRoomPublicationReceipts(clips, calendar, { now, env: options.env, fetcher: options.fetcher });
      await saveAtomic(calendarPath, calendar);
    }
    const manualObservations = reconcileManualObservations(clips, calendar, archive.posts, archive.snapshots, now);
    const confirmed = manualObservations.deliveries.filter(d=>d.status === "observed" || d.status === "awaiting-metrics").length;
    const summary = { ...report, unverifiedManualDeliveries: Math.max(0, keys.size-confirmed), unreadableReceiptFiles,
      manualObservations, publicationCollectionError: calendar.lastError || null };
    await saveAtomic(archiveFile, archive);
    await saveAtomic(registryPath,{version:1,rows:registryRows});
    await saveAtomic(path.join(agentDir, "local-ceo-report.json"), summary);
    return summary;
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = path.resolve(process.env.BLACKROOM_ANALYTICS_STATE_DIR || (process.platform === "darwin"
    ? path.join(homedir(), "Library/Application Support/BlackRoom/analytics")
    : "clippers_workspace/blackroom/analytics"));
  refreshLocalBlackRoomEvidence(root, path.resolve("clippers_workspace/blackroom/agent"), new Date(), { collectPublications: true })
    .then(report => console.log(JSON.stringify({ scope: report.scope, evaluatedAt: report.evaluatedAt, networkSamples: report.networkSamples })))
    .catch(() => { console.error("No se pudo actualizar la evidencia local; se conserva el archivo anterior."); process.exitCode = 1; });
}
