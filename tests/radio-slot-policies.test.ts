import test from "node:test";
import assert from "node:assert/strict";
import { parseRadioDescription } from "../shared/radio-slots";
import { RADIO_SLOT_BASELINE_POLICY as baseline, RADIO_SLOT_CANDIDATE_POLICY as candidate, RADIO_SLOT_POLICIES,
  executeRadioSlotPolicy, parseRadioSlotsWithPolicy, evaluateRadioSlotPolicies } from "../shared/radio-slot-policies";

test("range policy repairs actual baseline outputs without modifying legacy parser", () => {
  const input = "7-8PM DJ Alpha\n8-9PM DJ Beta\n9-10PM DJ Gamma";
  const original = parseRadioDescription(input);
  assert.deepEqual(parseRadioSlotsWithPolicy(baseline, input), original);
  assert.notDeepEqual(original, { slot7: "DJ Alpha", slot8: "DJ Beta", slot9: "DJ Gamma" });
  assert.deepEqual(parseRadioSlotsWithPolicy(candidate, input), { slot7: "DJ Alpha", slot8: "DJ Beta", slot9: "DJ Gamma" });
  assert.deepEqual(parseRadioDescription(input), original);
});
test("three distinct fixed oracle families improve strictly without losing baseline-correct cases", () => {
  const evaluation = evaluateRadioSlotPolicies();
  assert.equal(evaluation.qualified, true);
  assert.equal(evaluation.artifacts.length, 3);
  assert.equal(new Set(evaluation.artifacts.map(a => a.benchmarkId)).size, 3);
  for (const artifact of evaluation.artifacts) {
    assert.ok(artifact.strictImprovement && artifact.noRegression);
    assert.equal(artifact.candidateQuality, 100);
    assert.ok(artifact.baselineQuality < artifact.candidateQuality);
    for (const entry of artifact.cases) assert.deepEqual(entry.baseline.assignment, parseRadioDescription(entry.description));
  }
  assert.deepEqual(evaluateRadioSlotPolicies(), evaluation);
  // Returned artifacts cannot change the private trusted oracle.
  evaluation.artifacts[0].cases[0].expected.slot7 = "tampered";
  assert.equal(evaluateRadioSlotPolicies().artifacts[0].cases[0].expected.slot7, "DJ Alpha");
});
test("version registry and input bounds fail closed; unsupported ranges preserve baseline behavior", () => {
  assert.ok(Object.isFrozen(RADIO_SLOT_POLICIES));
  assert.ok(Object.isFrozen(RADIO_SLOT_POLICIES[candidate]));
  for (const version of ["", "constructor", "radio-slots-range-v2"]) assert.throws(() => parseRadioSlotsWithPolicy(version, "7: Ana"));
  assert.throws(() => parseRadioSlotsWithPolicy(candidate, "a".repeat(20001)));
  for (const input of ["7-9PM: Ana", "7-8AM: Ana", "7:30-8:30PM Ana", "Agenda 7-8PM Ana", "7: Ana\n8: Luz\n9: Sol", null]) {
    assert.deepEqual(parseRadioSlotsWithPolicy(candidate, input), parseRadioDescription(input));
  }
});
test("work counters explicitly describe preprocessing rather than fabricated latency or total cost", () => {
  const input = "7-8PM Ana\n8-9PM Luz";
  const result = executeRadioSlotPolicy(candidate, input);
  assert.equal(result.work.inputCharacters, input.length);
  assert.equal(result.work.rangeLinesInspected, 2);
  assert.equal(result.work.rangeRewrites, 2);
  assert.equal(result.work.baselineParserCalls, 1);
  assert.equal(result.work.measurement, "structural-counters-not-latency-or-total-operations");
});
