import assert from "node:assert/strict";
import test from "node:test";
import { resolveDatabaseConnectionString } from "../server/database-url";

test("database connection string rejects placeholder DATABASE_URL values", () => {
  assert.equal(resolveDatabaseConnectionString({}), undefined);
  assert.throws(
    () => resolveDatabaseConnectionString({ NODE_ENV: "production" }),
    /DATABASE_URL is required in production/,
  );
  assert.equal(
    resolveDatabaseConnectionString({ DATABASE_URL: "postgres://ceo_user:real-pass@db.internal:5432/blackops" }),
    "postgres://ceo_user:real-pass@db.internal:5432/blackops",
  );
  assert.throws(
    () => resolveDatabaseConnectionString({ DATABASE_URL: "replace-with-production-postgres-url" }),
    /placeholder value/,
  );
  assert.throws(
    () => resolveDatabaseConnectionString({ DATABASE_URL: "postgres://user:password@host:5432/blackops" }),
    /placeholder value/,
  );
});
