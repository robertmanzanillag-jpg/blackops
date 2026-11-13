import { createHash } from "node:crypto";
import { createOfficeOpenAI, type OfficeOpenAIResult } from "./office-openai";
import type { createSharedOpenAiCreditLedger } from "./shared-openai-credit-ledger";

/** Trusted Office adapter using the factory's SAME persistent account ledger.
 * Caller supplies an immutable assignment + phase ID, never a new ID on retry.
 * Does not initialize grants, read secrets, install a worker or change policies. */
export function createCreditLimitedOfficeRun(options: {
  ledger: ReturnType<typeof createSharedOpenAiCreditLedger>;
  env: NodeJS.ProcessEnv; fetch?: typeof fetch; now: () => Date;
  pricing: { model: string; inputNanoUsdPerToken: number; outputNanoUsdPerToken: number; validUntil: string };
  authorizeTokens: (limits: { model: string; promptBytes: number; maxOutputTokens: number }) => Promise<string>;
  recordTokens: (reservation: string, result: Omit<OfficeOpenAIResult, "text">) => Promise<void>;
}) {
  const { ledger, now, authorizeTokens, recordTokens } = options;
  const env = { ...options.env }, price = { ...options.pricing }, transport = options.fetch || fetch;
  if (!price.model || env.OFFICE_OPENAI_MODEL !== price.model ||
      ![price.inputNanoUsdPerToken, price.outputNanoUsdPerToken].every(n => Number.isSafeInteger(n) && n > 0) ||
      !Number.isFinite(Date.parse(price.validUntil))) throw Error("OFFICE_CREDIT_PRICING_INVALID");
  const cost = (input: number, output: number) => {
    if (![input, output].every(n => Number.isSafeInteger(n) && n >= 0)) throw Error("OFFICE_CREDIT_USAGE_INVALID");
    const micro = (BigInt(input) * BigInt(price.inputNanoUsdPerToken) + BigInt(output) * BigInt(price.outputNanoUsdPerToken) + 999n) / 1000n;
    if (micro > BigInt(Number.MAX_SAFE_INTEGER)) throw Error("OFFICE_CREDIT_COST_OVERFLOW");
    return Number(micro);
  };
  return async (prompt: string, executionId: string): Promise<OfficeOpenAIResult> => {
    if (!/^[A-Za-z0-9_.:-]{1,200}$/.test(executionId)) throw Error("OFFICE_CREDIT_ASSIGNMENT_REQUIRED");
    const key = `office:${createHash("sha256").update(executionId).digest("hex")}`;
    let admitted = false, tokenReservation: string | undefined;
    const provider = createOfficeOpenAI({ env, now,
      authorize: async limits => {
        if (now().getTime() >= Date.parse(price.validUntil)) throw Error("OFFICE_CREDIT_PRICING_EXPIRED");
        const requestSha256 = createHash("sha256").update(JSON.stringify([price, limits, prompt])).digest("hex");
        const reservation = await ledger.reserve({ key, consumer: "office", requestSha256,
          maximumMicroUsd: Math.max(1, cost(limits.promptBytes + 1024, limits.maxOutputTokens)) });
        if (!reservation.admitted) throw Error("OFFICE_CREDIT_ALREADY_ADMITTED");
        admitted = true;
        tokenReservation = await authorizeTokens(limits);
      },
      fetch: (async (url, init) => {
        const remaining = await ledger.executionWindow(key);
        const pricingRemaining = Date.parse(price.validUntil) - now().getTime();
        if (!Number.isFinite(pricingRemaining) || pricingRemaining <= 0) throw Error("OFFICE_CREDIT_PRICING_EXPIRED");
        const deadline = AbortSignal.timeout(Math.floor(Math.min(remaining, pricingRemaining)));
        const signal = init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
        signal.throwIfAborted();
        return transport(url, { ...init, signal });
      }) as typeof fetch,
      recordUsage: async metadata => {
        if (!tokenReservation || metadata.model !== price.model) throw Error("OFFICE_CREDIT_USAGE_UNVERIFIED");
        await ledger.settle({ key, actualMicroUsd: cost(metadata.usage.inputTokens, metadata.usage.outputTokens), evidenceId: metadata.sessionId });
        await recordTokens(tokenReservation, metadata);
      },
    });
    try { return await provider.runOfficeOpenAI(prompt); }
    catch {
      if (admitted) await ledger.markUnknown(key, `office-execution:${key.slice(7)}`).catch(() => undefined);
      throw Error("OFFICE_CREDIT_EXECUTION_UNCONFIRMED");
    }
  };
}
