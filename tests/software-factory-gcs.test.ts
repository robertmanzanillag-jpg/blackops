import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createGcsFactoryTransport } from "../server/software-factory-gcs";
const body = '{"version":1}';
const metadata = { generation: "123", size: String(Buffer.byteLength(body)), md5Hash: createHash("md5").update(body).digest("base64") };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const options = { bucket: "factory-test-bucket", object: "factory/test/ledger.json", maxBytes: 1024 };

test("read pins bytes to exact generation and validates size/checksum", async () => {
  const urls: string[] = [];
  const transport = createGcsFactoryTransport({ ...options, request: async (url, init) => {
    urls.push(url); assert.equal(init.redirect, "error"); assert.ok(init.signal);
    return urls.length === 1 ? json(metadata) : new Response(body);
  } });
  assert.deepEqual(await transport.read(), { generation: "123", body });
  assert.match(urls[1], /alt=media&generation=123$/);
});

test("only metadata404 means missing; concurrent generation404 cannot reset", async () => {
  assert.equal(await createGcsFactoryTransport({ ...options, request: async () => new Response(null, { status: 404 }) }).read(), undefined);
  let calls = 0;
  await assert.rejects(createGcsFactoryTransport({ ...options, request: async () => ++calls === 1 ? json(metadata) : new Response(null, { status: 404 }) }).read(), /VERSION_UNCONFIRMED/);
  await assert.rejects(createGcsFactoryTransport({ ...options, request: async () => new Response(null, { status: 403 }) }).read(), /READ_UNAVAILABLE/);
});

test("wrong bytes and oversized metadata fail closed without unbounded reads", async () => {
  let calls = 0;
  await assert.rejects(createGcsFactoryTransport({ ...options, request: async () => ++calls === 1 ? json(metadata) : new Response('{"version":2}') }).read(), /VERSION_UNCONFIRMED/);
  calls = 0;
  await assert.rejects(createGcsFactoryTransport({ ...options, request: async () => { calls++; return json({ ...metadata, size: "999999" }); } }).read(), /METADATA_INVALID/);
  assert.equal(calls, 1);
});

test("create and replacement always require a generation;412 is the only conflict", async () => {
  const urls: string[] = [];
  const transport = createGcsFactoryTransport({ ...options, request: async (url) => { urls.push(url); return json({ generation: "124" }); } });
  assert.deepEqual(await transport.compareAndSwap(null, body), { kind: "written", generation: "124" });
  await transport.compareAndSwap("123", body);
  assert.match(urls[0], /ifGenerationMatch=0$/); assert.match(urls[1], /ifGenerationMatch=123$/);
  assert.deepEqual(await createGcsFactoryTransport({ ...options, request: async () => new Response(null, { status: 412 }) }).compareAndSwap("123", body), { kind: "conflict" });
  await assert.rejects(createGcsFactoryTransport({ ...options, request: async () => new Response(null, { status: 500 }) }).compareAndSwap("123", body), /WRITE_UNCONFIRMED/);
});

test("lost write acknowledgments are unknown and never automatically replayed", async () => {
  let calls = 0;
  const transport = createGcsFactoryTransport({ ...options, request: async () => { calls++; throw new Error("private provider detail"); } });
  await assert.rejects(transport.compareAndSwap("123", body), error => error instanceof Error && error.message === "FACTORY_STORAGE_REQUEST_UNCONFIRMED");
  assert.equal(calls, 1);
});

test("configuration and oversized writes reject before request", async () => {
  const request = async () => { throw new Error("must not request"); };
  assert.throws(() => createGcsFactoryTransport({ ...options, object: "public/file.json", request }));
  await assert.rejects(createGcsFactoryTransport({ ...options, request }).compareAndSwap(null, "x".repeat(1025)), /WRITE_INVALID/);
});
