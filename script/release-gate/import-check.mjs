#!/usr/bin/env node
// Release gate: every changed source file must still load.
//   server/**, shared/**  -> really imported in a child `node --import tsx` with a scrubbed env
//                           (no database, no keys, NODE_ENV=test); must resolve within the timeout.
//   client/**             -> bundled with esbuild (tsconfig paths, assets stubbed) so every import
//                           resolves; the browser runtime itself is covered by the smoke suite.
// Entrypoints that do real work at import time are listed in SKIP with the reason; they are
// covered by the build, typecheck and the sandbox boot instead.
//
// Usage: node script/release-gate/import-check.mjs <file>...   (or --base <rev>: files changed between <rev> and HEAD)
import { spawn, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SKIP = new Map([
  ["server/index.ts", "starts the HTTP server at import; covered by the sandbox boot"],
  ["server/office-worker-assembly.ts", "top-level await opens the office protocol check; covered by the build"],
]);

const args = process.argv.slice(2);
let files = args.filter((arg) => !arg.startsWith("--"));
const baseIndex = args.indexOf("--base");
if (baseIndex >= 0) {
  const base = args[baseIndex + 1];
  files = execFileSync("git", ["diff", "--name-only", "--diff-filter=ACMR", base, "HEAD"], { encoding: "utf8" })
    .split("\n").filter(Boolean);
}
files = files.filter((file) => /^(server|shared|client)\/.*\.(ts|tsx|mts|mjs|js|jsx)$/.test(file) && !/\.d\.ts$/.test(file) && !path.basename(file).startsWith("._") && existsSync(file));

const SCRUB = /(^DATABASE_URL$|_DATABASE_URL$|API_KEY|TOKEN|SECRET|PASSWORD|^PG[A-Z]+$|^GH_)/;
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !SCRUB.test(key)));
env.NODE_ENV = "test";

function importServerFile(file) {
  return new Promise((resolve) => {
    const url = pathToFileURL(path.resolve(file)).href;
    const code = `import(${JSON.stringify(url)}).then(()=>process.exit(0),(e)=>{console.error(String(e&&e.stack||e).split("\\n").slice(0,6).join("\\n"));process.exit(1)})`;
    const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], { env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    const timer = setTimeout(() => child.kill("SIGKILL"), 60_000);
    child.on("close", (status, signal) => {
      clearTimeout(timer);
      resolve({ ok: status === 0, note: signal ? "timed out" : output.trim().slice(-1500) });
    });
  });
}

async function bundleClientFile(file) {
  const { build } = await import("esbuild");
  try {
    await build({
      entryPoints: [file], bundle: true, write: false, platform: "browser", format: "esm", logLevel: "silent",
      tsconfig: "tsconfig.json", packages: "external", jsx: "automatic",
      loader: { ".css": "empty", ".png": "empty", ".jpg": "empty", ".jpeg": "empty", ".svg": "empty", ".gif": "empty", ".webp": "empty", ".mp3": "empty", ".mp4": "empty", ".woff": "empty", ".woff2": "empty" },
    });
    return { ok: true, note: "" };
  } catch (error) {
    return { ok: false, note: (error?.errors || []).slice(0, 5).map((e) => `${e.location?.file || file}:${e.location?.line || 0} ${e.text}`).join("\n") || String(error).slice(0, 1500) };
  }
}

let failures = 0;
for (const file of files) {
  if (SKIP.has(file)) { console.log(`skip ${file} (${SKIP.get(file)})`); continue; }
  const result = file.startsWith("client/") ? await bundleClientFile(file) : await importServerFile(file);
  console.log(`${result.ok ? "ok  " : "FAIL"} ${file}`);
  if (!result.ok) {
    failures += 1;
    console.log(result.note);
    console.log(`::error file=${file}::changed file no longer imports cleanly`);
  }
}
console.log(`import check: ${files.length - failures}/${files.length} changed source files load`);
process.exitCode = failures ? 1 : 0;
