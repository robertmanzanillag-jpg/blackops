import { emptyCalendarReceipts, publishedCalendarReceipts, type CalendarReceipts, type ManualClip } from "../server/blackroom-manual-observations";

/** Same authenticated, read-only scheduler endpoint used by the publishing
 * bridge's duplicate preflight. No cookies, new grants or mutation requests. */
export async function collectBlackRoomPublicationReceipts(clips: ManualClip[], previous = emptyCalendarReceipts(),
  { env = process.env, fetcher = fetch, now = new Date() }: { env?: NodeJS.ProcessEnv; fetcher?: typeof fetch; now?: Date } = {}): Promise<CalendarReceipts> {
  if (previous.version !== 1 || previous.brandId !== "6585226" || previous.source !== "authenticated-metricool-scheduler"
    || !Array.isArray(previous.receipts) || !previous.checkedDays) throw new Error("Invalid calendar receipt archive");
  if (!env.METRICOOL_USER_TOKEN || !/^\d+$/.test(env.METRICOOL_USER_ID || "")) return { ...previous, lastError: "Existing Metricool read credentials unavailable; publications remain unverified." };
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const cutoff = new Date(now.getTime()-30*86400000).toISOString().slice(0,10);
  const attemptedDays = { ...previous.checkedDays, ...previous.attemptedDays };
  const failedDays = { ...previous.failedDays };
  const days = [...new Set(clips.map(c=>c.scheduledLocal.slice(0,10)))].filter(day=>day >= cutoff && day <= today)
    .filter(day=>{const age=now.getTime()-Date.parse(attemptedDays[day]);return !Number.isFinite(age) || age<0 || age>=6*3600000;})
    .sort((a,b)=>(attemptedDays[a] || "").localeCompare(attemptedDays[b] || "") || b.localeCompare(a)).slice(0,4);
  const receipts = [...previous.receipts], checkedDays = { ...previous.checkedDays };
  for (const day of days) {
    attemptedDays[day] = now.toISOString();
    try {
      const url = new URL("https://app.metricool.com/api/v2/scheduler/posts");
      url.search = new URLSearchParams({ blogId: "6585226", userId: env.METRICOOL_USER_ID!, integrationSource: "MCP",
        start: day+"T00:00:00", end: day+"T23:59:59", timezone: "America/New_York", extendedRange: "false" }).toString();
      const response = await fetcher(url, { method: "GET", redirect: "error", headers: { "X-Mc-Auth": env.METRICOOL_USER_TOKEN,
        accept: "application/json" }, signal: AbortSignal.timeout(6000) });
      if (!response.ok) throw new Error("Calendar read rejected");
      const body = await response.text();
      if (body.length > 5_000_000) throw new Error("Calendar response too large");
      receipts.push(...publishedCalendarReceipts(JSON.parse(body), clips, now.toISOString()));
      checkedDays[day] = now.toISOString();
      delete failedDays[day];
    } catch { failedDays[day] = now.toISOString(); }
  }
  const lastError = Object.keys(failedDays).length ? "Calendar read unavailable; no publication inferred. Existing confirmed receipts retained."
    : !days.length ? previous.lastError : undefined;
  // Keep one genuine acquisition per mapping; contradictory mappings remain
  // visible so the reconciler can quarantine them rather than choose a winner.
  const unique = new Map(receipts.map(r=>[r.plannerId+":"+r.network+":"+r.platformPostId,r]));
  return { version:1, brandId:"6585226", source:"authenticated-metricool-scheduler",
    receipts:[...unique.values()].slice(-6000), checkedDays, attemptedDays, failedDays, ...(lastError ? { lastError } : {}) };
}
