import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {refreshOrganicPeerScout,startOrganicPeerScout} from '../script/organic-peer-scout.mjs';
test('supervisor tick remains independent of jobs and cancels on stop',async()=>{
 let tick,signal,calls=0,cleared=false;
 const stop=startOrganicPeerScout('/unused',{interval:fn=>{tick=fn;return {unref(){}}},clear:()=>{cleared=true},refresh:async(_,options)=>{calls++;signal=options.signal;}});
 await tick();assert.equal(calls,1);
 await tick();assert.equal(calls,2);
 await stop();assert.ok(cleared);assert.ok(signal.aborted);
 await tick();assert.equal(calls,2);
});
test('success pins channel, deduplicates concurrency, does not invent KONG evidence',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'scout-ok-'));let calls=0;
 try {const now=new Date('2026-11-04T12:00:00Z'), channel='UCGBpxWJr9FNOcFYA5GkKrMg';
 const run=async()=>{calls++;return {stdout:JSON.stringify({channel_id:channel,entries:['abcdefghijk','abcdefghijl','abcdefghijm'].map(id=>({id,channel_id:channel,timestamp:Date.parse('2026-11-03')/1000,duration:45,view_count:10}))})}};
 const [a,b]=await Promise.all([refreshOrganicPeerScout(dir,{run,now}),refreshOrganicPeerScout(dir,{run,now})]);
 assert.equal(calls,1);assert.deepEqual(a,b);assert.equal(a.brands[0].medianSeconds,45);assert.equal(a.brands[1].status,'insufficient_evidence');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('wrong channel rejected and abort cannot save a successful report',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'scout-bad-'));
 try {const r=await refreshOrganicPeerScout(dir,{run:async()=>({stdout:JSON.stringify({channel_id:'UCAAAAAAAAAAAAAAAAAAAAAA',entries:[]})})});assert.equal(r.sources[0].status,'unavailable');
 const c=new AbortController();c.abort();await assert.rejects(refreshOrganicPeerScout(dir,{now:new Date(Date.now()+86400001),signal:c.signal}),/stopped/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('bounded metadata only and daily cache, failures do not fabricate evidence',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'scout-test-'));let calls=0;
 try {const run=async(bin,args)=>{calls++;assert.ok(args.includes('--skip-download'));assert.ok(args.includes('--ignore-config'));throw new Error('blocked');};
 const r=await refreshOrganicPeerScout(dir,{run});assert.equal(calls,1);assert.equal(r.brands[0].status,'insufficient_evidence');
 await refreshOrganicPeerScout(dir,{run});assert.equal(calls,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});
