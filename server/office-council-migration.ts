import { createHash } from "node:crypto";
import { councilSchemaSql, type CouncilClient } from "./agent-council-store";
import { parseRoleLifecycleState } from "../shared/office-role-lifecycle";

/** Caller owns a transaction and must quiesce legacy writers before applying.
 * Never normalizes, deletes or overwrites history. Revision drift fails closed. */
export async function importOfficeCouncilHistory(client: CouncilClient, owner: string, expectedRevision: number) {
  if (!owner?.trim() || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new Error("COUNCIL_IMPORT_CONFIGURATION_REQUIRED");
  const key = createHash("sha256").update(owner).digest("hex");
  await client.query(councilSchemaSql);
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [key]);
  const source = await client.query("SELECT data, revision FROM revenue_engine_state WHERE owner_user_id=$1 AND kind=$2 FOR UPDATE", ["agent-council", "council_state"]);
  const row = source.rows[0];
  const data = row?.data as Record<string, any> | undefined;
  const object = (value: unknown) => value !== null && typeof value === "object" && !Array.isArray(value);
  if (source.rows.length !== 1 || row.revision !== expectedRevision || !data || !object(data) || data.version !== 1 ||
      !Array.isArray(data.debates) || !Array.isArray(data.proposals) || !object(data.scout) ||
      !object(data.company) || data.company.version !== 1 || !object(data.company.careers) ||
      !Array.isArray(data.company.trainees) || !Array.isArray(data.company.orders) ||
      (data.company.academyJobs !== undefined && !Array.isArray(data.company.academyJobs))) throw new Error("COUNCIL_IMPORT_SOURCE_CHANGED");
  if (data.officeExecution !== undefined) {
    if (!object(data.officeExecution) || !object(data.officeExecution.tokens)) throw new Error("COUNCIL_IMPORT_SOURCE_CHANGED");
    try { parseRoleLifecycleState(data.officeExecution.roles); } catch { throw new Error("COUNCIL_IMPORT_SOURCE_CHANGED"); }
  }
  const destination = await client.query("SELECT owner_key FROM agent_council_state WHERE owner_key=$1 FOR UPDATE", [key]);
  if (destination.rows.length) throw new Error("COUNCIL_IMPORT_DESTINATION_EXISTS");
  await client.query("INSERT INTO agent_council_state(owner_key,state) VALUES($1,$2::jsonb)", [key, JSON.stringify(data)]);
  const verified = await client.query("SELECT state = $2::jsonb AS identical FROM agent_council_state WHERE owner_key=$1", [key, JSON.stringify(data)]);
  if (verified.rows.length !== 1 || verified.rows[0].identical !== true) throw new Error("COUNCIL_IMPORT_VERIFICATION_FAILED");
  return { sourceRevision: expectedRevision, careers: Object.keys(data.company.careers).length, trainees: data.company.trainees.length,
    orders: data.company.orders.length, historyCopiedExactly: true, legacyHistoryRetained: true };
}
