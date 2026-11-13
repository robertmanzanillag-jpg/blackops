import assert from "node:assert/strict";
import test from "node:test";
import { evaluateBlackRoomLearning } from "../server/blackroom-verified-learning";
import { captureLearningSnapshots } from "../server/blackroom-learning-observations";
import {
  buildBlackRoomVideoFilter,
  buildBlackRoomRenderArgs,
  buildBlackRoomYtDlpAuthArgs,
  buildBlackRoomYtDlpWindowArgs,
  downloadBlackRoomWindowWithFallback,
  commitBlackRoomReservation,
  extractBlackRoomDj,
  findBlackRoomDropOffset,
  parseBlackRoomEnergySamples,
  planBlackRoomDeterministicEdit,
  selectBlackRoomTargetNetworks,
  isOwnedBlackRoomMetadata,
} from "../server/blackroom-deterministic-editor";

test("reservation preserves media throughout the subprocess commit window and later logging failure", async () => {
  const order: string[] = [];
  let state: "unreserved" | "committing" | "reserved" = "unreserved";
  let releaseLedger!: () => void;
  const ledgerPending = new Promise<void>((resolve) => { releaseLedger = resolve; });
  const committing = commitBlackRoomReservation(
    async () => { order.push("ledger-start"); await ledgerPending; order.push("ledger-durable"); },
    () => { state = "committing"; order.push("preserve"); },
    () => { state = "reserved"; order.push("confirmed"); },
    async () => { order.push("activity"); throw new Error("activity unavailable"); },
  );
  await Promise.resolve();
  assert.equal(state, "committing");
  assert.deepEqual(order, ["preserve", "ledger-start"]);
  releaseLedger();
  await assert.rejects(committing, /activity unavailable/);
  assert.equal(state, "reserved");
  assert.deepEqual(order, ["preserve", "ledger-start", "ledger-durable", "confirmed", "activity"]);
});

function queue(enabled = true): any {
  return {
    enabled,
    sourceHistory: [{ videoId: "used-video" }],
    prioritySources: [],
    jobs: [{
      id: "job-1", targetDate: "2026-07-23", status: "queued", notBefore: "2026-07-20T00:00:00.000Z",
      slots: ["00:30", "02:00", "03:30", "05:00", "06:30", "08:00"].map((localTime) => ({ localTime, timezone: "America/New_York" })),
      requirements: {
        posts: 6, djs: 5, postsPerDj: 2, durationsSeconds: [15, 30, 60, 120, 300, 600],
      },
    }],
  };
}

function ledger(): any {
  return {
    version: 1,
    entries: [15, 30, 60, 120, 300].map((durationSeconds, index) => ({
      jobId: "job-1", slot: ["00:30", "02:00", "03:30", "05:00", "06:30"][index],
      videoId: `old-${index}`, dj: `DJ ${index}`, language: index % 2 ? "es" : "en",
      format: durationSeconds >= 300 || index % 2 ? "horizontal" : "vertical", durationSeconds,
    })),
  };
}

test("real planner rotates duration within DJ/set/daypart; delayed, cross-platform and unmatched observations cannot select a winner", async () => {
  const { evaluateDurationLearning, BLACKROOM_DURATION_TEST_ID } = await import(
    "../server/blackroom-verified-learning"
  );
  const state = queue();
  state.sourceHistory = [];
  const decisions = (prefix: string) => Object.fromEntries(["tiktok","facebook","youtube"].map(network=>[network,{id:prefix+"-"+network}]));
  state.analytics = { verifiedLearning: decisions("hook"), durationLearning: decisions("duration") };
  const history: any = { entries: [], version: 1 },
    experiments: any[] = [],
    observations: any[] = [];
  const inventory = Array.from({ length: 150 }, (_, i) => ({
    id: "set-" + i,
    title: "DJ" + (i % 15) + " - DJ Set",
    duration: 5400,
  }));
  for (let day = 1; day <= 20; day++) {
    const date = "2026-09-" + String(day).padStart(2, "0");
    state.jobs = [
      {
        id: date,
        targetDate: date,
        status: "queued",
        notBefore: "2026-08-01T00:00:00Z",
        slots: ["00:30", "05:00", "09:30", "14:00", "19:00"].map((localTime) => ({
          localTime,
          timezone: "America/New_York",
        })),
        requirements: { posts: 5, djs: 5, postsPerDj: 1, durationsSeconds: [15, 30, 60] },
      },
    ];
    for (let i = 0; i < 5; i++) {
      const p = planBlackRoomDeterministicEdit({
        queue: state,
        ledger: history,
        inventory,
        now: new Date("2026-08-31T12:00:00Z"),
      })!;
      const id = "p" + day + "_" + i,
        publishedAt = date + "T" + p.slot + ":00-04:00";
      history.entries.push({
        ...p,
        reservationId: id,
        status: "confirmed",
        segmentStartSeconds: p.windowStartSeconds,
        segmentEndSeconds: p.windowStartSeconds + p.durationSeconds,
        publicationDateTime: publishedAt,
      });
      experiments.push({ ...p, sourceVideoId: p.videoId, network: "youtube", platformPostId: id, reservationId: id });
      observations.push({
        network: "youtube",
        postId: id,
        publishedAt,
        observedAt: new Date(Date.parse(publishedAt) + 24 * 3600_000).toISOString(),
        views: p.durationSeconds === 30 ? 250 : 100,
      });
      if (p.learningTestId === BLACKROOM_DURATION_TEST_ID) assert.equal(p.creativeStrategy, "drop_first");
      assert.equal(p.learningDecisionIds, p.targetNetworks.map(network=>network+":"+(p.learningTestId===BLACKROOM_DURATION_TEST_ID?"duration":"hook")+"-"+network).join(","));
    }
  }
  const now = new Date("2026-09-22T12:00:00Z"),
    snapshots = captureLearningSnapshots([], observations, now);
  const input = { now, experiments, snapshots, sourceObservedAt: { youtube: now.toISOString() } };
  const result = evaluateDurationLearning(input);
  assert.equal(result.youtube.recommendedSeconds, 30, JSON.stringify(result.youtube));
  assert.equal(result.tiktok.recommendedSeconds, null);
  assert.ok(result.youtube.matchedBlocks >= 5);
  assert.equal(result.youtube.windowHours, 24);
  assert.match(result.youtube.id,/^[a-f0-9]{20}$/);
  for(const conflict of [{format:"horizontal"}, {language:"es"}, {creativeStrategy:"instant_drop"}]) {
    const duplicates=experiments.map(e=>({...e,...conflict}));
    for(const records of [[...experiments,...duplicates],[...duplicates,...experiments]]) {
      const incompatible=evaluateDurationLearning({...input,experiments:records}).youtube;
      assert.equal(incompatible.exact,0);
      assert.equal(incompatible.recommendedSeconds,null);
      assert.notEqual(incompatible.id,result.youtube.id);
    }
  }
  assert.equal(evaluateDurationLearning({ ...input, snapshots: [] }).youtube.recommendedSeconds, null);
  assert.equal(
    evaluateDurationLearning({ ...input, sourceObservedAt: { youtube: "2026-09-18T12:00:00Z" } }).youtube
      .recommendedSeconds,
    null,
  );
  const confounded = observations.map((o) => {
    const arm = experiments.find((e) => e.platformPostId === o.postId).durationSeconds;
    const publishedAt =
      o.publishedAt.slice(0, 10) + "T" + (arm === 15 ? "02" : arm === 30 ? "11" : "19") + ":00:00-04:00";
    return { ...o, publishedAt, observedAt: new Date(Date.parse(publishedAt) + 24 * 3600_000).toISOString() };
  });
  assert.equal(
    evaluateDurationLearning({ ...input, snapshots: captureLearningSnapshots([], confounded, now) }).youtube
      .matchedBlocks,
    0,
  );
});

test("multi-day controlled planning produces matched evidence without repeating segments or increasing volume", () => {
  const state = queue();
  state.sourceHistory = [];
  state.analytics = { verifiedLearning: {} };
  const history: any = { version: 1, entries: [] };
  const experiments: any[] = [];
  const observations: any[] = [];
  const inventory = Array.from({ length: 40 }, (_, i) => ({ id: `set-${i}`, title: `DJ${i % 5} - DJ Set`, duration: 7200 }));
  for (let day = 1; day <= 7; day++) {
    const date = `2026-09-0${day}`;
    state.jobs = [{ id: `day-${day}`, targetDate: date, status: "queued", notBefore: "2026-08-31T00:00:00Z",
      slots: ["00:30", "05:00", "09:30", "14:00", "19:00"].map(localTime => ({ localTime, timezone: "America/New_York" })),
      requirements: { posts: 5, djs: 5, postsPerDj: 1, durationsSeconds: [15] } }];
    const djs = new Set();
    for (let i = 0; i < 5; i++) {
      const plan = planBlackRoomDeterministicEdit({ queue: state, ledger: history, inventory, now: new Date("2026-08-31T12:00:00Z") })!;
      assert.ok(plan); djs.add(plan.dj);
      const start = plan.windowStartSeconds, end = start + 15;
      for (const entry of history.entries.filter((e: any) => e.videoId === plan.videoId)) assert.ok(end <= entry.segmentStartSeconds || start >= entry.segmentEndSeconds);
      const id = `post-${day}-${i}`;
      const publishedAt = `${date}T${plan.slot}:00Z`;
      history.entries.push({ ...plan, reservationId: id, status: "confirmed", segmentStartSeconds: start, segmentEndSeconds: end,
        publicationDateTime: publishedAt.slice(0, 19) });
      experiments.push({ ...plan, metricoolId: id, reservationId: id, network: "youtube", platformPostId: id,
        sourceVideoId: plan.videoId, publishedAt });
      observations.push({ network: "youtube", postId: id, publishedAt, observedAt: new Date(Date.parse(publishedAt) + 24 * 3600000).toISOString(),
        views: plan.creativeStrategy === "instant_drop" ? 400 : 100 });
    }
    assert.equal(djs.size, 5);
    assert.equal(planBlackRoomDeterministicEdit({ queue: state, ledger: history, inventory, now: new Date("2026-08-31T12:00:00Z") }), null);
  }
  const now = new Date("2026-09-09T00:00:00Z");
  const result = evaluateBlackRoomLearning({ experiments, snapshots: captureLearningSnapshots([], observations, now),
    sourceObservedAt: { youtube: now.toISOString() }, now }).youtube;
  assert.equal(result.status, "testing");
  assert.ok(result.matchedBlocks >= 3);
  assert.equal(result.winner, "instant_drop");
});

test("controlled learning never lets one network's winner dictate crossposted edits", () => {
  const state = queue();
  const now = new Date("2026-07-22T12:00:00Z");
  state.analytics = { verifiedLearning: {
    youtube: { winner: "instant_drop", sourceObservedAt: now.toISOString() },
    tiktok: { winner: null, sourceObservedAt: now.toISOString() },
    facebook: { winner: "drop_first", sourceObservedAt: now.toISOString() },
  } };
  const input = { queue: state, ledger: { version: 1, entries: [] }, now,
    inventory: [{ id: "set-one", title: "DJ ONE - DJ Set", duration: 3600 }] };
  const plan = planBlackRoomDeterministicEdit(input)!;
  assert.equal(plan.allocationMode, "explore");
  assert.equal(plan.durationSeconds, 15);
  assert.equal(plan.format, "vertical");
  assert.equal(plan.language, "en");
  assert.match(plan.learningReference!, /^BR-[a-f0-9]{12}$/);
  assert.ok(plan.caption.includes(plan.learningReference!));
  for (const decision of Object.values(state.analytics.verifiedLearning) as any[]) {
    decision.winner = "instant_drop";
    decision.sourceObservedAt = "2026-07-01T00:00:00Z";
  }
  const stale = planBlackRoomDeterministicEdit(input)!;
  assert.equal(stale.allocationMode, "explore");
  assert.equal(stale.videoId, plan.videoId);
  assert.equal(stale.windowStartSeconds, plan.windowStartSeconds);
});

test("deterministic planner chooses an unused source and covers missing long duration", () => {
  const plan = planBlackRoomDeterministicEdit({
    queue: queue(), ledger: ledger(), now: new Date("2026-07-22T12:00:00.000Z"),
    inventory: [
      { id: "used-video", title: "USED - DJ Set", duration: 3600 },
      { id: "fresh-video", title: "DJ 0 - Traktor DJ Set at BlackRoom", duration: 3600 },
    ],
  });
  assert.ok(plan);
  assert.equal(plan.videoId, "fresh-video");
  assert.equal(plan.slot, "08:00");
  assert.equal(plan.durationSeconds, 600);
  assert.equal(plan.format, "horizontal");
  assert.equal(plan.windowEndSeconds - plan.windowStartSeconds, 780);
  assert.equal(plan.caption.includes("http"), false);
});

test("planner explicitly exploits a proven DJ with a fresh eligible source", () => {
  const state = queue();
  state.analytics = { preferredDjs: ["WINNER"] } as any;
  const plan = planBlackRoomDeterministicEdit({
    queue: state,
    ledger: { version: 1, entries: [] },
    now: new Date("2026-07-22T12:00:00.000Z"),
    inventory: [
      { id: "other-video", title: "OTHER - DJ Set", duration: 3600 },
      { id: "winner-fresh", title: "WINNER - DJ Set", duration: 3600 },
    ],
  });
  assert.equal(plan?.dj, "WINNER");
  assert.equal(plan?.videoId, "winner-fresh");
});

test("planner biases proven format and language while preserving exploration", () => {
  const state = queue();
  state.sourceHistory = [];
  state.jobs[0].slots = [{ localTime: "18:00", timezone: "America/New_York", networks: ["facebook"] }];
  state.jobs[0].requirements = { ...state.jobs[0].requirements, posts: 1, djs: 1, postsPerDj: 1, durationsSeconds: [30], minimumClipsPerDuration: 1 };
  state.analytics = {
    preferredFormats: ["horizontal"], formatPerformance: [{ value: "horizontal", samples: 8, medianViews: 200, totalViews: 1_600 }],
    preferredLanguages: ["es"], languagePerformance: [{ value: "es", samples: 8, medianViews: 180, totalViews: 1_440 }],
  };
  const plan = planBlackRoomDeterministicEdit({
    queue: state, ledger: { version: 1, entries: [] } as any,
    inventory: [{ id: "winner", title: "WINNER - DJ Set", duration: 3600 }],
  });
  assert.equal(plan?.format, "horizontal");
  assert.equal(plan?.language, "es");
});

test("planner skips a source that failed to download without recording it as published", () => {
  const state = queue();
  state.failedSourceVideos = [{ videoId: "blocked-video", failedAt: "2026-07-28T00:00:00.000Z", reason: "timeout" }];
  state.sourceHistory = [];
  state.jobs[0].requirements.djs = 1;
  state.jobs[0].requirements.postsPerDj = 10;
  const plan = planBlackRoomDeterministicEdit({
    queue: state,
    ledger: { version: 1, entries: [] } as any,
    inventory: [
      { id: "blocked-video", title: "Blocked DJ - DJ Set", duration: 3600 },
      { id: "fallback-video", title: "Fallback DJ - DJ Set", duration: 3600 },
    ],
  });
  assert.ok(plan);
  assert.equal(plan.videoId, "fallback-video");
});

test("planner skips a failed source after the DJ has already been selected", () => {
  const state = queue();
  state.failedSourceVideos = [{ videoId: "blocked-video", failedAt: "2026-07-28T00:00:00.000Z", reason: "timeout" }];
  state.sourceHistory = [];
  state.jobs[0].requirements.djs = 1;
  state.jobs[0].requirements.postsPerDj = 2;
  const selected = planBlackRoomDeterministicEdit({
    queue: state,
    ledger: { version: 1, entries: [{ jobId: "job-1", slot: "00:30", videoId: "prior-video", dj: "Fallback DJ", language: "en", format: "vertical", durationSeconds: 15 }] } as any,
    inventory: [
      { id: "blocked-video", title: "Fallback DJ - DJ Set", duration: 3600 },
      { id: "fallback-video", title: "Fallback DJ - DJ Set", duration: 3600 },
    ],
  });
  assert.ok(selected);
  assert.equal(selected.videoId, "fallback-video");
});

test("planner replaces a discarded reservation in the same slot", () => {
  const state = queue();
  state.sourceHistory = [];
  state.jobs[0].slots = [{ localTime: "00:30", timezone: "America/New_York" }];
  state.jobs[0].requirements.posts = 1;
  state.jobs[0].requirements.djs = 1;
  state.jobs[0].requirements.postsPerDj = 1;
  const plan = planBlackRoomDeterministicEdit({
    queue: state,
    ledger: {
      version: 1,
      entries: [{
        jobId: "job-1", slot: "00:30", videoId: "stale-video", dj: "Old DJ", language: "en", format: "vertical", durationSeconds: 15,
        segmentStartSeconds: 0, segmentEndSeconds: 15, status: "discarded",
      }],
    } as any,
    inventory: [{ id: "replacement-video", title: "Replacement DJ - DJ Set", duration: 3600 }],
  });
  assert.ok(plan);
  assert.equal(plan.slot, "00:30");
  assert.equal(plan.videoId, "replacement-video");
});

test("planner stops immediately when the queue is paused", () => {
  assert.equal(planBlackRoomDeterministicEdit({
    queue: queue(false), ledger: { version: 1, entries: [] } as any,
    inventory: [{ id: "fresh", title: "DJ - DJ Set", duration: 3600 }],
  }), null);
});


test("network targets are spread across the day and explicit Facebook plus YouTube orders exclude TikTok", () => {
  const state = queue();
  state.jobs[0].slots = Array.from({ length: 10 }, (_, index) => ({
    localTime: `${String(index * 2).padStart(2, "0")}:00`,
    timezone: "America/New_York",
  }));
  state.analytics = { networkDailyTargets: { tiktok: 5, facebook: 10, youtube: 7 } };
  const selected = state.jobs[0].slots.map((slot: any) => selectBlackRoomTargetNetworks(state.jobs[0], slot, state));
  assert.equal(selected.filter((networks: string[]) => networks.includes("tiktok")).length, 5);
  assert.equal(selected.filter((networks: string[]) => networks.includes("facebook")).length, 10);
  assert.equal(selected.filter((networks: string[]) => networks.includes("youtube")).length, 7);

  const explicit = { ...state.jobs[0].slots[0], networks: ["facebook", "youtube"] };
  assert.deepEqual(selectBlackRoomTargetNetworks(state.jobs[0], explicit, state), ["facebook", "youtube"]);
});

test("a Facebook and YouTube-only order produces a vertical Short and never targets TikTok", () => {
  const state = queue();
  state.jobs[0].slots[0].networks = ["facebook", "youtube"];
  state.jobs[0].requirements.djs = 1;
  state.jobs[0].requirements.postsPerDj = 10;
  const plan = planBlackRoomDeterministicEdit({
    queue: state,
    ledger: { version: 1, entries: [] } as any,
    now: new Date("2026-07-22T12:00:00.000Z"),
    inventory: [{ id: "fresh", title: "DJ A - DJ Set", duration: 3600 }],
  });
  assert.deepEqual(plan?.targetNetworks, ["facebook", "youtube"]);
  assert.equal(plan?.format, "vertical");
  assert.ok((plan?.durationSeconds || 999) <= 120);
});

test("planner skips a full retry job and advances to the next day", () => {
  const state = queue();
  const next = structuredClone(state.jobs[0]);
  next.id = "job-2";
  next.targetDate = "2026-07-24";
  state.jobs.push(next);
  const full = {
    version: 1,
    entries: state.jobs[0].slots.map((slot: any, index: number) => ({
      jobId: "job-1", slot: slot.localTime, videoId: `old-${index}`, dj: `DJ ${index}`,
      language: "en", format: "horizontal", durationSeconds: 30,
    })),
  };
  const plan = planBlackRoomDeterministicEdit({
    queue: state, ledger: full as any, now: new Date("2026-07-22T12:00:00.000Z"),
    inventory: [{ id: "fresh", title: "NEW DJ - DJ Set", duration: 3600 }],
  });
  assert.equal(plan?.jobId, "job-2");
});

test("priority source is used only when eligible and cannot block fallback", () => {
  const state = queue();
  const base = { queue: state, ledger: { version: 1, entries: [] } as any, now: new Date("2026-07-22T12:00:00.000Z") };
  const inventory = [
    { id: "short-priority", title: "PRIORITY - DJ Set", duration: 20 },
    { id: "eligible", title: "ELIGIBLE - DJ Set", duration: 3600 },
  ];
  assert.equal(planBlackRoomDeterministicEdit({ ...base, inventory, priorityVideoId: "short-priority" })?.videoId, "eligible");
  assert.equal(planBlackRoomDeterministicEdit({ ...base, inventory, priorityVideoId: "eligible" })?.videoId, "eligible");
});

test("planner enforces exact DJ membership and per-DJ quota", () => {
  const state = queue();
  state.jobs[0].requirements.djs = 2;
  state.jobs[0].requirements.postsPerDj = 1;
  const used = {
    version: 1,
    entries: [{ jobId: "job-1", slot: "00:30", videoId: "old", dj: "DJ A", language: "en", format: "vertical", durationSeconds: 15 }],
  };
  assert.throws(() => planBlackRoomDeterministicEdit({
    queue: state, ledger: used as any, now: new Date("2026-07-22T12:00:00.000Z"),
    inventory: [{ id: "same-dj", title: "DJ A - DJ Set", duration: 3600 }],
  }), /distinct DJs/);
  const atQuota = {
    version: 1,
    entries: [
      { jobId: "job-1", slot: "00:30", videoId: "old-a", dj: "DJ A", language: "en", format: "vertical", durationSeconds: 15 },
      { jobId: "job-1", slot: "02:00", videoId: "old-b", dj: "DJ B", language: "es", format: "horizontal", durationSeconds: 30 },
    ],
  };
  assert.throws(() => planBlackRoomDeterministicEdit({
    queue: state, ledger: atQuota as any, now: new Date("2026-07-22T12:00:00.000Z"),
    inventory: [{ id: "third-dj", title: "DJ C - DJ Set", duration: 3600 }],
  }), /per-DJ quota/);
});

test("planner completes the distinct-DJ rotation with a non-overlapping segment from a previously used set", () => {
  const state = queue();
  state.sourceHistory = [{
    videoId: "dj-b-only-set", segmentStartSeconds: 0, segmentEndSeconds: 120,
  }];
  state.jobs[0].requirements.djs = 2;
  state.jobs[0].requirements.postsPerDj = 3;
  const used = {
    version: 1,
    entries: [{
      jobId: "job-1", slot: "00:30", videoId: "dj-a-set", dj: "DJ A",
      language: "en", format: "vertical", durationSeconds: 15,
      segmentStartSeconds: 0, segmentEndSeconds: 105,
    }],
  };
  const plan = planBlackRoomDeterministicEdit({
    queue: state, ledger: used as any, now: new Date("2026-07-22T12:00:00.000Z"),
    inventory: [{ id: "dj-b-only-set", title: "DJ B - DJ Set", duration: 3600 }],
  });
  assert.equal(plan?.dj, "DJ B");
  assert.equal(plan?.videoId, "dj-b-only-set");
  assert.ok((plan?.windowStartSeconds || 0) >= 120);
});

test("planner still prefers a never-used source over reusing a valid older set", () => {
  const state = queue();
  state.sourceHistory = [{
    videoId: "dj-b-old-set", segmentStartSeconds: 0, segmentEndSeconds: 120,
  }];
  state.jobs[0].requirements.djs = 2;
  state.jobs[0].requirements.postsPerDj = 3;
  const used = {
    version: 1,
    entries: [{
      jobId: "job-1", slot: "00:30", videoId: "dj-a-set", dj: "DJ A",
      language: "en", format: "vertical", durationSeconds: 15,
      segmentStartSeconds: 0, segmentEndSeconds: 105,
    }],
  };
  const plan = planBlackRoomDeterministicEdit({
    queue: state, ledger: used as any, now: new Date("2026-07-22T12:00:00.000Z"),
    inventory: [
      { id: "dj-b-old-set", title: "DJ B - DJ Set", duration: 3600 },
      { id: "dj-b-fresh-set", title: "DJ B - DJ Set", duration: 3600 },
    ],
  });
  assert.equal(plan?.videoId, "dj-b-fresh-set");
});

test("planner never reuses a source when its earlier segment boundaries are incomplete", () => {
  const state = queue();
  state.sourceHistory = [{ videoId: "dj-b-unknown-segment" }];
  state.jobs[0].requirements.djs = 2;
  state.jobs[0].requirements.postsPerDj = 3;
  const used = {
    version: 1,
    entries: [{
      jobId: "job-1", slot: "00:30", videoId: "dj-a-set", dj: "DJ A",
      language: "en", format: "vertical", durationSeconds: 15,
      segmentStartSeconds: 0, segmentEndSeconds: 105,
    }],
  };
  assert.throws(() => planBlackRoomDeterministicEdit({
    queue: state, ledger: used as any, now: new Date("2026-07-22T12:00:00.000Z"),
    inventory: [{ id: "dj-b-unknown-segment", title: "DJ B - DJ Set", duration: 3600 }],
  }), /fresh or non-overlapping source segment/);
});

test("extracts DJ names and builds correct output filters", () => {
  assert.equal(extractBlackRoomDj("ILLSKIN - Hardgroove DJ Set at BlackRoom"), "ILLSKIN");
  assert.match(buildBlackRoomVideoFilter("vertical"), /crop=1080:1920/);
  assert.match(buildBlackRoomVideoFilter("horizontal"), /pad=1920:1080/);
});

test("audio energy parser places the strongest rise two seconds after clip start", () => {
  const output = [
    "frame:0 pts:0 pts_time:0", "lavfi.astats.Overall.RMS_level=-22.0",
    "frame:1 pts:48000 pts_time:1", "lavfi.astats.Overall.RMS_level=-24.0",
    "frame:2 pts:144000 pts_time:3", "lavfi.astats.Overall.RMS_level=-8.0",
    "frame:3 pts:240000 pts_time:5", "lavfi.astats.Overall.RMS_level=-10.0",
  ].join("\n");
  const samples = parseBlackRoomEnergySamples(output);
  assert.equal(samples.length, 4);
  assert.equal(findBlackRoomDropOffset(samples, 30, 120), 1);
  assert.equal(findBlackRoomDropOffset(samples, 30, 120, "instant_drop"), 2.8);
  assert.equal(findBlackRoomDropOffset(samples, 30, 120, "build_then_drop"), 0);
});

test("CEO low-view strategy favors short clips after every duration has evidence", () => {
  const state = queue();
  state.jobs[0].slots.push({ localTime: "09:30", timezone: "America/New_York" });
  state.jobs[0].requirements.posts = 7;
  state.jobs[0].requirements.djs = 1;
  state.jobs[0].requirements.postsPerDj = 10;
  state.analytics = { creativeStrategy: "instant_drop", tiktokLowViewRate: 1, networkSamples: { tiktok: 5 } };
  const explored = {
    version: 1,
    entries: [15, 30, 60, 120, 300, 600].map((durationSeconds, index) => ({
      jobId: "job-1", slot: state.jobs[0].slots[index].localTime,
      videoId: `old-${index}`, dj: "DJ A", language: index % 2 ? "es" : "en",
      format: durationSeconds >= 300 ? "horizontal" : "vertical", durationSeconds,
    })),
  };
  const plan = planBlackRoomDeterministicEdit({
    queue: state, ledger: explored as any, now: new Date("2026-07-22T12:00:00.000Z"),
    inventory: [{ id: "fresh", title: "DJ A - DJ Set", duration: 3600 }],
  });
  assert.equal(plan?.durationSeconds, 15);
  assert.equal(plan?.creativeStrategy, "instant_drop");
  assert.match(plan?.caption || "", /No intro|Sin intro|first second|primer segundo|full pressure|presión/);
});

test("CEO does not bias duration from fewer than five TikTok samples", () => {
  const state = queue();
  state.jobs[0].slots = ["00:30", "02:00", "03:30", "05:00", "06:30", "08:00", "09:30", "11:00", "12:30"]
    .map((localTime) => ({ localTime, timezone: "America/New_York" }));
  state.jobs[0].requirements.posts = 9;
  state.jobs[0].requirements.djs = 1;
  state.jobs[0].requirements.postsPerDj = 10;
  state.analytics = { creativeStrategy: "drop_first", tiktokLowViewRate: 1, networkSamples: { tiktok: 4 } };
  const explored = {
    version: 1,
    entries: [15, 15, 30, 30, 60, 120, 300, 600].map((durationSeconds, index) => ({
      jobId: "job-1", slot: state.jobs[0].slots[index].localTime,
      videoId: `old-${index}`, dj: "DJ A", language: index % 2 ? "es" : "en",
      format: durationSeconds >= 300 ? "horizontal" : "vertical", durationSeconds,
    })),
  };
  const plan = planBlackRoomDeterministicEdit({
    queue: state, ledger: explored as any, now: new Date("2026-07-22T12:00:00.000Z"),
    inventory: [{ id: "fresh", title: "DJ A - DJ Set", duration: 3600 }],
  });
  assert.equal(plan?.durationSeconds, 60);
});

test("CEO reuses the best proven duration after exploration", () => {
  const state = queue();
  state.jobs[0].slots = ["00:30", "02:00", "03:30", "05:00", "06:30", "08:00", "09:30"].map((localTime) => ({ localTime, timezone: "America/New_York" }));
  state.jobs[0].requirements.posts = 7;
  state.jobs[0].requirements.djs = 1;
  state.jobs[0].requirements.postsPerDj = 10;
  state.analytics = {
    creativeStrategy: "drop_first",
    preferredDurations: [30, 60, 15, 120],
    durationPerformance: [
      { durationSeconds: 30, samples: 5, medianViews: 100, totalViews: 500 },
      { durationSeconds: 60, samples: 5, medianViews: 80, totalViews: 400 },
    ],
  } as any;
  const explored = { version: 1, entries: [15, 30, 60, 120, 300, 600].map((durationSeconds, index) => ({
    jobId: "job-1", slot: state.jobs[0].slots[index].localTime, videoId: `old-${index}`,
    dj: "DJ A", language: "en", format: "vertical", durationSeconds,
  })) };
  const plan = planBlackRoomDeterministicEdit({
    queue: state, ledger: explored as any, now: new Date("2026-07-22T12:00:00.000Z"),
    inventory: [{ id: "fresh", title: "DJ A - DJ Set", duration: 3600 }],
  });
  assert.equal(plan?.durationSeconds, 30);
});

test("command builders keep downloads partial and renders platform-compatible", () => {
  const plan: any = {
    videoUrl: "https://www.youtube.com/watch?v=abc", windowStartSeconds: 100, windowEndSeconds: 220,
    durationSeconds: 30, format: "vertical",
  };
  const download = buildBlackRoomYtDlpWindowArgs(plan, "/project/sources/a.mp4", "/project/agent/editor-tmp/a");
  assert.deepEqual(download.slice(1, 3), ["--extractor-args", "youtube:player_client=web_safari"]);
  assert.ok(download.includes("--download-sections"));
  assert.ok(download.includes("*100-220"));
  assert.ok(download.includes("bestvideo*[height<=1080]+bestaudio/best[height<=1080]"));
  assert.deepEqual(download.slice(download.indexOf("--socket-timeout"), download.indexOf("--socket-timeout") + 6), [
    "--socket-timeout", "30", "--retries", "3", "--fragment-retries", "3",
  ]);
  assert.ok(download.includes("temp:/project/agent/editor-tmp/a"));
  const render = buildBlackRoomRenderArgs("/project/sources/a.mp4", "/project/rendered/a.mp4", plan, 4);
  assert.ok(render.includes("h264_videotoolbox"));
  assert.ok(render.includes("aac"));
  assert.ok(render.includes("+faststart"));
  assert.equal(render.at(-1), "/project/rendered/a.mp4");
});

test("YouTube downloads use the local Chrome session by default and can be disabled", () => {
  assert.deepEqual(buildBlackRoomYtDlpAuthArgs(), ["--cookies-from-browser", "chrome"]);
  assert.deepEqual(buildBlackRoomYtDlpAuthArgs("none"), []);
});

test("retry unavailable formats once with public default clients and the same audio and window requirements", async () => {
  const plan = { videoUrl: "https://www.youtube.com/watch?v=owned", windowStartSeconds: 20, windowEndSeconds: 65 } as any;
  const calls: string[][] = [];
  await downloadBlackRoomWindowWithFallback(plan, "/source.mp4", "/tmp/work", ["--cookies-from-browser", "chrome"], async args => {
    calls.push(args);
    if (calls.length === 1) throw Object.assign(new Error("yt-dlp failed"), { stderr: "ERROR: Requested format is not available." });
  });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], ["--ignore-config", ...calls[0].filter(v => !["--cookies-from-browser", "chrome", "--extractor-args", "youtube:player_client=web_safari"].includes(v))]);
  assert.ok(calls[1].includes("*20-65"));
  assert.ok(calls[1].includes("bestvideo*[height<=1080]+bestaudio/best[height<=1080]"));
  for (const [message, expectedCalls] of [["disk full", 1], ["Requested format is not available", 2]] as const) {
    let attempts = 0;
    await assert.rejects(downloadBlackRoomWindowWithFallback(plan, "/source.mp4", "/tmp/work", [], async () => {
      attempts++;
      throw new Error(message);
    }), new RegExp(message));
    assert.equal(attempts, expectedCalls);
  }
});

test("owned-source validation accepts only the official BlackRoom channel", () => {
  assert.equal(isOwnedBlackRoomMetadata({ channel_id: "UCi__qHBfHLlYg0fu86BUA8g" }), true);
  assert.equal(isOwnedBlackRoomMetadata({ uploader_id: "@blackroom_us" }), true);
  assert.equal(isOwnedBlackRoomMetadata({ channel_id: "other", uploader_id: "@attacker" }), false);
});
