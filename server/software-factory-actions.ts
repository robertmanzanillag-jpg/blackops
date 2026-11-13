import { createHash } from "node:crypto";

type Scope = { owner: string; repo: string };
interface Run {
  id: number; head_sha: string; head_branch: string; event: string;
  path: string; workflow_id: number; run_attempt: number;
  status: string; conclusion: string | null; html_url: string;
  repository: { full_name: string; private: boolean };
  head_repository: { full_name: string };
}
interface Job {
  run_id: number; head_sha: string; run_attempt?: number; name: string;
  status: string; conclusion: string | null; completed_at: string | null;
  labels: string[];
  steps: { name: string; status: string; conclusion: string | null }[];
}
/** Inject an authenticated, bounded GitHub REST client. Dispatch is opt-in and never retried. */
export interface FactoryActionsClient {
  git?: { getRef(input: Scope & { ref: string }): Promise<{ data: { ref: string; object: { type: string; sha: string } } }> };
  repos: {
    get(input: Scope): Promise<{ data: { full_name: string; private: boolean; archived: boolean; disabled: boolean } }>;
    getContent(input: Scope & { path: string; ref: string }): Promise<{ data: unknown }>;
  };
  actions: {
    listWorkflowRuns(input: Scope & { workflow_id: number; head_sha: string; event: "push" | "workflow_dispatch"; per_page: 100 }): Promise<{ data: { total_count: number; workflow_runs: Run[] } }>;
    createWorkflowDispatch?(input: Scope & { workflow_id: number; ref: string }): Promise<unknown>;
    listJobsForWorkflowRunAttempt(input: Scope & { run_id: number; attempt_number: number; per_page: 100 }): Promise<{ data: { total_count: number; jobs: Job[] } }>;
  };
}
export interface FactoryActionsProfile {
  trigger?: "push" | "workflow_dispatch";
  workflowId: number; workflowPath: string; workflowSha256: string;
  jobName: string; testStep: string; buildStep: string; browserStep: string;
}
type Candidate = { repository: string; baseSha: string; headSha: string; branch: string; patchSha256: string };
const sha = /^[a-f0-9]{40}$/;
const hash = /^[a-f0-9]{64}$/;
const reject = () => { throw new Error("FACTORY_ACTIONS_IDENTITY_UNVERIFIED"); };

export function createGitHubFactoryChecks(options: {
  readAcceptance?: (input: {runId:number;baseSha:string;headSha:string;signal:AbortSignal}) => Promise<{regressionScenarioIds:string[];artifactIds:string[]}>;
  client: FactoryActionsClient;
  repositories: Readonly<Record<string, FactoryActionsProfile>>;
  now?: () => Date;
  wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  maxPolls?: number;
}) {
  const profiles = new Map(Object.entries(options.repositories).map(([repo, value]) => [repo, Object.freeze({ ...value })]));
  const polls = options.maxPolls ?? 40;
  if (!Number.isInteger(polls) || polls < 1 || polls > 40) throw new Error("FACTORY_ACTIONS_CONFIGURATION_INVALID");
  for (const [repo, p] of profiles) {
    if ((p.trigger !== undefined && !["push", "workflow_dispatch"].includes(p.trigger)) || !/^[\w.-]+\/[\w.-]+$/.test(repo) || !Number.isSafeInteger(p.workflowId) || p.workflowId < 1 ||
        !/^\.github\/workflows\/[a-zA-Z0-9_-]+\.ya?ml$/.test(p.workflowPath) || !hash.test(p.workflowSha256) ||
        [p.jobName, p.testStep, p.buildStep, p.browserStep].some(x => !x?.trim()) || new Set([p.testStep, p.buildStep, p.browserStep]).size !== 3) throw new Error("FACTORY_ACTIONS_CONFIGURATION_INVALID");
  }
  const now = options.now ?? (() => new Date());
  const wait = options.wait ?? ((ms, signal) => new Promise<void>((resolve, rejectWait) => {
    signal.throwIfAborted();
    const abort = () => { clearTimeout(timer); rejectWait(new Error("FACTORY_ACTIONS_ABORTED")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
  }));
  async function preflight(repository: string, baseSha: string, signal: AbortSignal) {
    signal.throwIfAborted();
    const profile = profiles.get(repository);
    if (!profile || !sha.test(baseSha)) reject();
    const [owner, repo] = repository.split("/");
    const scope = { owner, repo };
    const r = (await options.client.repos.get(scope)).data;
    if (r.full_name !== repository || r.private !== false || r.archived !== false || r.disabled !== false) reject();
    const content = (await options.client.repos.getContent({ ...scope, path: profile!.workflowPath, ref: baseSha })).data as Record<string, unknown>;
    if (!content || content.type !== "file" || content.path !== profile!.workflowPath || content.encoding !== "base64" ||
        typeof content.content !== "string" || typeof content.size !== "number" || content.size > 65536) reject();
    const encoded = (content.content as string).replace(/\s/g, "");
    const bytes = Buffer.from(encoded, "base64");
    if (bytes.toString("base64") !== encoded || bytes.length !== content.size ||
        createHash("sha256").update(bytes).digest("hex") !== profile!.workflowSha256) reject();
    signal.throwIfAborted();
    return { scope, profile: profile! };
  }
  return {
    async preflight(repository: string, baseSha: string, signal: AbortSignal): Promise<boolean> {
      try { await preflight(repository, baseSha, signal); return true; } catch { return false; }
    },
    async verifyCandidate(project: { id: string; repo: string }, raw: Candidate, context: { signal: AbortSignal; maxCostCents: number }) {
      const candidate = { ...raw };
      const unknown = { status: "unknown" as const, costCents: 0, reason: "FACTORY_ACTIONS_UNCONFIRMED" };
      try {
        if (project.repo !== candidate.repository || !project.id || !sha.test(candidate.headSha) || !hash.test(candidate.patchSha256) ||
            candidate.branch !== `factory/${candidate.baseSha}-${candidate.patchSha256}`) reject();
        const { scope, profile } = await preflight(candidate.repository, candidate.baseSha, context.signal);
        await preflight(candidate.repository, candidate.headSha, context.signal);
        const event = profile.trigger ?? "push";
        let dispatched = false;
        for (let attempt = 0; attempt < polls; attempt++) {
          context.signal.throwIfAborted();
          const response = (await options.client.actions.listWorkflowRuns({ ...scope, workflow_id: profile.workflowId,
            head_sha: candidate.headSha, event, per_page: 100 })).data;
          if (response.total_count !== response.workflow_runs.length || response.total_count > 1) reject();
          const run = response.workflow_runs[0];
          if (run) {
            if (!Number.isSafeInteger(run.id) || run.id < 1 || run.run_attempt !== 1 || run.workflow_id !== profile.workflowId ||
                run.head_sha !== candidate.headSha || run.head_branch !== candidate.branch || run.event !== event ||
                ![profile.workflowPath, `${profile.workflowPath}@refs/heads/${candidate.branch}`].includes(run.path) ||
                run.repository.full_name !== candidate.repository || run.repository.private !== false || run.head_repository.full_name !== candidate.repository ||
                run.html_url !== `https://github.com/${candidate.repository}/actions/runs/${run.id}`) reject();
            if (run.status === "completed") {
              if (!["success", "failure"].includes(run.conclusion ?? "")) return unknown;
              const jobs = (await options.client.actions.listJobsForWorkflowRunAttempt({ ...scope, run_id: run.id, attempt_number: 1, per_page: 100 })).data;
              if (jobs.total_count !== 1 || jobs.jobs.length !== 1) reject();
              const job = jobs.jobs[0];
              if (job.run_id !== run.id || job.head_sha !== candidate.headSha || (job.run_attempt !== undefined && job.run_attempt !== 1) || job.name !== profile.jobName ||
                  job.status !== "completed" || job.conclusion !== run.conclusion || !job.labels.includes("ubuntu-24.04") ||
                  job.labels.some(x => !["ubuntu-24.04", "ubuntu-latest", "Linux", "X64"].includes(x))) reject();
              const completed = Date.parse(job.completed_at ?? ""), age = now().getTime() - completed;
              if (!Number.isFinite(age) || age < 0 || age > 86400000) reject();
              await preflight(candidate.repository, candidate.headSha, context.signal);
              if (run.conclusion === "failure") return { status: "failed" as const, costCents: 0, reason: "FACTORY_ACTIONS_CHECK_FAILED" };
              for (const name of [profile.testStep, profile.buildStep, profile.browserStep]) {
                const steps = job.steps.filter(s => s.name === name);
                if (steps.length !== 1 || steps[0].status !== "completed" || steps[0].conclusion !== "success") reject();
              }
              const acceptance = options.readAcceptance ? await options.readAcceptance({runId:run.id,baseSha:candidate.baseSha,headSha:candidate.headSha,signal:context.signal}) : undefined;
              context.signal.throwIfAborted();
              return { status: "passed" as const, costCents: 0, projectId: project.id,
                baseSha: candidate.baseSha, headSha: candidate.headSha, testPassed: true as const, buildPassed: true as const,
                actorId: "github-actions-isolated-runner", artifactIds: [run.html_url,...(acceptance?.artifactIds||[])], regressionScenarioIds:acceptance?.regressionScenarioIds, createdAt: job.completed_at! };
            }
          } else if (event === "workflow_dispatch" && !dispatched) {
            if (!options.client.actions.createWorkflowDispatch || !options.client.git?.getRef) reject();
            const ref = (await options.client.git!.getRef({ ...scope, ref: `heads/${candidate.branch}` })).data;
            if (ref.ref !== `refs/heads/${candidate.branch}` || ref.object.type !== "commit" || ref.object.sha !== candidate.headSha) reject();
            context.signal.throwIfAborted();
            // A lost acknowledgement must remain unknown. Never repeat this write
            // within an execution, including while GitHub's run list catches up.
            // GitHub dispatch is not atomic with the ref read: the trusted controller
            // must own candidate refs and prevent concurrent branch mutation.
            dispatched = true;
            await options.client.actions.createWorkflowDispatch!({ ...scope, workflow_id: profile.workflowId, ref: candidate.branch });
          }
          if (attempt + 1 < polls) await wait(15000, context.signal);
        }
        return unknown;
      } catch { return unknown; }
    },
  };
}
