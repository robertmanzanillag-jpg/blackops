import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import path from "node:path";
import { promisify } from "node:util";
import { acquireMetricoolExports, buildVerifiedMetricoolExport, deliverMetricoolExports, metricoolPublicationInstant } from "../script/blackroom-metricool-exporter.mjs";

test("export times are explicit source observations and local publication time uses New York DST", () => {
  const result = buildVerifiedMetricoolExport({ network: "youtube", filename: "youtube-published-videos-posts_range.csv",
    text: "videoId,publishedAt,views,Average view duration\nabc,2026-09-27 14:03,37,00:04\n",
    observedAt: "2026-09-28T07:00:00Z", timezone: "America/New_York" });
  assert.equal(result.samples[0].publishedAt, "2026-09-27T18:03:00.000Z");
  assert.equal(result.samples[0].observedAt, "2026-09-28T07:00:00Z");
  assert.equal(result.samples[0].averageWatchSeconds, 4);
  assert.equal(metricoolPublicationInstant("2026-11-01T01:30:00"), undefined);
  assert.equal(metricoolPublicationInstant("2026-03-08T02:30:00"), undefined);
});
test("rejects wrong-platform files rather than attributing another account's export", () => {
  assert.throws(() => buildVerifiedMetricoolExport({ network: "youtube", filename: "tiktok-posts_range.csv", text: "URL,Views\na,1", observedAt: new Date().toISOString() }));
});
test("expired session returns independent errors and no fabricated zero metrics", async () => {
  let closed = false;
  const result = await acquireMetricoolExports({ context: { newPage: async () => ({
    setDefaultTimeout() {}, goto: async () => { throw new Error("expired session secret must not be logged"); }, close: async () => { closed = true; },
  }) }, now: () => new Date("2026-09-28T07:00:00Z") });
  assert.equal(closed, true);
  assert.deepEqual(result.imports, []);
  assert.deepEqual(Object.keys(result.errors), ["tiktok", "facebook", "youtube"]);
  assert.ok(!JSON.stringify(result).includes("secret"));
});

test("delivery continues across networks after an error and keeps batches bounded", async () => {
  const batches = [];
  const result = await deliverMetricoolExports({ imports: [
    { network: "tiktok", samples: [{}] },
    { network: "youtube", samples: Array.from({ length: 2001 }, (_, id) => ({ id })) },
  ] }, async (body) => {
    if (body.imports[0].network === "tiktok") throw new Error("private transport detail");
    batches.push(body.imports[0].samples.length);
  });
  assert.deepEqual(batches, [2000, 1]);
  assert.equal(result.imported, 2001);
  assert.equal(result.complete, false);
  assert.deepEqual(result.importedByNetwork, { youtube: 2001 });
  assert.ok(result.errors.tiktok);
  assert.ok(!JSON.stringify(result).includes("private"));
});

test("login redirect reports setup required rather than a healthy waiting collector", async () => {
  const result = await acquireMetricoolExports({ context: { newPage: async () => ({
    setDefaultTimeout() {}, goto: async () => {}, url: () => "https://app.metricool.com/login",
    close: async () => {},
  }) } });
  assert.equal(result.setupRequired, true);
  assert.equal(result.imports.length, 0);
});

test("transient delivery retries identical observations, counts once, and bounds retries", async () => {
  const payloads = [], waits = [];
  const input = { imports: [{ network: "tiktok", samples: [{ id: "one", observedAt: "2026-09-28T07:00:00Z" }] }] };
  const result = await deliverMetricoolExports(input, async (body) => {
    payloads.push(JSON.stringify(body));
    if (payloads.length < 3) throw Object.assign(new Error("private token"), { status: 503 });
  }, { sleep: async (ms) => { waits.push(ms); } });
  assert.equal(new Set(payloads).size, 1);
  assert.equal(result.imported, 1);
  assert.deepEqual(result.errors, {});
  assert.deepEqual(waits, [1000, 2000]);
  let attempts = 0;
  const failure = await deliverMetricoolExports(input, async () => {
    attempts++; throw Object.assign(new Error("private token"), { status: 503 });
  }, { sleep: async () => {} });
  assert.equal(attempts, 3);
  assert.equal(failure.imported, 0);
  assert.match(failure.errors.tiktok, /HTTP 503/);
  assert.ok(!JSON.stringify(failure).includes("private"));
});

test("permanent delivery errors are not retried", async () => {
  let attempts = 0;
  const result = await deliverMetricoolExports({ imports: [{ network: "youtube", samples: [{}] }] }, async () => {
    attempts++; throw Object.assign(new Error("private"), { status: 401 });
  }, { sleep: async () => { throw new Error("must not retry"); } });
  assert.equal(attempts, 1);
  assert.match(result.errors.youtube, /HTTP 401/);
});

test("complete import requires all three networks, not merely a recent successful delivery", async () => {
  const imports = ["tiktok", "facebook", "youtube"].map(network => ({ network, samples: [{}] }));
  const result = await deliverMetricoolExports({ imports }, async () => {});
  assert.equal(result.complete, true);
  assert.equal(result.imported, 3);
  assert.deepEqual(result.importedByNetwork, { tiktok: 1, facebook: 1, youtube: 1 });
  const partial = await deliverMetricoolExports({ imports: imports.slice(1) }, async () => {});
  assert.equal(partial.complete, false);
  assert.equal((await deliverMetricoolExports({ imports: imports.map(item => ({ ...item, samples: [] })) }, async () => {})).complete, false);
});

test("protected status exposes partial and complete automatic delivery without mistaking import for learning", async () => {
  // Execute the real control-server route with in-memory IO; never start the
  // production worker, export a real account, or load owner credentials.
  const source = (await readFile(new URL("../script/blackroom-control-server.mjs", import.meta.url), "utf8"))
    .replace(/^import .*;\n/gm, "");
  const observedAt = "2026-09-28T07:00:00Z";
  const exported = { checkedAt: observedAt, imports: ["tiktok", "facebook", "youtube"].map(network => ({ network, samples: [{ observedAt }] })) };
  let handler, fail = true;
  const context = vm.createContext({
    Buffer, URL, AbortSignal, console, path, promisify, deliverMetricoolExports,
    process: { cwd: () => "/fixture", platform: "darwin", execPath: "/fixture/node", env: { BLACKROOM_REMOTE_CONTROL_TOKEN: "fixture", BLACKROOM_CONTROL_PORT: "5020" } },
    homedir: () => "/fixture", randomBytes: () => Buffer.alloc(32), timingSafeEqual: (a, b) => a.equals(b),
    http: { createServer: (fn) => { handler = fn; return { listen() {} }; } },
    execFile: (...args) => args.at(-1)(null, { stdout: '{\n  "mode": "blackroom_daily_agent", "summary": {"enabled": true}}' }),
    stat: async () => ({ isDirectory: () => true }),
    readFile: async (file) => JSON.stringify(file.endsWith("latest-export.json") ? exported : {}),
    fetch: async (_url, options) => ({ ok: !(fail && JSON.parse(options.body).imports[0].network === "tiktok"), status: 401, json: async () => ({ accepted: true }) }),
    setTimeout: () => ({ unref() {} }), setInterval: () => ({ unref() {} }),
  });
  vm.runInContext(source, context);
  const status = async (authorized = true) => {
    let code, body;
    await handler({ method: "GET", url: "/api/status", headers: { host: "127.0.0.1:5020", ...(authorized ? { "x-blackroom-control": "00".repeat(32) } : {}) } },
      { writeHead: (value) => { code = value; }, end: (value) => { body = JSON.parse(value); } });
    return { code, body };
  };
  assert.equal((await status(false)).code, 403);
  await vm.runInContext("syncAutomaticAnalytics()", context);
  const partial = await status();
  assert.equal(partial.code, 200);
  assert.equal(partial.body.worker.automaticAnalytics.complete, false);
  assert.equal(partial.body.worker.automaticAnalytics.lastCompleteImportAt, null);
  assert.deepEqual(partial.body.worker.automaticAnalytics.importedByNetwork, { facebook: 1, youtube: 1 });
  fail = false;
  await vm.runInContext("nextExportAt = 0; syncAutomaticAnalytics()", context);
  const complete = (await status()).body.worker.automaticAnalytics;
  assert.equal(complete.complete, true);
  assert.equal(complete.lastCompleteImportAt, observedAt);
  assert.deepEqual(complete.errors, {});
  assert.deepEqual(complete.importedByNetwork, { tiktok: 1, facebook: 1, youtube: 1 });
  context.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
  await vm.runInContext("nextExportAt = 0; syncAutomaticAnalytics()", context);
  const noAcknowledgment = (await status()).body.worker.automaticAnalytics;
  assert.equal(noAcknowledgment.complete, false);
  assert.deepEqual(noAcknowledgment.importedByNetwork, {});
  const calls = [];
  const offline = vm.createContext({ ...context,
    process: { ...context.process, env: { BLACKROOM_CONTROL_PORT: "5020" } },
    fetch: async () => { throw new Error("No remote calls allowed"); },
    execFile: (...args) => { calls.push(args[1]); args.at(-1)(null, { stdout: "" }); },
  });
  vm.runInContext(source, offline);
  await vm.runInContext("syncAutomaticAnalytics()", offline);
  assert.equal(calls.filter(args => args.includes("script/blackroom-local-evidence.ts")).length, 1);
  assert.equal(vm.runInContext("automaticAnalyticsStatus.complete", offline), false);
  assert.equal(vm.runInContext("automaticAnalyticsStatus.lastCompleteImportAt", offline), null);
  assert.equal(vm.runInContext("automaticAnalyticsStatus.lastImportedAt", offline), null);
  // The optional KONG browser can be killed after committing BR. Exercise the
  // real supervisor catch path, not a substitute helper.
  const instant = Date.parse('2026-11-04T12:00:00Z');
  for (const [brandId, checkedAt, accepted] of [
    ['6585226', new Date(instant).toISOString(), true],
    ['6585226', new Date(instant-1).toISOString(), false],
    ['6475033', new Date(instant).toISOString(), false],
    ['6585226', new Date(instant+1).toISOString(), false],
  ]) {
    let localCalls=0;
    class FixedDate extends Date { static now(){return instant;} }
    const failedChild=vm.createContext({...context, Date:FixedDate,
      process:{...context.process,env:{BLACKROOM_CONTROL_PORT:'5020'}},
      readFile:async file=>JSON.stringify(file.endsWith('latest-export.json')?{...exported,brandId,checkedAt}:{}),
      execFile:(...args)=>{if(args[1].some(a=>a.endsWith('blackroom-metricool-exporter.mjs')))args.at(-1)(new Error('killed'));else{localCalls++;args.at(-1)(null,{stdout:''});}},
    });
    vm.runInContext(source,failedChild);
    await vm.runInContext('syncAutomaticAnalytics()',failedChild);
    assert.equal(localCalls,accepted?1:0,brandId+checkedAt);
  }
});

test('rejects wrong host brand and account prefix before downloading',async()=>{
 for(const kind of ['host','brand','identity']) {
  let current='',downloads=0;
  const loc={first(){return this},waitFor:async()=>{},getAttribute:async()=> 'https://www.tiktok.com/@kongnightlife-imposter'};
  const page={setDefaultTimeout(){},goto:async url=>{current=url},url:()=>kind==='host'?current.replace('app.metricool.com','evil.example'):kind==='brand'?current.replace('6475033','6585226'):current,
    locator:()=>loc,close:async()=>{},waitForEvent:async()=>{downloads++;throw Error('unexpected download')}};
  const result=await acquireMetricoolExports({brandId:'6475033',context:{newPage:async()=>page}});
  assert.equal(result.imports.length,0);assert.equal(downloads,0);assert.equal(Object.keys(result.errors).length,2);
 }
});

test("bounded network timeouts and cleanup failures preserve earlier successful exports", async () => {
  let pageIndex = 0, closed = 0;
  const locator = { first() { return this; }, nth() { return this; }, locator() { return this; },
    getByRole() { return this; }, waitFor: async () => {}, click: async () => {} };
  const result = await acquireMetricoolExports({ networkTimeoutMs: 10, context: { newPage: async () => {
    const index = pageIndex++;
    return { setDefaultTimeout() {}, goto: () => index === 0 ? Promise.resolve() : new Promise(() => {}),
      locator: () => locator, getByRole: () => locator, getByText: () => locator,
      waitForEvent: async () => ({ failure: async () => null,
        suggestedFilename: () => "tiktok-posts_range.csv",
        createReadStream: async () => (async function* () { yield Buffer.from("URL,Date,Views\nhttps://tiktok.com/@test/video/123,2026-09-20 12:00,50\n"); })(),
      }), close: async () => { closed++; if (index > 0) throw new Error("close failed after timeout"); } };
  } } });
  assert.equal(closed, 3);
  assert.equal(result.imports.length, 1);
  assert.equal(result.imports[0].network, "tiktok");
  assert.deepEqual(Object.keys(result.errors), ["facebook", "youtube"]);
});

test("authenticated-tab acquisition never opens a replacement tab or closes the login tab", async () => {
  let route = "", closes = 0;
  const locator = { first() { return this; }, nth() { return this; }, locator() { return this; },
    getByRole() { return this; }, waitFor: async () => {}, click: async () => {} };
  const page = { setDefaultTimeout() {}, goto: async (url) => { route = new URL(url).pathname; },
    locator: () => locator, getByRole: () => locator, getByText: () => locator,
    close: async () => { closes++; }, waitForEvent: async () => ({ failure: async () => null,
      suggestedFilename: () => route.includes("youtube") ? "youtube-published-videos-posts_range.csv" : route.includes("facebook") ? "facebook-reels_range.csv" : "tiktok-posts_range.csv",
      createReadStream: async () => (async function* () { yield Buffer.from("URL,Reel Link,videoId,Date,publishedAt,Views,Video Views\nhttps://tiktok.com/@test/video/123,https://facebook.com/reel/123,abc,2026-09-20 12:00,2026-09-20 12:00,50,50\n"); })(),
    }) };
  const result = await acquireMetricoolExports({ context: { newPage: () => { throw new Error("Must reuse login tab"); } }, authenticatedPage: page });
  assert.equal(result.imports.length, 3);
  assert.deepEqual(result.errors, {});
  assert.equal(closes, 0);
});
