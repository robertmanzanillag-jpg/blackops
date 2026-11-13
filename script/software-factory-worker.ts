import "../server/env-loader";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { stat } from "node:fs/promises";
import { createSoftwareFactoryWorker, type FactoryWorkerOptions } from "../server/software-factory-worker";
import { configuredSoftwareFactoryStore as softwareFactoryStore } from "../server/software-factory-store-provider";
import { validateFactoryWorkerOptions } from "../server/software-factory-runtime";
import { runSoftwareFactoryLoop } from "../server/software-factory-loop";

async function main() {
  if(process.argv.length>3 || (process.argv[2]!==undefined && process.argv[2]!=="--preflight"))throw Error("FACTORY_ARGUMENTS_INVALID");
  if (process.env.SOFTWARE_FACTORY_ENABLED !== "true") throw new Error("SOFTWARE_FACTORY_ENABLED_REQUIRED");
  // Operator-installed module only: never accept module paths from web requests,
  // project metadata, model output, or the repository being built.
  const modulePath=process.env.SOFTWARE_FACTORY_ADAPTER_MODULE;
  if (!modulePath || !path.isAbsolute(modulePath) || !(await stat(modulePath)).isFile()) throw new Error("FACTORY_TRUSTED_ADAPTER_MODULE_REQUIRED");
  const module=await import(pathToFileURL(modulePath).href);
  if (typeof module.createFactoryWorkerOptions !== "function") throw new Error("FACTORY_ADAPTER_FACTORY_REQUIRED");
  const config:FactoryWorkerOptions=await module.createFactoryWorkerOptions({store:softwareFactoryStore});
  validateFactoryWorkerOptions(config);
  if (config.store !== softwareFactoryStore) throw new Error("FACTORY_WORKER_STORAGE_MISMATCH");
  const owner=process.env.SOFTWARE_FACTORY_OWNER_ID;
  if (!owner) throw new Error("FACTORY_OWNER_REQUIRED");
  const state=await softwareFactoryStore.status(owner);
  if (!state.configured) throw new Error("FACTORY_FIXED_COST_RESERVATION_REQUIRED");
  if(process.argv[2]==="--preflight"){console.log("Factory existing configuration verified; no jobs admitted.");return;}
  const worker=createSoftwareFactoryWorker({...config,store:softwareFactoryStore,scheduleOwner:owner});
  const shutdown = new AbortController();
  const stop = () => shutdown.abort();
  const message = (value:unknown) => {if(value && typeof value==="object" && "type" in value && value.type==="factory-shutdown")stop();};
  process.on("message",message);process.once("disconnect",stop);
  process.once("SIGTERM",stop); process.once("SIGINT",stop);
  try {
    await runSoftwareFactoryLoop(worker, { signal: shutdown.signal, onError: message => console.error(message) });
  } finally {
    process.removeListener("SIGTERM",stop); process.removeListener("SIGINT",stop); worker.stop();
    process.removeListener("message",message);process.removeListener("disconnect",stop);
  }
}
void main().catch(()=>{console.error("Factory stopped: verify migration, fixed costs, owner and trusted adapter configuration.");process.exitCode=1;});
