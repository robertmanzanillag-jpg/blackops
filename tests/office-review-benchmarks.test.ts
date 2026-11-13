import test from "node:test";
import assert from "node:assert/strict";
import { REVIEW_BENCHMARK_TASKS, buildReviewBenchmarkPrompt, gradeReviewBenchmark } from "../server/office-review-benchmarks.ts";
const answers = [
  [{ caseId: "r01", category: "authorization" }, { caseId: "r02", category: "authorization" }, { caseId: "r02", category: "secret_disclosure" }],
  [{ caseId: "r04", category: "sql_injection" }, { caseId: "r05", category: "command_injection" }],
  [{ caseId: "r07", category: "path_traversal" }, { caseId: "r08", category: "secret_disclosure" }],
];
test("profile has three immutable tasks and nine independent cases", () => {
  assert.equal(REVIEW_BENCHMARK_TASKS.length, 3);
  assert.equal(new Set(REVIEW_BENCHMARK_TASKS.flatMap(t => t.cases.map(c => c.id))).size, 9);
  for (const task of REVIEW_BENCHMARK_TASKS) {
    assert.equal(task.profileId, "reviewer-heldout"); assert.equal(task.profileVersion, "1");
    assert.ok(Object.isFrozen(task)); assert.ok(Object.isFrozen(task.cases)); assert.ok(task.cases.every(Object.isFrozen));
  }
});
test("full correct findings including multiple issues pass each task", () => {
  REVIEW_BENCHMARK_TASKS.forEach((task, i) => {
    assert.equal(gradeReviewBenchmark(JSON.stringify({ findings: answers[i] }), task).quality, 100);
    assert.equal(gradeReviewBenchmark(JSON.stringify({ findings: answers[i] }), task).passed, true);
  });
});
test("always empty and always flag all strategies fail clean and vulnerable cases", () => {
  REVIEW_BENCHMARK_TASKS.forEach(task => {
    const empty = gradeReviewBenchmark('{"findings":[]}', task);
    assert.equal(empty.passed, false); assert.ok(empty.quality < 80);
    const all = task.cases.flatMap(value => ["authorization","sql_injection","secret_disclosure","path_traversal","command_injection","other_security"].map(category => ({ caseId: value.id, category })));
    assert.equal(gradeReviewBenchmark(JSON.stringify({ findings: all }), task).passed, false);
  });
});
test("clean negative false positives and missing independent findings are penalized", () => {
  const task = REVIEW_BENCHMARK_TASKS[0];
  const missed = gradeReviewBenchmark(JSON.stringify({ findings: answers[0].slice(0, 2) }), task);
  assert.equal(missed.errors, 1); assert.equal(missed.quality, 75);
  const falsePositive = gradeReviewBenchmark(JSON.stringify({ findings: [...answers[0], { caseId: "r03", category: "authorization" }] }), task);
  assert.equal(falsePositive.errors, 1); assert.equal(falsePositive.passed, false);
});
test("oracle answers are absent from provider payload and cannot be substituted by task input", () => {
  const task = REVIEW_BENCHMARK_TASKS[0];
  const prompt = buildReviewBenchmarkPrompt(task, ["Check record ownership."]);
  assert.ok(prompt.includes('"id":"r03"'));
  assert.ok(!prompt.includes('"expected"')); assert.ok(!prompt.includes('"oracle"'));
  assert.ok(!prompt.includes(JSON.stringify(answers[0])));
  const modified = { ...task, cases: [{ id: "r01", code: "OVERRIDDEN", context: "OVERRIDDEN" }] };
  assert.ok(!buildReviewBenchmarkPrompt(modified, []).includes("OVERRIDDEN"));
  assert.throws(() => buildReviewBenchmarkPrompt({ ...task, profileVersion: "wrong" }, []), /UNKNOWN/);
});
test("bounded strict output schema rejects unknown cases/categories/keys and malformed data", () => {
  const task = REVIEW_BENCHMARK_TASKS[0];
  for (const output of ["not json", "[]", "null", '{"findings":[],"explanation":"extra"}',
    '{"findings":[{"caseId":"r04","category":"sql_injection"}]}',
    '{"findings":[{"caseId":"r01","category":"made_up"}]}',
    '{"findings":[{"caseId":"r01","category":"authorization","extra":true}]}',
    JSON.stringify({ findings: Array.from({ length: 25 }, () => answers[0][0]) }), " ".repeat(16001)]) {
    const result = gradeReviewBenchmark(output, task); assert.equal(result.passed, false); assert.equal(result.quality, 0);
  }
});
test("duplicate findings cannot inflate scores", () => {
  const grade = gradeReviewBenchmark(JSON.stringify({ findings: [...answers[0], answers[0][0]] }), REVIEW_BENCHMARK_TASKS[0]);
  assert.equal(grade.errors, 1); assert.equal(grade.quality, 75);
});
