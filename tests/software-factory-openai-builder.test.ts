import test from "node:test";
import { validateFactoryPublicationPatch } from "../server/software-factory-github-publisher";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createOpenAiFactoryPatchGenerator } from "../server/software-factory-openai-builder";

const input = { repository: "owner/app", baseSha: "a".repeat(40), request: "Fix the synthetic bug", reservedCents: 10, testCommand: ["test"], buildCommand: ["build"] };
test("sends only operator-selected source and preserves exact patch and usage", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "factory-openai-test-"));
  try {
    await writeFile(path.join(workspace, "app.ts"), "export const value=1;");
    await writeFile(path.join(workspace, "unselected.txt"), "DO_NOT_SEND");
    const sourcePaths = { "owner/app": ["app.ts"] };
    const patch = "diff --git a/app.ts b/app.ts\n";
    const generate = createOpenAiFactoryPatchGenerator({ sourcePaths, maxOutputTokens: 100, generateText: async request => {
      const context = JSON.parse(request.text);
      assert.deepEqual(context.files, [{ path: "app.ts", text: "export const value=1;" }]);
      assert.equal(context.baseSha, input.baseSha);
      assert.equal(request.maxCostCents, 10);
      return { status: "completed", text: patch, costCents: 2, inputTokens: 50, outputTokens: 20 };
    } });
    sourcePaths["owner/app"].push("unselected.txt");
    assert.deepEqual(await generate(input, { workspace, maxCostCents: 10 }), { patch, costCents: 2 });
  } finally { await rm(workspace, { recursive: true, force: true }); }
});

test("protected, traversal and oversized source cannot reach the model", async () => {
  let calls = 0;
  const generateText = async () => { calls++; return { status: "blocked" as const, reason: "fixture", costCents: 0 }; };
  for (const file of ["../escape", "/absolute", "C:/absolute", "x/.env.local", "secrets/key", "x\\escape", "./app.ts", ".aws/config", ".ssh/config", "keys/private.pem", "id_ed25519", "x/.env ", "x/aux.ts", "x/control\u0001.ts"]) {
    assert.throws(() => createOpenAiFactoryPatchGenerator({ sourcePaths: { "owner/app": [file] }, maxOutputTokens: 100, generateText }), /ALLOWLIST/);
  }
  const workspace = await mkdtemp(path.join(os.tmpdir(), "factory-openai-test-"));
  try {
    await writeFile(path.join(workspace, "app.ts"), "x".repeat(192001));
    const generate = createOpenAiFactoryPatchGenerator({ sourcePaths: { "owner/app": ["app.ts"] }, maxOutputTokens: 100, generateText });
    await assert.rejects(generate(input, { workspace, maxCostCents: 10 }), /CONTEXT_TOO_LARGE/);
    await assert.rejects(generate({ ...input, repository: "other/app" }, { workspace, maxCostCents: 10 }), /NOT_ALLOWED/);
    assert.equal(calls, 0);
  } finally { await rm(workspace, { recursive: true, force: true }); }
});

test("ambiguous model execution throws; terminal failure retains its cost", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "factory-openai-test-"));
  try {
    await writeFile(path.join(workspace, "app.ts"), "fixture");
    const common = { sourcePaths: { "owner/app": ["app.ts"] }, maxOutputTokens: 100 };
    const unknown = createOpenAiFactoryPatchGenerator({ ...common, generateText: async () => ({ status: "unknown", reason: "timeout", costCents: 0 }) });
    await assert.rejects(unknown(input, { workspace, maxCostCents: 10 }), /UNCONFIRMED/);
    const failed = createOpenAiFactoryPatchGenerator({ ...common, generateText: async () => ({ status: "failed", reason: "refusal", costCents: 3 }) });
    assert.deepEqual(await failed(input, { workspace, maxCostCents: 10 }), { patch: "", costCents: 3, diagnostic: "PROVIDER_FAILED" });
  } finally { await rm(workspace, { recursive: true, force: true }); }
});


test("missing model line delimiter is normalized without repairing invalid diff contents", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "factory-openai-test-"));
  try {
    await writeFile(path.join(workspace, "app.ts"), "old\n");
    const valid = "diff --git a/app.ts b/app.ts\n--- a/app.ts\n+++ b/app.ts\n@@ -1 +1 @@\n-old\n+new  ";
    for (const text of [valid, valid + "\n", valid.replace("@@ -1 +1 @@", "@@ -2 +2 @@")]) {
      const generate = createOpenAiFactoryPatchGenerator({ sourcePaths: { "owner/app": ["app.ts"] }, maxOutputTokens: 100,
        generateText: async () => ({ status: "completed", text, costCents: 2, inputTokens: 10, outputTokens: 10 }) });
      const result = await generate(input, { workspace, maxCostCents: 10 });
      assert.equal(result.patch, text.endsWith("\n") ? text : text + "\n");
      assert.equal(result.costCents, 2);
      assert.deepEqual(validateFactoryPublicationPatch(result.patch), ["app.ts"]);
    }
    for (const text of [valid.replace("@@ -1 +1 @@", "@@ -1,2 +1,2 @@"), "```diff\n" + valid + "\n```", valid.replaceAll("app.ts", "../escape"), valid + "\r", ""]) {
      const generate = createOpenAiFactoryPatchGenerator({ sourcePaths: { "owner/app": ["app.ts"] }, maxOutputTokens: 100,
        generateText: async () => ({ status: "completed", text, costCents: 2, inputTokens: 10, outputTokens: 10 }) });
      const result = await generate(input, { workspace, maxCostCents: 10 });
      assert.equal(result.costCents, 2);
      assert.throws(() => validateFactoryPublicationPatch(result.patch));
    }
  } finally { await rm(workspace, { recursive: true, force: true }); }
});


test("plain text edits construct exact complete hunks and reject ambiguous or structural edits with settled cost", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "factory-text-test-"));
  const source = '<!doctype html>\n<html><body><h1>Old wording.</h1><a href="health.json">Health</a></body></html>\n';
  try {
    await mkdir(path.join(workspace, "site"));
    await writeFile(path.join(workspace, "site/index.html"), source);
    const run = async (text: string) => createOpenAiFactoryPatchGenerator({
      sourcePaths: { "owner/app": ["site/index.html"] }, patchMode: "plainTextEdits", maxOutputTokens: 100,
      generateText: async request => {
        assert.match(request.instructions, /JSON object/);
        return { status: "completed", text, costCents: 1, inputTokens: 10, outputTokens: 10 };
      },
    })(input, { workspace, maxCostCents: 10 });
    const result = await run(JSON.stringify({ before: "Old wording.", after: "Verified wording." }));
    assert.equal(result.costCents, 1);
    assert.deepEqual(validateFactoryPublicationPatch(result.patch), ["site/index.html"]);
    assert.equal(result.patch, 'diff --git a/site/index.html b/site/index.html\n--- a/site/index.html\n+++ b/site/index.html\n@@ -1,2 +1,2 @@\n-<!doctype html>\n-<html><body><h1>Old wording.</h1><a href="health.json">Health</a></body></html>\n+<!doctype html>\n+<html><body><h1>Verified wording.</h1><a href="health.json">Health</a></body></html>\n');
    for (const response of ['not json', '{}', JSON.stringify({ before: 'Old wording.', after: 'New', extra: true }), ...[
      ['health.json', 'other.json'], ['missing', 'New'], ['Old wording.', '<script>'], ['Old wording.', 'https://example.com'],
      ['Old wording.', '&lt;script&gt;'], ['Old wording.', 'New\nline'], ['Old wording.', ''], ['Old wording.', 'x'.repeat(5001)],
    ].map(([before, after]) => JSON.stringify({ before, after }))]) {
      const rejected = await run(response); assert.equal(rejected.patch, ""); assert.equal(rejected.costCents, 1); assert.ok(rejected.diagnostic);
    }
    for (const unsafe of [source.replace('Health</a>', 'Old wording.</a>'), source.replace('<h1>', '<script>'), source.replace('<h1>', '<!--'), source.replace('<h1>Old wording.</h1>', '<h1 title="x > Old wording.">Other</h1>'), source.slice(0, -1), '\uFEFF' + source]) {
      await writeFile(path.join(workspace, "site/index.html"), unsafe);
      const rejected = await run(JSON.stringify({ before: "Old wording.", after: "New wording." })); assert.equal(rejected.patch, ""); assert.equal(rejected.costCents, 1); assert.ok(rejected.diagnostic);
    }
    assert.throws(() => createOpenAiFactoryPatchGenerator({ sourcePaths: { "owner/app": ["app.ts"] }, patchMode: "plainTextEdits", maxOutputTokens: 100, generateText: async () => { throw Error("must not call"); } }), /PLAIN_TEXT_SOURCE_REQUIRED/);
  } finally { await rm(workspace, { recursive: true, force: true }); }
});


test("plain text model context excludes all tags and attributes including quoted delimiters", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "factory-text-context-"));
  try {
    await mkdir(path.join(workspace, "site"));
    const source = '<!doctype html>\n<html lang="ATTRIBUTE_ONLY"><body><h1 title="PRIVATE > attribute">Old wording.</h1><a href="secret-path">Health</a></body></html>\n';
    await writeFile(path.join(workspace, "site/index.html"), source);
    const generate = createOpenAiFactoryPatchGenerator({sourcePaths:{"owner/app":["site/index.html"]},patchMode:"plainTextEdits",maxOutputTokens:100,
      generateText:async request=>{
        const data=JSON.parse(request.text);
        assert.deepEqual(data.files,[{path:"site/index.html",textNodes:["Old wording.","Health"]}]);
        for(const forbidden of ["ATTRIBUTE_ONLY","PRIVATE","secret-path","<h1","<!doctype"]) assert.ok(!request.text.includes(forbidden));
        assert.match(request.instructions,/Example unrelated/);assert.match(request.instructions,/no newline/);
        return {status:"completed",text:JSON.stringify({before:"Old wording.",after:"Clear wording."}),costCents:1,inputTokens:10,outputTokens:10};
      }});
    const result=await generate(input,{workspace,maxCostCents:10});
    assert.deepEqual(validateFactoryPublicationPatch(result.patch),["site/index.html"]);
    assert.ok(result.patch.includes('+<html lang="ATTRIBUTE_ONLY"><body><h1 title="PRIVATE > attribute">Clear wording.</h1><a href="secret-path">Health</a></body></html>'));
    assert.equal(result.costCents,1);
  } finally {await rm(workspace,{recursive:true,force:true});}
});

test("exact source edits use original offsets across files and generate strict deterministic hunks",async()=>{
 const workspace=await mkdtemp(path.join(os.tmpdir(),"factory-exact-edits-"));
 try{
  await writeFile(path.join(workspace,"app.ts"),"const first = 1;\nconst second = 2;\n");await writeFile(path.join(workspace,"test.ts"),"assert.equal(first, 1);\n");
  const edits=[{path:"test.ts",before:"first, 1",after:"second, 1"},{path:"app.ts",before:"second",after:"third"},{path:"app.ts",before:"first",after:"second"}];
  const make=(value:unknown)=>createOpenAiFactoryPatchGenerator({sourcePaths:{"owner/app":["app.ts","test.ts"]},maxOutputTokens:1000,patchMode:"exactSourceEdits",generateText:async request=>{assert.match(request.instructions,/ORIGINAL/);return {status:"completed",text:JSON.stringify(value),costCents:7,inputTokens:20,outputTokens:30};}});
  const result=await make({edits})(input,{workspace,maxCostCents:10});
  assert.equal(result.costCents,7);assert.equal(result.diagnostic,undefined);validateFactoryPublicationPatch(result.patch);
  assert.equal(result.patch,"diff --git a/app.ts b/app.ts\n--- a/app.ts\n+++ b/app.ts\n@@ -1,2 +1,2 @@\n-const first = 1;\n-const second = 2;\n+const second = 1;\n+const third = 2;\ndiff --git a/test.ts b/test.ts\n--- a/test.ts\n+++ b/test.ts\n@@ -1,1 +1,1 @@\n-assert.equal(first, 1);\n+assert.equal(second, 1);\n");
  assert.equal((await make({edits:[...edits].reverse()})(input,{workspace,maxCostCents:10})).patch,result.patch);
 }finally{await rm(workspace,{recursive:true,force:true});}
});

test("invalid exact edits retain known usage and expose only static conversion diagnostics",async()=>{
 const workspace=await mkdtemp(path.join(os.tmpdir(),"factory-exact-reject-"));
 try{await writeFile(path.join(workspace,"app.ts"),"const first = 1;\nconst second = 2;\n");const edit={path:"app.ts",before:"first",after:"third"};
  const cases:Array<[string,string]>=[['{',"MALFORMED_JSON"],[JSON.stringify({edits:[{...edit,extra:true}]}),"INVALID_EDIT_SHAPE"],[JSON.stringify({edits:[{...edit,path:"secrets/value"}]}),"EDIT_PATH_NOT_ALLOWED"],[JSON.stringify({edits:[{...edit,before:"const"}]}),"NONUNIQUE_EDIT"],[JSON.stringify({edits:[{...edit,before:"absent"}]}),"NONUNIQUE_EDIT"],[JSON.stringify({edits:[{...edit,before:"first = 1"},{...edit,before:"= 1"}]}),"OVERLAPPING_EDITS"],[JSON.stringify({edits:[{...edit,after:"x\r\ny"}]}),"INVALID_EDIT_TEXT"],[JSON.stringify({edits:[{...edit,after:"x\u0000y"}]}),"INVALID_EDIT_TEXT"],[JSON.stringify({edits:[{...edit,after:"\ud800"}]}),"INVALID_EDIT_TEXT"],[JSON.stringify({edits:Array(17).fill(edit)}),"EDIT_LIMIT_EXCEEDED"]];
  for(const [text,diagnostic] of cases){const generate=createOpenAiFactoryPatchGenerator({sourcePaths:{"owner/app":["app.ts"]},maxOutputTokens:1000,patchMode:"exactSourceEdits",generateText:async()=>({status:"completed",text,costCents:7,inputTokens:20,outputTokens:30})});assert.deepEqual(await generate(input,{workspace,maxCostCents:10}),{patch:"",costCents:7,diagnostic});}
 }finally{await rm(workspace,{recursive:true,force:true});}
});

test("unsupported exact source is rejected before a paid request",async()=>{
 const workspace=await mkdtemp(path.join(os.tmpdir(),"factory-exact-source-"));let calls=0;
 try{const generate=createOpenAiFactoryPatchGenerator({sourcePaths:{"owner/app":["app.ts"]},maxOutputTokens:100,patchMode:"exactSourceEdits",generateText:async()=>{calls++;throw Error("must not pay");}});
  for(const source of ["no final newline","\ufeffsource\n","source\r\n","\tindent\n"]){await writeFile(path.join(workspace,"app.ts"),source);assert.deepEqual(await generate(input,{workspace,maxCostCents:10}),{patch:"",costCents:0,diagnostic:"UNSUPPORTED_SOURCE"});}assert.equal(calls,0);
 }finally{await rm(workspace,{recursive:true,force:true});}
});

test("immutable 9895bb1 allowed files pass preflight and generated multi-file patch actually applies",async(t)=>{
 const {readFile}=await import("node:fs/promises"),{createHash}=await import("node:crypto"),{spawnSync}=await import("node:child_process");
 const workspace=await mkdtemp(path.join(os.tmpdir(),"factory-immutable-edits-"));
 try{
  const cases=[{path:"server/office-role-work.ts",fixture:"role-work.txt",sha:"920b748073f7f2304074142845f409d5e63e124b",before:"Role audit owner required",after:"Role audit owner is required"},{path:"tests/office-role-work.test.ts",fixture:"role-work-test.txt",sha:"94114a4e3cb401e5a8239f46b1da573ae295d823",before:'owner="owner"',after:'owner="synthetic-owner"'}];
  const originals=new Map<string,string>();for(const file of cases){const bytes=await readFile(new URL(`./fixtures/factory-exact-source/${file.fixture}`,import.meta.url));assert.equal(createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"),file.sha);assert.ok(bytes.at(-1)===10);assert.doesNotMatch(bytes.toString("utf8"),/[\x00-\x09\x0b-\x1f\x7f\uFEFF]/);await mkdir(path.dirname(path.join(workspace,file.path)),{recursive:true});await writeFile(path.join(workspace,file.path),bytes);originals.set(file.path,bytes.toString("utf8"));}
  let calls=0;const generate=createOpenAiFactoryPatchGenerator({sourcePaths:{"owner/app":cases.map(f=>f.path)},patchMode:"exactSourceEdits",maxOutputTokens:1000,generateText:async request=>{calls++;const sent=JSON.parse(request.text);for(const file of sent.files)assert.equal(file.text,originals.get(file.path));return {status:"completed",text:JSON.stringify({edits:cases.map(({path,before,after})=>({path,before,after}))}),costCents:1,inputTokens:100,outputTokens:100};}});
  const result=await generate(input,{workspace,maxCostCents:10});assert.equal(calls,1);assert.equal(result.diagnostic,undefined);validateFactoryPublicationPatch(result.patch);
  const gitProbe=spawnSync("git",["--version"],{encoding:"utf8",timeout:10000,windowsHide:true});
  const gitMissing=(gitProbe.error as NodeJS.ErrnoException|undefined)?.code==="ENOENT";
  if(!gitMissing)assert.equal(gitProbe.status,0,gitProbe.error?.message||gitProbe.stderr);
  await t.test("Git applies the generated patch to exact immutable inputs",{skip:!gitMissing?false:"Isolated Node image does not provide Git; immutable fixture and converter assertions still run"},async()=>{
  for(const args of [["apply","--check","-"],["apply","-"]]){const applied=spawnSync("git",["-c","core.autocrlf=false",...args],{cwd:workspace,input:result.patch,encoding:"utf8",timeout:10000,windowsHide:true});assert.equal(applied.status,0,applied.error?.message||applied.stderr);}
  for(const file of cases)assert.equal(await readFile(path.join(workspace,file.path),"utf8"),originals.get(file.path)!.replace(file.before,file.after));
  });
 }finally{await rm(workspace,{recursive:true,force:true});}
});
