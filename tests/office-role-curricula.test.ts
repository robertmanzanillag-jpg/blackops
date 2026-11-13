import test from "node:test";
import assert from "node:assert/strict";
import { OFFICE_CURRICULUM_ROLES, ROLE_CURRICULUM_LIMITS, roleFixtures, buildRolePrompt, gradeRoleResponse, type OfficeCurriculumRole } from "../server/office-role-curricula";
const audited = ["code", "news", "legal", "github", "control", "revenue", "clippers", "portfolio", "automations", "dropshipping", "news:ny-news", "marketing-cmo", "news:miami-news", "blackroom-videos"];
const answer = (role: OfficeCurriculumRole, index: number, classification: string, decision: string) => JSON.stringify({ version: 1, role, fixtureId: `${role}:evidence-v1:${index}`, evidenceIds: [`${role}:source:${index}`], classification, decision });

test("exact audited roles each have three distinct synthetic fixtures, no runtime admission", () => {
  assert.deepEqual([...OFFICE_CURRICULUM_ROLES].sort(), audited.sort());
  for (const role of OFFICE_CURRICULUM_ROLES) {
    const fixtures = roleFixtures(role);
    assert.equal(fixtures.length, 3);
    assert.equal(new Set(fixtures.map(f => f.id)).size, 3);
    assert.equal(new Set(fixtures.map(f => f.expected.classification)).size, 3);
    for (const fixture of fixtures) {
      const prompt = buildRolePrompt(role, fixture.id);
      const parsed = JSON.parse(prompt);
      assert.equal(parsed.expected, undefined);
      assert.equal(parsed.source.classification, undefined);
      assert.ok(prompt.length < ROLE_CURRICULUM_LIMITS.maxPromptCharacters);
      const raw = JSON.stringify({version: 1, role, fixtureId: fixture.id, ...fixture.expected});
      assert.deepEqual(gradeRoleResponse(role, fixture.id, raw), { fixtureId: fixture.id, scope: "synthetic_narrow_skill", quality: 100, passed: true, errors: [] });
      const wrong = JSON.stringify({version: 1, role, fixtureId: fixture.id, ...fixtures.find(f => f.id !== fixture.id)!.expected});
      assert.equal(gradeRoleResponse(role, fixture.id, wrong).passed, false);
    }
  }
});

test("independent expectations reject plausible but unsupported operational claims", () => {
  const cases: [OfficeCurriculumRole, number, string, string][] = [
    ["code", 3, "revision_mismatch", "request_exact_revision_tests"],
    ["automations", 2, "shared_infrastructure", "request_connector_recovery"],
    ["portfolio", 2, "totals_mismatch", "request_balance_reconciliation"],
    ["news:ny-news", 2, "foreign_lane", "exclude_foreign_lane"],
    ["news:miami-news", 3, "stale_delivery", "request_recent_evidence"],
    ["clippers", 3, "upload_unknown", "reconcile_before_retry"],
    ["marketing-cmo", 3, "spend_paused", "preserve_spend_pause"],
  ];
  for (const [role,index,classification,decision] of cases) {
    const id = `${role}:evidence-v1:${index}`;
    assert.equal(gradeRoleResponse(role,id,answer(role,index,classification,decision)).passed,true);
    assert.equal(gradeRoleResponse(role,id,answer(role,index,classification,"publish_now")).passed,false);
  }
  assert.equal(gradeRoleResponse("automations", "automations:evidence-v1:2", answer("automations",2,"agent_fault","deduct_life")).passed,false);
});

test("model scores, explanations, duplicate or fabricated citations cannot qualify", () => {
  const role = "revenue", id = "revenue:evidence-v1:1";
  const good = JSON.parse(answer(role,1,"configuration_only","await_settlement_evidence"));
  for (const raw of ["```json\n{}\n```", "not json", JSON.stringify({...good,score:100}), JSON.stringify({...good,notes:"trust me"}),
    JSON.stringify({...good,evidenceIds:["revenue:source:1","revenue:source:1"]}), JSON.stringify({...good,evidenceIds:["made-up"]}),
    JSON.stringify({...good,role:"portfolio"}), JSON.stringify({...good,fixtureId:"revenue:evidence-v1:2"}), "x".repeat(8001)]) {
    assert.equal(gradeRoleResponse(role,id,raw).passed,false);
  }
});

test("mutable caller fixtures cannot change trusted expectations or next prompts", () => {
  const fixtures = roleFixtures("github");
  fixtures[0].expected.decision = "merge_now";
  fixtures[0].source.facts.merged = false;
  assert.equal(gradeRoleResponse("github",fixtures[0].id,answer("github",1,"merged_without_deployment","merge_now")).passed,false);
  assert.equal(JSON.parse(buildRolePrompt("github",fixtures[0].id)).source.facts.merged,true);
});

test("training feedback is bounded and cannot change grader expectations", () => {
  const id = "legal:evidence-v1:3";
  const prompt = buildRolePrompt("legal", id, ["Prior training error: do not equate access denial with a compliance violation."]);
  assert.match(prompt,/Prior training error/);
  assert.equal(gradeRoleResponse("legal",id,answer("legal",3,"access_blocked","request_authorized_evidence")).passed,true);
  assert.throws(()=>buildRolePrompt("legal",id,Array(5).fill("lesson")),/LESSONS_TOO_LARGE/);
  assert.throws(()=>buildRolePrompt("legal",id,["a".repeat(601)]),/LESSONS_TOO_LARGE/);
  assert.throws(()=>buildRolePrompt("legal","invented"),/UNKNOWN_CURRICULUM_FIXTURE/);
});
