import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createServer } from "node:http";
import { chromium } from "playwright";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const now = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const row = (agentId, name, group, state, vida, extra = {}) => ({ agentId, name, group, state, label: `estado ${state}`, vida, points: 0, generation: 1, cadenceHours: 48, lastVerifiedWorkAt: null, lastVerifiedLabel: null, nextLossAt: null, flagged: state === "vida_cero", learned: [], ...extra });
const council = {
  version: 1, cycles: 3, lastCycleAt: iso(now), proposals: [
    { key: "automejora:clippers-hook:tiktok:kong:teaser", kind: "lesson", owner: "clippers-editor", title: "Automejora de Clippers · Editor: Hook/caption \"teaser\" gana en tiktok:kong", description: "x", evidence: [], handoffBrief: "x", createdAt: iso(now), status: "submitted" },
  ],
  vitality: [
    row("clippers-streamers", "Clippers · Streamers", "Clippers / Orquesta", "trabajando", 86, { lastVerifiedWorkAt: iso(now - 60_000), lastVerifiedLabel: "Descubrimiento de streamers: 12 candidatos" }),
    row("clippers-editor", "Clippers · Editor", "Clippers / Orquesta", "vida_cero", 0, { learned: ["Aprendió: Hook/caption \"teaser\" gana en tiktok:kong"] }),
    row("factory-builder", "Fábrica · Builder", "Fábrica de software", "atrasado", 41, { nextLossAt: iso(now + 3600_000) }),
    row("control", "Control / Permisos", "Oficina", "en_espera", 80, { label: "En espera (fuente de datos ausente o sin registros): no pierde vida" }),
  ],
  clippersAcademy: { observedAt: iso(now), lessons: [{ id: "clippers-hook:tiktok:kong:teaser", kind: "hook", agentIds: ["clippers-editor"], title: "Hook/caption \"teaser\" gana en tiktok:kong", detail: "+35% de vistas medianas", supported: true, samples: 14, evaluatedAt: iso(now) }] },
};

test("vida roster lists every agent with real state, vida meter, academy lessons and pending automejora", async t => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "vitality-roster-"));
  t.after(() => rm(temp, { recursive: true, force: true }));
  await build({ nodePaths: process.env.NODE_PATH?.split(path.delimiter), stdin: { contents: `import{createRoot}from'react-dom/client';import{QueryClientProvider}from'@tanstack/react-query';import{queryClient}from'./client/src/lib/queryClient';import{AgentVitalityRoster}from'./client/src/components/agent-vitality-roster';createRoot(document.getElementById('root')).render(<QueryClientProvider client={queryClient}><AgentVitalityRoster/></QueryClientProvider>);`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, format: "iife", platform: "browser", outfile: path.join(temp, "roster.js"), jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' } });
  let fail = false;
  const server = createServer(async (req, res) => {
    if (req.url === "/") { res.setHeader("content-type", "text/html"); return res.end('<html lang="es"><body><div id="root"></div><script src="/roster.js"></script></body></html>'); }
    if (req.url === "/roster.js") { res.setHeader("content-type", "text/javascript"); return res.end(await readFile(path.join(temp, "roster.js"))); }
    if (req.url?.startsWith("/api/agent-council/state")) { res.statusCode = fail ? 503 : 200; res.setHeader("content-type", "application/json"); return res.end(JSON.stringify(fail ? { error: "x" } : council)); }
    res.statusCode = 404; res.end("{}");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.goto(origin);
  await page.getByTestId("vitality-clippers-streamers").waitFor();
  const text = await page.locator("body").innerText();
  assert.match(text, /1 trabajando · 0 en turno · 1 perdiendo vida · 1 con vida 0 · 1 en espera/);
  assert.match(text, /Vida 0 · revisión del CEO\/Robert/);
  assert.match(text, /la inactividad nunca despide/);
  assert.match(text, /Academia Clippers \(Metricool\)/);
  assert.match(text, /Automejora pendiente de tu aprobación/);
  assert.equal(await page.getByLabel("Vida de Clippers · Streamers").getAttribute("value"), "86");
  await page.getByRole("button", { name: /Perdiendo vida/ }).click();
  assert.equal(await page.getByTestId("vitality-clippers-streamers").count(), 0);
  assert.equal(await page.getByTestId("vitality-factory-builder").count(), 1);
  assert.deepEqual(errors, []);
});
