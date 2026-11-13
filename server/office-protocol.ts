import { createHash } from "node:crypto";

export const OFFICE_PROTOCOL_VERSION = 2;
const revision = /^[a-f0-9]{40}$/;
export const officeProtocolSchemaSql = `CREATE TABLE IF NOT EXISTS office_protocol_rollouts (
  owner_key text PRIMARY KEY CHECK (owner_key ~ '^[a-f0-9]{64}$'),
  protocol_version integer NOT NULL,
  web_revision text NOT NULL CHECK (web_revision ~ '^[a-f0-9]{40}$'),
  storage_mode text NOT NULL CHECK (storage_mode = 'postgres'),
  old_instances_drained boolean NOT NULL CHECK (old_instances_drained),
  verified_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);`;

export interface OfficeProtocolPool {
  query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

/** An operator records the rollout only after observing the published protocol,
 * draining legacy writers and copying history into the dedicated council store.
 * This is a durable deployment attestation, not a web liveness signal: Autoscale
 * may sleep while the PC worker continues. Disable workers before a rollback. */
export async function assertOfficeProtocolReady(pool: OfficeProtocolPool, owner: string, expectedRevision: string) {
  if (!owner?.trim() || !revision.test(expectedRevision)) throw new Error("OFFICE_PROTOCOL_CONFIGURATION_REQUIRED");
  const ownerKey = createHash("sha256").update(owner).digest("hex");
  let rows: Record<string, unknown>[];
  try {
    ({ rows } = await pool.query(`SELECT r.protocol_version, r.web_revision, r.storage_mode, r.old_instances_drained,
      r.verified_at, CURRENT_TIMESTAMP AS database_now, c.owner_key AS council_owner
      FROM office_protocol_rollouts r LEFT JOIN agent_council_state c ON c.owner_key = r.owner_key
      WHERE r.owner_key = $1`, [ownerKey]));
  } catch { throw new Error("OFFICE_PROTOCOL_UNAVAILABLE"); }
  const row = rows[0];
  const verified = row?.verified_at instanceof Date ? row.verified_at.getTime() : Date.parse(String(row?.verified_at));
  const databaseNow = row?.database_now instanceof Date ? row.database_now.getTime() : Date.parse(String(row?.database_now));
  if (rows.length !== 1 || row.protocol_version !== OFFICE_PROTOCOL_VERSION || row.web_revision !== expectedRevision ||
      row.storage_mode !== "postgres" || row.old_instances_drained !== true || row.council_owner !== ownerKey ||
      !Number.isFinite(verified) || !Number.isFinite(databaseNow) || verified > databaseNow) {
    throw new Error("OFFICE_PROTOCOL_ROLLOUT_NOT_VERIFIED");
  }
}

export function officeWebProtocol(env: NodeJS.ProcessEnv = process.env) {
  return { version: OFFICE_PROTOCOL_VERSION, revision: revision.test(env.OFFICE_WEB_REVISION || "") ? env.OFFICE_WEB_REVISION : null,
    councilStorage: env.AGENT_COUNCIL_STORAGE === "postgres" ? "postgres" : "legacy" };
}
