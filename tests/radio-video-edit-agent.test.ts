import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDjNameResolutionCommand } from "../server/radio-video-edit-agent";

const actionId = "00000000-0000-0000-0000-000000000000";

test("parses Telegram DJ name resolution commands", () => {
  assert.deepEqual(parseDjNameResolutionCommand(`nombre ${actionId} MYNA`), {
    actionId,
    djName: "MYNA",
  });
  assert.deepEqual(parseDjNameResolutionCommand(`dj ${actionId} DJ Robert Miami`), {
    actionId,
    djName: "DJ_ROBERT_MIAMI",
  });
});

test("ignores messages that are not DJ name resolution commands", () => {
  assert.equal(parseDjNameResolutionCommand(`aprobar ${actionId}`), null);
  assert.equal(parseDjNameResolutionCommand("nombre incompleto"), null);
});
