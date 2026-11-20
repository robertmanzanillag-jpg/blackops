// Owner notification for the daily credit pacer (server/credit-pacer.ts).
//
//   node --import tsx script/credit-pacer-notify.ts
//
// Reads officeExecution.creditPacer from the owner's council row inside ONE READ ONLY transaction
// (never writes the database) and opens one GitHub issue labelled `budget` per persisted alert:
// once per overspend streak (OFFICE_CREDIT_OVERSPEND_ALERT_DAYS consecutive days, default 3) and
// once per grant threshold (50/80/95%). Idempotent: an issue whose title carries the alert id is
// never opened twice (open or closed), matched on issues created by the workflow bot. Issue text is fixed Spanish plus numbers only.
//
// Environment: DATABASE_URL, DEFAULT_USER_ID, GH_TOKEN (workflow token with issues: write),
// GITHUB_REPOSITORY. CI logs are public: prints only static lines and counts.
import pg from "pg";
import { createCouncilStore, type CouncilClient } from "../server/agent-council-store";
import { parseCreditPacerState, type PacerAlert } from "../server/credit-pacer";
import { pacerAlertText } from "../server/credit-pacer-runtime";
import { blackopsApplicationName } from "../server/agent-council-store";

type Env = Record<string, string | undefined>;
type Fetch = typeof fetch;
const RECENT_MS = 14 * 86_400_000;

export function alertTitle(alert: PacerAlert): string {
  const what = alert.kind === "overspend_streak" ? `${alert.streakDays} días seguidos sobre el límite diario` : `${alert.percent}% del crédito usado`;
  return `Presupuesto API: ${what} [${alert.id}]`;
}

export function alertBody(alert: PacerAlert): string {
  return [pacerAlertText(alert), "",
    "El ritmo diario ya se ajusta solo: si un día se gasta de más, los días siguientes reciben menos.",
    "No hace falta ninguna acción salvo que quieras pausar algo o agregar crédito.",
    "", `Día: ${alert.day}. Generado automáticamente por la oficina (sin datos privados).`].join("\n");
}

/** Recent alerts from the persisted pacer state; invalid state yields none. */
export function pendingAlerts(rawCouncil: string | null, now: number): PacerAlert[] {
  if (!rawCouncil) return [];
  try {
    const state = parseCreditPacerState(JSON.parse(rawCouncil)?.officeExecution?.creditPacer);
    return Object.values(state.ledgers).flatMap(ledger => ledger.alerts.log).filter(alert => now - Date.parse(alert.at) <= RECENT_MS);
  } catch { return []; }
}

export const NOTIFY_LABEL = "budget";
export const NOTIFY_CREATOR = "github-actions[bot]";

/**
 * Dedupe never depends on the label: duplicates are found by listing every issue
 * (open and closed) created by the workflow bot and matching the [alert id] in the title.
 * The label is created once (422 = it already exists); an issue whose creation response
 * lacks the label is refused (it would escape the owner's `budget` filter).
 */
export async function notifyAlerts(alerts: PacerAlert[], options: { token: string; repository: string; fetch?: Fetch }): Promise<{ created: number; existing: number }> {
  if (!alerts.length) return { created: 0, existing: 0 };
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(options.repository)) throw Error("REPOSITORY_INVALID");
  const request = options.fetch ?? fetch, api = `https://api.github.com/repos/${options.repository}`;
  const headers = { authorization: `Bearer ${options.token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "content-type": "application/json" };
  const label = await request(`${api}/labels`, { method: "POST", headers, body: JSON.stringify({ name: NOTIFY_LABEL, color: "d93f0b", description: "Presupuesto API (ritmo diario del crédito)" }) });
  if (!label.ok && label.status !== 422) throw Error(`GITHUB_LABEL_FAILED_${label.status}`);
  const titles: string[] = [];
  for (let page = 1; page <= 10; page++) {
    const listed = await request(`${api}/issues?state=all&creator=${encodeURIComponent(NOTIFY_CREATOR)}&per_page=100&page=${page}`, { headers });
    if (!listed.ok) throw Error(`GITHUB_LIST_FAILED_${listed.status}`);
    const rows = (await listed.json()) as Array<{ title?: unknown }>;
    titles.push(...rows.map(issue => String(issue.title ?? "")));
    if (rows.length < 100) break;
  }
  let created = 0, existing = 0;
  for (const alert of alerts) {
    if (titles.some(title => title.includes(`[${alert.id}]`))) { existing++; continue; }
    const response = await request(`${api}/issues`, { method: "POST", headers, body: JSON.stringify({ title: alertTitle(alert), body: alertBody(alert), labels: [NOTIFY_LABEL] }) });
    if (!response.ok) throw Error(`GITHUB_CREATE_FAILED_${response.status}`);
    titles.push(alertTitle(alert));
    const issue = (await response.json().catch(() => ({}))) as { labels?: Array<{ name?: unknown } | string> };
    if (!Array.isArray(issue.labels) || !issue.labels.some(l => (typeof l === "string" ? l : l?.name) === NOTIFY_LABEL)) throw Error("GITHUB_LABEL_MISSING");
    created++;
  }
  return { created, existing };
}

async function readCouncil(env: Env): Promise<string | null> {
  const owner = env.DEFAULT_USER_ID?.trim();
  if (!owner || !env.DATABASE_URL?.trim()) throw Error("CONFIGURATION_REQUIRED");
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 10000, max: 1, application_name: blackopsApplicationName("credit-notify") });
  pool.on("error", () => undefined);
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN TRANSACTION READ ONLY");
      await client.query("SET LOCAL statement_timeout = 15000");
      const inTransaction: CouncilClient = { query: (sql, values) => client.query(sql, values as unknown[]), release: () => undefined };
      const raw = await createCouncilStore({ connect: async () => inTransaction }).read(owner);
      await client.query("ROLLBACK");
      return raw;
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
    finally { client.release(); }
  } finally { await pool.end(); }
}

async function main(env: Env) {
  const token = env.GH_TOKEN?.trim(), repository = env.GITHUB_REPOSITORY?.trim();
  if (!token || !repository) throw Error("GITHUB_CONFIGURATION_REQUIRED");
  const result = await notifyAlerts(pendingAlerts(await readCouncil(env), Date.now()), { token, repository });
  console.log(`credit pacer notifications: created=${result.created} existing=${result.existing}`);
}

if (process.argv[1]?.endsWith("credit-pacer-notify.ts")) {
  void main(process.env).catch(error => {
    const message = error instanceof Error && /^[A-Z][A-Z0-9_]{2,60}$/.test(error.message) ? error.message : "CREDIT_PACER_NOTIFY_FAILED";
    console.error(message);
    process.exitCode = 1;
  }).finally(() => setTimeout(() => process.exit(process.exitCode ?? 0), 100).unref());
}
