import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOrganicPeerHypotheses as build } from '../server/organic-peer-hypotheses.mjs';
const now = new Date('2026-11-04T12:00:00Z');
const row = { url:'https://www.youtube.com/shorts/abcdefghijk', relevantTo:'blackroom', observedAt:now.toISOString(), publishedAt:'2026-11-01T12:00:00Z', durationSeconds:30, views:400 };
test('duplicates cannot satisfy sample gate',()=>assert.equal(build([row,row,row],now).brands[0].status,'insufficient_evidence'));
test('fresh distinct public observations produce challenge not winner',()=>{const r=build(['abcdefghijk','abcdefghijl','abcdefghijm'].map(id=>({...row,url:'https://www.youtube.com/shorts/'+id})),now);assert.equal(r.brands[0].status,'hypothesis');assert.equal(r.brands[1].status,'insufficient_evidence');assert.equal(r.mayPublish,false);assert.equal(r.brands[0].experiment.replaceVerifiedWinner,false)});
test('reject stale, future, credentials, queries and malformed values',()=>{const rows=[{...row,observedAt:'2020-01-01'},{...row,publishedAt:'2030-01-01'},{...row,url:row.url+'?token=secret'},{...row,url:'https://secret@www.youtube.com/shorts/abcdefghijk'},{...row,views:NaN}];assert.equal(build(rows,now).brands[0].evidence.length,0)});
