import assert from "node:assert/strict";
import test from "node:test";
import {
  getUniqueUserMigrationTargets,
  USER_MIGRATION_TARGETS,
  validateUserMigrationRequest,
} from "../server/user-migration-plan";

test("user migration plan includes core CEO Assistant owner tables", () => {
  const targetNames = new Set(USER_MIGRATION_TARGETS.map((target) => `${target.tableName}.${target.columnName}`));

  assert.equal(targetNames.has("tasks.user_id"), true);
  assert.equal(targetNames.has("telegram_config.user_id"), true);
  assert.equal(targetNames.has("user_profile_data.user_id"), true);
  assert.equal(targetNames.has("pending_actions.user_id"), true);
  assert.equal(targetNames.has("automation_definitions.owner_user_id"), true);
  assert.equal(targetNames.has("scheduled_reminders.user_id"), true);
});

test("user migration plan marks unique single-user config tables", () => {
  const uniqueNames = getUniqueUserMigrationTargets().map((target) => target.tableName);

  assert.deepEqual(
    uniqueNames.sort(),
    ["github_connections", "portfolio_config", "telegram_config"].sort(),
  );
});

test("validates user migration requests", () => {
  assert.deepEqual(validateUserMigrationRequest({ fromUserId: "", toUserId: "real-user" }), ["fromUserId is required"]);
  assert.deepEqual(validateUserMigrationRequest({ fromUserId: "mock-user-123", toUserId: "" }), ["toUserId is required"]);
  assert.deepEqual(validateUserMigrationRequest({ fromUserId: "same", toUserId: "same" }), ["fromUserId and toUserId must be different"]);
  assert.deepEqual(validateUserMigrationRequest({ fromUserId: "real-user", toUserId: " mock-user-123 " }), ["mock-user-123 cannot be the migration target"]);
  assert.deepEqual(validateUserMigrationRequest({ fromUserId: "<from-user-id>", toUserId: "real-user" }), ["fromUserId must be a real value, not a placeholder"]);
  assert.deepEqual(validateUserMigrationRequest({ fromUserId: "mock-user-123", toUserId: "<real-user-id>" }), ["toUserId must be a real value, not a placeholder"]);
  assert.deepEqual(validateUserMigrationRequest({ fromUserId: "mock-user-123", toUserId: "real-user" }), []);
});
