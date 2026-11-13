import assert from "node:assert/strict";
import test from "node:test";
import { formatCeoReadinessText, parseCeoReadinessArgs, validateCeoReadinessOptions } from "../server/ceo-readiness-cli";

test("parses CEO readiness CLI options", () => {
  assert.deepEqual(parseCeoReadinessArgs([]), { userId: "", json: false });
  assert.deepEqual(parseCeoReadinessArgs(["--user-id=user-123", "--json"]), { userId: "user-123", json: true });
});

test("validates CEO readiness CLI user id placeholders", () => {
  assert.deepEqual(validateCeoReadinessOptions(parseCeoReadinessArgs([])), []);
  assert.deepEqual(validateCeoReadinessOptions(parseCeoReadinessArgs(["--user-id=user-123"])), []);
  assert.deepEqual(validateCeoReadinessOptions(parseCeoReadinessArgs(["--user-id=<real-user-id>"])), [
    "--user-id must be a real value, not a placeholder.",
  ]);
});

test("formats CEO readiness text output", () => {
  const output = formatCeoReadinessText({
    ready: false,
    status: "warning",
    checks: [
      { id: "auth", label: "Auth", status: "ready", detail: "Resolved user context." },
      { id: "telegram", label: "Telegram", status: "warning", detail: "Webhook missing secret." },
    ],
  });

  assert.match(output, /CEO Assistant status: warning/);
  assert.match(output, /Ready: no/);
  assert.match(output, /\[ready\] Auth/);
  assert.match(output, /\[warning\] Telegram/);
});
