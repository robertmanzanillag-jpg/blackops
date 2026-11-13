import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { assertOfficeProtocolReady, officeWebProtocol } from "../server/office-protocol";
const owner = "test-owner";
const sha = "a".repeat(40);
const key = createHash("sha256").update(owner).digest("hex");
const row = { protocol_version: 2, web_revision: sha, storage_mode: "postgres", old_instances_drained: true,
  verified_at: new Date("2026-11-06T10:00:00Z"), database_now: new Date("2026-11-06T11:00:00Z"), council_owner: key };

test("worker requires a matching verified rollout and migrated owner state; sleeping web is not a failure", async () => {
  await assertOfficeProtocolReady({ query: async (_sql, args) => { assert.deepEqual(args, [key]); return { rows: [row] }; } }, owner, sha);
});
test("missing, incompatible, undrained, mismatched and unimported rollouts fail closed", async () => {
  for (const rows of [[], [row, row], [{ ...row, protocol_version: 1 }], [{ ...row, web_revision: "b".repeat(40) }],
    [{ ...row, storage_mode: "legacy" }], [{ ...row, old_instances_drained: false }], [{ ...row, council_owner: null }],
    [{ ...row, verified_at: "invalid" }], [{ ...row, verified_at: "2027-01-01" }]]) {
    await assert.rejects(assertOfficeProtocolReady({ query: async () => ({ rows }) }, owner, sha), /ROLLOUT_NOT_VERIFIED/);
  }
});
test("invalid owner/revision cannot query and database details cannot leak", async () => {
  let queried = false;
  const pool = { query: async () => { queried = true; throw new Error("postgres://private-secret"); } };
  await assert.rejects(assertOfficeProtocolReady(pool, "", sha), /CONFIGURATION_REQUIRED/);
  await assert.rejects(assertOfficeProtocolReady(pool, owner, "wrong"), /CONFIGURATION_REQUIRED/);
  assert.equal(queried, false);
  await assert.rejects(assertOfficeProtocolReady(pool, owner, sha), error => String(error) === "Error: OFFICE_PROTOCOL_UNAVAILABLE");
});
test("web capability reports actual configured storage and omits invalid revision", () => {
  assert.deepEqual(officeWebProtocol({}), { version: 2, revision: null, councilStorage: "legacy" });
  assert.deepEqual(officeWebProtocol({ AGENT_COUNCIL_STORAGE: "postgres", OFFICE_WEB_REVISION: sha }), { version: 2, revision: sha, councilStorage: "postgres" });
});
