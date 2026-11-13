import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {superviseOwnedWorker} from '../script/office-windows-worker.mjs';
import { ownershipPaths, acquireWorkerOwnership, requestWorkerStop, resumeWorker } from '../script/office-worker-ownership.mjs';

function fixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'office-ownership-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  return ownershipPaths('/reviewed-repo',path.join(dir,'worker.env'),'owner');
}
test('duplicate launch cannot steal ownership, even with stale PID metadata', t=>{
  const paths=fixture(t), first=acquireWorkerOwnership(paths);
  assert.throws(()=>acquireWorkerOwnership(paths),/EEXIST/);
  const record=path.join(paths.lock,'owner.json');
  fs.writeFileSync(record,JSON.stringify({...first.identity,pid:999999,startedAt:'2000-01-01'}));
  assert.throws(()=>acquireWorkerOwnership(paths),/EEXIST/);
  first.release();
});
test('stop pauses recurrence until explicit resume after observed worker exit', t=>{
  const paths=fixture(t), first=acquireWorkerOwnership(paths);
  requestWorkerStop(paths);
  assert.equal(first.stopRequested(),true);
  assert.throws(()=>resumeWorker(paths),/RECONCILIATION/);
  first.release();
  assert.throws(()=>acquireWorkerOwnership(paths),/PAUSED/);
  resumeWorker(paths);
  const next=acquireWorkerOwnership(paths); assert.notEqual(next.identity.nonce,first.identity.nonce); next.release();
});
test('foreign stop nonce cannot stop an owner and changed owner cannot be deleted', t=>{
  const paths=fixture(t), first=acquireWorkerOwnership(paths);
  fs.writeFileSync(path.join(paths.lock,'stop.json'),JSON.stringify({nonce:'foreign'}));
  assert.equal(first.stopRequested(),false);
  fs.writeFileSync(path.join(paths.lock,'owner.json'),JSON.stringify({...first.identity,nonce:'foreign'}));
  assert.throws(()=>first.release(),/OWNERSHIP_CHANGED/);
  assert.equal(fs.existsSync(paths.lock),true);
});
test('stop without worker persists pause and does not create fake ownership', t=>{
  const paths=fixture(t); requestWorkerStop(paths); requestWorkerStop(paths);
  assert.equal(fs.existsSync(paths.lock),false);
  assert.throws(()=>acquireWorkerOwnership(paths),/PAUSED/);
});
test('host loss cooperatively drains a real child and recurrence remains blocked', async t=>{
  const paths=fixture(t), ownership=acquireWorkerOwnership(paths);
  const child=spawn(process.execPath,['-e',`process.on('message',m=>{if(m.type==='office-shutdown'){setTimeout(()=>{process.send({drained:true});process.disconnect()},100)}})`],{stdio:['ignore','ignore','ignore','ipc'],windowsHide:true,shell:false});
  t.after(()=>{if(child.exitCode===null)child.kill()});
  let drained=false; child.on('message',m=>{drained=m.drained});
  const waiting=superviseOwnedWorker(child,ownership,paths,{pollMs:10,parentAlive:()=>false});
  assert.throws(()=>acquireWorkerOwnership(paths));
  assert.equal(await waiting,0); assert.equal(drained,true);
  assert.equal(fs.existsSync(paths.lock),true,'lock lasts until observed child exit');
  ownership.release();
  assert.throws(()=>acquireWorkerOwnership(paths),/PAUSED/);
});
