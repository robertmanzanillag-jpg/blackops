import assert from "node:assert/strict";
import test from "node:test";
import { shouldStartResourceIntensiveSchedulers } from "../server/background-scheduler-policy";

test("resource-intensive schedulers stay off by default on a production Replit deployment", () => {
  assert.equal(shouldStartResourceIntensiveSchedulers({
    NODE_ENV: "production",
    REPLIT_DEPLOYMENT: "1",
  } as NodeJS.ProcessEnv), false);
});

test("an explicit override can enable resource-intensive schedulers on Replit", () => {
  assert.equal(shouldStartResourceIntensiveSchedulers({
    NODE_ENV: "production",
    REPLIT_DEPLOYMENT: "1",
    RESOURCE_INTENSIVE_SCHEDULERS_ENABLED: "true",
  } as NodeJS.ProcessEnv), true);
});

test("non-Replit runtimes keep the existing scheduler behavior", () => {
  assert.equal(shouldStartResourceIntensiveSchedulers({ NODE_ENV: "production" } as NodeJS.ProcessEnv), true);
  assert.equal(shouldStartResourceIntensiveSchedulers({ NODE_ENV: "development" } as NodeJS.ProcessEnv), true);
});

test("an explicit false override disables the schedulers everywhere", () => {
  assert.equal(shouldStartResourceIntensiveSchedulers({
    NODE_ENV: "development",
    RESOURCE_INTENSIVE_SCHEDULERS_ENABLED: "false",
  } as NodeJS.ProcessEnv), false);
});
