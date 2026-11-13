import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { z } from "zod";
import { createSharedOpenAiCreditLedger } from "./shared-openai-credit-ledger";
import { createSharedCreditTransaction } from "./shared-openai-credit-store";
import { getCouncilStore } from "./agent-council-store";

const configSchema = z.object({
  grant: z.object({ id: z.string(), accountScope: z.string(), availableMicroUsd: z.number(),
    observedAt: z.string(), expiresAt: z.string(), verificationEvidenceId: z.string() }).strict(),
  pricing: z.object({ model: z.string().min(1), inputNanoUsdPerToken: z.number().int().positive().safe(),
    outputNanoUsdPerToken: z.number().int().positive().safe(), validUntil: z.string().datetime() }).strict(),
}).strict();

/** Explicit local operator configuration; no credentials, auto-provision, grant
 * renewal, empty-state fallback or environment-discovered credit allowance. */
export async function loadSharedCreditRuntime(env: NodeJS.ProcessEnv, now: () => Date) {
  const path = env.OPENAI_SHARED_CREDIT_CONFIG;
  if (!path || !isAbsolute(path) || env.AGENT_COUNCIL_STORAGE !== "postgres") throw Error("CREDIT_RUNTIME_CONFIGURATION_REQUIRED");
  const raw = await readFile(path, "utf8");
  if (Buffer.byteLength(raw) > 16384) throw Error("CREDIT_RUNTIME_CONFIGURATION_INVALID");
  const config = configSchema.parse(JSON.parse(raw));
  const ledger = createSharedOpenAiCreditLedger({ grant: config.grant, now, maximumGrantObservationAgeMs: 60000,
    transact: createSharedCreditTransaction(await getCouncilStore(), config.grant.accountScope) });
  // Read validates existing state but never initializes it on startup/recovery.
  await ledger.status();
  return { ledger, pricing: config.pricing };
}
