// Minimal, deterministic ($0) learning loop for the cloud streamer publisher.
//
// Input: the publisher's own post ledger (state.cloudPublish.posts) with Metricool post analytics
// observations taken 24-48 h after the scheduled time (createPortfolioMetricool().publication/.metrics).
// Output, applied on the next run:
//   - hook variant per clip ("title" vs "teaser"): an A/B test per destination evaluated with the
//     existing evaluator (script/clippers-content-learning-ceo.mjs evaluateExperiments: >= 5 samples per
//     arm, >= 20 % median-views lift, no > 10 % completion regression). A supported winner is used
//     80 % of the time; 20 % keeps exploring. No winner: deterministic 50/50 split.
//   - creator boost for selection order: log2 of the creator's median views relative to the
//     destination median (>= 3 observed posts), clamped to [-1, 1].
import { createHash } from 'node:crypto';
import { evaluateExperiments } from './clippers-content-learning-ceo.mjs';
import { canonicalDestinationKey } from './clippers-portfolio-metricool.mjs';

export const HOOK_VARIANTS = Object.freeze(['title', 'teaser']);
export const OBSERVATION_WINDOW = Object.freeze({ minHours: 24, maxHours: 48 });
export const LEARNING_POLICY = Object.freeze({ minimumSamplesPerVariant: 5, minimumWinnerLift: 0.2, exploitShare: 0.8, creatorMinSamples: 3 });

const median = values => {
  const s = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const bucket = (seed) => parseInt(createHash('sha256').update(String(seed)).digest('hex').slice(0, 8), 16) / 0xffffffff;

/** Posts whose observation is usable for comparison (same 24-48 h window, real views). */
export function observedPosts(posts = []) {
  return posts.filter(p => p?.observation && Number.isSafeInteger(p.observation.views) && p.observation.views >= 0 &&
    Number.isFinite(p.observation.ageHours) && p.observation.ageHours >= OBSERVATION_WINDOW.minHours && p.observation.ageHours < OBSERVATION_WINDOW.maxHours &&
    HOOK_VARIANTS.includes(p.hookVariant) && typeof p.destinationKey === 'string');
}

export function computeLearning(posts = [], { now = Date.now(), policy = LEARNING_POLICY } = {}) {
  // Legacy account aliases group with their current destination.
  const usable = observedPosts(posts).map(p => ({ ...p, destinationKey: canonicalDestinationKey(p.destinationKey) }));
  const rows = usable.map(p => ({
    usable: true, experimentId: `streamer-hook:${p.destinationKey}`, experimentVariable: 'hook', experimentVariant: p.hookVariant,
    account: p.destinationKey, lane: 'streamer_clip', language: p.language ?? 'es', windowHours: 24,
    views: p.observation.views, completionRate: Number.isFinite(p.observation.completionRate) ? p.observation.completionRate : null,
  }));
  const experiments = evaluateExperiments(rows, { minimumSamplesPerVariant: policy.minimumSamplesPerVariant, minimumWinnerLift: policy.minimumWinnerLift });
  const hookPreference = {};
  for (const e of experiments) hookPreference[e.experimentId.slice('streamer-hook:'.length)] = e.winner;
  // Creator boost relative to each destination's median.
  const destMedian = new Map();
  for (const key of new Set(usable.map(p => p.destinationKey))) destMedian.set(key, median(usable.filter(p => p.destinationKey === key).map(p => p.observation.views)));
  const ratios = new Map();
  for (const p of usable) {
    const base = destMedian.get(p.destinationKey);
    if (!p.creatorKey || !base) continue;
    ratios.set(p.creatorKey, [...(ratios.get(p.creatorKey) ?? []), p.observation.views / base]);
  }
  const creatorBoost = {};
  for (const [key, list] of ratios) {
    if (list.length < policy.creatorMinSamples) continue;
    const m = median(list);
    creatorBoost[key] = m > 0 ? Math.max(-1, Math.min(1, Math.round(Math.log2(m) * 1000) / 1000)) : -1;
  }
  return { evaluatedAt: new Date(now).toISOString(), samples: usable.length, experiments, hookPreference, creatorBoost, policy: { ...policy } };
}

/** One hook per clip (the text is burned into the video, shared by every destination). */
export function chooseHookVariant(learning, candidateId, policy = LEARNING_POLICY) {
  const winners = Object.values(learning?.hookPreference ?? {}).filter(v => HOOK_VARIANTS.includes(v));
  const r = bucket(`hook:${candidateId}`);
  if (winners.length) {
    const counts = HOOK_VARIANTS.map(v => [v, winners.filter(w => w === v).length]).sort((a, b) => b[1] - a[1]);
    if (counts[0][1] > counts[1][1]) {
      const best = counts[0][0];
      return { variant: r < policy.exploitShare ? best : HOOK_VARIANTS.find(v => v !== best), mode: r < policy.exploitShare ? 'exploit' : 'explore' };
    }
  }
  return { variant: r < 0.5 ? 'title' : 'teaser', mode: 'ab_test' };
}

export function creatorBoostFor(learning, creatorKey) {
  const v = learning?.creatorBoost?.[creatorKey];
  return Number.isFinite(v) ? v : 0;
}

// ---------- Per-account growth loop (owner plan 2026-11-20, 2-week test) ----------
// Read-only inputs: our post ledger + Metricool whole-account post analytics (7 days, any lane).
//   - weekly views / median per account -> auto-publish flag (median >= 1k) and 6-8 posts/day scale-up;
//   - kill a creator, hook variant or posting hour on an account when its median < 300 after >= 6 posts;
//   - a post above 10k views within 24 h -> 3 more clips from the same stream/creator on that account;
//   - a post above 100k views -> double that creator's share on that account.
import { KILL_MEDIAN_VIEWS, KILL_MIN_POSTS, BREAKOUT_VIEWS_24H, BREAKOUT_FOLLOWUP_CLIPS, MEGA_VIEWS, PAUSE_DAYS, laneForDestinationKey, autoPublishAllowed } from '../shared/clippers-account-lanes.mjs';

export const GROWTH_WINDOW_DAYS = 14;
const DAY = 86_400_000;
const nyHour = at => Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23' }).format(new Date(at)));

/** Latest known views for a ledger post: matched account analytics row (same account, published within 15 min of the slot) or the 24-48 h observation. */
export function latestViews(post, accountPosts = []) {
  const at = Date.parse(post.observation?.publishedAt ?? post.scheduledAt);
  const match = accountPosts.find(r => (post.observation?.platformPostId && r.id === post.observation.platformPostId) || Math.abs(Date.parse(r.publishedAt) - at) <= 15 * 60_000);
  if (match && Number.isSafeInteger(match.views)) return { views: match.views, ageHours: Number.isFinite(match.actualAgeHours) ? match.actualAgeHours : (Date.parse(match.observedAt ?? '') - Date.parse(match.publishedAt)) / HOUR_MS, platformPostId: match.id, publishedAt: match.publishedAt };
  if (post.observation && Number.isSafeInteger(post.observation.views)) return { views: post.observation.views, ageHours: post.observation.ageHours, platformPostId: post.observation.platformPostId ?? null, publishedAt: post.observation.publishedAt };
  return null;
}
const HOUR_MS = 3_600_000;

export function computeGrowth({ posts = [], accountPosts = {}, previous = null, now = Date.now(), override = new Set() }) {
  const out = { evaluatedAt: new Date(now).toISOString(), accounts: {}, kills: [], breakouts: [], doubled: [], decisions: [] };
  const recent = posts.filter(p => p && typeof p.destinationKey === 'string' && ['scheduled', 'published'].includes(p.status) && now - Date.parse(p.scheduledAt) <= GROWTH_WINDOW_DAYS * DAY && Date.parse(p.scheduledAt) <= now);
  const keys = new Set([...Object.keys(accountPosts), ...recent.map(p => canonicalDestinationKey(p.destinationKey))]);
  for (const key of keys) {
    const rows = (accountPosts[key] ?? []).filter(r => Number.isSafeInteger(r?.views) && now - Date.parse(r.publishedAt) <= 7 * DAY);
    const mine = recent.filter(p => canonicalDestinationKey(p.destinationKey) === key).map(p => ({ ...p, latest: latestViews(p, accountPosts[key] ?? []) })).filter(p => p.latest);
    const weekly = rows.length ? rows.map(r => r.views) : mine.filter(p => now - Date.parse(p.scheduledAt) <= 7 * DAY).map(p => p.latest.views);
    const account = { lane: laneForDestinationKey(key)?.id ?? null, weeklyPosts: weekly.length, weeklyViews: weekly.reduce((a, b) => a + b, 0), weeklyMedian: median(weekly), source: rows.length ? 'metricool_account_analytics' : 'ledger_observations' };
    const earned = autoPublishAllowed(account); // also requires source = metricool_account_analytics
    account.scaled = earned; // 6-8 posts/day only once the weekly median really passes 1k (override keeps 5/day)
    account.autoPublish = earned || override.has(key);
    account.autoPublishMode = earned ? 'auto' : account.autoPublish ? 'owner_override' : 'drafts';
    out.accounts[key] = account;
    if (earned) out.decisions.push(`autopublish_on:${key}`);
    // Kill arms with a median below 300 after >= 6 posts on this account.
    for (const [arm, pick] of [['creator', p => p.creatorKey], ['hook', p => p.hookVariant], ['slot', p => nyHour(p.scheduledAt)]]) {
      const groups = new Map();
      for (const p of mine) { const v = pick(p); if (v == null) continue; const g = groups.get(v) ?? { views: [], last: 0 }; g.views.push(p.latest.views); g.last = Math.max(g.last, Date.parse(p.scheduledAt)); groups.set(v, g); }
      for (const [value, { views, last }] of groups) {
        const m = median(views);
        // A pause expires PAUSE_DAYS after the arm's newest post (then it is tried again).
        const expiresAt = new Date(last + PAUSE_DAYS * DAY).toISOString();
        if (views.length >= KILL_MIN_POSTS && m < KILL_MEDIAN_VIEWS && Date.parse(expiresAt) > now) { out.kills.push({ destinationKey: key, arm, value, median: m, posts: views.length, expiresAt }); out.decisions.push(`kill_${arm}:${key}:${value}`); }
      }
    }
    // Breakouts (> 10k within 24 h) and mega posts (> 100k).
    for (const p of mine) {
      const { views, ageHours } = p.latest;
      if (views > BREAKOUT_VIEWS_24H && Number.isFinite(ageHours) && ageHours <= 24) {
        const prior = (previous?.breakouts ?? []).find(b => b.postId === p.id);
        const detectedAt = prior?.detectedAt ?? out.evaluatedAt;
        const done = posts.filter(x => x.id !== p.id && canonicalDestinationKey(x.destinationKey) === key && (x.streamKey && x.streamKey === p.streamKey || x.creatorKey === p.creatorKey) && Date.parse(x.attemptedAt ?? x.scheduledAt) >= Date.parse(detectedAt)).length;
        const remaining = Math.max(0, BREAKOUT_FOLLOWUP_CLIPS - done);
        out.breakouts.push({ postId: p.id, destinationKey: key, creatorKey: p.creatorKey, streamKey: p.streamKey ?? null, slotHour: nyHour(p.scheduledAt), views, detectedAt, until: new Date(Date.parse(detectedAt) + DAY).toISOString(), remaining });
        out.decisions.push(`breakout:${key}:${p.creatorKey}`);
      }
      if (views > MEGA_VIEWS && !out.doubled.some(d => d.destinationKey === key && d.creatorKey === p.creatorKey)) {
        out.doubled.push({ destinationKey: key, creatorKey: p.creatorKey, views });
        out.decisions.push(`double_creator:${key}:${p.creatorKey}`);
      }
    }
  }
  out.decisions = [...new Set(out.decisions)].slice(0, 60);
  return out;
}

/** Selection weight for a candidate on its routed account: 0 = killed, 2 = doubled creator, +breakout stream. */
export function growthWeight(growth, { destinationKey, creatorKey, streamKey }, now = Date.now()) {
  if (!growth) return { weight: 1, killed: false, breakout: false };
  const live = k => !k.expiresAt || Date.parse(k.expiresAt) > now;
  if ((growth.kills ?? []).some(k => k.destinationKey === destinationKey && k.arm === 'creator' && k.value === creatorKey && live(k))) return { weight: 0, killed: true, breakout: false };
  const breakout = (growth.breakouts ?? []).some(b => b.destinationKey === destinationKey && b.remaining > 0 && Date.parse(b.until) > now && ((streamKey && b.streamKey === streamKey) || b.creatorKey === creatorKey));
  const doubled = (growth.doubled ?? []).some(d => d.destinationKey === destinationKey && d.creatorKey === creatorKey);
  return { weight: (doubled ? 2 : 1) + (breakout ? 3 : 0), killed: false, breakout };
}
const livePause = (k, now) => !k.expiresAt || Date.parse(k.expiresAt) > now;
export const killedHooks = (growth, destinationKey, now = Date.now()) => (growth?.kills ?? []).filter(k => k.destinationKey === destinationKey && k.arm === 'hook' && livePause(k, now)).map(k => k.value);
export const killedHours = (growth, destinationKey, now = Date.now()) => (growth?.kills ?? []).filter(k => k.destinationKey === destinationKey && k.arm === 'slot' && livePause(k, now)).map(k => Number(k.value));
export const promotedHours = (growth, destinationKey, now = Date.now()) => (growth?.breakouts ?? []).filter(b => b.destinationKey === destinationKey && Date.parse(b.until) > now).map(b => b.slotHour);
