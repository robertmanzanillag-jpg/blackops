import assert from "node:assert/strict";
import test from "node:test";
import { createRoleWorkRunner } from "../server/office-role-work";
import { PENDING_OFFICE_ROLES, sourceDigest, type SqlAuditRole } from "../server/office-role-snapshots";
import { WEB_SOURCE_ROLES } from "../server/office-web-role-sources";
import {
  countByStatus, parseOwner, shapeCapabilityTraining, shapeCouncil, shapeReviewerAcademy, shapeRoleWork, shapeTokens,
  shapeWebSources, shapeWorkers, webSourceOwnerKey,
} from "../script/office-status-shape";

const NOW = Date.parse("2026-11-12T10:00:00Z"), owner = "private-owner-id-123";

/** A real, validly-proved journal produced by the production runner against an in-memory council. */
async function realJournal(now = NOW) {
  let state: any = { roles: { version: 1, roles: Object.fromEntries(PENDING_OFFICE_ROLES.map(role => [role, { generation: 1 }])) } };
  const company: any = { careers: Object.fromEntries(PENDING_OFFICE_ROLES.map(role => [role, { generation: 1 }])) };
  const council: any = { async updateOfficeExecution(change: any) { state = change(structuredClone(state), company); return structuredClone(state); } };
  const runner = createRoleWorkRunner({ owner, council, now: () => now, read: async (_role: SqlAuditRole) => { throw new Error("secret host db.internal unavailable"); }, readWeb: async () => null });
  await runner.tick();
  return state.roleWork;
}

test("owner is required and bounded", () => {
  assert.throws(() => parseOwner({}), /^Error: DEFAULT_USER_ID_REQUIRED$/);
  assert.throws(() => parseOwner({ DEFAULT_USER_ID: "  " }), /DEFAULT_USER_ID_REQUIRED/);
  assert.throws(() => parseOwner({ DEFAULT_USER_ID: "x".repeat(501) }), /OWNER_INVALID/);
  assert.equal(parseOwner({ DEFAULT_USER_ID: " u1 " }), "u1");
});

test("status counts fold unknown values into other", () => {
  assert.deepEqual(countByStatus(["a", "b", "a", "free text with secrets", 3, undefined], ["a", "b"]), { a: 2, b: 1, other: 3 });
});

test("role work: today's status, reason and diagnostic codes only, for all 14 roles", async () => {
  const raw = await realJournal();
  const shaped = shapeRoleWork(raw, owner, NOW);
  assert.equal(shaped.valid, true);
  assert.equal(shaped.today, "2026-11-12");
  assert.deepEqual(Object.keys(shaped.roles), [...PENDING_OFFICE_ROLES]);
  assert.deepEqual(shaped.roles.control, { today: true, status: "blocked", reason: "source_unavailable", diagnostics: ["SOURCE_UNAVAILABLE"] });
  assert.deepEqual(shaped.roles.news, { today: true, status: "blocked", reason: "web_export_missing", diagnostics: ["EXPORT_MISSING"] });
  assert.deepEqual(shaped.roles.code, { today: true, status: "blocked", reason: null, diagnostics: ["CAPABILITY_UNAVAILABLE"] });
  const text = JSON.stringify(shaped);
  for (const leak of [owner, "secret", "db.internal", "Requiere", raw.jobs[0].id, raw.jobs[0].artifactId]) assert.ok(!text.includes(leak), leak);
});

test("role work: yesterday's journal reports none today with last slot; tampering marks invalid", async () => {
  const raw = await realJournal(NOW - 86400000);
  const shaped = shapeRoleWork(raw, owner, NOW);
  assert.deepEqual(shaped.roles.legal, { today: false, status: "none", lastSlot: "2026-11-11" });
  const tampered = structuredClone(raw);
  tampered.jobs[0].status = "completed";
  tampered.jobs[0].reason = "free text reason";
  assert.equal(shapeRoleWork(tampered, owner, NOW - 86400000).valid, false);
  assert.equal(shapeRoleWork(tampered, owner, NOW - 86400000).roles[tampered.jobs[0].role as "code"].reason, "other");
  assert.equal(shapeRoleWork(raw, "someone-else", NOW).valid, false);
  assert.deepEqual(shapeRoleWork(undefined, owner, NOW).roles.code, { today: false, status: "none", lastSlot: null });
});

test("capability training: counts runs today/total and policies by status", () => {
  const runs = [
    { status: "completed", startedAt: "2026-11-12T01:00:00.000Z" }, { status: "running", startedAt: "2026-11-12T09:00:00.000Z" },
    { status: "completed", startedAt: "2026-11-10T01:00:00.000Z" }, { status: "cancelled", startedAt: "2026-11-01T01:00:00.000Z" },
  ];
  const shaped = shapeCapabilityTraining({ version: 1, ownerKey: sourceDigest(owner), runs, policies: [{ status: "active" }, { status: "candidate" }, { status: "rejected" }, { status: "rejected" }] }, owner, NOW);
  assert.equal(shaped.valid, false); // fixture rows are not proved
  assert.deepEqual(shaped.runsToday, { completed: 1, running: 1 });
  assert.deepEqual(shaped.runsTotal, { completed: 2, running: 1, cancelled: 1 });
  assert.deepEqual(shaped.policies, { active: 1, candidate: 1, rejected: 2 });
  assert.deepEqual(shapeCapabilityTraining(undefined, owner, NOW), { present: false, valid: true, runsToday: {}, runsTotal: {}, policies: {} });
});

test("academy, tokens, workers and web sources expose no ids or free text", () => {
  assert.deepEqual(shapeReviewerAcademy({ trainees: [{ id: "t1" }, { id: "t2" }], academyJobs: [{ id: "j", status: "completed" }, { status: "unknown" }, { status: "hack" }] }),
    { academyJobs: { completed: 1, unknown: 1, other: 1 }, trainees: 2 });
  assert.deepEqual(shapeReviewerAcademy(undefined), { academyJobs: {}, trainees: 0 });
  assert.deepEqual(shapeTokens({ reservations: [{ month: "2026-11", status: "reserved", model: "m" }, { month: "2026-11", status: "accounted" }, { month: "2026-10", status: "accounted" }] }, NOW),
    { month: "2026-11", reservations: { reserved: 1, accounted: 1 } });
  assert.deepEqual(shapeWorkers([{ cloud: true, last_seen_at: new Date(NOW) }, { cloud: false, last_seen_at: "garbage" }]),
    [{ kind: "cloud", lastSeenAt: "2026-11-12T10:00:00.000Z" }, { kind: "other", lastSeenAt: null }]);
  const web = shapeWebSources([{ role: "news", observed_at: new Date(NOW - 90_000), provenance: [{ kind: "news_state", status: "present", digest: "d".repeat(64) }, { kind: "x", status: "y" }] }, { role: "not-a-role", observed_at: null, provenance: null }], NOW);
  assert.deepEqual(Object.keys(web), [...WEB_SOURCE_ROLES]);
  assert.deepEqual(web.news, { stored: true, ageSeconds: 90, provenance: [{ kind: "news_state", status: "present" }, { kind: "other", status: "other" }] });
  assert.deepEqual(web.clippers, { stored: false });
  assert.equal(webSourceOwnerKey(owner), sourceDigest(owner));
});

test("council shaping handles missing rows and missing officeExecution", async () => {
  assert.deepEqual(shapeCouncil(null, owner, NOW), { councilStateFound: false });
  const bare = shapeCouncil(JSON.stringify({ company: { trainees: [] } }), owner, NOW);
  assert.equal(bare.councilStateFound, true);
  assert.equal(bare.officeExecutionPresent, false);
  const full = shapeCouncil(JSON.stringify({ company: { trainees: [{}], academyJobs: [] }, officeExecution: { roleWork: await realJournal(), tokens: { reservations: [] } } }), owner, NOW);
  assert.equal(full.officeExecutionPresent && full.roleWork?.valid, true);
  assert.ok(!JSON.stringify(full).includes(owner));
});
