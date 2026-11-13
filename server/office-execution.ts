import { createHash } from "node:crypto";
import type { createAgentCouncil } from "./agent-council";
import { createOfficeOpenAI } from "./office-openai";
import { createOfficeTokenBudget } from "./office-token-budget";
import { createOfficeRuntime } from "./office-runtime";
import { probeOfficeClaude, runOfficeClaude } from "./office-claude";
import { reserveRoleExecution, completeRoleExecution, type RolePolicy } from "../shared/office-role-lifecycle";
import type { OfficeCloudRun, OfficeCloudCompletion } from "./office-cloud-store";
import { advanceCompany } from "../shared/agent-company";
import { createCreditLimitedOfficeRun } from "./office-shared-credits";
import { loadSharedCreditRuntime } from "./shared-openai-credit-runtime";

type Council = Pick<ReturnType<typeof createAgentCouncil>, "updateOfficeExecution">;
/** Private worker wiring. No HTTP endpoint can submit a policy or grade. */
export function createOfficeExecution(council: Council, env: NodeJS.ProcessEnv = process.env, now = Date.now,
  deps: { fetch?: typeof fetch; loadPr?: NonNullable<Parameters<typeof createOfficeRuntime>[0]>["loadPr"];
    sharedCredits?: Awaited<ReturnType<typeof loadSharedCreditRuntime>> } = {}) {
  const openai = env.OFFICE_REVIEW_PROVIDER === "openai";
  const budget = openai ? createOfficeTokenBudget({ limit: Number(env.OFFICE_OPENAI_MONTHLY_TOKEN_LIMIT),
    transact: async change => { await council.updateOfficeExecution(state => {
      const tokens = structuredClone(state.tokens); change(tokens); return { ...state, tokens };
    }); }, now: () => new Date(now()),
  }) : undefined;
  let activeExecutionId: string | undefined;
  const run = async (prompt: string, executionId?: string) => {
    if (!openai) return runOfficeClaude(prompt);
    if (deps.sharedCredits || env.OPENAI_SHARED_CREDIT_CONFIG || env.OPENAI_SHARED_CREDITS_REQUIRED === "true") {
      const assigned = executionId || activeExecutionId;
      if (!assigned) throw Error("OFFICE_CREDIT_ASSIGNMENT_REQUIRED");
      const shared = deps.sharedCredits || await loadSharedCreditRuntime(env, () => new Date(now()));
      return createCreditLimitedOfficeRun({ ...shared, env, now: () => new Date(now()), fetch: deps.fetch,
        authorizeTokens: limits => budget!.reserve(limits), recordTokens: (id, metadata) => budget!.recordUsage(id, metadata),
      })(prompt, assigned);
    }
    let reservation: string | undefined;
    const provider = createOfficeOpenAI({ env, fetch: deps.fetch,
      authorize: async limits => { reservation = await budget!.reserve(limits); },
      recordUsage: async metadata => { if (!reservation) throw new Error("Missing budget reservation"); await budget!.recordUsage(reservation, metadata); },
    });
    return provider.runOfficeOpenAI(prompt);
  };
  let policy: RolePolicy | undefined;
  const runtime = createOfficeRuntime({ claude: run, loadPr: deps.loadPr, reviewGuidance: () => policy?.guidance || [], reviewProvider: openai ? "openai" : "claude" });
  const roleId = "claude-reviewer";
  const admission = {
    async ready() {
      const state = await council.updateOfficeExecution(s => s);
      const role = state.roles.roles[roleId];
      return !!role && ["active", "probation"].includes(role.status) && !role.leases.some(l => ["running", "unknown"].includes(l.status));
    },
    async begin(task: OfficeCloudRun) {
      if (task.kind !== "claude_review" || !task.fence || !task.leaseExpiresAt) return false;
      let admitted = false; policy = undefined; activeExecutionId = undefined;
      await council.updateOfficeExecution(state => {
        admitted = false; policy = undefined;
        const active = state.roles.roles[roleId]?.activePolicy;
        if (!active) return state;
        const result = reserveRoleExecution(state.roles, { roleId, policyVersion: active.version, executionId: task.id,
          fence: task.fence!, now: now(), ttlMs: Math.min(300000, Date.parse(task.leaseExpiresAt!) - now()) });
        admitted = !!result.lease; policy = admitted ? active : undefined;
        return { ...state, roles: result.state };
      });
      if (admitted) activeExecutionId = `review:${task.id}`;
      return admitted;
    },
    async finish(task: OfficeCloudRun, result: OfficeCloudCompletion) {
      if (!policy || !task.fence) throw new Error("Missing policy assignment");
      const artifactId = createHash("sha256").update(JSON.stringify({ taskId: task.id, result })).digest("hex");
      const version = policy.version;
      let accepted = false;
      await council.updateOfficeExecution((state, company) => {
        const completion = completeRoleExecution(state.roles, { roleId, executionId: task.id, fence: task.fence!,
          policyVersion: version, now: now(), artifactId, success: result.status === "completed" && !!result.review && !!result.sessionId });
        accepted = completion.accepted;
        if (accepted && (result.status === "completed" || ["INVALID_REVIEW", "INVALID_RESULT"].includes(result.error?.code || ""))) {
          const scored = advanceCompany(company, { now: now(), roles: { [roleId]: "Reviewer" }, statuses: {
            [roleId]: { state: result.status === "completed" ? "working" : "error", label: "Verified reviewer result", evidenceId: task.id },
          } });
          Object.assign(company, scored.state);
        }
        return { ...state, roles: completion.state };
      });
      policy = undefined;
      activeExecutionId = undefined;
      if (!accepted) throw new Error("Role completion was not confirmed; reconcile stored cloud result before another run");
    },
  };
  return { run, execute: runtime.executeForCloud, admission,
    probe: openai ? createOfficeOpenAI({ env, authorize: async () => {}, recordUsage: async () => {} }).probeOfficeOpenAI : probeOfficeClaude };
}
