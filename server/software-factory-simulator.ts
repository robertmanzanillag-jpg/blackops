import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser } from "playwright";
import { z } from "zod";

const localUrl = z.string().url().refine(value => {
  const u = new URL(value);
  return u.protocol === "http:" && u.hostname === "127.0.0.1" && !!u.port && !u.username && !u.password && !u.search && !u.hash && u.pathname === "/";
}, "A dedicated loopback fixture origin is required");
const selector = z.string().min(1).max(500);
const stepSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("click"), selector }).strict(),
  z.object({ action: z.literal("fill"), selector, value: z.string().max(2000) }).strict(),
  z.object({ action: z.literal("text"), selector, value: z.string().max(2000) }).strict(),
  z.object({ action: z.literal("visible"), selector }).strict(),
  z.object({ action: z.literal("reload") }).strict(),
  z.object({ action: z.literal("offline"), enabled: z.boolean() }).strict(),
]);
export const factorySimulationSchema = z.object({
  projectId: z.string().min(1).max(100),
  baseline: z.object({ baseUrl: localUrl, headSha: z.string().regex(/^[a-f0-9]{40}$/) }).strict(),
  candidate: z.object({ baseUrl: localUrl, headSha: z.string().regex(/^[a-f0-9]{40}$/) }).strict(),
  scenarios: z.array(z.object({ id: z.string().regex(/^[a-z0-9-]{1,80}$/), path: z.string().regex(/^\/(?!\/)[^?#]*$/).max(500), steps: z.array(stepSchema).min(1).max(30) }).strict()).min(1).max(20),
}).strict().refine(v => new Set(v.scenarios.map(s => s.id)).size === v.scenarios.length, "Scenario IDs must be unique");
export type FactorySimulationInput = z.infer<typeof factorySimulationSchema>;
export interface FactorySimulationCase {
  scenarioId: string; viewport: "desktop" | "mobile"; passed: boolean;
  errors: string[]; screenshot: string; screenshotSha256: string;
}
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

/** Only isolated fixture servers belong here. These checks do not isolate the
 * server itself: the launcher must run it without production secrets/network. */
export async function runFactorySimulation(raw: unknown, options: { artifactRoot: string; executablePath?: string; timeoutMs?: number; signal?: AbortSignal; browser?: Browser }) {
  options.signal?.throwIfAborted();
  const input = factorySimulationSchema.parse(raw);
  const runId = randomUUID();
  const root = path.resolve(options.artifactRoot, runId);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const timeout = Math.min(Math.max(options.timeoutMs ?? 3000, 100), 10000);
  const browser = options.browser ?? await chromium.launch({ executablePath: options.executablePath });
  const abort = () => { void browser.close().catch(() => undefined); };
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  const versions: { role: "baseline" | "candidate"; headSha: string; cases: FactorySimulationCase[] }[] = [];
  try {
    for (const role of ["baseline", "candidate"] as const) {
      const version = input[role];
      const cases: FactorySimulationCase[] = [];
      for (const viewport of ["desktop", "mobile"] as const) {
        for (const scenario of input.scenarios) {
          options.signal?.throwIfAborted();
          const context = await browser.newContext({ viewport: viewport === "desktop" ? { width: 1440, height: 1000 } : { width: 390, height: 844 }, serviceWorkers: "block", acceptDownloads: false });
          const errors: string[] = [];
          const record = (message: string) => { if (errors.length < 30) errors.push(message); };
          await context.route("**/*", async route => {
            if (new URL(route.request().url()).origin !== new URL(version.baseUrl).origin) {
              record("External network request blocked"); await route.abort();
            } else await route.continue();
          });
          // WebSockets bypass HTTP routing in browsers; block them explicitly.
          await context.routeWebSocket("**/*", socket => { record("WebSocket blocked"); socket.close(); });
          const page = await context.newPage();
          page.setDefaultTimeout(timeout); page.setDefaultNavigationTimeout(timeout);
          page.on("pageerror", () => record("Uncaught browser error"));
          page.on("console", message => { if (message.type() === "error") record("Browser console error"); });
          page.on("response", response => { if (response.status() >= 500) record("Server response error"); });
          const screenshot = `${role}-${viewport}-${scenario.id}.png`;
          let screenshotSha256 = "";
          let activeStep = "navigation";
          try {
            const response = await page.goto(new URL(scenario.path, version.baseUrl).href);
            if (!response?.ok()) throw new Error("Initial route failed");
            if (response.headers()["x-factory-head-sha"] !== version.headSha) throw new Error("Fixture version is not verified");
            for (const [index, step] of scenario.steps.entries()) {
              activeStep = `${index + 1}:${step.action}`;
              if (step.action === "reload") await page.reload();
              else if (step.action === "offline") await context.setOffline(step.enabled);
              else if (step.action === "click") await page.locator(step.selector).click();
              else if (step.action === "fill") await page.locator(step.selector).fill(step.value);
              else if (step.action === "visible") await page.locator(step.selector).waitFor({ state: "visible" });
              else await page.waitForFunction(({ selector, value }) => document.querySelector(selector)?.textContent?.trim() === value, step, { timeout });
            }
          } catch { record(`Scenario step failed (${activeStep})`); }
          try {
            const bytes = await page.screenshot({ fullPage: true, timeout });
            screenshotSha256 = digest(bytes);
            await writeFile(path.join(root, screenshot), bytes, { flag: "wx", mode: 0o600 });
          } catch { record("Screenshot evidence unavailable"); }
          cases.push({ scenarioId: scenario.id, viewport, passed: errors.length === 0, errors, screenshot, screenshotSha256 });
          await context.close();
        }
      }
      versions.push({ role, headSha: version.headSha, cases });
    }
  } finally { options.signal?.removeEventListener("abort", abort); if (!options.browser) await browser.close(); }
  options.signal?.throwIfAborted();
  const baseline = versions[0], candidate = versions[1];
  const regressions = candidate.cases.filter((item, index) => !item.passed && baseline.cases[index].passed).map(item => `${item.viewport}:${item.scenarioId}`);
  const report = { version: 1, runId, projectId: input.projectId, synthetic: true, createdAt: new Date().toISOString(), scenarioSha256: digest(JSON.stringify(input.scenarios)), baseline, candidate, passed: candidate.cases.every(item => item.passed), regressions };
  const serialized = JSON.stringify(report);
  await writeFile(path.join(root, "evidence.json"), serialized, { flag: "wx", mode: 0o600 });
  return { ...report, evidenceSha256: digest(serialized), artifactDirectory: root };
}

