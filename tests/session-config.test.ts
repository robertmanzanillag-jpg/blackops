import assert from "node:assert/strict";
import test from "node:test";
import { resolveSessionRuntimeSettings } from "../server/session-config-core";

test("disables session auth in production without SESSION_SECRET", () => {
  const settings = resolveSessionRuntimeSettings({
    NODE_ENV: "production",
    SESSION_SECRET: undefined,
    DATABASE_URL: "postgres://ceo_user:real-pass@db.internal:5432/blackops",
  } as NodeJS.ProcessEnv);

  assert.equal(settings.enabled, false);
  assert.equal(settings.storeKind, "disabled");
});

test("uses Postgres session store by default in production when DATABASE_URL is configured", () => {
  const settings = resolveSessionRuntimeSettings({
    NODE_ENV: "production",
    SESSION_SECRET: "real-session-secret-with-enough-length",
    DATABASE_URL: "postgres://ceo_user:real-pass@db.internal:5432/blackops",
  } as NodeJS.ProcessEnv);

  assert.equal(settings.enabled, true);
  assert.equal(settings.storeKind, "postgres");
  assert.equal(settings.secureCookie, true);
});

test("honors an explicit Postgres session-store request", () => {
  const settings = resolveSessionRuntimeSettings({
    NODE_ENV: "production",
    SESSION_SECRET: "real-session-secret-with-enough-length",
    DATABASE_URL: "postgres://ceo_user:real-pass@db.internal:5432/blackops",
    SESSION_STORE_KIND: "postgres",
  } as NodeJS.ProcessEnv);

  assert.equal(settings.enabled, true);
  assert.equal(settings.storeKind, "postgres");
  assert.equal(settings.secureCookie, true);
});

test("allows an explicit production memory-store override for emergency diagnostics", () => {
  const settings = resolveSessionRuntimeSettings({
    NODE_ENV: "production",
    SESSION_SECRET: "real-session-secret-with-enough-length",
    DATABASE_URL: "postgres://ceo_user:real-pass@db.internal:5432/blackops",
    SESSION_STORE_KIND: "memory",
  } as NodeJS.ProcessEnv);

  assert.equal(settings.enabled, true);
  assert.equal(settings.storeKind, "memory");
  assert.equal(settings.secureCookie, true);
});

test("does not use Postgres session store for placeholder DATABASE_URL", () => {
  const settings = resolveSessionRuntimeSettings({
    NODE_ENV: "production",
    SESSION_SECRET: "real-session-secret-with-enough-length",
    DATABASE_URL: "replace-with-database-url",
  } as NodeJS.ProcessEnv);

  assert.equal(settings.enabled, true);
  assert.equal(settings.storeKind, "memory");
});

test("does not use Postgres session store for syntactic placeholder DATABASE_URL", () => {
  const settings = resolveSessionRuntimeSettings({
    NODE_ENV: "production",
    SESSION_SECRET: "real-session-secret-with-enough-length",
    DATABASE_URL: "postgres://user:password@host:5432/blackops",
  } as NodeJS.ProcessEnv);

  assert.equal(settings.enabled, true);
  assert.equal(settings.storeKind, "memory");
});

test("uses memory session store for local development without DATABASE_URL", () => {
  const settings = resolveSessionRuntimeSettings({
    NODE_ENV: "development",
    SESSION_SECRET: undefined,
    DATABASE_URL: undefined,
  } as NodeJS.ProcessEnv);

  assert.equal(settings.enabled, true);
  assert.equal(settings.storeKind, "memory");
  assert.equal(settings.secureCookie, false);
});
