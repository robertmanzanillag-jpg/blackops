import {verifiedGitHubArtifactLocation} from "../server/software-factory-artifact-host";
import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import * as actual from "../server/office-role-work";
import {measureRoleWorkAcceptance,ROLE_WORK_ACCEPTANCE_ID} from "../server/software-factory-role-acceptance";
import {verifyRoleAcceptanceReport,readAcceptanceZip,createRoleAcceptanceArtifactReader} from "../server/software-factory-role-artifact";
const digest=(b:Buffer)=>createHash("sha256").update(b).digest("hex"),base="a".repeat(40),head="b".repeat(40),now=Date.parse("2026-11-07T00:00:00Z");
function archive(data:Buffer){const name=Buffer.from("acceptance.json"),local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);local.writeUInt32LE(0x04034b50);local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(name.length,26);central.writeUInt32LE(0x02014b50);central.writeUInt32LE(data.length,20);central.writeUInt32LE(data.length,24);central.writeUInt16LE(name.length,28);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+data.length,16);return Buffer.concat([local,name,data,central,name,end]);}
async function report(){const result=await measureRoleWorkAcceptance(actual);return {version:1,repository:"robertmanzanillag-jpg/blackops",scenarioId:ROLE_WORK_ACCEPTANCE_ID,scope:"backend-acceptance-only",createdAt:new Date(now).toISOString(),baseline:{headSha:base,sourceManifestSha256:"c".repeat(64),...result},candidate:{headSha:head,sourceManifestSha256:"d".repeat(64),...result}};}
test("fixed acceptance harness executes real office runner, catches permissive parser and records measurements",async()=>{const r=await measureRoleWorkAcceptance(actual);assert.equal(r.passed,true);assert.equal(r.assertions.length,6);assert.ok(r.durationMs>=0);const broken=await measureRoleWorkAcceptance({...actual,parseRoleWork:(s:any)=>s});assert.equal(broken.passed,false);assert.equal(broken.assertions.find(a=>a.id==="foreign-owner-rejected")!.passed,false);});
test("report verifies exact revisions, complete measured assertions and bounded authenticated archive",async()=>{const r=await report(),bytes=Buffer.from(JSON.stringify(r)),zip=archive(bytes);assert.deepEqual(readAcceptanceZip(zip,digest(zip)),bytes);assert.equal(verifyRoleAcceptanceReport(bytes,{baseSha:base,headSha:head,sha256:digest(bytes),now}).candidate.passed,true);assert.throws(()=>verifyRoleAcceptanceReport(bytes,{baseSha:head,headSha:base,sha256:digest(bytes),now}));assert.throws(()=>verifyRoleAcceptanceReport(bytes,{baseSha:base,headSha:head,sha256:digest(bytes),now:now+86400001}));const bad=Buffer.from(JSON.stringify({...r,candidate:{...r.candidate,assertions:[r.candidate.assertions[0],...r.candidate.assertions.slice(0,5)]}}));assert.throws(()=>verifyRoleAcceptanceReport(bad,{baseSha:base,headSha:head,sha256:digest(bad),now}));assert.throws(()=>readAcceptanceZip(zip,"0".repeat(64)));});
test("authenticated artifact identity precedes no-credential archive download; wrong digest and host fail closed",async()=>{const bytes=Buffer.from(JSON.stringify(await report())),zip=archive(bytes),root="https://api.github.com/repos/robertmanzanillag-jpg/blackops";let downloads=0;const options={archiveHosts:["fixture.blob.core.windows.net"],now:()=>now,apiRequest:async(url:string)=>url.endsWith("/zip")?new Response(null,{status:302,headers:{location:"https://fixture.blob.core.windows.net/signed"}}):new Response(JSON.stringify({total_count:1,artifacts:[{name:"office-role-acceptance-v1",id:8,expired:false,workflow_run:{id:7,head_sha:head},digest:`sha256:${digest(zip)}`,size_in_bytes:zip.length,archive_download_url:`${root}/actions/artifacts/8/zip`}]})),download:async(_url:string,init:RequestInit)=>{downloads++;assert.deepEqual(init.headers,{});assert.equal(init.credentials,"omit");assert.equal(init.redirect,"error");return new Response(zip);}};const result=await createRoleAcceptanceArtifactReader(options)({runId:7,baseSha:base,headSha:head,signal:new AbortController().signal});assert.deepEqual(result.regressionScenarioIds,[ROLE_WORK_ACCEPTANCE_ID]);assert.equal(downloads,1);await assert.rejects(()=>createRoleAcceptanceArtifactReader({...options,archiveHosts:["another.blob.core.windows.net"]})({runId:7,baseSha:base,headSha:head,signal:new AbortController().signal}));assert.equal(downloads,1);});


test("external oracle rejects early successful exit and forged child pass output",async()=>{
 const {spawn}=await import("node:child_process");const {remoteAcceptanceRuntime}=await import("../server/software-factory-role-acceptance");
 for(const malicious of ['process.exit(0)','process.stdout.write(JSON.stringify({type:"reply",id:"00000000-0000-0000-0000-000000000000",ok:true,value:{passed:true}})+"\\n");process.exit(0)']){
  const child=spawn(process.execPath,["-e",malicious],{stdio:["pipe","pipe","ignore"],windowsHide:true});const runtime=remoteAcceptanceRuntime(child.stdout,child.stdin);child.once("exit",runtime.close);const report=await measureRoleWorkAcceptance(runtime);runtime.close();child.kill();assert.equal(report.passed,false);assert.ok(report.assertions.some(a=>!a.passed));
 }
});
test("external controller drives real child runtime callbacks and retains its assertions",async()=>{
 const {spawn}=await import("node:child_process"),{pathToFileURL}=await import("node:url"),path=await import("node:path");const {remoteAcceptanceRuntime}=await import("../server/software-factory-role-acceptance");
 const bridge=pathToFileURL(path.resolve("server/software-factory-role-acceptance.ts")).href,actual=pathToFileURL(path.resolve("server/office-role-work.ts")).href;
 const child=spawn(process.execPath,["--import","tsx","--input-type=module","-e",`import {serveAcceptanceRuntime} from ${JSON.stringify(bridge)};import * as actual from ${JSON.stringify(actual)};serveAcceptanceRuntime(process.stdin,process.stdout,actual);`],{stdio:["pipe","pipe","ignore"],windowsHide:true});const runtime=remoteAcceptanceRuntime(child.stdout,child.stdin);child.once("exit",runtime.close);const timer=setTimeout(()=>{runtime.close();child.kill();},10000);try{assert.equal((await measureRoleWorkAcceptance(runtime)).passed,true);}finally{clearTimeout(timer);runtime.close();child.kill();}
});

test("matching RPC IDs with fabricated pass reports cannot replace controller-owned state",async()=>{
 const {spawn}=await import("node:child_process"),{remoteAcceptanceRuntime}=await import("../server/software-factory-role-acceptance");
 const code='let b="";process.stdin.on("data",c=>{b+=c;for(;;){const i=b.indexOf("\\n");if(i<0)break;const m=JSON.parse(b.slice(0,i));b=b.slice(i+1);process.stdout.write(JSON.stringify({type:"reply",id:m.id,ok:true,value:{passed:true}})+"\\n");}})';
 const child=spawn(process.execPath,["-e",code.replaceAll('\\\\n','\\n')],{stdio:["pipe","pipe","ignore"],windowsHide:true}),runtime=remoteAcceptanceRuntime(child.stdout,child.stdin);child.once("exit",runtime.close);const timer=setTimeout(()=>{runtime.close();child.kill();},3000);try{assert.equal((await measureRoleWorkAcceptance(runtime)).passed,false);}finally{clearTimeout(timer);runtime.close();child.kill();}
});

test("export metadata excludes only root secret namespaces and rejects other sensitive or special entries",async()=>{
 const {acceptanceTreeEntries}=await import("../script/software-factory-role-acceptance");const row=(p:string,mode="100644")=>`${mode} blob ${"a".repeat(40)}\t${p}\0`;
 const safe=row("server/office-role-work.ts");const selected=acceptanceTreeEntries(safe+row("credentials/README.md")+row("secrets/README.md"));assert.deepEqual(selected.map(e=>e.path),["server/office-role-work.ts"]);
 for(const p of ["server/secrets/value.txt",".env.local","src/node_modules/a.js","server/key.pem","../escape"]){assert.throws(()=>acceptanceTreeEntries(safe+row(p)));}assert.throws(()=>acceptanceTreeEntries(safe+row("credentials/link","120000")));
});
test("cleanup accepts an auto-remove race only after exact container absence is proved",async()=>{
 const {removeAcceptanceContainer}=await import("../script/software-factory-role-acceptance"),name="factory-acceptance-00000000-0000-0000-0000-000000000000";let calls=0;
 await removeAcceptanceContainer(name,async args=>{calls++;if(args[0]==="rm")throw Error("no such container");assert.deepEqual(args,["ps","-aq","--filter",`name=^/${name}$`]);return {stdout:""};});assert.equal(calls,2);
 await assert.rejects(()=>removeAcceptanceContainer(name,async args=>{if(args[0]==="rm")throw Error("failure");return {stdout:"still-present"};}));
 await assert.rejects(()=>removeAcceptanceContainer(name,async()=>{throw Error("daemon unavailable");}));
});


test("artifact host policy rejects alternate authorities and defaults to exact pins",()=>{
 const pins=["fixture.blob.core.windows.net"],good="https://productionresultssa12.blob.core.windows.net/archive?sig=synthetic";
 assert.throws(()=>verifiedGitHubArtifactLocation(good,pins));
 assert.equal(verifiedGitHubArtifactLocation(good,pins,true).hostname,"productionresultssa12.blob.core.windows.net");
 assert.equal(verifiedGitHubArtifactLocation("https://fixture.blob.core.windows.net/a",pins).hostname,pins[0]);
 for(const raw of ["http://productionresultssa12.blob.core.windows.net/a","https://productionresultssa12.blob.core.windows.net:443/a","https://productionresultssa12.blob.core.windows.net:444/a","https://user@productionresultssa12.blob.core.windows.net/a","https://productionresultssa12.blob.core.windows.net.evil.example/a","https://unrelated.blob.core.windows.net/a","https://productionresultssa.blob.core.windows.net/a","https://productionresultssa12x.blob.core.windows.net/a","https://productionresultssa12.blob.core.windows.net/a#fragment","https://productionresultssa12.blob.core.windows.net/a#"])
 assert.throws(()=>verifiedGitHubArtifactLocation(raw,pins,true),raw);
});
test("backend reader admits new result shards only after explicit opt-in",async()=>{
 const bytes=Buffer.from(JSON.stringify(await report())),zip=archive(bytes),root="https://api.github.com/repos/robertmanzanillag-jpg/blackops";
 let downloads=0;const input={runId:7,baseSha:base,headSha:head,signal:new AbortController().signal};
 const options={archiveHosts:["fixture.blob.core.windows.net"],now:()=>now,apiRequest:async(url:string)=>url.endsWith("/zip")?new Response(null,{status:302,headers:{location:"https://productionresultssa12.blob.core.windows.net/signed"}}):Response.json({total_count:1,artifacts:[{name:"office-role-acceptance-v1",id:8,expired:false,workflow_run:{id:7,head_sha:head},digest:`sha256:${digest(zip)}`,size_in_bytes:zip.length,archive_download_url:`${root}/actions/artifacts/8/zip`}]}),download:async(_url:string,init:RequestInit)=>{downloads++;assert.deepEqual(init.headers,{});assert.equal(init.credentials,"omit");assert.equal(init.redirect,"error");return new Response(zip);}};
 await assert.rejects(createRoleAcceptanceArtifactReader(options)(input));assert.equal(downloads,0);
 assert.deepEqual((await createRoleAcceptanceArtifactReader({...options,allowGitHubResultsAzureHosts:true})(input)).regressionScenarioIds,[ROLE_WORK_ACCEPTANCE_ID]);assert.equal(downloads,1);
});
