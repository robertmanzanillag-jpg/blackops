import assert from "node:assert/strict";
import test from "node:test";
import { createOfficeOpenAI } from "../server/office-openai";

const env = { OFFICE_REVIEW_PROVIDER: "openai", OPENAI_API_KEY: "test-only", OFFICE_OPENAI_MODEL: "gpt-6-luna" };
const result = { id: "resp_test", model: "gpt-6-luna", status: "completed", usage: { input_tokens: 12, output_tokens: 5, total_tokens: 17 }, output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "verified" }] }] };
test("requires explicit provider, model and durable budget hooks before network", async () => {
  for (const configuration of [{}, env]) {
    let calls = 0;
    const runner = createOfficeOpenAI({ env: configuration, fetch: (async () => { calls++; throw Error(); }) as typeof fetch });
    assert.equal((await runner.probeOfficeOpenAI()).status, "blocked");
    await assert.rejects(runner.runOfficeOpenAI("test")); assert.equal(calls, 0);
  }
});
test("reserves before one request, records measured usage, disables tools and redirects", async () => {
  const sequence: string[] = [];
  const runner = createOfficeOpenAI({ env, authorize: async () => { sequence.push("reserve"); }, recordUsage: async data => { sequence.push("usage"); assert.equal(data.usage.totalTokens, 17); }, fetch: (async (url, request) => {
    sequence.push("request"); assert.equal(url, "https://api.openai.com/v1/responses"); assert.equal(request?.redirect, "error");
    const body = JSON.parse(request?.body as string); assert.deepEqual(body.tools, []); assert.equal(body.store, false); assert.equal(body.max_output_tokens, 2048); assert.equal(body.service_tier, "default");
    return Response.json(result);
  }) as typeof fetch });
  assert.equal((await runner.runOfficeOpenAI("literal untrusted diff")).sessionId, "resp_test");
  assert.deepEqual(sequence, ["reserve", "request", "usage"]);
});
test("budget denial never sends request", async () => {
  let calls = 0;
  const runner = createOfficeOpenAI({ env, authorize: async () => { throw Error("budget"); }, recordUsage: async () => {}, fetch: (async () => { calls++; return Response.json(result); }) as typeof fetch });
  await assert.rejects(runner.runOfficeOpenAI("test")); assert.equal(calls, 0);
});
test("transport ambiguity never retries or claims completion", async () => {
  let calls = 0;
  const runner = createOfficeOpenAI({ env, authorize: async () => {}, recordUsage: async () => {}, fetch: (async () => { calls++; throw Error("secret must not leak"); }) as typeof fetch });
  await assert.rejects(runner.runOfficeOpenAI("test"), (e: any) => e.code === "execution_unknown" && !e.message.includes("secret")); assert.equal(calls, 1);
});
test("incomplete output accounts usage but cannot become success", async () => {
  let recorded = false;
  const runner = createOfficeOpenAI({ env, authorize: async () => {}, recordUsage: async () => { recorded = true; }, fetch: (async () => Response.json({ ...result, status: "incomplete" })) as typeof fetch });
  await assert.rejects(runner.runOfficeOpenAI("test"), (e: any) => e.code === "incomplete_result"); assert.equal(recorded, true);
});
test("rejects fabricated missing usage and unpersisted accounting", async () => {
  for (const invalidUsage of [true, false]) {
    const runner = createOfficeOpenAI({ env, authorize: async () => {}, recordUsage: async () => { throw Error("database unavailable"); }, fetch: (async () => Response.json({ ...result, ...(invalidUsage ? { usage: undefined } : {}) })) as typeof fetch });
    await assert.rejects(runner.runOfficeOpenAI("test"));
  }
});
test("malformed output is never coerced into verified text", async () => {
  const runner = createOfficeOpenAI({ env, authorize: async () => {}, recordUsage: async () => {}, fetch: (async () => Response.json({ ...result, output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: { invalid: true } }] }] })) as typeof fetch });
  await assert.rejects(runner.runOfficeOpenAI("test"), (e: any) => e.code === "invalid_output");
});
