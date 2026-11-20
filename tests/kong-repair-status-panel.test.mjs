import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";
import express from "express";
import { chromium } from "playwright";

test("KONG repair dialog shows owner repair evidence and refreshes only with GET", async t => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "kong-repair-panel-"));
  t.after(() => rm(temp, { recursive: true, force: true }));
  await build({
    stdin: {
      contents: `
        import { createRoot } from 'react-dom/client';
        import { QueryClientProvider } from '@tanstack/react-query';
        import { queryClient } from './client/src/lib/queryClient';
        import { KongRepairDialog } from './client/src/components/kong-repair-dialog';
        queryClient.setQueryData(['auth-me'], { authenticated: true, user: { id: 'fixture-owner' } });
        createRoot(document.getElementById('root')).render(
          <QueryClientProvider client={queryClient}><KongRepairDialog /></QueryClientProvider>
        );
      `,
      resolveDir: process.cwd(),
      loader: "tsx",
    },
    bundle: true,
    platform: "browser",
    outfile: path.join(temp, "panel.js"),
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
  });

  const now = Date.now();
  const minute = 60_000;
  const signalAt = new Date(now - 29.5 * minute).toISOString();
  const payload = {
    readiness: { bridgeEnabled: true, enginePinned: true, signingConfigured: true },
    pull: { lastSuccessfulSourceReadAt: signalAt, lastHttpStatus: 200, errorCode: "NONE" },
    maker: { lastSuccessfulPollAt: new Date(now - 44.5 * minute).toISOString(), workerConnected: true, state: "idle" },
    entries: [
      ...["queued", "awaiting_checker", "awaiting_independent_review", "awaiting_qareview",
        "awaiting_deployment", "verified", "maker_running", "blocked_no_github"]
        .map(status => ({ status, privateId: "private-journal-record" })),
    ],
    paidExecution: "unknown",
  };
  let reply = { status: 200, data: payload };
  let verifiedId = "fixture-owner";
  const requests = [];
  const browserErrors = [];
  const app = express();
  app.get("/", (_req, res) => res.type("html").send('<html lang="es"><head><title>KONG QA</title></head><body><div id="root"></div><script src="/panel.js"></script></body></html>'));
  app.get("/panel.js", async (_req, res) => res.type("js").send(await readFile(path.join(temp, "panel.js"))));
  app.get("/api/auth/me", (_req, res) => res.json({ authenticated: true, user: { id: verifiedId } }));
  app.get("/api/kong-supervisor/state", (_req, res) => res.json({ messages: [] }));
  app.get("/api/agent-council/state", (_req, res) => res.json({}));
  app.all("/api/kong-repairs", (req, res) => {
    requests.push({ method: req.method, cookie: req.get("cookie") });
    res.set("Cache-Control", "no-store").status(reply.status).json(reply.data);
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
      (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : undefined),
  });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on("pageerror", error => browserErrors.push(error.message));
  await page.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.context().addCookies([{ name: "fixture-session", value: "owner", url: origin }]);
  await page.clock.install({ time: new Date(now) });
  await page.goto(origin);
  assert.equal(requests.length, 0);
  await page.getByRole("button", { name: "Reparaciones KONG", exact: true }).click();
  const panel = page.getByRole("region", { name: "Reparaciones de KONG" });
  const refresh = panel.getByRole("button", { name: "Actualizar estado" });
  await panel.getByText("Conexión verificada · En espera", { exact: false }).waitFor();
  await panel.getByText("Conexión verificada", { exact: true }).waitFor();
  assert.deepEqual(await panel.locator("dl").last().locator("dd").allTextContents(), ["1", "3", "1", "1"]);
  assert.doesNotMatch(await panel.innerHTML(), /private-journal-record|fixture-owner/);
  assert.equal(requests.length, 1);

  // The displayed evidence expires before the next network poll.
  await page.clock.fastForward(40_000);
  await panel.getByText("Sin lectura reciente verificada", { exact: false }).waitFor();
  await panel.getByText("Sin conexión reciente verificada", { exact: false }).waitFor();
  assert.equal(requests.length, 1);

  const newSignal = new Date(now + 25_000).toISOString();
  reply = { status: 200, data: {
    ...payload,
    pull: { ...payload.pull, lastSuccessfulSourceReadAt: newSignal, lastHttpStatus: 502, errorCode: "SOURCE_HTTP_FAILED" },
    maker: { ...payload.maker, lastSuccessfulPollAt: newSignal, state: "unknown" },
  } };
  await page.clock.fastForward(25_000);
  await panel.getByText("La última lectura falló", { exact: false }).waitFor();
  await panel.getByText("Contacto reciente · Estado incierto", { exact: false }).waitFor();
  assert.equal(requests.length, 2);

  reply = { status: 200, data: {
    ...payload,
    pull: { ...payload.pull, lastSuccessfulSourceReadAt: new Date(now + 30 * minute).toISOString() },
    maker: { ...payload.maker, lastSuccessfulPollAt: newSignal, workerConnected: false },
  } };
  await refresh.click();
  await panel.getByText("Sin lectura reciente verificada", { exact: true }).waitFor();
  await panel.getByText("Sin conexión reciente verificada", { exact: false }).waitFor();

  reply = { status: 200, data: {
    ...payload,
    pull: { ...payload.pull, lastSuccessfulSourceReadAt: newSignal },
    maker: { ...payload.maker, lastSuccessfulPollAt: newSignal },
  } };
  await refresh.click();
  await panel.getByText("Conexión verificada · En espera", { exact: false }).waitFor();
  // Source contact still expires at 30m, while a maker's 30m schedule has a
  // separately bounded 45m evidence window. Neither can extend cached time.
  reply = { status: 200, data: { ...payload,
    pull: { ...payload.pull, lastSuccessfulSourceReadAt: new Date(now - 31 * minute).toISOString() },
    maker: { ...payload.maker, lastSuccessfulPollAt: new Date(now - 31 * minute).toISOString() },
  } };
  await refresh.click();await panel.getByText("Sin lectura reciente verificada", { exact: true }).waitFor();
  await panel.getByText("Conexión verificada · En espera", { exact: false }).waitFor();
  reply = { status: 403, data: { code: "REPAIR_OWNER_REQUIRED", internal: "secret-error-url" } };
  await refresh.click();
  await panel.getByText("Solo el propietario puede consultar las reparaciones.", { exact: true }).waitFor();
  assert.equal(await panel.locator("dl").count(), 0);
  assert.doesNotMatch(await panel.innerHTML(), /secret-error-url|Conexión verificada/);

  reply = { status: 503, data: { code: "REPAIR_BRIDGE_DISABLED" } };
  await refresh.click();
  await panel.getByText("Sin activar", { exact: true }).waitFor();
  reply = { status: 503, data: { code: "REPAIR_STATUS_UNAVAILABLE", detail: "REPAIR_BRIDGE_DISABLED" } };
  await refresh.click();
  await panel.getByText("No se pudo consultar el estado de las reparaciones.", { exact: true }).waitFor();
  assert.equal(await panel.locator("dl").count(), 0);
  assert.ok(requests.every(request => request.method === "GET" && request.cookie === "fixture-session=owner"));

  await page.keyboard.press("Escape");
  await panel.waitFor({ state: "detached" });
  const closedCount = requests.length;
  verifiedId = "different-session";
  const authResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/auth/me");
  await page.getByRole("button", { name: "Reparaciones KONG", exact: true }).click();
  await authResponse;
  await page.clock.fastForward(2 * minute);
  assert.equal(await panel.count(), 0);
  assert.equal(requests.length, closedCount);
  assert.deepEqual(browserErrors, []);
});
