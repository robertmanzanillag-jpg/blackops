import assert from "node:assert/strict";
import test from "node:test";
import { checkRateLimit, createRateLimiter, type RateLimitStore } from "../server/rate-limit";

test("allows requests until the rate limit is reached", () => {
  const store: RateLimitStore = new Map();

  assert.deepEqual(checkRateLimit(store, "auth:1", 2, 1000, 100), {
    allowed: true,
    remaining: 1,
    resetAt: 1100,
  });
  assert.deepEqual(checkRateLimit(store, "auth:1", 2, 1000, 200), {
    allowed: true,
    remaining: 0,
    resetAt: 1100,
  });
  assert.deepEqual(checkRateLimit(store, "auth:1", 2, 1000, 300), {
    allowed: false,
    remaining: 0,
    resetAt: 1100,
  });
});

test("resets rate limit buckets after their window expires", () => {
  const store: RateLimitStore = new Map();

  checkRateLimit(store, "telegram:1", 1, 1000, 100);
  assert.equal(checkRateLimit(store, "telegram:1", 1, 1000, 200).allowed, false);
  assert.deepEqual(checkRateLimit(store, "telegram:1", 1, 1000, 1100), {
    allowed: true,
    remaining: 0,
    resetAt: 2100,
  });
});

test("keeps independent buckets per key", () => {
  const store: RateLimitStore = new Map();

  assert.equal(checkRateLimit(store, "auth:1", 1, 1000, 100).allowed, true);
  assert.equal(checkRateLimit(store, "auth:1", 1, 1000, 100).allowed, false);
  assert.equal(checkRateLimit(store, "auth:2", 1, 1000, 100).allowed, true);
});

function mockReq(ip = "127.0.0.1") {
  return {
    ip,
    socket: { remoteAddress: ip },
    header(name: string) {
      return name === "x-forwarded-for" ? undefined : undefined;
    },
  } as any;
}

function mockRes() {
  return {
    statusCode: 200,
    body: undefined as unknown,
    headers: new Map<string, string>(),
    setHeader(name: string, value: string) {
      this.headers.set(name, value);
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  } as any;
}

test("uses persistent rate limit store before in-memory fallback", async () => {
  const keys: string[] = [];
  const limiter = createRateLimiter({
    scope: "telegram-webhook",
    limit: 2,
    windowMs: 1000,
    persistentStore: {
      async checkPersistentRateLimit(key, limit, windowMs) {
        keys.push(`${key}:${limit}:${windowMs}`);
        return { allowed: true, remaining: 1, resetAt: 1100 };
      },
    },
  });
  const res = mockRes();
  let nextCalled = false;

  await limiter(mockReq("10.0.0.1"), res, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
  assert.equal(res.headers.get("X-RateLimit-Remaining"), "1");
  assert.equal(keys[0], "telegram-webhook:10.0.0.1:2:1000");
});

test("does not trust spoofed x-forwarded-for headers for bucket identity", async () => {
  const keys: string[] = [];
  const limiter = createRateLimiter({
    scope: "public-api",
    limit: 2,
    windowMs: 1000,
    persistentStore: {
      async checkPersistentRateLimit(key, limit, windowMs) {
        keys.push(`${key}:${limit}:${windowMs}`);
        return { allowed: true, remaining: 1, resetAt: 1100 };
      },
    },
  });
  const res = mockRes();
  let nextCalled = false;
  const req = {
    ip: "10.0.0.5",
    socket: { remoteAddress: "10.0.0.5" },
    header(name: string) {
      return name.toLowerCase() === "x-forwarded-for" ? "198.51.100.77" : undefined;
    },
  } as any;

  await limiter(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
  assert.equal(keys[0], "public-api:10.0.0.5:2:1000");
});

test("falls back to in-memory rate limit store when persistent store fails", async () => {
  const errors: unknown[] = [];
  const limiter = createRateLimiter({
    scope: "local-auth",
    limit: 1,
    windowMs: 1000,
    persistentStore: {
      async checkPersistentRateLimit() {
        throw new Error("relation app_rate_limit_buckets does not exist");
      },
    },
    onPersistentError: (error) => errors.push(error),
  });

  const firstRes = mockRes();
  let firstNext = false;
  await limiter(mockReq("10.0.0.2"), firstRes, () => { firstNext = true; });

  const secondRes = mockRes();
  let secondNext = false;
  await limiter(mockReq("10.0.0.2"), secondRes, () => { secondNext = true; });

  assert.equal(firstNext, true);
  assert.equal(secondNext, false);
  assert.equal(secondRes.statusCode, 429);
  assert.equal(errors.length, 2);
});
