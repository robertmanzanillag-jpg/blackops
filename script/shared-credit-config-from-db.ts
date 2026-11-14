// Derives the worker's shared-credit configuration ({ grant, pricing }, the same JSON that
// `shared-credit-grant.ts config` prints as CONFIG_JSON) from the EXISTING ledger in the database,
// so the office/factory workflows do not need the OPENAI_SHARED_CREDIT_CONFIG_JSON secret.
//
//   node --import tsx script/shared-credit-config-from-db.ts --out=PATH
//
// Environment: DATABASE_URL (required); OFFICE_SHARED_CREDIT_SCOPE (optional; otherwise the single
// ledger with a present, unexpired grant is discovered); pricing from OFFICE_SHARED_CREDIT_PRICING_MODEL
// (default OFFICE_OPENAI_MODEL), OFFICE_SHARED_CREDIT_INPUT_USD_PER_MILLION,
// OFFICE_SHARED_CREDIT_OUTPUT_USD_PER_MILLION and OFFICE_SHARED_CREDIT_PRICING_VALID_UNTIL.
//
// Read-only: one READ ONLY transaction, never writes. CI logs are public, so it prints only static
// status lines and static error codes: never the grant, the scope, the file or the connection string.
import { writeFileSync } from "node:fs";
import { councilOwnerKey, createCouncilPool, type CouncilPool } from "../server/agent-council-store";
import type { VerifiedCreditGrant } from "../server/shared-openai-credit-ledger";
import { buildPricing, identifier, ledgerOwner } from "./shared-credit-grant";

type Env = Record<string, string | undefined>;
interface LedgerRow { ownerKey: string; grant: unknown }

const value = (env: Env, name: string) => env[name]?.trim() || undefined;

export function pricingFromEnv(env: Env) {
  const options: Record<string, string> = {};
  const set = (key: string, name: string) => { const v = value(env, name); if (v !== undefined) options[key] = v; };
  set("model", "OFFICE_OPENAI_MODEL");
  set("model", "OFFICE_SHARED_CREDIT_PRICING_MODEL");
  set("input-usd-per-million", "OFFICE_SHARED_CREDIT_INPUT_USD_PER_MILLION");
  set("output-usd-per-million", "OFFICE_SHARED_CREDIT_OUTPUT_USD_PER_MILLION");
  set("pricing-valid-until", "OFFICE_SHARED_CREDIT_PRICING_VALID_UNTIL");
  return buildPricing(options);
}

/** Every council row that holds a grant object with an accountScope (only the grant is read). */
export async function readLedgerRows(pool: CouncilPool, scope?: string): Promise<LedgerRow[]> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    try {
      await client.query("SET LOCAL statement_timeout = '30s'");
      const filter = "jsonb_typeof(state->'grant') = 'object' AND state->'grant'->>'accountScope' IS NOT NULL";
      const result = scope === undefined
        ? await client.query(`SELECT owner_key, state->'grant' AS grant FROM agent_council_state WHERE ${filter}`)
        : await client.query(`SELECT owner_key, state->'grant' AS grant FROM agent_council_state WHERE owner_key = $1`, [councilOwnerKey(ledgerOwner(scope))]);
      await client.query("COMMIT");
      return result.rows.map(row => ({ ownerKey: String(row.owner_key), grant: row.grant }));
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  } finally { client.release(); }
}

function asGrant(raw: unknown): VerifiedCreditGrant | null {
  if (!raw || typeof raw !== "object") return null;
  const grant = raw as VerifiedCreditGrant;
  return typeof grant.accountScope === "string" && identifier.test(grant.accountScope) && typeof grant.expiresAt === "string" ? grant : null;
}
const unexpired = (grant: VerifiedCreditGrant, now: Date) => {
  const expiresAt = Date.parse(grant.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt > now.getTime();
};

/** Picks the ledger grant: the configured scope, else exactly one unexpired shared-credit ledger. */
export function selectGrant(rows: LedgerRow[], now: Date, scope?: string): VerifiedCreditGrant {
  if (scope !== undefined) {
    const row = rows.find(r => r.ownerKey === councilOwnerKey(ledgerOwner(scope)));
    const grant = asGrant(row?.grant);
    if (!grant) throw Error("LEDGER_NOT_INITIALIZED");
    if (grant.accountScope !== scope) throw Error("SCOPE_MISMATCH");
    if (!unexpired(grant, now)) throw Error("GRANT_EXPIRED");
    return grant;
  }
  // A row is a shared-credit ledger only if its key is the hash of the ledger owner for its own scope.
  const ledgers = rows.map(r => ({ r, grant: asGrant(r.grant) }))
    .filter(({ r, grant }) => grant && r.ownerKey === councilOwnerKey(ledgerOwner(grant.accountScope)))
    .map(({ grant }) => grant!);
  const live = ledgers.filter(grant => unexpired(grant, now));
  if (live.length === 0) throw Error(ledgers.length ? "GRANT_EXPIRED" : "LEDGER_NOT_FOUND");
  if (live.length > 1) throw Error("LEDGER_AMBIGUOUS: set OFFICE_SHARED_CREDIT_SCOPE");
  return live[0];
}

export async function deriveConfig(pool: CouncilPool, env: Env, now: Date) {
  const scope = value(env, "OFFICE_SHARED_CREDIT_SCOPE");
  if (scope !== undefined && !identifier.test(scope)) throw Error("SCOPE_INVALID");
  const pricing = pricingFromEnv(env);
  if (Date.parse(pricing.validUntil) <= now.getTime()) throw Error("PRICING_EXPIRED");
  const grant = selectGrant(await readLedgerRows(pool, scope), now, scope);
  return { config: { grant, pricing }, source: scope === undefined ? "discovered" : "configured" };
}

export function parseOut(argv: string[]): string {
  const match = argv.length === 1 ? /^--out=(.+)$/.exec(argv[0]) : null;
  if (!match) throw Error("USAGE: --out=PATH");
  return match[1];
}

export function writeConfig(path: string, config: unknown) {
  const previous = process.umask(0o077);
  try { writeFileSync(path, JSON.stringify(config), { mode: 0o600 }); } finally { process.umask(previous); }
}

export async function run(argv: string[], env: Env, connect: () => Promise<CouncilPool>, log: (line: string) => void, now = new Date()) {
  const out = parseOut(argv);
  if (!env.DATABASE_URL?.trim()) throw Error("DATABASE_URL_REQUIRED");
  const { config, source } = await deriveConfig(await connect(), env, now);
  writeConfig(out, config);
  log(`shared credit config: written (${source} ledger)`);
}

const main = () => run(process.argv.slice(2), process.env, createCouncilPool, line => console.log(line));

if (process.argv[1]?.endsWith("shared-credit-config-from-db.ts")) {
  void main().catch(error => {
    // Static codes only: never print driver errors, which can include connection details.
    const message = error instanceof Error && /^[A-Z_:]+[A-Za-z0-9_ :.-]*$/.test(error.message) ? error.message : "SHARED_CREDIT_CONFIG_FAILED";
    console.error(message);
    process.exitCode = 1;
  }).finally(() => setTimeout(() => process.exit(process.exitCode ?? 0), 100).unref());
}
