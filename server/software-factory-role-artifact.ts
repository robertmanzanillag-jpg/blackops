import {verifiedGitHubArtifactLocation} from "./software-factory-artifact-host";
import {ROLE_WORK_DEADLINE_ID,ROLE_WORK_DEADLINE_ASSERTIONS} from "./software-factory-role-deadline";
import {createHash} from "node:crypto";
import {inflateRawSync} from "node:zlib";
import {z} from "zod";
import {ROLE_WORK_ACCEPTANCE_ID,ROLE_WORK_ASSERTIONS} from "./software-factory-role-acceptance";
const sha=z.string().regex(/^[a-f0-9]{40}$/),hash=z.string().regex(/^[a-f0-9]{64}$/);
const deadlineCase=z.object({reader:z.enum(["sql","web"]),passed:z.boolean(),timedOut:z.boolean(),elapsedMs:z.number().finite().nonnegative().max(90000),assertions:z.array(z.object({id:z.enum(ROLE_WORK_DEADLINE_ASSERTIONS),passed:z.boolean()}).strict()).length(ROLE_WORK_DEADLINE_ASSERTIONS.length)}).strict();
const deadlineSchema=z.object({scenarioId:z.literal(ROLE_WORK_DEADLINE_ID),passed:z.boolean(),cases:z.array(deadlineCase).length(2)}).strict();
const measured=z.object({headSha:sha,sourceManifestSha256:hash,scenarioId:z.literal(ROLE_WORK_ACCEPTANCE_ID),kind:z.literal("backend-acceptance"),assertions:z.array(z.object({id:z.enum(ROLE_WORK_ASSERTIONS),passed:z.boolean()}).strict()).length(ROLE_WORK_ASSERTIONS.length),passed:z.boolean(),durationMs:z.number().finite().nonnegative().max(600000),deadline:deadlineSchema.optional()}).strict();
const schema=z.object({version:z.literal(1),repository:z.literal("robertmanzanillag-jpg/blackops"),scenarioId:z.literal(ROLE_WORK_ACCEPTANCE_ID),scope:z.literal("backend-acceptance-only"),createdAt:z.string().datetime(),baseline:measured,candidate:measured}).strict();
export function verifyRoleAcceptanceReport(bytes:Buffer,expected:{baseSha:string;headSha:string;sha256:string;now:number}){
 if(bytes.length>65536||createHash("sha256").update(bytes).digest("hex")!==hash.parse(expected.sha256))throw Error("QA_REPORT_DIGEST_MISMATCH");
 const report=schema.parse(JSON.parse(bytes.toString("utf8"))),age=expected.now-Date.parse(report.createdAt);
 if(report.baseline.headSha!==expected.baseSha||report.candidate.headSha!==expected.headSha||!Number.isFinite(age)||age<0||age>86400000)throw Error("QA_REPORT_IDENTITY_MISMATCH");
 for(const version of [report.baseline,report.candidate])if(new Set(version.assertions.map(a=>a.id)).size!==ROLE_WORK_ASSERTIONS.length||version.passed!==version.assertions.every(a=>a.passed))throw Error("QA_ASSERTIONS_INCOMPLETE");
 for(const version of [report.baseline,report.candidate])if(version.deadline){
  const d=version.deadline;if(new Set(d.cases.map(c=>c.reader)).size!==2||d.passed!==d.cases.every(c=>c.passed))throw Error("QA_DEADLINE_ASSERTIONS_INVALID");
  for(const c of d.cases){if(new Set(c.assertions.map(a=>a.id)).size!==ROLE_WORK_DEADLINE_ASSERTIONS.length||c.passed!==c.assertions.every(a=>a.passed)||(c.passed&&(c.timedOut||c.elapsedMs<58000||c.elapsedMs>=68000)))throw Error("QA_DEADLINE_ASSERTIONS_INVALID");}
 }
 if(!report.candidate.passed)throw Error("QA_CANDIDATE_FAILED");
 return report;
}
/** One fixed JSON file only, no disk extraction, encrypted/ZIP64
 * archives rejected. GitHub's full archive digest is checked before decompression. */
export function readAcceptanceZip(zip:Buffer,expectedDigest:string):Buffer{
 if(zip.length<22||zip.length>2097152||createHash("sha256").update(zip).digest("hex")!==hash.parse(expectedDigest))throw Error("QA_ARCHIVE_DIGEST_MISMATCH");
 const e=zip.length-22;if(zip.readUInt32LE(e)!==0x06054b50||zip.readUInt16LE(e+4)!==0||zip.readUInt16LE(e+6)!==0||zip.readUInt16LE(e+8)!==1||zip.readUInt16LE(e+10)!==1||zip.readUInt16LE(e+20)!==0)throw Error("QA_ARCHIVE_LAYOUT_INVALID");
 const c=zip.readUInt32LE(e+16),size=zip.readUInt32LE(e+12);if(c+size!==e||c+46>e||zip.readUInt32LE(c)!==0x02014b50)throw Error("QA_ARCHIVE_LAYOUT_INVALID");
 const flags=zip.readUInt16LE(c+8),method=zip.readUInt16LE(c+10),compressed=zip.readUInt32LE(c+20),length=zip.readUInt32LE(c+24),names=zip.readUInt16LE(c+28),extra=zip.readUInt16LE(c+30),comment=zip.readUInt16LE(c+32),local=zip.readUInt32LE(c+42);
 if(flags&~2056||![0,8].includes(method)||length>65536||compressed>1048576||c+46+names+extra+comment!==e||zip.subarray(c+46,c+46+names).toString()!=="acceptance.json"||local!==0||zip.readUInt32LE(0)!==0x04034b50)throw Error("QA_ARCHIVE_ENTRY_INVALID");
 const start=30+zip.readUInt16LE(26)+zip.readUInt16LE(28);const descriptor=!!(flags&8);const dataEnd=start+compressed;if((descriptor?(dataEnd+16!==c||zip.readUInt32LE(dataEnd)!==0x08074b50||zip.readUInt32LE(dataEnd+8)!==compressed||zip.readUInt32LE(dataEnd+12)!==length):dataEnd!==c)||zip.readUInt16LE(6)!==flags||zip.readUInt16LE(8)!==method||zip.subarray(30,30+zip.readUInt16LE(26)).toString()!=="acceptance.json")throw Error("QA_ARCHIVE_ENTRY_INVALID");
 const data=zip.subarray(start,dataEnd),out=method===0?data:inflateRawSync(data,{maxOutputLength:65536});if(out.length!==length)throw Error("QA_ARCHIVE_LENGTH_INVALID");return out;
}
/** Call only AFTER existing checks authenticate pinned workflow/run/job identity.
 * apiRequest is the dedicated authenticated GET transport; download sends NO
 * credentials to an operator-pinned HTTPS archive host and follows no redirects. */
export function createRoleAcceptanceArtifactReader(options:{apiRequest:(url:string,init:RequestInit)=>Promise<Response>;download:(url:string,init:RequestInit)=>Promise<Response>;archiveHosts:readonly string[];allowGitHubResultsAzureHosts?:boolean;now?:()=>number}){
 if(!options.archiveHosts.length||options.archiveHosts.some(h=>!/^[-a-z0-9]+\.blob\.core\.windows\.net$/.test(h)))throw Error("QA_ARCHIVE_HOST_REQUIRED");
 return async(input:{runId:number;baseSha:string;headSha:string;signal:AbortSignal})=>{
  input={...input,signal:AbortSignal.any([input.signal,AbortSignal.timeout(30000)])};
  if(!Number.isSafeInteger(input.runId)||input.runId<1)throw Error("QA_RUN_INVALID");sha.parse(input.baseSha);sha.parse(input.headSha);
  const root="https://api.github.com/repos/robertmanzanillag-jpg/blackops";
  const response=await options.apiRequest(`${root}/actions/runs/${input.runId}/artifacts?per_page=100`,{method:"GET",signal:input.signal});if(!response.ok)throw Error("QA_ARTIFACT_LIST_UNAVAILABLE");
  const metadata=await response.text();if(Buffer.byteLength(metadata)>1048576)throw Error("QA_ARTIFACT_METADATA_TOO_LARGE");const listing=JSON.parse(metadata) as any;if(listing.total_count!==listing.artifacts?.length||listing.total_count>100)throw Error("QA_ARTIFACT_LIST_INCOMPLETE");
  const matches=listing.artifacts.filter((a:any)=>a.name==="office-role-acceptance-v1");if(matches.length!==1)throw Error("QA_ARTIFACT_REQUIRED");const a=matches[0];
  if(!Number.isSafeInteger(a.id)||a.id<1||a.expired!==false||a.workflow_run?.id!==input.runId||a.workflow_run?.head_sha!==input.headSha||!/^sha256:[a-f0-9]{64}$/.test(a.digest)||a.size_in_bytes>2097152||a.archive_download_url!==`${root}/actions/artifacts/${a.id}/zip`)throw Error("QA_ARTIFACT_IDENTITY_INVALID");
  const redirect=await options.apiRequest(a.archive_download_url,{method:"GET",signal:input.signal,redirect:"manual"});if(redirect.status!==302)throw Error("QA_ARCHIVE_REDIRECT_REQUIRED");
  const location=verifiedGitHubArtifactLocation(redirect.headers.get("location")||"",options.archiveHosts,options.allowGitHubResultsAzureHosts);
  const archive=await options.download(location.href,{method:"GET",signal:input.signal,redirect:"error",credentials:"omit",headers:{}});if(!archive.ok)throw Error("QA_ARCHIVE_UNAVAILABLE");
  const chunks:Uint8Array[]=[];let total=0;const reader=archive.body?.getReader();if(!reader)throw Error("QA_ARCHIVE_EMPTY");try{for(;;){const r=await reader.read();if(r.done)break;total+=r.value.length;if(total>2097152)throw Error("QA_ARCHIVE_TOO_LARGE");chunks.push(r.value);}}finally{await reader.cancel();}
  const bytes=readAcceptanceZip(Buffer.concat(chunks),a.digest.slice(7)),digest=createHash("sha256").update(bytes).digest("hex");
  const report=verifyRoleAcceptanceReport(bytes,{...input,sha256:digest,now:(options.now||Date.now)()});
  return {regressionScenarioIds:[report.scenarioId,...(hasVerifiedDeadlineRegression(report)?[ROLE_WORK_DEADLINE_ID]:[])],artifactIds:[`github-actions-artifact:${a.id}:${a.digest}`,`sha256:${digest}`],report};
 };
}

/** An old safety pass never substitutes for the independently measured regression. */
export function hasVerifiedDeadlineRegression(report:ReturnType<typeof verifyRoleAcceptanceReport>){
 const before=report.baseline.deadline,after=report.candidate.deadline;
 return report.baseline.passed&&report.candidate.passed&&!!before&&!!after&&!before.passed&&after.passed&&before.cases.every(c=>c.timedOut&&c.elapsedMs>=68000&&!c.assertions.find(a=>a.id==="deadline-respected")!.passed);
}
