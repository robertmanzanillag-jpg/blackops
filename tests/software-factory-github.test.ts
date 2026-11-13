import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createGitHubFactorySourceExporter, type FactoryGitHubReadClient } from "../server/software-factory-github";
const commitSha="a".repeat(40), treeSha="b".repeat(40);
const blobSha=(content:string)=>createHash("sha1").update(`blob ${Buffer.byteLength(content)}\0`).update(content).digest("hex");
function fixture() {
 const calls:Array<[string,unknown]>=[];
 const content="export const answer = 42;\n", hash=blobSha(content);
 const tree={sha:treeSha,truncated:false,tree:[{path:"src",type:"tree",mode:"040000",sha:"c".repeat(40)}, {path:"src/index.ts",type:"blob",mode:"100644",sha:hash,size:Buffer.byteLength(content)}]};
 const commit={sha:commitSha,tree:{sha:treeSha}};
 const blob={sha:hash,encoding:"base64",content:Buffer.from(content).toString("base64"),size:Buffer.byteLength(content)};
 const client:FactoryGitHubReadClient={rest:{git:{
  getCommit:async input=>{calls.push(["commit",input]);return {data:commit};},
  getTree:async input=>{calls.push(["tree",input]);return {data:tree};},
  getBlob:async input=>{calls.push(["blob",input]);return {data:blob};},
 }}};
 return {calls,tree,commit,blob,client,content,exporter:createGitHubFactorySourceExporter({client,repositories:["owner/app"]})};
}
async function workspace(t:Parameters<Parameters<typeof test>[1]>[0]) {
 const dir=await mkdtemp(path.join(os.tmpdir(),"factory-source-test-"));
 t.after(()=>rm(dir,{recursive:true,force:true}));return dir;
}
test("source export pins commit and tree, verifies blob hash, and writes no Git metadata",async t=>{
 const f=fixture(),dir=await workspace(t);
 assert.deepEqual(await f.exporter("owner/app",commitSha,dir),{sha:commitSha});
 assert.equal(await readFile(path.join(dir,"src/index.ts"),"utf8"),f.content);
 assert.deepEqual(await readdir(dir),["src"]);
 assert.deepEqual(f.calls.map(([kind])=>kind),["commit","tree","blob"]);
 assert.deepEqual(f.calls[0][1],{owner:"owner",repo:"app",commit_sha:commitSha});
 assert.deepEqual(f.calls[1][1],{owner:"owner",repo:"app",tree_sha:treeSha,recursive:"1"});
});
test("repository allowlist, exact revision and empty workspace are enforced before fetching",async t=>{
 const f=fixture(),dir=await workspace(t);
 await assert.rejects(f.exporter("other/app",commitSha,dir),/NOT_ALLOWED/);
 await assert.rejects(f.exporter("owner/app","main",dir),/EXACT_COMMIT/);
 await assert.rejects(f.exporter("../app",commitSha,dir),/REPOSITORY_INVALID/);
 await writeFile(path.join(dir,"existing"),"keep");
 await assert.rejects(f.exporter("owner/app",commitSha,dir),/EMPTY_WORKSPACE/);
 assert.deepEqual(f.calls,[]);assert.equal(await readFile(path.join(dir,"existing"),"utf8"),"keep");
});
test("protected files are excluded without fetching their contents",async t=>{
 const f=fixture(),dir=await workspace(t);
 for(const name of [".env", ".env.production", "private.pem", "id_ed25519"])
  f.tree.tree.push({path:name,type:"blob",mode:"100644",sha:"d".repeat(40),size:999999999});
 f.tree.tree.push({path:"secrets",type:"tree",mode:"040000",sha:"e".repeat(40)});
 f.tree.tree.push({path:"secrets/token.txt",type:"blob",mode:"100644",sha:"d".repeat(40),size:50});
 await f.exporter("owner/app",commitSha,dir);
 assert.equal(f.calls.filter(([kind])=>kind==="blob").length,1);assert.deepEqual(await readdir(dir),["src"]);
});
test("symlinks, submodules, unsafe paths and case collisions fail before blob reads",async t=>{
 const cases=[{path:"link",type:"blob",mode:"120000"},{path:"sub",type:"commit",mode:"160000"},...['../outside','C:/outside','a\\b','NUL.txt','src/index.ts.'].map(path=>({path,type:"blob",mode:"100644"})),{path:"SRC/index.ts",type:"blob",mode:"100644"}];
 for(const entry of cases){const f=fixture(),dir=await workspace(t);f.tree.tree.push({...entry,sha:"d".repeat(40),size:1});await assert.rejects(f.exporter("owner/app",commitSha,dir),/SPECIAL_FILE|TREE_ENTRY|PATH_COLLISION/);assert.equal(f.calls.some(([kind])=>kind==="blob"),false);assert.deepEqual(await readdir(dir),[]);}
});
test("missing parent entries, truncated trees and wrong revisions never export",async t=>{
 for(const mutate of [(f:ReturnType<typeof fixture>)=>{f.tree.truncated=true;},(f:ReturnType<typeof fixture>)=>{f.commit.sha="e".repeat(40);},(f:ReturnType<typeof fixture>)=>{f.tree.sha="f".repeat(40);},(f:ReturnType<typeof fixture>)=>{f.tree.tree.shift();}]) {
  const f=fixture(),dir=await workspace(t);mutate(f);await assert.rejects(f.exporter("owner/app",commitSha,dir),/COMMIT_MISMATCH|TREE_UNVERIFIED|TREE_PARENT/);assert.equal(f.calls.some(([kind])=>kind==="blob"),false);
 }
});
test("blob size, identity, encoding and bytes must agree with the immutable tree",async t=>{
 for(const mutate of [(f:ReturnType<typeof fixture>)=>{f.blob.content=Buffer.from("wrong").toString("base64");},(f:ReturnType<typeof fixture>)=>{f.blob.sha="e".repeat(40);},(f:ReturnType<typeof fixture>)=>{f.blob.encoding="utf-8";},(f:ReturnType<typeof fixture>)=>{f.blob.size++;},(f:ReturnType<typeof fixture>)=>{f.blob.content+="!";}]){
 const f=fixture(),dir=await workspace(t);mutate(f);await assert.rejects(f.exporter("owner/app",commitSha,dir),/BLOB_UNVERIFIED|BLOB_MISMATCH/);assert.deepEqual(await readdir(dir),[]);
 }
});
test("export bounds are checked before downloading blobs",async t=>{
 const f=fixture(),dir=await workspace(t);
 const small=createGitHubFactorySourceExporter({client:f.client,repositories:["owner/app"],maxFileBytes:1});
 await assert.rejects(small("owner/app",commitSha,dir),/FILE_LIMIT/);assert.equal(f.calls.some(([kind])=>kind==="blob"),false);
 assert.throws(()=>createGitHubFactorySourceExporter({client:f.client,repositories:[]}),/ALLOWLIST/);
 assert.throws(()=>createGitHubFactorySourceExporter({client:f.client,repositories:["owner/app"],maxTotalBytes:Infinity}),/LIMIT_INVALID/);
});

test("explicit subset validates complete metadata but never fetches unrelated blobs",async t=>{
 const f=fixture(),dir=await workspace(t);f.tree.tree.push({path:"unrelated.bin",type:"blob",mode:"100644",sha:"d".repeat(40),size:999999999});
 const exporter=createGitHubFactorySourceExporter({client:f.client,repositories:["owner/app"],sourcePaths:["src/index.ts"],signal:new AbortController().signal});
 await exporter("owner/app",commitSha,dir);assert.equal(f.calls.filter(([kind])=>kind==="blob").length,1);assert.deepEqual(await readdir(dir),["src"]);
 const missing=fixture();await assert.rejects(createGitHubFactorySourceExporter({client:missing.client,repositories:["owner/app"],sourcePaths:["src/missing.ts"]})("owner/app",commitSha,await workspace(t)),/SOURCE_MISSING/);assert.equal(missing.calls.some(([kind])=>kind==="blob"),false);
 for(const paths of [[],[".env"],["src/index.ts","src/index.ts"],["../escape"]])assert.throws(()=>createGitHubFactorySourceExporter({client:f.client,repositories:["owner/app"],sourcePaths:paths}),/SOURCE_PATHS_INVALID/);
});

test("subset does not hide unsafe unrelated metadata and cancellation stops before blob writes",async t=>{
 const f=fixture();f.tree.tree.push({path:"missing-parent/ordinary.ts",type:"blob",mode:"100644",sha:"d".repeat(40),size:1});await assert.rejects(createGitHubFactorySourceExporter({client:f.client,repositories:["owner/app"],sourcePaths:["src/index.ts"]})("owner/app",commitSha,await workspace(t)),/TREE_PARENT/);assert.equal(f.calls.some(([kind])=>kind==="blob"),false);
 const a=fixture(),abort=new AbortController(),getTree=a.client.rest.git.getTree;a.client.rest.git.getTree=async input=>{const result=await getTree(input);abort.abort();return result;};const dir=await workspace(t);
 await assert.rejects(createGitHubFactorySourceExporter({client:a.client,repositories:["owner/app"],sourcePaths:["src/index.ts"],signal:abort.signal})("owner/app",commitSha,dir));assert.equal(a.calls.some(([kind])=>kind==="blob"),false);assert.deepEqual(await readdir(dir),[]);
});
