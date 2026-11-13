import test from "node:test";
import assert from "node:assert/strict";
import { createFactoryOpenAiTransport } from "../server/software-factory-openai-transport";

test("model credential only reaches the two approved endpoints with operator billing scope", async () => {
  const key = "sk-proj-" + "a".repeat(50), signal = new AbortController().signal;
  const calls: { url: string; init: RequestInit }[] = [];
  const request = createFactoryOpenAiTransport(key, (async (url, init) => {
    calls.push({ url: String(url), init: init! }); return Response.json({});
  }) as typeof fetch);
  for (const endpoint of ["", "/input_tokens"]) {
    await request("https://api.openai.com/v1/responses" + endpoint, { method: "POST", body: "{}", signal,
      redirect: "follow", credentials: "include", headers: { Authorization: "untrusted", Cookie: "private", "OpenAI-Project": "other", "OpenAI-Organization": "other" } });
  }
  assert.equal(calls.length, 2);
  for (const call of calls) {
    const headers = new Headers(call.init.headers);
    assert.equal(headers.get("Authorization"), `Bearer ${key}`);
    assert.equal(headers.get("Cookie"), null); assert.equal(headers.get("OpenAI-Project"), null);
    assert.equal(headers.get("OpenAI-Organization"), null);
    assert.equal(call.init.redirect, "error"); assert.equal(call.init.credentials, "omit");
    assert.equal(call.init.signal, signal);
  }
  for (const url of ["https://example.com/v1/responses", "http://api.openai.com/v1/responses", "https://api.openai.com/v1/files",
    "https://user@api.openai.com/v1/responses", "https://api.openai.com/v1/responses?project=other", "https://api.openai.com/v1/responses#secret", "invalid"]) {
    await assert.rejects(request(url, { method: "POST", body: "{}", signal }), /SCOPE_INVALID/);
  }
  for (const init of [{ method: "GET", body: "{}", signal }, { method: "POST", body: "{}" }, { method: "POST", body: "x".repeat(1048577), signal }]) {
    await assert.rejects(request("https://api.openai.com/v1/responses", init), /SCOPE_INVALID/);
  }
  assert.equal(calls.length, 2);
});

test("aborted and uncertain calls cannot retry or expose credential-bearing errors", async () => {
  let calls = 0;
  const request = createFactoryOpenAiTransport("sk-" + "b".repeat(50), (async () => { calls++; throw Error("sensitive provider detail"); }) as typeof fetch);
  await assert.rejects(request("https://api.openai.com/v1/responses", { method: "POST", body: "{}", signal: AbortSignal.abort() }));
  assert.equal(calls, 0);
  await assert.rejects(request("https://api.openai.com/v1/responses", { method: "POST", body: "{}", signal: new AbortController().signal }), /^Error: FACTORY_OPENAI_TRANSPORT_UNCONFIRMED$/);
  assert.equal(calls, 1);
});
