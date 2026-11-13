import path from "node:path";
import {z} from "zod";
import {sourceDigest} from "./office-role-snapshots";

/** Owner-scoped, durable copies of the web-host source files the office reads
 * (dropshipping products/suppliers/social metrics, local-news state, Clippers
 * metrics summary and daily/cycle reports). Production runs on an autoscaled
 * host whose disk is ephemeral, so the files alone are lost on every restart
 * and are never visible to the cloud worker.
 *
 * One generic table keyed by (owner_key, kind, doc_key): every kind shares the
 * same lifecycle (whole-document replace by the single producer, guarded by a
 * monotonic written_at), the same bounds and the same reader, so per-kind
 * tables would only duplicate DDL. doc_key is '' for singleton documents and
 * the report filename for Clippers reports.
 *
 * Only the projection the office audit needs is stored: ids, timestamps, enum
 * states and numeric counters. Copy, URLs, media, captions, customer/supplier
 * details, posts, tokens and summaries are never persisted. */
export const OFFICE_SOURCE_DOCUMENT_KINDS=["news_state","products","suppliers","social_metrics","clip_metrics","clip_report"] as const;
export type OfficeSourceDocumentKind=typeof OFFICE_SOURCE_DOCUMENT_KINDS[number];
export type SourceQuery={query:(sql:string,args?:unknown[])=>Promise<{rows:any[]}>};
/** Writer bound (JSON.stringify bytes). The DB/reader bound is wider because
 * jsonb text output adds whitespace. */
export const OFFICE_SOURCE_DOCUMENT_MAX_BYTES=1_000_000;
export const OFFICE_SOURCE_DOCUMENT_DB_MAX_BYTES=2_097_152;
/** Retained Clippers reports per owner (the reader selects at most 18). */
export const OFFICE_SOURCE_REPORT_RETENTION=60;
export const OFFICE_SOURCE_REPORT_READ_LIMIT=64;
const REPORT_KEY_SQL="^(automation-cycle-)?[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{3}Z\\.json$";
export const DAILY_REPORT_NAME=/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/;
export const CYCLE_REPORT_NAME=/^automation-cycle-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/;

/** Additive, reviewed DDL. Never executed at startup or request time; applied
 * only by script/office-source-documents-migrate.ts --apply. */
export const OFFICE_SOURCE_DOCUMENT_SCHEMA_SQL=`CREATE TABLE IF NOT EXISTS office_source_documents(
 owner_key text NOT NULL CHECK (owner_key ~ '^[a-f0-9]{64}$'),
 kind text NOT NULL CHECK (kind IN (${OFFICE_SOURCE_DOCUMENT_KINDS.map(k=>`'${k}'`).join(",")})),
 doc_key text NOT NULL CHECK (char_length(doc_key)<=128),
 status text NOT NULL CHECK (status IN ('present','invalid','limit')),
 document jsonb NULL,
 digest text NULL CHECK (digest IS NULL OR digest ~ '^[a-f0-9]{64}$'),
 written_at timestamptz NOT NULL,
 revision bigint NOT NULL DEFAULT 1 CHECK (revision>=1),
 CHECK ((status='present')=(document IS NOT NULL AND digest IS NOT NULL)),
 CHECK (status='present' OR (document IS NULL AND digest IS NULL)),
 CHECK (document IS NULL OR octet_length(document::text)<=${OFFICE_SOURCE_DOCUMENT_DB_MAX_BYTES}),
 CHECK ((kind='clip_report' AND doc_key ~ '${REPORT_KEY_SQL}') OR (kind<>'clip_report' AND doc_key='')),
 PRIMARY KEY(owner_key,kind,doc_key));`;

const stamp=z.string().datetime({offset:true}),id=z.string().min(1).max(500),num=z.number().finite().nonnegative();
const lane=z.enum(["miami-news","ny-news"]),newsState=z.enum(["approval_required","auto_eligible","quarantined","rejected"]);
const productState=z.enum(["research","qualified","approval_required","sample_recommended","launch_ready","blocked"]),supplierState=z.enum(["approved_candidate","needs_backup_supplier","blocked"]);
const publishMode=z.enum(["draft_only","approval_required","auto_after_connection"]),cycleState=z.enum(["blocked","partial","ready"]);
/** Producer (file) shapes. Extra keys are allowed and dropped by projection. */
export const rawNews=z.object({version:z.literal(1),updatedAt:stamp,lastRunAt:stamp.nullable(),queue:z.array(z.object({id,lane,status:newsState,createdAt:stamp,approvalRequired:z.boolean(),autoEligible:z.boolean(),qualityScore:num})).max(10000)});
export const rawProducts=z.array(z.object({id,updatedAt:stamp,status:productState})).max(10000);
export const rawSuppliers=z.array(z.object({id,updatedAt:stamp,status:supplierState,score:num})).max(10000);
export const rawSocial=z.array(z.object({id,createdAt:stamp,campaignId:z.string().max(500),postId:id,platform:z.enum(["tiktok","instagram","facebook","youtube_shorts","pinterest","email","manual"]),impressions:num,views:num,orders:num,revenueUsd:num,spendUsd:num})).max(10000);
export const rawClipReport=z.object({id,userId:id,createdAt:stamp,publishMode,plannedClips:z.array(z.unknown()).max(10000)});
export const cycleTotals=z.object({posts:num.int(),dailyTargetPosts:num.int(),weeklyTargetClips:num.int(),backlogPosts:num.int(),gapToDailyTarget:num.int(),scheduled:num.int(),readyForManual:num.int(),blocked:num.int(),draftReady:num.int(),rightsReview:num.int(),needsSource:num.int()});
export const rawClipCycle=z.object({id,userId:id,createdAt:stamp,automation:z.object({id,createdAt:stamp,status:cycleState,totals:cycleTotals,posts:z.array(z.unknown()).max(10000)})});
export const rawClipMetrics=z.object({generatedAt:stamp.nullable(),records:z.array(z.object({id,accountId:id,clipId:id,publishedAt:stamp.nullable(),views:num,likes:num,comments:num,shares:num,saves:num})).max(10000)});

/** Stored projections: strict, so nothing beyond the audited fields survives.
 * Producer ids (which may embed URLs, names or emails) are replaced by the
 * exact row id the export already uses: sha256 of [rowKind, rawId]. */
const rowId=z.string().regex(/^[a-f0-9]{64}$/);
export const sourceRowId=(rowKind:string,raw:string)=>sourceDigest([rowKind,raw]);
const storedNews=z.object({version:z.literal(1),updatedAt:stamp,lastRunAt:stamp.nullable(),queue:z.array(z.object({id:rowId,lane,status:newsState,createdAt:stamp,approvalRequired:z.boolean(),autoEligible:z.boolean(),qualityScore:num}).strict()).max(10000)}).strict();
const storedProducts=z.array(z.object({id:rowId,updatedAt:stamp,status:productState}).strict()).max(10000);
const storedSuppliers=z.array(z.object({id:rowId,updatedAt:stamp,status:supplierState,score:num}).strict()).max(10000);
const storedSocial=z.array(z.object({id:rowId,createdAt:stamp,impressions:num,views:num,orders:num,revenueUsd:num,spendUsd:num}).strict()).max(10000);
const storedClipMetrics=z.object({generatedAt:stamp.nullable(),records:z.array(z.object({id:rowId,views:num,likes:num,comments:num,shares:num,saves:num}).strict()).max(10000)}).strict();
const storedDaily=z.object({type:z.literal("daily"),id,createdAt:stamp,publishMode,plannedClips:num.int().max(10000)}).strict();
const storedCycle=z.object({type:z.literal("cycle"),id,createdAt:stamp,status:cycleState,totals:cycleTotals.strict()}).strict();
const storedReport=z.discriminatedUnion("type",[storedDaily,storedCycle]);
export const storedDocumentSchemas={news_state:storedNews,products:storedProducts,suppliers:storedSuppliers,social_metrics:storedSocial,clip_metrics:storedClipMetrics,clip_report:storedReport} as const;
export type StoredDocument<K extends OfficeSourceDocumentKind>=z.infer<typeof storedDocumentSchemas[K]>;

function reportType(key:string):"daily"|"cycle" {
 if(DAILY_REPORT_NAME.test(key))return "daily";if(CYCLE_REPORT_NAME.test(key))return "cycle";
 throw new Error("Invalid report name");
}
/** Validates a producer document exactly as the file reader does and returns
 * the minimal stored projection. Throws on any contract violation. */
export function projectOfficeSourceDocument<K extends OfficeSourceDocumentKind>(kind:K,raw:unknown,context:{owner:string;key?:string}):StoredDocument<K> {
 const key=context.key??"";
 if(kind!=="clip_report" && key!=="")throw new Error("Unexpected document key");
 let value:unknown;
 switch(kind){
  case "news_state":{const x=rawNews.parse(raw);value={version:1,updatedAt:x.updatedAt,lastRunAt:x.lastRunAt,queue:x.queue.map(q=>({id:sourceRowId("news_queue",q.id),lane:q.lane,status:q.status,createdAt:q.createdAt,approvalRequired:q.approvalRequired,autoEligible:q.autoEligible,qualityScore:q.qualityScore}))};break;}
  case "products":value=rawProducts.parse(raw).map(q=>({id:sourceRowId("product",q.id),updatedAt:q.updatedAt,status:q.status}));break;
  case "suppliers":value=rawSuppliers.parse(raw).map(q=>({id:sourceRowId("supplier",q.id),updatedAt:q.updatedAt,status:q.status,score:q.score}));break;
  case "social_metrics":value=rawSocial.parse(raw).map(q=>({id:sourceRowId("campaign_metric",q.id),createdAt:q.createdAt,impressions:q.impressions,views:q.views,orders:q.orders,revenueUsd:q.revenueUsd,spendUsd:q.spendUsd}));break;
  case "clip_metrics":{const x=rawClipMetrics.parse(raw);value={generatedAt:x.generatedAt,records:x.records.map(q=>({id:sourceRowId("clip_metric",q.id),views:q.views,likes:q.likes,comments:q.comments,shares:q.shares,saves:q.saves}))};break;}
  case "clip_report":{
   if(reportType(key)==="cycle"){const x=rawClipCycle.parse(raw);if(x.userId!==context.owner || x.id!==x.automation.id || x.createdAt!==x.automation.createdAt || x.automation.posts.length!==x.automation.totals.posts)throw new Error("Invalid cycle report");value={type:"cycle",id:sourceRowId("clip_cycle",x.id),createdAt:x.createdAt,status:x.automation.status,totals:{...x.automation.totals}};}
   else{const x=rawClipReport.parse(raw);if(x.userId!==context.owner)throw new Error("Foreign report");value={type:"daily",id:sourceRowId("clip_plan",x.id),createdAt:x.createdAt,publishMode:x.publishMode,plannedClips:x.plannedClips.length};}
   break;
  }
  default:throw new Error("Unknown source document kind");
 }
 return parseStoredOfficeSourceDocument(kind,value,key);
}
/** Strict re-validation of a stored projection (reader side). */
export function parseStoredOfficeSourceDocument<K extends OfficeSourceDocumentKind>(kind:K,value:unknown,key=""):StoredDocument<K> {
 if(!(OFFICE_SOURCE_DOCUMENT_KINDS as readonly string[]).includes(kind))throw new Error("Unknown source document kind");
 const parsed=storedDocumentSchemas[kind].parse(value) as StoredDocument<K>;
 if(kind==="clip_report"){if((parsed as StoredDocument<"clip_report">).type!==reportType(key))throw new Error("Report type mismatch");}
 else if(key!=="")throw new Error("Unexpected document key");
 return parsed;
}

export type PreparedOfficeSourceDocument={kind:OfficeSourceDocumentKind;key:string;status:"present"|"invalid"|"limit";document:unknown|null;digest:string|null};
/** Never throws for a bad producer document: the durable copy records the
 * same invalid/limit state the file reader would report, so an old valid
 * document can never mask a newer corrupt or oversized one. */
export function prepareOfficeSourceDocument(kind:OfficeSourceDocumentKind,raw:unknown,context:{owner:string;key?:string}):PreparedOfficeSourceDocument {
 const key=context.key??"";
 if(!(OFFICE_SOURCE_DOCUMENT_KINDS as readonly string[]).includes(kind))throw new Error("Unknown source document kind");
 if(kind==="clip_report" ? !DAILY_REPORT_NAME.test(key)&&!CYCLE_REPORT_NAME.test(key) : key!=="")throw new Error("Invalid document key");
 let document:unknown;
 try{document=projectOfficeSourceDocument(kind,raw,context);}catch{return {kind,key,status:"invalid",document:null,digest:null};}
 if(Buffer.byteLength(JSON.stringify(document))>OFFICE_SOURCE_DOCUMENT_MAX_BYTES)return {kind,key,status:"limit",document:null,digest:null};
 return {kind,key,status:"present",document,digest:sourceDigest(document)};
}

/** Same locations as the web host's file reader; write-through only mirrors
 * these canonical files, never a test or ad-hoc path. */
export function canonicalOfficeSourcePath(kind:OfficeSourceDocumentKind,options:{root:string;env?:Record<string,string|undefined>;key?:string}):string {
 const env=options.env||{},root=path.resolve(options.root),locate=(name:string,fallback:string)=>path.resolve(env[name]||path.join(root,fallback));
 switch(kind){
  case "news_state":return path.join(locate("CLIPPERS_LOCAL_NEWS_WORKSPACE","clippers_workspace/local-news"),"state.json");
  case "products":return locate("DROPSHIPPING_PRODUCTS_PATH","dropshipping_engine_data/products.json");
  case "suppliers":return locate("DROPSHIPPING_SUPPLIERS_PATH","dropshipping_engine_data/suppliers.json");
  case "social_metrics":return locate("DROPSHIPPING_SOCIAL_METRICS_PATH","dropshipping_engine_data/social_metrics.json");
  case "clip_metrics":return path.join(root,"clippers_workspace/metrics/metrics-summary.json");
  case "clip_report":if(!options.key || path.basename(options.key)!==options.key)throw new Error("Invalid document key");return path.join(root,"clippers_workspace/reports",options.key);
 }
}

function ownerKey(owner:string){if(!owner.trim()||owner.length>200)throw new Error("Configured owner required");return sourceDigest(owner);}
async function assertOwner(db:SourceQuery,owner:string){ownerKey(owner);const found=await db.query("SELECT id FROM users WHERE id=$1",[owner]);if(found.rows.length!==1 || found.rows[0].id!==owner)throw new Error("Canonical owner absent");}

const UPSERT_SQL=`INSERT INTO office_source_documents(owner_key,kind,doc_key,status,document,digest,written_at,revision) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,1) ON CONFLICT(owner_key,kind,doc_key) DO UPDATE SET status=EXCLUDED.status,document=EXCLUDED.document,digest=EXCLUDED.digest,written_at=EXCLUDED.written_at,revision=office_source_documents.revision+1 WHERE office_source_documents.written_at<EXCLUDED.written_at AND (office_source_documents.status,office_source_documents.digest) IS DISTINCT FROM (EXCLUDED.status,EXCLUDED.digest) RETURNING revision`;
const REPORT_ORDER=`regexp_replace(doc_key,'^automation-cycle-','') COLLATE "C" DESC,doc_key COLLATE "C" DESC`;
const PRUNE_SQL=`DELETE FROM office_source_documents WHERE owner_key=$1 AND kind='clip_report' AND doc_key IN (SELECT doc_key FROM office_source_documents WHERE owner_key=$1 AND kind='clip_report' ORDER BY ${REPORT_ORDER} OFFSET ${OFFICE_SOURCE_REPORT_RETENTION})`;

/** Guarded whole-document upsert. A write older than (or identical to) the
 * stored one is a no-op, never an overwrite, so out-of-order writers from
 * several autoscaled instances cannot roll a document back. */
export async function persistOfficeSourceDocument(db:SourceQuery,owner:string,prepared:PreparedOfficeSourceDocument,writtenAt:string,now=Date.now()):Promise<{written:boolean;revision:number|null}> {
 await assertOwner(db,owner);
 const at=Date.parse(writtenAt);if(!stamp.safeParse(writtenAt).success || !Number.isFinite(at) || at>now+30000)throw new Error("Invalid document write time");
 const checked=prepared.status==="present" ? prepareFromStored(prepared) : prepared;
 if(checked.status!=="present" && (checked.document!==null || checked.digest!==null))throw new Error("Invalid document state");
 const result=await db.query(UPSERT_SQL,[ownerKey(owner),checked.kind,checked.key,checked.status,checked.document===null?null:JSON.stringify(checked.document),checked.digest,new Date(at).toISOString()]);
 if(checked.kind==="clip_report" && result.rows.length)await db.query(PRUNE_SQL,[ownerKey(owner)]);
 return {written:result.rows.length===1,revision:result.rows.length?Number(result.rows[0].revision):null};
}
function prepareFromStored(prepared:PreparedOfficeSourceDocument):PreparedOfficeSourceDocument {
 const document=parseStoredOfficeSourceDocument(prepared.kind,prepared.document,prepared.key);
 if(Buffer.byteLength(JSON.stringify(document))>OFFICE_SOURCE_DOCUMENT_MAX_BYTES || prepared.digest!==sourceDigest(document))throw new Error("Invalid document state");
 return {...prepared,document};
}

export type StoredOfficeSourceEntry={kind:OfficeSourceDocumentKind;key:string;status:"present"|"invalid"|"limit";document:unknown|null;oversized:boolean};
export type OfficeSourceDocumentSet={singletons:Partial<Record<Exclude<OfficeSourceDocumentKind,"clip_report">,StoredOfficeSourceEntry>>;reports:StoredOfficeSourceEntry[];reportTotal:number};
const SINGLETON_SQL=`SELECT kind,doc_key,status,CASE WHEN document IS NOT NULL AND octet_length(document::text)<=${OFFICE_SOURCE_DOCUMENT_DB_MAX_BYTES} THEN document ELSE NULL END AS document,(document IS NOT NULL AND octet_length(document::text)>${OFFICE_SOURCE_DOCUMENT_DB_MAX_BYTES}) AS oversized FROM office_source_documents WHERE owner_key=$1 AND kind<>'clip_report' ORDER BY kind`;
const REPORT_SQL=`SELECT kind,doc_key,status,CASE WHEN document IS NOT NULL AND octet_length(document::text)<=${OFFICE_SOURCE_DOCUMENT_DB_MAX_BYTES} THEN document ELSE NULL END AS document,(document IS NOT NULL AND octet_length(document::text)>${OFFICE_SOURCE_DOCUMENT_DB_MAX_BYTES}) AS oversized,count(*) OVER() AS total FROM office_source_documents WHERE owner_key=$1 AND kind='clip_report' ORDER BY ${REPORT_ORDER} LIMIT ${OFFICE_SOURCE_REPORT_READ_LIMIT}`;
function entry(row:any):StoredOfficeSourceEntry {
 const value=z.object({kind:z.enum(OFFICE_SOURCE_DOCUMENT_KINDS),doc_key:z.string().max(128),status:z.enum(["present","invalid","limit"]),document:z.unknown(),oversized:z.boolean()}).parse(row);
 return {kind:value.kind,key:value.doc_key,status:value.status,document:value.document===undefined?null:value.document,oversized:value.oversized};
}
/** Read-only. Returns null while the reviewed table does not exist yet (the
 * migration has not been applied), so readers keep their previous behaviour.
 * Every other error propagates; callers report it as invalid evidence. */
export async function readOfficeSourceDocuments(db:SourceQuery,owner:string):Promise<OfficeSourceDocumentSet|null> {
 await assertOwner(db,owner);const key=ownerKey(owner);
 let singles:{rows:any[]},reports:{rows:any[]};
 try{singles=await db.query(SINGLETON_SQL,[key]);reports=await db.query(REPORT_SQL,[key]);}
 catch(error){if((error as {code?:unknown})?.code==="42P01")return null;throw error;}
 const set:OfficeSourceDocumentSet={singletons:{},reports:[],reportTotal:0};
 for(const row of singles.rows){const item=entry(row);if(item.kind==="clip_report" || item.key!=="" || set.singletons[item.kind])throw new Error("Invalid stored source document");set.singletons[item.kind]=item;}
 for(const row of reports.rows){const item=entry(row);if(item.kind!=="clip_report" || (!DAILY_REPORT_NAME.test(item.key)&&!CYCLE_REPORT_NAME.test(item.key)))throw new Error("Invalid stored source document");set.reports.push(item);}
 if(new Set(set.reports.map(r=>r.key)).size!==set.reports.length)throw new Error("Invalid stored source document");
 set.reportTotal=reports.rows.length?Number(reports.rows[0].total):0;
 if(!Number.isSafeInteger(set.reportTotal) || set.reportTotal<set.reports.length)throw new Error("Invalid stored source document");
 return set;
}
