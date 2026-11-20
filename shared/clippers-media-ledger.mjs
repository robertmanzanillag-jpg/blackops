// Cross-account media ledger state shared by the cloud streamer worker and the Mac lanes guard.
// Pure helpers (no network, no secrets). Lives in shared/ so Mac scripts never load the cloud worker.

import { canonicalDestinationKey } from '../script/clippers-portfolio-metricool.mjs';

export function emptyCloudPublish() { return { version: 1, clips: {}, posts: [], learning: null, lastRun: null, holds: {}, heldQueue: [] }; }
export function cloudPublishOf(state) {
  const c = state?.cloudPublish;
  if (!(c?.version === 1 && Array.isArray(c.posts) && c.clips && typeof c.clips === 'object')) return emptyCloudPublish();
  if (!c.holds || typeof c.holds !== 'object' || Array.isArray(c.holds)) c.holds = {};
  if (!Array.isArray(c.heldQueue)) c.heldQueue = [];
  return c;
}

/** Ledger of every media/source already given to an account (explicit entries + the post ledger). */
export function mediaEntriesOf(c) {
  const explicit = Array.isArray(c?.mediaLedger) ? c.mediaLedger : [];
  const fromPosts = (c?.posts ?? []).filter(p => !['deferred', 'not_found', 'blocked'].includes(p.status))
    .map(p => ({ candidateId: p.candidateId, sourceId: p.sourceId ?? p.candidateId ?? null, streamKey: p.streamKey ?? null, segment: p.segment ?? null, mediaSha256: p.mediaSha256 ?? null, destinationKey: canonicalDestinationKey(p.destinationKey), lane: p.lane ?? null }));
  return [...explicit, ...fromPosts];
}
