// KONG operations service: durable state + serialized, revision-checked changes.
// The office only coordinates (cards -> Videos KONG, publisher lease, UUID ledger, metrics).
// It never publishes: nothing here imports or calls a publishing client.
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  claimLease,
  deliverCards,
  emptyKongOperations,
  kongOperationsStatus,
  measurePublications,
  parseKongOperations,
  planPublication,
  reconcileByUuid,
  recordAttempt,
  releaseLease,
  type ExternalPost,
  type KongOperationsState,
  type PostMetricsRow,
} from "@shared/kong-operations";
import { resolveDatabaseConnectionString } from "./database-url";

export type KongOpsStore = {
  read: () => Promise<{ raw: string | null; revision: number | null }>;
  write: (raw: string, expectedRevision: number | null) => Promise<number>;
};
export class KongOpsStateConflict extends Error {}

const STATE_OWNER = "kong-operations";
const STATE_KIND = "ops_state";
const DB_TIMEOUT_MS = 10_000;
const FILE = path.join(process.env.AGENT_COUNCIL_DATA_DIR || path.join(process.cwd(), "agent_council_data"), "kong-operations.json");

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`sin respuesta en ${ms / 1000}s`)), ms); })]).finally(() => clearTimeout(timer));
}

/** Production: Postgres (existing revenue_engine_state table, own owner key, no migration). Locally: a file. */
export function defaultKongOpsStore(): KongOpsStore {
  let hasDatabase = false;
  try {
    hasDatabase = Boolean(resolveDatabaseConnectionString());
  } catch {
    hasDatabase = false;
  }
  if (!hasDatabase) {
    let revision = 0;
    return {
      read: async () => ({ raw: await readFile(FILE, "utf8").catch(() => null), revision }),
      write: async (raw, expected) => {
        if (expected !== null && expected !== revision) throw new KongOpsStateConflict("state conflict");
        await mkdir(path.dirname(FILE), { recursive: true });
        const tmp = `${FILE}.${process.pid}.${randomUUID()}.tmp`;
        await writeFile(tmp, raw, "utf8");
        await rename(tmp, FILE);
        return ++revision;
      },
    };
  }
  const adapter = async () => {
    const [{ db }, { createDrizzleRevenueEngineStateAdapter }] = await Promise.all([import("./db"), import("./revenue-engine-state-store")]);
    return createDrizzleRevenueEngineStateAdapter(db);
  };
  return {
    async read() {
      const rows = await withTimeout((await adapter()).loadCollections(STATE_OWNER), DB_TIMEOUT_MS);
      const row = rows.find((item) => item.kind === STATE_KIND);
      return row ? { raw: JSON.stringify(row.data), revision: row.revision } : { raw: null, revision: null };
    },
    async write(raw, expectedRevision) {
      try {
        const row = await withTimeout(
          (await adapter()).upsertCollection({ ownerUserId: STATE_OWNER, kind: STATE_KIND, data: JSON.parse(raw), ...(expectedRevision === null ? {} : { expectedRevision }), updatedAt: new Date() }),
          DB_TIMEOUT_MS
        );
        return row.revision;
      } catch (error) {
        if (error instanceof Error && /state conflict/i.test(error.message)) throw new KongOpsStateConflict(error.message);
        throw error;
      }
    },
  };
}

export function createKongOperations(deps: { store: KongOpsStore; now: () => number }) {
  let queue: Promise<unknown> = Promise.resolve();

  async function load(): Promise<KongOperationsState> {
    return parseKongOperations(JSON.parse((await deps.store.read()).raw || "null"));
  }

  // Every change re-reads the latest revision; a concurrent writer causes a retry, never an overwrite.
  function mutate<R>(change: (state: KongOperationsState) => { state: KongOperationsState; result: R }): Promise<R> {
    const job = queue.then(async () => {
      for (let attempt = 0; ; attempt++) {
        const { raw, revision } = await deps.store.read();
        const current = parseKongOperations(JSON.parse(raw || "null"));
        const { state, result } = change(current);
        if (state === current) return result;
        try {
          await deps.store.write(JSON.stringify(state), revision);
          return result;
        } catch (error) {
          if (!(error instanceof KongOpsStateConflict) || attempt >= 2) throw error;
        }
      }
    });
    queue = job.catch(() => undefined);
    return job as Promise<R>;
  }

  return {
    async view() {
      const state = await load();
      return { ...state, status: kongOperationsStatus(state, deps.now()) };
    },
    deliver: (cards: unknown[]) =>
      mutate((state) => {
        const out = deliverCards(state, cards, deps.now());
        return { state: out.state, result: { delivered: out.delivered, duplicates: out.duplicates, rejected: out.rejected } };
      }),
    claim: (holder: string, leaseId: string) => mutate((state) => { const next = claimLease(state, holder, leaseId, deps.now()); return { state: next, result: next.lease }; }),
    release: (holder: string, leaseId: string) => mutate((state) => { const next = releaseLease(state, holder, leaseId, deps.now()); return { state: next, result: next.lease }; }),
    plan: (input: Parameters<typeof planPublication>[1]) =>
      mutate((state) => { const next = planPublication(state, input, deps.now()); return { state: next, result: next.publications.find((item) => item.uuid === input.uuid) || null }; }),
    attempt: (input: Parameters<typeof recordAttempt>[1]) =>
      mutate((state) => { const next = recordAttempt(state, input, deps.now()); return { state: next, result: next.publications.find((item) => item.uuid === input.uuid) || null }; }),
    reconcile: (posts: ExternalPost[]) =>
      mutate((state) => { const out = reconcileByUuid(state, posts, deps.now()); return { state: out.state, result: { confirmed: out.confirmed, retryable: out.retryable, duplicates: out.duplicates } }; }),
    measure: (rows: PostMetricsRow[]) =>
      mutate((state) => { const next = measurePublications(state, rows, deps.now()); return { state: next, result: next.results }; }),
  };
}

let instance: ReturnType<typeof createKongOperations> | null = null;
export function getKongOperations() {
  instance ||= createKongOperations({ store: defaultKongOpsStore(), now: () => Date.now() });
  return instance;
}

export { emptyKongOperations };
