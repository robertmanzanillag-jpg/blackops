import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createGitHubFactoryPullRequestPublisher, createGitHubFactoryCandidatePublisher, type FactoryGitHubPublisherClient } from "../server/software-factory-github-publisher";
const gitHash = (type: string, b: Buffer) => createHash("sha1").update(`${type} ${b.length}\0`).update(b).digest("hex");
const blob = (s: string) => gitHash("blob", Buffer.from(s));
const tree = (s: string) => gitHash("tree", Buffer.concat([Buffer.from("100644 app.ts\0"), Buffer.from(blob(s), "hex")]));
const before = "old\n", after = "new\n", base = "a".repeat(40), head = "b".repeat(40);
const patch = "diff --git a/app.ts b/app.ts\n--- a/app.ts\n+++ b/app.ts\n@@ -1 +1 @@\n-old\n+new\n";
function fixture(source = before) {
    const hash = createHash("sha256").update(patch).digest("hex"), branch = `factory/${base}-${hash}`;
    let exists = false, prExists = false;
    const writes: string[] = [];
    const pr = () => ({ number: 1, state: "open", draft: true, html_url: "https://github.com/owner/app/pull/1", head: { ref: branch, sha: head, repo: { full_name: "owner/app" } }, base: { ref: "main", repo: { full_name: "owner/app" } } });
    const client: FactoryGitHubPublisherClient = { git: {
            getRef: async ({ ref }) => {
                if (ref === "heads/main")
                    return { data: { ref: "refs/heads/main", object: { sha: base } } };
                if (!exists)
                    throw Object.assign(Error("missing"), { status: 404 });
                return { data: { ref: `refs/heads/${branch}`, object: { sha: head } } };
            },
            getCommit: async ({ commit_sha }) => ({ data: { sha: commit_sha, tree: { sha: commit_sha === base ? tree(source) : tree(after) }, parents: commit_sha === base ? [] : [{ sha: base }], message: commit_sha === base ? "base" : `Factory candidate ${hash}` } }),
            getTree: async () => ({ data: { sha: tree(source), truncated: false, tree: [{ path: "app.ts", mode: "100644", type: "blob", sha: blob(source) }] } }),
            getBlob: async () => ({ data: { sha: blob(source), encoding: "base64", content: Buffer.from(source).toString("base64"), size: Buffer.byteLength(source) } }),
            createBlob: async ({ content }) => { writes.push("blob"); return { data: { sha: gitHash("blob", Buffer.from(content, "base64")) } }; },
            createTree: async ({ tree: entries }) => { writes.push("tree"); assert.equal(entries[0].sha, blob(after)); return { data: { sha: tree(after) } }; },
            createCommit: async (args) => { writes.push("commit"); assert.deepEqual(args.parents, [base]); return { data: { sha: head } }; },
            createRef: async (args) => { writes.push("ref"); assert.equal(args.ref, `refs/heads/${branch}`); exists = true; return { data: { ref: args.ref, object: { sha: args.sha } } }; },
        }, pulls: { list: async () => ({ data: prExists ? [pr()] : [] }), create: async (args) => { writes.push("pr"); assert.equal(args.draft, true); prExists = true; return { data: pr() }; } } };
    const input = { repository: "owner/app", baseSha: base, patch, expectedPatchSha256: hash };
    return { client, input, writes, setExisting: () => { exists = true; }, publish: () => createGitHubFactoryPullRequestPublisher({ client, repositories: { "owner/app": "main" } })(input) };
}
test("publishes exact modified tree on deterministic branch and reuses existing draft PR", async () => {
    const f = fixture();
    const result = await f.publish();
    assert.deepEqual(result, { headSha: head, prUrl: "https://github.com/owner/app/pull/1", appliedPatchSha256: f.input.expectedPatchSha256 });
    assert.deepEqual(f.writes, ["blob", "tree", "commit", "ref", "pr"]);
    await f.publish();
    assert.equal(f.writes.length, 5);
});
test("wrong patch digest, source identity, base revision and hunk context cannot mutate GitHub", async () => {
    for (const change of ["digest", "blob", "base", "context", "protected", "mode", "binary"]) {
        const f = fixture();
        if (change === "digest")
            f.input.expectedPatchSha256 = "0".repeat(64);
        if (change === "blob")
            f.client.git.getBlob = async () => ({ data: { sha: blob(before), encoding: "base64", content: Buffer.from("wrong\n").toString("base64"), size: 6 } });
        if (change === "base")
            f.client.git.getRef = async () => ({ data: { ref: "refs/heads/main", object: { sha: head } } });
        if (change === "context")
            f.input.patch = patch.replace("-old", "-wrong");
        if (change === "protected")
            f.input.patch = patch.replaceAll("app.ts", ".env");
        if (change === "mode")
            f.input.patch = patch.replace("--- a/app.ts", "old mode 100644\nnew mode 100755\n--- a/app.ts");
        if (change === "binary")
            f.input.patch = "GIT binary patch\n";
        if (change !== "digest")
            f.input.expectedPatchSha256 = createHash("sha256").update(f.input.patch).digest("hex");
        await assert.rejects(f.publish());
        assert.deepEqual(f.writes, []);
    }
});
test("existing branch must match exact tree parent and patch identity", async () => {
    for (const mismatch of ["tree", "parent", "message", "missing"]) {
        const f = fixture();
        f.setExisting();
        const original = f.client.git.getCommit;
        f.client.git.getCommit = async (args) => {
            const r = await original(args);
            if (args.commit_sha === head) {
                if (mismatch === "missing")
                    throw Object.assign(Error("missing"), { status: 404 });
                if (mismatch === "tree")
                    r.data.tree.sha = tree(before);
                if (mismatch === "parent")
                    r.data.parents = [];
                if (mismatch === "message")
                    r.data.message = "other";
            }
            return r;
        };
        await assert.rejects(f.publish());
        assert.deepEqual(f.writes, []);
    }
});
test("lost PR acknowledgment reconciles on next invocation without duplicate publication", async () => {
    const f = fixture(), original = f.client.pulls.create;
    f.client.pulls.create = async (args) => { await original(args); throw Error("lost response"); };
    await assert.rejects(f.publish(), /lost response/);
    const writes = f.writes.length;
    await f.publish();
    assert.equal(f.writes.length, writes);
});
test("unexpected tree response or non-draft PR never reports success", async () => {
    const f = fixture();
    f.client.git.createTree = async () => ({ data: { sha: tree(before) } });
    await assert.rejects(f.publish());
    assert.deepEqual(f.writes, ["blob"]);
    const g = fixture(), original = g.client.pulls.create;
    g.client.pulls.create = async (args) => { const r = await original(args); r.data.draft = false; return r; };
    await assert.rejects(g.publish());
});
test("removing all lines produces an empty blob rather than a spurious newline", async () => {
    const f = fixture();
    f.input.patch = patch.replace("@@ -1 +1 @@\n-old\n+new\n", "@@ -1 +0,0 @@\n-old\n");
    f.input.expectedPatchSha256 = createHash("sha256").update(f.input.patch).digest("hex");
    let checked = false;
    f.client.git.createBlob = async (args) => { assert.equal(args.content, ""); checked = true; throw Error("checked empty blob"); };
    await assert.rejects(f.publish(), /checked empty blob/);
    assert.equal(checked, true);
});
test("UTF-8 BOM source is rejected before any mutation rather than silently stripping bytes", async () => {
    const f = fixture("\ufeffold\n");
    await assert.rejects(f.publish());
    assert.deepEqual(f.writes, []);
});
test("two-phase preparation creates no PR and finalization rejects altered branch or forged candidate", async () => {
    const f = fixture(), publisher = createGitHubFactoryCandidatePublisher({ client: f.client, repositories: { "owner/app": "main" } });
    const candidate = await publisher.prepare(f.input);
    assert.deepEqual(f.writes, ["blob", "tree", "commit", "ref"]);
    assert.equal(candidate.headSha, head);
    await assert.rejects(publisher.finalize({ ...candidate }), /NOT_PREPARED/);
    const original = f.client.git.getRef;
    f.client.git.getRef = async (args) => args.ref === "heads/main" ? original(args) : { data: { ref: `refs/${args.ref}`, object: { sha: "c".repeat(40) } } };
    await assert.rejects(publisher.finalize(candidate));
    assert.equal(f.writes.includes("pr"), false);
    f.client.git.getRef = original;
    await publisher.finalize(candidate);
    assert.equal(f.writes.at(-1), "pr");
});
