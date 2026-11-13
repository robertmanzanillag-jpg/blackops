import { createHash } from "node:crypto";
import type { FactoryBuilderDependencies } from "./software-factory-builder";
type Entry = {
    path: string;
    mode: string;
    type: string;
    sha: string;
};
type Commit = {
    sha: string;
    tree: {
        sha: string;
    };
    parents: {
        sha: string;
    }[];
    message: string;
};
type Pull = {
    number: number;
    state: string;
    draft?: boolean;
    html_url: string;
    head: {
        ref: string;
        sha: string;
        repo: {
            full_name: string;
        } | null;
    };
    base: {
        ref: string;
        repo: {
            full_name: string;
        } | null;
    };
};
export interface FactoryGitHubPublisherClient {
    git: {
        getCommit(input: {
            owner: string;
            repo: string;
            commit_sha: string;
        }): Promise<{
            data: Commit;
        }>;
        getTree(input: {
            owner: string;
            repo: string;
            tree_sha: string;
            recursive: "1";
        }): Promise<{
            data: {
                sha: string;
                truncated: boolean;
                tree: Entry[];
            };
        }>;
        getBlob(input: {
            owner: string;
            repo: string;
            file_sha: string;
        }): Promise<{
            data: {
                sha: string;
                encoding: string;
                content: string;
                size: number;
            };
        }>;
        createBlob(input: {
            owner: string;
            repo: string;
            content: string;
            encoding: "base64";
        }): Promise<{
            data: {
                sha: string;
            };
        }>;
        createTree(input: {
            owner: string;
            repo: string;
            base_tree: string;
            tree: Entry[];
        }): Promise<{
            data: {
                sha: string;
            };
        }>;
        createCommit(input: {
            owner: string;
            repo: string;
            message: string;
            tree: string;
            parents: string[];
        }): Promise<{
            data: {
                sha: string;
            };
        }>;
        getRef(input: {
            owner: string;
            repo: string;
            ref: string;
        }): Promise<{
            data: {
                ref: string;
                object: {
                    sha: string;
                };
            };
        }>;
        createRef(input: {
            owner: string;
            repo: string;
            ref: string;
            sha: string;
        }): Promise<{
            data: {
                ref: string;
                object: {
                    sha: string;
                };
            };
        }>;
    };
    pulls: {
        list(input: {
            owner: string;
            repo: string;
            head: string;
            base: string;
            state: "all";
            per_page: 100;
        }): Promise<{
            data: Pull[];
        }>;
        create(input: {
            owner: string;
            repo: string;
            head: string;
            base: string;
            title: string;
            body: string;
            draft: true;
        }): Promise<{
            data: Pull;
        }>;
    };
}
const sha = /^[a-f0-9]{40}$/;
const digest = (kind: string, body: Buffer) => createHash("sha1").update(`${kind} ${body.length}\0`).update(body).digest("hex");
const fail = () => { throw Error("FACTORY_PUBLICATION_UNCONFIRMED"); };
function safePath(value: string) { return typeof value === "string" && value.length > 0 && value.length <= 1000 && !/[\\:\x00-\x20\x7f"]/.test(value) && value.split("/").every(p => p && p !== "." && p !== ".." && !/[. ]$/.test(p) && !/^(?:\.env(?:\..*)?|\.git|\.aws|\.ssh|credentials|secrets|node_modules|id_rsa|id_ed25519|con|prn|aux|nul|com[1-9]|lpt[1-9])(?:$|\.)/i.test(p) && !/\.(?:pem|key|p12|pfx)$/i.test(p)); }
/** Deliberately narrow unified diff: existing UTF-8 files, exact hunks, LF,
 * trailing newline, no rename/create/delete/mode changes or no-newline markers. */
function parsePatch(patch: string) {
    if (!patch.endsWith("\n") || patch.includes("\r") || patch.includes("\0") || Buffer.byteLength(patch) > 1048576)
        fail();
    const lines = patch.slice(0, -1).split("\n"), files: {
        path: string;
        hunks: {
            old: number;
            oldCount: number;
            next: number;
            nextCount: number;
            lines: string[];
        }[];
    }[] = [];
    let i = 0;
    while (i < lines.length) {
        const header = /^diff --git a\/(\S+) b\/(\S+)$/.exec(lines[i++]);
        if (!header || header[1] !== header[2] || !safePath(header[1]) || files.some(f => f.path === header[1]))
            fail();
        if (/^index /.test(lines[i] ?? "")) {
            if (!/^index [a-f0-9]{7,40}\.\.[a-f0-9]{7,40}(?: 100(?:644|755))?$/.test(lines[i++]))
                fail();
        }
        if (lines[i++] !== `--- a/${header![1]}` || lines[i++] !== `+++ b/${header![1]}`)
            fail();
        const file = { path: header![1], hunks: [] as {
                old: number;
                oldCount: number;
                next: number;
                nextCount: number;
                lines: string[];
            }[] };
        while (i < lines.length && !lines[i].startsWith("diff --git ")) {
            const h = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/.exec(lines[i++]);
            if (!h)
                fail();
            const hunk = { old: Number(h![1]), oldCount: Number(h![2] ?? 1), next: Number(h![3]), nextCount: Number(h![4] ?? 1), lines: [] as string[] };
            if (Object.values(hunk).some(x => typeof x === "number" && (!Number.isSafeInteger(x) || x > 1000000)))
                fail();
            let old = 0, next = 0;
            while (old < hunk.oldCount || next < hunk.nextCount) {
                const line = lines[i++];
                if (typeof line !== "string" || !/^[ +\-]/.test(line))
                    fail();
                if (line[0] !== "+")
                    old++;
                if (line[0] !== "-")
                    next++;
                if (old > hunk.oldCount || next > hunk.nextCount)
                    fail();
                hunk.lines.push(line);
            }
            if (!hunk.lines.length)
                fail();
            file.hunks.push(hunk);
        }
        if (!file.hunks.length)
            fail();
        files.push(file);
        if (files.length > 64)
            fail();
    }
    if (!files.length)
        fail();
    return files;
}
function apply(source: Buffer, hunks: ReturnType<typeof parsePatch>[number]["hunks"]) {
    if (source.length >= 3 && source[0] === 0xef && source[1] === 0xbb && source[2] === 0xbf)
        fail();
    const text = new TextDecoder("utf-8", { fatal: true }).decode(source);
    if (text.includes("\0") || text.includes("\r") || !text.endsWith("\n"))
        fail();
    const original = text.slice(0, -1).split("\n"), out: string[] = [];
    let cursor = 0;
    for (const h of hunks) {
        const start = h.oldCount === 0 ? h.old : h.old - 1;
        if (start < cursor || start > original.length)
            fail();
        out.push(...original.slice(cursor, start));
        cursor = start;
        if ((h.nextCount === 0 ? h.next : h.next - 1) !== out.length)
            fail();
        for (const line of h.lines) {
            if (line[0] !== "+") {
                if (original[cursor++] !== line.slice(1))
                    fail();
            }
            if (line[0] !== "-")
                out.push(line.slice(1));
        }
    }
    out.push(...original.slice(cursor));
    const body = Buffer.from(out.length ? out.join("\n") + "\n" : "");
    if (body.length > 1048576)
        fail();
    return body;
}
function treeHash(entries: Entry[]) {
    type Node = {
        children: Map<string, Node | Entry>;
    };
    const root: Node = { children: new Map() };
    for (const e of entries) {
        if (e.type === "tree")
            continue;
        if (!sha.test(e.sha) || ![["blob", "100644"], ["blob", "100755"], ["blob", "120000"], ["commit", "160000"]].some(([t, m]) => e.type === t && e.mode === m))
            fail();
        const segments = e.path.split("/");
        if (segments.some(s => !s || s === "." || s === ".." || s.includes("\0")))
            fail();
        let node = root;
        for (const segment of segments.slice(0, -1)) {
            const found = node.children.get(segment);
            if (found && !('children' in found))
                fail();
            if (!found)
                node.children.set(segment, { children: new Map() });
            node = node.children.get(segment) as Node;
        }
        const name = segments.at(-1)!;
        if (node.children.has(name))
            fail();
        node.children.set(name, e);
    }
    function encode(node: Node): string { return digest("tree", Buffer.concat([...node.children].sort(([an, av], [bn, bv]) => Buffer.compare(Buffer.from(an + ('children' in av ? "/" : "")), Buffer.from(bn + ('children' in bv ? "/" : "")))).map(([name, item]) => Buffer.concat([Buffer.from(`${'children' in item ? "40000" : item.mode} ${name}\0`), Buffer.from('children' in item ? encode(item) : item.sha, "hex")])))); }
    return encode(root);
}
export interface PreparedFactoryCandidate {
    readonly repository: string;
    readonly baseSha: string;
    readonly headSha: string;
    readonly patchSha256: string;
    readonly treeSha: string;
    readonly branch: string;
    readonly changedFiles: readonly string[];
}
export function createGitHubFactoryCandidatePublisher(options: {
    client: FactoryGitHubPublisherClient;
    repositories: Readonly<Record<string, string>>;
}) {
    const allowed = new Map(Object.entries(options.repositories)), client = options.client;
    for (const [repo, branch] of allowed)
        if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !/^[-a-zA-Z0-9_/.]+$/.test(branch) || branch.includes("..") || branch.startsWith("/") || branch.endsWith("/") || branch.startsWith("factory/"))
            throw Error("FACTORY_PUBLISHER_CONFIGURATION_INVALID");
    const finalizers = new WeakMap<PreparedFactoryCandidate, () => ReturnType<NonNullable<FactoryBuilderDependencies["publishPullRequest"]>>>();
    const prepare = async (raw: Parameters<NonNullable<FactoryBuilderDependencies["publishPullRequest"]>>[0]): Promise<PreparedFactoryCandidate> => {
        const input = { ...raw }, base = allowed.get(input.repository);
        if (!base || !sha.test(input.baseSha) || createHash("sha256").update(input.patch).digest("hex") !== input.expectedPatchSha256)
            fail();
        const [owner, repo] = input.repository.split("/"), scope = { owner, repo }, branch = `factory/${input.baseSha}-${input.expectedPatchSha256}`, message = `Factory candidate ${input.expectedPatchSha256}`;
        const files = parsePatch(input.patch);
        const baseRef = await client.git.getRef({ ...scope, ref: `heads/${base}` });
        if (baseRef.data.ref !== `refs/heads/${base}` || baseRef.data.object.sha !== input.baseSha)
            fail();
        const baseCommit = (await client.git.getCommit({ ...scope, commit_sha: input.baseSha })).data;
        if (baseCommit.sha !== input.baseSha || !sha.test(baseCommit.tree.sha))
            fail();
        const tree = (await client.git.getTree({ ...scope, tree_sha: baseCommit.tree.sha, recursive: "1" })).data;
        if (tree.truncated || tree.sha !== baseCommit.tree.sha || tree.tree.length > 20000 || treeHash(tree.tree) !== tree.sha)
            fail();
        const updates: Entry[] = [], bodies: Buffer[] = [];
        for (const file of files) {
            const entry = tree.tree.find(e => e.path === file.path);
            if (!entry || entry.type !== "blob" || !["100644", "100755"].includes(entry.mode))
                fail();
            const blob = (await client.git.getBlob({ ...scope, file_sha: entry!.sha })).data;
            if (blob.sha !== entry!.sha || blob.encoding !== "base64" || blob.size > 1048576)
                fail();
            const encoded = blob.content.replace(/\s/g, ""), body = Buffer.from(encoded, "base64");
            if (body.toString("base64") !== encoded || body.length !== blob.size || digest("blob", body) !== entry!.sha)
                fail();
            const changed = apply(body, file.hunks);
            updates.push({ ...entry!, sha: digest("blob", changed) });
            bodies.push(changed);
        }
        const expectedTree = treeHash(tree.tree.map(e => updates.find(u => u.path === e.path) ?? e));
        if (expectedTree === tree.sha)
            fail();
        const verifyCommit = async (head: string) => {
            if (!sha.test(head))
                fail();
            const c = (await client.git.getCommit({ ...scope, commit_sha: head })).data;
            if (c.sha !== head || c.tree.sha !== expectedTree || c.parents.length !== 1 || c.parents[0].sha !== input.baseSha || c.message !== message)
                fail();
        };
        let head: string | undefined;
        try {
            const ref = (await client.git.getRef({ ...scope, ref: `heads/${branch}` })).data;
            if (ref.ref !== `refs/heads/${branch}`)
                fail();
            head = ref.object.sha;
        }
        catch (error) {
            if ((error as {
                status?: number;
            })?.status !== 404)
                throw error;
        }
        if (head)
            await verifyCommit(head);
        if (!head) {
            for (let i = 0; i < updates.length; i++)
                if ((await client.git.createBlob({ ...scope, content: bodies[i].toString("base64"), encoding: "base64" })).data.sha !== updates[i].sha)
                    fail();
            if ((await client.git.createTree({ ...scope, base_tree: tree.sha, tree: updates })).data.sha !== expectedTree)
                fail();
            head = (await client.git.createCommit({ ...scope, message, tree: expectedTree, parents: [input.baseSha] })).data.sha;
            await verifyCommit(head);
            const ref = (await client.git.createRef({ ...scope, ref: `refs/heads/${branch}`, sha: head })).data;
            if (ref.ref !== `refs/heads/${branch}` || ref.object.sha !== head)
                fail();
        }
        const prepared: PreparedFactoryCandidate = Object.freeze({ repository: input.repository, baseSha: input.baseSha, headSha: head!, patchSha256: input.expectedPatchSha256, treeSha: expectedTree, branch, changedFiles: Object.freeze(files.map(file => file.path)) });
        finalizers.set(prepared, async () => {
            const currentBase = (await client.git.getRef({ ...scope, ref: `heads/${base}` })).data;
            const currentHead = (await client.git.getRef({ ...scope, ref: `heads/${branch}` })).data;
            if (currentBase.ref !== `refs/heads/${base}` || currentBase.object.sha !== input.baseSha || currentHead.ref !== `refs/heads/${branch}` || currentHead.object.sha !== head)
                fail();
            await verifyCommit(head!);
            const validatePull = (pr: Pull) => {
                if (!Number.isSafeInteger(pr.number) || pr.number < 1 || pr.state !== "open" || pr.draft !== true || pr.head.ref !== branch || pr.head.sha !== head || pr.head.repo?.full_name !== input.repository || pr.base.ref !== base || pr.base.repo?.full_name !== input.repository || pr.html_url !== `https://github.com/${input.repository}/pull/${pr.number}`)
                    fail();
                return { headSha: head!, prUrl: pr.html_url, appliedPatchSha256: input.expectedPatchSha256 };
            };
            const existing = (await client.pulls.list({ ...scope, head: `${owner}:${branch}`, base: base!, state: "all", per_page: 100 })).data;
            if (existing.length > 1)
                fail();
            if (existing.length)
                return validatePull(existing[0]);
            return validatePull((await client.pulls.create({ ...scope, head: branch, base: base!, title: "Factory verified candidate", body: `Exact base: ${input.baseSha}\nPatch SHA256: ${input.expectedPatchSha256}\nIndependent review and release gates remain required.`, draft: true })).data);
        });
        return prepared;
    };
    return {
        prepare,
        finalize: async (candidate: PreparedFactoryCandidate) => {
            const finalize = finalizers.get(candidate);
            if (!finalize)
                throw Error("FACTORY_CANDIDATE_NOT_PREPARED");
            return finalize();
        },
    };
}
/** Legacy composition: callers using local checks retain the original contract. */
export function createGitHubFactoryPullRequestPublisher(options: Parameters<typeof createGitHubFactoryCandidatePublisher>[0]): NonNullable<FactoryBuilderDependencies["publishPullRequest"]> {
    const publisher = createGitHubFactoryCandidatePublisher(options);
    return async (input) => publisher.finalize(await publisher.prepare(input));
}
export function validateFactoryPublicationPatch(patch: string): string[] {
    return parsePatch(patch).map(file => file.path);
}
