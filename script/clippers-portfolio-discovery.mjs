import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, realpath, readdir, unlink, rename, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const HOUR = 3_600_000;
const MAX_BYTES = 262_144;
const MAX_ENTRIES = 25;
const CHANNEL = /^UC[A-Za-z0-9_-]{22}$/;
const VIDEO = /^[A-Za-z0-9_-]{11}$/;
const hash = value => createHash('sha256').update(value).digest('hex');

import { LEGACY_DISCOVERY_CREATORS, PRIORITY_CREATORS, CHALLENGER_CREATORS, ALL_DISCOVERY_CREATORS, resolveCreatorChannel, canonicalSourceIdentity } from '../shared/clippers-priority-creators.mjs';
export { DISCOVERY_CREATORS, LEGACY_DISCOVERY_CREATORS, PRIORITY_CREATORS, CHALLENGER_CREATORS } from '../shared/clippers-priority-creators.mjs';
export const DEFAULT_DISCOVERY_STATE_DIR = path.join(os.homedir(), '.local/share/blackops/clippers-workspace/portfolio-discovery');
export const DAILY_RSS_CAP = 14;
export const DISCOVERY_DEADLINE_MS = 90_000;

export function feedUrl(channelId) {
  if (!CHANNEL.test(channelId ?? '')) throw new Error('invalid_channel_id');
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
}

export function assertFeedUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'www.youtube.com' || url.username || url.password ||
      url.port || url.hash || url.pathname !== '/feeds/videos.xml' ||
      [...url.searchParams.keys()].join(',') !== 'channel_id' ||
      !CHANNEL.test(url.searchParams.get('channel_id') ?? '') ||
      url.href !== feedUrl(url.searchParams.get('channel_id'))) throw new Error('unsafe_feed_url');
  return url.href;
}

function xmlText(value) {
  if (value.length > 5_000 || /[<>]/.test(value)) throw new Error('invalid_xml_text');
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity) => {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (named[entity]) return named[entity];
    const code = entity[1]?.toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    if (!Number.isInteger(code) || code < 32 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
      throw new Error('invalid_xml_entity');
    }
    return String.fromCodePoint(code);
  }); // Decoding is text only; never rendered as markup.
}

function tag(body, name, required = true) {
  const matches = [...body.matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'g'))];
  if (matches.length !== 1) {
    if (!required && matches.length === 0) return null;
    throw new Error('missing_or_duplicate_feed_field');
  }
  if (/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);)/i.test(matches[0][1])) throw new Error('unknown_xml_entity');
  return xmlText(matches[0][1]).trim();
}

function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value)) {
    throw new Error('invalid_feed_timestamp');
  }
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new Error('invalid_feed_timestamp');
  const offset = value.match(/([+-])(\d\d):(\d\d)$/);
  const offsetMinutes = offset ? (Number(offset[2]) * 60 + Number(offset[3])) * (offset[1] === '+' ? 1 : -1) : 0;
  if (new Date(time + offsetMinutes * 60_000).toISOString().slice(0, 19) !== value.slice(0, 19)) throw new Error('invalid_feed_timestamp');
  return new Date(time).toISOString();
}

export function parseYouTubeFeed(xml, creator, observedAt = new Date().toISOString()) {
  const observed = Date.parse(observedAt);
  if (!Number.isFinite(observed)) throw new Error('invalid_observation_time');
  if (typeof xml !== 'string' || Buffer.byteLength(xml) > MAX_BYTES ||
      /<!\s*(?:DOCTYPE|ENTITY)|<!\[CDATA\[/i.test(xml) ||
      !/^\s*(?:<\?xml[^?]*\?>\s*)?<feed\b/.test(xml) || !/<\/feed>\s*$/.test(xml) ||
      !xml.includes('xmlns="http://www.w3.org/2005/Atom"') ||
      !xml.includes('xmlns:yt="http://www.youtube.com/xml/schemas/2015"') ||
      !xml.includes('xmlns:media="http://search.yahoo.com/mrss/"')) throw new Error('unsafe_or_invalid_feed_xml');
  const entries = [...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/g)];
  if (entries.length > MAX_ENTRIES || (xml.match(/<entry\b/g) ?? []).length !== entries.length) throw new Error('invalid_feed_entries');
  const header = xml.slice(0, entries[0]?.index ?? xml.lastIndexOf('</feed>'));
  // YouTube's feed header omits the UC prefix; entry IDs retain it. Bind both
  // representations to the exact author URI rather than trusting a feed title.
  if (![creator.channelId, creator.channelId.slice(2)].includes(tag(header, 'yt:channelId')) ||
      tag(header, 'uri') !== `https://www.youtube.com/channel/${creator.channelId}`) throw new Error('feed_channel_mismatch');
  const seen = new Set();
  const observations = [];
  const rejected = [];
  for (const [, body] of entries) {
    const videoId = tag(body, 'yt:videoId');
    if (!VIDEO.test(videoId) || tag(body, 'yt:channelId') !== creator.channelId) throw new Error('entry_identity_mismatch');
    if (seen.has(videoId)) throw new Error('duplicate_feed_video');
    seen.add(videoId);
    const publishedAt = timestamp(tag(body, 'published'));
    if (Date.parse(publishedAt) > observed) {
      rejected.push({ videoId, reason: 'future_published_at' });
      continue;
    }
    const statistics = [...body.matchAll(/<media:statistics\b([^>]*)\/?\s*>/g)];
    if (statistics.length > 1) throw new Error('duplicate_view_statistic');
    let views = null;
    if (statistics.length) {
      const count = statistics[0][1].match(/(?:^|\s)views="(\d+)"(?:\s|\/|$)/);
      if (count && Number.isSafeInteger(Number(count[1]))) views = Number(count[1]);
    }
    const ageHours = (observed - Date.parse(publishedAt)) / HOUR;
    observations.push({
      creatorId: creator.id, channelId: creator.channelId, videoId, network: 'youtube',
      creatorGroupId: resolveCreatorChannel(creator.channelId)?.creatorGroupId ?? null,
      sourceIdentity: canonicalSourceIdentity(videoId), originalEpisodeId: null, independentExperiment: false,
      creatorLanguage: creator.language, language: null, format: 'unknown',
      title: tag(body, 'title').slice(0, 500), url: `https://www.youtube.com/watch?v=${videoId}`,
      sourceUrl: feedUrl(creator.channelId), publishedAt, observedAt: new Date(observed).toISOString(),
      views, metricEvidence: views === null ? 'not_provided' : 'direct_public_feed',
      ageHours, freshness: ageHours <= 24 ? 'preferred_under_24h' : ageHours <= 72 ? 'recent_under_72h' : 'stale',
      topicHint: /\b(?:GTA\s*(?:VI|6)|Grand Theft Auto)\b/i.test(tag(body, 'title')) ? 'gta' : 'unclassified',
      permission: 'unknown', mayPublish: false,
    });
  }
  return { observations, rejected };
}

function abortable(promise, signal) {
  return new Promise((resolve,reject)=>{
    const fail=()=>reject(new Error('feed_timeout'));
    if(signal.aborted){fail();return;}
    signal.addEventListener('abort',fail,{once:true});
    Promise.resolve(promise).then(resolve,reject).finally(()=>signal.removeEventListener('abort',fail));
  });
}
export async function fetchYouTubeFeed(creator, {fetchImpl=fetch,now=new Date(),timeoutMs=10_000,signal}={}) {
  const url=assertFeedUrl(feedUrl(creator.channelId)),controller=new AbortController(),requestStarted=Date.now();
  const abort=()=>controller.abort();
  if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
  const timeout=setTimeout(abort,Math.max(1,Math.min(timeoutMs,10_000)));
  let reader;
  const cancel=()=>{void reader?.cancel().catch(()=>{});};
  controller.signal.addEventListener('abort',cancel,{once:true});
  try {
    const response=await abortable(fetchImpl(url,{method:'GET',redirect:'error',credentials:'omit',signal:controller.signal,
      headers:{Accept:'application/atom+xml,application/xml,text/xml','User-Agent':'BlackOps-Public-Feed-Discovery/1.0'}}),controller.signal);
    if(response.redirected||(response.url&&response.url!==url))throw new Error('feed_redirect_rejected');
    if(response.status!==200)throw new Error(response.status===429?'feed_throttled':`feed_http_${Number(response.status)}`);
    if(!/^(?:application\/(?:atom\+xml|xml)|text\/xml)(?:\s*;|$)/i.test(response.headers.get('content-type')??''))throw new Error('feed_content_type_rejected');
    if(Number(response.headers.get('content-length'))>MAX_BYTES)throw new Error('feed_too_large');
    reader=response.body.getReader();const chunks=[];let bytes=0;
    while(true){const part=await abortable(reader.read(),controller.signal);if(controller.signal.aborted)throw new Error('feed_timeout');if(part.done)break;bytes+=part.value.byteLength;if(bytes>MAX_BYTES)throw new Error('feed_too_large');chunks.push(Buffer.from(part.value));}
    const xml=Buffer.concat(chunks).toString('utf8');return {feedSha256:hash(xml),...parseYouTubeFeed(xml,creator,new Date(+now+Date.now()-requestStarted).toISOString())};
  } catch(error){void reader?.cancel().catch(()=>{});throw error;}
  finally {clearTimeout(timeout);signal?.removeEventListener('abort',abort);controller.signal.removeEventListener('abort',cancel);try{reader?.releaseLock();}catch{}}
}

export function selectCreators(now = new Date(), ids) {
  if (!Number.isFinite(+now)) throw new Error('invalid_observation_time');
  if (ids !== undefined) {
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > DAILY_RSS_CAP || new Set(ids).size !== ids.length) throw new Error('one_to_fourteen_unique_creators_required');
    const selected=ids.map(id=>ALL_DISCOVERY_CREATORS.find(row=>row.id===id));
    if (selected.some(row=>!row)) throw new Error('creator_not_in_verified_catalogue');
    return selected.sort((a,b)=>ALL_DISCOVERY_CREATORS.indexOf(a)-ALL_DISCOVERY_CREATORS.indexOf(b));
  }
  // Every priority feed is due daily. The one reserved exploration slot rotates
  // all seven reviewed sources in paired UTC days (a14-day cycle); no popularity/title inference.
  const challenger=CHALLENGER_CREATORS[Math.floor(+now/(2*24*HOUR))%CHALLENGER_CREATORS.length];
  return [...PRIORITY_CREATORS,challenger];
}

const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2;
};

export function classifyDiscovery(observation, history) {
  const result = { mayPublish: false, causalClaim: false, statisticalSignificanceClaim: false, growthStatus: 'first_snapshot_baseline', viewsPerHour: null, outlierRatio: null };
  if (!Number.isSafeInteger(observation.views) || observation.views < 0 || observation.metricEvidence !== 'direct_public_feed') return { ...result, status: 'views_unknown' };
  const observedAt = Date.parse(observation.observedAt), publishedAt = Date.parse(observation.publishedAt);
  const measuredAge = (observedAt - publishedAt) / HOUR;
  if (!Number.isFinite(measuredAge) || measuredAge < 0) return { ...result, status: 'invalid_observation_time' };
  if (measuredAge > 72) return { ...result, status: 'stale_reference' };
  const prior = history.filter(row => row.channelId === observation.channelId && row.videoId === observation.videoId &&
    row.metricEvidence === 'direct_public_feed' && row.publishedAt === observation.publishedAt &&
    Number.isSafeInteger(row.views) && row.views >= 0 &&
    Date.parse(row.observedAt) >= Date.parse(observation.publishedAt) &&
    Date.parse(row.observedAt) <= observedAt - HOUR)
    .sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt))[0];
  if (prior && prior.views <= observation.views) { result.viewsPerHour = (observation.views - prior.views) / ((observedAt - Date.parse(prior.observedAt)) / HOUR); result.growthStatus = prior.views < observation.views ? 'public_growth_observed' : 'public_counter_unchanged'; }
  else if (prior) result.growthStatus = 'public_counter_decreased';
  if (!observation.language || observation.format === 'unknown') return { ...result, status: 'comparison_context_unknown' };
  const baselines = new Map();
  for (const row of history) {
    if (row.channelId === observation.channelId && row.videoId !== observation.videoId && row.network === observation.network &&
        row.language === observation.language && row.format === observation.format && row.metricEvidence === 'direct_public_feed' &&
        Number.isSafeInteger(row.views) && row.views >= 0 && Date.parse(row.publishedAt) <= Date.parse(row.observedAt) &&
        Math.abs((Date.parse(row.observedAt) - Date.parse(row.publishedAt)) / HOUR - measuredAge) <= 1 &&
        Date.parse(row.observedAt) <= observedAt) baselines.set(row.videoId, row.views);
  }
  if (baselines.size < 5) return { ...result, status: 'five_same_context_baselines_required' };
  const reference = median([...baselines.values()]);
  if (!reference) return { ...result, status: 'zero_baseline' };
  return { ...result, status: 'research_comparison_only', baselineSamples: baselines.size, outlierRatio: observation.views / reference };
}

async function privateRead(file, fallback, maxBytes=2_097_152) {
  let handle;
  try {
    handle = await open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    const info=await handle.stat();
    if(!info.isFile()||info.nlink!==1||info.size>maxBytes||(info.mode&0o077)||(process.getuid&&info.uid!==process.getuid()))throw new Error('private_discovery_file_required');
    const chunks=[];let bytes=0;
    while(bytes<=maxBytes){const chunk=Buffer.alloc(Math.min(65536,maxBytes+1-bytes));const result=await handle.read(chunk,0,chunk.length,null);if(!result.bytesRead)break;bytes+=result.bytesRead;if(bytes>maxBytes)throw new Error('private_discovery_file_required');chunks.push(chunk.subarray(0,result.bytesRead));}
    const after=await handle.stat();
    if(after.size!==info.size||after.mtimeMs!==info.mtimeMs||after.ctimeMs!==info.ctimeMs||bytes!==info.size)throw new Error('private_discovery_file_changed');
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch(error){if(error.code==='ENOENT')return fallback;throw error;}
  finally{await handle?.close();}
}

async function privateCreate(file, value) {
  const serialized=JSON.stringify(value,null,2)+'\n';
  if(Buffer.byteLength(serialized)>2_097_152)throw new Error('discovery_file_too_large');
  const handle = await open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(serialized); await handle.sync(); }
  finally { await handle.close(); }
}

const receiptPattern = /^\d{4}-\d\d-\d\d-(?:v2-)?[a-f0-9]{16}\.json$/;
const knownCreator = (id,channelId) => ALL_DISCOVERY_CREATORS.find(row=>row.id===id&&row.channelId===channelId);
function validateReceipt(value,day,creators) {
  if (![1,2].includes(value?.schemaVersion) || value.day!==day || value.mayPublish!==false || value.permission!=='unknown' || value.eligibleAssets!==0 || value.paidSpendUsd!==0 ||
      !Array.isArray(value.feeds) || value.feeds.length>14 || !Array.isArray(value.observations) || value.observations.length>350 ||
      !Number.isSafeInteger(value.networkRequests) || value.networkRequests<0 || value.networkRequests>14 ||
      !value.feeds.every(row=>knownCreator(row.creatorId,row.channelId)&&row.sourceUrl===feedUrl(row.channelId)&&['observed','unavailable'].includes(row.status)) ||
      new Set(value.feeds.map(row=>row.channelId)).size!==value.feeds.length ||
      !value.observations.every(row=>row.permission==='unknown'&&row.mayPublish===false&&knownCreator(row.creatorId,row.channelId)&&VIDEO.test(row.videoId)&&
        value.feeds.some(feed=>feed.channelId===row.channelId&&feed.creatorId===row.creatorId&&feed.status==='observed')&&
        row.url===`https://www.youtube.com/watch?v=${row.videoId}`&&row.sourceUrl===feedUrl(row.channelId)&&row.network==='youtube'&&typeof row.title==='string'&&row.title.length<=500&&
        (row.views===null||Number.isSafeInteger(row.views)&&row.views>=0)&&['direct_public_feed','not_provided'].includes(row.metricEvidence)&&
        row.language===null&&row.format==='unknown'&&Number.isFinite(Date.parse(row.publishedAt))&&Number.isFinite(Date.parse(row.observedAt))&&Date.parse(row.observedAt)>=Date.parse(row.publishedAt))) throw new Error('invalid_discovery_receipt');
  if(value.schemaVersion===1 && (value.feeds.length>4||value.observations.length>100||value.networkRequests!==value.feeds.length||!value.feeds.every(feed=>LEGACY_DISCOVERY_CREATORS.some(row=>row.id===feed.creatorId&&row.channelId===feed.channelId)))) throw new Error('invalid_discovery_receipt');
  if(creators && (value.feeds.length!==creators.length||!value.feeds.every((row,i)=>row.creatorId===creators[i].id&&row.channelId===creators[i].channelId))) throw new Error('invalid_discovery_receipt');
  return value;
}
async function atomicPrivateWrite(file,value) {
  const temp=file+'.'+randomUUID()+'.tmp';
  await privateCreate(temp,value);
  try {await rename(temp,file);const dir=await open(path.dirname(file),constants.O_RDONLY|constants.O_DIRECTORY);try{await dir.sync();}finally{await dir.close();}}
  finally {await unlink(temp).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
function validateBudget(value,day) {
  if(value?.schemaVersion!==2||value.day!==day||value.cap!==DAILY_RSS_CAP||!Number.isSafeInteger(value.importedRequests)||value.importedRequests<0||
    !value.imports||typeof value.imports!=='object'||Array.isArray(value.imports)||!Object.entries(value.imports).every(([name,row])=>receiptPattern.test(name)&&row&&/^[a-f0-9]{64}$/.test(row.sha256)&&Number.isSafeInteger(row.networkRequests)&&row.networkRequests>=1&&row.networkRequests<=4)||
    !Array.isArray(value.reservations)||value.reservations.length>14||new Set(value.reservations.map(row=>row.channelId)).size!==value.reservations.length||
    !value.reservations.every(row=>knownCreator(row.creatorId,row.channelId)&&typeof row.reservedAt==='string'&&row.reservedAt.startsWith(day+'T')&&Number.isFinite(Date.parse(row.reservedAt)))||
    value.importedRequests!==Object.values(value.imports).reduce((sum,row)=>sum+row.networkRequests,0)||value.used!==value.importedRequests+value.reservations.length) throw new Error('invalid_discovery_budget');
  return value;
}
const cachedResult = (receipt,creator) => ({feed:receipt.feeds.find(row=>row.channelId===creator.channelId),observations:receipt.observations.filter(row=>row.channelId===creator.channelId),rejected:[]});
export async function runPortfolioDiscovery({ stateDir=DEFAULT_DISCOVERY_STATE_DIR, now=new Date(), creatorIds, fetchImpl=fetch, clock=Date.now }={}) {
  if(!stateDir||!path.isAbsolute(stateDir))throw new Error('absolute_discovery_directory_required');
  const creators=selectCreators(now,creatorIds),day=now.toISOString().slice(0,10),started=clock();
  if(fetchImpl===globalThis.fetch && stateDir!==DEFAULT_DISCOVERY_STATE_DIR)throw new Error('canonical_operational_discovery_directory_required');
  await mkdir(stateDir,{recursive:true,mode:0o700});
  if(await realpath(stateDir)!==stateDir)throw new Error('discovery_directory_symlink_rejected');
  const info=await stat(stateDir);
  if((info.mode&0o077)||(process.getuid&&info.uid!==process.getuid()))throw new Error('private_discovery_directory_required');
  // Production cannot reset its global budget by changing a workspace/cache flag.
  // Tests may inject a fake transport and use temporary isolated directories.
  const receiptFile=path.join(stateDir,`${day}-v2-${hash(creators.map(row=>row.id).sort().join(',')).slice(0,16)}.json`);
  const lockFile=path.join(stateDir,'.discovery.lock');await privateCreate(lockFile,{createdAt:now.toISOString()});
  const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),DISCOVERY_DEADLINE_MS);
  try {
    const names=await readdir(stateDir);if(names.length>10_000)throw new Error('too_many_discovery_files');
    const budgetFile=path.join(stateDir,`.rss-budget-${day}.json`);
    let budget=await privateRead(budgetFile,null);
    if(!budget&&names.some(name=>name.startsWith(day+'-v2-')||name.startsWith(day+'-channel-')))throw new Error('missing_discovery_budget_with_v2_evidence');
    budget=budget?validateBudget(budget,day):{schemaVersion:2,day,cap:DAILY_RSS_CAP,importedRequests:0,imports:{},reservations:[],used:0};
    const cache=new Map(),history=[],todayReceipts=[];
    const legacyNames=names.filter(name=>/^\d{4}-\d\d-\d\d-[a-f0-9]{16}\.json$/.test(name));
    const legacyToday=legacyNames.filter(name=>name.startsWith(day+'-')).sort();
    // v1 accepted1..4 unique feeds from8 channels: at most162 real sets.
    // Fail closed on an impossible directory instead of unbounded accounting IO.
    if(legacyToday.length>162)throw new Error('too_many_legacy_discovery_receipts');
    const legacyHistory=legacyNames.filter(name=>name.slice(0,10)<day&&Date.parse(name.slice(0,10)+'T00:00:00Z')>=+now-8*24*HOUR).sort().slice(-32);
    for(const name of [...legacyToday,...legacyHistory]){
      const fileDay=name.slice(0,10),value=validateReceipt(await privateRead(path.join(stateDir,name),null,524288),fileDay);
      if(value.schemaVersion!==1)throw new Error('invalid_legacy_discovery_receipt');
      if(fileDay===day){todayReceipts.push(value);const sha=hash(JSON.stringify(value));
        if(Object.hasOwn(budget.imports,name)&&(budget.imports[name].sha256!==sha||budget.imports[name].networkRequests!==value.networkRequests))throw new Error('legacy_discovery_receipt_changed');
        if(!Object.hasOwn(budget.imports,name)){budget.importedRequests+=value.networkRequests;budget.imports[name]={sha256:sha,networkRequests:value.networkRequests};}}
      history.push(...value.observations);
    }
    budget.used=budget.importedRequests+budget.reservations.length;
    await atomicPrivateWrite(budgetFile,budget);
    for(const receipt of todayReceipts)for(const creator of creators){const result=cachedResult(receipt,creator);if(result.feed&&!cache.has(creator.channelId))cache.set(creator.channelId,result);}
    const channelNames=names.filter(name=>/^\d{4}-\d\d-\d\d-channel-UC[A-Za-z0-9_-]{22}\.json$/.test(name)&&name.slice(0,10)<=day&&Date.parse(name.slice(0,10)+'T00:00:00Z')>=Date.parse(day+'T00:00:00Z')-2*24*HOUR);
    if(channelNames.length>ALL_DISCOVERY_CREATORS.length*3)throw new Error('too_many_channel_history_files');
    for(const name of channelNames){
      const fileDay=name.slice(0,10),channelId=name.slice(19,-5),creator=resolveCreatorChannel(channelId);if(!creator)throw new Error('unknown_channel_history');
      const stored=validateReceipt(await privateRead(path.join(stateDir,name),null,131072),fileDay,[creator]);
      if(stored.observations.length>25)throw new Error('invalid_channel_history');history.push(...stored.observations);
      if(fileDay===day){if(!budget.reservations.some(row=>row.channelId===channelId))throw new Error('cache_without_discovery_reservation');cache.set(channelId,cachedResult(stored,creator));}
    }
    // Summary variants never multiply baseline samples or CPU work. Keep only
    // actual channel/video/time snapshots, then cap the indexed channel window.
    const indexed=new Map();
    for(const row of history){const key=row.channelId+':'+row.videoId+':'+row.observedAt;if(!indexed.has(key))indexed.set(key,row);}
    const historyByChannel=new Map();
    for(const row of [...indexed.values()].sort((a,b)=>Date.parse(b.observedAt)-Date.parse(a.observedAt))){const rows=historyByChannel.get(row.channelId)??[];if(rows.length<512)rows.push(row);historyByChannel.set(row.channelId,rows);}
    const existing=await privateRead(receiptFile,null);
    if(existing)return {...validateReceipt(existing,day,creators),receiptFile,reused:true,networkRequestsThisInvocation:0,budget:{cap:DAILY_RSS_CAP,used:budget.used,remaining:Math.max(0,DAILY_RSS_CAP-budget.used)}};
    const queue=[],results=new Map(cache),unknown=channel=>budget.reservations.some(row=>row.channelId===channel);
    const unavailable=(creator,reason)=>({feed:{creatorId:creator.id,channelId:creator.channelId,sourceUrl:feedUrl(creator.channelId),status:'unavailable',reason},observations:[],rejected:[]});
    // Reserve durably before the first request. A crash/lost ACK consumes its
    // slot and cannot cause another request via a different manual creator set.
    for(const creator of creators){
      if(results.has(creator.channelId))continue;
      if(!selectCreators(now).some(row=>row.channelId===creator.channelId)){results.set(creator.channelId,unavailable(creator,'challenger_not_due_today'));continue;}
      if(unknown(creator.channelId)){results.set(creator.channelId,unavailable(creator,'reserved_request_outcome_unknown'));continue;}
      if(budget.used>=DAILY_RSS_CAP){results.set(creator.channelId,unavailable(creator,'daily_rss_cap_reached'));continue;}
      budget.reservations.push({creatorId:creator.id,channelId:creator.channelId,reservedAt:now.toISOString()});budget.used++;queue.push(creator);
    }
    await atomicPrivateWrite(budgetFile,budget);
    let cursor=0,requests=0;
    async function worker(){while(cursor<queue.length){const creator=queue[cursor++];let result;
      const elapsed=clock()-started;
      if(elapsed<0||elapsed>=DISCOVERY_DEADLINE_MS||abort.signal.aborted||new Date(+now+elapsed).toISOString().slice(0,10)!==day)result=unavailable(creator,'discovery_deadline_or_day_changed');
      else try {requests++;const parsed=await fetchYouTubeFeed(creator,{fetchImpl,now:new Date(+now+elapsed),timeoutMs:Math.min(10_000,DISCOVERY_DEADLINE_MS-elapsed),signal:abort.signal});result={feed:{creatorId:creator.id,channelId:creator.channelId,sourceUrl:feedUrl(creator.channelId),status:'observed',feedSha256:parsed.feedSha256},observations:parsed.observations,rejected:parsed.rejected};}
      catch(error){const message=String(error?.message);const reason=/^[a-z][a-z0-9_]{1,80}$/.test(message)?message:error?.name==='TimeoutError'?'feed_timeout':'feed_unavailable';result=unavailable(creator,reason);}
      results.set(creator.channelId,result);
      const channelReceipt={schemaVersion:2,day,observedAt:new Date(+now+clock()-started).toISOString(),paidSpendUsd:0,permission:'unknown',mayPublish:false,eligibleAssets:0,networkRequests:0,feeds:[result.feed],observations:result.observations};
      await privateCreate(path.join(stateDir,`${day}-channel-${creator.channelId}.json`),channelReceipt);
    }}
    const workers=await Promise.allSettled([worker(),worker()]);
    const failed=workers.find(result=>result.status==='rejected');if(failed)throw failed.reason;
    const feeds=creators.map(row=>results.get(row.channelId).feed),rejected=[],unique=new Map();
    for(const creator of creators){const result=results.get(creator.channelId);rejected.push(...result.rejected.map(row=>({creatorId:creator.id,...row})));for(const row of result.observations){const key=canonicalSourceIdentity(row.videoId);if(!unique.has(key))unique.set(key,{...row,creatorGroupId:creator.creatorGroupId,sourceIdentity:key,originalEpisodeId:null,independentExperiment:false});}}
    const observations=[...unique.values()].sort((a,b)=>(a.freshness==='stale')-(b.freshness==='stale')||b.publishedAt.localeCompare(a.publishedAt));
    const observedFeeds=feeds.filter(row=>row.status==='observed').length;
    const receipt={schemaVersion:2,day,observedAt:new Date(+now+clock()-started).toISOString(),paidSpendUsd:0,mayPublish:false,status:observedFeeds===0?'blocked_no_feed_observations':observedFeeds===feeds.length?'observed':'partial',permission:'unknown',networkRequests:requests,feeds,rejected,observations:observations.map(row=>({...row,research:classifyDiscovery(row,historyByChannel.get(row.channelId)??[])})),eligibleAssets:0,
      budget:{cap:DAILY_RSS_CAP,used:budget.used,remaining:Math.max(0,DAILY_RSS_CAP-budget.used)},priorityChannels:PRIORITY_CREATORS.length,challengerSlots:1,challengerPairDays:2,challengerRotationDays:14,notice:'Public metadata is not rights approval, an independent source experiment, or proof of our account improvement.'};
    await privateCreate(receiptFile,receipt);
    return {...receipt,receiptFile,reused:requests===0&&cache.size>0,networkRequestsThisInvocation:requests};
  }finally{clearTimeout(timer);await unlink(lockFile);}
}

async function main(args) {
  let stateDir = DEFAULT_DISCOVERY_STATE_DIR;
  let creatorIds;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--state-dir' && args[i + 1]) stateDir = args[++i];
    else if (args[i] === '--creators' && args[i + 1]) creatorIds = args[++i].split(',');
    else throw new Error('usage_node_script_clippers_portfolio_discovery_state_dir_or_creators');
  }
  if(stateDir!==DEFAULT_DISCOVERY_STATE_DIR)throw new Error('canonical_operational_discovery_directory_required');
  const result = await runPortfolioDiscovery({ stateDir, creatorIds });
  console.log(JSON.stringify({ day: result.day, status: result.status, feeds: result.feeds, observations: result.observations.length,
    eligibleAssets: 0, paidSpendUsd: 0, mayPublish: false, reused: result.reused,
    networkRequestsThisInvocation: result.networkRequestsThisInvocation, receiptFile: result.receiptFile ?? null }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
