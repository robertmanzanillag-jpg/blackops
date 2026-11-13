import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword, isLocalAuthEnabled, isLocalAuthRegistrationAllowed, normalizeUsername, verifyPassword } from "../server/local-auth-core";

function withEnv<T>(env: Record<string, string | undefined>, fn: () => T | Promise<T>): T | Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const key of Object.keys(env)) {
    previous.set(key, process.env[key]);
    if (env[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = env[key];
    }
  }

  const restore = () => {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };

  try {
    const result = fn();
    if (result && typeof (result as Promise<T>).then === "function") {
      return (result as Promise<T>).finally(restore);
    }
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

test("normalizes usernames for local auth", () => {
  assert.equal(normalizeUsername("  Robert@Example.COM  "), "robert@example.com");
});

test("hashes and verifies local auth passwords", async () => {
  const stored = await hashPassword("correct horse battery staple");

  assert.match(stored, /^scrypt\$/);
  assert.equal(await verifyPassword("correct horse battery staple", stored), true);
  assert.equal(await verifyPassword("wrong password", stored), false);
  assert.equal(await verifyPassword("correct horse battery staple", "plain-text"), false);
});

test("local auth defaults to dev/test and session-backed production", () => {
  assert.equal(withEnv({ NODE_ENV: "development", LOCAL_AUTH_ENABLED: undefined, SESSION_SECRET: undefined }, () => isLocalAuthEnabled()), true);
  assert.equal(withEnv({ NODE_ENV: "production", LOCAL_AUTH_ENABLED: undefined, SESSION_SECRET: undefined }, () => isLocalAuthEnabled()), false);
  assert.equal(withEnv({ NODE_ENV: "production", LOCAL_AUTH_ENABLED: undefined, SESSION_SECRET: "production-session-secret" }, () => isLocalAuthEnabled()), true);
  assert.equal(withEnv({ NODE_ENV: "production", LOCAL_AUTH_ENABLED: "true" }, () => isLocalAuthEnabled()), true);
  assert.equal(withEnv({ NODE_ENV: "production", LOCAL_AUTH_ENABLED: "false", SESSION_SECRET: "production-session-secret" }, () => isLocalAuthEnabled()), false);
});

test("local registration defaults to dev/test and requires opt-in for production", () => {
  assert.equal(withEnv({ NODE_ENV: "test", ALLOW_LOCAL_AUTH_REGISTRATION: undefined }, () => isLocalAuthRegistrationAllowed()), true);
  assert.equal(withEnv({ NODE_ENV: "production", ALLOW_LOCAL_AUTH_REGISTRATION: undefined }, () => isLocalAuthRegistrationAllowed()), false);
  assert.equal(withEnv({ NODE_ENV: "production", ALLOW_LOCAL_AUTH_REGISTRATION: "true" }, () => isLocalAuthRegistrationAllowed()), true);
});
