import path from "node:path";
import { pathToFileURL } from "node:url";
import { softwareFactoryStore } from "./software-factory-store";

type FactoryStore = typeof softwareFactoryStore;
type Configuration = { backend?: string; modulePath?: string };

/** One operator-selected ledger for web controls, pipeline and worker. Selection
 * is frozen on first use; errors never silently fall back to another budget. */
export function createFactoryStoreProvider(options: {
  configuration: () => Configuration;
  loadModule: (url: string) => Promise<unknown>;
  postgres: FactoryStore;
}): FactoryStore {
  let selected: Promise<FactoryStore> | undefined;
  const resolve = () => selected ??= (async () => {
    const config = options.configuration();
    if ((config.backend === undefined || config.backend === "postgres") && !config.modulePath) return options.postgres;
    if (config.backend !== "object" || !config.modulePath || !path.isAbsolute(config.modulePath)) {
      throw new Error("FACTORY_STORAGE_SELECTION_INVALID");
    }
    const module = await options.loadModule(pathToFileURL(config.modulePath).href) as { createFactoryStore?: unknown };
    if (!module || typeof module.createFactoryStore !== "function") throw new Error("FACTORY_STORAGE_PROVIDER_INVALID");
    const store = await module.createFactoryStore();
    if (!store || typeof store !== "object" || Object.keys(options.postgres).some(key => typeof store[key] !== "function")) {
      throw new Error("FACTORY_STORAGE_PROVIDER_INVALID");
    }
    return store as FactoryStore;
  })();
  return Object.fromEntries(Object.keys(options.postgres).map(key => [key, async (...args: unknown[]) => {
    const store = await resolve();
    return (store[key as keyof FactoryStore] as (...values: unknown[]) => Promise<unknown>).apply(store, args);
  }])) as FactoryStore;
}

export const configuredSoftwareFactoryStore = createFactoryStoreProvider({
  configuration: () => ({ backend: process.env.SOFTWARE_FACTORY_STORAGE_BACKEND, modulePath: process.env.SOFTWARE_FACTORY_STORE_MODULE }),
  loadModule: url => import(url),
  postgres: softwareFactoryStore,
});
