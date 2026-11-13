import test from "node:test";
import assert from "node:assert/strict";
import { proposeManualExploration, sharedManualExploration } from "../server/blackroom-manual-exploration";
import { applyLocalEditorialReport, assessLocalBlackRoomExports, emptyEvidence } from "../server/blackroom-local-evidence";
import { planBlackRoomDeterministicEdit } from "../server/blackroom-deterministic-editor";
import { evaluateBlackRoomLearning, evaluateDurationLearning, BLACKROOM_DURATION_TEST_ID } from "../server/blackroom-verified-learning";
const now=new Date("2026-11-04T12:00:00Z");
function report() {
  return {mode:"observational-only",evaluatedAt:now.toISOString(),deliveries:[15,30].flatMap(durationSeconds=>Array.from({length:5},(_,i)=>{
    const observation={network:"youtube",postId:`${durationSeconds}-${i}`,views:durationSeconds===30?200:50,
      publishedAt:"2026-11-03T12:00:00Z",observedAt:now.toISOString()};
    return {status:"observed",network:"youtube",platformPostId:observation.postId,dj:`DJ${i%2}`,durationSeconds,observation,
      snapshots:[{...observation,windowHours:24,ageHours:24}]};
  }))} as any;
}
test("descriptive age-matched samples propose a question, never a controlled winner",()=>{
  const h=proposeManualExploration(report(),now);
  assert.equal(h.youtube?.durationSeconds,30);
  assert.equal(h.youtube?.mode,"observational-hypothesis");
  assert.equal(sharedManualExploration(h,["youtube","tiktok"],now),null);
  assert.equal(sharedManualExploration({...h,tiktok:{...h.youtube!,durationSeconds:15}},["youtube","tiktok"],now),null);
  assert.equal(sharedManualExploration({...h,tiktok:h.youtube},["youtube","tiktok"],now),30);
  assert.equal(sharedManualExploration(h,["youtube"],new Date("2026-11-07")),null);
  assert.deepEqual(proposeManualExploration(report(),new Date("2026-11-07")),{});
  for(const mutation of [
    (r:any)=>r.deliveries.pop(),
    (r:any)=>r.deliveries.forEach((d:any)=>d.dj="same"),
    (r:any)=>r.deliveries.forEach((d:any)=>d.snapshots[0].ageHours=72),
    (r:any)=>r.deliveries.forEach((d:any)=>d.status="identity-conflict"),
    (r:any)=>r.deliveries.forEach((d:any)=>d.observation.observedAt="2026-11-02T12:00:00Z"),
    (r:any)=>r.deliveries.forEach((d:any)=>d.snapshots=[]),
    (r:any)=>r.deliveries.forEach((d:any)=>{d.platformPostId=String(d.durationSeconds);d.observation.postId=d.platformPostId;d.snapshots[0].postId=d.platformPostId;}),
  ]) {const r=report();mutation(r);assert.deepEqual(proposeManualExploration(r,now),{});}
});
test("actual next edit consumes exploratory duration without quota or controlled-test mutation",()=>{
  const base=assessLocalBlackRoomExports(emptyEvidence(),[],[],now).report;
  const remote={verifiedLearning:base.decisions} as any;
  const evidence=applyLocalEditorialReport(remote,{...base,manualObservations:report()},now);
  for (const count of [3,4,5]) {
  const queue={enabled:true,sourceHistory:[],prioritySources:[],analytics:remote,
    jobs:[{id:"manual-next",targetDate:"2026-11-04",status:"queued",
      slots:["13:00","14:00","15:00","16:00","17:00"].slice(0,count).map(localTime=>({localTime,networks:["youtube"]})),
      requirements:{posts:count,djs:1,postsPerDj:count,durationsSeconds:[15,30,60]}}]} as any;
  const ledger={version:1,entries:queue.jobs[0].slots.slice(0,count-1).map((s:any,i:number)=>({jobId:"manual-next",slot:s.localTime,status:"confirmed",videoId:`old${i}`,dj:"DJ NEW"}))} as any;
  const plan=(analytics:any)=>planBlackRoomDeterministicEdit({now,queue:{...queue,analytics},ledger,
    inventory:[{id:"source",title:"DJ NEW - DJ Set",duration:3600}]});
  const before=JSON.stringify(queue);
  const first=planBlackRoomDeterministicEdit({now,queue:{...queue,analytics:evidence},ledger:{version:1,entries:[]},
    inventory:[{id:"source",title:"DJ NEW - DJ Set",duration:3600}]});
  assert.equal(first?.durationSeconds,15);
  assert.notEqual(first?.learningTestId,"manual-observational-followup-v1");
  assert.equal(plan(remote)?.durationSeconds,15);
  const after=plan(evidence)!;
  assert.ok(after);
  assert.equal(after.durationSeconds,30);
  assert.equal(after.learningTestId,"manual-observational-followup-v1");
  assert.equal(after.allocationMode,"explore");
  const evalInput={now,snapshots:[],sourceObservedAt:{youtube:now.toISOString()},experiments:[{...after,network:"youtube",reservationId:"followup",platformPostId:"qNIUn8ZDoRs",sourceVideoId:after.videoId}]} as any;
  assert.equal(evaluateDurationLearning(evalInput).youtube.declared,0);
  assert.equal(evaluateBlackRoomLearning(evalInput).youtube.exactIdentities,0);
  assert.equal(evaluateDurationLearning({...evalInput,experiments:[{...evalInput.experiments[0],learningTestId:BLACKROOM_DURATION_TEST_ID}]}).youtube.declared,1);
  assert.equal(after.slot,`${12+count}:00`);
  assert.equal(JSON.stringify(queue),before);
  assert.equal(plan({...evidence,manualExploration:{}})?.durationSeconds,15);
  queue.jobs[0].slots[count-1].networks.push("tiktok");
  assert.equal(plan(evidence)?.durationSeconds,15); // YouTube cannot dictate a shared TikTok asset.
  }
});

test("margin and genuine acquisition boundaries are enforced",()=>{
  for (const [views,expected] of [[59,false],[60,true],[50,false]] as const) {
    const r=report();r.deliveries.filter((d:any)=>d.durationSeconds===30).forEach((d:any)=>d.snapshots[0].views=views);
    assert.equal(!!proposeManualExploration(r,now).youtube,expected);
  }
  const r=report();r.deliveries.forEach((d:any)=>{d.snapshots[0].publishedAt="2026-11-03T06:00:00Z";d.snapshots[0].ageHours=30;});
  assert.deepEqual(proposeManualExploration(r,now),{});
});

test("even cohorts use averaged medians, not upper-middle outliers",()=>{
  const r=report();
  for(const duration of [15,30]) {
    const extra=structuredClone(r.deliveries.find((d:any)=>d.durationSeconds===duration));
    extra.platformPostId=`${duration}-extra`;extra.observation.postId=extra.platformPostId;extra.snapshots[0].postId=extra.platformPostId;
    r.deliveries.push(extra);
    r.deliveries.filter((d:any)=>d.durationSeconds===duration).forEach((d:any,i:number)=>{d.snapshots[0].views=duration===15?40:i<3?1:71;});
  }
  assert.deepEqual(proposeManualExploration(r,now),{});
});
