import {open,lstat,readdir} from "node:fs/promises";
import path from "node:path";
import {z} from "zod";
import {sourceDigest} from "./office-role-snapshots";
import {canonicalOfficeSourcePath,cycleTotals,CYCLE_REPORT_NAME,DAILY_REPORT_NAME,OFFICE_SOURCE_DOCUMENT_DB_MAX_BYTES,parseStoredOfficeSourceDocument,projectOfficeSourceDocument,type OfficeSourceDocumentKind,type OfficeSourceDocumentSet,type StoredDocument,type StoredOfficeSourceEntry} from "./office-source-documents";
export const WEB_SOURCE_ROLES=["news","news:ny-news","news:miami-news","blackroom-videos","dropshipping","marketing-cmo","clippers"] as const;
// Fixed SQL projection only: never fetch the remote document's media, analytics,
// commands or credentials. Preserve absent keys, explicit null and malformed types.
const boundedLeaf=(expression:string)=>`CASE WHEN octet_length((${expression})::text)<=4096 THEN ${expression} ELSE 'null'::jsonb END`;
function projectRemoteObject(expression:string,fields:Record<string,string>):string {
 return `CASE WHEN jsonb_typeof(${expression})='object' THEN (SELECT COALESCE(jsonb_object_agg(key,CASE key ${Object.entries(fields).map(([key,value])=>`WHEN '${key}' THEN ${value}`).join(" ")} END),'{}'::jsonb) FROM jsonb_each(${expression}) WHERE key IN (${Object.keys(fields).map(key=>`'${key}'`).join(",")})) ELSE ${boundedLeaf(expression)} END`;
}
const remoteTotalsProjection=projectRemoteObject("data->'device'->'queue'->'totals'",Object.fromEntries(["queued","processing","retry","scheduled","completed","cancelled"].map(key=>[key,boundedLeaf(`data->'device'->'queue'->'totals'->'${key}'`)])));
const remoteQueueProjection=projectRemoteObject("data->'device'->'queue'",{updatedAt:boundedLeaf("data->'device'->'queue'->'updatedAt'"),totals:remoteTotalsProjection});
const remoteDeviceProjection=projectRemoteObject("data->'device'",{seenAt:boundedLeaf("data->'device'->'seenAt'"),queue:remoteQueueProjection});
export const BLACKROOM_SOURCE_PROJECTION_SQL=`WITH projected AS (SELECT ${projectRemoteObject("data",{version:boundedLeaf("data->'version'"),updatedAt:boundedLeaf("data->'updatedAt'"),device:remoteDeviceProjection})} AS data FROM blackroom_remote_control WHERE id=$1) SELECT CASE WHEN octet_length(data::text)<=1048576 THEN data ELSE NULL END AS data FROM projected`;
export type WebSourceRole=typeof WEB_SOURCE_ROLES[number];
/** Non-report JSON artifacts that Clippers tools/scripts write into
 * clippers_workspace/reports. Skipped by exact name only: any other unexpected
 * file still makes the report folder invalid evidence. */
export const CLIPPERS_NON_REPORT_FILES:ReadonlySet<string>=new Set(["metricool-approval-report.json","clippers-operational-readiness.json","clippers-external-closeout-pack.json","clippers-external-closeout-proof-todo.json","clippers-external-closeout-operator-queue.json","clippers-external-go-live-audit.json","clippers-external-operator-action-sheet.json","clippers-external-next-work-run.json","clippers-external-closeout-evidence-import-report.json","clippers-external-closeout-repair-work-packet.json","clippers-motivation-ledger.json","marketplace-supply-report.json","marketplace-refresh-report.json"]);
export type SourcePool={query:(sql:string,args?:unknown[])=>Promise<{rows:any[]}>};
const stamp=z.string().datetime({offset:true}),num=z.number().finite().nonnegative();
const lane=z.enum(["miami-news","ny-news"]);
const rawMarketing=z.array(z.object({id:z.string().min(1).max(500),createdAt:stamp,focusClientId:z.string().min(1).max(500),clientsReviewed:num,improvementsQueued:z.array(z.string()),rulesUpdated:z.array(z.string()),safetyBlocks:z.array(z.string())})).max(10000);
const rawRemote=z.object({version:z.literal(1),updatedAt:stamp,device:z.object({seenAt:stamp,queue:z.record(z.unknown())}).nullable()});
const remoteQueue=z.object({updatedAt:stamp,totals:z.object({queued:num,processing:num,retry:num,scheduled:num,completed:num,cancelled:num})});
const metrics=z.record(z.enum(["qualityScore","approvalRequired","autoEligible","supplierScore","clientsReviewed","improvementsQueued","rulesUpdated","safetyBlocks","impressions","views","orders","revenueUsd","spendUsd","plannedClips","likes","comments","shares","saves","queued","processing","retry","scheduled","completed","cancelled","posts","dailyTargetPosts","weeklyTargetClips","backlogPosts","gapToDailyTarget","readyForManual","blocked","draftReady","rightsReview","needsSource"]),num);
export const webSourceRowSchema=z.object({id:z.string().regex(/^[a-f0-9]{64}$/),kind:z.enum(["news_queue","product","supplier","marketing_plan","campaign_metric","clip_plan","clip_cycle","clip_metric","remote_queue"]),state:z.enum(["approval_required","auto_eligible","quarantined","rejected","research","qualified","sample_recommended","launch_ready","blocked","approved_candidate","needs_backup_supplier","recorded","draft_only","auto_after_connection","partial","ready"]),sourceAt:stamp.nullable(),lane:lane.optional(),metrics}).strict();
export type WebSourceRow=z.infer<typeof webSourceRowSchema>;
const provenanceSchema=z.object({kind:z.enum(["news_state","products","suppliers","marketing_learning","social_metrics","clip_reports","clip_metrics","blackroom_remote"]),status:z.enum(["present","missing","invalid","limit"]),sourceAt:stamp.nullable(),heartbeatAt:stamp.optional(),digest:z.string().regex(/^[a-f0-9]{64}$/).nullable(),records:z.number().int().nonnegative(),files:z.number().int().nonnegative(),empty:z.boolean()}).strict();
export const webRoleSourceSchema=z.object({version:z.literal(1),ownerKey:z.string().regex(/^[a-f0-9]{64}$/),role:z.enum(WEB_SOURCE_ROLES),observedAt:stamp,rows:z.array(webSourceRowSchema).max(200),total:z.number().int().nonnegative(),truncated:z.boolean(),provenance:z.array(provenanceSchema).max(20),diagnostics:z.array(z.enum(["SOURCE_MISSING","SOURCE_INVALID","SOURCE_LIMIT","SOURCE_STALE","SOURCE_TIME_UNKNOWN","NO_RECORDS","PARTIAL_COVERAGE","RECORDED_BLOCKS","RETRY_BACKLOG","COLLECTED_METRICS_ONLY","PLANS_NOT_EXECUTION","NO_CURRENT_SESSION_PROOF"])),sourceDigest:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export type WebRoleSource=z.infer<typeof webRoleSourceSchema>;
type Part={provenance:z.infer<typeof provenanceSchema>;rows:WebSourceRow[]};
/** id is the row id digest (sha256 of [kind, rawId]); stored documents
 * already carry it, so raw producer ids never leave the producer. */
const rowAt=(kind:WebSourceRow["kind"],id:string,state:WebSourceRow["state"],sourceAt:string|null,values:Record<string,number>,extra:Partial<WebSourceRow>={}):WebSourceRow=>webSourceRowSchema.parse({id,kind,state,sourceAt,metrics:values,...extra});
const row=(kind:WebSourceRow["kind"],rawId:string,state:WebSourceRow["state"],sourceAt:string|null,values:Record<string,number>,extra:Partial<WebSourceRow>={}):WebSourceRow=>rowAt(kind,sourceDigest([kind,rawId]),state,sourceAt,values,extra);
const last=(dates:Array<string|null>)=>dates.filter((v):v is string=>!!v).sort((a,b)=>Date.parse(b)-Date.parse(a))[0]||null;
export function validateWebRoleSource(value:unknown,owner:string):WebRoleSource {
 const s=webRoleSourceSchema.parse(value),{sourceDigest:hash,...body}=s;
 const kinds:Record<WebSourceRole,string[]>={news:["news_state"],"news:ny-news":["news_state"],"news:miami-news":["news_state"],"blackroom-videos":["blackroom_remote"],dropshipping:["products","suppliers"],"marketing-cmo":["marketing_learning","social_metrics"],clippers:["clip_metrics","clip_reports"]};
 const rowKinds:Record<WebSourceRole,string[]>={news:["news_queue"],"news:ny-news":["news_queue"],"news:miami-news":["news_queue"],"blackroom-videos":["remote_queue"],dropshipping:["product","supplier"],"marketing-cmo":["marketing_plan","campaign_metric"],clippers:["clip_plan","clip_cycle","clip_metric"]};
 const metricKeys:Record<WebSourceRow["kind"],string[]>={news_queue:["qualityScore","approvalRequired","autoEligible"],product:[],supplier:["supplierScore"],marketing_plan:["clientsReviewed","improvementsQueued","rulesUpdated","safetyBlocks"],campaign_metric:["impressions","views","orders","revenueUsd","spendUsd"],clip_plan:["plannedClips"],clip_cycle:Object.keys(cycleTotals.shape),clip_metric:["views","likes","comments","shares","saves"],remote_queue:["queued","processing","retry","scheduled","completed","cancelled"]};
 if(s.rows.some(r=>!rowKinds[s.role].includes(r.kind) || Object.keys(r.metrics).sort().join(",")!==metricKeys[r.kind].slice().sort().join(",") || (r.kind==="news_queue" && (!r.lane || (s.role!=="news" && s.role!==`news:${r.lane}`)))))throw new Error("Web source row capability mismatch");
 if(!owner.trim() || s.ownerKey!==sourceDigest(owner) || hash!==sourceDigest(body) || s.rows.length!==Math.min(s.total,200) || s.truncated!==(s.total>s.rows.length) || new Set(s.rows.map(r=>r.id)).size!==s.rows.length || !kinds[s.role].every(k=>s.provenance.some(p=>p.kind===k)) || s.provenance.some(p=>!kinds[s.role].includes(p.kind) || (p.status==="present" ? !p.digest || p.empty!==(p.records===0) : p.digest!==null || p.records!==0 || p.empty)))throw new Error("Invalid web source provenance");
 const now=Date.parse(s.observedAt);if(s.rows.some(r=>r.sourceAt && Date.parse(r.sourceAt)>now+30000) || s.provenance.some(p=>(p.sourceAt && Date.parse(p.sourceAt)>now+30000)||(p.heartbeatAt && Date.parse(p.heartbeatAt)>now+30000)))throw new Error("Future web source");
 return s;
}
export async function assertWebSourceOwner(pool:SourcePool,owner:string,configuredOwner:string) {
 if(!owner.trim() || owner!==configuredOwner.trim())throw new Error("Configured owner required");
 const found=await pool.query("SELECT id FROM users WHERE id=$1",[owner]);if(found.rows.length!==1 || found.rows[0].id!==owner)throw new Error("Canonical owner absent");
}

/** Runs on the source web host. Never creates directories/defaults or invokes
 * agents, providers, publishers, OAuth readers, or mutable status getters.
 * With files:false (the office worker's database-only observation) no file or
 * directory is touched: every file-backed part is reported missing, never
 * present, so only database-backed provenance can complete an audit.
 * sourceDocuments (office_source_documents) takes precedence per document
 * kind; files are read only for kinds without a durable copy, and only when
 * files are allowed (the web host). */
export async function readWebRoleSources(options:{pool:SourcePool;owner:string;configuredOwner:string;root:string;env?:Record<string,string|undefined>;now?:number;marketingLearning?:()=>Promise<unknown|null>;sourceDocuments?:()=>Promise<OfficeSourceDocumentSet|null>;files?:boolean}):Promise<WebRoleSource[]> {
 await assertWebSourceOwner(options.pool,options.owner,options.configuredOwner);
 const now=options.now ?? Date.now();if(!Number.isFinite(now))throw new Error("Invalid observation clock");
 const env=options.env||{},root=path.resolve(options.root);let fileCount=0,bytes=0;
 const locate=(key:string,fallback:string)=>path.resolve(env[key]||path.join(root,fallback));
 const empty=(kind:Part["provenance"]["kind"],status:Part["provenance"]["status"]):Part=>({provenance:{kind,status,sourceAt:null,digest:null,records:0,files:0,empty:false},rows:[]});
 async function file(kind:Part["provenance"]["kind"],filename:string,project:(v:unknown)=>{rows:WebSourceRow[];sourceAt:string|null}):Promise<Part>{
  if(options.files===false)return empty(kind,"missing");
  try{
   const stat=await lstat(filename);if(!stat.isFile() || stat.isSymbolicLink())return empty(kind,"invalid");
   if(fileCount>=20 || stat.size>1048576-bytes)return empty(kind,"limit");
   fileCount++;const handle=await open(filename,"r");let data:Buffer;
   try{const limit=1048576-bytes;const buffer=Buffer.alloc(limit+1);const result=await handle.read(buffer,0,limit+1,0);data=buffer.subarray(0,result.bytesRead);}finally{await handle.close();}
   bytes+=data.length;if(bytes>1048576)return empty(kind,"limit");
   const projected=project(JSON.parse(data.toString("utf8")));
   if(projected.sourceAt && Date.parse(projected.sourceAt)>now+30000 || projected.rows.some(r=>r.sourceAt && Date.parse(r.sourceAt)>now+30000))return empty(kind,"invalid");
   return {rows:projected.rows,provenance:{kind,status:"present",sourceAt:projected.sourceAt,digest:sourceDigest(projected),records:projected.rows.length,files:1,empty:projected.rows.length===0}};
  }catch(e){return empty(kind,(e as NodeJS.ErrnoException).code==="ENOENT"?"missing":"invalid");}
 }
 // Durable copies (office_source_documents) win over the host's ephemeral
 // files. A failed database read is invalid evidence, never a file fallback.
 let documents:OfficeSourceDocumentSet|null=null,documentsFailed=false,documentBytes=0;
 if(options.sourceDocuments){try{documents=await options.sourceDocuments();}catch{documentsFailed=true;}}
 const fresh=(projected:{rows:WebSourceRow[];sourceAt:string|null})=>!(projected.sourceAt && Date.parse(projected.sourceAt)>now+30000 || projected.rows.some(r=>r.sourceAt && Date.parse(r.sourceAt)>now+30000));
 function fromDocument<K extends OfficeSourceDocumentKind>(kind:Part["provenance"]["kind"],documentKind:K,item:StoredOfficeSourceEntry,toRows:(x:StoredDocument<K>)=>{rows:WebSourceRow[];sourceAt:string|null}):Part{
  if(item.status!=="present")return empty(kind,item.status);
  if(item.oversized || item.document===null || fileCount>=20)return empty(kind,"limit");
  const size=Buffer.byteLength(JSON.stringify(item.document));if(documentBytes+size>2*OFFICE_SOURCE_DOCUMENT_DB_MAX_BYTES)return empty(kind,"limit");
  fileCount++;documentBytes+=size;
  try{const projected=toRows(parseStoredOfficeSourceDocument(documentKind,item.document,item.key));if(!fresh(projected))return empty(kind,"invalid");
   return {rows:projected.rows,provenance:{kind,status:"present",sourceAt:projected.sourceAt,digest:sourceDigest(projected),records:projected.rows.length,files:0,empty:projected.rows.length===0}};}
  catch{return empty(kind,"invalid");}
 }
 async function source<K extends Exclude<OfficeSourceDocumentKind,"clip_report">>(kind:Part["provenance"]["kind"],documentKind:K,toRows:(x:StoredDocument<K>)=>{rows:WebSourceRow[];sourceAt:string|null}):Promise<Part>{
  if(documentsFailed)return empty(kind,"invalid");
  const item=documents?.singletons[documentKind];if(item)return fromDocument(kind,documentKind,item,toRows);
  return file(kind,canonicalOfficeSourcePath(documentKind,{root,env}),v=>toRows(projectOfficeSourceDocument(documentKind,v,{owner:options.owner})));
 }
 const reportRows=(x:StoredDocument<"clip_report">)=>x.type==="cycle"?{sourceAt:x.createdAt,rows:[rowAt("clip_cycle",x.id,x.status,x.createdAt,x.totals)]}:{sourceAt:x.createdAt,rows:[rowAt("clip_plan",x.id,x.publishMode,x.createdAt,{plannedClips:x.plannedClips})]};
 const news=await source("news_state","news_state",x=>({sourceAt:x.lastRunAt||x.updatedAt,rows:x.queue.map(q=>rowAt("news_queue",q.id,q.status,q.createdAt,{qualityScore:q.qualityScore,approvalRequired:Number(q.approvalRequired),autoEligible:Number(q.autoEligible)},{lane:q.lane}))}));
 const products=await source("products","products",x=>({sourceAt:last(x.map(q=>q.updatedAt)),rows:x.map(q=>rowAt("product",q.id,q.status,q.updatedAt,{}))}));
 const suppliers=await source("suppliers","suppliers",x=>({sourceAt:last(x.map(q=>q.updatedAt)),rows:x.map(q=>rowAt("supplier",q.id,q.status,q.updatedAt,{supplierScore:q.score}))}));
 const projectLearning=(v:unknown)=>{const x=rawMarketing.parse(v);return {sourceAt:last(x.map(q=>q.createdAt)),rows:x.map(q=>row("marketing_plan",q.id,"recorded",q.createdAt,{clientsReviewed:q.clientsReviewed,improvementsQueued:q.improvementsQueued.length,rulesUpdated:q.rulesUpdated.length,safetyBlocks:q.safetyBlocks.length}))};};
 let learning:Part;
 if(options.marketingLearning){
  try{const raw=await options.marketingLearning();if(raw===null)learning=empty("marketing_learning","missing");else if(Buffer.byteLength(JSON.stringify(raw))>1000000)learning=empty("marketing_learning","limit");else{const projected=projectLearning(raw);if(projected.rows.some(row=>row.sourceAt&&Date.parse(row.sourceAt)>now+30000))throw Error("Future marketing source");learning={rows:projected.rows,provenance:{kind:"marketing_learning",status:"present",sourceAt:projected.sourceAt,digest:sourceDigest(raw),records:projected.rows.length,files:0,empty:projected.rows.length===0}};}}
  catch{learning=empty("marketing_learning","invalid");}
 }else learning=await file("marketing_learning",locate("MARKETING_COMMAND_CENTER_LEARNING_PATH","marketing_command_center_data/learning-runs.json"),projectLearning);
 const social=await source("social_metrics","social_metrics",x=>({sourceAt:last(x.map(q=>q.createdAt)),rows:x.map(q=>rowAt("campaign_metric",q.id,"recorded",q.createdAt,{impressions:q.impressions,views:q.views,orders:q.orders,revenueUsd:q.revenueUsd,spendUsd:q.spendUsd}))}));
 const clipMetrics=await source("clip_metrics","clip_metrics",x=>({sourceAt:x.generatedAt,rows:x.records.map(q=>rowAt("clip_metric",q.id,"recorded",x.generatedAt,{views:q.views,likes:q.likes,comments:q.comments,shares:q.shares,saves:q.saves}))}));
 const reports:Part[]=[];
 if(documentsFailed)reports.push(empty("clip_reports","invalid"));
 else if(documents && documents.reports.length){
  // Durable reports replace the directory listing entirely (same slot budget).
  const candidates=documents.reports.slice().sort((a,b)=>b.key.replace(/^automation-cycle-/,"").localeCompare(a.key.replace(/^automation-cycle-/,"")));
  const reportLimit=Math.min(Math.max(0,20-fileCount),18);
  for(const item of candidates.slice(0,reportLimit))reports.push(fromDocument("clip_reports","clip_report",item,reportRows));
  if(documents.reportTotal>reportLimit)reports.push(empty("clip_reports","limit"));
 }
 else if(options.files===false)reports.push(empty("clip_reports","missing"));
 else try{
  // Known non-report artifacts that other Clippers tools keep in this folder
  // are skipped by exact name; any other unexpected file still marks it invalid.
  const dir=path.join(root,"clippers_workspace/reports"),entries=(await readdir(dir,{withFileTypes:true})).filter(e=>e.isFile()&&e.name.endsWith(".json")&&!CLIPPERS_NON_REPORT_FILES.has(e.name)).sort((a,b)=>b.name.replace(/^automation-cycle-/,"").localeCompare(a.name.replace(/^automation-cycle-/,"")));
  const candidates=entries.filter(e=>/^(?:automation-cycle-)?\d{4}-/.test(e.name));
  if(candidates.length!==entries.length)reports.push(empty("clip_reports","invalid"));
  // Reserve provenance for metrics, unknown contracts and the limit marker.
  const reportLimit=Math.min(Math.max(0,20-fileCount),18-reports.length);
  for(const entry of candidates.slice(0,reportLimit)){
   if(!DAILY_REPORT_NAME.test(entry.name)&&!CYCLE_REPORT_NAME.test(entry.name)){reports.push(empty("clip_reports","invalid"));continue;}
   reports.push(await file("clip_reports",path.join(dir,entry.name),v=>reportRows(projectOfficeSourceDocument("clip_report",v,{owner:options.owner,key:entry.name}))));
  }
  if(candidates.length>reportLimit)reports.push(empty("clip_reports","limit"));if(!entries.length)reports.push({rows:[],provenance:{kind:"clip_reports",status:"present",sourceAt:null,digest:sourceDigest([]),records:0,files:0,empty:true}});
 }catch(error){reports.push(empty("clip_reports",(error as NodeJS.ErrnoException).code==="ENOENT"?"missing":"invalid"));}
 let remote=empty("blackroom_remote","missing");
 try{const result=await options.pool.query(BLACKROOM_SOURCE_PROJECTION_SQL,["blackroom-primary"]);if(result.rows.length){const x=rawRemote.parse(result.rows[0].data);if(x.device){const parsedQueue=remoteQueue.safeParse(x.device.queue);if(!parsedQueue.success){const invalidValue=parsedQueue.error.issues.some(issue=>issue.path.reduce<any>((value,key)=>value?.[key],x.device!.queue)!==undefined);const queueTime=x.device.queue.updatedAt;const futureQueue=typeof queueTime==="string"&&Date.parse(queueTime)>now+30000;remote=empty("blackroom_remote",invalidValue||futureQueue?"invalid":"missing");remote.provenance.heartbeatAt=x.device.seenAt;if([x.updatedAt,x.device.seenAt].some(t=>Date.parse(t)>now+30000))throw new Error("Future remote source");}else{const q=parsedQueue.data;if([x.updatedAt,x.device.seenAt].some(t=>Date.parse(t)>now+30000))throw new Error("Future remote source");if(Date.parse(q.updatedAt)>now+30000){remote=empty("blackroom_remote","invalid");remote.provenance.heartbeatAt=x.device.seenAt;}else remote={rows:[row("remote_queue","blackroom-primary","recorded",q.updatedAt,q.totals)],provenance:{kind:"blackroom_remote",status:"present",sourceAt:q.updatedAt,heartbeatAt:x.device.seenAt,digest:sourceDigest({seenAt:x.device.seenAt,queueAt:q.updatedAt,totals:q.totals}),records:1,files:0,empty:false}};}}else{if(Date.parse(x.updatedAt)>now+30000)throw new Error("Future remote source");remote={rows:[],provenance:{kind:"blackroom_remote",status:"present",sourceAt:x.updatedAt,digest:sourceDigest({updatedAt:x.updatedAt,device:null}),records:0,files:0,empty:true}};}}}catch{remote=empty("blackroom_remote","invalid");}
 const compose=(role:WebSourceRole,parts:Part[],filter?:(r:WebSourceRow)=>boolean):WebRoleSource=>{
  // Reject every implicated part rather than silently merging conflicting IDs.
  // Keep other roles exportable and mark affected coverage explicitly invalid.
  const counts=new Map<string,number>();
  for(const part of parts)for(const item of part.rows.filter(filter||(()=>true)))counts.set(item.id,(counts.get(item.id)||0)+1);
  parts=parts.map(part=>part.rows.some(item=>(!filter||filter(item))&&(counts.get(item.id)||0)>1)?empty(part.provenance.kind,"invalid"):part);
  const all=parts.flatMap(p=>p.rows).filter(filter||(()=>true)),selected=all.slice(0,200),diagnostics:WebRoleSource["diagnostics"]=[];
  if([...counts.values()].some(count=>count>1))diagnostics.push("PARTIAL_COVERAGE");
  for(const p of parts){if(p.provenance.status!=="present")diagnostics.push(p.provenance.status==="missing"?"SOURCE_MISSING":p.provenance.status==="limit"?"SOURCE_LIMIT":"SOURCE_INVALID");else if(!p.provenance.sourceAt)diagnostics.push("SOURCE_TIME_UNKNOWN");else if(now-Date.parse(p.provenance.sourceAt)>86400000)diagnostics.push("SOURCE_STALE");}
  if(!all.length)diagnostics.push("NO_RECORDS");if(all.length>selected.length)diagnostics.push("PARTIAL_COVERAGE");if(all.some(r=>["blocked","quarantined","rejected"].includes(r.state)))diagnostics.push("RECORDED_BLOCKS");if(all.some(r=>(r.metrics.retry||0)>0))diagnostics.push("RETRY_BACKLOG");
  if(["marketing-cmo","clippers"].includes(role))diagnostics.push("PLANS_NOT_EXECUTION","COLLECTED_METRICS_ONLY");if(role==="blackroom-videos")diagnostics.push("NO_CURRENT_SESSION_PROOF");
  const body={version:1 as const,ownerKey:sourceDigest(options.owner),role,observedAt:new Date(now).toISOString(),rows:selected,total:all.length,truncated:all.length>selected.length,provenance:parts.map(p=>p.provenance).slice(0,20),diagnostics:[...new Set(diagnostics)]};
  return validateWebRoleSource({...body,sourceDigest:sourceDigest(body)},options.owner);
 };
 return [compose("news",[news]),compose("news:ny-news",[news],r=>r.lane==="ny-news"),compose("news:miami-news",[news],r=>r.lane==="miami-news"),compose("blackroom-videos",[remote]),compose("dropshipping",[products,suppliers]),compose("marketing-cmo",[learning,social]),compose("clippers",[clipMetrics,...reports])];
}

/** PC-side interpretation is a source audit, never training or publication. */
export function auditWebRoleSource(value:unknown,owner:string,now=Date.now()) {
 const source=validateWebRoleSource(value,owner),age=now-Date.parse(source.observedAt);
 if(!Number.isFinite(now)||age< -30000||age>300000)throw new Error("Export observation expired");
 const counts:Record<string,number>={};for(const r of source.rows)counts[`${r.kind}:${r.state}`]=(counts[`${r.kind}:${r.state}`]||0)+1;
 // Repeated metric snapshots may overlap. Do not sum them into claimed total
 // views, spend, revenue or profit without a verified measurement window.
 const metrics:Record<string,number>={};for(const r of source.rows){if(["campaign_metric","clip_metric","clip_cycle"].includes(r.kind)){metrics[`${r.kind}:observations`]=(metrics[`${r.kind}:observations`]||0)+1;continue;}for(const [key,value] of Object.entries(r.metrics)){if(["qualityScore","supplierScore"].includes(key))continue;const name=`${r.kind}:${key}`;metrics[name]=(metrics[name]||0)+value;}}
 if(Object.values(metrics).some(v=>!Number.isFinite(v)))throw new Error("Invalid aggregate");
 return {role:source.role,capability:"exported-source-audit-v1",status:source.provenance.some(p=>p.status!=="present")?"blocked":"completed",sourceDigest:source.sourceDigest,selected:source.rows.length,total:source.total,completeCoverage:!source.truncated && !source.diagnostics.includes("PARTIAL_COVERAGE") && !source.diagnostics.includes("SOURCE_LIMIT"),counts,metrics,diagnostics:source.diagnostics,scope:"Registros exportados del host propietario; no acredita publicación, conexión actual, beneficio, entrenamiento ni reemplazo."};
}
