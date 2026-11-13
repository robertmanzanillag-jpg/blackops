import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createOfficeGitHubLoader, getOfficePrReadClient, OfficeGitHubError, parseOfficePrUrl } from "../server/office-github";

const PR = "https://github.com/owner/repo/pull/12";
const HEAD = "a".repeat(40);
const BASE = "b".repeat(40);
const file = (filename = "server/example.ts") => ({ filename, status: "modified", additions: 1, deletions: 1, patch: "@@ -1,2 +1,2 @@\n before\n-old\n+new" });
const meta = (changedFiles = 1) => ({ number: 12, state: "open", merged: false, head: { sha: HEAD }, base: { sha: BASE }, changed_files: changedFiles, additions: changedFiles, deletions: changedFiles });
function loader(files: unknown[] = [file()], metadata: unknown[] = [meta(), meta()]) {
  let reads = 0;
  const pages: number[] = [];
  return {
    pages,
    connector: createOfficeGitHubLoader({ getClient: async () => ({ pulls: {
      get: async () => ({ data: metadata[Math.min(reads++, metadata.length - 1)] }),
      listFiles: async (input) => { pages.push(input.page); return { data: files.slice((input.page - 1) * 100, input.page * 100) }; },
    } }) }),
  };
}
const rejectsCode = (code: string) => (error: unknown) => error instanceof OfficeGitHubError && error.code === code;

test("credentialless review worker exposes only anonymous public PR GETs", async () => {
  const calls: Array<{ url: string; method?: string; authorization: string | null }> = [];
  const client = await getOfficePrReadClient({ env: { OFFICE_WORKER_ENABLED: "true", OFFICE_WORKER_REVIEW_ONLY: "true" },
    authenticated: async () => { throw new Error("must not request connector credentials"); },
    publicFetch: (async (url, options) => {
      calls.push({ url: String(url), method: options?.method, authorization: new Headers(options?.headers).get("authorization") });
      return new Response(JSON.stringify(String(url).includes("/files") ? [file()] : meta()), { headers: { "content-type": "application/json" } });
    }) as typeof fetch,
  });
  assert.deepEqual(Object.keys(client), ["pulls"]);
  assert.deepEqual(Object.keys(client.pulls).sort(), ["get", "listFiles"]);
  const packet = await createOfficeGitHubLoader({ getClient: async () => client }).loadOfficePullRequest(PR);
  assert.equal(packet.headSha, HEAD);
  assert.equal(calls.length, 3);
  assert.ok(calls.every(call => call.url.startsWith("https://api.github.com/repos/owner/repo/pulls/12") && call.method === "GET" && call.authorization === null));
});

test("private repository denial stays blocked without credential escalation or anonymous retry", async () => {
  let calls = 0;
  const client = await getOfficePrReadClient({ env: { OFFICE_WORKER_ENABLED: "true", OFFICE_WORKER_REVIEW_ONLY: "true" },
    authenticated: async () => { throw new Error("no connector lookup permitted"); },
    publicFetch: (async () => { calls++; return new Response('{"message":"Not Found"}', { status:404, headers:{ "content-type":"application/json" } }); }) as typeof fetch,
  });
  await assert.rejects(createOfficeGitHubLoader({ getClient: async () => client }).loadOfficePullRequest(PR), rejectsCode("GITHUB_UNAVAILABLE"));
  assert.equal(calls,1);
});

test("configured tokens, Replit identity, and nonworker callers retain authenticated path", async () => {
  for (const patch of [{ GITHUB_TOKEN:"configured" }, { GH_TOKEN:"configured" }, { REPL_IDENTITY:"configured" }, { WEB_REPL_RENEWAL:"configured" }, { OFFICE_WORKER_REVIEW_ONLY:"false" }, { OFFICE_WORKER_ENABLED:"false" }]) {
    let authenticated = 0;
    const expected = { pulls: { get: async () => ({data:meta()}), listFiles: async () => ({data:[]}) } };
    const actual = await getOfficePrReadClient({ env: { OFFICE_WORKER_ENABLED:"true", OFFICE_WORKER_REVIEW_ONLY:"true", ...patch }, authenticated: async () => { authenticated++; return expected; }, publicFetch: (async () => { throw new Error("no anonymous fallback"); }) as typeof fetch });
    assert.equal(actual,expected); assert.equal(authenticated,1);
  }
});

test("only canonical HTTPS github.com PR URLs are accepted", () => {
  assert.deepEqual(parseOfficePrUrl(PR), { prUrl: PR, owner: "owner", repo: "repo", repoFullName: "owner/repo", pullNumber: 12 });
  for (const url of ["http://github.com/owner/repo/pull/12", "https://www.github.com/owner/repo/pull/12", "https://github.com:443/owner/repo/pull/12", "https://user@github.com/owner/repo/pull/12", `${PR}?x=1`, `${PR}#x`, `${PR}/files`, `${PR}/`, "https://github.com/owner/repo/pull/01", "https://github.com/owner/repo/pull/1000001", "https://github.com/owner/../pull/12", "https://github.com/owner/%2e%2e/pull/12", ` ${PR}`, "https://github.com.evil.example/owner/repo/pull/12"]) {
    assert.throws(() => parseOfficePrUrl(url), rejectsCode("INVALID_PR_URL"));
  }
});

test("packet contains exact complete patch and SHA256 of the exact review input", async () => {
  const result = await loader().connector.loadOfficePullRequest(PR);
  assert.equal(result.prUrl, PR);
  assert.equal(result.headSha, HEAD);
  assert.equal(result.diffSha256, createHash("sha256").update(result.diff).digest("hex"));
  const packet = JSON.parse(result.diff);
  assert.equal(packet.baseSha, BASE);
  assert.deepEqual(packet.files, [{ path: "server/example.ts", status: "modified", additions: 1, deletions: 1, patch: file().patch }]);
});

test("pagination verifies the end even for exactly one hundred files", async () => {
  const setup = loader(Array.from({ length: 100 }, (_, n) => file(`a${n}.ts`)), [meta(100), meta(100)]);
  assert.equal(JSON.parse((await setup.connector.loadOfficePullRequest(PR)).diff).files.length, 100);
  assert.deepEqual(setup.pages, [1, 2]);
});

test("sensitive changed or previous paths block the entire review", async () => {
  for (const path of [".env", ".env.staging", "secrets/readme.md", "credentials/config.json", ".git/config", "node_modules/pkg/index.js", ".ssh/config", "private.pem", "CEO_ASSISTANT_ENV", "../escape.ts", "server//foo.ts", "server\\foo.ts"]) {
    await assert.rejects(loader([file(path)]).connector.loadOfficePullRequest(PR), rejectsCode("SENSITIVE_PATH"));
  }
  await assert.rejects(loader([{ ...file(), status: "renamed", previous_filename: "secrets/private.ts" }]).connector.loadOfficePullRequest(PR), rejectsCode("SENSITIVE_PATH"));
});

test("binary, missing, truncated or count-inconsistent patches block the review", async () => {
  for (const payload of [{ ...file(), patch: undefined }, { ...file(), patch: "Binary files differ" }, { ...file(), patch: "@@ -1,2 +1,2 @@\n before\n-old" }, { ...file(), additions: 2 }, { ...file(), patch: "@@ -1,1 +1,1 @@\n-old\n+new\n+extra" }, { ...file(), status: "renamed" }, { ...file(), patch: "@@ -1 +1 @@\n-old\n+new\n..." }]) {
    await assert.rejects(loader([payload]).connector.loadOfficePullRequest(PR), error => error instanceof OfficeGitHubError);
  }
});

test("renames require safe previous filename and retain both names", async () => {
  const renamed = { ...file("new.ts"), status: "renamed", previous_filename: "old.ts" };
  const result = await loader([renamed]).connector.loadOfficePullRequest(PR);
  assert.equal(JSON.parse(result.diff).files[0].previousPath, "old.ts");
});

test("closed PR, changed head and changed base cannot supply review evidence", async () => {
  await assert.rejects(loader([file()], [{ ...meta(), state: "closed" }]).connector.loadOfficePullRequest(PR), rejectsCode("PR_NOT_OPEN"));
  await assert.rejects(loader([file()], [{ ...meta(), merged: true }]).connector.loadOfficePullRequest(PR), rejectsCode("PR_NOT_OPEN"));
  for (const update of [{ ...meta(), head: { sha: "c".repeat(40) } }, { ...meta(), base: { sha: "c".repeat(40) } }]) {
    await assert.rejects(loader([file()], [meta(), update]).connector.loadOfficePullRequest(PR), rejectsCode("PR_CHANGED"));
  }
});

test("omitted files, duplicate files and too many files are rejected", async () => {
  await assert.rejects(loader([file()], [meta(2)]).connector.loadOfficePullRequest(PR), rejectsCode("INCOMPLETE_FILES"));
  await assert.rejects(loader([file(), file()], [meta(2)]).connector.loadOfficePullRequest(PR), rejectsCode("INCOMPLETE_FILES"));
  await assert.rejects(loader([], [meta(101)]).connector.loadOfficePullRequest(PR), rejectsCode("PR_TOO_LARGE"));
});

test("complete review packet is bounded and provider errors never leak credentials", async () => {
  const giant = { ...file(), patch: `@@ -1 +1 @@\n-old\n+${"x".repeat(100 * 1024)}` };
  await assert.rejects(loader([giant]).connector.loadOfficePullRequest(PR), rejectsCode("INCOMPLETE_PATCH"));
  const failing = createOfficeGitHubLoader({ getClient: async () => { throw new Error("private-token-should-not-appear"); } });
  await assert.rejects(failing.loadOfficePullRequest(PR), error => error instanceof OfficeGitHubError && !String(error).includes("private-token"));
});

test("obvious credentials in safe code paths block rather than redact the exact diff", async () => {
  for (const key of [`sk-ant-${"a".repeat(25)}`, `sk-proj-${"a".repeat(30)}`, `AIza${"a".repeat(35)}`, `xoxb-${"a".repeat(25)}`]) {
    const secret = { ...file(), patch: `@@ -1 +1 @@\n-old\n+const key = "${key}";` };
    await assert.rejects(loader([secret]).connector.loadOfficePullRequest(PR), rejectsCode("SENSITIVE_PATCH"));
  }
});
