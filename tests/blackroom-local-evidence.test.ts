import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { assessLocalBlackRoomExports, emptyEvidence, preferFreshLocalEvidence, applyLocalEditorialReport } from "../server/blackroom-local-evidence";
import { BLACKROOM_HOOK_TEST_ID, BLACKROOM_DURATION_TEST_ID, DURATION_ARMS } from "../server/blackroom-verified-learning";
import { planBlackRoomDeterministicEdit } from "../server/blackroom-deterministic-editor";
import { buildBlackRoomPublicationExperiments } from "../script/blackroom-remote-sync.mjs";
import { buildVerifiedMetricoolExport } from "../script/blackroom-metricool-exporter.mjs";
import { refreshLocalBlackRoomEvidence } from "../script/blackroom-local-evidence";

const ref = "BR-111111111111";
const seen = new Date("2026-11-04T12:00:00Z");
const sample = { id: "https://youtube.com/shorts/clip1", views: 150, durationSeconds: 15, observedAt: seen.toISOString(), publishedAt: "2026-11-03T12:00:00Z", learningReference: ref };
const receipt = { metricoolId: "scheduler1", network: "youtube", reservationId: "r", dj: "A", sourceVideoId: "set", durationSeconds: 15,
  format: "vertical", language: "en", creativeStrategy: "drop_first", learningTestId: BLACKROOM_HOOK_TEST_ID, learningReference: ref, slot: "12:00" } as const;
const assess = (samples: object[], previous = emptyEvidence(), now = seen) =>
  assessLocalBlackRoomExports(previous, [{ network: "youtube", samples }], [receipt] as any, now);

test("verified exports join one actual post, preserving age-matched evidence on replay and restart", () => {
  const first = assess([sample]);
  const decision = first.report.decisions.youtube;
  assert.equal(decision.exactIdentities, 1);
  assert.equal(decision.matchedSnapshots, 1);
  assert.equal(decision.winner, null);
  assert.deepEqual(first.report.observedDurationCohorts, [{network:"youtube",windowHours:24,durationBand:"1-15s",posts:1,medianViews:150}]);
  const replay = assess([sample, { ...sample, observedAt: "2036-01-01T00:00:00Z" }], first.archive, new Date("2026-11-06T12:00:00Z"));
  assert.equal(replay.report.decisions.youtube.status, "stale");
  assert.equal(replay.report.decisions.youtube.sourceObservedAt, seen.toISOString());
  assert.deepEqual(replay.archive, first.archive);
});

test("scheduler ids, missing views, untimed and ambiguous observations never qualify as experimental results", () => {
  assert.equal(assess([{...sample, id: receipt.metricoolId, learningReference: undefined}]).report.decisions.youtube.exactIdentities, 0);
  assert.equal(assess([{...sample, views:null}, {...sample, observedAt:undefined}]).archive.posts.length, 0);
  const first = assess([sample]);
  assert.equal(assess([{...sample, id:"different"}], first.archive).report.decisions.youtube.exactIdentities, 0);
});

test("only a newer, fresh decision of the same test overlays the in-memory editorial input", () => {
  const local = assess([sample]).report.decisions;
  const remote = structuredClone(local);
  remote.youtube.sourceObservedAt = "2026-11-04T10:00:00Z";
  assert.equal(preferFreshLocalEvidence(remote, local, seen)?.youtube, local.youtube);
  assert.equal(remote.youtube.sourceObservedAt, "2026-11-04T10:00:00Z");
  assert.equal(preferFreshLocalEvidence(undefined, local, seen), undefined);
  assert.equal(preferFreshLocalEvidence(remote, local, new Date("2026-11-07"))?.youtube, remote.youtube);
  assert.equal(preferFreshLocalEvidence(local, remote, seen)?.youtube, local.youtube);
});

test("a conflicting measured duration vetoes exact reference attribution across exports", () => {
  const bad = assess([{ ...sample, durationSeconds: 60 }]);
  assert.equal(bad.report.decisions.youtube.exactIdentities, 0);
  assert.equal(bad.report.decisions.youtube.matchedSnapshots, 0);
  const later = new Date("2026-11-04T13:00:00Z");
  const missing = assess([{ ...sample, observedAt: later.toISOString(), durationSeconds: undefined }], bad.archive, later);
  assert.equal(missing.report.decisions.youtube.matchedSnapshots, 0);
  const contradicts = assess([{ ...sample, observedAt: later.toISOString(), durationSeconds: 15 }], bad.archive, later);
  assert.equal(contradicts.report.decisions.youtube.exactIdentities, 0);
  assert.equal(assess([{ ...sample, durationSeconds:16 }]).report.decisions.youtube.exactIdentities, 1);
});

test("local archive is crash-safe on invalid input; repeated refreshes do not touch publishing or mark remote import", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "br-local-evidence-test-"));
  try {
    await writeFile(path.join(dir, "queue.json"), '{"enabled":false}');
    const receiptJson = JSON.stringify({entries:[{ status:"confirmed", networkReceipts:{youtube:"scheduler1"}, ...receipt, videoId:"set" }]});
    await writeFile(path.join(dir, "worker-ledger.json"), receiptJson);
    await writeFile(path.join(dir,"latest-export.json"), JSON.stringify({imports:[{network:"youtube",samples:[sample]}]}));
    await writeFile(path.join(dir,"manual-planner-receipts.json"), JSON.stringify({brandId:"6585226",state:"scheduled_not_published",rows:[
      { plannerId:"1234", networks:["youtube","tiktok","tiktok"] }]}));
    const report = await refreshLocalBlackRoomEvidence(dir, dir, seen, { home: dir });
    assert.equal(report.decisions.youtube.matchedSnapshots, 1);
    assert.equal(report.unverifiedManualDeliveries, 2);
    assert.equal(report.decisions.tiktok.matchedSnapshots, 0);
    const replay = await refreshLocalBlackRoomEvidence(dir, dir, seen, { home: dir });
    assert.equal(replay.snapshotCount, 1);
    assert.equal((replay as any).lastCompleteImportAt, undefined);
    assert.equal(await readFile(path.join(dir,"queue.json"),"utf8"), '{"enabled":false}');
    assert.equal(await readFile(path.join(dir,"worker-ledger.json"),"utf8"), receiptJson);
    await writeFile(path.join(dir,"local-ceo-evidence.json"), "{bad");
    await assert.rejects(refreshLocalBlackRoomEvidence(dir, dir, seen, { home: dir }));
    assert.equal(await readFile(path.join(dir,"local-ceo-evidence.json"),"utf8"), "{bad");
  } finally { await rm(dir, { recursive:true, force:true }); }
});

test("CSV data and actual confirmed receipts feed duration planning offline; disagreement never exploits a shared edit", () => {
  const now = new Date("2026-11-04T22:00:00Z");
  const networks = ["tiktok", "facebook", "youtube"] as const;
  const makeReport = (mixed = false, durationMismatch = false) => {
    const imports = [], entries = [];
    for (let group = 0; group < 5; group++) for (let day = 0; day < 3; day++) {
      const num = 1000 + group * 3 + day, arm = DURATION_ARMS[(group+day)%3], dj = "DJ-" + group;
      const date = "2026-11-0" + (day+1), hour = group%2 ? "19" : "09";
      const publishedAt = date + "T" + hour + ":00:00Z";
      const reference = "BR-" + num.toString(16).padStart(12,"0");
      entries.push({ status:"confirmed", reservationId:"owned-"+num, networkReceipts:Object.fromEntries(networks.map(n=>[n,"scheduler-"+num])),
        learningTestId:BLACKROOM_DURATION_TEST_ID, learningReference:reference, videoId:"set-"+group, dj, language:"en", format:"vertical",
        durationSeconds:arm, publicationDateTime:publishedAt, slot:hour+":00", creativeStrategy:"drop_first" });
      for (const net of networks) {
        const views = arm === (mixed && net === "facebook" ? 60 : 30) ? 350 : 100;
        const measuredSeconds = durationMismatch && arm === 30 ? 15 : arm;
        const filename = { tiktok:"tiktok-posts_range.csv", facebook:"facebook-reels_range.csv", youtube:"youtube-published-videos-posts_range.csv" }[net];
        const text = "URL,PostLink,videoId,Date,Views,VideoViews,Duration,Caption\n" +
          [`https://tiktok.com/@blackroom.clipss/video/${num}`, `https://facebook.com/reel/${num}`, "yt"+num, publishedAt,views,views,measuredSeconds,reference].join(",");
        imports.push(buildVerifiedMetricoolExport({ filename,network:net,text,observedAt:new Date(Date.parse(publishedAt)+86400_000).toISOString() }));
      }
    }
    return assessLocalBlackRoomExports(emptyEvidence(), imports, buildBlackRoomPublicationExperiments({entries}), now).report;
  };
  const consensus = makeReport(), mixed = makeReport(true), mismatch = makeReport(false,true);
  assert.equal(consensus.durationDecisions.tiktok.exact, 15);
  assert.equal(consensus.decisions.tiktok.declaredExperiments, 0); // duration observations never train the hook
  for (const n of networks) {
    assert.equal(consensus.durationDecisions[n].recommendedSeconds, 30);
    assert.equal(mismatch.durationDecisions[n].exact, 10);
    assert.equal(mismatch.durationDecisions[n].recommendedSeconds, null);
  }
  assert.equal(mixed.durationDecisions.facebook.recommendedSeconds, 60);
  const initial = { verifiedLearning:structuredClone(consensus.decisions), networkDailyTargets:{tiktok:4,facebook:4,youtube:4} } as any;
  const analytics = applyLocalEditorialReport(initial, consensus, now);
  assert.equal(initial.durationLearning, undefined);
  assert.deepEqual(analytics.networkDailyTargets,initial.networkDailyTargets);
  assert.equal(analytics.durationLearning?.youtube.recommendedSeconds,30);
  const bad = structuredClone(consensus); bad.durationDecisions.youtube = bad.durationDecisions.facebook;
  assert.equal(applyLocalEditorialReport(initial,bad,now).durationLearning?.youtube.recommendedSeconds,null);
  assert.equal(applyLocalEditorialReport(initial,consensus,new Date("2026-11-08")).durationLearning, undefined);
  assert.deepEqual(applyLocalEditorialReport(analytics,mixed,now).durationLearning,analytics.durationLearning); // Equal-time replay cannot supersede.
  const divergent = applyLocalEditorialReport(initial,mixed,now);
  const dayNum = Math.floor(now.getTime()/86400_000);
  const date = new Date((dayNum+(6-dayNum%6)%6)*86400_000).toISOString().slice(0,10);
  const plan = (evidence: typeof analytics, id: string) => planBlackRoomDeterministicEdit({ now, ledger:{version:1,entries:[]},
    inventory:[{id:"source",title:"DJ NEW - DJ Set",duration:3600}],queue:{enabled:true, sourceHistory:[], prioritySources:[], analytics:evidence,
      jobs:[{id,targetDate:date,status:"queued",slots:[{localTime:"12:00",networks:[...networks]}],requirements:{posts:1,djs:1,postsPerDj:1,durationsSeconds:[15,30,60]}}]} as any });
  let exploited = false;
  for (let i=0;i<50 && !exploited;i++) {
    const id="duration-"+i, p=plan(analytics,id)!;
    const q=plan(divergent,id)!;
    assert.equal(q.allocationMode,"explore");
    assert.equal(q.learningTestId,BLACKROOM_DURATION_TEST_ID);
    if (p.allocationMode==="exploit") { assert.equal(p.durationSeconds,30); assert.notEqual(p.learningTestId,BLACKROOM_DURATION_TEST_ID); exploited=true; }
  }
  assert.ok(exploited);
});
