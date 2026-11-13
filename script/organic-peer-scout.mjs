import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { buildOrganicPeerHypotheses } from '../server/organic-peer-hypotheses.mjs';
const exec = promisify(execFile);
// Fixed public discovery targets, never accepts URLs from page content or private reports.
export const SOURCES = ['https://www.youtube.com/channel/UCGBpxWJr9FNOcFYA5GkKrMg/shorts'];
const inFlight = new Map();
export function startOrganicPeerScout(dir, { refresh = refreshOrganicPeerScout, interval = setInterval, clear = clearInterval } = {}) {
  const controller = new AbortController();
  let stopped = false;
  let pending;
  const tick = () => {
    if (stopped || pending) return pending;
    pending = Promise.resolve().then(() => refresh(dir, {signal:controller.signal})).catch(() => {}).finally(() => {pending = undefined;});
    return pending;
  };
  const timer = interval(tick, 60_000);
  timer.unref?.();
  void tick();
  return async () => { stopped = true; clear(timer); controller.abort(); await pending; };
}
export function refreshOrganicPeerScout(dir, options = {}) {
  dir = path.resolve(dir);
  if (inFlight.has(dir)) return inFlight.get(dir);
  const work = collect(dir, options).finally(() => inFlight.delete(dir));
  inFlight.set(dir, work); return work;
}
async function collect(dir, {now = new Date(), run = exec, signal} = {}) {
  const file = path.join(dir,'organic-peer-hypotheses.json');
  let prior; try { prior=JSON.parse(await readFile(file,'utf8')); } catch {}
  const elapsed=now.getTime()-Date.parse(prior?.evaluatedAt);
  if (elapsed>=0 && elapsed<86400000) return prior;
  const observations=[], sources=[];
  for (const source of SOURCES) {
    if (signal?.aborted) throw new Error('Scout stopped');
    try {
      const {stdout}=await run('yt-dlp',['--ignore-config','--skip-download','--no-warnings','--playlist-end','6','--dump-single-json',source],{timeout:90000,maxBuffer:2000000,signal});
      const data=JSON.parse(stdout);
      const channel=data.channel_id;
      if (channel !== 'UCGBpxWJr9FNOcFYA5GkKrMg') throw new Error('Unverified channel');
      for (const e of (data.entries||[]).slice(0,6)) {
        if (e.channel_id!==channel || !/^[A-Za-z0-9_-]{11}$/.test(e.id||'') || !Number.isFinite(e.timestamp)) continue;
        observations.push({relevantTo:'blackroom',url:'https://www.youtube.com/shorts/'+e.id,observedAt:now.toISOString(),publishedAt:new Date(e.timestamp*1000).toISOString(),durationSeconds:e.duration,views:e.view_count});
      }
      sources.push({url:source,channelId:channel,status:'observed'});
    } catch { sources.push({url:source,status:'unavailable'}); }
  }
  const report={...buildOrganicPeerHypotheses(observations,now),sources};
  if (signal?.aborted) throw new Error('Scout stopped');
  await mkdir(dir,{recursive:true});
  const temp=file+'.'+process.pid+'.tmp';
  await writeFile(temp,JSON.stringify(report),{mode:0o600});await rename(temp,file);
  return report;
}
