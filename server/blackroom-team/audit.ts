// Audit trail of who ran which Black Room agent / action (owner or partner).
// Stored next to the agents' own JSON state (clippers_workspace/ is gitignored). Bounded, atomic.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BlackRoomTeamActor, BlackRoomTeamAgentId } from "@shared/blackroom-team";

export const BLACKROOM_TEAM_AUDIT_FILE = "audit.json";
export const BLACKROOM_TEAM_AUDIT_MAX = 500;

export type BlackRoomTeamAuditEntry = {
  at: string;
  agentId: BlackRoomTeamAgentId;
  /** "run" or the action name, e.g. "approve". */
  operation: string;
  actor: BlackRoomTeamActor;
  ok: boolean;
  /** Item the action targeted, when the input names one (e.g. a publisher post id). */
  targetId?: string;
  summary: string;
};

const queues = new Map<string, Promise<void>>();

export async function readBlackRoomTeamAudit(dataDir: string): Promise<BlackRoomTeamAuditEntry[]> {
  try {
    const parsed = JSON.parse(await readFile(path.join(dataDir, BLACKROOM_TEAM_AUDIT_FILE), "utf8"));
    return Array.isArray(parsed?.entries) ? parsed.entries : [];
  } catch (error: any) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

/** Appends one entry (serialized per data dir, oldest entries dropped past the bound). */
export function appendBlackRoomTeamAudit(dataDir: string, entry: BlackRoomTeamAuditEntry): Promise<void> {
  const filePath = path.join(dataDir, BLACKROOM_TEAM_AUDIT_FILE);
  const work = async () => {
    const entries: BlackRoomTeamAuditEntry[] = await readBlackRoomTeamAudit(dataDir).catch((): BlackRoomTeamAuditEntry[] => []);
    entries.push({ ...entry, summary: entry.summary.slice(0, 200) });
    await mkdir(dataDir, { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify({ version: 1, entries: entries.slice(-BLACKROOM_TEAM_AUDIT_MAX) }, null, 2)}\n`, "utf8");
      await rename(temporaryPath, filePath);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  };
  const previous = queues.get(filePath) ?? Promise.resolve();
  const next = previous.then(work, work);
  queues.set(filePath, next.catch(() => undefined));
  return next;
}
