// Black Room team module map and context factory.
// Each agent lives in its own file (server/blackroom-team/<id>.ts) implementing BlackRoomTeamAgentModule.
import path from "node:path";
import {
  BLACKROOM_TEAM_IDS,
  isBlackRoomTeamAgentId,
  parseBlackRoomTeamStatus,
  type BlackRoomLegacyMemberId,
  type BlackRoomTeamActor,
  type BlackRoomTeamAgentId,
  type BlackRoomTeamAgentModule,
  type BlackRoomTeamContext,
  type BlackRoomTeamEnv,
  type BlackRoomTeamMemberId,
  type BlackRoomTeamStatus,
} from "@shared/blackroom-team";
import { agentProbes, summarizeProbe, type AgentLiveStatus } from "@shared/agent-live-status";
import { BLACKROOM_TEAM_DATA_DIR, createBlackRoomTeamStateStore } from "./state";
import { getBlackRoomLessons } from "./lessons";
import ceo from "./blackroom-ceo";
import analytics from "./blackroom-analytics";
import competition from "./blackroom-competition";
import publisher from "./blackroom-publisher";
import scripts from "./blackroom-scripts";
import website from "./blackroom-website";

export const BLACKROOM_TEAM_MODULES: Readonly<Record<BlackRoomTeamAgentId, BlackRoomTeamAgentModule>> = {
  "blackroom-ceo": ceo,
  "blackroom-analytics": analytics,
  "blackroom-competition": competition,
  "blackroom-publisher": publisher,
  "blackroom-scripts": scripts,
  "blackroom-website": website,
};

export type BlackRoomTeamModules = Readonly<Record<BlackRoomTeamAgentId, BlackRoomTeamAgentModule>>;
export type LegacyMemberReader = (id: BlackRoomLegacyMemberId, userId: string | null) => Promise<BlackRoomTeamStatus | null>;

export type BlackRoomTeamContextOptions = {
  env?: BlackRoomTeamEnv;
  now?: () => Date;
  fetch?: typeof fetch;
  dataDir?: string;
  userId?: string | null;
  /** Who triggered the work (owner or partner), recorded by modules on approvals. */
  actor?: BlackRoomTeamActor | null;
  modules?: BlackRoomTeamModules;
  readLegacyMember?: LegacyMemberReader;
};

const READ_TIMEOUT_MS = 20_000;

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    work,
    new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error("sin respuesta a tiempo")), ms); }),
  ]).finally(() => clearTimeout(timer));
}

/** Converts an existing agent's office live status to the team contract. */
export function liveStatusToTeamStatus(id: BlackRoomTeamMemberId, status: AgentLiveStatus): BlackRoomTeamStatus {
  const state: BlackRoomTeamStatus["state"] =
    status.state === "working" || status.state === "available" ? "available"
      : status.state === "needs-setup" || status.state === "error" ? "blocked"
        : "idle";
  return { id, state, label: status.label, summary: status.detail || "", needs: status.problems || [], lastRunAt: null };
}

/** Reads blackroom-videos / radio from the same sources the agent council uses (read-only). */
export const readLegacyBlackRoomMember: LegacyMemberReader = async (id, userId) => {
  let body: unknown;
  if (id === "blackroom-videos") {
    const remoteModule = await import("../blackroom-remote-control");
    const routesModule = await import("../blackroom-control-routes");
    const { buildBlackRoomOfficeOperations } = await import("../blackroom-office-operations");
    const remote = await remoteModule.readBlackRoomRemoteControl();
    const remoteQueue = (remote as unknown as { device?: { queue?: Record<string, unknown> } }).device?.queue;
    const online = remoteModule.isBlackRoomRemoteDeviceOnline(remote);
    const local = await routesModule.readBlackRoomPanelQueue(remoteQueue as never);
    body = { agent: routesModule.resolveBlackRoomPanelAgent(local, remoteQueue as never, online), remote: { online }, operations: buildBlackRoomOfficeOperations(remote) };
  } else {
    if (!userId) return null;
    body = await (await import("../radio-agent")).getRadioSlotsForMonth(userId);
  }
  const live = summarizeProbe(agentProbes[id], { ok: true, status: 200, body: JSON.parse(JSON.stringify(body ?? null)) }, Date.now());
  return liveStatusToTeamStatus(id, live);
};

/**
 * Builds the context for one agent. Teammate reads are one level deep: a teammate read from
 * inside another agent's getStatus cannot read teammates again (no recursion between agents).
 */
export function createBlackRoomTeamContext(agentId: BlackRoomTeamAgentId, options: BlackRoomTeamContextOptions = {}, depth = 0): BlackRoomTeamContext {
  const dataDir = options.dataDir ?? path.resolve(process.cwd(), BLACKROOM_TEAM_DATA_DIR);
  const modules = options.modules ?? BLACKROOM_TEAM_MODULES;
  const readLegacy = options.readLegacyMember ?? readLegacyBlackRoomMember;
  const userId = options.userId ?? null;
  return {
    agentId,
    env: options.env ?? process.env,
    now: options.now ?? (() => new Date()),
    fetch: options.fetch ?? fetch,
    dataDir,
    userId,
    actor: options.actor ?? null,
    state: createBlackRoomTeamStateStore(dataDir, agentId),
    // Lessons learned from real outcomes; a store that cannot be read means "no lessons", never an error.
    readLessons: () => getBlackRoomLessons(agentId, { dataDir, now: options.now }).then((lessons) => lessons.rules).catch(() => []),
    async readTeammateStatus(id: BlackRoomTeamMemberId) {
      if (id === agentId || depth > 0) return null;
      try {
        if (isBlackRoomTeamAgentId(id)) {
          const status = await withTimeout(modules[id].getStatus(createBlackRoomTeamContext(id, options, depth + 1)), READ_TIMEOUT_MS);
          return parseBlackRoomTeamStatus(status);
        }
        if (id === "blackroom-videos" || id === "radio") return await withTimeout(readLegacy(id, userId), READ_TIMEOUT_MS);
        return null;
      } catch (error) {
        return { id, state: "blocked", label: "Con error", summary: error instanceof Error ? error.message.slice(0, 160) : "sin detalle", needs: [], lastRunAt: null };
      }
    },
  };
}

/** Status of one agent; a module that throws is reported as blocked with the error, never as working. */
export async function getBlackRoomTeamStatus(id: BlackRoomTeamAgentId, options: BlackRoomTeamContextOptions = {}): Promise<BlackRoomTeamStatus> {
  const modules = options.modules ?? BLACKROOM_TEAM_MODULES;
  try {
    const status = parseBlackRoomTeamStatus(await withTimeout(modules[id].getStatus(createBlackRoomTeamContext(id, options)), READ_TIMEOUT_MS));
    if (status && status.id === id) return status;
    return { id, state: "blocked", label: "Estado invalido", summary: "El modulo devolvio un estado con formato no valido.", needs: [], lastRunAt: null };
  } catch (error) {
    return { id, state: "blocked", label: "Con error", summary: error instanceof Error ? error.message.slice(0, 160) : "sin detalle", needs: [], lastRunAt: null };
  }
}

export async function getAllBlackRoomTeamStatuses(options: BlackRoomTeamContextOptions = {}): Promise<BlackRoomTeamStatus[]> {
  return Promise.all(BLACKROOM_TEAM_IDS.map((id) => getBlackRoomTeamStatus(id, options)));
}
