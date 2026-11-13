#!/usr/bin/env node
// Release gate sandbox smoke suite. Runs against an app booted ON THE CI RUNNER with an
// ephemeral PostgreSQL database and dummy configuration; never against production.
//
// Env:
//   GATE_BASE_URL     e.g. http://127.0.0.1:5055 (refuses anything but localhost)
//   SESSION_SECRET    the sandbox-only session secret the app was booted with
//   GATE_USER_ID      id of the seeded sandbox owner
//   GATE_REPORT_DIR   where smoke.json and screenshots go (default gate-report)
//   PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH  optional browser binary
import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const base = (process.env.GATE_BASE_URL || "http://127.0.0.1:5055").replace(/\/$/, "");
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base)) throw new Error("smoke suite only runs against a local sandbox");
const secret = process.env.SESSION_SECRET || "";
const userId = process.env.GATE_USER_ID || "";
if (!secret || !userId) throw new Error("SESSION_SECRET and GATE_USER_ID are required");
const reportDir = path.resolve(process.env.GATE_REPORT_DIR || "gate-report");
mkdirSync(path.join(reportDir, "screenshots"), { recursive: true });

// Routes that depend on an integration the sandbox deliberately does not have (Replit connectors,
// KONG). Only the exact route + status listed in known-failures.json is tolerated, with its reason.
const allowlist = JSON.parse(readFileSync(path.resolve("script/release-gate/known-failures.json"), "utf8"));
const sandboxRoutes = allowlist.sandboxIntegrationRoutes || {};
const tolerated = (pathname, status) => (sandboxRoutes[pathname]?.status || []).includes(status);
const toleratedSeen = new Set();

// Same format as server/user-context.ts createSignedLocalAuthCookieValue (v1.<b64url id>.<hmac>).
const payload = Buffer.from(userId, "utf8").toString("base64url");
const cookieValue = `v1.${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
const cookie = `blackops.uid=${encodeURIComponent(cookieValue)}`;

const checks = [];
const record = (name, ok, detail = {}) => {
  checks.push({ name, ok, ...detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail.note ? ` - ${detail.note}` : ""}`);
};

async function request(pathname, { auth = false, timeoutMs = 20_000 } = {}) {
  const started = Date.now();
  try {
    const response = await fetch(`${base}${pathname}`, {
      headers: { accept: "application/json", ...(auth ? { cookie } : {}) },
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    let json;
    try { json = JSON.parse(text); } catch { json = undefined; }
    return { status: response.status, json, ms: Date.now() - started, contentType: response.headers.get("content-type") || "" };
  } catch (error) {
    return { status: 0, error: error?.name || "request_failed", ms: Date.now() - started };
  }
}

// 1. Health contract (Replit's readiness probe and the office both depend on it).
{
  const health = await request("/api/health");
  const j = health.json || {};
  const problems = [];
  if (health.status !== 200) problems.push(`status ${health.status}`);
  if (j.status !== "ok") problems.push("status!=ok");
  if (j.ready !== true) problems.push("ready!=true");
  if (j.service !== "blackops-reminder") problems.push("service");
  if (typeof j.officeProtocol !== "object" || typeof j.officeProtocol?.version !== "number") problems.push("officeProtocol.version");
  if (typeof j.officeSources !== "object" || typeof j.officeSources?.status !== "string") problems.push("officeSources.status");
  if (typeof j.officeEditorialSources !== "object") problems.push("officeEditorialSources");
  for (const key of ["checkedAt", "startedAt"]) if (!Number.isFinite(Date.parse(j[key]))) problems.push(key);
  for (const key of ["uptimeSeconds", "memoryRssMb"]) if (typeof j[key] !== "number") problems.push(key);
  if (typeof j.instanceId !== "string") problems.push("instanceId");
  record("health JSON contract", problems.length === 0, { note: problems.join(", "), ms: health.ms });
  const legacy = await request("/health");
  record("legacy /health alias", legacy.status === 200 && legacy.json?.status === "ok", { status: legacy.status });
}

// 2. Auth boundary: protected API refuses anonymous callers, public auth probe answers.
{
  const anonymous = await request("/api/tasks");
  record("anonymous /api/tasks is refused (401)", anonymous.status === 401, { status: anonymous.status });
  const me = await request("/api/auth/me");
  record("anonymous /api/auth/me answers without 5xx", me.status > 0 && me.status < 500, { status: me.status });
  const authed = await request("/api/auth/me", { auth: true });
  record("signed sandbox session is recognised", authed.status === 200 && JSON.stringify(authed.json || {}).includes(userId), { status: authed.status });
  // Real login through the PostgreSQL session store (also creates user_sessions like production).
  if (process.env.GATE_OWNER_USERNAME && process.env.GATE_OWNER_PASSWORD) {
    const login = async (password) => {
      try {
        const response = await fetch(`${base}/api/auth/login`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: base },
          body: JSON.stringify({ username: process.env.GATE_OWNER_USERNAME, password }),
          signal: AbortSignal.timeout(20_000),
        });
        return { status: response.status, cookies: response.headers.getSetCookie?.() || [] };
      } catch { return { status: 0, cookies: [] }; }
    };
    const wrong = await login(`${process.env.GATE_OWNER_PASSWORD}-wrong`);
    record("login with a wrong password is refused (401)", wrong.status === 401, { status: wrong.status });
    const good = await login(process.env.GATE_OWNER_PASSWORD);
    const sid = good.cookies.find((value) => value.startsWith("blackops.sid="));
    record("login with the sandbox owner works and sets a session", good.status === 200 && Boolean(sid), { status: good.status });
    if (sid) {
      const me = await fetch(`${base}/api/auth/me`, { headers: { cookie: sid.split(";")[0] }, signal: AbortSignal.timeout(20_000) }).then(async (r) => ({ status: r.status, text: await r.text() })).catch(() => ({ status: 0, text: "" }));
      record("the stored session authenticates /api/auth/me", me.status === 200 && me.text.includes(userId), { status: me.status });
    }
  }
}

// 3. Authenticated read-only API routes must never answer 5xx (or hang).
// Only GET routes that read state; nothing here sends, publishes, spends or calls a provider.
const API_ROUTES = [
  "/api/tasks", "/api/weekly-tasks", "/api/monthly-goals", "/api/yearly-goals", "/api/weekly-summaries",
  "/api/projects", "/api/automations", "/api/automation-runs", "/api/automation-manager/summary",
  "/api/pending-actions", "/api/approval-history", "/api/audit-logs", "/api/assistant/permissions",
  "/api/ai-spend/monthly", "/api/legal-compliance/reports", "/api/app-qa-agent/status", "/api/app-qa-agent/history",
  "/api/agent-council/state", "/api/agents-office/connections", "/api/agents-office/cities", "/api/agents-office/runs",
  "/api/software-factory", "/api/marketing-command-center", "/api/ceo/conversation-history",
  "/api/telegram/status", "/api/github/status", "/api/developer-health/dashboard", "/api/conversations",
  "/api/investments", "/api/watchlist", "/api/price-alerts", "/api/djs", "/api/public/local-news",
];
const apiResults = [];
for (const route of API_ROUTES) {
  const result = await request(route, { auth: true });
  apiResults.push({ route, status: result.status, ms: result.ms });
  const allowed = result.status >= 500 && tolerated(route, result.status);
  if (allowed) toleratedSeen.add(`${result.status} ${route}`);
  record(`GET ${route} is non-5xx${allowed ? " (sandbox integration allowlisted)" : ""}`, (result.status > 0 && result.status < 500) || allowed, { status: result.status, ms: result.ms, note: result.status ? `${result.status}` : result.error });
}

// 4. Browser: key pages render, no uncaught exceptions, no same-origin 5xx.
//    The agents office must also render with ZERO console errors.
const PAGES = [
  { path: "/", strictConsole: false },
  { path: "/dashboard", strictConsole: false },
  { path: "/agents-office", strictConsole: true },
  { path: "/ceo", strictConsole: false },
  { path: "/projects", strictConsole: false },
  { path: "/automations", strictConsole: false },
  { path: "/tools", strictConsole: false },
  { path: "/app-qa-agent", strictConsole: false },
  { path: "/marketing-command-center", strictConsole: false },
  { path: "/news", strictConsole: false, anonymous: true },
];
const pageResults = [];
let browser;
try {
  const { chromium } = await import("playwright");
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
  });
  const url = new URL(base);
  for (const pageSpec of PAGES) {
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    if (!pageSpec.anonymous) await context.addCookies([{ name: "blackops.uid", value: encodeURIComponent(cookieValue), domain: url.hostname, path: "/", httpOnly: true }]);
    const page = await context.newPage();
    const consoleErrors = [];
    const pageErrors = [];
    const serverErrors = [];
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text().slice(0, 300)); });
    page.on("pageerror", (error) => pageErrors.push(String(error?.message || error).slice(0, 300)));
    page.on("response", (response) => {
      if (!response.url().startsWith(base) || response.status() < 500) return;
      const pathname = new URL(response.url()).pathname;
      if (tolerated(pathname, response.status())) toleratedSeen.add(`${response.status()} ${pathname}`);
      else serverErrors.push(`${response.status()} ${pathname}`);
    });
    let navigationError = "";
    let bodyText = "";
    try {
      const response = await page.goto(`${base}${pageSpec.path}`, { waitUntil: "load", timeout: 45_000 });
      if (!response || response.status() >= 400) navigationError = `document status ${response?.status()}`;
      await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
      await page.waitForTimeout(1500);
      bodyText = (await page.locator("body").innerText({ timeout: 5000 }).catch(() => "")).trim();
    } catch (error) {
      navigationError = String(error?.message || error).split("\n")[0].slice(0, 200);
    }
    const slug = pageSpec.path === "/" ? "root" : pageSpec.path.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
    await page.screenshot({ path: path.join(reportDir, "screenshots", `${slug}.png`), fullPage: false }).catch(() => undefined);
    const rendered = bodyText.length > 20 && !/Iniciando BlackOps/.test(bodyText);
    const problems = [];
    if (navigationError) problems.push(navigationError);
    if (!rendered) problems.push("page did not render content");
    if (pageErrors.length) problems.push(`${pageErrors.length} uncaught exception(s)`);
    if (serverErrors.length) problems.push(`same-origin 5xx: ${serverErrors.slice(0, 5).join(", ")}`);
    if (pageSpec.strictConsole && consoleErrors.length) problems.push(`${consoleErrors.length} console error(s)`);
    pageResults.push({ path: pageSpec.path, rendered, consoleErrors, pageErrors, serverErrors, navigationError });
    record(`page ${pageSpec.path} renders cleanly`, problems.length === 0, { note: problems.join("; "), consoleErrors: consoleErrors.slice(0, 10), pageErrors: pageErrors.slice(0, 10) });
    await context.close();
  }
} catch (error) {
  record("browser smoke could run", false, { note: String(error?.message || error).split("\n")[0] });
} finally {
  await browser?.close().catch(() => undefined);
}

const failed = checks.filter((check) => !check.ok);
const report = { base, at: new Date().toISOString(), passed: checks.length - failed.length, failed: failed.length, toleratedSandboxIntegrations: [...toleratedSeen].sort(), checks, api: apiResults, pages: pageResults };
writeFileSync(path.join(reportDir, "smoke.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(`\nsmoke: ${report.passed}/${checks.length} checks passed`);
if (toleratedSeen.size) console.log(`sandbox-only integration answers tolerated (see known-failures.json): ${[...toleratedSeen].sort().join(", ")}`);
for (const check of failed) console.log(`::error::smoke: ${check.name}${check.note ? ` - ${check.note}` : ""}`);
process.exitCode = failed.length ? 1 : 0;
