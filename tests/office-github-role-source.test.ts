import test from "node:test";
import assert from "node:assert/strict";
import {readGithubRoleSnapshot,normalizeRegisteredRepo} from "../server/office-github-role-source";
import {auditSavedRole} from "../server/office-role-audits";
import {githubRecordId,sourceDigest,validateRoleSnapshot,PENDING_OFFICE_ROLES} from "../server/office-role-snapshots";
import {createRoleWorkRunner,parseRoleWork} from "../server/office-role-work";
import {createCapabilityTrainer,parseCapabilityTraining,type CapabilityTrainingState} from "../server/office-capability-training";

const NOW=Date.parse("2026-11-07T01:00:00Z"),owner="owner",TOKEN="github_pat_SECRETVALUE1234567890abcdef";
const SHA="a".repeat(40),day=86400000;
function pool(projects:any[],opts:{wrongOwner?:boolean}={}){
 const queries:string[]=[];
 return {queries,connect:async()=>({query:async(sql:string,args?:unknown[])=>{queries.push(sql);
  if(sql.startsWith("SELECT id FROM users"))return {rows:[{id:opts.wrongOwner?"other":owner}]};
  if(sql.includes("FROM app_projects")){assert.deepEqual(args,[owner]);return {rows:projects};}
  return {rows:[]};},release:()=>{}})};
}
const json=(body:unknown,status=200,headers:Record<string,string>={})=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json",...headers}});
type Route=(path:string,init:RequestInit)=>Response|Promise<Response>;
function mockFetch(route:Route){
 const calls:Array<{url:string;init:RequestInit}>=[];
 const fetch=async(url:string,init:RequestInit)=>{calls.push({url,init});const u=new URL(url);assert.equal(u.origin,"https://api.github.com");assert.equal(init.method,"GET");assert.equal(init.redirect,"error");return route(u.pathname+u.search,init);};
 return {fetch,calls};
}
const repoMeta=(full:string,extra:any={})=>({full_name:full,default_branch:"main",archived:false,pushed_at:new Date(NOW-day).toISOString(),open_issues_count:3,...extra});
const pr=(n:number,extra:any={})=>({number:n,draft:false,created_at:new Date(NOW-3*day).toISOString(),updated_at:new Date(NOW-day).toISOString(),head:{sha:SHA},requested_reviewers:[{login:"x"}],requested_teams:[],...extra});
const read=(role:"github"|"code",projects:any[],route:Route,extra:any={})=>{const m=mockFetch(route);return {m,run:readGithubRoleSnapshot({pool:pool(projects),owner,role,fetch:m.fetch,now:()=>NOW,token:TOKEN,...extra})};};
const projects=[{githubRepo:"Acme/App",repoOwner:null,repoName:null},{githubRepo:null,repoOwner:"acme",repoName:"old"},{githubRepo:"https://github.com/acme/app.git",repoOwner:null,repoName:null},{githubRepo:"https://gitlab.com/acme/x",repoOwner:null,repoName:null},{githubRepo:null,repoOwner:null,repoName:null}];

test("registered repo normalization only accepts github.com repositories",()=>{
 assert.equal(normalizeRegisteredRepo("https://github.com/Acme/App.git",null,null),"acme/app");
 assert.equal(normalizeRegisteredRepo(null,"acme","app"),"acme/app");
 for(const bad of ["https://gitlab.com/a/b","a/b/c","../x","https://github.com.evil/a/b","a/.."])assert.equal(normalizeRegisteredRepo(bad,null,null),null);
});

test("github success: metadata, failing default branch, stale and archived repos, stable ids, token only in header",async()=>{
 const logs:string[]=[];const orig={log:console.log,error:console.error,warn:console.warn};
 for(const k of ["log","error","warn"] as const)(console as any)[k]=(...a:unknown[])=>logs.push(a.map(String).join(" "));
 try{
  const {m,run}=read("github",projects,path=>{
   if(path==="/repos/acme/app")return json(repoMeta("Acme/App"));
   if(path==="/repos/acme/old")return json(repoMeta("acme/old",{pushed_at:new Date(NOW-90*day).toISOString(),archived:false}));
   if(path.startsWith("/repos/acme/app/actions/runs"))return json({workflow_runs:[{status:"completed",conclusion:"failure",created_at:new Date(NOW-1000).toISOString()}]});
   if(path.startsWith("/repos/acme/old/actions/runs"))return json({message:"no"},403);
   return json({},404);
  });
  const snap=await run;
  assert.equal(snap.role,"github");assert.equal(snap.total,2);assert.deepEqual(snap.github,{blocked:null,truncated:false,repositories:2});
  assert.deepEqual(snap.rows.map(r=>r.id),[githubRecordId("repository","acme/app"),githubRecordId("repository","acme/old")]);
  assert.ok(m.calls.every(c=>(c.init.headers as any).Authorization===`Bearer ${TOKEN}`));
  const audit=auditSavedRole("github",snap,owner,NOW);
  assert.equal(audit.status,"completed");assert.equal(audit.capability,"github-read-audit:github:v1");assert.equal(audit.completeCoverage,true);
  assert.deepEqual(audit.findings.map(f=>f.code),["FAILING_DEFAULT_BRANCH","STALE_REPOSITORY","WORKFLOW_UNREADABLE"]);
  assert.equal(audit.metrics.failingDefaultBranches,1);assert.equal(audit.metrics.openIssuesAndPullRequests,6);
  assert.ok(!JSON.stringify({snap,audit}).includes(TOKEN));
  // Validation is deterministic and tamper-evident.
  const tampered=structuredClone(snap);tampered.rows[0].archived=true;assert.throws(()=>validateRoleSnapshot(tampered,owner,NOW));
  const forged=structuredClone(snap);forged.rows[0].id="x";const {sourceDigest:_,...body}=forged;forged.sourceDigest=sourceDigest(body);assert.throws(()=>validateRoleSnapshot(forged,owner,NOW));
 }finally{Object.assign(console,orig);}
 assert.ok(!logs.join("\n").includes(TOKEN));
});

test("code success: PR age, failing checks, review needed, conflicts; detail only with token",async()=>{
 const route:Route=path=>{
  if(path.startsWith("/repos/acme/app/pulls?"))return json([pr(1),pr(2,{draft:true,updated_at:new Date(NOW-10*day).toISOString(),requested_reviewers:[]})]);
  if(path.startsWith("/repos/acme/old/pulls?"))return json({message:"Not Found"},404);
  if(path==="/repos/acme/app/pulls/1")return json({mergeable_state:"dirty"});
  if(path==="/repos/acme/app/pulls/2")return json({mergeable_state:"clean"});
  if(path.startsWith(`/repos/acme/app/commits/${SHA}/check-runs`))return json({total_count:2,check_runs:[{status:"completed",conclusion:"failure"},{status:"in_progress",conclusion:null}]});
  return json({},404);
 };
 const {m,run}=read("code",projects,route);const snap=await run;
 assert.equal(snap.total,3);assert.equal(snap.rows.filter(r=>r.kind==="pull_request").length,2);
 assert.ok(m.calls.some(c=>c.url.endsWith("/pulls/1")));
 const audit=auditSavedRole("code",snap,owner,NOW);assert.equal(audit.status,"completed");
 const codes=audit.findings.map(f=>f.code);
 for(const c of ["REPOSITORY_UNREADABLE","PR_FAILING_CHECKS","PR_CONFLICTED","PR_NEEDS_REVIEW","PR_STALE"])assert.ok(codes.includes(c),c);
 assert.equal(audit.findings.find(f=>f.code==="PR_STALE")!.recordIds[0],githubRecordId("pull_request","acme/app",2));
 assert.equal(audit.metrics.openPullRequests,2);assert.equal(audit.metrics.oldestPullRequestAgeDays,3);
 const anon=read("code",projects,route,{token:null});const anonSnap=await anon.run;
 assert.ok(!anon.m.calls.some(c=>/\/pulls\/\d+$/.test(c.url)));assert.ok(anon.m.calls.every(c=>!(c.init.headers as any).Authorization));
 assert.equal(anonSnap.rows.find(r=>r.number===1)!.mergeableState,null);
 // No open PRs is a successful audit without findings.
 const empty=await read("code",[projects[0]],path=>path.includes("/pulls?")?json([]):json({},404)).run;
 const ea=auditSavedRole("code",empty,owner,NOW);assert.equal(ea.status,"completed");assert.deepEqual(ea.findings,[]);
});

test("empty inventory and every-repo-unreadable are precise blocks",async()=>{
 for(const role of ["github","code"] as const){
  const {m,run}=read(role,[projects[3],projects[4]],()=>{throw Error("must not fetch");});const snap=await run;
  assert.equal(m.calls.length,0);assert.equal(snap.github!.blocked,"NO_REGISTERED_REPOSITORIES");
  const audit=auditSavedRole(role,snap,owner,NOW);assert.equal(audit.status,"blocked");assert.deepEqual(audit.findings.map(f=>f.code),["NO_REGISTERED_REPOSITORIES"]);
  const hidden=auditSavedRole(role,await read(role,[projects[0]],()=>json({message:"Not Found"},404)).run,owner,NOW);
  assert.equal(hidden.status,"blocked");assert.deepEqual(hidden.findings.map(f=>f.code),["REPOSITORIES_UNREADABLE"]);
 }
 await assert.rejects(()=>readGithubRoleSnapshot({pool:pool(projects,{wrongOwner:true}),owner,role:"github",fetch:async()=>{throw Error("no");}}));
});

test("rate limit, auth rejection, malformed token, upstream and invalid responses block without leaking",async()=>{
 const cases:Array<[Route,string,any?]>=[
  [()=>json({message:"API rate limit exceeded for 1.2.3.4"},403,{"x-ratelimit-remaining":"0"}),"GITHUB_RATE_LIMITED"],
  [()=>json({message:"secondary"},429,{"retry-after":"60"}),"GITHUB_RATE_LIMITED"],
  [()=>json({message:"Bad credentials"},401),"GITHUB_AUTH_REJECTED"],
  [()=>json({},502),"GITHUB_UPSTREAM_ERROR"],
  [()=>new Response("not json",{status:200}),"GITHUB_RESPONSE_INVALID"],
  [()=>json(repoMeta("other/repo")),"GITHUB_RESPONSE_INVALID"],
  [()=>{throw new TypeError(`fetch failed ${TOKEN}`);},"GITHUB_NETWORK_ERROR"],
  [()=>json({}),"GITHUB_TOKEN_INVALID",{token:"not-a-token"}],
 ];
 for(const [route,code,extra] of cases){
  const {run}=read("github",[projects[0]],route,extra);const snap=await run;
  assert.equal(snap.github!.blocked,code);assert.equal(snap.rows.length,0);
  const audit=auditSavedRole("github",snap,owner,NOW);assert.equal(audit.status,"blocked");assert.equal(audit.findings[0].code,code);
  assert.ok(!JSON.stringify({snap,audit}).includes(TOKEN));assert.ok(!JSON.stringify(snap).includes("1.2.3.4"));
 }
});

test("per-request timeout and overall deadline abort hung requests",async()=>{
 const hang:Route=(_p,init)=>new Promise((_,reject)=>init.signal!.addEventListener("abort",()=>reject(new DOMException("aborted","AbortError"))));
 let started=Date.now();
 const t=await read("github",[projects[0]],hang,{requestTimeoutMs:30,now:Date.now}).run;
 assert.equal(t.github!.blocked,"GITHUB_TIMEOUT");assert.ok(Date.now()-started<2000);
 started=Date.now();
 const d=await read("code",[projects[0]],hang,{requestTimeoutMs:10000,deadlineMs:30,now:Date.now}).run;
 assert.equal(d.github!.blocked,"GITHUB_READ_DEADLINE");assert.ok(Date.now()-started<2000);
});

test("pagination and repository caps bound requests and mark partial coverage",async()=>{
 const many=Array.from({length:12},(_,i)=>({githubRepo:`acme/r${String(i).padStart(2,"0")}`,repoOwner:null,repoName:null}));
 let n=0;
 const {m,run}=read("code",many,path=>{
  if(path.includes("/pulls?"))return json(Array.from({length:30},()=>pr(++n)));
  if(path.includes("/check-runs"))return json({total_count:0,check_runs:[]});
  return json({mergeable_state:"clean"});
 });
 const snap=await run;
 assert.equal(snap.rows.length,30);assert.equal(snap.github!.truncated,true);
 assert.equal(m.calls.filter(c=>c.url.includes("/pulls?")).length,1);
 assert.ok(m.calls.length<=1+30*2);
 const audit=auditSavedRole("code",snap,owner,NOW);assert.equal(audit.completeCoverage,false);assert.ok(audit.findings.some(f=>f.code==="PARTIAL_COVERAGE"));
 // Few PRs per page still stop after MAX pages for one repository.
 let pages=0;
 const deep=await read("code",[projects[0]],path=>{if(path.includes("/pulls?")){pages++;return json(Array.from({length:30},()=>pr(++n)));}return json({total_count:0,check_runs:[]});}).run;
 assert.equal(pages,1);assert.equal(deep.github!.truncated,true);
 const gh=await read("github",many,path=>path.includes("/actions/")?json({workflow_runs:[]}):json(repoMeta(path.slice(7)))).run;
 assert.equal(gh.total,12);assert.equal(gh.rows.length,10);assert.equal(gh.github!.truncated,true);
 assert.equal(auditSavedRole("github",gh,owner,NOW).status,"completed");
});

const fixture=()=>{let clock=NOW,state:any={roles:{version:1,roles:Object.fromEntries(PENDING_OFFICE_ROLES.map(r=>[r,{generation:1}]))}};const company:any={careers:Object.fromEntries(PENDING_OFFICE_ROLES.map(r=>[r,{generation:1}]))};
 return {now:()=>clock,setNow:(v:number)=>{clock=v;},state:()=>state,company,council:{async updateOfficeExecution(change:any){state=JSON.parse(JSON.stringify(change(structuredClone(state),company)));return structuredClone(state);}}};};

test("role work persists GitHub audits, reparses them historically and keeps legacy CAPABILITY_UNAVAILABLE without a reader",async()=>{
 const f=fixture();
 const legacy=fixture();await createRoleWorkRunner({owner,council:legacy.council,now:legacy.now,read:async()=>{throw Error("x");}}).tick();
 assert.equal(parseRoleWork(legacy.state().roleWork,owner).jobs.find(j=>j.role==="github")!.audit!.findings[0].code,"CAPABILITY_UNAVAILABLE");
 const route:Route=path=>path==="/repos/acme/app"?json(repoMeta("acme/app")):path.includes("/actions/")?json({workflow_runs:[]}):path.includes("/pulls?")?json([pr(7)]):json({total_count:1,check_runs:[{status:"completed",conclusion:"failure"}]});
 const m=mockFetch(route);
 await createRoleWorkRunner({owner,council:f.council,now:f.now,read:async()=>{throw Error("sql off");},readGithub:async role=>role==="code"?(()=>{throw Error(`boom ${TOKEN}`);})():readGithubRoleSnapshot({pool:pool([projects[0]]),owner,role,fetch:m.fetch,now:f.now,token:TOKEN})}).tick();
 const journal=parseRoleWork(f.state().roleWork,owner);
 const gh=journal.jobs.find(j=>j.role==="github")!,code=journal.jobs.find(j=>j.role==="code")!;
 assert.equal(gh.status,"completed");assert.equal(gh.source!.role,"github");
 assert.equal(code.status,"blocked");assert.equal(code.reason,"source_unavailable");assert.equal(code.audit!.findings[0].code,"SOURCE_UNAVAILABLE");
 assert.ok(!JSON.stringify(f.state()).includes(TOKEN));
 assert.doesNotThrow(()=>parseRoleWork(f.state().roleWork,owner));
 // Historical validation uses the recorded clock, so it survives aging.
 f.setNow(NOW+10*day);assert.doesNotThrow(()=>parseRoleWork(f.state().roleWork,owner));
 const tampered=structuredClone(f.state().roleWork);tampered.jobs.find((j:any)=>j.role==="github").audit.metrics.readableRepositories=99;assert.throws(()=>parseRoleWork(tampered,owner));
 const relabeled=structuredClone(f.state().roleWork);delete relabeled.jobs.find((j:any)=>j.role==="code").reason;assert.throws(()=>parseRoleWork(relabeled,owner));

 // Capability training accepts the completed GitHub audit as a real production source.
 let training:CapabilityTrainingState=parseCapabilityTraining(undefined,owner);let calls=0;
 const generations=Object.fromEntries(PENDING_OFFICE_ROLES.map(r=>[r,1]));
 const githubOnly={...journal,jobs:journal.jobs.filter(j=>j.role==="github")};
 const trainer=createCapabilityTrainer({owner,maxCallsPerDay:2,now:()=>NOW+1000,loadWork:async()=>githubOnly,
  transact:async change=>{training=parseCapabilityTraining(JSON.parse(JSON.stringify(change(structuredClone(training),generations,false))),owner);return structuredClone(training);},
  run:async(raw,call)=>{calls++;const task=JSON.parse(raw).source;assert.equal(task.role,"github");assert.ok(task.issueCodes.length===0||task.issueCodes.every((c:string)=>typeof c==="string"));
   return {text:JSON.stringify({scope:"source-triage-v1",evidenceIds:task.evidenceIds,issueCodes:task.issueCodes,decision:task.sourceBlocked?"review_source":task.issueCodes.length?"review_findings":"record_audit"}),sessionId:`resp_gh_${calls}`,provider:"openai",model:"m",completedAt:new Date(NOW+1000).toISOString(),usage:{inputTokens:1,outputTokens:1,totalTokens:2}} as any;},
  verifyCost:async r=>({receiptId:`r:${r.responseId}`,executionId:r.executionId,responseId:r.responseId,model:r.model,usage:r.usage,currency:"USD",usd:0.001})});
 await trainer.tick();
 assert.equal(calls,1);const run=training.runs[0];assert.equal(run.kind,"production");assert.equal(run.role,"github");assert.equal(run.status,"completed");
 assert.deepEqual(run.task.evidenceIds,[gh.id,gh.artifactId]);
 assert.doesNotThrow(()=>parseCapabilityTraining(training,owner));
});
