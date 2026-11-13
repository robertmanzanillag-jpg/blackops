import type { createSoftwareFactoryWorker, FactoryTickResult } from "./software-factory-worker";

export const FACTORY_IDLE_POLL_MS = 60 * 60 * 1000;
export interface FactoryLoopClock {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(callback: () => void, delayMs: number): unknown;
  clearInterval(handle: unknown): void;
}
const defaultClock: FactoryLoopClock = {
  setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
  setInterval: (fn, ms) => setInterval(fn, ms), clearInterval: handle => clearInterval(handle as ReturnType<typeof setInterval>),
};
function wait(clock: FactoryLoopClock, ms: number, signal: AbortSignal) {
  return new Promise<void>(resolve => {
    if (signal.aborted) { resolve(); return; }
    const finish = () => { clock.clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); };
    const timer = clock.setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
  });
}

/** Claims remain hourly while idle; process presence is maintained every 15s.
 * A heartbeat never certifies running work or release readiness. */
export async function runSoftwareFactoryLoop(worker: ReturnType<typeof createSoftwareFactoryWorker>, options: {
  signal: AbortSignal; clock?: FactoryLoopClock; onError?: (message: string) => void;
}): Promise<void> {
  const clock = options.clock ?? defaultClock;
  const report = options.onError ?? (() => {});
  const stop = () => worker.stop();
  options.signal.addEventListener("abort", stop, { once: true });
  try {
    while (!options.signal.aborted) {
      let maintenance: Promise<void> | undefined;
      let maintenanceFailed = false;
      const maintenanceStop=new AbortController();
      const maintain = () => {
        if (maintenance || maintenanceFailed || options.signal.aborted) return;
        maintenance = worker.maintain().catch(() => {
          maintenanceFailed = true; worker.stop(); maintenanceStop.abort(); report("Factory persistence unavailable; execution stopped.");
        }).finally(() => { maintenance = undefined; });
      };
      // Maintenance remains live during the idle claim interval.
      const timer = clock.setInterval(maintain, 15000);
      let result: FactoryTickResult = { kind: "quarantined" };
      try {
        maintain(); await maintenance;
        if (maintenanceFailed || options.signal.aborted) break;
        try { await worker.schedule(); }
        catch { report("Factory discovery admission blocked; existing funded work will continue."); }
        do {
          result = await worker.tick();
        } while (result.kind === "progressed" && !maintenanceFailed && !options.signal.aborted);
        if(!maintenanceFailed && result.kind!=="quarantined" && !options.signal.aborted)
          await wait(clock,result.kind==="idle"?FACTORY_IDLE_POLL_MS:result.kind==="retry"?result.delayMs:1,AbortSignal.any([options.signal,maintenanceStop.signal]));
      } catch {
        worker.stop(); report("Factory cycle outcome unconfirmed; operator reconciliation required.");
        result = { kind: "quarantined" };
      } finally {
        clock.clearInterval(timer);
        // Join maintenance before starting another cycle or completing shutdown.
        await maintenance;
      }
      if (maintenanceFailed || result.kind === "quarantined" || options.signal.aborted) break;

    }
  } finally { options.signal.removeEventListener("abort", stop); worker.stop(); }
}
