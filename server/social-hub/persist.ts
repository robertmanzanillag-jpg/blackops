// Durable storage for the Social Hub on Replit (its filesystem is wiped on every redeploy).
// Keeps an in-memory copy for sync reads and writes through to Postgres (table social_hub_kv).
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

type Backend = { read(key: string): Promise<string | null>; write(key: string, value: string): Promise<void> };

const memory = new Map<string, string | null>();
let backend: Backend | null = null;
let chain: Promise<unknown> = Promise.resolve();

async function postgresBackend(): Promise<Backend> {
  const [{ db }, { sql }] = await Promise.all([import("../db"), import("drizzle-orm")]);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS social_hub_kv (key text PRIMARY KEY, value text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`);
  return {
    async read(key) {
      const r: any = await db.execute(sql`SELECT value FROM social_hub_kv WHERE key = ${key}`);
      return r.rows?.[0]?.value ?? null;
    },
    async write(key, value) {
      await db.execute(sql`INSERT INTO social_hub_kv (key, value, updated_at) VALUES (${key}, ${value}, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`);
    },
  };
}

/** Local/test fallback: one file per key under SOCIAL_HUB_DATA_DIR (default data/social-hub). */
function fileBackend(dir = process.env.SOCIAL_HUB_DATA_DIR ?? "data/social-hub"): Backend {
  const path = (k: string) => `${dir}/${k}`;
  return {
    async read(k) { return existsSync(path(k)) ? readFileSync(path(k), "utf8") : null; },
    async write(k, v) {
      mkdirSync(dirname(path(k)), { recursive: true });
      writeFileSync(`${path(k)}.tmp`, v, { mode: 0o600 });
      renameSync(`${path(k)}.tmp`, path(k));
    },
  };
}

/** Call once at startup, before routes serve or the scheduler runs. Uses Postgres when DATABASE_URL is set. */
export async function hydrateSocialHub(keys: string[] = ["state", "tokens"], useBackend?: Backend): Promise<void> {
  backend = useBackend ?? (process.env.DATABASE_URL && process.env.SOCIAL_HUB_STORAGE !== "file" ? await postgresBackend() : fileBackend());
  for (const k of keys) memory.set(k, await backend.read(k));
}

export function kvGet(key: string): string | null {
  if (!memory.has(key)) throw new Error("Social Hub todavía no cargó su almacenamiento (hydrateSocialHub).");
  return memory.get(key) ?? null;
}

/** Updates memory now; persists in order. Await kvFlush() when the caller must be sure it is durable. */
export function kvSet(key: string, value: string): void {
  memory.set(key, value);
  const b = backend;
  if (!b) throw new Error("Social Hub sin almacenamiento (hydrateSocialHub).");
  chain = chain.then(() => b.write(key, value)).catch((e) => console.error("[social-hub persist]", e?.message ?? e));
}

export function kvFlush(): Promise<unknown> {
  return chain;
}

export function memoryBackend(seed: Record<string, string> = {}): Backend {
  const m = new Map(Object.entries(seed));
  return { async read(k) { return m.get(k) ?? null; }, async write(k, v) { m.set(k, v); } };
}
