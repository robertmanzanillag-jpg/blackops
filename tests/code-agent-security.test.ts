import assert from "node:assert/strict";
import test from "node:test";
import { addColumnToTable, createTable, executeQuery, listFiles, readFile, writeFile } from "../server/code-agent";
import { validateGeneratedFilePlan } from "../server/code-generator";

test("code agent only allows exact configured directories or real children", async () => {
  const deniedRead = await readFile("server_evil/not-really-server.ts");
  assert.equal(deniedRead.success, false);
  assert.match(deniedRead.error || "", /Acceso denegado/);

  const deniedList = await listFiles("server_evil");
  assert.equal(deniedList.success, false);
  assert.match(deniedList.error || "", /Acceso denegado/);

  const deniedTraversal = await readFile("server/../package.json");
  assert.equal(deniedTraversal.success, false);
  assert.match(deniedTraversal.error || "", /Acceso denegado/);

  const validRead = await readFile("server/code-agent.ts");
  assert.equal(validRead.success, true);
  assert.match(validRead.content || "", /ALLOWED_DIRS/);
});

test("code agent write guard rejects sibling-prefix paths before touching disk", async () => {
  const deniedWrite = await writeFile("shared_evil/schema.ts", "export const unsafe = true;");
  assert.equal(deniedWrite.success, false);
  assert.match(deniedWrite.error || "", /Acceso denegado/);
});

test("code agent SQL query guard rejects non-read-only statements before database execution", async () => {
  for (const query of [
    "UPDATE users SET name = 'x'",
    "SELECT * FROM users; DROP TABLE users",
    "SELECT * FROM users -- hide mutation",
    "SELECT * FROM users WHERE id IN (DELETE FROM sessions)",
  ]) {
    const result = await executeQuery(query);
    assert.equal(result.success, false, query);
  }
});

test("code agent schema helpers reject unsafe identifiers and defaults before database execution", async () => {
  const invalidTable = await addColumnToTable("users;drop", { name: "safe_name", type: "text" });
  assert.equal(invalidTable.success, false);
  assert.match(invalidTable.error || "", /Nombre de tabla inválido/);

  const invalidColumn = await addColumnToTable("users", { name: "bad-name", type: "text" });
  assert.equal(invalidColumn.success, false);
  assert.match(invalidColumn.error || "", /Nombre de columna inválido/);

  const unsafeDefault = await addColumnToTable("users", { name: "safe_name", type: "text", defaultValue: "now()); DROP TABLE users; --" });
  assert.equal(unsafeDefault.success, false);
  assert.match(unsafeDefault.error || "", /Default SQL no permitido/);

  const unsafeCreate = await createTable({
    name: "safe_table",
    columns: [{ name: "safe_name", type: "text", defaultValue: "'ok'; DROP TABLE users" }],
  });
  assert.equal(unsafeCreate.success, false);
  assert.match(unsafeCreate.error || "", /Default SQL no permitido/);
});

test("code generator rejects unsafe file plans before preview or apply", () => {
  const result = validateGeneratedFilePlan([
    { path: "server/safe-generated.ts", action: "create", content: "export const ok = true;" },
    { path: "server_evil/not-server.ts", action: "create", content: "export const bad = true;" },
    { path: "../outside.ts", action: "create", content: "export const bad = true;" },
    { path: "client/src/no-content.tsx", action: "create" },
    { path: "shared/schema.ts", action: "delete", content: "" },
  ]);

  assert.deepEqual(result.files.map((file) => file.path), ["server/safe-generated.ts"]);
  assert.equal(result.rejectedFiles.length, 4);
  assert.ok(result.rejectedFiles.some((file) => file.path === "server_evil/not-server.ts"));
  assert.ok(result.rejectedFiles.some((file) => file.path === "../outside.ts"));
  assert.ok(result.rejectedFiles.some((file) => file.reason.includes("content")));
  assert.ok(result.rejectedFiles.some((file) => file.reason.includes("action")));
});
