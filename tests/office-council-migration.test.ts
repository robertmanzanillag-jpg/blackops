import test from "node:test";
import assert from "node:assert/strict";
import { importOfficeCouncilHistory } from "../server/office-council-migration";
const data = { version: 1, debates: [], proposals: [], scout: {}, company: { version: 1, careers: { reviewer: { life: 50 } }, trainees: [{ id: "candidate" }], orders: [{ context: "retain" }], extraFutureField: { keep: true } }, privateFutureField: [1, 2] };
function client(options: { revision?: number; exists?: boolean; identical?: boolean; data?: unknown } = {}) {
  const writes: unknown[][] = [];
  return { writes, release() {}, async query(sql: string, args: unknown[] = []) {
    if (sql.startsWith("SELECT data")) return { rows: [{ data: options.data ?? data, revision: options.revision ?? 43 }] };
    if (sql.startsWith("SELECT owner_key")) return { rows: options.exists ? [{ owner_key: "existing" }] : [] };
    if (sql.startsWith("INSERT INTO")) writes.push(args);
    if (sql.startsWith("SELECT state =")) return { rows: [{ identical: options.identical ?? true }] };
    return { rows: [] };
  } };
}
test("imports every history field verbatim, including unknown future fields", async () => {
  const db = client();
  const result = await importOfficeCouncilHistory(db, "owner", 43);
  assert.deepEqual(JSON.parse(db.writes[0][1] as string), data);
  assert.equal(result.careers, 1); assert.equal(result.trainees, 1); assert.equal(result.orders, 1);
  assert.equal(result.legacyHistoryRetained, true);
});
test("changed source and existing destination never write", async () => {
  for (const db of [client({ revision: 44 }), client({ exists: true })]) {
    await assert.rejects(importOfficeCouncilHistory(db, "owner", 43));
    assert.equal(db.writes.length, 0);
  }
});
test("readback mismatch fails so the caller must roll back its transaction", async () => {
  await assert.rejects(importOfficeCouncilHistory(client({ identical: false }), "owner", 43), /VERIFICATION_FAILED/);
});
test("incompatible council or private execution history cannot create a permanent destination", async () => {
  for (const invalid of [{ company: data.company }, { ...data, version: 2 }, { ...data, scout: [] },
    { ...data, company: { ...data.company, version: 2 } }, { ...data, company: { ...data.company, academyJobs: {} } },
    { ...data, officeExecution: {} }]) {
    const db = client({ data: invalid });
    await assert.rejects(importOfficeCouncilHistory(db, "owner", 43), /SOURCE_CHANGED/);
    assert.equal(db.writes.length, 0);
  }
});
