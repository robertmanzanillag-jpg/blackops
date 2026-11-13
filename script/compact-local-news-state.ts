import { constants as fsConstants } from "node:fs";
import { chmod, copyFile, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { archiveAndCompactLocalNewsState } from "../server/clippers-local-news-state-retention";

const workspace = path.resolve(process.env.CLIPPERS_LOCAL_NEWS_WORKSPACE || path.join(process.cwd(), "clippers_workspace", "local-news"));
const statePath = path.join(workspace, "state.json");
const backupPath = path.join(workspace, "state-precompact-backup-20260824.json");

async function main(): Promise<void> {
  try {
    const raw = await readFile(statePath, "utf8");
    const original = JSON.parse(raw) as { events?: unknown[]; queue?: unknown[]; metrics?: unknown[]; [key: string]: unknown };
    if (!Array.isArray(original.events) || !Array.isArray(original.queue) || !Array.isArray(original.metrics)) throw new Error("local-news state has an invalid shape");

    await copyFile(statePath, backupPath, fsConstants.COPYFILE_EXCL).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
    await chmod(backupPath, 0o600);
    const result = await archiveAndCompactLocalNewsState(workspace, original as never);
    const temporaryPath = `${statePath}.${process.pid}.compact.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(result.state)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, statePath);
    const maxRssMb = Math.round(process.resourceUsage().maxRSS / 1024);
    console.log(`[local-news-compaction] archived events=${result.archived.events} queue=${result.archived.queue} metrics=${result.archived.metrics}; active events=${result.state.events.length} queue=${result.state.queue.length} metrics=${result.state.metrics.length}; maxRssMb=${maxRssMb}; backup=${backupPath}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") console.log("[local-news-compaction] no existing state; nothing to compact");
    else throw error;
  }
}

void main();
