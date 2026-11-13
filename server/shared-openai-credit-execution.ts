import type { createSharedOpenAiCreditLedger } from "./shared-openai-credit-ledger";

type Ledger = ReturnType<typeof createSharedOpenAiCreditLedger>;
/** Shared control-plane wrapper for both providers. Paid work must occur only
 * inside execute; repository/model code must never receive this ledger. */
export async function executeWithinSharedCredits<T>(ledger: Ledger, input: {
  key: string; consumer: "office" | "factory"; requestSha256: string; maximumMicroUsd: number;
}, execute: () => Promise<{ value: T; actualMicroUsd: number; evidenceId: string }>): Promise<T> {
  const request = structuredClone(input);
  const receipt = await ledger.reserve(request);
  if (!receipt.admitted) throw Error("CREDIT_EXECUTION_ALREADY_ADMITTED");
  try {
    const result = await execute();
    await ledger.settle({ key: request.key, actualMicroUsd: result.actualMicroUsd, evidenceId: result.evidenceId });
    return result.value;
  } catch {
    // Includes unknown network outcomes and lost settlement acknowledgement.
    // Never clear a hold or repeat a billed call on the basis of an exception.
    await ledger.markUnknown(request.key, `execution:${request.requestSha256}`).catch(() => undefined);
    throw Error("CREDIT_EXECUTION_UNCONFIRMED");
  }
}
