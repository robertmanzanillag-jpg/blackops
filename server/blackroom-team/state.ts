// Per-agent JSON state for the Black Room team, next to the other Black Room workspace files
// (clippers_workspace/ is gitignored). Writes are atomic: a unique temp file, then rename.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { isBlackRoomTeamAgentId, type BlackRoomTeamAgentId, type BlackRoomTeamStateStore } from "@shared/blackroom-team";

export const BLACKROOM_TEAM_DATA_DIR = "clippers_workspace/blackroom/team";

export function blackRoomTeamStatePath(dataDir: string, id: BlackRoomTeamAgentId): string {
  if (!isBlackRoomTeamAgentId(id)) throw new Error(`Agente de Black Room desconocido: ${String(id)}`);
  return path.join(dataDir, `${id}.json`);
}

/** Reads the agent's JSON state; returns `fallback` when the file does not exist yet. Corrupt JSON throws. */
export async function readBlackRoomTeamState<T>(dataDir: string, id: BlackRoomTeamAgentId, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(blackRoomTeamStatePath(dataDir, id), "utf8")) as T;
  } catch (error: any) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

/** Atomically replaces the agent's JSON state file. */
export async function writeBlackRoomTeamState<T>(dataDir: string, id: BlackRoomTeamAgentId, value: T): Promise<void> {
  const filePath = blackRoomTeamStatePath(dataDir, id);
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporaryPath, filePath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

export function createBlackRoomTeamStateStore(dataDir: string, id: BlackRoomTeamAgentId): BlackRoomTeamStateStore {
  return {
    load: (fallback) => readBlackRoomTeamState(dataDir, id, fallback),
    save: (value) => writeBlackRoomTeamState(dataDir, id, value),
  };
}

const SHARED_FILE_NAME = /^[a-z][a-z0-9-]{0,40}\.json$/;

/** Reads a shared team file (e.g. scheduler.json) in the data dir; fixed names only, no paths. */
export async function readBlackRoomTeamStateFile<T>(dataDir: string, fileName: string, fallback: T): Promise<T> {
  if (!SHARED_FILE_NAME.test(fileName)) throw new Error(`Nombre de archivo no valido: ${fileName}`);
  try {
    return JSON.parse(await readFile(path.join(dataDir, fileName), "utf8")) as T;
  } catch (error: any) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

/** Atomically replaces a shared team file in the data dir. */
export async function writeBlackRoomTeamStateFile<T>(dataDir: string, fileName: string, value: T): Promise<void> {
  if (!SHARED_FILE_NAME.test(fileName)) throw new Error(`Nombre de archivo no valido: ${fileName}`);
  const filePath = path.join(dataDir, fileName);
  await mkdir(dataDir, { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporaryPath, filePath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}
