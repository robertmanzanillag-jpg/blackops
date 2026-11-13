import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { registerKongOperationsRoutes } from "../server/kong-operations-routes";

test("KONG metrics route enforces owner and explicit normalized network before measurement", async t => {
  const app = express();
  app.use(express.json());
  let user: string | null = null;
  const measured: unknown[] = [];
  registerKongOperationsRoutes(app, {
    measure: async rows => { measured.push(rows); return [{ accepted: true }]; },
  } as Parameters<typeof registerKongOperationsRoutes>[1], {
    requestUserId: () => user,
    ownerUserId: () => "fixture-owner",
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const endpoint = `http://127.0.0.1:${address.port}/api/kong-ops/metrics`;
  const row = { network: "tiktok", postId: "post-123", observedAt: "2026-11-05T12:00:00Z", impressions: 10, reach: 9, videoViews: 8, engagements: 2, clicks: 0, shares: 1 };
  const post = (value: unknown) => fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rows: [value] }) });
  assert.equal((await post(row)).status, 401);
  user = "other-owner";
  assert.equal((await post(row)).status, 403);
  assert.equal(measured.length, 0);
  user = "fixture-owner";
  const { network: _network, ...missingNetwork } = row;
  assert.equal((await post(missingNetwork)).status, 400);
  for (const network of ["", "TikTok", "tt/evil", null, 42]) {
    assert.equal((await post({ ...row, network })).status, 400);
  }
  assert.equal(measured.length, 0);
  const response = await post(row);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { results: [{ accepted: true }] });
  assert.deepEqual(measured, [[row]]);
});
