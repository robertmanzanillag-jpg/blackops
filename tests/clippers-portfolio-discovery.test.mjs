import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import {constants} from 'node:fs';
import { ALL_DISCOVERY_CREATORS } from '../shared/clippers-priority-creators.mjs';
import { mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  DISCOVERY_CREATORS, PRIORITY_CREATORS, CHALLENGER_CREATORS, DEFAULT_DISCOVERY_STATE_DIR, feedUrl, assertFeedUrl, parseYouTubeFeed, fetchYouTubeFeed,
  selectCreators, classifyDiscovery, runPortfolioDiscovery,
} from '../script/clippers-portfolio-discovery.mjs';

const creator = DISCOVERY_CREATORS[0];
const NOW = new Date('2026-11-18T10:00:00Z');
const entry = ({ id = 'abcdefghijk', at = '2026-11-18T09:00:00Z', title = 'Gaming &amp; GTA VI', views = '40', channelId = creator.channelId } = {}) =>
  `<entry><yt:videoId>${id}</yt:videoId><yt:channelId>${channelId}</yt:channelId><title>${title}</title><published>${at}</published>${views === null ? '' : `<media:group><media:community><media:statistics views="${views}"/></media:community></media:group>`}</entry>`;
const feed = (entries = entry(), channelId = creator.channelId) =>
  `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/"><yt:channelId>${channelId.slice(2)}</yt:channelId><title>Example official feed</title><author><uri>https://www.youtube.com/channel/${channelId}</uri></author>${entries}</feed>`;
const response = (xml = feed(), init = {}) => new Response(xml, { status: 200, headers: { 'Content-Type': 'application/atom+xml; charset=UTF-8' }, ...init });

test('fixed catalogue covers requested creators and languages without caller URL overrides', () => {
  assert.equal(DISCOVERY_CREATORS.length, 8);
  for (const id of ['thegrefg', 'vegetta777', 'rubius', 'lacy']) assert.ok(DISCOVERY_CREATORS.some(row => row.id === id));
  assert.deepEqual([...new Set(DISCOVERY_CREATORS.map(row => row.language))].sort(), ['de', 'en', 'es', 'fr', 'ja', 'pt-BR']);
  const day1=selectCreators(NOW);assert.equal(day1.length,14);
  assert.deepEqual(day1.slice(0,13),PRIORITY_CREATORS);
  const aligned=Math.floor(+NOW/(2*86400000))*2*86400000;
  const challengers=Array.from({length:14},(_,i)=>selectCreators(new Date(aligned+i*86400000))[13].id);
  for(let i=0;i<14;i+=2)assert.equal(challengers[i],challengers[i+1]);
  assert.equal(new Set(challengers).size,CHALLENGER_CREATORS.length);
  assert.deepEqual(selectCreators(NOW,['lacy','thegrefg']).map(row=>row.id),['thegrefg','lacy']);
  assert.throws(()=>selectCreators(NOW,['lacy','lacy']),/unique/);
  assert.throws(()=>selectCreators(NOW,['unknown']),/catalogue/);
  assert.throws(()=>selectCreators(NOW,[...PRIORITY_CREATORS,...CHALLENGER_CREATORS].slice(0,15).map(row=>row.id)),/fourteen/);
});

test('feed transport rejects SSRF, credentials, ports, encoded paths, query pollution and aliases', () => {
  assert.equal(assertFeedUrl(feedUrl(creator.channelId)), feedUrl(creator.channelId));
  for (const url of [
    'http://www.youtube.com/feeds/videos.xml?channel_id=' + creator.channelId,
    'https://127.0.0.1/feeds/videos.xml?channel_id=' + creator.channelId,
    'https://www.youtube.com.evil.test/feeds/videos.xml?channel_id=' + creator.channelId,
    'https://user:secret@www.youtube.com/feeds/videos.xml?channel_id=' + creator.channelId,
    'https://www.youtube.com:444/feeds/videos.xml?channel_id=' + creator.channelId,
    'https://www.youtube.com/%66eeds/videos.xml?channel_id=' + creator.channelId,
    feedUrl(creator.channelId) + '&url=http://localhost', feedUrl(creator.channelId) + '&channel_id=' + creator.channelId,
    feedUrl(creator.channelId) + '#x',
    feedUrl(creator.channelId) + '#',
  ]) assert.throws(() => assertFeedUrl(url));
});

test('direct feed retains exact identity, source timestamp and actual views but grants no rights', () => {
  const { observations, rejected } = parseYouTubeFeed(feed(), creator, NOW.toISOString());
  assert.equal(rejected.length, 0);
  assert.equal(observations[0].channelId, creator.channelId);
  assert.equal(observations[0].videoId, 'abcdefghijk');
  assert.equal(observations[0].publishedAt, '2026-11-18T09:00:00.000Z');
  assert.equal(observations[0].observedAt, NOW.toISOString());
  assert.equal(observations[0].views, 40);
  assert.equal(observations[0].title, 'Gaming & GTA VI');
  assert.equal(observations[0].topicHint, 'gta');
  assert.equal(observations[0].permission, 'unknown');
  assert.equal(observations[0].mayPublish, false);
  assert.equal(observations[0].language, null); // A creator's usual language cannot prove this video's language.
  assert.equal(observations[0].format, 'unknown');
});

test('missing/non-numeric views remain unknown instead of zero or a fabricated estimate', () => {
  for (const views of [null, 'unknown', '9999999999999999999999999999999']) {
    const row = parseYouTubeFeed(feed(entry({ views })), creator, NOW.toISOString()).observations[0];
    assert.equal(row.views, null);
    assert.equal(classifyDiscovery(row, []).status, 'views_unknown');
  }
});

test('stale dates remain historical and future timestamps are held, not rewritten to now', () => {
  const old = entry({ at: '2026-11-14T09:00:00Z' });
  const future = entry({ id: 'bcdefghijkl', at: '2026-11-19T09:00:00Z' });
  const result = parseYouTubeFeed(feed(old + future), creator, NOW.toISOString());
  assert.equal(result.observations[0].freshness, 'stale');
  assert.equal(result.observations[0].publishedAt, '2026-11-14T09:00:00.000Z');
  assert.deepEqual(result.rejected, [{ videoId: 'bcdefghijkl', reason: 'future_published_at' }]);
});

test('rejects DTD/entities, CDATA, oversized/partial XML, duplicate entries and mismatched source identity', () => {
  const bad = [
    '<!DOCTYPE feed [<!ENTITY x SYSTEM "file:///etc/passwd">]>' + feed(),
    feed(entry({ title: '&secret;' })), feed(entry({ title: '<![CDATA[text]]>' })),
    feed(entry() + entry()), feed(entry(), DISCOVERY_CREATORS[1].channelId),
    feed(entry({ channelId: DISCOVERY_CREATORS[1].channelId })), feed().replace('</entry>', ''),
    feed().replace(`<uri>https://www.youtube.com/channel/${creator.channelId}</uri>`, '<uri>https://www.youtube.com/channel/other</uri>'),
    feed(' '.repeat(262_145)),
  ];
  for (const xml of bad) assert.throws(() => parseYouTubeFeed(xml, creator, NOW.toISOString()));
});

test('transport uses public GET without redirects/auth and bounds response size/content type', async () => {
  let actual;
  await fetchYouTubeFeed(creator, { now: NOW, fetchImpl: async (url, options) => { actual = { url, options }; return response(); } });
  assert.equal(actual.options.method, 'GET'); assert.equal(actual.options.redirect, 'error');
  assert.equal(actual.options.credentials, 'omit'); assert.equal(actual.options.headers.Authorization, undefined);
  for (const result of [response('html', { headers: { 'Content-Type': 'text/html' } }), response('x'.repeat(262_145)),
    { ...response(), status: 200, redirected: true }, response('', { status: 429 })]) {
    await assert.rejects(fetchYouTubeFeed(creator, { now: NOW, fetchImpl: async () => result }));
  }
});

test('velocity requires two actual same-video snapshots at least one hour apart and excludes future/decreased values', () => {
  const row = parseYouTubeFeed(feed(), creator, NOW.toISOString()).observations[0];
  const earlier = { ...row, observedAt: '2026-11-18T09:00:00Z', views: 10 };
  assert.equal(classifyDiscovery(row, [earlier]).viewsPerHour, 30);
  assert.equal(classifyDiscovery(row, [{ ...earlier, observedAt: '2026-11-18T09:30:00Z' }]).viewsPerHour, null);
  assert.equal(classifyDiscovery(row, [{ ...earlier, observedAt: '2026-11-19T09:00:00Z' }]).viewsPerHour, null);
  assert.equal(classifyDiscovery(row, [{ ...earlier, views: 41 }]).viewsPerHour, null);
  const resetRow = { ...row, publishedAt: '2026-11-18T07:00:00Z' };
  assert.equal(classifyDiscovery(resetRow, [
    { ...earlier, publishedAt: resetRow.publishedAt, observedAt: '2026-11-18T08:00:00Z', views: 5 },
    { ...earlier, publishedAt: resetRow.publishedAt, views: 41 },
  ]).viewsPerHour, null);
  assert.equal(classifyDiscovery(row, [{ ...earlier, metricEvidence: 'reported_only' }]).viewsPerHour, null);
  assert.equal(classifyDiscovery(row, [{ ...earlier, publishedAt: '2026-11-17T09:00:00Z' }]).viewsPerHour, null);
});

test('comparison requires five unique videos from same channel, language, format and observation age', () => {
  const row = { ...parseYouTubeFeed(feed(), creator, NOW.toISOString()).observations[0], language: 'es', format: 'long_form' };
  const baseline = Array.from({ length: 5 }, (_, i) => ({ ...row, videoId: `baseline00${i}`, views: 10 }));
  assert.equal(classifyDiscovery(row, baseline).outlierRatio, 4);
  assert.equal(classifyDiscovery(row, [...baseline.slice(0, 4), baseline[0]]).outlierRatio, null);
  for (const delta of [{ channelId: 'other' }, { language: 'en' }, { format: 'short' }, { publishedAt: '2026-11-18T06:00:00Z' }]) {
    assert.equal(classifyDiscovery(row, baseline.map(item => ({ ...item, ...delta }))).outlierRatio, null);
  }
  assert.equal(classifyDiscovery({ ...row, format: 'unknown' }, baseline).status, 'comparison_context_unknown');
  assert.equal(classifyDiscovery(row, baseline.map(item => ({ ...item, publishedAt: '2026-11-19T09:00:00Z' }))).outlierRatio, null);
});

test('daily receipt is private, durable and idempotent; incomplete feeds persist truthful status with zero eligible assets', async () => {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'portfolio-discovery-')));
  let calls = 0;
  const fetchImpl = async () => { calls++; return response(); };
  try {
    const first = await runPortfolioDiscovery({ stateDir: dir, now: NOW, creatorIds: [creator.id], fetchImpl });
    assert.equal(first.observations.length, 1); assert.equal(calls, 1);
    assert.equal(first.eligibleAssets, 0); assert.equal(first.mayPublish, false);
    assert.equal((await stat(first.receiptFile)).mode & 0o777, 0o600);
    assert.equal(JSON.parse(await readFile(first.receiptFile, 'utf8')).observations[0].views, 40);
    const replay = await runPortfolioDiscovery({ stateDir: dir, now: NOW, creatorIds: [creator.id], fetchImpl });
    assert.equal(replay.reused, true); assert.equal(replay.networkRequestsThisInvocation, 0); assert.equal(calls, 1);
    const original = await readFile(first.receiptFile, 'utf8');
    await writeFile(first.receiptFile, JSON.stringify({ ...JSON.parse(original), permission: 'approved', mayPublish: true }));
    await assert.rejects(runPortfolioDiscovery({ stateDir: dir, now: NOW, creatorIds: [creator.id], fetchImpl }), /invalid_discovery_receipt/);
    assert.equal(calls, 1);
    await writeFile(first.receiptFile, original);
    const next = await runPortfolioDiscovery({ stateDir: dir, now: new Date(+NOW + 86_400_000), creatorIds: [creator.id],
      fetchImpl: async () => response('', { status: 429 }) });
    assert.equal(next.feeds[0].status, 'unavailable'); assert.equal(next.feeds[0].reason, 'feed_throttled');
    assert.equal(next.observations.length, 0); assert.equal(next.eligibleAssets, 0);
    assert.equal((await readdir(dir)).filter(name => /^\d{4}-\d\d-\d\d-v2-[a-f0-9]{16}\.json$/.test(name)).length, 2);
    for(const day of [NOW.toISOString().slice(0,10),new Date(+NOW+86400000).toISOString().slice(0,10)]){const budget=JSON.parse(await readFile(path.join(dir,`.rss-budget-${day}.json`),'utf8'));assert.equal(budget.used,1);assert.equal(budget.cap,14);}
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('symlink storage roots cannot redirect receipts into another workspace', async () => {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'portfolio-discovery-')));
  try {
    await mkdirSafe(path.join(dir, 'actual'));
    await symlink(path.join(dir, 'actual'), path.join(dir, 'link'));
    await assert.rejects(runPortfolioDiscovery({ stateDir: path.join(dir, 'link'), now: NOW, fetchImpl:publicFake(), creatorIds: [creator.id] }), /symlink/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

async function mkdirSafe(dir) { const { mkdir } = await import('node:fs/promises'); await mkdir(dir, { mode: 0o700 }); }

const newDir=async()=>await realpath(await mkdtemp(path.join(os.tmpdir(),'discovery-budget-')));
const publicFake=(onCall=()=>{})=>async(url,options)=>{
  const channelId=new URL(url).searchParams.get('channel_id');onCall(channelId,options);
  return response(feed(entry({channelId,id:channelId.slice(2,13)}),channelId));
};
test('daily default reserves14 durable slots, concurrency2 and all13 priorities; variants/cache cannot spend again',async()=>{
 const dir=await newDir();let calls=0,active=0,max=0;
 const fetchImpl=async(url,opt)=>{calls++;active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,2));active--;return publicFake()(url,opt);};
 try{
  const first=await runPortfolioDiscovery({stateDir:dir,now:NOW,fetchImpl});assert.equal(calls,14);assert.equal(max,2);assert.equal(first.schemaVersion,2);assert.equal(first.feeds.length,14);assert.equal(first.priorityChannels,13);assert.equal(first.budget.used,14);assert.equal(first.budget.remaining,0);
  assert.deepEqual(first.feeds.slice(0,13).map(r=>r.channelId),PRIORITY_CREATORS.map(r=>r.channelId));
  assert.ok(first.observations.every(r=>r.originalEpisodeId===null&&r.independentExperiment===false&&r.language===null&&r.format==='unknown'&&r.research.growthStatus==='first_snapshot_baseline'));
  const replay=await runPortfolioDiscovery({stateDir:dir,now:NOW,fetchImpl});assert.equal(replay.networkRequestsThisInvocation,0);assert.equal(replay.reused,true);
  for(const row of ALL_DISCOVERY_CREATORS)await runPortfolioDiscovery({stateDir:dir,now:NOW,creatorIds:[row.id],fetchImpl});assert.equal(calls,14);
  const budget=JSON.parse(await readFile(path.join(dir,'.rss-budget-2026-11-18.json'),'utf8'));assert.equal(budget.used,14);assert.equal(budget.reservations.length,14);assert.equal((await stat(path.join(dir,'.rss-budget-2026-11-18.json'))).mode&0o777,0o600);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('manual configuration churn cannot consume more than one challenger slot or starve priority budget',async()=>{
 const dir=await newDir();let calls=0;
 try{const fetchImpl=publicFake(()=>calls++);const due=selectCreators(NOW)[13];
  for(const c of CHALLENGER_CREATORS){const result=await runPortfolioDiscovery({stateDir:dir,now:NOW,creatorIds:[c.id],fetchImpl});assert.equal(result.networkRequestsThisInvocation,c.id===due.id?1:0);if(c.id!==due.id)assert.equal(result.feeds[0].reason,'challenger_not_due_today');}
  const full=await runPortfolioDiscovery({stateDir:dir,now:NOW,fetchImpl});assert.equal(calls,14);assert.equal(full.feeds.filter(f=>f.status==='observed').length,14);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('legacy receipts today consume global budget and remain byte intact; first upgrade is honestly partial',async()=>{
 const dir=await newDir();let calls=0;
 try{const old=DISCOVERY_CREATORS.slice(0,4);const legacy={schemaVersion:1,day:'2026-11-18',observedAt:NOW.toISOString(),paidSpendUsd:0,mayPublish:false,permission:'unknown',eligibleAssets:0,networkRequests:4,feeds:old.map(c=>({creatorId:c.id,channelId:c.channelId,sourceUrl:feedUrl(c.channelId),status:'observed',feedSha256:'a'.repeat(64)})),observations:old.flatMap(c=>parseYouTubeFeed(feed(entry({channelId:c.channelId,id:c.channelId.slice(2,13)}),c.channelId),c,NOW.toISOString()).observations)};
 const file=path.join(dir,'2026-11-18-0000000000000000.json'),raw=JSON.stringify(legacy);await writeFile(file,raw,{mode:0o600});
 const result=await runPortfolioDiscovery({stateDir:dir,now:NOW,fetchImpl:publicFake(()=>calls++)});assert.equal(calls,10);assert.equal(result.budget.used,14);assert.equal(await readFile(file,'utf8'),raw);
 const budget=JSON.parse(await readFile(path.join(dir,'.rss-budget-2026-11-18.json'),'utf8'));assert.equal(budget.importedRequests,4);assert.equal(budget.reservations.length,10);
 await runPortfolioDiscovery({stateDir:dir,now:NOW,creatorIds:[PRIORITY_CREATORS[0].id],fetchImpl:publicFake(()=>calls++)});assert.equal(calls,10);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('two concurrent invocations share exclusive journal and cannot exceed14 requests',async()=>{
 const dir=await newDir();let calls=0;
 try{const fetchImpl=async(url,opts)=>{calls++;await new Promise(r=>setTimeout(r,3));return publicFake()(url,opts);};const results=await Promise.allSettled([runPortfolioDiscovery({stateDir:dir,now:NOW,fetchImpl}),runPortfolioDiscovery({stateDir:dir,now:NOW,fetchImpl})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.code==='EEXIST').length,1);assert.equal(calls,14);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('lost outcome stays reserved with no automatic replay, even after changing manual creator set',async()=>{
 const dir=await newDir();let calls=0;
 try{const c=PRIORITY_CREATORS[0],fetchImpl=publicFake(()=>calls++);await runPortfolioDiscovery({stateDir:dir,now:NOW,creatorIds:[c.id],fetchImpl});
 for(const name of await readdir(dir))if(name.startsWith('2026-11-18-v2-')||name.startsWith('2026-11-18-channel-'))await rm(path.join(dir,name));
 const held=await runPortfolioDiscovery({stateDir:dir,now:NOW,creatorIds:[c.id,PRIORITY_CREATORS[1].id],fetchImpl});assert.equal(calls,2);assert.equal(held.feeds[0].reason,'reserved_request_outcome_unknown');assert.equal(held.budget.used,2);
 const replay=await runPortfolioDiscovery({stateDir:dir,now:NOW,creatorIds:[c.id],fetchImpl});assert.equal(replay.networkRequestsThisInvocation,0);assert.equal(calls,2);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('missing or corrupted journal with existing v2 evidence fails closed rather than resetting spend',async()=>{
 const dir=await newDir();let calls=0;
 try{const fetchImpl=publicFake(()=>calls++);await runPortfolioDiscovery({stateDir:dir,now:NOW,creatorIds:[PRIORITY_CREATORS[0].id],fetchImpl});await rm(path.join(dir,'.rss-budget-2026-11-18.json'));
 await assert.rejects(runPortfolioDiscovery({stateDir:dir,now:NOW,creatorIds:[PRIORITY_CREATORS[1].id],fetchImpl}),/missing_discovery_budget/);assert.equal(calls,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('deadline/day boundary stops undispatched reserved requests and transport timeout bounds a stalled fake',async()=>{
 for(const [date,elapsed]of[[NOW,90001],[new Date('2026-11-18T23:59:59.900Z'),500]]){const dir=await newDir();let ticks=0,calls=0;try{const result=await runPortfolioDiscovery({stateDir:dir,now:date,clock:()=>ticks++===0?0:elapsed,fetchImpl:publicFake(()=>calls++)});assert.equal(calls,0);assert.equal(result.budget.used,14);assert.ok(result.feeds.every(f=>f.reason==='discovery_deadline_or_day_changed'));}finally{await rm(dir,{recursive:true,force:true});}}
 const start=Date.now();await assert.rejects(fetchYouTubeFeed(creator,{now:NOW,timeoutMs:10,fetchImpl:()=>new Promise(()=>{})}),/feed_timeout/);assert.ok(Date.now()-start<1000);
});
test('native production transport cannot select an alternate state root to reset the daily cap',async()=>{
 const dir=await newDir();try{assert.notEqual(dir,DEFAULT_DISCOVERY_STATE_DIR);await assert.rejects(runPortfolioDiscovery({stateDir:dir,now:NOW}),/canonical_operational/);}finally{await rm(dir,{recursive:true,force:true});}
});

test('unchanged public counter retains measured zero without a positive-growth claim',()=>{
 const row=parseYouTubeFeed(feed(),creator,NOW.toISOString()).observations[0];const prior={...row,observedAt:'2026-11-18T09:00:00Z'};
 const result=classifyDiscovery(row,[prior]);assert.equal(result.viewsPerHour,0);assert.equal(result.growthStatus,'public_counter_unchanged');assert.equal(result.causalClaim,false);
});
test('private reader rejects FIFO and oversized input without hanging or requesting a feed',async()=>{
 const dir=await newDir();try{
 const budget=path.join(dir,'.rss-budget-2026-11-18.json');const made=spawnSync('mkfifo',['-m','600',budget]);assert.equal(made.status,0);
 const url=new URL('../script/clippers-portfolio-discovery.mjs',import.meta.url).href;
 const code=`import {runPortfolioDiscovery} from ${JSON.stringify(url)};try{await runPortfolioDiscovery({stateDir:${JSON.stringify(dir)},now:new Date('2026-11-18T10:00:00Z'),fetchImpl:async()=>{throw Error('NO_NETWORK')}});process.exit(2)}catch(error){console.log(error.message)}`;
 const child=spawnSync(process.execPath,['--input-type=module','-e',code],{timeout:2000,encoding:'utf8',env:{PATH:process.env.PATH,HOME:dir}});assert.equal(child.status,0,child.error?.message);assert.match(child.stdout,/private_discovery_file_required/);
 await rm(budget);await writeFile(budget,Buffer.alloc(2097153),{mode:0o600});let calls=0;await assert.rejects(runPortfolioDiscovery({stateDir:dir,now:NOW,fetchImpl:publicFake(()=>calls++)}),/private_discovery_file_required/);assert.equal(calls,0);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('actual private-read function bounds bytes if a regular file grows after initial stat',async()=>{
 const source=await readFile(new URL('../script/clippers-portfolio-discovery.mjs',import.meta.url),'utf8');const block=source.slice(source.indexOf('async function privateRead('),source.indexOf('async function privateCreate('));let readFileCalled=false,closed=false,requested=0,flags;
 const info={isFile:()=>true,nlink:1,size:1,mode:0o600,uid:process.getuid?.(),mtimeMs:1,ctimeMs:1};
 const handle={stat:async()=>info,read:async(buffer,_offset,length)=>{requested+=length;buffer.fill(32);return{bytesRead:length}},readFile:async()=>{readFileCalled=true;return JSON.stringify({unbounded:'x'.repeat(1000)})},close:async()=>closed=true};
 const read=vm.runInNewContext(block+';privateRead',{open:async(_file,options)=>{flags=options;return handle},constants,process,Buffer});
 await assert.rejects(read('synthetic',null,16),/private_discovery_file_required/);assert.equal(requested,17);assert.equal(readFileCalled,false);assert.equal(closed,true);assert.ok(flags&constants.O_NONBLOCK);
});
test('derived summary variants neither multiply trend history nor block cached sources',async()=>{
 const dir=await newDir();let calls=0;try{const fetchImpl=publicFake(()=>calls++);await runPortfolioDiscovery({stateDir:dir,now:NOW,fetchImpl});
 await Promise.all(Array.from({length:200},(_,i)=>writeFile(path.join(dir,`2026-11-18-v2-${i.toString(16).padStart(16,'0')}.json`),'DERIVED_NOT_A_HISTORY_SOURCE',{mode:0o600})));
 const result=await runPortfolioDiscovery({stateDir:dir,now:NOW,creatorIds:[PRIORITY_CREATORS[0].id],fetchImpl});assert.equal(calls,14);assert.equal(result.networkRequestsThisInvocation,0);assert.equal(result.feeds[0].status,'observed');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('native refusal does not create an alternate directory before reporting canonical-root policy',async()=>{
 const dir=await newDir();try{const absent=path.join(dir,'must-stay-absent');await assert.rejects(runPortfolioDiscovery({stateDir:absent,now:NOW}),/canonical_operational/);await assert.rejects(stat(absent),{code:'ENOENT'});}finally{await rm(dir,{recursive:true,force:true});}
});
