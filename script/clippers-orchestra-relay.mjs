import { randomUUID } from 'node:crypto';
import { buildClippersOrchestraReport } from './clippers-orchestra-report.mjs';
/** Only the two owner-verified connected domains of the same Office project may receive Clippers telemetry; no token is accepted by this function. */
export function clippersOrchestraRemoteEligibility(value,tokenConfigured){
  try{const u=new URL(value),allowed=['https://robertwebsites.com','https://robplanner.replit.app'].includes(u.origin)&&!u.username&&!u.password&&!u.search&&!u.hash&&(u.pathname==='/'||u.pathname==='');
    return {allowed:allowed&&tokenConfigured===true,host:u.hostname,tokenConfigured:tokenConfigured===true,reason:!allowed?'office_origin_unverified':tokenConfigured!==true?'existing_device_auth_unavailable':null};
  }catch{return {allowed:false,host:null,tokenConfigured:tokenConfigured===true,reason:'office_origin_unverified'};}
}
/** Existing authenticated device helper owns transport/auth. This relay never reads a token or makes a request. */
export function createClippersOrchestraRelay({workspaceRoot,now=()=>new Date(),build=buildClippersOrchestraReport,intervalMs=60000}={}){
  let latest=null,active=null,timer=null,closed=false,acknowledged=null;
  async function refresh(){
    if(active)return active;
    active=(async()=>{
      try{
        const report=await build({workspaceRoot,now:now()});
        const envelope={version:1,nonce:randomUUID(),generatedAt:report.generatedAt,report};
        if(Buffer.byteLength(JSON.stringify(envelope))>262144)throw Error('orchestra_report_too_large');
        latest=envelope;
      }catch{latest=null;}
    })().finally(()=>{active=null;});
    return active;
  }
  function start(){
    if(timer||closed)return;
    void refresh();
    timer=setInterval(()=>{void refresh();},Math.max(30000,intervalMs));timer.unref();
  }
  return {start,refresh,getEnvelope:()=>latest&&latest.nonce!==acknowledged?structuredClone(latest):null,acknowledge(nonce){if(latest?.nonce===nonce)acknowledged=nonce;},stop(){closed=true;if(timer)clearInterval(timer);timer=null;}};
}
