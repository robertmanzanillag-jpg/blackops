// Optional model for open questions in the per-agent chat. OFF by default ($0).
// When on, it is the office's own execution path (server/office-execution.ts): the same monthly
// token budget (OFFICE_OPENAI_MONTHLY_TOKEN_LIMIT, persisted in the council state) and, when
// configured, the same shared OpenAI credit ledger. It never retries a possibly billed call.
import type { CouncilState } from "@shared/agent-council";
import { AgentChatModelError, type AgentChatModel } from "./agent-chat";

type Council = Parameters<typeof import("./office-execution").createOfficeExecution>[0] & { load(): Promise<CouncilState> };

export function agentChatModelEnabled(env: NodeJS.ProcessEnv) {
  return env.AGENT_CHAT_MODEL_ENABLED === "true" && env.OFFICE_REVIEW_PROVIDER === "openai";
}

/** Tokens already reserved or used this month, the same sum office-token-budget.ts enforces. */
export function officeTokensUsed(state: CouncilState, now: Date) {
  const month = now.toISOString().slice(0, 7);
  return (state.officeExecution?.tokens?.reservations || []).reduce((sum, row) =>
    sum + (row.status === "reserved" ? row.reservedTokens : row.month === month ? row.result?.usage.totalTokens || 0 : 0), 0);
}

export function createAgentChatModel(council: Council, env: NodeJS.ProcessEnv = process.env, deps: {
  now?: () => number; run?: (prompt: string, executionId: string) => Promise<{ text: string }>;
} = {}): AgentChatModel | undefined {
  if (!agentChatModelEnabled(env)) return undefined;
  const now = deps.now || Date.now;
  const maxOutput = Math.min(800, Math.max(64, Number(env.AGENT_CHAT_MAX_OUTPUT_TOKENS || 400) || 400));
  const scopedEnv = { ...env, OFFICE_OPENAI_MAX_OUTPUT_TOKENS: String(maxOutput) };
  let runner = deps.run;
  return {
    async ask(prompt, requestId) {
      const limit = Number(env.OFFICE_OPENAI_MONTHLY_TOKEN_LIMIT);
      if (!Number.isSafeInteger(limit) || limit < 1) throw new AgentChatModelError("disabled");
      // Honest pre-check against the persisted budget, before any provider call.
      const needed = Buffer.byteLength(prompt) + maxOutput + 1024;
      if (officeTokensUsed(await council.load(), new Date(now())) + needed > limit) throw new AgentChatModelError("budget_exhausted");
      if (!runner) {
        const { createOfficeExecution } = await import("./office-execution");
        runner = createOfficeExecution(council, scopedEnv, now).run as NonNullable<typeof runner>;
      }
      try { return (await runner(prompt, `agent-chat:${requestId}`)).text; }
      catch (error) {
        const code = (error as { code?: string })?.code;
        throw new AgentChatModelError(code === "token_budget_exhausted" ? "budget_exhausted" : "unavailable");
      }
    },
  };
}
