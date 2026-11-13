import assert from "node:assert/strict";
import test from "node:test";
import { probeAppQaUrl } from "../server/app-qa-agent";

function transport(url: string, contentType: string): typeof fetch {
  return (async () => {
    const response = new Response(null, { status: 200, headers: { "content-type": contentType } });
    Object.defineProperty(response, "url", { value: url }); return response;
  }) as typeof fetch;
}
test("a successful Replit login page is not application health", async () => {
  const result = await probeAppQaUrl("https://robertwebsites.com/api/health", 1000, true, transport("https://replit.com/silent-auth?privateDeployment=true", "text/html"));
  assert.equal(result.ok, false); assert.equal(result.error, "authentication_required");
});
test("SPA HTML is not backend health but remains a valid public page", async () => {
  const fetcher = transport("https://example.com/api/health", "text/html; charset=utf-8");
  assert.equal((await probeAppQaUrl("https://example.com/api/health", 1000, true, fetcher)).error, "health_returned_html");
  assert.equal((await probeAppQaUrl("https://example.com", 1000, false, fetcher)).ok, true);
});
test("a directly responding JSON endpoint remains valid HTTP liveness evidence", async () => {
  const result = await probeAppQaUrl("https://kongnightlife.com/api/health", 1000, true, transport("https://kongnightlife.com/api/health", "application/json"));
  assert.equal(result.ok, true);
});
