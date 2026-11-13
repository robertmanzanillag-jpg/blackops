import {measureRoleWorkDeadline} from "../server/software-factory-role-deadline";
import {execFile,spawn} from "node:child_process";
import {promisify} from "node:util";
import {realpath,writeFile,readFile,lstat,mkdtemp,mkdir,rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {createHash,randomUUID} from "node:crypto";
import {measureRoleWorkAcceptance,ROLE_WORK_ACCEPTANCE_ID,remoteAcceptanceRuntime,serveAcceptanceRuntime} from "../server/software-factory-role-acceptance";
const exec=promisify(execFile);
export async function checkedRoot(root:string,sha:string){
 if(!path.isAbsolute(root)||!/^[a-f0-9]{40}$/.test(sha)||/[\r\n,]/.test(root))throw Error("QA_EXACT_CHECKOUT_REQUIRED");
 const resolved=await realpath(root);
 const git=async(args:string[])=>(await exec("git",["-C",resolved,...args],{timeout:10000,maxBuffer:1024*1024})).stdout.trim();
 if(await git(["rev-parse","HEAD"])!==sha || await git(["status","--porcelain","--untracked-files=normal"]))throw Error("QA_SOURCE_DIRTY_OR_WRONG_REVISION");
 return resolved;
}
export function acceptanceTreeEntries(raw:string){
 const entries:Array<{path:string;sha:string;mode:string}>=[],seen=new Set<string>();
 for(const row of raw.split("\0").filter(Boolean)){
  const match=/^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(row);if(!match)throw Error("QA_SOURCE_SPECIAL_ENTRY");
  const [,mode,sha,name]=match,parts=name.split("/");
  if(parts.some(p=>!p||p==="."||p==="..")||/[\\\x00-\x1f]/.test(name)||seen.has(name.toLowerCase()))throw Error("QA_SOURCE_PATH_INVALID");seen.add(name.toLowerCase());
  // Only these two root namespaces are omitted; their contents are never read.
  if(parts[0]==="credentials"||parts[0]==="secrets")continue;
  if(parts.some(p=>/^(?:credentials|secrets|node_modules|\.git|\.aws|\.ssh|\.env(?:\..*)?|id_rsa|id_ed25519)$/i.test(p)||/\.(?:pem|key|p12|pfx)$/i.test(p)))throw Error("QA_SOURCE_SENSITIVE_ENTRY");
  entries.push({path:name,sha,mode});if(entries.length>10000)throw Error("QA_SOURCE_TOO_MANY_FILES");
 }
 if(!entries.some(e=>e.path==="server/office-role-work.ts"))throw Error("QA_SOURCE_RUNTIME_MISSING");
 return entries;
}
export async function exportRevision(root:string,sha:string){
 const raw=(await exec("git",["-C",root,"ls-tree","-rz",sha],{timeout:10000,maxBuffer:2097152})).stdout;
 const entries=acceptanceTreeEntries(raw),directory=await mkdtemp(path.join(os.tmpdir(),"office-acceptance-source-"));let bytesTotal=0;
 try{for(const entry of entries){
  const source=path.join(root,entry.path),resolved=await realpath(source),stat=await lstat(source);
  if(!resolved.startsWith(root+path.sep)||stat.isSymbolicLink()||!stat.isFile()||stat.size>20971520||(bytesTotal+=stat.size)>104857600)throw Error("QA_SOURCE_FILE_INVALID");
  const bytes=await readFile(source),blob=createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");if(blob!==entry.sha)throw Error("QA_SOURCE_BLOB_CHANGED");
  const destination=path.join(directory,entry.path);await mkdir(path.dirname(destination),{recursive:true});await writeFile(destination,bytes,{flag:"wx",mode:entry.mode==="100755"?0o500:0o400});
 }
 return {directory,sourceManifestSha256:createHash("sha256").update(JSON.stringify({sha,excludedRoots:["credentials","secrets"],entries})).digest("hex")};
 }catch(error){await rm(directory,{recursive:true,force:true});throw error;}
}
export async function removeAcceptanceContainer(name:string,run:(args:string[])=>Promise<{stdout:string}>=args=>exec("docker",args,{timeout:15000,maxBuffer:65536})){
 if(!/^factory-acceptance-[a-f0-9-]{36}$/.test(name))throw Error("QA_CONTAINER_NAME_INVALID");
 try{await run(["rm","-f",name]);}catch{/* Auto-remove may win the race. Verify absence below. */}
 const result=await run(["ps","-aq","--filter",`name=^/${name}$`]);if(result.stdout.trim())throw Error("QA_CONTAINER_STILL_PRESENT");
}
async function revision(root:string,sha:string,controller:string,dependencies:string,sourceManifestSha256:string){
 const name=`factory-acceptance-${randomUUID()}`,image=process.env.FACTORY_IMAGE;
 if(!image||!/^docker\.io\/library\/node@sha256:[a-f0-9]{64}$/.test(image))throw Error("QA_PINNED_IMAGE_REQUIRED");
 const runId=process.env.GITHUB_RUN_ID;if(!runId||!/^\d+$/.test(runId))throw Error("QA_CI_RUN_REQUIRED");
 const args=["run","--interactive","--rm","--name",name,"--label",`office.factory.acceptance=${runId}`,"--network","none","--read-only","--cap-drop","ALL","--security-opt","no-new-privileges","--user",`${process.getuid!()}:${process.getgid!()}`,"--memory","1g","--cpus","1","--pids-limit","64","--tmpfs","/tmp:rw,nosuid,size=64m","--env","HOME=/tmp","--mount",`type=bind,src=${controller},dst=/controller,readonly`,"--mount",`type=bind,src=${root},dst=/candidate,readonly`,"--mount",`type=bind,src=${dependencies},dst=/node_modules,readonly`,"--workdir","/controller",image,"node","--import","tsx","script/software-factory-role-acceptance.ts","--guest"];
 // No /output or host socket mount; no credentials/environment passthrough.
 const child=spawn("docker",args,{stdio:["pipe","pipe","pipe"],windowsHide:true});
 const runtime=remoteAcceptanceRuntime(child.stdout,child.stdin);
 const timeout=setTimeout(()=>{runtime.close();child.kill();},90000);
 let stderr=0;child.stderr.on("data",b=>{stderr+=b.length;if(stderr>65536){runtime.close();child.kill();}});child.once("error",runtime.close);child.once("exit",runtime.close);
 try{return {headSha:sha,sourceManifestSha256,...await measureRoleWorkAcceptance(runtime),deadline:await measureRoleWorkDeadline(runtime)};}
 finally{clearTimeout(timeout);runtime.close();child.stdin.end();await removeAcceptanceContainer(name);}
}
async function main(){
 if(process.argv[2]==="--guest"){
  // This path is invoked ONLY inside the credentialless separate container.
  const candidateModule=pathToFileURL("/candidate/server/office-role-work.ts").href;const runtime=await import(candidateModule);serveAcceptanceRuntime(process.stdin,process.stdout,runtime);return;
 }
 if(process.env.FACTORY_QA_ISOLATED!=="true"||process.platform!=="linux")throw Error("QA_ISOLATED_CI_REQUIRED");
 const args=process.argv.slice(2);if(args.length!==6)throw Error("QA_ARGUMENTS_REQUIRED");
 const [baseRoot,baseSha,headRoot,headSha,output,deps]=args;
 const baselineRoot=await checkedRoot(baseRoot,baseSha),candidateRoot=await checkedRoot(headRoot,headSha),dependencies=await realpath(deps);
 if(!path.isAbsolute(output)||baseSha===headSha||baselineRoot===candidateRoot||/[\r\n,]/.test(dependencies)||path.resolve(output).startsWith(baselineRoot+path.sep)||path.resolve(output).startsWith(candidateRoot+path.sep))throw Error("QA_DISTINCT_REVISIONS_REQUIRED");
 let baseExport:Awaited<ReturnType<typeof exportRevision>>|undefined,headExport:Awaited<ReturnType<typeof exportRevision>>|undefined;
 let baseline:Awaited<ReturnType<typeof revision>>,candidate:Awaited<ReturnType<typeof revision>>;
 try{baseExport=await exportRevision(baselineRoot,baseSha);headExport=await exportRevision(candidateRoot,headSha);baseline=await revision(baseExport.directory,baseSha,baseExport.directory,dependencies,baseExport.sourceManifestSha256);candidate=await revision(headExport.directory,headSha,baseExport.directory,dependencies,headExport.sourceManifestSha256);}finally{if(baseExport)await rm(baseExport.directory,{recursive:true,force:true});if(headExport)await rm(headExport.directory,{recursive:true,force:true});}
 const report={version:1,repository:"robertmanzanillag-jpg/blackops",scenarioId:ROLE_WORK_ACCEPTANCE_ID,scope:"backend-acceptance-only",createdAt:new Date().toISOString(),baseline,candidate};
 const bytes=JSON.stringify(report);await writeFile(output,bytes,{flag:"wx",mode:0o600});
 process.stdout.write(JSON.stringify({artifactSha256:createHash("sha256").update(bytes).digest("hex"),baselinePassed:baseline.passed,candidatePassed:candidate.passed})+"\n");
 if(!candidate.passed)process.exitCode=1;
}
if(import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)void main().catch(()=>{console.error("Acceptance QA blocked: verify isolated exact clean checkouts and unique output path.");process.exitCode=1;});
