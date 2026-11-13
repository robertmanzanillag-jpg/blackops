import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {acquireBrandPair,acquireMetricoolExports} from '../script/blackroom-metricool-exporter.mjs';
import {compareBrandEvidence} from '../server/organic-brand-comparison.mjs';
test('optional phase cannot delay durable primary indefinitely',async()=>{const dir=await mkdtemp(path.join(tmpdir(),'brands-'));try{const r=await acquireBrandPair({statePath:path.join(dir,'latest.json'),secondaryTimeoutMs:5,acquire:async({brandId})=>brandId==='6585226'?report(brandId):new Promise(()=>{})});assert.equal(r.brandId,'6585226');}finally{await rm(dir,{recursive:true,force:true})}});
test('missing durations stale future duplicate and wrong brand do not form proposals',()=>{
const r=report('6475033');r.imports[0].samples[0].durationSeconds=null;r.imports[0].samples[1].durationSeconds=null;
assert.equal(compareBrandEvidence(null,r).proposals.length,0);
for(const observedAt of ['2000-01-01','2099-01-01']){const p=report('6475033');p.imports[0].samples.forEach(s=>s.observedAt=observedAt);assert.equal(compareBrandEvidence(null,p).proposals.length,0)}
const p=report('6475033');p.imports[0].samples.forEach(s=>s.id='same');assert.equal(compareBrandEvidence(null,p).proposals.length,0);
assert.equal(compareBrandEvidence(report('6475033'),report('6585226')).proposals.length,0);
});
const report=brandId=>({brandId,imports:[{network:'tiktok',samples:[1,2,3].map(i=>({id:brandId+'-'+i,views:i*100,durationSeconds:brandId==='6475033'?10:30,observedAt:new Date().toISOString()}))}]});
test('actual pair consumer uses separated output and derived duration',async()=>{const dir=await mkdtemp(path.join(tmpdir(),'brands-'));try{const calls=[];const statePath=path.join(dir,'latest-export.json');const r=await acquireBrandPair({statePath,acquire:async({brandId})=>{calls.push(brandId);return report(brandId)}});assert.deepEqual(calls,['6585226','6475033']);assert.equal(r.brandId,'6585226');const c=JSON.parse(await readFile(path.join(dir,'organic-brand-comparison.json')));assert.deepEqual(c.proposals.map(p=>p.observedMedianSeconds),[30,10]);assert.equal(c.mayPublish,false);assert.equal(JSON.parse(await readFile(statePath)).brandId,'6585226');}finally{await rm(dir,{recursive:true,force:true})}});
test('secondary failure preserves primary',async()=>{const dir=await mkdtemp(path.join(tmpdir(),'brands-'));try{const statePath=path.join(dir,'latest-export.json');const r=await acquireBrandPair({statePath,acquire:async({brandId})=>{if(brandId==='6475033')throw Error('offline');return report(brandId)}});assert.equal(r.brandId,'6585226');assert.equal(JSON.parse(await readFile(statePath)).brandId,'6585226');}finally{await rm(dir,{recursive:true,force:true})}});
test('unapproved account cannot navigate',async()=>{await assert.rejects(acquireMetricoolExports({brandId:'999'}),/Unapproved/)});
