import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createGitHubFactoryStateTransport } from "../server/software-factory-github-state";
const repository = "fixture/software-factory-pilot";
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {status});
function fixture(object: "ledger" | "transport-probe" = "ledger") {
  const path = `.factory/${object}.enc.json`;
  let current: { sha: string; body: Buffer } | undefined;
  let failWrite = false, corruptRead = false;
  const calls: {url:string;method:string;body?:any}[] = [];
  const request = async (url: string, init: RequestInit) => {
    const method = init.method ?? "GET", body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({url,method,body});
    assert.equal(init.redirect,"error");
    if (url.endsWith(repository)) return json({full_name:repository,private:false,default_branch:"main",archived:false,disabled:false});
    if (method === "PUT") {
      assert.equal(body.branch,"factory-state");
      if (failWrite) throw Error("private transport detail");
      if (body.sha !== current?.sha) return json({},409);
      const bytes=Buffer.from(body.content,"base64"), sha=createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
      current={sha,body:bytes};return json({content:{sha,path}},201);
    }
    if (url.includes("/contents/")) {
      assert.equal(new Headers(init.headers).get("Accept"),"application/vnd.github.object+json");
      return current ? json({type:"file",path,sha:current.sha,size:current.body.length}) : json({},404);
    }
    assert.ok(current && url.endsWith(current.sha));
    return json({sha:current.sha,size:current.body.length,encoding:"base64",content:corruptRead?"dGFtcGVyZWQ=":current.body.toString("base64")});
  };
  return {request,calls, key:randomBytes(32),repository,object, fail:()=>{failWrite=true;}, corrupt:()=>{corruptRead=true;}};
}
test("encrypted GitHub state preserves opaque numeric generations and rejects stale writes",async()=>{
  const f=fixture(), t=createGitHubFactoryStateTransport(f);
  assert.equal(await t.read(),undefined);
  const first=await t.compareAndSwap(null,'{"reservedCents":100}'); assert.equal(first.kind,"written");
  if(first.kind!=="written")throw Error(); assert.match(first.generation,/^[1-9][0-9]*$/);
  assert.deepEqual(await t.read(),{generation:first.generation,body:'{"reservedCents":100}'});
  assert.ok(!Buffer.from(f.calls.find(c=>c.method==="PUT")!.body.content,"base64").toString().includes("reservedCents"));
  const second=await t.compareAndSwap(first.generation,'{"reservedCents":200}'); assert.equal(second.kind,"written");
  assert.deepEqual(await t.compareAndSwap(first.generation,"stale"),{kind:"conflict"});
  assert.ok(f.calls.filter(c=>c.method==="PUT").every(c=>!c.url.includes("main")));
});
test("a ledger larger than the Contents inline limit uses object metadata and immutable blobs",async()=>{
  const f=fixture(), t=createGitHubFactoryStateTransport(f), body="x".repeat(1100000);
  await t.compareAndSwap(null,body);
  assert.equal((await t.read())!.body,body);
});
test("wrong blob and ambiguous writes fail closed without automatic retries",async()=>{
  const f=fixture(), t=createGitHubFactoryStateTransport(f); await t.compareAndSwap(null,"ledger");
  f.corrupt(); await assert.rejects(t.read(),/VERSION_UNCONFIRMED/);
  f.fail(); const count=f.calls.length;
  await assert.rejects(t.compareAndSwap("1","ledger"),/REQUEST_UNCONFIRMED/);
  assert.equal(f.calls.slice(count).filter(c=>c.method==="PUT").length,1);
});
test("configuration refuses other repositories and generation overflow",async()=>{
  const f=fixture(); assert.throws(()=>createGitHubFactoryStateTransport({...f,repository:"fixture/kong"}),/REPOSITORY_INVALID/);
  const t=createGitHubFactoryStateTransport(f);
  await assert.rejects(t.compareAndSwap("9".repeat(49),"ledger"),/GENERATION_INVALID/);
  assert.equal(f.calls.length,0);
});
test("synthetic transport proof uses a separate object from the financial ledger",async()=>{
 const f=fixture("transport-probe"),t=createGitHubFactoryStateTransport(f);
 await t.compareAndSwap(null,"synthetic");assert.equal((await t.read())!.body,"synthetic");
 assert.ok(f.calls.filter(c=>c.url.includes("/contents/")).every(c=>c.url.includes("/transport-probe.enc.json")));
 assert.throws(()=>createGitHubFactoryStateTransport({...f,object:"../main" as any}),/OBJECT_INVALID/);
});
