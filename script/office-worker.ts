import "../server/env-loader";
import { assembleOfficeWorker } from "../server/office-worker-assembly";

async function main() {
let stopping = false;
// Wiring is shared with the bounded cloud invocation (script/office-worker-once.ts).
const host = await assembleOfficeWorker({ shouldStop: () => stopping });
const { worker, checkProtocol, academyCycle, capabilityTick, runOnce } = host;
try {
let lastAcademyTick = 0;
let lastCapabilityTick = 0;
let consecutiveFailures = 0;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });
process.on("message",message=>{if(message && typeof message === "object" && "type" in message && message.type === "office-shutdown") stopping=true;});
process.on("disconnect",()=>{stopping=true;});
const heartbeat = setInterval(() => { void worker.maintain().catch(() => console.error("Office worker maintenance unavailable")); }, 15_000);
const capabilities = setInterval(() => { void worker.refreshCapabilities().catch(() => console.error("Office worker provider checks unavailable")); }, 30_000);
try {
  await worker.refreshCapabilities();
  while (!stopping) {
    try {
      await checkProtocol();
      if (!stopping && academyCycle && Date.now() - lastAcademyTick >= 15 * 60000) {
        lastAcademyTick = Date.now(); await academyCycle();
      }
      if(capabilityTick && !stopping && Date.now()-lastCapabilityTick>=60000){lastCapabilityTick=Date.now();await capabilityTick();}
      if(!stopping) await worker.tick();
      consecutiveFailures = 0;
    }
    catch { consecutiveFailures++; console.error("Office worker cycle unconfirmed; no task will be retried automatically"); if (runOnce || (process.env.OFFICE_WORKER_FAIL_FAST === "true" && consecutiveFailures >= 3)) throw new Error("Persistent execution unconfirmed"); }
    if (runOnce) break;
    if (!stopping) await new Promise(resolve => setTimeout(resolve, 5000));
  }
} finally { clearInterval(heartbeat); clearInterval(capabilities); }
} finally { await host.close(); }
}
void main().then(() => { const supervised=process.connected; if(supervised) process.disconnect(); if (supervised || process.env.OFFICE_WORKER_RUN_ONCE === "true") process.exit(0); }).catch(() => {
  console.error("Office worker stopped: configuration or persistent execution is unavailable.");
  process.exitCode = 1;
  if (process.env.OFFICE_WORKER_RUN_ONCE === "true" || process.env.OFFICE_WORKER_FAIL_FAST === "true") process.exit(1);
});
