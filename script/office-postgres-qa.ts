import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";
import { createOfficeCloudSchemaSql, createOfficeCloudStore, OfficeCloudStoreError } from "../server/office-cloud-store";

// This QA entrypoint never accepts a database URL or loads application env
// files. Importing it does not start PostgreSQL or apply a migration.
const PORT = 54389;
const PREFIX = "office-pg-qa-";
const MARKER = ".office-pg-qa-owner";

function childEnvironment(): NodeJS.ProcessEnv {
  const allowed = new Set(["PATH", "HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "LD_LIBRARY_PATH", "LOCALE_ARCHIVE"]);
  const env: NodeJS.ProcessEnv = {};
  for (const key of allowed) if (process.env[key] !== undefined) env[key] = process.env[key];
  // No PG*, DATABASE_URL, API credentials, shell startup files or NODE_OPTIONS.
  return env;
}

async function command(executable: "initdb" | "pg_ctl", args: string[], timeoutMs: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, { shell: false, env: childEnvironment(), stdio: ["ignore", "pipe", "pipe"] });
    let bytes = 0;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeoutMs);
    const consume = (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 128 * 1024) { timedOut = true; child.kill("SIGKILL"); }
    };
    child.stdout.on("data", consume);
    child.stderr.on("data", consume);
    child.once("error", () => { clearTimeout(timer); reject(new Error("ISOLATED_POSTGRES_COMMAND_UNAVAILABLE")); });
    child.once("close", code => {
      clearTimeout(timer);
      if (code === 0 && !timedOut) resolve();
      else reject(new Error("ISOLATED_POSTGRES_COMMAND_FAILED"));
    });
  });
}

async function exists(filename: string): Promise<boolean> {
  try { await access(filename); return true; } catch { return false; }
}

export async function runOfficePostgresQa(): Promise<{ status: "passed"; checks: number }> {
  if (process.platform !== "linux" || process.getuid?.() === 0) throw new Error("ISOLATED_POSTGRES_QA_REQUIRES_NONROOT_LINUX");
  // This function belongs only in the dedicated QA process. node-postgres
  // consults PG* defaults even with an explicit config (password:'' is falsy).
  // Remove those process-local entries without reading, retaining or restoring
  // their values. No parent shell environment or configuration file is changed.
  for (const key of Object.keys(process.env)) if (/^PG/i.test(key) || key === "DATABASE_URL") delete process.env[key];
  const temporaryParent = await realpath(os.tmpdir());
  const root = await mkdtemp(path.join(temporaryParent, PREFIX));
  const marker = randomUUID();
  const data = path.join(root, "data");
  const socket = path.join(root, "socket");
  let pool: Pool | undefined;
  let checks = 0;
  let cleanupFailed = false;
  let markerWritten = false;

  const verifyOwnedRoot = async (): Promise<void> => {
    const canonicalRoot = await realpath(root);
    if (path.dirname(canonicalRoot) !== temporaryParent || !path.basename(canonicalRoot).startsWith(PREFIX) || canonicalRoot !== root ||
      !markerWritten || (await readFile(path.join(root, MARKER), "utf8")) !== marker) throw new Error("ISOLATED_POSTGRES_OWNERSHIP_UNVERIFIED");
  };
  const verifyOwnedData = async (): Promise<void> => {
    await verifyOwnedRoot();
    if ((await realpath(data)) !== data || path.dirname(data) !== root) throw new Error("ISOLATED_POSTGRES_DATA_OWNERSHIP_UNVERIFIED");
  };

  try {
    await chmod(root, 0o700);
    await writeFile(path.join(root, MARKER), marker, { encoding: "utf8", flag: "wx", mode: 0o600 });
    markerWritten = true;
    await verifyOwnedRoot();
    // pg_ctl passes postgres options through its native launcher. Restrict these
    // generated filesystem paths to literal, whitespace-free shell-safe paths.
    if (!/^[A-Za-z0-9_./-]+$/.test(root) || Buffer.byteLength(socket) > 95) throw new Error("ISOLATED_POSTGRES_TEMP_PATH_UNSUPPORTED");
    await mkdir(socket, { mode: 0o700 });
    await chmod(socket, 0o700);
    const user = os.userInfo().username;
    await command("initdb", ["-D", data, "--username", user, "--auth-local=trust", "--auth-host=reject", "--no-locale", "--encoding=UTF8"], 90_000);
    await verifyOwnedData();
    await chmod(data, 0o700);
    await command("pg_ctl", ["-D", data, "-l", path.join(root, "postgres.log"), "-w", "-t", "30", "-o", `-h '' -k ${socket} -p ${PORT} -c unix_socket_permissions=0700 -c max_connections=20 -c shared_buffers=16MB`, "start"], 40_000);

    // Every routing/authentication option is explicit. Inherited DATABASE_URL,
    // PGHOST, PGSERVICE, PGPASSWORD and existing application pools are unused.
    pool = new Pool({ host: socket, user, database: "postgres", port: PORT, password: "", ssl: false,
      max: 10, connectionTimeoutMillis: 5_000, statement_timeout: 5_000, query_timeout: 5_000,
      idleTimeoutMillis: 5_000, application_name: "isolated-office-postgres-qa" });
    await verifyOwnedData();
    const identity = (await pool.query("SELECT current_setting('data_directory') AS data_directory, current_setting('listen_addresses') AS listen_addresses, current_setting('unix_socket_directories') AS socket_directory, current_setting('unix_socket_permissions') AS socket_permissions, inet_server_addr() AS tcp_address")).rows[0];
    assert.equal(identity.data_directory, data);
    assert.equal(identity.listen_addresses, "");
    assert.equal(identity.socket_directory, socket);
    assert.equal(identity.socket_permissions, "0700");
    assert.equal(identity.tcp_address, null);
    checks++;

    // The first DDL is below, only after the live connection was proven to be
    // this newly initialized cluster with private sockets and TCP disabled.
    await pool.query(createOfficeCloudSchemaSql());
    const storeA = createOfficeCloudStore({ pool, leaseMs: 180_000 });
    const storeB = createOfficeCloudStore({ pool, leaseMs: 180_000 });
    const task = { kind: "claude_chat" as const, key: randomUUID(), message: "Isolated database fixture; no provider execution" };
    const duplicate = await Promise.all(Array.from({ length: 24 }, (_, index) => (index % 2 ? storeA : storeB).submit("qa-alice", task)));
    assert.equal(new Set(duplicate.map(run => run.id)).size, 1);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM agent_office_cloud_jobs")).rows[0].count, 1);
    checks++;

    await assert.rejects(storeB.submit("qa-alice", { ...task, message: "Mismatched request" }), (error: unknown) => error instanceof OfficeCloudStoreError && error.code === "IDEMPOTENCY_CONFLICT");
    checks++;
    const bob = await storeB.submit("qa-bob", task);
    assert.notEqual(bob.id, duplicate[0].id);
    assert.deepEqual((await storeA.list("qa-alice")).map(run => run.id), [duplicate[0].id]);
    assert.deepEqual((await storeB.list("qa-bob")).map(run => run.id), [bob.id]);
    assert.deepEqual(await storeA.list("qa-unrelated"), []);
    checks++;

    const claims = await Promise.all([storeA.claim("qa-worker-a"), storeB.claim("qa-worker-b")]);
    assert.ok(claims[0]?.fence && claims[1]?.fence);
    const first = claims[0]!;
    const second = claims[1]!;
    assert.notEqual(first.id, second.id);
    assert.equal(first.status, "running"); assert.equal(second.status, "running");
    assert.equal(await storeA.claim("qa-worker-empty"), undefined);
    checks++;

    const completed = { status: "completed" as const, text: "Database fixture receipt only", sessionId: "fixture-not-a-Claude-execution" };
    assert.equal(await storeA.complete(first.id, first.workerId!, randomUUID(), completed), undefined);
    assert.equal(await storeA.complete(first.id, "qa-wrong-worker", first.fence!, completed), undefined);
    assert.equal((await storeA.complete(first.id, first.workerId!, first.fence!, completed))?.status, "completed");
    assert.equal(await storeA.complete(first.id, first.workerId!, first.fence!, completed), undefined);
    checks++;

    await pool.query("UPDATE agent_office_cloud_jobs SET lease_expires_at=CURRENT_TIMESTAMP - interval '1 second' WHERE id=$1", [second.id]);
    assert.equal(await storeB.complete(second.id, second.workerId!, second.fence!, completed), undefined);
    assert.equal(await storeA.markExpiredUnknown(), 1);
    assert.equal(await storeB.markExpiredUnknown(), 0);
    const expiredOwner = second.id === bob.id ? "qa-bob" : "qa-alice";
    assert.equal((await storeB.submit(expiredOwner, task)).status, "unknown");
    assert.equal(await storeB.claim("qa-worker-no-retry"), undefined);
    checks++;

    const capabilityTime = new Date().toISOString();
    const capabilities = { claude: { status: "blocked" as const, reason: "QA fixture only; provider was not invoked", checkedAt: capabilityTime }, kong: { status: "blocked" as const, reason: "QA fixture only; provider was not invoked", checkedAt: capabilityTime } };
    await storeA.heartbeat("qa-worker-capabilities", capabilities);
    assert.deepEqual((await storeB.getHeartbeat())?.capabilities, capabilities);
    await storeB.heartbeat("qa-worker-capabilities");
    assert.deepEqual((await storeA.getHeartbeat())?.capabilities, capabilities);
    checks++;

    await Promise.all(Array.from({ length: 12 }, (_, index) =>
      (index % 2 ? storeA : storeB).enqueueScheduledKongAudit("qa-retention")));
    const scheduled = (await storeA.list("qa-retention"))[0];
    assert.equal((await storeB.list("qa-retention")).length, 1);
    assert.equal(scheduled.kind, "kong_audit");
    assert.equal(scheduled.source, "scheduled");
    const scheduledClaim = await storeB.claim("qa-worker-scheduled");
    assert.equal(scheduledClaim?.id, scheduled.id);
    assert.ok(scheduledClaim?.fence);
    await storeA.enqueueScheduledKongAudit("qa-retention");
    assert.equal(await storeA.claim("qa-worker-no-duplicate"), undefined);
    assert.equal((await storeB.complete(scheduled.id, "qa-worker-scheduled", scheduledClaim.fence, completed))?.source, "scheduled");
    await storeB.enqueueScheduledKongAudit("qa-retention");
    assert.deepEqual((await storeA.list("qa-retention")).map(run => run.id), [scheduled.id]);
    checks++;

    const retainedTask = { ...task, key: randomUUID() };
    const retained = await storeA.submit("qa-retention", retainedTask);
    for (let index = 0; index < 200; index++) await storeB.submit("qa-retention", { ...task, key: randomUUID(), message: `Retention fixture ${index}` });
    const history = await storeA.list("qa-retention");
    assert.equal(history.filter(run => run.source === "scheduled").length, 1);
    assert.equal(history.filter(run => run.source === undefined).length, 200);
    assert.equal((await storeB.submit("qa-retention", retainedTask)).id, retained.id);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM agent_office_cloud_jobs")).rows[0].count, 204);
    checks++;

    // Only in this owned cluster, age a completed automatic receipt and a
    // manual idempotency record to exercise the automatic retention boundary.
    await pool.query("UPDATE agent_office_cloud_jobs SET created_at=CURRENT_TIMESTAMP - interval '25 hours' WHERE id=ANY($1::uuid[])", [[scheduled.id, retained.id]]);
    await storeB.enqueueScheduledKongAudit("qa-retention");
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM agent_office_cloud_jobs WHERE id=$1", [scheduled.id])).rows[0].count, 0);
    assert.equal((await storeA.submit("qa-retention", retainedTask)).id, retained.id);
    checks++;
  } finally {
    if (pool) await pool.end().catch(() => { cleanupFailed = true; });
    try {
      await verifyOwnedRoot();
      if (await exists(data)) {
        await verifyOwnedData();
        if (await exists(path.join(data, "postmaster.pid"))) {
          await command("pg_ctl", ["-D", data, "-m", "fast", "-w", "-t", "20", "stop"], 25_000);
        }
      }
      // Never remove an unverified path or a cluster that failed to stop.
      await verifyOwnedRoot();
      if (await exists(path.join(data, "postmaster.pid"))) throw new Error("ISOLATED_POSTGRES_STILL_RUNNING");
      await rm(root, { recursive: true, force: false });
    } catch { cleanupFailed = true; }
    if (cleanupFailed) throw new Error("ISOLATED_POSTGRES_QA_CLEANUP_UNCONFIRMED");
  }
  return { status: "passed", checks };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  void runOfficePostgresQa().then(result => console.log(JSON.stringify(result))).catch(() => {
    console.error(JSON.stringify({ status: "failed", reason: "Isolated PostgreSQL QA could not be verified. No existing database was selected." }));
    process.exitCode = 1;
  });
}
