import test from "node:test";
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { factorySimulationSchema, runFactorySimulation } from "../server/software-factory-simulator";

const sha = "a".repeat(40), nextSha = "b".repeat(40);
const scenarios = [{ id: "save-and-reload", path: "/", steps: [{ action: "fill", selector: "input", value: "synthetic" }, { action: "click", selector: "button" }, { action: "text", selector: "output", value: "synthetic" }, { action: "reload" }, { action: "text", selector: "output", value: "synthetic" }] }];
test("simulator rejects production and ambiguous origins", () => {
  for (const baseUrl of ["https://example.com/", "http://localhost:3000/", "http://127.0.0.1:3000/private", "http://user:password@127.0.0.1:3000/"]) {
    assert.equal(factorySimulationSchema.safeParse({ projectId: "fixture", baseline: { baseUrl, headSha: sha }, candidate: { baseUrl, headSha: nextSha }, scenarios }).success, false);
  }
});

test("synthetic browser rehearsal detects seeded defect, verifies three repairs and detects regression before restoring fixture", { timeout: 600000 }, async (t) => {
  let broken = true;
  const server = createServer((req, res) => {
    res.setHeader("content-type", "text/html");
    res.setHeader("x-factory-head-sha", sha);
    const isBroken = req.url?.startsWith("/candidate") && broken;
    res.end(`<input aria-label="Name"><button>Save</button><output></output><script>const o=document.querySelector('output');o.textContent=localStorage.name||'';document.querySelector('button').onclick=()=>{${isBroken ? "" : "localStorage.name=document.querySelector('input').value;o.textContent=localStorage.name;"}}</script>`);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  // Both versions are served by separate loopback origins with identical paths.
  const candidate = createServer((_req, res) => {
    res.setHeader("content-type", "text/html");
    res.setHeader("x-factory-head-sha", nextSha);
    res.end(`<input aria-label="Name"><button>Save</button><output></output><script>const o=document.querySelector('output');o.textContent=localStorage.name||'';document.querySelector('button').onclick=()=>{${broken ? "" : "localStorage.name=document.querySelector('input').value;o.textContent=localStorage.name;"}}</script>`);
  });
  await new Promise<void>(resolve => candidate.listen(0, "127.0.0.1", resolve));
  const candidateAddress = candidate.address(); assert.ok(candidateAddress && typeof candidateAddress !== "string");
  const root = await mkdtemp(path.join(os.tmpdir(), "factory-simulator-"));
  const input = { projectId: "synthetic-fixture", baseline: { baseUrl: `http://127.0.0.1:${address.port}/`, headSha: sha }, candidate: { baseUrl: `http://127.0.0.1:${candidateAddress.port}/`, headSha: nextSha }, scenarios };
  const options = { artifactRoot: root, signal: t.signal, timeoutMs: 10000, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : undefined) };
  const browser = await chromium.launch({ executablePath: options.executablePath });
  const browserOptions = { ...options, browser };
  try {
    const failure = await runFactorySimulation(input, browserOptions);
    assert.equal(failure.passed, false); assert.equal(failure.regressions.length, 2, JSON.stringify(failure));
    broken = false;
    for (let cycle = 0; cycle < 3; cycle++) {
      const result = await runFactorySimulation(input, browserOptions);
      assert.equal(result.passed, true, JSON.stringify(result)); assert.equal(result.synthetic, true);
      assert.equal(result.candidate.headSha, nextSha);
      const bytes = await readFile(path.join(result.artifactDirectory, "evidence.json"));
      assert.equal(createHash("sha256").update(bytes).digest("hex"), result.evidenceSha256);
      for (const item of result.candidate.cases) assert.equal(createHash("sha256").update(await readFile(path.join(result.artifactDirectory, item.screenshot))).digest("hex"), item.screenshotSha256);
    }
    broken = true;
    assert.equal((await runFactorySimulation(input, browserOptions)).passed, false);
    broken = false;
    assert.equal((await runFactorySimulation(input, browserOptions)).passed, true);
  } finally {
    await browser.close();
    await Promise.all([new Promise<void>(resolve => server.close(() => resolve())), new Promise<void>(resolve => candidate.close(() => resolve()))]);
    await rm(root, { recursive: true, force: true });
  }
});
