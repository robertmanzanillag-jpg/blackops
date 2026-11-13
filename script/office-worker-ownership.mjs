import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export function ownershipPaths(repo, config, owner) {
  const key = createHash('sha256').update(JSON.stringify([repo,config,owner])).digest('hex');
  const base = path.join(path.dirname(config), `office-worker-${key}`);
  return { lock: `${base}.lock`, hold: `${base}.paused` };
}
export function acquireWorkerOwnership(paths) {
  if (fs.existsSync(paths.hold)) throw new Error('WORKER_PAUSED');
  // Never steal a lock based on PID or age: an orphan may still own an API call.
  fs.mkdirSync(paths.lock);
  const identity = { nonce: randomUUID(), pid: process.pid, parentPid: process.ppid, startedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(paths.lock,'owner.json'), JSON.stringify(identity), {flag:'wx'});
  return {
    identity,
    stopRequested() {
      if (fs.existsSync(paths.hold)) return true;
      try { return JSON.parse(fs.readFileSync(path.join(paths.lock,'stop.json'),'utf8')).nonce === identity.nonce; }
      catch (error) { if (error.code === 'ENOENT') return false; throw new Error('STOP_REQUEST_UNVERIFIED'); }
    },
    release() {
      const current = JSON.parse(fs.readFileSync(path.join(paths.lock,'owner.json'),'utf8'));
      if (current.nonce !== identity.nonce) throw new Error('WORKER_OWNERSHIP_CHANGED');
      for (const name of ['stop.json','owner.json']) { try { fs.unlinkSync(path.join(paths.lock,name)); } catch(error) { if(error.code !== 'ENOENT') throw error; } }
      fs.rmdirSync(paths.lock);
    },
  };
}
export function requestWorkerStop(paths) {
  try { fs.writeFileSync(paths.hold,'Paused by explicit stop request\n',{flag:'wx'}); } catch(error) { if(error.code !== 'EEXIST') throw error; }
  if (!fs.existsSync(paths.lock)) return;
  const identity = JSON.parse(fs.readFileSync(path.join(paths.lock,'owner.json'),'utf8'));
  if (typeof identity.nonce !== 'string') throw new Error('WORKER_IDENTITY_UNVERIFIED');
  try { fs.writeFileSync(path.join(paths.lock,'stop.json'),JSON.stringify({nonce:identity.nonce}),{flag:'wx'}); } catch(error) { if(error.code !== 'EEXIST') throw error; }
}
export function resumeWorker(paths) {
  if (fs.existsSync(paths.lock)) throw new Error('EXISTING_WORKER_REQUIRES_RECONCILIATION');
  try { fs.unlinkSync(paths.hold); } catch(error) { if(error.code !== 'ENOENT') throw error; }
}
