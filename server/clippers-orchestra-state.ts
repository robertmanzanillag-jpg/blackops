import { getSystemUserId } from './user-context';
import { createHash } from 'node:crypto';
import { parseClippersOrchestraStatus, type ClippersOrchestraStatus } from '../shared/clippers-orchestra';
import { applyClippersReceiptOutcomes, clippersCareerView } from './clippers-orchestra-life';
import type { CompanyState } from '../shared/agent-company';
// Key order is not preserved by PostgreSQL JSONB. Keep telemetry checksums canonical
// without importing any KONG workflow into the independently deployed Clippers slice.
function canonicalOrchestraJson(value:unknown):string {
  if(value===null)return 'null';
  if(typeof value==='string'||typeof value==='boolean'||(typeof value==='number'&&Number.isFinite(value)))return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(canonicalOrchestraJson).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonicalOrchestraJson((value as Record<string,unknown>)[key])).join(',')+'}';
  throw Error('CLIPPERS_ORCHESTRA_INVALID_JSON');
}
const hash=(v:unknown)=>createHash('sha256').update(canonicalOrchestraJson(v)).digest('hex');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const CLIPPERS_ORCHESTRA_MAX_BYTES=262144;
interface Store {read(owner:string):Promise<string|null>;transact(owner:string,update:(raw:string|null)=>Promise<string>):Promise<string>}
interface Envelope {version:1;nonce:string;generatedAt:string;report:ClippersOrchestraStatus}
interface Saved {version:1;nonce:string;digest:string;receivedAt:string;report:ClippersOrchestraStatus;seen:{nonce:string;digest:string}[]}
const namespace=(owner:string)=>`clippers-orchestra:${owner}`;
function saved(raw:string|null,at=Date.now()):Saved|null {
  if(!raw)return null;const s=JSON.parse(raw);
  if(s?.version!==1||!UUID.test(s.nonce??'')||!/^[a-f0-9]{64}$/.test(s.digest??'')||!Array.isArray(s.seen)||s.seen.length>100||!Number.isFinite(Date.parse(s.receivedAt))||!Number.isFinite(Date.parse(s.report?.generatedAt))||!parseClippersOrchestraStatus(s.report,Date.parse(s.report.generatedAt))||Date.parse(s.report.generatedAt)>Date.parse(s.receivedAt)||hash(s.report)!==s.digest||new Date(s.receivedAt).toISOString()!==s.receivedAt||Date.parse(s.receivedAt)>at||s.seen.some((n:any)=>!UUID.test(n?.nonce??'')||!/^[a-f0-9]{64}$/.test(n?.digest??''))||new Set(s.seen.map((n:any)=>n.nonce)).size!==s.seen.length)throw Error('CLIPPERS_ORCHESTRA_STORED_INVALID');
  return s;
}
export function parseClippersEnvelope(value:unknown,now=Date.now()):Envelope|null {
  if(!value||typeof value!=='object'||Array.isArray(value)||Buffer.byteLength(JSON.stringify(value))>CLIPPERS_ORCHESTRA_MAX_BYTES)return null;
  const v=value as Record<string,any>;
  if(Object.keys(v).sort().join(',')!=='generatedAt,nonce,report,version'||v.version!==1||!UUID.test(v.nonce??'')||typeof v.generatedAt!=='string'||
    !Number.isFinite(Date.parse(v.generatedAt))||new Date(v.generatedAt).toISOString()!==v.generatedAt||Date.parse(v.generatedAt)>now||now-Date.parse(v.generatedAt)>120000)return null;
  const report=parseClippersOrchestraStatus(v.report,Date.parse(v.generatedAt));
  if(!report||report.generatedAt!==v.generatedAt||report.transport.state!=='disconnected'||report.transport.lastIngestAt!==null||
    !['local_reports','unavailable'].includes(report.sourceFreshness.transport)||report.sourceFreshness.receivedAt!==null||
    report.roles.some(r=>r.career.registered||r.career.skillIds.length||r.outcomes?.some(o=>!r.evidenceIds.includes(o.evidenceId))))return null;
  return {...v,report} as Envelope;
}
export function createClippersOrchestraState(options:{owner:()=>string;store:()=>Promise<Store>;now?:()=>number;careerSweep?:(report:ClippersOrchestraStatus)=>Promise<void>;readCompany?:()=>Promise<CompanyState|undefined>}){
  const now=options.now??Date.now;
  async function ingest(value:unknown){
    const at=now(),e=parseClippersEnvelope(value,at);if(!e)return {accepted:false,code:'CLIPPERS_ORCHESTRA_INVALID'};
    const digest=hash(e.report);let accepted=false,duplicate=false;
    const store=await options.store(),priorState=saved(await store.read(namespace(options.owner())),at),seen=priorState?.seen.find(item=>item.nonce===e.nonce);
    if(seen){if(seen.digest!==digest)throw Error('CLIPPERS_ORCHESTRA_NONCE_CONFLICT');return {accepted:true,duplicate:true,code:'CLIPPERS_ORCHESTRA_DUPLICATE'};}
    await store.transact(namespace(options.owner()),async raw=>{
      const old=saved(raw,at),prior=old?.seen.find(item=>item.nonce===e.nonce);
      if(prior){if(prior.digest!==digest)throw Error('CLIPPERS_ORCHESTRA_NONCE_CONFLICT');duplicate=true;return raw!;}
      if(old&&Date.parse(e.generatedAt)<=Date.parse(old.report.generatedAt))throw Error('CLIPPERS_ORCHESTRA_OUT_OF_ORDER');
      const state:Saved={version:1,nonce:e.nonce,digest,receivedAt:new Date(at).toISOString(),report:e.report,seen:[...(old?.seen??[]),{nonce:e.nonce,digest}].slice(-100)};
      accepted=true;return JSON.stringify(state);
    });
    // A failed sweep is retried by the next new accepted envelope. Its company transaction dedupes outcomes.
    try{if(accepted)await options.careerSweep?.(e.report);}catch{return {accepted:true,duplicate,code:'CLIPPERS_ORCHESTRA_CAREERS_PENDING'};}
    return {accepted:accepted||duplicate,duplicate,code:duplicate?'CLIPPERS_ORCHESTRA_DUPLICATE':'CLIPPERS_ORCHESTRA_ACCEPTED'};
  }
  // Former Mac LaunchAgent lanes now in GitHub Actions (clippers-cloud-lanes.yml); never fails the read.
  async function overlayCloudLanes(report:ClippersOrchestraStatus,at:number){
    try{const {applyCloudLanesOverlay}=await import('./clippers-cloud-lanes-status');const {CLOUD_LANES_NAMESPACE}=await import('../shared/clippers-cloud-lanes.mjs');
      applyCloudLanesOverlay(report,await (await options.store()).read(CLOUD_LANES_NAMESPACE(options.owner())),at);}catch{}
  }
  async function read(){
    const at=now(),stored=saved(await (await options.store()).read(namespace(options.owner())),at);
    if(!stored){
      // Mac off / never reported: fall back to the cloud streamer job state stored in PostgreSQL.
      try{const {cloudFallbackReport}=await import('./clippers-streamers-status');const {STREAMER_STATE_NAMESPACE}=await import('../script/clippers-streamer-discovery.mjs');
        const fallback=cloudFallbackReport(await (await options.store()).read(STREAMER_STATE_NAMESPACE(options.owner())),at);
        if(!fallback)return null;
        let company:CompanyState|undefined;try{company=await options.readCompany?.();}catch{}
        for(const role of fallback.roles)role.career=clippersCareerView(company,role.id);
        await overlayCloudLanes(fallback,at);
        return fallback;}catch{return null;}
    }
    const report=structuredClone(stored.report),age=(at-Date.parse(stored.receivedAt));
    report.generatedAt=new Date(at).toISOString();
    report.transport={state:age>=0&&age<=90000?'connected':'stale',lastIngestAt:stored.receivedAt,maxAgeMs:90000};
    report.sourceFreshness.transport='authenticated_ingest';report.sourceFreshness.receivedAt=stored.receivedAt;
    const evidenceAge=report.evidenceAt?(at-Date.parse(report.evidenceAt))/60000:null;
    report.sourceFreshness.ageMinutes=evidenceAge;
    report.sourceFreshness.state=report.evidenceAt?evidenceAge!==null&&evidenceAge<=report.sourceFreshness.staleAfterMinutes?'connected':'stale':'disconnected';
    if(report.sourceFreshness.state==='stale')report.sourceFreshness.heldReasons=[...new Set([...report.sourceFreshness.heldReasons,'runtime_evidence_stale'])];
    for(const signal of report.discovery.signals){
      if(signal.label==='paired_growth_observed'&&(at-Date.parse(signal.observedAt)>72*3600000||!signal.previousObservedAt||at-Date.parse(signal.previousObservedAt)>72*3600000||at-Date.parse(signal.publishedAt)>72*3600000))signal.label='stale_reference';
    }
    for(const preference of report.creatorSelection?.preferences??[]){
      if(preference.status==='preferred'&&(!preference.expiresAt||Date.parse(preference.expiresAt)<=at)){
        preference.status='baseline';preference.reason='creator_preference_expired';preference.preferredCreatorGroupId=preference.baselineCreatorGroupId;
      }
    }
    let company:CompanyState|undefined;try{company=await options.readCompany?.();}catch{}
    for(const role of report.roles){
      role.career=clippersCareerView(company,role.id);
      if(role.stage==='health'){role.heartbeatAt=stored.receivedAt;role.nextDueAt=new Date(Date.parse(stored.receivedAt)+60000).toISOString();}
      if(report.transport.state!=='connected'){role.state=role.evidenceAt?'stale':'disconnected';role.heldReasons=[...new Set([...role.heldReasons,'mac_status_ingest_stale'])];}
      else if(role.evidenceAt&&at-Date.parse(role.evidenceAt)>26*3600000)role.state='stale';
    }
    // Cloud streamer discovery (GitHub Actions) reports into the same Streamers role; it never fails the read.
    try{const {applyStreamerOverlay}=await import('./clippers-streamers-status');const {STREAMER_STATE_NAMESPACE}=await import('../script/clippers-streamer-discovery.mjs');
      applyStreamerOverlay(report,await (await options.store()).read(STREAMER_STATE_NAMESPACE(options.owner())),at);}catch{}
    await overlayCloudLanes(report,at);
    return report;
  }
  return {ingest,read};
}
let instance:ReturnType<typeof createClippersOrchestraState>|undefined;
export function clippersOrchestraState(){
  return instance??=createClippersOrchestraState({
    owner:getSystemUserId,
    store:async()=> (await import('./agent-council-store')).getCouncilStore(),
    readCompany:async()=> (await (await import('./agent-council')).getAgentCouncil().load()).company,
    careerSweep:async report=>{
      const council=(await import('./agent-council')).getAgentCouncil();
      const at=Date.now(),current=await council.load();
      if(JSON.stringify(applyClippersReceiptOutcomes(current.company,report,at))===JSON.stringify(current.company))return;
      await council.updateOfficeExecution((execution,company)=>{Object.assign(company,applyClippersReceiptOutcomes(company,report,at));return execution;});
    },
  });
}

/** Optional telemetry must not hold the original device heartbeat behind a slow KV/career sweep. */
export function createOptionalClippersTelemetryIngest(ingest:(value:unknown)=>Promise<unknown>,timeoutMs=1500){
  let active:Promise<unknown>|null=null;
  return async(value:unknown)=>{
    if(active)return {accepted:false,code:'CLIPPERS_ORCHESTRA_INGEST_BUSY'};
    active=Promise.resolve().then(()=>ingest(value)).catch(()=>({accepted:false,code:'CLIPPERS_ORCHESTRA_INGEST_UNAVAILABLE'})).finally(()=>{active=null;});
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{return await Promise.race([active,new Promise(resolve=>{timer=setTimeout(()=>resolve({accepted:false,code:'CLIPPERS_ORCHESTRA_INGEST_UNCONFIRMED'}),timeoutMs);})]);}
    finally{if(timer)clearTimeout(timer);}
  };
}
let optionalIngest:ReturnType<typeof createOptionalClippersTelemetryIngest>|undefined;
export function ingestOptionalClippersTelemetry(value:unknown){return (optionalIngest??=createOptionalClippersTelemetryIngest(v=>clippersOrchestraState().ingest(v)))(value);}
