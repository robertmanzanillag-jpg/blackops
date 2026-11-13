import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { loadLocalEnvFiles, parseEnvLine } from "../server/env-loader-core";

test("parseEnvLine supports export, quotes, and inline comments outside quotes", () => {
  assert.deepEqual(parseEnvLine("export ENV_LOADER_TEST_EXPORT='quoted value'"), {
    key: "ENV_LOADER_TEST_EXPORT",
    value: "quoted value",
  });
  assert.deepEqual(parseEnvLine("ENV_LOADER_TEST_COMMENT=value # trailing comment"), {
    key: "ENV_LOADER_TEST_COMMENT",
    value: "value",
  });
  assert.deepEqual(parseEnvLine("ENV_LOADER_TEST_HASH=\"value # inside quote\""), {
    key: "ENV_LOADER_TEST_HASH",
    value: "value # inside quote",
  });
});

test("parseEnvLine rejects comments, malformed keys, and lowercase keys", () => {
  assert.equal(parseEnvLine("# ENV_LOADER_TEST_ALPHA=value"), null);
  assert.equal(parseEnvLine("ENV LOADER TEST=value"), null);
  assert.equal(parseEnvLine("1_ENV_LOADER_TEST=value"), null);
  assert.equal(parseEnvLine("env_loader_test=value"), null);
  assert.equal(parseEnvLine("ENV_LOADER_TEST_NO_SEPARATOR"), null);
});

test("loadLocalEnvFiles loads known local env files without overriding existing values", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "env-loader-"));
  const env: NodeJS.ProcessEnv = {
    ENV_LOADER_TEST_EXISTING: "runtime",
    ENV_LOADER_TEST_EMPTY_RUNTIME: "",
  };

  try {
    writeFileSync(
      path.join(cwd, ".env"),
      [
        "ENV_LOADER_TEST_ALPHA=from-env",
        "ENV_LOADER_TEST_EXISTING=from-file",
        "ENV_LOADER_TEST_EMPTY_FILE=",
        "env_loader_test_lowercase=ignored",
      ].join("\n"),
    );
    writeFileSync(
      path.join(cwd, ".env.local"),
      [
        "ENV_LOADER_TEST_ALPHA=from-local",
        "ENV_LOADER_TEST_BETA='local beta'",
        "ENV_LOADER_TEST_EMPTY_FILE=from-local-after-empty",
        "ENV_LOADER_TEST_EMPTY_RUNTIME=from-local-after-runtime-empty",
      ].join("\n"),
    );
    writeFileSync(path.join(cwd, "CEO_ASSISTANT_ENV"), "ENV_LOADER_TEST_GAMMA=from-ceo-file\n");

    assert.deepEqual(loadLocalEnvFiles(cwd, env), [".env", ".env.local", "CEO_ASSISTANT_ENV"]);
    assert.equal(env.ENV_LOADER_TEST_ALPHA, "from-env");
    assert.equal(env.ENV_LOADER_TEST_EXISTING, "runtime");
    assert.equal(env.ENV_LOADER_TEST_BETA, "local beta");
    assert.equal(env.ENV_LOADER_TEST_GAMMA, "from-ceo-file");
    assert.equal(env.ENV_LOADER_TEST_EMPTY_FILE, "from-local-after-empty");
    assert.equal(env.ENV_LOADER_TEST_EMPTY_RUNTIME, "from-local-after-runtime-empty");
    assert.equal(env.env_loader_test_lowercase, undefined);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
