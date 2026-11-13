import assert from "node:assert/strict";
import test from "node:test";
import { addBlackRoomCountdown, deactivateBlackRoomLink, formatBlackRoomLinkPerformance, getBlackRoomLinkPerformance } from "../server/blackroom-links";

test("Black Room admin headers reject placeholder credentials", async () => {
  const originalFetch = globalThis.fetch;
  const snapshot = {
    BLACKROOM_ADMIN_COOKIE: process.env.BLACKROOM_ADMIN_COOKIE,
    BLACKROOM_ADMIN_BEARER_TOKEN: process.env.BLACKROOM_ADMIN_BEARER_TOKEN,
    BLACKROOM_ADMIN_API_KEY: process.env.BLACKROOM_ADMIN_API_KEY,
  };
  let capturedHeaders: HeadersInit | undefined;

  process.env.BLACKROOM_ADMIN_COOKIE = "replace-with-admin-cookie";
  process.env.BLACKROOM_ADMIN_BEARER_TOKEN = "your-admin-token";
  process.env.BLACKROOM_ADMIN_API_KEY = "replace-with-api-key";

  globalThis.fetch = (async (_url: any, init: any = {}) => {
    capturedHeaders = init.headers;
    return new Response(JSON.stringify({ totals: {}, links: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    await getBlackRoomLinkPerformance({});
    assert.equal((capturedHeaders as Record<string, string>)?.Cookie, undefined);
    assert.equal((capturedHeaders as Record<string, string>)?.Authorization, undefined);
    assert.equal((capturedHeaders as Record<string, string>)?.["X-API-Key"], undefined);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(snapshot)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("Black Room admin base URL rejects placeholders before fetching", async () => {
  const originalFetch = globalThis.fetch;
  const originalBaseUrl = process.env.BLACKROOM_ADMIN_BASE_URL;
  let fetched = false;

  process.env.BLACKROOM_ADMIN_BASE_URL = "https://your-domain.example";
  globalThis.fetch = (async () => {
    fetched = true;
    return new Response(JSON.stringify({ totals: {}, links: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    await assert.rejects(
      () => getBlackRoomLinkPerformance({}),
      /BLACKROOM_ADMIN_BASE_URL must be a real admin URL/,
    );
    assert.equal(fetched, false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBaseUrl === undefined) delete process.env.BLACKROOM_ADMIN_BASE_URL;
    else process.env.BLACKROOM_ADMIN_BASE_URL = originalBaseUrl;
  }
});

test("deactivateBlackRoomLink soft-disables bio link and builder element without DELETE", async () => {
  const calls: Array<{ url: string; method: string; body?: any }> = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (url: any, init: any = {}) => {
    const method = init.method || "GET";
    calls.push({
      url: String(url),
      method,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });

    if (String(url).endsWith("/api/admin/link-stats")) {
      return new Response(JSON.stringify({
        links: [
          { id: 10, title: "Old Party", url: "https://tickets.example/old", is_active: true },
        ],
        totals: {},
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    if (String(url).endsWith("/api/admin/bio-elements")) {
      return new Response(JSON.stringify([
        { id: 20, element_type: "link", title: "Old Party", url: "https://tickets.example/old", is_active: true },
      ]), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const result = await deactivateBlackRoomLink({ title: "Old Party" });

    assert.equal(result.action, "deactivated");
    assert.equal(result.preservedData, true);
    assert.equal(calls.some((call) => call.method === "DELETE"), false);
    assert.ok(calls.some((call) =>
      call.url.endsWith("/api/admin/bio-links/10") &&
      call.method === "PUT" &&
      call.body?.is_active === false
    ));
    assert.ok(calls.some((call) =>
      call.url.endsWith("/api/admin/bio-elements/20") &&
      call.method === "PUT" &&
      call.body?.is_active === false
    ));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("getBlackRoomLinkPerformance ranks links by total clicks", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () => new Response(JSON.stringify({
    totals: { total_clicks: 17, clicks_today: 3, clicks_week: 9 },
    links: [
      { id: 1, title: "Low", url: "https://example.com/low", clicks_today: 1, clicks_week: 2, clicks_month: 3, total_clicks: 4, is_active: true },
      { id: 2, title: "High", url: "https://example.com/high", clicks_today: 2, clicks_week: 7, clicks_month: 8, total_clicks: 13, is_active: false },
    ],
  }), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;

  try {
    const performance = await getBlackRoomLinkPerformance({ limit: 2 });

    assert.equal(performance.totals.total_clicks, 17);
    assert.equal(performance.links[0].title, "High");
    assert.equal(performance.links[0].isActive, false);
    assert.match(formatBlackRoomLinkPerformance(performance), /High \(desactivado\).*total 13/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("addBlackRoomCountdown creates builder countdown with explicit date", async () => {
  const calls: Array<{ url: string; method: string; body?: any }> = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (url: any, init: any = {}) => {
    const method = init.method || "GET";
    calls.push({
      url: String(url),
      method,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });

    return new Response(JSON.stringify({ id: 30, ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const result = await addBlackRoomCountdown({
      title: "Black Room & Friends",
      date: "2026-06-21T12:00",
      url: "https://tickets.example/party",
    });

    assert.equal(result.action, "countdown_added");
    assert.equal(result.countdownDate, "2026-06-21T12:00");
    assert.ok(calls.some((call) =>
      call.url.endsWith("/api/admin/bio-elements") &&
      call.method === "POST" &&
      call.body?.element_type === "countdown" &&
      call.body?.title === "Black Room & Friends" &&
      call.body?.url === "https://tickets.example/party" &&
      call.body?.metadata?.countdown_date === "2026-06-21T12:00"
    ));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("addBlackRoomCountdown can derive title url and date from an existing party link", async () => {
  const calls: Array<{ url: string; method: string; body?: any }> = [];
  const originalFetch = globalThis.fetch;
  const now = new Date();
  const candidate = new Date(now.getFullYear(), 5, 21, 12, 0, 0, 0);
  if (candidate.getTime() < now.getTime() - 30 * 24 * 60 * 60 * 1000) candidate.setFullYear(candidate.getFullYear() + 1);
  const expectedCountdownDate = `${candidate.getFullYear()}-06-21T12:00`;

  globalThis.fetch = (async (url: any, init: any = {}) => {
    const method = init.method || "GET";
    calls.push({
      url: String(url),
      method,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });

    if (String(url).endsWith("/api/admin/link-stats")) {
      return new Response(JSON.stringify({
        links: [
          {
            id: 11,
            title: "BLACK ROOM & FRIENDS @ CASA NUBE",
            subtitle: "JUNE 21",
            url: "https://kongnightlife.com/p/bio-party",
            is_active: true,
          },
        ],
        totals: {},
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    if (String(url).endsWith("/api/admin/bio-elements")) {
      if (method === "GET") {
        return new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ id: 31, ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const result = await addBlackRoomCountdown({ partyTitle: "black room friends" });

    assert.equal(result.action, "countdown_added");
    assert.equal(result.source, "existing_party");
    assert.equal(result.title, "BLACK ROOM & FRIENDS @ CASA NUBE");
    assert.equal(result.url, "https://kongnightlife.com/p/bio-party");
    assert.equal(result.countdownDate, expectedCountdownDate);
    assert.ok(calls.some((call) =>
      call.url.endsWith("/api/admin/bio-elements") &&
      call.method === "POST" &&
      call.body?.element_type === "countdown" &&
      call.body?.metadata?.countdown_date === expectedCountdownDate
    ));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
