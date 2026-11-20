/**
 * Owner-lock contention (SQLSTATE 55P03 lock_not_available) in the bounded
 * cloud office run. Council writes wait at most 10 s for the owner lock
 * (agent-council-store lock_timeout); when another connection (e.g. the
 * Replit web or the factory) holds it longer, the transaction is rolled back
 * before writing anything. That is a "try again next cycle", not uncertain
 * work, so the academy/capability steps skip the cycle instead of ending the
 * whole run as "unconfirmed".
 */

export function isLockNotAvailable(error: unknown, depth = 0): boolean {
  if (error === null || typeof error !== "object" || depth > 4) return false;
  try {
    const code = Object.getOwnPropertyDescriptor(error, "code")?.value;
    if (code === "55P03") return true;
    const cause = Object.getOwnPropertyDescriptor(error, "cause")?.value;
    return cause !== undefined && isLockNotAvailable(cause, depth + 1);
  } catch { return false; }
}

/** True when the error or any error in its cause chain marks a council update as already started. */
export function councilUpdateStarted(error: unknown, depth = 0): boolean {
  if (error === null || typeof error !== "object" || depth > 4) return false;
  try {
    if (Object.getOwnPropertyDescriptor(error, "updateStarted")?.value === true) return true;
    const cause = Object.getOwnPropertyDescriptor(error, "cause")?.value;
    return cause !== undefined && councilUpdateStarted(cause, depth + 1);
  } catch { return true; }
}

/** 55P03 raised before any council update callback ran (nothing was written): safe to retry next cycle. */
export function isRetryableLockContention(error: unknown): boolean {
  return isLockNotAvailable(error) && !councilUpdateStarted(error);
}

export interface LockHolder { pid: number; application: string; state: string; granted: boolean; xactSeconds: number | null }
export interface LockDiagnosticsClient { query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> }

/** Who holds/waits on the council owner lock. No query text, user, host or key is reported. */
export async function describeOwnerLockHolders(client: LockDiagnosticsClient, councilOwnerKeyHex: string): Promise<LockHolder[]> {
  const { rows } = await client.query(`/*office:owner-lock-diagnostics*/ SELECT a.pid, COALESCE(NULLIF(a.application_name, ''), 'unnamed') AS application,
 COALESCE(a.state, 'unknown') AS state, l.granted, EXTRACT(EPOCH FROM (clock_timestamp() - a.xact_start))::int AS xact_seconds
 FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid, (SELECT hashtextextended($1, 0) AS k) h
 WHERE l.locktype = 'advisory' AND l.objsubid = 1
   AND l.classid = ((h.k >> 32) & 4294967295)::oid AND l.objid = (h.k & 4294967295)::oid
 ORDER BY l.granted DESC, a.xact_start NULLS LAST LIMIT 10`, [councilOwnerKeyHex]);
  return rows.map(row => ({
    pid: Number(row.pid),
    application: String(row.application).replace(/[^A-Za-z0-9_.:@ -]/g, "?").slice(0, 64),
    state: String(row.state).slice(0, 32),
    granted: row.granted === true,
    xactSeconds: row.xact_seconds === null || row.xact_seconds === undefined ? null : Number(row.xact_seconds),
  }));
}

/**
 * Wrap an office step: a 55P03 is logged (with lock holders when available)
 * and the step resolves, so the run retries it on its next cycle. Any other
 * error propagates unchanged (and still ends the run as "unconfirmed").
 */
export function skipOnOwnerLockTimeout(step: string, run: () => Promise<void>, diagnose: () => Promise<LockHolder[]>, log: (line: string) => void = console.error): () => Promise<void> {
  return async () => {
    try {
      await run();
    } catch (error) {
      if (!isRetryableLockContention(error)) throw error;
      let holders: LockHolder[] | "unavailable" = "unavailable";
      try { holders = await diagnose(); } catch { /* diagnostics are best effort */ }
      log(JSON.stringify({ event: "office_owner_lock_busy", step, action: "skipped_cycle_will_retry", holders }));
    }
  };
}
