import type { FactoryActionsClient } from "./software-factory-actions";
import type { FactoryGitHubPublisherClient } from "./software-factory-github-publisher";
import { createGitHubFactorySourceExporter } from "./software-factory-github";
import type { FactoryBuilderDependencies } from "./software-factory-builder";
import { isFactoryWritePathAllowed, isFactoryWritePathDenied, FACTORY_MAX_FILES_PER_ORDER } from "./software-factory-write-scope";
export const FACTORY_PILOT_REPOSITORY = "robertmanzanillag-jpg/software-factory-pilot";
export const FACTORY_ASISTENTE_REPOSITORY = "robertmanzanillag-jpg/blackops";
/** Operator-approved Asistente base branches. Draft PRs target exactly the
 * configured one; the client never writes it (only factory/* refs are created). */
export const FACTORY_ASISTENTE_BASE_BRANCHES = ["main", "codex/office-integrated-repair-20261106", "claude/integration-20261111"] as const;
export type FactoryAsistenteBaseBranch = typeof FACTORY_ASISTENTE_BASE_BRANCHES[number];
const shaPattern = /^[a-f0-9]{40}$/;
const branchPattern = /^factory\/[a-f0-9]{40}-[a-f0-9]{64}$/;
function invalid(): never { throw Error("FACTORY_GITHUB_CLIENT_INPUT_INVALID"); }
function sha(value: unknown): asserts value is string { if (typeof value !== "string" || !shaPattern.test(value))
    invalid(); }
function branch(value: unknown): asserts value is string { if (typeof value !== "string" || !branchPattern.test(value))
    invalid(); }
function id(value: unknown): asserts value is number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)
    invalid(); }
function safePath(value: unknown): asserts value is string {
    if (typeof value !== "string" || !value || value.length > 1000 || /[\\:\x00-\x20\x7f]/.test(value) ||
        value.split("/").some(part => !part || part === "." || part === ".." || /[. ]$/.test(part) || /^(?:\.env(?:\..*)?|\.git|\.ssh|\.aws|credentials|secrets|node_modules|id_rsa|id_ed25519)$/i.test(part) || /\.(?:key|pem|p12|pfx)$/i.test(part)))
        invalid();
}
export type FactoryPilotGitHubClient = FactoryGitHubPublisherClient & FactoryActionsClient;
/** Trusted request must add authentication, never retry, and honor AbortSignal.
 * This client never discovers credentials, logs response bodies, executes code,
 * updates existing refs, merges PRs, or writes the default branch. */
interface ClientOptions {
    request: (url: string, init: RequestInit) => Promise<Response>;
    allowDispatch?: boolean;
    timeoutMs?: number;
    maxResponseBytes?: number;
}
export function createFactoryPilotGitHubClient(options: ClientOptions): FactoryPilotGitHubClient {
    return createScopedClient(FACTORY_PILOT_REPOSITORY, "main", options);
}
/** Explicit trusted installation for Asistente. Never inferred from an order,
 * URL or model response; cannot grant access to other projects. */
export function createFactoryAsistenteGitHubClient(options: ClientOptions & { baseBranch: FactoryAsistenteBaseBranch; writePaths: readonly string[] }): FactoryPilotGitHubClient {
    if (!(FACTORY_ASISTENTE_BASE_BRANCHES as readonly string[]).includes(options.baseBranch)) invalid();
    // An empty list yields a read-only client: every createTree is rejected.
    if (!Array.isArray(options.writePaths) || options.writePaths.length > FACTORY_MAX_FILES_PER_ORDER) invalid();
    const paths = new Set<string>();
    for (const path of options.writePaths) {
        safePath(path);
        if (!isFactoryWritePathAllowed(path) || paths.has(path)) invalid();
        paths.add(path);
    }
    return createScopedClient(FACTORY_ASISTENTE_REPOSITORY, options.baseBranch, options, paths);
}
function createScopedClient(repository: string, baseBranch: string, options: ClientOptions, writePaths?: ReadonlySet<string>): FactoryPilotGitHubClient {
    const [owner, repo] = repository.split("/");
    const root = `https://api.github.com/repos/${repository}`;
    const scope = (value: { owner: string; repo: string }) => { if (value.owner !== owner || value.repo !== repo) invalid(); };
    const request = options.request, dispatchAllowed = options.allowDispatch === true;
    const timeoutMs = options.timeoutMs ?? 15000, maxBytes = options.maxResponseBytes ?? 8 * 1024 * 1024;
    if (typeof request !== "function" || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000 || !Number.isSafeInteger(maxBytes) || maxBytes < 1024 || maxBytes > 16 * 1024 * 1024)
        throw Error("FACTORY_GITHUB_CLIENT_CONFIGURATION_INVALID");
    async function call(route: string, method = "GET", body?: unknown, success: number | readonly number[] = 200, accept = "application/vnd.github+json"): Promise<any> {
        const encoded = body === undefined ? undefined : JSON.stringify(body);
        if (encoded !== undefined && Buffer.byteLength(encoded) > 2 * 1024 * 1024)
            invalid();
        const controller = new AbortController();
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
        let timer: ReturnType<typeof setTimeout>;
        const expired = new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => { controller.abort(); void reader?.cancel().catch(() => { }); reject(Error("FACTORY_GITHUB_REQUEST_UNCONFIRMED")); }, timeoutMs);
        });
        try {
            return await Promise.race([expired, (async () => {
                    let response: Response;
                    try {
                        response = await request(root + route, { method, redirect: "error", signal: controller.signal,
                            headers: { Accept: accept, "Content-Type": "application/json", "X-GitHub-Api-Version": "2026-03-10" },
                            ...(encoded === undefined ? {} : { body: encoded }) });
                    }
                    catch {
                        throw Error("FACTORY_GITHUB_REQUEST_UNCONFIRMED");
                    }
                    if (controller.signal.aborted) {
                        void response.body?.cancel().catch(() => { });
                        throw Error("FACTORY_GITHUB_REQUEST_UNCONFIRMED");
                    }
                    if (!(Array.isArray(success) ? success.includes(response.status) : response.status === success)) {
                        void response.body?.cancel().catch(() => { });
                        throw Object.assign(Error("FACTORY_GITHUB_HTTP_FAILURE"), { status: response.status });
                    }
                    if (response.status === 204) {
                        void response.body?.cancel().catch(() => { });
                        return undefined;
                    }
                    reader = response.body?.getReader();
                    if (!reader)
                        throw Error("FACTORY_GITHUB_RESPONSE_UNCONFIRMED");
                    const chunks: Uint8Array[] = [];
                    let size = 0;
                    try {
                        for (;;) {
                            const chunk = await reader.read();
                            if (chunk.done)
                                break;
                            size += chunk.value.byteLength;
                            if (size > maxBytes)
                                throw Error("size");
                            chunks.push(chunk.value);
                        }
                        if (controller.signal.aborted)
                            throw Error("aborted");
                        const data = JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(Buffer.concat(chunks)));
                        if (data === null || typeof data !== "object")
                            throw Error("shape");
                        return data;
                    }
                    catch {
                        throw Error("FACTORY_GITHUB_RESPONSE_UNCONFIRMED");
                    }
                    finally {
                        void reader.cancel().catch(() => { });
                    }
                })()]);
        }
        finally {
            clearTimeout(timer!);
        }
    }
    const git: FactoryGitHubPublisherClient["git"] & NonNullable<FactoryActionsClient["git"]> = {
        async getCommit(input) { scope(input); sha(input.commit_sha); const data = await call(`/git/commits/${input.commit_sha}`); if (data.sha !== input.commit_sha)
            invalid(); sha(data.tree?.sha); return { data }; },
        async getTree(input) { scope(input); sha(input.tree_sha); if (input.recursive !== "1")
            invalid(); const data = await call(`/git/trees/${input.tree_sha}?recursive=1`); if (data.sha !== input.tree_sha || !Array.isArray(data.tree) || typeof data.truncated !== "boolean")
            invalid(); return { data }; },
        async getBlob(input) { scope(input); sha(input.file_sha); const data = await call(`/git/blobs/${input.file_sha}`); if (data.sha !== input.file_sha)
            invalid(); return { data }; },
        async createBlob(input) { scope(input); if (input.encoding !== "base64" || typeof input.content !== "string" || Buffer.byteLength(input.content) > 1400000 || Buffer.from(input.content, "base64").toString("base64") !== input.content)
            invalid(); const data = await call("/git/blobs", "POST", { content: input.content, encoding: "base64" }, 201); sha(data.sha); return { data }; },
        async createTree(input) {
            scope(input);
            sha(input.base_tree);
            if (!Array.isArray(input.tree) || !input.tree.length || input.tree.length > 64)
                invalid();
            const paths = new Set<string>();
            const tree = input.tree.map(e => { safePath(e.path); sha(e.sha); if ((writePaths && (!writePaths.has(e.path) || !isFactoryWritePathAllowed(e.path))) || (repository === FACTORY_ASISTENTE_REPOSITORY && (!writePaths || isFactoryWritePathDenied(e.path))) || e.path.split("/")[0].toLowerCase() === ".github" || paths.has(e.path) || e.type !== "blob" || !["100644", "100755"].includes(e.mode))
                invalid(); paths.add(e.path); return { path: e.path, sha: e.sha, type: e.type, mode: e.mode }; });
            const data = await call("/git/trees", "POST", { base_tree: input.base_tree, tree }, 201);
            sha(data.sha);
            return { data };
        },
        async createCommit(input) { scope(input); sha(input.tree); if (input.parents.length !== 1 || !/^Factory candidate [a-f0-9]{64}$/.test(input.message))
            invalid(); sha(input.parents[0]); const data = await call("/git/commits", "POST", { tree: input.tree, parents: [...input.parents], message: input.message }, 201); sha(data.sha); return { data }; },
        async getRef(input) { scope(input); if (input.ref !== `heads/${baseBranch}`) {
            if (!input.ref.startsWith("heads/"))
                invalid();
            branch(input.ref.slice(6));
        } const data = await call(`/git/ref/${input.ref.split("/").map(encodeURIComponent).join("/")}`); if (data.ref !== `refs/${input.ref}` || data.object?.type !== "commit")
            invalid(); sha(data.object.sha); return { data }; },
        async createRef(input) { scope(input); if (!input.ref.startsWith("refs/heads/"))
            invalid(); branch(input.ref.slice(11)); sha(input.sha); const data = await call("/git/refs", "POST", { ref: input.ref, sha: input.sha }, 201); if (data.ref !== input.ref || data.object?.sha !== input.sha || data.object?.type !== "commit")
            invalid(); return { data }; },
    };
    return { git, repos: {
            async get(input) { scope(input); const data = await call(""); if (data.full_name !== repository || data.private !== false || data.archived !== false || data.disabled !== false || data.default_branch !== "main")
                throw Error("FACTORY_GITHUB_PUBLIC_PILOT_REQUIRED"); return { data }; },
            async getContent(input) { scope(input); sha(input.ref); safePath(input.path); const data = await call(`/contents/${input.path.split("/").map(encodeURIComponent).join("/")}?ref=${input.ref}`, "GET", undefined, 200, "application/vnd.github.object+json"); if (data.path !== input.path || data.type !== "file")
                invalid(); sha(data.sha); return { data }; },
        }, actions: {
            async listWorkflowRuns(input) { scope(input); id(input.workflow_id); sha(input.head_sha); if (!["push", "workflow_dispatch"].includes(input.event) || input.per_page !== 100)
                invalid(); const data = await call(`/actions/workflows/${input.workflow_id}/runs?head_sha=${input.head_sha}&event=${input.event}&per_page=100`); if (!Number.isSafeInteger(data.total_count) || data.total_count < 0 || !Array.isArray(data.workflow_runs))
                invalid(); return { data }; },
            async listJobsForWorkflowRunAttempt(input) { scope(input); id(input.run_id); if (input.attempt_number !== 1 || input.per_page !== 100)
                invalid(); const data = await call(`/actions/runs/${input.run_id}/attempts/1/jobs?per_page=100`); if (!Number.isSafeInteger(data.total_count) || data.total_count < 0 || !Array.isArray(data.jobs))
                invalid(); return { data }; },
            ...(dispatchAllowed ? { async createWorkflowDispatch(input: {
                    owner: string;
                    repo: string;
                    workflow_id: number;
                    ref: string;
                }) {
                    scope(input); id(input.workflow_id); branch(input.ref);
                    const data = await call(`/actions/workflows/${input.workflow_id}/dispatches`, "POST", { ref: input.ref }, [200, 204]);
                    if (data === undefined) return; // Legacy no-content acknowledgement; run verification remains mandatory.
                    id(data.workflow_run_id);
                    if (data.run_url !== `${root}/actions/runs/${data.workflow_run_id}` || data.html_url !== `https://github.com/${repository}/actions/runs/${data.workflow_run_id}`) throw Error("FACTORY_GITHUB_DISPATCH_UNCONFIRMED");
                    return data;
                } } : {}),
        }, pulls: {
            async list(input) { scope(input); if (input.base !== baseBranch || input.state !== "all" || input.per_page !== 100 || !input.head.startsWith(`${owner}:`))
                invalid(); branch(input.head.slice(owner.length + 1)); const data = await call(`/pulls?head=${encodeURIComponent(input.head)}&base=${encodeURIComponent(baseBranch)}&state=all&per_page=100`); if (!Array.isArray(data) || data.length > 100)
                invalid(); return { data }; },
            async create(input) { scope(input); branch(input.head); if (input.base !== baseBranch || input.draft !== true || typeof input.title !== "string" || input.title.length > 200 || typeof input.body !== "string" || input.body.length > 10000)
                invalid(); const data = await call("/pulls", "POST", { head: input.head, base: baseBranch, draft: true, title: input.title, body: input.body }, 201); id(data.number); return { data }; },
        } };
}
/** Reuses the verified blob exporter; no checkout credentials or commands. */
export function createFactoryPilotGitHubSourceExporter(client: FactoryPilotGitHubClient): NonNullable<FactoryBuilderDependencies["exportSource"]> {
    return createScopedExporter(client, FACTORY_PILOT_REPOSITORY);
}
export function createFactoryAsistenteGitHubSourceExporter(client: FactoryPilotGitHubClient, options: {sourcePaths:readonly string[];signal:AbortSignal}): NonNullable<FactoryBuilderDependencies["exportSource"]> {
    if(!options||!options.signal||!Array.isArray(options.sourcePaths)||!options.sourcePaths.length)throw Error("FACTORY_ASISTENTE_SOURCE_REQUIRED");
    if(options.sourcePaths.length>FACTORY_MAX_FILES_PER_ORDER||new Set(options.sourcePaths).size!==options.sourcePaths.length||options.sourcePaths.some(p=>!isFactoryWritePathAllowed(p)))throw Error("FACTORY_ASISTENTE_SOURCE_PATHS_INVALID");
    return createScopedExporter(client, FACTORY_ASISTENTE_REPOSITORY, options);
}
function createScopedExporter(client: FactoryPilotGitHubClient, allowedRepository: string, options?: {sourcePaths:readonly string[];signal:AbortSignal}): NonNullable<FactoryBuilderDependencies["exportSource"]> {
    const [owner, repo] = allowedRepository.split("/");
    const exporter = createGitHubFactorySourceExporter({ ...(options?{sourcePaths:options.sourcePaths,signal:options.signal,maxFileBytes:100000,maxTotalBytes:200000}:{}), repositories: [allowedRepository], client: { rest: { git: {
                    getCommit: client.git.getCommit, getBlob: client.git.getBlob,
                    getTree: input => { if (input.recursive !== "1")
                        invalid(); return client.git.getTree({ ...input, recursive: "1" }); },
                } } } });
    return async (repository, revision, destination) => {
        if (repository !== allowedRepository)
            invalid();
        sha(revision);
        options?.signal.throwIfAborted();
        await client.repos.get({ owner, repo });
        options?.signal.throwIfAborted();
        return exporter(repository, revision, destination);
    };
}
