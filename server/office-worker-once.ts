/**
 * Bounded, single invocation of the office executor for scheduled cloud hosts
 * (GitHub Actions). It reuses the PC worker's reviewed host operations and adds
 * only the outer bounds: exclusive ownership (never stolen), a maintenance
 * pause check, a hard run budget and a claim cutoff that leaves the full job
 * lease inside the budget. Uncertain or fenced work is never replayed: a failed
 * cycle ends the run, exactly as the PC worker's single-pass/fail-fast modes do.
 */
export const OFFICE_ONCE_MAX_DURATION_MS = 13 * 60_000;
/** Existing five-minute claim lease plus one minute for admission and settlement. */
export const OFFICE_ONCE_CLAIM_WINDOW_MS = 6 * 60_000;

export interface OfficeOnceOwnership {
  /** True only while this process still provably holds the exclusive lock. */
  verify(): Promise<boolean>;
  release(): Promise<void>;
}
export interface OfficeOnceHost {
  paused(): Promise<boolean> | boolean;
  /** Try once; resolve undefined when another executor owns the lock. Never waits or steals. */
  acquire(): Promise<OfficeOnceOwnership | undefined>;
  /** A non-cloud executor (the PC worker) with a recent heartbeat must not run concurrently. */
  otherExecutorActive(): Promise<boolean>;
  checkProtocol(): Promise<void>;
  refreshCapabilities(): Promise<void>;
  maintain(): Promise<void>;
  tick(): Promise<void>;
  academyCycle?: () => Promise<void>;
  capabilityTick?: () => Promise<void>;
  /** Cooperative stop for academy/business runners (their shouldStop). */
  requestStop(): void;
}
export interface OfficeOnceClock {
  setTimeout(fn: () => void, ms: number): unknown; clearTimeout(id: unknown): void;
  setInterval(fn: () => void, ms: number): unknown; clearInterval(id: unknown): void;
}
export type OfficeOnceReason = "paused" | "busy" | "pc-active" | "deadline" | "aborted" | "unconfirmed";
export interface OfficeOnceResult { reason: OfficeOnceReason; cycles: number }

/** Static diagnostic only: an uppercase code we authored, a driver/system code
 * (SQLSTATE such as 28P01, or ENOTFOUND/ECONNREFUSED) or the error class name.
 * Never the free-text message, which may contain hosts or configuration. */
export function safeFailureCode(error: unknown): string {
  try {
    const message = error instanceof Error ? Object.getOwnPropertyDescriptor(error, "message")?.value : undefined;
    if (typeof message === "string" && /^[A-Z][A-Z0-9_]{2,80}$/.test(message)) return message;
    const code = error !== null && typeof error === "object" ? Object.getOwnPropertyDescriptor(error, "code")?.value : undefined;
    if (typeof code === "string" && /^[A-Z0-9_]{2,40}$/.test(code)) return `CODE_${code}`;
    const name = error instanceof Error ? error.name : undefined;
    if (typeof name === "string" && /^[A-Za-z]{1,40}$/.test(name)) return `CLASS_${name}`;
  } catch { /* a hostile error object must not break the report */ }
  return "UNKNOWN";
}

const defaultClock: OfficeOnceClock = {
  setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: id => clearTimeout(id as ReturnType<typeof setTimeout>),
  setInterval: (fn, ms) => setInterval(fn, ms), clearInterval: id => clearInterval(id as ReturnType<typeof setInterval>),
};

export async function runOfficeWorkerOnce(host: OfficeOnceHost, options: {
  signal: AbortSignal; durationMs: number; claimWindowMs?: number; pollMs?: number;
  maintainMs?: number; capabilitiesMs?: number; capabilityTickMs?: number;
  now?: () => number; clock?: OfficeOnceClock;
}): Promise<OfficeOnceResult> {
  const claimWindow = options.claimWindowMs ?? OFFICE_ONCE_CLAIM_WINDOW_MS;
  if (!Number.isSafeInteger(options.durationMs) || options.durationMs > OFFICE_ONCE_MAX_DURATION_MS || !Number.isSafeInteger(claimWindow) || claimWindow < 1 || options.durationMs <= claimWindow) throw Error("OFFICE_ONCE_LIMIT_INVALID");
  const now = options.now ?? (() => performance.now()), clock = options.clock ?? defaultClock;
  const pollMs = options.pollMs ?? 5000, maintainMs = options.maintainMs ?? 15_000, capabilitiesMs = options.capabilitiesMs ?? 30_000, capabilityTickMs = options.capabilityTickMs ?? 60_000;
  const started = now(); if (!Number.isFinite(started)) throw Error("OFFICE_ONCE_CLOCK_INVALID");
  const remaining = () => { const current = now(); if (!Number.isFinite(current) || current < started) throw Error("OFFICE_ONCE_CLOCK_INVALID"); return options.durationMs - (current - started); };
  let cycles = 0, failed = false, expired = false;
  const result = (reason: OfficeOnceReason): OfficeOnceResult => ({ reason, cycles });
  if (options.signal.aborted) return result("aborted");
  if (await host.paused()) return result("paused");
  const ownership = await host.acquire();
  if (!ownership) return result("busy");
  let wake: (() => void) | undefined;
  const stop = () => { host.requestStop(); wake?.(); };
  options.signal.addEventListener("abort", stop, { once: true });
  const deadline = clock.setTimeout(() => { expired = true; stop(); }, options.durationMs);
  let maintenance: Promise<void> | undefined, probing: Promise<void> | undefined;
  const timers: unknown[] = [];
  const halted = () => failed || expired || options.signal.aborted;
  try {
    if (await host.otherExecutorActive()) return result("pc-active");
    await host.checkProtocol();
    // Watchdog and presence: same cadence as the PC worker. A lost lock stops the run.
    timers.push(clock.setInterval(() => {
      if (maintenance || halted()) return;
      maintenance = (async () => {
        if (!(await ownership.verify())) throw Error("OFFICE_ONCE_OWNERSHIP_LOST");
        await host.maintain();
      })().catch(error => { console.error(`Office worker maintenance unconfirmed; code=${safeFailureCode(error)}`); failed = true; stop(); }).finally(() => { maintenance = undefined; });
    }, maintainMs));
    timers.push(clock.setInterval(() => {
      if (probing || halted()) return;
      probing = host.refreshCapabilities().catch(() => console.error("Office worker provider checks unavailable")).finally(() => { probing = undefined; });
    }, capabilitiesMs));
    await host.refreshCapabilities();
    let lastCapabilityTick = -Infinity;
    let academyDone = false;
    while (true) {
      if (failed) return result("unconfirmed");
      if (options.signal.aborted) return result("aborted");
      if (expired || remaining() < claimWindow) return result("deadline");
      if (await host.paused()) return result("paused");
      if (!(await ownership.verify())) return result("unconfirmed");
      try {
        await host.checkProtocol();
        // One academy pass per invocation: the cloud schedule supplies the PC's fifteen-minute cadence.
        if (host.academyCycle && !academyDone && !halted()) { academyDone = true; await host.academyCycle(); }
        if (host.capabilityTick && !halted() && now() - lastCapabilityTick >= capabilityTickMs) { lastCapabilityTick = now(); await host.capabilityTick(); }
        // Re-check the cutoff: a claim must keep its full lease inside the run budget.
        if (!halted() && remaining() >= claimWindow) await host.tick();
      } catch (error) {
        console.error(`Office worker cycle unconfirmed; no task will be retried automatically. code=${safeFailureCode(error)}`);
        return result("unconfirmed");
      }
      cycles++;
      if (halted()) continue;
      await new Promise<void>(resolve => { const id = clock.setTimeout(() => { wake = undefined; resolve(); }, pollMs); wake = () => { clock.clearTimeout(id); wake = undefined; resolve(); }; });
    }
  } catch (error) { console.error(`Office worker run unconfirmed; code=${safeFailureCode(error)}`); return result("unconfirmed"); }
  finally {
    clock.clearTimeout(deadline); for (const id of timers) clock.clearInterval(id);
    host.requestStop(); options.signal.removeEventListener("abort", stop);
    await maintenance; await probing;
    // Released only after every owned operation settled; a crash leaves the
    // database lock to PostgreSQL session cleanup and fenced jobs to their leases.
    await ownership.release().catch(() => console.error("Office worker ownership release unconfirmed"));
  }
}
