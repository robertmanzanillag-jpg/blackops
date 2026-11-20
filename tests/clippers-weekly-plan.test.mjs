import test from 'node:test';
import assert from 'node:assert/strict';
import { planClippersWeek, newYorkSlot } from '../script/clippers-weekly-plan.mjs';
import { DESTINATIONS } from '../script/clippers-portfolio-metricool.mjs';
const now = '2026-11-18T14:00:00Z', sha = 'a'.repeat(64);
const days = ['2026-11-18','2026-11-19','2026-11-20','2026-11-21','2026-11-22'];
const snapshots = () => DESTINATIONS.flatMap(destination => days.map(day => ({destination,day,status:'verified',complete:true,evidenceSha256:sha,observedAt:now,posts:[]})));
const base = () => ({now,snapshots:snapshots()});
const post = (hour,id='p1',destination=DESTINATIONS[0]) => ({destination,providerPostId:id,scheduledAt:newYorkSlot(days[0],hour),status:'scheduled',confirmationSha256:sha});
test('Wednesday to Sunday is 100 demand slots, 20 cells, zero ready/publication claims',()=>{
 const input=base(),before=JSON.stringify(input),p=planClippersWeek(input);
 assert.equal(p.targetPosts,100); assert.equal(p.proposedCount,100); assert.equal(p.knownDeficit,100); assert.equal(p.cells.length,20);
 assert.equal(p.providerWrites,0);assert.equal(p.mayPublish,false); assert.ok(p.cells.every(c=>c.readyAssetsVerified===null && c.proposedSlots.length===5));
 assert.equal(JSON.stringify(input),before); assert.deepEqual(planClippersWeek(input),p);
});
test('missing/stale/incomplete provider reads stay unknown, never inferred empty',()=>{
 assert.equal(planClippersWeek({now}).unknownCells,20);
 for(const mutate of [s=>s.complete=false,s=>s.observedAt='2026-11-18T13:44:59Z',s=>s.observedAt='2026-11-18T14:00:01Z',s=>s.evidenceSha256='fake']){
 const input=base();mutate(input.snapshots[0]);const p=planClippersWeek(input);assert.equal(p.unknownCells,1);assert.equal(p.cells[0].deficit,null);assert.equal(p.cells[0].proposedSlots.length,0);
 }
});
test('exact provider identity dedupes and reduces only its own destination/date',()=>{
 const b=base();const row=post(12);b.snapshots[0].posts=[row,{...row}];const p=planClippersWeek(b);
 assert.equal(p.cells[0].providerConfirmedCount,1); assert.equal(p.cells[0].deficit,4);assert.equal(p.proposedCount,99);assert.equal(p.cells[1].deficit,5);
 b.snapshots[0].posts[1].scheduledAt=newYorkSlot(days[0],14);assert.equal(planClippersWeek(b).cells[0].reason,'provider_post_identity_conflict');
});
test('five means five different local hours; no sixth to repair conflicts',()=>{
 const b=base();b.snapshots[0].posts=[12,14,16,18,20].map((h,i)=>post(h,'p'+i));assert.equal(planClippersWeek(b).cells[0].status,'covered');
 b.snapshots[0].posts[1].scheduledAt='2026-11-18T17:30:00Z';let c=planClippersWeek(b).cells[0];assert.equal(c.reason,'existing_posts_share_local_hour');assert.equal(c.proposedSlots.length,0);
 b.snapshots[0].posts.push(post(22,'p6'));assert.equal(planClippersWeek(b).cells[0].reason,'existing_daily_cap_exceeded');
});
test('unreconciled attempt blocks retries and preserves known deficit',()=>{
 const p=planClippersWeek({...base(),reservations:[{destination:DESTINATIONS[0],day:days[0],status:'outcome_unknown'}]});
 assert.equal(p.cells[0].reason,'schedule_outcome_unreconciled');assert.equal(p.cells[0].deficit,5);assert.deepEqual(p.cells[0].proposedSlots,[]);
});
test('late day reports missed slots rather than shifting to tomorrow',()=>{
 const b=base();b.now='2026-11-19T01:01:00Z';for(const s of b.snapshots)s.observedAt=b.now;
 const p=planClippersWeek(b);assert.equal(p.cells[0].reason,'insufficient_future_distinct_proposed_hours');assert.equal(p.cells[0].proposedSlots.length,0);assert.equal(p.cells[1].proposedSlots.length,5);
});
test('scope and malformed provider rows fail closed',()=>{
 for(const mutate of [s=>s.destination={...DESTINATIONS[0],brandId:6431692},s=>s.day='2026-11-23']){const b=base();mutate(b.snapshots[0]);assert.throws(()=>planClippersWeek(b),/scope/);}
 for(const mutate of [p=>p.destination=DESTINATIONS[1],p=>p.providerPostId='',p=>p.status='draft',p=>p.status='published',p=>p.scheduledAt='2026-11-19T17:00:00Z']){const b=base();const row=post(12);mutate(row);b.snapshots[0].posts=[row];assert.equal(planClippersWeek(b).cells[0].reason,'provider_snapshot_row_invalid');}
 const b=base();b.snapshots.push(b.snapshots[0]);assert.throws(()=>planClippersWeek(b),/duplicate_snapshot/);
});
test('NY wall clock handles DST and rejects repeated/missing hours',()=>{
 assert.equal(newYorkSlot('2026-03-08',2),null);assert.equal(newYorkSlot('2026-11-01',1),null);
 assert.equal(newYorkSlot('2026-03-08',12),'2026-03-08T16:00:00.000Z'); assert.equal(newYorkSlot('2026-11-18',12),'2026-11-18T17:00:00.000Z');
 assert.throws(()=>newYorkSlot('2026-02-30',12));
});
test('calendar/input bounds cannot widen caps or make old snapshots fresh',()=>{
 for(const change of [{endDate:'2026-11-25'},{startDate:'2026-11-17'},{proposedHours:[12,12,14,16,18]},{maxSnapshotAgeMs:3600000},{now:'bad'}])assert.throws(()=>planClippersWeek({...base(),...change}));
});
test('past scheduled rows require reconciliation; confirmed publications count toward today',()=>{
 const b=base();b.snapshots[0].posts=[{...post(8),status:'scheduled'}];
 assert.equal(planClippersWeek(b).cells[0].reason,'past_schedule_requires_publication_confirmation');
 b.snapshots[0].posts[0].status='published';const c=planClippersWeek(b).cells[0];assert.equal(c.providerConfirmedCount,1);assert.equal(c.deficit,4);assert.equal(c.proposedSlots.length,4);
});
test('stable provider ID moved across days holds both cells, but separate destinations may share IDs',()=>{
 const b=base();b.snapshots[0].posts=[post(12,'stable')];b.snapshots[1].posts=[{...post(12,'stable'),scheduledAt:newYorkSlot(days[1],12)}];
 let p=planClippersWeek(b);for(const c of p.cells.slice(0,2)){assert.equal(c.reason,'provider_post_cross_day_identity_conflict');assert.equal(c.deficit,null);assert.equal(c.providerConfirmedCount,null);assert.equal(c.proposedSlots.length,0);}
 assert.equal(p.coverageComplete,false);assert.equal(p.unknownCells,2);assert.equal(p.providerConfirmedCount,0);
 b.snapshots[1].posts=[];b.snapshots[5].posts=[post(12,'stable',DESTINATIONS[1])];p=planClippersWeek(b);assert.equal(p.coverageComplete,true);assert.equal(p.providerConfirmedCount,2);
});
test('evidence digests must be strings, not coercible arrays',()=>{
 const b=base();b.snapshots[0].evidenceSha256=[sha];assert.equal(planClippersWeek(b).cells[0].reason,'provider_snapshot_unverified_or_stale');
 b.snapshots[0].evidenceSha256=sha;b.snapshots[0].posts=[{...post(12),confirmationSha256:[sha]}];assert.equal(planClippersWeek(b).cells[0].reason,'provider_snapshot_row_invalid');
 assert.equal(planClippersWeek({now}).coverageComplete,false);
});
test('published effective timestamps cannot follow their snapshot and invalid calendar timestamps are rejected',()=>{
 const b=base();b.snapshots[0].observedAt='2026-11-18T13:50:00Z';b.snapshots[0].posts=[{...post(8),status:'published',scheduledAt:'2026-11-18T13:55:00Z'}];
 assert.equal(planClippersWeek(b).cells[0].reason,'provider_snapshot_row_invalid');
 for(const now of ['2026-02-30T14:00:00Z','2026-11-18T24:00:00Z'])assert.throws(()=>planClippersWeek({now}),/invalid_now/);
 b.snapshots[0].observedAt='2026-11-18T24:00:00Z';assert.equal(planClippersWeek(b).cells[0].reason,'provider_snapshot_unverified_or_stale');
});
