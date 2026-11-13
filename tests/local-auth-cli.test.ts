import assert from "node:assert/strict";
import test from "node:test";
import { parseCreateLocalUserArgs, resolveCreateLocalUserOptions, validateCreateLocalUserOptions } from "../server/local-auth-cli";

test("parses create local user CLI options", () => {
  const options = parseCreateLocalUserArgs([
    "--username= Robert@Example.COM ",
    "--password=correct horse",
    "--print-user-id",
  ]);

  assert.deepEqual(options, {
    username: "robert@example.com",
    password: "correct horse",
    passwordEnv: "",
    printUserId: true,
  });
});

test("resolves create local user password from an env var", () => {
  const options = resolveCreateLocalUserOptions(
    parseCreateLocalUserArgs(["--username=robert", "--password-env=LOCAL_AUTH_PASSWORD"]),
    { LOCAL_AUTH_PASSWORD: "env-password" },
  );

  assert.deepEqual(options, {
    username: "robert",
    password: "env-password",
    passwordEnv: "LOCAL_AUTH_PASSWORD",
    printUserId: false,
  });
});

test("validates create local user CLI options", () => {
  assert.deepEqual(validateCreateLocalUserOptions({
    username: "",
    password: "short",
    passwordEnv: "",
    printUserId: false,
  }), [
    "--username is required and must be at least 2 characters.",
    "--password or --password-env is required and must resolve to at least 8 characters.",
  ]);

  assert.deepEqual(validateCreateLocalUserOptions({
    username: "robert",
    password: "long-enough",
    passwordEnv: "",
    printUserId: false,
  }), []);

  assert.deepEqual(validateCreateLocalUserOptions({
    username: "robert",
    password: "replace-with-password",
    passwordEnv: "",
    printUserId: false,
  }), [
    "--password or --password-env must be a real value, not a placeholder.",
  ]);
});
