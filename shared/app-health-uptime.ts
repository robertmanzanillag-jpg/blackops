// Health of the registered apps (app_projects) derived from the uptime monitor (monitored_projects).
//
// app_projects.status is only ever written by a full developer-health scan, which nothing schedules,
// so every app stayed "unknown" and Control reported "Apps sin chequeos de salud" forever while the
// uptime monitor (server/health-check.ts) was checking the same URLs every minute. This module reads
// that existing evidence; it never runs a check, writes a row or overrides a status a scan already set.
//
// Pure module (no IO) so the council, the dashboard route and the tests share the same rules.

export type AppHealthStatus = "healthy" | "degraded" | "down" | "unknown";
export type UptimeStatus = "online" | "offline" | "degraded" | "unknown";

export type AppForHealth = {
  id: string;
  name: string;
  status?: string | null;
  publicUrl?: string | null;
  healthUrl?: string | null;
  githubRepo?: string | null;
};

export type MonitoredForHealth = {
  url: string;
  status?: string | null;
  githubRepo?: string | null;
  lastCheck?: Date | string | null;
  checkInterval?: number | null;
};

// A check older than this many monitor intervals (minimum 15 min) is not current evidence.
const STALE_INTERVALS = 3;
const MIN_FRESH_MS = 15 * 60_000;

function origin(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return parsed.host.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function repo(value: string | null | undefined): string | null {
  const text = (value || "").trim().toLowerCase().replace(/\.git$/, "").replace(/^https?:\/\/github\.com\//, "");
  return /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(text) ? text : null;
}

function fresh(monitor: MonitoredForHealth, now: number): boolean {
  const at = monitor.lastCheck instanceof Date ? monitor.lastCheck.getTime() : Date.parse(String(monitor.lastCheck || ""));
  if (!Number.isFinite(at) || at > now + 60_000) return false;
  const intervalMs = Math.max(1, Number(monitor.checkInterval) || 5) * 60_000;
  return now - at <= Math.max(MIN_FRESH_MS, intervalMs * STALE_INTERVALS);
}

const FROM_UPTIME: Record<string, AppHealthStatus> = { online: "healthy", degraded: "degraded", offline: "down" };

/** Status for one app from a fresh uptime check of the same host or repository, or null. */
export function uptimeStatusForApp(app: AppForHealth, monitors: MonitoredForHealth[], now: number): AppHealthStatus | null {
  const hosts = new Set([origin(app.publicUrl), origin(app.healthUrl)].filter(Boolean) as string[]);
  const appRepo = repo(app.githubRepo);
  const matches = monitors.filter((monitor) => {
    if (!fresh(monitor, now) || !FROM_UPTIME[monitor.status || ""]) return false;
    const host = origin(monitor.url);
    return (host !== null && hosts.has(host)) || (appRepo !== null && repo(monitor.githubRepo) === appRepo);
  });
  if (!matches.length) return null;
  // Several monitors for one app: the worst current result wins; a failure is never hidden.
  const statuses = matches.map((monitor) => FROM_UPTIME[monitor.status!]);
  return statuses.includes("down") ? "down" : statuses.includes("degraded") ? "degraded" : "healthy";
}

/** Apps whose stored status is unknown take the uptime monitor's current result. */
export function withUptimeHealth<T extends AppForHealth>(apps: T[], monitors: MonitoredForHealth[], now: number = Date.now()): Array<T & { statusSource?: "uptime" }> {
  return apps.map((app) => {
    if ((app.status || "unknown") !== "unknown") return app;
    const derived = uptimeStatusForApp(app, monitors, now);
    return derived ? { ...app, status: derived, statusSource: "uptime" as const } : app;
  });
}
