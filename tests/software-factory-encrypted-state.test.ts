import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createEncryptedFactoryTransport } from "../server/software-factory-encrypted-state";
import type { FactoryObjectTransport } from "../server/software-factory-object-store";

function fixture() {
  let value: { generation: string; body: string } | undefined;
  let version = 0;
  const transport: FactoryObjectTransport = {
    read: async () => value && { ...value },
    compareAndSwap: async (expected, body) => {
      if (expected !== (value?.generation ?? null)) return { kind: "conflict" };
      value = { generation: String(++version), body };
      return { kind: "written", generation: value.generation };
    },
  };
  const key = randomBytes(32), scope = "dedicated-factory/ledger";
  return { transport, key, scope, wrapped: createEncryptedFactoryTransport({transport,key,scope}),
    replace: (body: string) => { value = { generation: "damaged", body }; } };
}
test("state survives a worker restart without exposing plaintext or losing CAS", async () => {
  const f = fixture();
  assert.equal(await f.wrapped.read(), undefined);
  assert.deepEqual(await f.wrapped.compareAndSwap(null, '{"reservedCents":100,"private":"customer"}'), {kind:"written",generation:"1"});
  const raw = (await f.transport.read())!;
  assert.ok(!raw.body.includes("customer"));
  const next = createEncryptedFactoryTransport(f);
  assert.deepEqual(await next.read(), {generation:"1",body:'{"reservedCents":100,"private":"customer"}'});
  assert.deepEqual(await next.compareAndSwap(null, "overwrite"), {kind:"conflict"});
  assert.deepEqual(await next.compareAndSwap("1", "new"), {kind:"written",generation:"2"});
  assert.deepEqual(await f.wrapped.compareAndSwap("1", "stale"), {kind:"conflict"});
});
test("wrong key, wrong scope and tampering block instead of resetting budget", async () => {
  const f = fixture(); await f.wrapped.compareAndSwap(null, "ledger");
  await assert.rejects(createEncryptedFactoryTransport({...f,key:randomBytes(32)}).read(), /AUTHENTICATION_FAILED/);
  await assert.rejects(createEncryptedFactoryTransport({...f,scope:"other"}).read(), /AUTHENTICATION_FAILED/);
  const e = JSON.parse((await f.transport.read())!.body); e.ciphertext = Buffer.from("changed").toString("base64");
  f.replace(JSON.stringify(e)); await assert.rejects(f.wrapped.read(), /AUTHENTICATION_FAILED/);
  f.replace('{"reservedCents":0}'); await assert.rejects(f.wrapped.read(), /AUTHENTICATION_FAILED/);
});
test("plaintext is preserved exactly, including a leading BOM and Unicode", async () => {
  const f = fixture(), body = "\uFEFFestado: recuperación 🎉";
  await f.wrapped.compareAndSwap(null,body);
  assert.equal((await f.wrapped.read())!.body,body);
  await assert.rejects(f.wrapped.compareAndSwap("1","\uD800"), /INVALID_TEXT/);
});
test("size limits and unknown writes never trigger an automatic second write", async () => {
  const f = fixture(); let writes = 0;
  const wrapped = createEncryptedFactoryTransport({...f,maxPlaintextBytes:5,transport:{...f.transport,compareAndSwap:async()=>{writes++;throw Error("ambiguous write");}}});
  await assert.rejects(wrapped.compareAndSwap(null,"123456"), /TOO_LARGE/);
  assert.equal(writes,0);
  await assert.rejects(wrapped.compareAndSwap(null,"12345"), /ambiguous write/);
  assert.equal(writes,1);
});
