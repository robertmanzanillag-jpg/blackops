import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createFactoryPilotGitHubClient, createFactoryPilotGitHubSourceExporter, FACTORY_PILOT_REPOSITORY } from "../server/software-factory-github-client";
import { createFactoryAsistenteGitHubClient, FACTORY_ASISTENTE_REPOSITORY } from "../server/software-factory-github-client";
const scope = { owner: "robertmanzanillag-jpg", repo: "software-factory-pilot" };
const sha = "a".repeat(40), tree = "b".repeat(40), branch = `factory/${sha}-${"c".repeat(64)}`;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

test("Asistente client confines candidate writes to trusted paths and exact base without granting Kong access", async () => {
 const target={owner:'robertmanzanillag-jpg',repo:'blackops'}, baseBranch='codex/office-integrated-repair-20261106' as const;
 const requests:string[]=[];
 const paths=['server/agent-search.ts','tests/agent-search.test.ts'];
 const client=createFactoryAsistenteGitHubClient({baseBranch,writePaths:paths,request:async(url,init)=>{
  requests.push(url);
  if(url.endsWith('/git/trees'))return json({sha:tree},201);
  if(url.endsWith('/pulls')) { assert.equal(JSON.parse(String(init.body)).base,baseBranch);return json({number:1},201); }
  return json({ref:`refs/heads/${baseBranch}`,object:{sha,type:'commit'}});
 }});
 paths.push('server/kong-operations.ts');
 await client.git.getRef({...target,ref:`heads/${baseBranch}`});
 await client.git.createTree({...target,base_tree:tree,tree:[{path:'server/agent-search.ts',sha,mode:'100644',type:'blob'}]});
 await client.pulls.create({...target,head:branch,base:baseBranch,draft:true,title:'Candidate',body:'Reviewed code only'});
 assert.ok(requests.every(url=>url.startsWith(`https://api.github.com/repos/${FACTORY_ASISTENTE_REPOSITORY}/`)));
 const before=requests.length;
 for(const path of ['server/kong-operations.ts','server/agent-council.ts','.github/workflows/run.yml']) await assert.rejects(client.git.createTree({...target,base_tree:tree,tree:[{path,sha,mode:'100644',type:'blob'}]}));
 await assert.rejects(client.git.getRef({...scope,ref:`heads/${baseBranch}`}));
 await assert.rejects(client.git.createRef({...target,ref:`refs/heads/${baseBranch}`,sha}));
 await assert.rejects(client.pulls.create({...target,head:branch,base:'main',draft:true,title:'Candidate',body:'x'}));
 assert.equal(requests.length,before);
 for(const path of ['server/kong-operations.ts','server/software-factory.ts','server/user-auth.ts','package.json']) assert.throws(()=>createFactoryAsistenteGitHubClient({baseBranch,writePaths:[path],request:async()=>json({})}));
});

test("Asistente GitHub write boundary rejects every code-owned denial, traversal, symlink and over-limit scope", async () => {
 const target={owner:'robertmanzanillag-jpg',repo:'blackops'}, baseBranch='main' as const;
 let writes=0;const request=async(url:string)=>{writes++;return url.endsWith('/git/trees')?json({sha:tree},201):json({});};
 const denied=['.github/workflows/x.yml','.claude/settings.json','.agents/x.md','credentials/a.ts','server/secrets/a.ts','server/migrations/1.ts','drizzle/1.sql','node_modules/x/index.js','dist/index.js','client/dist/a.js',
  '.env','server/.env.production','server/cert.pem','server/private.key','package.json','package-lock.json','pnpm-lock.yaml','.replit','replit.nix','drizzle.config.ts','AGENTS.md','CLAUDE.md','script/replit-sync.ts',
  'server/../package.json','../server/x.ts','/server/x.ts','server//x.ts','docs/x.md','script/x.ts'];
 for(const path of denied) assert.throws(()=>createFactoryAsistenteGitHubClient({baseBranch,writePaths:[path],request}),undefined,path);
 assert.throws(()=>createFactoryAsistenteGitHubClient({baseBranch,writePaths:Array.from({length:9},(_,i)=>`server/f${i}.ts`),request}));
 assert.throws(()=>createFactoryAsistenteGitHubClient({baseBranch,writePaths:['server/a.ts','server/a.ts'],request}));
 const allowed=['server/office/a.ts','client/src/b.tsx','shared/c.ts','tests/d.test.ts'];
 const client=createFactoryAsistenteGitHubClient({baseBranch,writePaths:allowed,request});
 await client.git.createTree({...target,base_tree:tree,tree:allowed.map(path=>({path,sha,mode:'100644',type:'blob'}))});
 assert.equal(writes,1);
 for(const path of denied) await assert.rejects(client.git.createTree({...target,base_tree:tree,tree:[{path,sha,mode:'100644',type:'blob'}]}),undefined,path);
 for(const entry of [{path:'server/office/a.ts',sha,mode:'120000',type:'blob'},{path:'server/office/a.ts',sha,mode:'160000',type:'commit'},{path:'server/office/a.ts',sha,mode:'040000',type:'tree'}] as any[])
  await assert.rejects(client.git.createTree({...target,base_tree:tree,tree:[entry]}));
 // A read-only client (empty selection) can never write.
 const readOnly=createFactoryAsistenteGitHubClient({baseBranch,writePaths:[],request});
 await assert.rejects(readOnly.git.createTree({...target,base_tree:tree,tree:[{path:'server/office/a.ts',sha,mode:'100644',type:'blob'}]}));
 assert.equal(writes,1);
});

test("dispatch accepts validated 2026 run identity and legacy acknowledgement without retry", async () => {
 const valid={workflow_run_id:42293565576,run_url:`https://api.github.com/repos/${FACTORY_PILOT_REPOSITORY}/actions/runs/42293565576`,html_url:`https://github.com/${FACTORY_PILOT_REPOSITORY}/actions/runs/42293565576`};
 const dispatch={...scope,workflow_id:9,ref:branch};
 for(const status of [200,204]){
  let calls=0;const client=createFactoryPilotGitHubClient({allowDispatch:true,request:async()=>{calls++;return status===204?new Response(null,{status}):json(valid);}});
  assert.deepEqual(await client.actions.createWorkflowDispatch!(dispatch),status===204?undefined:valid);assert.equal(calls,1);
 }
 for(const data of [{...valid,workflow_run_id:0},{...valid,workflow_run_id:'42293565576'},{...valid,run_url:valid.run_url+'/jobs'},{...valid,html_url:'https://github.com/owner/other/actions/runs/42293565576'},{}]){
  let calls=0;const client=createFactoryPilotGitHubClient({allowDispatch:true,request:async()=>{calls++;return json(data);}});
  await assert.rejects(client.actions.createWorkflowDispatch!(dispatch));assert.equal(calls,1);
 }
 for(const response of [()=>new Response('broken',{status:200}),()=>json(valid,201)]){
  let calls=0;const client=createFactoryPilotGitHubClient({allowDispatch:true,request:async()=>{calls++;return response();}});
  await assert.rejects(client.actions.createWorkflowDispatch!(dispatch));assert.equal(calls,1);
 }
});
test("constructs exact fixed-origin routes and sanitized request bodies", async () => {
    const calls: {
        url: string;
        init: RequestInit;
    }[] = [];
    const client = createFactoryPilotGitHubClient({ allowDispatch: true, request: async (url, init) => {
            calls.push({ url, init });
            assert.equal(init.redirect, "error");
            assert.ok(init.signal);
            assert.equal(new Headers(init.headers).has("Authorization"), false);
            if (url.includes("/dispatches"))
                return new Response(null, { status: 204 });
            if (url.includes("/git/ref/"))
                return json({ ref: `refs/heads/${branch}`, object: { type: "commit", sha } });
            if (url.includes("/contents/"))
                return json({ path: ".github/workflows/check.yml", type: "file", sha });
            return json({ sha, tree: { sha: tree }, parents: [], message: "base" });
        } });
    await client.git.getCommit({ ...scope, commit_sha: sha });
    await client.git.getRef({ ...scope, ref: `heads/${branch}` });
    await client.repos.getContent({ ...scope, path: ".github/workflows/check.yml", ref: sha });
    await client.actions.createWorkflowDispatch!({ ...scope, workflow_id: 9, ref: branch });
    assert.equal(calls[0].url, `https://api.github.com/repos/${FACTORY_PILOT_REPOSITORY}/git/commits/${sha}`);
    assert.equal(new Headers(calls[2].init.headers).get("Accept"), "application/vnd.github.object+json");
    assert.deepEqual(JSON.parse(String(calls[3].init.body)), { ref: branch });
    assert.ok(calls.every(c => c.url.startsWith(`https://api.github.com/repos/${FACTORY_PILOT_REPOSITORY}/`)));
});
test("rejects foreign repositories, mutable IDs, unsafe paths and default-branch writes before requests", async () => {
    let calls = 0;
    const client = createFactoryPilotGitHubClient({ request: async () => { calls++; return json({}); } });
    assert.equal(client.actions.createWorkflowDispatch, undefined);
    const actions = [() => client.repos.get({ ...scope, repo: "kong" }), () => client.git.getCommit({ ...scope, commit_sha: "main" }), () => client.repos.getContent({ ...scope, path: "../secret", ref: sha }), () => client.git.createRef({ ...scope, ref: "refs/heads/main", sha }), () => client.git.createRef({ ...scope, ref: "refs/tags/main", sha }), () => client.git.createTree({ ...scope, base_tree: sha, tree: [{ path: ".github/workflows/check.yml", sha, mode: "100644", type: "blob" }] }), () => client.git.createTree({ ...scope, base_tree: sha, tree: [{ path: "link", sha, mode: "120000", type: "blob" }] }), () => client.actions.listJobsForWorkflowRunAttempt({ ...scope, run_id: 1, attempt_number: 2, per_page: 100 }), () => client.pulls.create({ ...scope, head: branch, base: "main", draft: false as true, title: "x", body: "x" })];
    for (const action of actions)
        await assert.rejects(action, /INPUT_INVALID/);
    assert.equal(calls, 0);
});
test("HTTP missing-ref status is preserved but credentials and response bodies never escape", async () => {
    let calls = 0;
    const client = createFactoryPilotGitHubClient({ request: async () => { calls++; return new Response("sensitive credentials fixture", { status: 404 }); } });
    await assert.rejects(client.git.getRef({ ...scope, ref: `heads/${branch}` }), error => { assert.equal((error as any).status, 404); assert.equal((error as Error).message, "FACTORY_GITHUB_HTTP_FAILURE"); return true; });
    assert.equal(calls, 1);
    const failed = createFactoryPilotGitHubClient({ request: async () => { throw Error("sensitive transport fixture"); } });
    await assert.rejects(failed.git.getCommit({ ...scope, commit_sha: sha }), error => { assert.equal((error as Error).message, "FACTORY_GITHUB_REQUEST_UNCONFIRMED"); return true; });
});
test("oversized, malformed and mismatched responses fail closed", async () => {
    for (const response of [() => new Response("x".repeat(1025)), () => new Response("not JSON"), () => json({ sha: tree, tree: { sha: tree } })]) {
        const client = createFactoryPilotGitHubClient({ maxResponseBytes: 1024, request: async () => response() });
        await assert.rejects(client.git.getCommit({ ...scope, commit_sha: sha }));
    }
    const client = createFactoryPilotGitHubClient({ request: async () => json({ full_name: FACTORY_PILOT_REPOSITORY, private: true, archived: false, disabled: false, default_branch: "main" }) });
    await assert.rejects(client.repos.get(scope), /PUBLIC_PILOT_REQUIRED/);
});
test("timeout bounds a stalled response or body and never retries a mutation", async () => {
    for (const stalledBody of [false, true]) {
        let calls = 0;
        const client = createFactoryPilotGitHubClient({ allowDispatch: true, timeoutMs: 15, request: async () => { calls++; if (stalledBody)
                return new Response(new ReadableStream({ start() { } }), { status: 201 }); return new Promise<Response>(() => { }); } });
        await assert.rejects(client.git.createRef({ ...scope, ref: `refs/heads/${branch}`, sha }), /UNCONFIRMED/);
        assert.equal(calls, 1);
    }
});
test("publication endpoints only create candidate objects and draft PRs", async () => {
    const calls: {
        url: string;
        body: any;
    }[] = [];
    const client = createFactoryPilotGitHubClient({ request: async (url, init) => { const body = JSON.parse(String(init.body)); calls.push({ url, body }); if (url.endsWith("/git/refs"))
            return json({ ref: body.ref, object: { sha: body.sha, type: "commit" } }, 201); if (url.endsWith("/pulls"))
            return json({ number: 3 }, 201); return json({ sha }, 201); } });
    await client.git.createBlob({ ...scope, content: Buffer.from("hello").toString("base64"), encoding: "base64" });
    await client.git.createTree({ ...scope, base_tree: tree, tree: [{ path: "site/index.html", type: "blob", mode: "100644", sha }] });
    await client.git.createCommit({ ...scope, tree, message: `Factory candidate ${"c".repeat(64)}`, parents: [sha] });
    await client.git.createRef({ ...scope, ref: `refs/heads/${branch}`, sha });
    await client.pulls.create({ ...scope, head: branch, base: "main", draft: true, title: "candidate", body: "review required" });
    assert.ok(calls.every(c => !c.url.endsWith("/merge")));
    assert.equal(calls.at(-1)!.body.draft, true);
    assert.deepEqual(calls[2].body.parents, [sha]);
});
test("public exact-source helper exports verified blobs without commands or protected files", async () => {
    const bytes = Buffer.from("synthetic source\n"), blob = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
    let checkedPublic = false;
    const client = createFactoryPilotGitHubClient({ request: async (url) => {
            if (url.endsWith(FACTORY_PILOT_REPOSITORY)) {
                checkedPublic = true;
                return json({ full_name: FACTORY_PILOT_REPOSITORY, private: false, archived: false, disabled: false, default_branch: "main" });
            }
            assert.equal(checkedPublic, true);
            if (url.includes("/git/commits/"))
                return json({ sha, tree: { sha: tree }, parents: [], message: "base" });
            if (url.includes("/git/trees/"))
                return json({ sha: tree, truncated: false, tree: [{ path: "app.ts", type: "blob", mode: "100644", sha: blob, size: bytes.length }, { path: ".env", type: "blob", mode: "100644", sha: "d".repeat(40) }] });
            assert.ok(url.endsWith(blob));
            return json({ sha: blob, encoding: "base64", size: bytes.length, content: bytes.toString("base64") });
        } });
    const workspace = await mkdtemp(path.join(tmpdir(), "factory-client-test-"));
    try {
        assert.deepEqual(await createFactoryPilotGitHubSourceExporter(client)(FACTORY_PILOT_REPOSITORY, sha, workspace), { sha });
        assert.deepEqual(await readdir(workspace), ["app.ts"]);
        assert.deepEqual(await readFile(path.join(workspace, "app.ts")), bytes);
    }
    finally {
        await rm(workspace, { recursive: true, force: true });
    }
});

test("Asistente client accepts the production integration base, targets it for draft PRs and never writes it", async () => {
 const target={owner:'robertmanzanillag-jpg',repo:'blackops'}, baseBranch='claude/integration-20261111' as const;
 const requests:Array<{url:string;method:string;body?:any}>=[];
 const client=createFactoryAsistenteGitHubClient({baseBranch,writePaths:['server/agent-search.ts','tests/agent-search.test.ts'],request:async(url,init)=>{
  const body=init.body?JSON.parse(String(init.body)):undefined;requests.push({url,method:String(init.method),body});
  if(url.endsWith('/pulls'))return json({number:7},201);
  if(url.endsWith('/git/refs'))return json({ref:body.ref,object:{sha:body.sha,type:'commit'}},201);
  return json({ref:`refs/heads/${baseBranch}`,object:{sha,type:'commit'}});
 }});
 const ref=await client.git.getRef({...target,ref:`heads/${baseBranch}`});
 assert.equal(ref.data.object.sha,sha);
 assert.equal(requests[0].url,`https://api.github.com/repos/${FACTORY_ASISTENTE_REPOSITORY}/git/ref/heads/claude/integration-20261111`);
 await client.git.createRef({...target,ref:`refs/heads/${branch}`,sha});
 await client.pulls.create({...target,head:branch,base:baseBranch,draft:true,title:'Candidate',body:'Reviewed code only'});
 const pull=requests.find(r=>r.url.endsWith('/pulls'))!;
 assert.equal(pull.method,'POST');assert.equal(pull.body.base,baseBranch);assert.equal(pull.body.draft,true);
 const before=requests.length;
 // The configured base branch, the default branch and any non-factory ref are never written.
 for(const ref of [`refs/heads/${baseBranch}`,'refs/heads/main','refs/heads/codex/office-integrated-repair-20261106','refs/heads/claude/other','refs/tags/v1'])
  await assert.rejects(client.git.createRef({...target,ref,sha}),undefined,ref);
 // Draft PRs cannot target another base, even an otherwise allowed one.
 for(const base of ['main','codex/office-integrated-repair-20261106'])
  await assert.rejects(client.pulls.create({...target,head:branch,base,draft:true,title:'Candidate',body:'x'}));
 await assert.rejects(client.pulls.create({...target,head:baseBranch,base:baseBranch,draft:true,title:'Candidate',body:'x'}));
 await assert.rejects(client.pulls.list({...target,head:`robertmanzanillag-jpg:${branch}`,base:'main',state:'all',per_page:100}));
 await assert.rejects(client.git.getRef({...target,ref:'heads/main'}));
 assert.equal(requests.length,before);
 for(const other of ['claude/integration-20261110','claude/integration','master','factory/x'])
  assert.throws(()=>createFactoryAsistenteGitHubClient({baseBranch:other as any,writePaths:[],request:async()=>json({})}),undefined,other);
});
