import { createHash } from "node:crypto";

export const councilSchemaSql = `CREATE TABLE IF NOT EXISTS agent_council_state (
  owner_key text PRIMARY KEY,
  state jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);`;

export interface CouncilClient {
  query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  release(): void;
}
export interface CouncilPool { connect(): Promise<CouncilClient> }

// Schema creation/import is an explicit deployment step, never a request side effect.
export function createCouncilStore(pool: CouncilPool) {
  const key = (owner: string) => {
    if (!owner?.trim()) throw new Error("Council owner required");
    return createHash("sha256").update(owner).digest("hex");
  };
  return {
    async read(owner: string): Promise<string | null> {
      const client = await pool.connect();
      try {
        const result = await client.query("SELECT state FROM agent_council_state WHERE owner_key = $1", [key(owner)]);
        return result.rows[0] ? JSON.stringify(result.rows[0].state) : null;
      } finally { client.release(); }
    },
    async transact(owner: string, update: (raw: string | null) => Promise<string>): Promise<string> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL lock_timeout = '10s'");
        await client.query("SET LOCAL statement_timeout = '30s'");
        // Lock even an absent row; every instance reads after acquiring the same owner lock.
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [key(owner)]);
        const result = await client.query("SELECT state FROM agent_council_state WHERE owner_key = $1 FOR UPDATE", [key(owner)]);
        const raw = await update(result.rows[0] ? JSON.stringify(result.rows[0].state) : null);
        JSON.parse(raw);
        await client.query("INSERT INTO agent_council_state(owner_key, state) VALUES ($1, $2::jsonb) ON CONFLICT(owner_key) DO UPDATE SET state = EXCLUDED.state, updated_at = CURRENT_TIMESTAMP", [key(owner), raw]);
        await client.query("COMMIT");
        return raw;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally { client.release(); }
    },
  };
}

let store: ReturnType<typeof createCouncilStore> | undefined;
export async function getCouncilStore() {
  if (!store) {
    const [{ Pool }, { resolveDatabaseConnectionString }] = await Promise.all([import("pg"), import("./database-url")]);
    store = createCouncilStore(new Pool({ connectionString: resolveDatabaseConnectionString(), allowExitOnIdle: true, max: 2, connectionTimeoutMillis: 10000, statement_timeout: 30000 }));
  }
  return store;
}
