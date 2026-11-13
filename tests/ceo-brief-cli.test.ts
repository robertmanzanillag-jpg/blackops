import assert from "node:assert/strict";
import test from "node:test";
import { parseSendCeoBriefArgs, validateSendCeoBriefOptions } from "../server/ceo-brief-cli";

test("parses send CEO brief CLI options", () => {
  assert.deepEqual(parseSendCeoBriefArgs([
    "--user-id=user-123",
    "--execute",
  ]), {
    userId: "user-123",
    execute: true,
  });
});

test("requires explicit user id and execute flag before sending CEO brief", () => {
  assert.deepEqual(validateSendCeoBriefOptions({
    userId: "",
    execute: false,
  }), [
    "--user-id must be a real value, not a placeholder.",
    "--execute is required to send a real Telegram CEO brief.",
  ]);

  assert.deepEqual(validateSendCeoBriefOptions({
    userId: "<real-user-id>",
    execute: true,
  }), [
    "--user-id must be a real value, not a placeholder.",
  ]);

  assert.deepEqual(validateSendCeoBriefOptions({
    userId: "user-123",
    execute: true,
  }), []);
});
