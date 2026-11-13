export const factoryPatchDiagnostics = [
  "PROVIDER_OUTPUT_LIMIT", "PROVIDER_INCOMPLETE", "PROVIDER_RESPONSE_CANCELLED", "PROVIDER_RESPONSE_FAILED", "PROVIDER_NOT_COMPLETED", "PROVIDER_REFUSAL", "PROVIDER_EMPTY_TEXT", "PROVIDER_BLOCKED", "PROVIDER_FAILED",
  "EDIT_PATH_NOT_ALLOWED", "OVERLAPPING_EDITS", "EDIT_LIMIT_EXCEEDED", "MALFORMED_JSON", "INVALID_EDIT_SHAPE", "INVALID_EDIT_TEXT", "NONUNIQUE_EDIT", "NON_TEXT_EDIT", "UNSUPPORTED_SOURCE", "EMPTY_PATCH",
] as const;
export type FactoryPatchDiagnostic = typeof factoryPatchDiagnostics[number];

import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile, readdir, lstat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export interface FactoryBuildInput {
  repository: string; baseSha: string; request: string; reservedCents: number;
  testCommand: string[]; buildCommand: string[];
}
export interface FactoryBuildResult {
  status: 'completed' | 'blocked' | 'failed' | 'unknown'; costCents: number;
  reason?: string; evidence?: { baseSha: string; headSha: string; prUrl: string; patchSha256: string; checks: string[] };
}
export interface IsolatedCommand {
  workspace: string; argv: string[]; readOnlySource?: boolean; signal?: AbortSignal;
}
export interface FactoryBuilderDependencies {
  // Trusted control-plane adapters only. Never load these from project code.
  // Export only tracked source at EXACT sha, without git metadata/credentials.
  exportSource?: (repository: string, sha: string, destination: string) => Promise<{ sha: string }>;
  generatePatch?: (input: FactoryBuildInput, context: { workspace: string; maxCostCents: number; signal?: AbortSignal }) => Promise<{ patch: string; costCents: number; diagnostic?: FactoryPatchDiagnostic }>;
  runIsolated?: (command: IsolatedCommand) => Promise<void>;
  publishPullRequest?: (input: { repository: string; baseSha: string; patch: string; expectedPatchSha256: string }) => Promise<{ headSha: string; prUrl: string; appliedPatchSha256: string }>;
}
const sha = /^[a-f0-9]{40}$/;
const forbidden = /^(?:\.env(?:\..*)?|\.git|credentials|secrets|node_modules)$/i;
async function inspectExport(root: string): Promise<void> {
  for (const name of await readdir(root)) {
    if (forbidden.test(name)) throw new Error('EXPORT_CONTAINS_PROTECTED_FILES');
    const entry = path.join(root, name), stat = await lstat(entry);
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw new Error('EXPORT_CONTAINS_SPECIAL_FILES');
    if (stat.isDirectory()) await inspectExport(entry);
  }
}
export function createFactoryBuilderAdapter(deps: FactoryBuilderDependencies = {}) {
  return async (input: FactoryBuildInput, signal?: AbortSignal): Promise<FactoryBuildResult> => {
    if (!deps.exportSource || !deps.generatePatch || !deps.runIsolated || !deps.publishPullRequest) {
      return { status: 'blocked', costCents: 0, reason: 'Configure trusted source export, budgeted model, isolated runner and GitHub PR adapters.' };
    }
    if (!/^[\w.-]+\/[\w.-]+$/.test(input.repository) || !sha.test(input.baseSha) ||
        !Number.isSafeInteger(input.reservedCents) || input.reservedCents <= 0 || input.reservedCents > 10000 ||
        !input.request.trim() || [input.testCommand, input.buildCommand].some(c => !c.length || c.some(v => typeof v !== 'string' || !v || v.includes('\0')))) {
      return { status: 'blocked', costCents: 0, reason: 'Invalid build input or no verified cost reservation.' };
    }
    const workspace = await mkdtemp(path.join(os.tmpdir(), 'factory-build-'));
    let costCents = 0, startedModel = false, modelSettled = false, publishing = false;
    try {
      signal?.throwIfAborted();
      const exported = await deps.exportSource(input.repository, input.baseSha, workspace);
      if (exported.sha !== input.baseSha) throw new Error('SOURCE_VERSION_MISMATCH');
      await inspectExport(workspace);
      startedModel = true;
      const generated = await deps.generatePatch(input, { workspace, maxCostCents: input.reservedCents, signal });
      if (!Number.isSafeInteger(generated.costCents) || generated.costCents < 0 || generated.costCents > input.reservedCents) {
        return { status: 'unknown', costCents: input.reservedCents, reason: 'Model billing could not be reconciled; retain reservation.' };
      }
      costCents = generated.costCents; modelSettled = true;
      if (!generated.patch.trim() || Buffer.byteLength(generated.patch) > 1024 * 1024) throw new Error('INVALID_PATCH');
      // Reject protected file paths before passing the patch to any executable.
      const paths = [...generated.patch.matchAll(/^(?:\+\+\+|---|rename from|rename to|copy from|copy to) (?:[ab]\/)?([^\t\n]+)/gm)].map(m => m[1]);
      if (/^(?:GIT binary patch|Binary files|diff --git .*")/m.test(generated.patch)) throw new Error('UNSUPPORTED_PATCH');
      if (!paths.length || paths.some(p => p !== '/dev/null' && (p.startsWith('/') || p.includes('\"') || p.includes('\\') || p.split('/').some(segment => segment === '..' || forbidden.test(segment))))) throw new Error('PROTECTED_PATCH');
      await writeFile(path.join(workspace, '.factory.patch'), generated.patch, { flag: 'wx', mode: 0o600 });
      for (const [index, argv] of [['git', 'apply', '--check', '.factory.patch'], ['git', 'apply', '.factory.patch'], input.testCommand, input.buildCommand].entries()) {
        signal?.throwIfAborted();
        await deps.runIsolated({ workspace, argv, readOnlySource: index >= 2, signal });
      }
      // Tests and builds must mount source read-only; write artifacts to /tmp.
      // The exact patch tested is published, never generated build output.
      signal?.throwIfAborted(); publishing = true;
      const patchSha256 = createHash('sha256').update(generated.patch).digest('hex');
      const pr = await deps.publishPullRequest({ repository: input.repository, baseSha: input.baseSha, patch: generated.patch, expectedPatchSha256: patchSha256 });
      if (pr.appliedPatchSha256 !== patchSha256 || !sha.test(pr.headSha) || !pr.prUrl.startsWith(`https://github.com/${input.repository}/pull/`) || !/\/pull\/[1-9][0-9]*$/.test(pr.prUrl)) throw new Error('PR_EVIDENCE_UNVERIFIED');
      return { status: 'completed', costCents, evidence: { baseSha: input.baseSha, headSha: pr.headSha, prUrl: pr.prUrl, patchSha256, checks: ['isolated-tests', 'isolated-build'] } };
    } catch (error) {
      return { status: (error instanceof Error && error.message === 'ISOLATED_CLEANUP_UNCONFIRMED') || publishing || (startedModel && !modelSettled) ? 'unknown' : 'failed', costCents: startedModel && !modelSettled ? input.reservedCents : costCents, reason: 'Build or publication unconfirmed. Reconcile before retry; no automatic duplicate publication.' };
    } finally { await rm(workspace, { recursive: true, force: true }); }
  };
}

/** Trusted image must already contain git, build tools and dependencies. No downloads. */
export function createDockerFactoryRunner(options: { image: string; executable?: string; timeoutMs?: number }) {
  if (!/^[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}$/.test(options.image)) throw new Error('A digest-pinned image is required');
  return async ({ workspace, argv, readOnlySource = true, signal }: IsolatedCommand): Promise<void> => {
    await new Promise<void>((resolve, reject) => {
      const name = `factory-${randomUUID()}`;
      const executable = options.executable || '/usr/local/bin/docker';
      const env = { PATH: '/usr/local/bin:/usr/bin:/bin', LANG: 'C.UTF-8' };
      const args = ['run', '--rm', '--name', name, '--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=128', '--memory=1g', '--cpus=1', `--user=${process.getuid?.() ?? 65534}:${process.getgid?.() ?? 65534}`, '--tmpfs=/tmp:rw,noexec,nosuid,size=128m', '--mount', `type=bind,src=${workspace},dst=/workspace${readOnlySource ? ",readonly" : ""}`, '--workdir=/workspace', options.image, ...argv];
      const child = spawn(executable, args, { env, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
      let bytes = 0, stopped = false;
      let cleanup: Promise<boolean> = Promise.resolve(true);
      const stop = () => {
        if (stopped) return;
        stopped = true;
        cleanup = new Promise<boolean>(done => {
          const removal = spawn(executable, ['rm', '-f', name], { env, shell: false, stdio: 'ignore' });
          const limit = setTimeout(() => { removal.kill('SIGKILL'); done(false); }, 10000);
          removal.on('error', () => { clearTimeout(limit); done(false); });
          removal.on('close', code => { clearTimeout(limit); done(code === 0); });
        });
        child.kill('SIGKILL');
      };
      const timer = setTimeout(stop, Math.min(options.timeoutMs || 120000, 300000));
      const output = (chunk: Buffer) => { bytes += chunk.length; if (bytes > 1024 * 1024) stop(); };
      child.stdout.on('data', output); child.stderr.on('data', output);
      signal?.addEventListener('abort', stop, { once: true }); if (signal?.aborted) stop();
      child.on('error', () => { clearTimeout(timer); signal?.removeEventListener('abort', stop); reject(new Error('ISOLATED_RUNNER_UNAVAILABLE')); });
      child.on('close', code => {
        clearTimeout(timer); signal?.removeEventListener('abort', stop);
        void cleanup.then(removed => {
          if (!removed) reject(new Error('ISOLATED_CLEANUP_UNCONFIRMED'));
          else if (code === 0 && !stopped) resolve();
          else reject(new Error('ISOLATED_CHECK_FAILED'));
        });
      });
    });
  };
}

/** Bridge for the durable pipeline. Configuration and attestations come from the
 * trusted service, never from a model response or an HTTP job payload. */
export function createFactoryPipelineBuilder(options: {
  dependencies: FactoryBuilderDependencies;
  commands: (project: import('./software-factory').FactoryProject) => { test: string[]; build: string[] };
  attest: (project: import('./software-factory').FactoryProject, result: NonNullable<FactoryBuildResult['evidence']>) => Promise<{
    candidate: import('./software-factory').FactoryCandidate; artifactIds: string[]; regressionScenarioIds?: string[];
  }>;
  now?: () => Date;
}): NonNullable<import('./software-factory-pipeline').FactoryPipelineDependencies['build']> {
  const build = createFactoryBuilderAdapter(options.dependencies);
  return async (project, state, context) => {
    const commands = options.commands(project);
    const result = await build({ repository: project.repo, baseSha: state.finding.baseSha,
      request: state.finding.request, reservedCents: context.maxCostCents,
      testCommand: commands.test, buildCommand: commands.build }, context.signal);
    // Preserve settled failures and their actual cost; uncertain outcomes still
    // quarantine the worker and retain its reservation.
    if (result.status !== 'completed') return { status: result.status, costCents: result.costCents, reason: `FACTORY_BUILD_${result.status.toUpperCase()}` };
    if (!result.evidence) throw new Error('FACTORY_BUILD_EVIDENCE_MISSING');
    const attestation = await options.attest(project, result.evidence);
    const candidate = attestation.candidate;
    if (candidate.projectId !== project.id || candidate.baseSha !== result.evidence.baseSha ||
        candidate.headSha !== result.evidence.headSha || candidate.prUrl !== result.evidence.prUrl ||
        !candidate.builderId.trim() || !attestation.artifactIds.length || attestation.artifactIds.some(id => !id.trim())) {
      throw new Error('FACTORY_BUILD_ATTESTATION_UNVERIFIED');
    }
    return { costCents: result.costCents, candidate, tests: {
      projectId: project.id, baseSha: candidate.baseSha, headSha: candidate.headSha,
      kind: 'tests', passed: true, warnings: [], actorId: candidate.builderId,
      createdAt: (options.now || (() => new Date()))().toISOString(), artifactIds: attestation.artifactIds, journeyIds: attestation.regressionScenarioIds,
    } };
  };
}
