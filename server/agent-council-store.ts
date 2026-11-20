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

/** owner_key column value for a logical council owner (rows are keyed by its SHA-256). */
export function councilOwnerKey(owner: string): string {
  if (!owner?.trim()) throw new Error("Council owner required");
  return createHash("sha256").update(owner).digest("hex");
}

// Schema creation/import is an explicit deployment step, never a request side effect.
export function createCouncilStore(pool: CouncilPool) {
  const key = councilOwnerKey;
  return {
    async read(owner: string): Promise<string | null> {
      const client = await pool.connect();
      try {
        const result = await client.query("SELECT state FROM agent_council_state WHERE owner_key = $1", [key(owner)]);
        return result.rows[0] ? JSON.stringify(result.rows[0].state) : null;
      } finally { client.release(); }
    },
    async transact(owner: string, update: (raw: string | null) => Promise<string>): Promise<string> {
      // The Replit council and the cloud office round both update the same owner row on the same
      // 15-minute boundaries. A lock wait that hits lock_timeout (SQLSTATE 55P03) happens BEFORE
      // `update` runs, so the whole transaction can be retried safely; any later error is final.
      for (let attempt = 1; ; attempt++) {
        try {
          return await transactOnce(owner, update);
        } catch (error) {
          if ((error as { code?: unknown })?.code !== "55P03" || (error as { updateStarted?: boolean }).updateStarted || attempt >= LOCK_RETRY_ATTEMPTS) throw error;
          await new Promise(resolve => setTimeout(resolve, lockRetryDelayMs(attempt)));
        }
      }
    },
  };
  async function transactOnce(owner: string, update: (raw: string | null) => Promise<string>): Promise<string> {
      const client = await pool.connect();
      let updateStarted = false;
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL lock_timeout = '10s'");
        await client.query("SET LOCAL statement_timeout = '30s'");
        // A holder that stalls (network or other-pool IO inside the update) is cut off by the server
        // instead of blocking every other council writer until it finishes.
        await client.query(`SET LOCAL idle_in_transaction_session_timeout = '${COUNCIL_IDLE_IN_TRANSACTION_MS}ms'`);
        // Lock even an absent row; every instance reads after acquiring the same owner lock.
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [key(owner)]);
        const result = await client.query("SELECT state FROM agent_council_state WHERE owner_key = $1 FOR UPDATE", [key(owner)]);
        updateStarted = true;
        const raw = await update(result.rows[0] ? JSON.stringify(result.rows[0].state) : null);
        JSON.parse(raw);
        await client.query("INSERT INTO agent_council_state(owner_key, state) VALUES ($1, $2::jsonb) ON CONFLICT(owner_key) DO UPDATE SET state = EXCLUDED.state, updated_at = CURRENT_TIMESTAMP", [key(owner), raw]);
        await client.query("COMMIT");
        return raw;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        if (updateStarted && error && typeof error === "object") (error as { updateStarted?: boolean }).updateStarted = true;
        throw error;
      } finally { client.release(); }
  }
}

const LOCK_RETRY_ATTEMPTS = 4;
/** Server-side cap on "idle in transaction" for council connections (30 s). */
export const COUNCIL_IDLE_IN_TRANSACTION_MS = 30_000;
/** 2-4 s, 4-8 s, 8-16 s: spreads colliding writers apart without exceeding the office budget. */
export function lockRetryDelayMs(attempt: number, random: () => number = Math.random): number {
  const base = 2_000 * 2 ** (attempt - 1);
  return Math.round(base + base * random());
}

/** Non-secret label so owner-lock diagnostics (pg_stat_activity) show which host holds the lock. */
export function councilApplicationName(env: Readonly<Record<string, string | undefined>> = process.env, role = "council"): string {
  return blackopsApplicationName(role, env);
}

/** application_name for every BlackOps PostgreSQL pool: `blackops-<role>:<host>` (non-secret, <= 63 chars). */
export function blackopsApplicationName(role: string, env: Readonly<Record<string, string | undefined>> = process.env): string {
  const safeRole = role.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24) || "pool";
  const source = env.GITHUB_ACTIONS === "true" ? `gha-${(env.GITHUB_JOB || "job").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32)}`
    : env.REPLIT_DEPLOYMENT ? "replit-web" : env.REPL_ID ? "replit-dev" : "local";
  return `blackops-${safeRole}:${source}`.slice(0, 63);
}

/** The same bounded PostgreSQL pool the council store uses (DATABASE_URL). */
export async function createCouncilPool(role = "council"): Promise<CouncilPool> {
  const [{ Pool }, { resolveDatabaseConnectionString }] = await Promise.all([import("pg"), import("./database-url")]);
  return new Pool(councilPoolConfig(resolveDatabaseConnectionString(), role));
}

/** Pool settings shared by every council connection (named, bounded, idle-in-transaction capped). */
export function councilPoolConfig(connectionString: string | undefined, role = "council", env: Readonly<Record<string, string | undefined>> = process.env) {
  return { connectionString, allowExitOnIdle: true, max: 2, connectionTimeoutMillis: 10000, statement_timeout: 30000,
    idle_in_transaction_session_timeout: COUNCIL_IDLE_IN_TRANSACTION_MS, application_name: councilApplicationName(env, role) };
}

let store: ReturnType<typeof createCouncilStore> | undefined;
export async function getCouncilStore() {
  if (!store) store = createCouncilStore(await createCouncilPool());
  return store;
}
