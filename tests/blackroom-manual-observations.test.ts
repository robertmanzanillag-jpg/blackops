import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { manualClips, publishedCalendarReceipts, emptyCalendarReceipts, reconcileManualObservations } from "../server/blackroom-manual-observations";
import { collectBlackRoomPublicationReceipts } from "../script/blackroom-publication-collector";
import { refreshLocalBlackRoomEvidence, manualReceiptPaths } from "../script/blackroom-local-evidence";

const now = new Date("2026-11-05T23:30:00Z");
const row = { plannerId:"123", networks:["youtube"], dj:"DJ", durationSeconds:15, sourceId:"abcdefghijk", startSeconds:100,
  scheduledLocal:"2026-11-04T18:00:00", timezone:"America/New_York" };
const doc = { brandId:"6585226", state:"scheduled_not_published", rows:[row] };
const clips = manualClips([doc]);
const provider = { network:"youtube", id:"clipabcdefg", publicUrl:"https://www.youtube.com/shorts/clipabcdefg", status:"PUBLISHED" };
const calendarBody = { data:[{ id:123, providers:[provider] }] };
const receipt = publishedCalendarReceipts(calendarBody, clips, now.toISOString())[0];
const obs = { network:"youtube" as const, postId:"clipabcdefg", publishedAt:"2026-11-04T23:00:00Z", observedAt:now.toISOString(), views:125 };
const calendar = { ...emptyCalendarReceipts(), receipts:[receipt] };

test("only exact published planner/network/URL identities qualify", () => {
  assert.equal(publishedCalendarReceipts(calendarBody, clips, now.toISOString()).length,1);
  for (const p of [{...provider,status:"PENDING"},{...provider,id:"anotherid"},{...provider,network:"tiktok"},
    {...provider,publicUrl:"https://evil.example/shorts/clipabcdefg"}]) {
    assert.equal(publishedCalendarReceipts([{id:123,providers:[p]}],clips,now.toISOString()).length,0);
  }
  assert.equal(publishedCalendarReceipts([{id:124,providers:[provider]}],clips,now.toISOString()).length,0);
  assert.equal(publishedCalendarReceipts([{id:123,blogId:1,providers:[provider]}],clips,now.toISOString()).length,0);
});

test("ignore manual publicationEvidence, deduplicate identical rows, quarantine contradictory creatives",()=>{
  assert.deepEqual(manualClips([{...doc,rows:[{...row,publicationEvidence:{platformPostId:"fake"}},row]}]),clips);
  assert.equal(manualClips([{...doc,rows:[row,{...row,durationSeconds:30}]}]).length,0);
  assert.equal(manualClips([{...doc,brandId:1}]).length,0);
  assert.equal(reconcileManualObservations(clips,emptyCalendarReceipts(),[obs],[],now).awaitingPublication,1);
});

test("published without analytics stays awaiting-metrics; no zero or scheduled timestamp synthesis",()=>{
  const r = reconcileManualObservations(clips,calendar,[],[],now);
  assert.equal(r.awaitingMetrics,1);
  assert.equal(r.observed,0);
  assert.equal("observation" in r.deliveries[0],false);
});

test("observations join exact official IDs, retain real dates and never enter a controlled test",()=>{
  const r = reconcileManualObservations(clips,calendar,[obs],[],now);
  assert.equal(r.observed,1);
  const d = r.deliveries[0];
  assert.equal(d.mode,"observational");
  assert.equal(d.status,"observed");
  if(d.status==="observed")assert.deepEqual(d.observation,obs);
  assert.equal(reconcileManualObservations(clips,calendar,[{...obs,network:"tiktok"}],[],now).observed,0);
  assert.equal(reconcileManualObservations(clips,calendar,[{...obs,postId:"123"}],[],now).observed,0);
});

test("conflicting and reused provider IDs are quarantined",()=>{
  const conflict = {...calendar,receipts:[receipt,{...receipt,platformPostId:"clipabcdefh",publicUrl:"https://youtube.com/shorts/clipabcdefh"}]};
  assert.equal(reconcileManualObservations(clips,conflict,[obs],[],now).conflicts,1);
  const reused = {...calendar,receipts:[receipt,{...receipt,plannerId:"456"}]};
  assert.equal(reconcileManualObservations(clips,reused,[obs],[],now).conflicts,1);
  const measured={...obs,durationSeconds:60};
  assert.equal(reconcileManualObservations(clips,calendar,[measured],[],now).conflicts,1);
});

const env = { METRICOOL_USER_TOKEN:"test-only", METRICOOL_USER_ID:"1" };
test("producer is fixed-brand GET only, caps days, excludes future, caches successful reads",async()=>{
  const requests: URL[] = [];
  const fetcher = (async (input:any,init:any)=>{
    const u=new URL(String(input));requests.push(u);
    assert.equal(u.hostname,"app.metricool.com");assert.equal(u.pathname,"/api/v2/scheduler/posts");
    assert.equal(u.searchParams.get("blogId"),"6585226");assert.equal(init.method,"GET");assert.equal(init.redirect,"error");
    return new Response(JSON.stringify(calendarBody));
  }) as typeof fetch;
  const many = Array.from({length:10},(_,i)=>({...clips[0],scheduledLocal:`2026-11-${String(i+1).padStart(2,"0")}T18:00:00`}));
  const r=await collectBlackRoomPublicationReceipts(many,emptyCalendarReceipts(),{env,fetcher,now});
  assert.equal(requests.length,4);assert.equal(r.receipts.length,1);
  assert.equal(JSON.stringify(r).includes("test-only"),false);
  assert.ok(requests.every(u=>u.searchParams.get("start")! < "2026-11-06"));
  requests.length=0;
  await collectBlackRoomPublicationReceipts(clips,r,{env,fetcher,now});
  assert.equal(requests.length,0);
});

test("missing credentials or paid/API denial preserve pending and confirmed history",async()=>{
  const missing=await collectBlackRoomPublicationReceipts(clips,emptyCalendarReceipts(),{env:{},now});
  assert.match(missing.lastError!,/unavailable/);assert.equal(missing.receipts.length,0);
  const r=await collectBlackRoomPublicationReceipts(clips,calendar,{env,now,fetcher:(async()=>new Response("Denied",{status:403})) as typeof fetch});
  assert.deepEqual(r.receipts,calendar.receipts);assert.match(r.lastError!,/unavailable/);
  assert.deepEqual(r.checkedDays,{});
  let calls=0;
  const blockedFetch=(async()=>{calls++;return new Response("Denied",{status:403})}) as typeof fetch;
  const cooldown=await collectBlackRoomPublicationReceipts(clips,r,{env,now,fetcher:blockedFetch});
  assert.equal(calls,0);assert.equal(cooldown.lastError,r.lastError);
  await collectBlackRoomPublicationReceipts(clips,cooldown,{env,now:new Date(now.getTime()+6*3600000),fetcher:blockedFetch});
  assert.equal(calls,1);
});

test("recurring CLI opt-in path collects and reports actual manual metrics without winner assignment",async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),"br-manual-test-"));
  const old=process.env.BLACKROOM_MANUAL_RECEIPTS_PATH;
  delete process.env.BLACKROOM_MANUAL_RECEIPTS_PATH;
  try {
    await writeFile(path.join(dir,"manual-planner-receipts.json"),JSON.stringify(doc));
    await writeFile(path.join(dir,"latest-export.json"),JSON.stringify({imports:[{network:"youtube",samples:[{...obs,id:obs.postId,durationSeconds:15}]}]}));
    const result=await refreshLocalBlackRoomEvidence(dir,dir,now,{collectPublications:true,env,
      home:dir, fetcher:(async()=>new Response(JSON.stringify(calendarBody))) as typeof fetch});
    assert.equal(result.manualObservations.observed,1);assert.equal(result.unverifiedManualDeliveries,0);
    assert.equal(result.durationDecisions.youtube.recommendedSeconds,null);
    assert.equal(result.durationDecisions.youtube.exact,0);
    assert.equal(result.manualObservations.deliveries[0].status,"observed");
    const persisted=JSON.parse(await readFile(path.join(dir,"publication-receipts.json"),"utf8"));
    assert.equal(persisted.receipts[0].platformPostId,"clipabcdefg");
    const replay=await refreshLocalBlackRoomEvidence(dir,dir,new Date("2026-11-06T23:30:00Z"),{home:dir});
    assert.equal(replay.manualObservations.observed,1);
    assert.equal(replay.manualObservations.deliveries[0].status,"observed");
    if(replay.manualObservations.deliveries[0].status==="observed")assert.equal(replay.manualObservations.deliveries[0].observation.observedAt,now.toISOString());
  } finally {
    if(old===undefined)delete process.env.BLACKROOM_MANUAL_RECEIPTS_PATH;else process.env.BLACKROOM_MANUAL_RECEIPTS_PATH=old;
    await rm(dir,{recursive:true,force:true});
  }
});

test("default recurring path discovers real durable manual receipt names without env setup",async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),"br-discovery-test-"));
  try {
    const output=path.join(dir,"Documents/black room/output");await mkdir(output,{recursive:true});
    const file=path.join(output,"blackroom-recibos-2026-11-04-hyvrid.json");
    await writeFile(file,JSON.stringify(doc));
    await writeFile(path.join(output,"unrelated.json"),JSON.stringify(doc));
    await symlink(file,path.join(output,"blackroom-recibos-2026-11-03.json"));
    assert.deepEqual(await manualReceiptPaths(dir,{},dir),[path.join(dir,"manual-planner-receipts.json"),file]);
    await writeFile(path.join(dir,"latest-export.json"),JSON.stringify({imports:[]}));
    const report=await refreshLocalBlackRoomEvidence(dir,dir,now,{home:dir,env,collectPublications:true,
      fetcher:(async()=>new Response(JSON.stringify(calendarBody))) as typeof fetch});
    assert.equal(report.manualObservations.awaitingMetrics,1);
    assert.equal(report.unverifiedManualDeliveries,0);
    await rm(file);
    const retained=await refreshLocalBlackRoomEvidence(dir,dir,now,{home:dir,env});
    assert.equal(retained.manualObservations.awaitingMetrics,1);
    assert.equal(retained.manualObservations.deliveries[0].dj,"DJ");
    await writeFile(file,JSON.stringify({...doc,rows:[row,{...row,durationSeconds:30}]}));
    const conflict=await refreshLocalBlackRoomEvidence(dir,dir,now,{home:dir,env});
    assert.equal(conflict.manualObservations.deliveries.length,0);
    assert.equal(conflict.unverifiedManualDeliveries,1);
    await rm(file);
    const conflictRetained=await refreshLocalBlackRoomEvidence(dir,dir,now,{home:dir,env});
    assert.equal(conflictRetained.manualObservations.deliveries.length,0);
  } finally {await rm(dir,{recursive:true,force:true});}
});
