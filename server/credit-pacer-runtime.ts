import {
  advanceCreditPacer, computePace, decidePace, estimateTask, fundableUnits, pacedOutputTokens, parseCreditPacerState, pacerSettings,
  type CreditPacerLedgerState, type PaceDecision, type PacerAlert, type PacerCostSample, type PacerPriority, type PacerSettings, type PacerSnapshot,
  type PacerTaskType, type PaceState,
} from "./credit-pacer";
import type { CompanyState } from "../shared/agent-company";

/**
 * Runtime wrapper around the pure pacer. Reads the ledger snapshot (one short
 * read-only ledger transaction, cached for `cacheMs`) and the persisted cost
 * history; makes no paid call and never reserves credits itself. Any ledger can
 * be governed: pass its own `readSnapshot` (for example a separate Anthropic ledger).
 */
export function createCreditPacer(options: {
  readSnapshot: () => Promise<PacerSnapshot>;
  readHistory?: (ledgerId: string) => Promise<CreditPacerLedgerState | undefined>;
  env?: Record<string, string | undefined>; settings?: PacerSettings; now?: () => number; cacheMs?: number;
}) {
  const now = options.now ?? Date.now, cacheMs = options.cacheMs ?? 30_000;
  const settings = options.settings ?? pacerSettings(options.env ?? {});
  let cached: { at: number; snapshot: PacerSnapshot; history?: CreditPacerLedgerState } | undefined;
  const samples: PacerCostSample[] = [];
  const load = async () => {
    const at = now();
    if (!cached || at - cached.at >= cacheMs || at < cached.at) {
      const snapshot = await options.readSnapshot();
      cached = { at, snapshot, history: await options.readHistory?.(snapshot.ledgerId).catch(() => undefined) };
    }
    return cached;
  };
  const pacer = {
    settings,
    async pace(): Promise<PaceState> { return computePace((await load()).snapshot, now()); },
    async estimate(taskType: PacerTaskType): Promise<number> { const loaded = await load(); return estimateTask(loaded.history, taskType, computePace(loaded.snapshot, now()).day); },
    /** Ask before reserving. `estimateMicroUsd` defaults to the measured average of the task type. */
    async allow(priority: PacerPriority, taskType: PacerTaskType, estimateMicroUsd?: number): Promise<PaceDecision & { pace: PaceState; estimateMicroUsd: number }> {
      const loaded = await load(), pace = computePace(loaded.snapshot, now());
      const estimate = estimateMicroUsd ?? estimateTask(loaded.history, taskType, pace.day);
      return { ...decidePace(pace, { priority, estimateMicroUsd: estimate }, settings), pace, estimateMicroUsd: estimate };
    },
    /** Standard-priority units of this task type today's allowance can still fund. */
    async fundable(taskType: PacerTaskType): Promise<number> {
      const loaded = await load(), pace = computePace(loaded.snapshot, now());
      return fundableUnits(pace, estimateTask(loaded.history, taskType, pace.day));
    },
    async outputTokens(base: number): Promise<number> { try { return pacedOutputTokens(await pacer.pace(), base, settings); } catch { return base; } },
    /** Records a measured office cost (task type is derived by the trusted caller). */
    record(sample: PacerCostSample) { if (samples.length < 500) samples.push(sample); cached = undefined; },
    pendingSamples(): number { return samples.length; },
    takeSamples(): PacerCostSample[] { return samples.splice(0, samples.length); },
    invalidate() { cached = undefined; },
    async snapshot() { return (await load()).snapshot; },
  };
  return pacer;
}
export type CreditPacer = ReturnType<typeof createCreditPacer>;

const usd = (micro: number) => (Math.round(micro / 10_000) / 100).toFixed(2);

/** Fixed Spanish text built only from enum values and numbers (no free text). */
export function pacerAlertText(alert: PacerAlert): string {
  const numbers = `Hoy: $${usd(alert.spentTodayMicroUsd)} de $${usd(alert.allowanceMicroUsd)}. Usado: $${usd(alert.usedMicroUsd)} de $${usd(alert.grantMicroUsd)}. Proyección al vencimiento: $${usd(alert.projectedTotalMicroUsd)}.`;
  return alert.kind === "overspend_streak"
    ? `Presupuesto API: ${alert.streakDays} días seguidos por encima del límite diario. El ritmo ya se suavizó automáticamente. ${numbers}`
    : `Presupuesto API: se usó el ${alert.percent}% del crédito. ${numbers}`;
}

type Council = { updateOfficeExecution(change: (execution: any, company: CompanyState) => any): Promise<unknown> };

/**
 * Office worker step: persists today's pace, per-day history and cost per task
 * type in officeExecution.creditPacer (same council row; no migration) and posts
 * each new alert once to the office company feed. The GitHub issue for the
 * owner is created by the workflow (script/credit-pacer-notify.ts) from the
 * persisted alert log. The transaction callback is pure (CAS replay safe).
 */
export function createCreditPacerSync(options: { council: Council; pacer: CreditPacer; now?: () => number }) {
  const now = options.now ?? Date.now;
  return async () => {
    options.pacer.invalidate();
    const snapshot = await options.pacer.snapshot(), samples = options.pacer.takeSamples(), at = now();
    let alerts: PacerAlert[] = [];
    try {
      await options.council.updateOfficeExecution((execution, company) => {
        const result = advanceCreditPacer({ state: execution.creditPacer, snapshot, now: at, samples, settings: options.pacer.settings });
        alerts = result.alerts;
        if (alerts.length) Object.assign(company, { events: [...alerts.map(a => ({ at: a.at, text: pacerAlertText(a) })), ...company.events].slice(0, 40) });
        return { ...execution, creditPacer: result.state };
      });
    } catch (error) {
      // Samples are statistics only; put them back for the next sync.
      for (const sample of samples) options.pacer.record(sample);
      throw error;
    }
    options.pacer.invalidate();
    return { alerts };
  };
}

/** Reads the persisted history of one ledger from the council state (best effort). */
export function councilPacerHistory(load: () => Promise<{ officeExecution?: { creditPacer?: unknown } }>) {
  return async (ledgerId: string) => parseCreditPacerState((await load()).officeExecution?.creditPacer).ledgers[ledgerId];
}

/**
 * Worker-side gate over an optional pacer. `required` means a shared credit ledger is
 * configured: if the pacer could not be built the gate REFUSES everything (no paid work,
 * no fundable self-heal orders) instead of running unpaced. Without a configured ledger
 * there is nothing to pace and everything is allowed (the previous limits apply).
 */
export function createPacerGate(input: { pacer?: CreditPacer; required: boolean }) {
  const { pacer } = input, refuse = input.required && !pacer;
  const gate = {
    /** True when admission is governed (pacer present, or refusing because it is missing). */
    governed: !!pacer || refuse,
    refusing: refuse,
    async allows(priority: "standard" | "deferrable", taskType: PacerTaskType): Promise<boolean> {
      if (refuse) return false;
      if (!pacer) return true;
      try { return (await pacer.allow(priority, taskType)).allowed; } catch { return false; }
    },
    async fundable(taskType: PacerTaskType): Promise<number> {
      if (!pacer) return 0;
      return pacer.fundable(taskType);
    },
    async outputTokens(base: number): Promise<number> { return pacer ? pacer.outputTokens(base) : base; },
    /** Reviewer admission: claimed only while the standard-priority pace allows it. */
    admission<A extends { ready: () => Promise<boolean> }>(admission: A): A {
      return { ...admission, ready: async () => (await gate.allows("standard", "office_review")) && admission.ready() };
    },
  };
  return gate;
}
