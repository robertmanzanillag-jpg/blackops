import type { createSoftwareFactoryWorker } from "./software-factory-worker";
import type { FactoryLoopClock } from "./software-factory-loop";

export const FACTORY_CLAIM_WINDOW_MS = 10 * 60 * 1000 + 60000;
const clockDefault: FactoryLoopClock = {
  setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: id => clearTimeout(id as ReturnType<typeof setTimeout>),
  setInterval: (fn, ms) => setInterval(fn, ms), clearInterval: id => clearInterval(id as ReturnType<typeof setInterval>),
};
export type FactoryOnceResult = { reason: "idle" | "busy" | "stage-limit" | "deadline" | "aborted" | "quarantined"; progressed: number };
/** Runs trusted adapters only. Never retries uncertain work or waits while idle.
 * The claim window preserves the existing ten-minute lease plus settlement time.
 * Host termination still requires durable unknown-outcome reconciliation. */
export async function runSoftwareFactoryOnce(worker: ReturnType<typeof createSoftwareFactoryWorker>, options: {
  signal: AbortSignal; maxStages: number; durationMs: number; now?: () => number; clock?: FactoryLoopClock;
}): Promise<FactoryOnceResult> {
  if (!Number.isSafeInteger(options.maxStages) || options.maxStages < 1 || options.maxStages > 8 || !Number.isSafeInteger(options.durationMs) || options.durationMs < FACTORY_CLAIM_WINDOW_MS || options.durationMs > 30 * 60 * 1000) throw Error("FACTORY_ONCE_LIMIT_INVALID");
  const now = options.now ?? (() => performance.now()), clock = options.clock ?? clockDefault;
  const started = now(); if (!Number.isFinite(started)) throw Error("FACTORY_ONCE_CLOCK_INVALID");
  let progressed = 0, failed = false, expired = false, maintenance: Promise<void> | undefined;
  const stop = () => worker.stop();
  const remaining = () => { const current = now(); if (!Number.isFinite(current) || current < started) throw Error("FACTORY_ONCE_CLOCK_INVALID"); return options.durationMs - (current - started); };
  const outcome = (reason: FactoryOnceResult["reason"]): FactoryOnceResult => ({ reason, progressed });
  options.signal.addEventListener("abort", stop, { once: true });
  const deadline = clock.setTimeout(() => { expired = true; stop(); }, options.durationMs);
  const maintain = () => {
    if (maintenance || failed || expired || options.signal.aborted) return;
    maintenance = worker.maintain().catch(() => { failed = true; stop(); }).finally(() => { maintenance = undefined; });
  };
  let interval: unknown;
  try {
    if (options.signal.aborted) return outcome("aborted");
    if (remaining() < FACTORY_CLAIM_WINDOW_MS) return outcome("deadline");
    // Admission failures may be ambiguous. Never continue after a lost queue ack.
    await worker.schedule();
    interval = clock.setInterval(maintain, 15000);
    while (progressed < options.maxStages) {
      if (failed) return outcome("quarantined");
      if (options.signal.aborted) return outcome("aborted");
      if (expired || remaining() < FACTORY_CLAIM_WINDOW_MS) return outcome("deadline");
      const result = await worker.tick();
      if (maintenance) await maintenance;
      if (failed) return outcome("quarantined");
      if (options.signal.aborted) return outcome("aborted");
      if (result.kind === "quarantined") return outcome("quarantined");
      if (expired) return outcome("deadline");
      if (result.kind === "idle") return outcome("idle");
      if (result.kind === "retry") return outcome("busy");
      progressed++;
    }
    return outcome("stage-limit");
  } catch { return outcome("quarantined"); }
  finally {
    clock.clearTimeout(deadline); if (interval !== undefined) clock.clearInterval(interval);
    stop(); await maintenance; options.signal.removeEventListener("abort", stop);
  }
}
