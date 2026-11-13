import assert from "node:assert/strict";
import test from "node:test";
import { ownerOfficeStorageKey } from "../client/src/lib/owner-office-storage";

test("office drafts, simulation and layouts are isolated by authenticated owner", () => {
  for (const key of ["blackops.company-simulation.v1", "agentsOffice.roomLayout.v1", "office.githubAgentHandoff"]) {
    assert.notEqual(ownerOfficeStorageKey(key, "owner/a"), ownerOfficeStorageKey(key, "owner%2Fa"));
    assert.notEqual(ownerOfficeStorageKey(key, "owner-a"), ownerOfficeStorageKey(key, "owner-b"));
    assert.notEqual(ownerOfficeStorageKey(key, "owner-a"), key);
  }
  assert.throws(() => ownerOfficeStorageKey("simulation", ""), /authenticated owner/);
  assert.throws(() => ownerOfficeStorageKey("simulation", " "), /authenticated owner/);
});
