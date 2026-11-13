import assert from "node:assert/strict";
import test from "node:test";
import { readAuthState } from "../client/src/lib/auth-state";

test("auth errors, HTML previews and malformed JSON never authenticate", async () => {
  assert.deepEqual(await readAuthState(new Response("Unauthorized", { status: 401 })), { authenticated: false });
  for (const response of [new Response("<html>preview</html>"), new Response("error", { status: 500 }),
    new Response(JSON.stringify({ authenticated: true }), { headers: { "Content-Type": "application/json" } }),
    new Response("broken", { headers: { "Content-Type": "application/json" } })]) {
    await assert.rejects(readAuthState(response));
  }
});

test("only valid backend session evidence authenticates", async () => {
  const payload = { authenticated: true, sessionBacked: true, user: { id: "owner-a", username: "alice" } };
  assert.deepEqual(await readAuthState(new Response(JSON.stringify(payload), { headers: { "Content-Type": "application/json" } })), payload);
});
