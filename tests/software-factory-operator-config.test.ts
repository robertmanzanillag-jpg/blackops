import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildOperatorConfig, factoryHarnessSha256, factoryWorkflowSha256, parseOperatorConfigArgs, selectionListingEstimate, verifyFactoryWorkflowShape, FACTORY_CHECKS_WORKFLOW_PATH } from "../script/software-factory-operator-config";
import { validateAsistenteOperatorConfig } from "../server/software-factory-asistente-operator";
import { createGitHubFactoryChecks } from "../server/software-factory-actions";
import { createOfficeUiArtifactReader } from "../server/software-factory-office-ui-artifact";
import { OFFICE_UI_HARNESS_FILES } from "../script/software-factory-ui-static.mjs";

const repository = "robertmanzanillag-jpg/blackops", root = `https://api.github.com/repos/${repository}`;
const baseSha = "a".repeat(40), headSha = "b".repeat(40), patch = "c".repeat(64), branch = `factory/${baseSha}-${patch}`;
// Synthetic source over the checked-out tree: no git, network or credentials.
const local = (overrides: Record<string, Buffer> = {}, modes: Record<string, string> = {}) => ({
  read: (path: string) => overrides[path] ?? readFileSync(path), mode: (path: string) => modes[path] ?? "100644",
});
const input = { owner: "owner-fixture", baseBranch: "claude/integration-20261111", workflowId: 409, archiveHosts: ["b.blob.core.windows.net", "a.blob.core.windows.net", "b.blob.core.windows.net"], autoAdmitSince: "2026-11-12T00:00:00Z" };

test("generator emits a strict, deterministic operator config with the documented defaults", () => {
  const config = buildOperatorConfig(input, local());
  assert.equal(JSON.stringify(config), JSON.stringify(buildOperatorConfig(input, local())));
  assert.deepEqual(validateAsistenteOperatorConfig(JSON.parse(JSON.stringify(config))), config);
  assert.equal(config.baseBranch, "claude/integration-20261111");
  assert.deepEqual(config.writeRoots, ["server/", "client/", "shared/", "tests/"]);
  assert.equal(config.maxFilesPerOrder, 6); assert.equal(config.maxDraftPullRequestsPerDay, 5);
  assert.deepEqual(config.reservations, { discover: 10, build: 100, simulate: 1, review: 50 });
  assert.equal(config.maxInputTokens, 32000); assert.equal(config.maxOutputTokens, 8192);
  assert.deepEqual(config.orders, []);
  assert.deepEqual(config.archiveHosts, ["a.blob.core.windows.net", "b.blob.core.windows.net"]);
  assert.equal(config.allowGitHubResultsAzureHosts, false);
  assert.deepEqual(config.autoAdmit, { enabled: true, since: "2026-11-12T00:00:00Z", maxPerDay: 5 });
  assert.deepEqual(config.checks, { trigger: "push", workflowId: 409, workflowPath: FACTORY_CHECKS_WORKFLOW_PATH, workflowSha256: factoryWorkflowSha256(readFileSync(FACTORY_CHECKS_WORKFLOW_PATH)),
    jobName: "isolated-checks", testStep: "Isolated tests", buildStep: "Isolated build", browserStep: "Isolated browser recovery tests" });
  assert.deepEqual(config.ui, { workflowId: 409, workflowSha256: config.checks.workflowSha256, harnessSha256: factoryHarnessSha256(OFFICE_UI_HARNESS_FILES.map(p => [p, readFileSync(p)] as const)) });
  assert.equal(buildOperatorConfig({ ...input, autoAdmitSince: undefined }, local()).autoAdmit, undefined);
  // Exactly the noncredential schema fields; nothing secret-shaped is emitted.
  assert.deepEqual(Object.keys(config), ["owner", "projectId", "baseBranch", "writeRoots", "maxFilesPerOrder", "maxDraftPullRequestsPerDay", "checks", "allowGitHubResultsAzureHosts", "archiveHosts", "reservations", "maxOutputTokens", "maxInputTokens", "orders", "ui", "autoAdmit"]);
  assert.ok(!/sig=|https?:|apikey|secret|password|bearer/i.test(JSON.stringify(config)));
});

test("checks workflow digest is accepted by the real actions preflight and a changed workflow is rejected", async () => {
  const config = buildOperatorConfig(input, local());
  const preflight = (workflow: Buffer) => createGitHubFactoryChecks({ repositories: { [repository]: config.checks }, client: {
    repos: { get: async () => ({ data: { full_name: repository, private: false, archived: false, disabled: false } }),
      getContent: async () => ({ data: { type: "file", path: FACTORY_CHECKS_WORKFLOW_PATH, encoding: "base64", size: workflow.length, content: workflow.toString("base64") } }) },
    actions: { listWorkflowRuns: async () => { throw Error("unused"); }, listJobsForWorkflowRunAttempt: async () => { throw Error("unused"); } } } as any })
    .preflight(repository, baseSha, new AbortController().signal);
  assert.equal(await preflight(readFileSync(FACTORY_CHECKS_WORKFLOW_PATH)), true);
  assert.equal(await preflight(Buffer.concat([readFileSync(FACTORY_CHECKS_WORKFLOW_PATH), Buffer.from("\n")])), false);
});

test("workflow and harness digests pass the real office UI reader's trusted-source check", async () => {
  const config = buildOperatorConfig(input, local());
  const read = async (changed?: string) => {
    const seen: string[] = [];
    const reader = createOfficeUiArtifactReader({ ...config.ui, archiveHosts: config.archiveHosts, download: async () => { throw Error("unused"); }, apiRequest: async url => {
      const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200 });
      if (url === root) return json({ full_name: repository, private: false, archived: false, disabled: false });
      if (url === `${root}/actions/runs/42`) return json({ id: 42, workflow_id: config.ui.workflowId, run_attempt: 1, status: "completed", conclusion: "success", event: "push", head_sha: headSha, head_branch: branch,
        repository: { full_name: repository }, head_repository: { full_name: repository }, html_url: `https://github.com/${repository}/actions/runs/42`, path: FACTORY_CHECKS_WORKFLOW_PATH });
      const content = /\/contents\/(.+)\?ref=([a-f0-9]{40})$/.exec(url);
      if (content) { seen.push(content[1]); const bytes = content[1] === changed ? Buffer.concat([readFileSync(content[1]), Buffer.from(" ")]) : readFileSync(content[1]);
        return json({ type: "file", path: content[1], encoding: "base64", content: bytes.toString("base64"), size: bytes.length }); }
      // Past the trusted-source check: stop at job identity with no artifact download.
      return json({ total_count: 0, jobs: [] });
    } });
    await assert.rejects(reader({ projectId: "asistente", baseSha, headSha, runId: 42, signal: new AbortController().signal }), changed ? /UI_TRUSTED_SOURCE_REQUIRED/ : /UI_JOB_IDENTITY/);
    return seen;
  };
  assert.equal((await read()).length, 2 * (OFFICE_UI_HARNESS_FILES.length + 1));
  await read(OFFICE_UI_HARNESS_FILES[3]);
  await read(FACTORY_CHECKS_WORKFLOW_PATH);
});

test("generator fails closed on wrong branch, host, workflow shape, size or file mode", () => {
  assert.throws(() => buildOperatorConfig({ ...input, baseBranch: "claude/other" }, local()));
  assert.throws(() => buildOperatorConfig({ ...input, archiveHosts: ["https://a.blob.core.windows.net/x?sig=1"] }, local()));
  assert.throws(() => buildOperatorConfig({ ...input, archiveHosts: [] }, local()));
  assert.throws(() => buildOperatorConfig({ ...input, autoAdmitSince: "yesterday" }, local()));
  const workflow = readFileSync(FACTORY_CHECKS_WORKFLOW_PATH, "utf8");
  assert.throws(() => verifyFactoryWorkflowShape(workflow.replace("- name: Isolated browser recovery tests", "- name: Browser")), /Isolated browser recovery tests/);
  assert.throws(() => verifyFactoryWorkflowShape(workflow.replace("jobs:\n", "jobs:\n  extra:\n    runs-on: x\n")), /FACTORY_WORKFLOW_JOB_INVALID/);
  assert.throws(() => buildOperatorConfig(input, local({ [OFFICE_UI_HARNESS_FILES[0]]: Buffer.alloc(100001) })), /TOO_LARGE/);
  assert.throws(() => buildOperatorConfig(input, local({}, { [OFFICE_UI_HARNESS_FILES[1]]: "120000" })), /NOT_REGULAR/);
  assert.throws(() => factoryHarnessSha256([]), /FACTORY_HARNESS_FILES_INVALID/);
});

test("argument parsing is strict and selection sizing uses the selector filter", () => {
  const parsed = parseOperatorConfigArgs(["--owner", "o", "--base-branch", "main", "--workflow-id", "7", "--archive-host", "a.blob.core.windows.net", "--archive-host", "b.blob.core.windows.net", "--ref", "HEAD"]);
  assert.deepEqual(parsed, { owner: "o", baseBranch: "main", workflowId: 7, archiveHosts: ["a.blob.core.windows.net", "b.blob.core.windows.net"], ref: "HEAD" });
  for (const argv of [["--owner", "o"], ["--owner", "o", "--base-branch", "main", "--workflow-id", "0", "--archive-host", "a"], ["--token", "x"], ["--owner", "--base-branch"]]) assert.throws(() => parseOperatorConfigArgs(argv));
  const estimate = selectionListingEstimate({ list: () => [
    { mode: "100644", type: "blob", path: "server/a.ts" }, { mode: "100644", type: "blob", path: "tests/a.test.ts" },
    { mode: "100755", type: "blob", path: "server/b.ts" }, { mode: "100644", type: "blob", path: ".github/workflows/x.yml" },
    { mode: "100644", type: "blob", path: "server/kong-ops.ts" }, { mode: "120000", type: "blob", path: "server/link.ts" } ] }, ["server/", "tests/"], 6);
  assert.equal(estimate.selectablePaths, 2); assert.equal(estimate.withinListingLimit, true);
});
