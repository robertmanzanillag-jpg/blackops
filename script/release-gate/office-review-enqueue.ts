import "../../server/env-loader";
import { createHash } from "node:crypto";
import pg from "pg";
import { createOfficeCloudStore, type OfficeCloudPool } from "../../server/office-cloud-store";

// Second, independent reviewer for a PR: enqueue ONE office `claude_review` job for a PR through the
// same store path the web app and the factory use (createOfficeCloudStore().submit). The next office
// cloud cycle claims it and records a pass/block verdict in the Agents Office.
//
// The queued task carries only the PR URL: the head SHA seen at dispatch time is used solely to
// derive the idempotency key (one job per PR head). The reviewer fetches whatever head the PR has
// when it runs, so the verdict's `review.headSha` MUST be compared with the head being merged; a
// verdict for another SHA does not approve it (dispatch again for the new head).
//
//   default   read-only: BEGIN TRANSACTION READ ONLY, checks the queue table, always rolled back
//   --apply   enqueues (idempotent per PR URL + head SHA: dispatching the same head twice returns
//             the existing job instead of creating a second one)
//
// Public logs: prints only static JSON (applied flag, job status, timestamps, counts), never ids,
// connection details, owner values or provider output.
const PR_URL = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9][0-9]*$/;
const SHA = /^[a-f0-9]{40}$/;

export function parseArgs(argv: string[]) {
  const value = (name: string) => argv.find(arg => arg.startsWith(`${name}=`))?.slice(name.length + 1);
  const known = new Set(["--apply"]);
  for (const arg of argv) if (!known.has(arg) && !/^--(pr-url|head-sha)=/.test(arg)) throw new Error("ARGUMENT_INVALID");
  const prUrl = value("--pr-url") ?? "";
  const headSha = (value("--head-sha") ?? "").toLowerCase();
  if (!PR_URL.test(prUrl)) throw new Error("PR_URL_INVALID");
  if (!SHA.test(headSha)) throw new Error("HEAD_SHA_INVALID");
  return { prUrl, headSha, apply: argv.includes("--apply") };
}

/** Deterministic UUID-shaped idempotency key for (PR, head): one review per exact head. */
export function reviewKey(prUrl: string, headSha: string): string {
  const digest = createHash("sha256").update(`release-gate:office-review:v1:${prUrl}:${headSha}`).digest();
  digest[6] = (digest[6] & 0x0f) | 0x40;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = digest.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function main() {
  const { prUrl, headSha, apply } = parseArgs(process.argv.slice(2));
  const owner = (process.env.DEFAULT_USER_ID ?? "").trim();
  if (!owner) throw new Error("DEFAULT_USER_ID_REQUIRED");
  if (!process.env.DATABASE_URL?.trim()) throw new Error("DATABASE_URL_REQUIRED");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000, max: 1 });
  pool.on("error", () => undefined);
  try {
    if (!apply) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN TRANSACTION READ ONLY");
        const table = await client.query("SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='agent_office_cloud_jobs'");
        const pending = table.rows.length
          ? Number((await client.query("SELECT count(*)::int AS count FROM agent_office_cloud_jobs WHERE status='pending' AND input->>'kind'='claude_review'")).rows[0]?.count ?? 0)
          : null;
        await client.query("ROLLBACK");
        console.log(JSON.stringify({ applied: false, readOnly: true, queueReady: table.rows.length === 1, pendingReviews: pending }));
      } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
      finally { client.release(); }
      return;
    }
    const store = createOfficeCloudStore({ pool: pool as unknown as OfficeCloudPool });
    const run = await store.submit(owner, { kind: "claude_review", prUrl, key: reviewKey(prUrl, headSha) });
    console.log(JSON.stringify({ applied: true, status: run.status, createdAt: run.createdAt, idempotent: true }));
  } finally { await pool.end(); }
}

if (process.argv[1] && /office-review-enqueue\.ts$/.test(process.argv[1])) {
  void main().catch(error => {
    const code = error instanceof Error && /^[A-Z][A-Z0-9_]{2,60}$/.test(error.message) ? error.message : (error as { code?: unknown })?.code && /^[A-Z_]{3,40}$/.test(String((error as { code?: unknown }).code)) ? String((error as { code?: unknown }).code) : "OFFICE_REVIEW_ENQUEUE_FAILED";
    console.error(JSON.stringify({ error: "Office review enqueue failed; no credentials or database details are logged.", code }));
    process.exitCode = 1;
  });
}
