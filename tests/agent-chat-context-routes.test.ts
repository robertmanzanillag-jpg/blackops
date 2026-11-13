import test from "node:test";
import assert from "node:assert/strict";
import { scoreAgents } from "../shared/agent-chat-routing";

test("context-gated Black Room routes only fire when the chat names Black Room", () => {
  const generic = scoreAgents("necesito un reporte de ventas", ["blackroom-analytics", "control", "revenue"]);
  assert.ok(!JSON.stringify(generic).includes("blackroom-analytics"));
  const scoped = scoreAgents("necesito un reporte de black room", ["blackroom-analytics", "control", "revenue"]);
  assert.ok(JSON.stringify(scoped).includes("blackroom-analytics"));
});
