import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Run after the production build. This checks packaging without opening a DB.
test("bundled PostgreSQL session store retains its required SQL resource", async () => {
  const [source, artifact] = await Promise.all([
    readFile("node_modules/connect-pg-simple/table.sql"),
    readFile("dist/table.sql"),
  ]);
  assert.deepEqual(artifact, source);
  assert.match(artifact.toString("utf8"), /CREATE TABLE/);
});
