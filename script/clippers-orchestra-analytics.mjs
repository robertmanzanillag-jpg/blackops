import { mkdir, lstat, realpath, writeFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPortfolioMetricool, DESTINATIONS, destinationKey, localDay, findDestination, exactPost, providerTimestamp } from './clippers-portfolio-metricool.mjs';
import { privateOrchestraJson } from './clippers-orchestra-report.mjs';
import { loadClipperSelectedEnv } from './clippers-selected-env.mjs';
async function boundedBody(response,limit=2*1024*1024){
  if(!response.body)return response.text();
  const chunks=[];let bytes=0;
  for await(const part of response.body){bytes+=part.length;if(bytes>limit){await response.body.cancel?.().catch(()=>{});throw Error('analytics_response_too_large');}chunks.push(part);}
  return Buffer.concat(chunks).toString('utf8');
}
export function readOnlyAnalyticsFetch(fetcher,signal){
  return async (input,init={})=>{
    const url=new URL(String(input)),method=String(init.method??'GET').toUpperCase();
    if(url.protocol!=='https:'||url.username||url.password||url.port)throw Error('analytics_read_scope_required');
    const get=method==='GET'&&url.hostname==='app.metricool.com'&&(
      url.pathname==='/api/admin/simpleProfiles'||(/^\/api\/v2\/analytics\/posts\/(?:tiktok|facebook)$/.test(url.pathname)&&url.searchParams.getAll('blogId').length===1&&DESTINATIONS.some(d=>String(d.brandId)===url.searchParams.get('blogId')&&url.pathname.endsWith('/'+d.network))));
    let metadata=false;
    if(method==='POST'&&url.href==='https://ai.metricool.com/mcp'){
      const body=JSON.parse(String(init.body??''));metadata=body.method==='tools/call'&&body.params?.name==='getBrandSettings'&&Object.keys(body.params.arguments??{}).length===0;
    }
    if(!get&&!metadata)throw Error('analytics_read_scope_required');
    const response=await fetcher(url,{...init,redirect:'error',signal:AbortSignal.any([signal,...(init.signal?[init.signal]:[])])});
    let body;const text=()=>body??=boundedBody(response);
    return {ok:response.ok,status:response.status,headers:response.headers,text,json:async()=>JSON.parse(await text())};
  };
}
export async function collectClippersAccountAnalytics({workspaceRoot,now=new Date(),env=process.env,adapter,fetcher=fetch,maxCycleMs=90000}={}){
  if(!(now instanceof Date)||!Number.isFinite(+now)||!Number.isInteger(maxCycleMs)||maxCycleMs<1||maxCycleMs>90000)throw Error('analytics_configuration_invalid');
  const root=await realpath(path.resolve(workspaceRoot||env.CLIPPERS_WORKSPACE_ROOT||'clippers_workspace'));
  const prior=(await privateOrchestraJson(root,'reports/clippers-account-analytics/latest.json',524288)).value;
  if(prior?.schemaVersion===1&&prior.adapterContract==='utc-local-v1'&&prior.paidSpendUsd===0&&prior.readOnly===true&&Array.isArray(prior.accounts)&&prior.accounts.length===4&&new Set(prior.accounts.filter(a=>findDestination(a)).map(destinationKey)).size===4&&prior.date===localDay(now)&&Date.parse(prior.generatedAt)<=+now&&+now-Date.parse(prior.generatedAt)<6*3600000)return {...prior,reused:true};
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),maxCycleMs);
  const started=performance.now();let client=adapter;
  if(!client){
    if(env.CLIPPERS_CONFIG_ROOT)loadClipperSelectedEnv(env.CLIPPERS_CONFIG_ROOT,env);
    if(env.METRICOOL_USER_TOKEN&&env.METRICOOL_USER_ID){try{client=createPortfolioMetricool({token:env.METRICOOL_USER_TOKEN,userId:env.METRICOOL_USER_ID,fetcher:readOnlyAnalyticsFetch(fetcher,controller.signal)});}catch{client=null;}}
  }
  const accounts=[];
  try{
    for(const destination of DESTINATIONS){
      if(!client||performance.now()-started>=maxCycleMs){accounts.push({...destination,status:'held',observedAt:null,reason:client?'analytics_time_budget_reached':'analytics_credentials_unavailable',posts:[]});continue;}
      try{
        const receipt=await Promise.race([client.accountAnalytics(destination,now),new Promise((_,reject)=>{
          const abort=()=>reject(Error('analytics_time_budget_reached'));if(controller.signal.aborted)abort();else controller.signal.addEventListener('abort',abort,{once:true});
        })]);
        const rows=receipt?.posts;
        if(!Array.isArray(rows)||rows.length>200||!Number.isSafeInteger(receipt.receivedRows)||receipt.receivedRows<rows.length||!Number.isSafeInteger(receipt.rejectedRows)||receipt.rejectedRows!==receipt.receivedRows-rows.length)throw Error('analytics_invalid_receipt');
        const posts=rows.map(row=>{
          const post=exactPost(row.url,destination),publishedAt=providerTimestamp(row.publishedAt),observedAt=providerTimestamp(row.observedAt);
          if(!post||post.id!==row.id||!publishedAt||!observedAt||Date.parse(observedAt)>+now||Date.parse(publishedAt)>Date.parse(observedAt)||+now-Date.parse(publishedAt)>7*86400000||
            !Number.isSafeInteger(row.views)||row.views<0||!['provider_observation_time','retrieved_at_only'].includes(row.timing)||
            (row.completionRate!==null&&(!Number.isFinite(row.completionRate)||row.completionRate<0||row.completionRate>1)))throw Error('analytics_invalid_receipt');
          return {...post,publishedAt,observedAt,views:row.views,completionRate:row.completionRate,timing:row.timing,actualAgeHours:(Date.parse(observedAt)-Date.parse(publishedAt))/3600000};
        });
        accounts.push({...destination,status:receipt.receivedRows>0&&!posts.length?'held':'observed',observedAt:now.toISOString(),reason:receipt.rejectedRows?'analytics_partial_or_unusable_rows':null,receivedRows:receipt.receivedRows,rejectedRows:receipt.rejectedRows,posts});
      }catch(error){
        const detail=typeof error?.message==='string'&&/^(?:analytics_http_[1-5]\d{2}|analytics_json_response_required|analytics_json_invalid|metricool_list_unrecognized|metricool_pagination_unverified)$/.test(error.message)?error.message:'analytics_provider_read_unavailable';
        accounts.push({...destination,status:'held',observedAt:null,reason:controller.signal.aborted?'analytics_time_budget_reached':detail,posts:[]});
      }
    }
  }finally{clearTimeout(timer);}
  const report={schemaVersion:1,adapterContract:'utc-local-v1',date:localDay(now),generatedAt:now.toISOString(),readOnly:true,paidSpendUsd:0,accounts,
    deniedBrandIds:[6431692,6475033,6585226],disconnected:[{brandId:6595747,reason:'destination_not_connected'}],
    notice:'Whole-account seven-day source analytics retain actual observation age; not controlled queue experiments, rights approval or publication proof.'};
  const directory=path.join(root,'reports/clippers-account-analytics');await mkdir(directory,{recursive:true,mode:0o700});
  const info=await lstat(directory);if(!info.isDirectory()||info.isSymbolicLink()||(info.mode&0o077)||(process.getuid&&info.uid!==process.getuid())||await realpath(directory)!==directory)throw Error('analytics_private_directory_required');
  const temporary=path.join(directory,randomUUID()+'.tmp');
  try{await writeFile(temporary,JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});await rename(temporary,path.join(directory,'latest.json'));}
  finally{await unlink(temporary).catch(()=>{});}
  return {...report,reused:false};
}
