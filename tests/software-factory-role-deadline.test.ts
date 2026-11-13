import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createDeadlineControlSnapshot, measureRoleWorkDeadline, ROLE_WORK_DEADLINE_ID, ROLE_WORK_DEADLINE_ASSERTIONS } from "../server/software-factory-role-deadline";
import { auditSavedRole } from "../server/office-role-audits";
import { sourceDigest, validateRoleSnapshot } from "../server/office-role-snapshots";
import { hasVerifiedDeadlineRegression, verifyRoleAcceptanceReport } from "../server/software-factory-role-artifact";
import { ROLE_WORK_ACCEPTANCE_ID, ROLE_WORK_ASSERTIONS } from "../server/software-factory-role-acceptance";
const base = "a".repeat(40), head = "b".repeat(40), now = Date.parse("2026-11-07T00:00:00Z");
test("deadline continuity fixture completes a real control audit while empty source remains blocked", () => {
    const owner = "trusted-deadline-fixture", source = createDeadlineControlSnapshot(owner, now);
    assert.deepEqual(validateRoleSnapshot(source, owner, now), source);
    const completed = auditSavedRole("control", source, owner, now);
    assert.equal(completed.status, "completed");
    assert.equal(completed.selected, 1);
    assert.equal(completed.completeCoverage, true);
    assert.equal(completed.sourceDigest, source.sourceDigest);
    const { sourceDigest: _digest, ...body } = source;
    const emptyBody = { ...body, total: 0, rows: [] };
    const blocked = auditSavedRole("control", { ...emptyBody, sourceDigest: sourceDigest(emptyBody) }, owner, now);
    assert.equal(blocked.status, "blocked");
    assert.ok(blocked.findings.some(f => f.code === "NO_SOURCE_RECORDS"));
});
function report() { const safety = { scenarioId: ROLE_WORK_ACCEPTANCE_ID, kind: "backend-acceptance", assertions: ROLE_WORK_ASSERTIONS.map(id => ({ id, passed: true })), passed: true, durationMs: 5, sourceManifestSha256: "c".repeat(64) }; const deadline = (passed: boolean) => ({ scenarioId: ROLE_WORK_DEADLINE_ID, passed, cases: ["sql", "web"].map(reader => ({ reader, passed, timedOut: !passed, elapsedMs: passed ? 60005 : 68005, assertions: ROLE_WORK_DEADLINE_ASSERTIONS.map(id => ({ id, passed })) })) }); return { version: 1, repository: "robertmanzanillag-jpg/blackops", scenarioId: ROLE_WORK_ACCEPTANCE_ID, scope: "backend-acceptance-only", createdAt: new Date(now).toISOString(), baseline: { ...structuredClone(safety), headSha: base, deadline: deadline(false) }, candidate: { ...structuredClone(safety), headSha: head, deadline: deadline(true) } }; }
function verify(r: unknown) { const bytes = Buffer.from(JSON.stringify(r)); return verifyRoleAcceptanceReport(bytes, { baseSha: base, headSha: head, now, sha256: createHash("sha256").update(bytes).digest("hex") }); }
test("deadline scenario requires measured baseline regression plus candidate pass, while old safety remains independent", () => {
    const r = report();
    assert.equal(hasVerifiedDeadlineRegression(verify(r)), true);
    const noBaseline = report();
    noBaseline.baseline.passed = false;
    noBaseline.baseline.assertions.forEach(a => a.passed = false);
    assert.equal(hasVerifiedDeadlineRegression(verify(noBaseline)), false);
    const alreadyFixed = report();
    alreadyFixed.baseline.deadline = alreadyFixed.candidate.deadline;
    assert.equal(hasVerifiedDeadlineRegression(verify(alreadyFixed)), false);
    const absent = report();
    delete (absent.candidate as any).deadline;
    assert.equal(hasVerifiedDeadlineRegression(verify(absent)), false);
});
test("forged fast pass, duplicate reader and incomplete assertions cannot qualify deadline evidence", () => {
    for (const mutate of [(r: any) => { r.candidate.deadline.cases[0].elapsedMs = 1; }, (r: any) => { r.candidate.deadline.cases[0].reader = "web"; }, (r: any) => { r.candidate.deadline.cases[0].assertions.pop(); }, (r: any) => { r.candidate.deadline.cases[0].timedOut = true; }]) {
        const r = report();
        mutate(r);
        assert.throws(() => verify(r));
    }
});
test("early successful candidate returns cannot manufacture a real-time deadline pass", async () => {
    const result = await measureRoleWorkDeadline({ createRoleWorkRunner: () => ({ tick: async () => { } }), parseRoleWork: () => ({ jobs: [] }) });
    assert.equal(result.passed, false);
    assert.deepEqual(result.cases.map(c => c.reader), ["sql", "web"]);
    assert.ok(result.cases.every(c => !c.assertions.find(a => a.id === "deadline-respected")!.passed));
});
test("candidate parser cannot invent unknown/completed jobs absent from controller journal", async () => {
    const result = await measureRoleWorkDeadline({ createRoleWorkRunner: () => ({ tick: async () => { } }), parseRoleWork: () => ({ jobs: [{ role: "legal", status: "unknown" }, { role: "news", status: "unknown" }, { role: "control", status: "completed", artifactId: "forged" }] }) });
    assert.ok(result.cases.every(c => !c.assertions.find(a => a.id === "unknown-without-proof")!.passed && !c.assertions.find(a => a.id === "next-role-completed")!.passed));
});
