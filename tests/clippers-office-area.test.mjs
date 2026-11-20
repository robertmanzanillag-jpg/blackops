import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";
import express from "express";
import { chromium } from "playwright";
import { orchestraFixture } from "./fixtures/clippers-orchestra.mjs";
import { ALL_DISCOVERY_CREATORS } from "../shared/clippers-priority-creators.mjs";
import { buildViralScout } from "../shared/clippers-viral-scout.mjs";
import { launchOfficeUiFixture } from "../script/software-factory-office-ui-fixture.mjs";

test("Clippers own area uses real evidence gates, expires activity, and protects the owner session", async t => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "clippers-office-ui-"));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const artifacts = process.env.OFFICE_VERIFICATION_QA_DIR || temp;
  await mkdir(artifacts, { recursive: true });
  await build({
    stdin: { contents: `
      import { createRoot } from 'react-dom/client';
      import { QueryClientProvider } from '@tanstack/react-query';
      import { queryClient } from './client/src/lib/queryClient';
      import { ClippersOfficeArea } from './client/src/components/clippers-office-area';
      queryClient.setQueryData(['auth-me'], { authenticated: true, user: { id: 'fixture-owner' } });
      createRoot(document.getElementById('root')).render(<QueryClientProvider client={queryClient}><ClippersOfficeArea ownerId="fixture-owner" /></QueryClientProvider>);
    `, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, platform: "browser", outfile: path.join(temp, "area.js"), jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' },
  });
  const assets = path.resolve("dist/public/assets");
  const cssFiles = (await readdir(assets)).filter(file => file.endsWith(".css"));
  assert.ok(cssFiles.length, "Build the actual client CSS with vite build before this browser suite");
  const css = (await Promise.all(cssFiles.map(file => readFile(path.join(assets, file), "utf8")))).join("\n");
  const now = Date.now();
  let payload = orchestraFixture(now), replyStatus = 200, verifiedId = "fixture-owner";
  const requests = [], errors = [];
  const app = express();
  app.get("/", (_req, res) => res.type("html").send('<html lang="es"><head><title>Clippers local QA</title><link rel="stylesheet" href="/area.css"></head><body class="dark"><div id="root"></div><script src="/area.js"></script></body></html>'));
  app.get("/area.css", (_req, res) => res.type("css").send(css));
  app.get("/area.js", async (_req, res) => res.type("js").send(await readFile(path.join(temp, "area.js"))));
  app.get("/api/auth/me", (_req, res) => res.json({ authenticated: true, user: { id: verifiedId } }));
  app.all("/api/clippers/orchestra/status", (req, res) => { requests.push(req.method); res.set("Cache-Control", "no-store").status(replyStatus).json(payload); });
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : undefined) });
  t.after(() => browser.close());
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    payload = orchestraFixture(now); replyStatus = 200; verifiedId = "fixture-owner";
    const oldSources=payload.discovery.sources;payload.discovery={...payload.discovery,catalogVersion:2,rotationSize:14,rotationDays:1,sources:ALL_DISCOVERY_CREATORS.map(c=>oldSources.find(row=>row.creatorId===c.id)??{creatorId:c.id,channelId:c.channelId,observedAt:null,status:'not_observed',heldReasons:['source_not_observed'],observations:0})};
    payload.roles[0].heldReasons = ["PRIVATE_REASON_CANARY_1234567890", "__proto__", "constructor"];
    payload.roles[0].outputs = JSON.parse('{"__proto__":0,"constructor":0}');
    payload.accounts[0].analytics = { status: "observed", observedAt: new Date(now).toISOString(), posts: 7, totalViews: 900, actualAgeHoursMin: 24, actualAgeHoursMax: 50, heldReasons: [] };
    payload.accounts[0].metricAgeBuckets = [
      { windowHours: 24, samples: 0, actualAgeHoursMin: null, actualAgeHoursMax: null, latestObservedAt: null, views: 0, likes: 0, comments: 0, shares: 0 },
      { windowHours: 72, samples: 1, actualAgeHoursMin: 72, actualAgeHoursMax: 73, latestObservedAt: new Date(now).toISOString(), views: 0, likes: 0, comments: 0, shares: 0 },
    ];
    const context = await browser.newContext({ viewport, reducedMotion: "reduce" });
    await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.clock.install({ time: new Date(now) });
    await page.goto(origin);
    const reads = requests.length;
    const trigger = page.getByTestId("open-clippers-office");
    assert.equal(requests.length, reads);
    await trigger.click();
    await page.getByTestId("clippers-orchestra-report").waitFor();
    assert.equal(await page.locator('[data-testid^="clippers-agent-"]').count(), 9);
    await page.getByText("Ejecutando ahora", { exact: true }).waitFor();
    assert.equal(await page.getByRole("meter", { name: "Vida registrada de Editor" }).getAttribute("value"), "80");
    assert.match(await page.getByTestId("clippers-career-editor").innerText(), /vida inicial no prueba rendimiento/);
    const dialog = page.getByTestId("clippers-office-dialog");
    assert.ok(!(await dialog.innerText()).includes("PRIVATE_REASON_CANARY"));
    await page.getByText("Motivo pendiente de verificación.", { exact: true }).first().waitFor();
    assert.equal(await page.getByText("Motivo pendiente de verificación.", { exact: true }).count(), 3);
    assert.equal(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true);
    await page.screenshot({ path: path.join(artifacts, `clippers-fixture-team-${viewport.width}.png`), fullPage: true });
    await page.clock.fastForward(30_001);
    assert.equal(await page.getByText("Ejecutando ahora", { exact: true }).count(), 0);
    await page.getByText("Actividad sin verificar", { exact: true }).waitFor();
    await page.getByRole("tab", { name: "Cuentas y métricas", exact: true }).click();
    assert.equal(await page.locator('[data-testid^="clippers-account-"]').count(), 4);
    assert.equal(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true, "wide metric table must scroll locally without widening the dialog");
    await page.getByText("NY · sin redes conectadas", { exact: true }).waitFor();
    assert.equal(await page.getByText("No hay métricas observadas para esta cuenta.", { exact: true }).count(), 3);
    const account = page.getByTestId(`clippers-account-${payload.accounts[0].key}`);
    const analytics = page.getByTestId(`clippers-analytics-${payload.accounts[0].key}`);
    await analytics.getByText("7", { exact: true }).waitFor();
    await analytics.getByText("900", { exact: true }).waitFor();
    const emptyBucket = account.getByRole("row").filter({ has: page.getByRole("rowheader", { name: "24 h", exact: true }) });
    assert.equal(await emptyBucket.getByText("Sin muestra", { exact: true }).count(), 5);
    const measuredBucket = account.getByRole("row").filter({ has: page.getByRole("rowheader", { name: "72 h", exact: true }) });
    assert.equal((await measuredBucket.getByRole("cell").allTextContents()).filter(text => text === "0").length, 4, "measured zero engagement is retained");
    await page.screenshot({ path: path.join(artifacts, `clippers-fixture-accounts-${viewport.width}.png`), fullPage: true });
    await page.getByRole("tab", { name: "Fuentes y tendencias", exact: true }).click();
    const scout = page.getByTestId('clippers-viral-scout');
    await scout.getByText('Sin datos recientes para proponer videos. La búsqueda necesita una lectura verificable de las fuentes.', { exact: true }).waitFor();
    const creator = ALL_DISCOVERY_CREATORS[0], observedAt = new Date(now).toISOString(), publishedAt = new Date(now-12*3600000).toISOString();
    const sourceUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${creator.channelId}`;
    const publicRow = { creatorId: creator.id, channelId: creator.channelId, network:'youtube', videoId:'abcdefghijk', title:'Video de investigación '+ 'título largo '.repeat(20), url:'https://www.youtube.com/watch?v=abcdefghijk', sourceUrl,publishedAt,observedAt,views:100,metricEvidence:'direct_public_feed',permission:'unknown',mayPublish:false };
    const publicReceipt = (observations, at) => ({schemaVersion:2,observedAt:at,paidSpendUsd:0,permission:'unknown',mayPublish:false,feeds:[{creatorId:creator.id,channelId:creator.channelId,sourceUrl,status:'observed',feedSha256:'a'.repeat(64)}],observations});
    const previousAt = new Date(now-2*3600000).toISOString();
    payload.discovery.scout = buildViralScout([publicReceipt([{...publicRow,observedAt:previousAt,views:40}],previousAt),publicReceipt([publicRow],observedAt)],new Date(now));
    await page.getByTestId('clippers-refresh').click();
    const video = scout.getByRole('link',{name:publicRow.title,exact:true});
    await video.waitFor();assert.equal(await video.getAttribute('href'),publicRow.url);assert.equal(await video.getAttribute('target'),'_blank');assert.equal(await video.getAttribute('rel'),'noopener noreferrer');
    await scout.getByText('Dos muestras: +60 views · 30 por hora',{exact:true}).waitFor();
    await scout.getByText('Candidato para revisión · permiso de uso pendiente · sin recortar ni publicar',{exact:true}).waitFor();
    assert.equal(await scout.getByRole('link',{name:'Fuente pública de los datos',exact:true}).getAttribute('href'),sourceUrl);
    assert.equal(await scout.evaluate(element=>element.scrollWidth<=element.clientWidth+1),true,'long candidate titles wrap inside the source area');
    await video.scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(artifacts,`clippers-fixture-viral-scout-${viewport.width}.png`),fullPage:true});
    await page.getByText(/13 canales prioritarios y una exploración rotativa/).waitFor();
    assert.equal(await page.getByText('Identidad del canal de origen',{exact:true}).count(),20);
    assert.equal(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true);
    await page.getByText("Primera observación; crecimiento aún sin medir", { exact: true }).waitFor();
    await page.getByText("Derechos pendientes de revisión del propietario", { exact: true }).waitFor();
    await page.getByRole("tab", { name: "Aprendizaje", exact: true }).click();
    assert.equal(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true);
    await page.getByTestId("clippers-no-improvements").waitFor();
    assert.match(await dialog.innerText(), /promoción de parámetros de edición requiere revisión manual/);
    payload.learning.comparisons = [{ id: "fixture-comparison", destination: payload.accounts[0].key, variable: "hook", baselineVersion: "baseline-1", candidateVersion: "candidate-2", controlSamples: 5, candidateSamples: 5, improvementRatio: 0.25, current: true, renderReceiptVerified: true, eligible: true, heldReasons: [] }];
    payload.learning.eligibleComparisons = 1;
    payload.creatorSelection={evaluatedAt:new Date(now).toISOString(),contexts:1,assigned:30,heldReasons:[],preferences:[{scopeKey:'a'.repeat(64),destination:{brandId:6431685,network:'tiktok',account:'streamersclips'},language:'en',format:'vertical_clip',context:'streamer_clip',postingBand:'10:00',timezone:'America/New_York',windowHours:24,baselineCreatorGroupId:'mrbeast',preferredCreatorGroupId:'thegrefg',status:'preferred',reason:'three_disjoint_batches_qualified',eligibleSamples:30,expiresAt:new Date(now+45000).toISOString(),evidenceSha256:'b'.repeat(64)}]};
    await page.getByTestId("clippers-refresh").click();
    await page.getByText(/Comparación vigente · Elegible para revisión/).waitFor();
    await page.getByText('Preferencia con evidencia: thegrefg',{exact:true}).waitFor();
    await page.getByText('Tres cohortes independientes superaron los controles de rendimiento.',{exact:true}).waitFor();
    await page.clock.fastForward(15000);
    await page.getByText('Referencia sin preferencia vigente: mrbeast',{exact:true}).waitFor();
    assert.equal(await page.getByText('Preferencia con evidencia: thegrefg',{exact:true}).count(),0,'clock expiry cannot leave a preference live');
    payload.creatorSelection.preferences[0].status='baseline';payload.creatorSelection.preferences[0].reason='creator_preference_expired';payload.creatorSelection.preferences[0].preferredCreatorGroupId='mrbeast';
    await page.screenshot({ path: path.join(artifacts, `clippers-fixture-learning-${viewport.width}.png`), fullPage: true });
    await page.clock.fastForward(60_000);
    await page.getByText("Sin señal reciente verificada", { exact: true }).waitFor();
    await page.getByRole('tab',{name:'Fuentes y tendencias',exact:true}).click();
    await page.getByTestId('clippers-viral-scout').getByText('Lectura anterior; prioridad actual sin confirmar.',{exact:true}).waitFor();
    await page.getByRole('tab',{name:'Aprendizaje',exact:true}).click();
    assert.equal(await page.getByText(/Comparación vigente · Elegible para revisión/).count(), 0);
    await page.getByText(/Comparación histórica · Elegibilidad sin verificar/).waitFor();
    replyStatus = 503;
    await page.getByTestId("clippers-refresh").click();
    await page.getByRole("alert").waitFor();
    assert.equal(await page.getByTestId("clippers-orchestra-report").count(), 0);
    replyStatus = 200; payload = orchestraFixture(now); payload.learning.promotions = null;
    for (const account of payload.accounts) account.eligibleAssets = null;
    await page.getByTestId("clippers-refresh").click();
    await page.getByTestId("clippers-orchestra-report").waitFor();
    await page.getByText("Sin evidencia", { exact: true }).first().waitFor();
    await page.getByRole("tab", { name: "Aprendizaje", exact: true }).click();
    assert.equal(await page.getByTestId("clippers-no-improvements").count(), 0, "missing evidence is not a measured zero");
    await page.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" });
    await page.waitForFunction(() => document.activeElement?.getAttribute("data-testid") === "open-clippers-office");
    verifiedId = "another-owner";
    const privateReads = requests.length;
    await trigger.click();
    await page.getByText("Verificando la sesión del propietario…", { exact: true }).waitFor();
    assert.equal(await page.getByTestId("clippers-orchestra-report").count(), 0);
    assert.equal(requests.length, privateReads, "mismatched session cannot read private report");
    await context.close();
  }
  assert.deepEqual(errors, []);
  assert.ok(requests.length > 0 && requests.every(method => method === "GET"), "reading the area cannot execute work");
});

test("compiled office mounts the Clippers area for its owner and preserves KONG controls", { timeout: 120_000 }, async () => {
  const previousTmp = process.env.TMPDIR;
  let fixture;
  try {
    const tempRoot = path.resolve(".cache/clippers-office-qa");
    await mkdir(tempRoot, { recursive: true });
    process.env.TMPDIR = tempRoot;
    fixture = await launchOfficeUiFixture(path.resolve("dist/public"), "a".repeat(40));
  } finally {
    if (previousTmp === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = previousTmp;
  }
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : undefined) });
  try {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      const context = await browser.newContext({ viewport, reducedMotion: "reduce", serviceWorkers: "block" });
      try {
        let partner = false, reads = 0;
        const fixtureOrigin = new URL(fixture.baseUrl).origin;
        await context.route("**/*", route => new URL(route.request().url()).origin === fixtureOrigin ? route.continue() : route.abort());
        await context.addInitScript(() => localStorage.setItem("agentsOffice.view.v2", "building"));
        await context.route("**/api/workspace/me", route => route.fulfill({ json: { role: partner ? "partner" : "owner", canManagePartners: !partner, blackRoomScope: null } }));
        await context.route("**/api/clippers/orchestra/status", route => { reads++; return route.fulfill({ json: orchestraFixture() }); });
        await context.route("https://fonts.googleapis.com/**", route => route.fulfill({ contentType: "text/css", body: "" }));
        const page = await context.newPage();
        page.setDefaultTimeout(15_000);
        const errors = [];
        page.on("pageerror", error => errors.push(error.message));
        await page.goto(new URL("/agents-office", fixture.baseUrl).href);
        await page.getByLabel("Usuario", { exact: true }).fill("fixture-owner");
        await page.getByLabel("Password", { exact: true }).fill("local-fixture-password");
        await page.getByRole("button", { name: "Entrar", exact: true }).last().click();
        const trigger = page.getByTestId("open-clippers-office");
        await trigger.waitFor();
        assert.equal(reads, 0, "office entry cannot start Clippers reads or jobs");
        assert.equal(await page.getByTestId("office-kong-repairs-slot").isVisible(), true);
        assert.equal(await page.getByTestId("office-open-kong").isVisible(), true);
        await trigger.click();
        await page.getByTestId("clippers-orchestra-report").waitFor();
        const dialog = page.getByTestId("clippers-office-dialog");
        assert.equal(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true);
        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "hidden" });
        await page.waitForFunction(() => document.activeElement?.getAttribute("data-testid") === "open-clippers-office");
        partner = true;
        await page.goto(new URL("/agents-office", fixture.baseUrl).href);
        await page.getByTestId("button-back-home").waitFor();
        assert.equal(await page.getByTestId("open-clippers-office").count(), 0);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    }
  } finally { await browser.close(); await fixture.close(); }
});
