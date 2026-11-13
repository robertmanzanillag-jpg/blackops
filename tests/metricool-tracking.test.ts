import assert from "node:assert/strict";
import test from "node:test";
import { getMetricoolConfigStatus, getMetricoolTrackingPlan } from "../server/metricool-tracking";

test("builds the Metricool brand and profile plan for current businesses", () => {
  const plan = getMetricoolTrackingPlan();

  assert.equal(plan.brandCount, 10);
  assert.equal(plan.socialProfileCount, 27);
  assert.equal(plan.recommendedPlan, "starter_10_brands");
  assert.equal(plan.directPlatformApisNeeded, false);
  assert.equal(plan.networks.tiktok, 7);
  assert.equal(plan.networks.instagram, 8);
  assert.equal(plan.networks.youtube, 6);
  assert.equal(plan.networks.pinterest, 2);
  assert.equal(plan.networks.facebook, 2);
  assert.equal(plan.networks.twitter, 2);

  const miamiNews = plan.brands.find((brand) => brand.id === "winner-account-1");
  const nyNews = plan.brands.find((brand) => brand.id === "winner-account-2");
  assert.deepEqual(
    [miamiNews?.name, miamiNews?.ownerAgent, miamiNews?.status, miamiNews?.networks],
    ["Miami News", "Clippers", "ready_to_connect", ["facebook", "twitter"]],
  );
  assert.deepEqual(
    [nyNews?.name, nyNews?.ownerAgent, nyNews?.status, nyNews?.networks],
    ["NY News", "Clippers", "ready_to_connect", ["facebook", "twitter"]],
  );
});

test("reports Metricool MCP credential readiness without exposing secrets", () => {
  const missing = getMetricoolConfigStatus({});
  assert.equal(missing.readyForMcp, false);
  assert.deepEqual(missing.missingEnv, ["METRICOOL_USER_TOKEN", "METRICOOL_USER_ID"]);

  const ready = getMetricoolConfigStatus({
    METRICOOL_USER_TOKEN: "token_live",
    METRICOOL_USER_ID: "12345",
  } as NodeJS.ProcessEnv);
  assert.equal(ready.readyForMcp, true);
  assert.deepEqual(ready.missingEnv, []);
});
