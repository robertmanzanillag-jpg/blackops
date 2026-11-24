import test from "node:test";
import assert from "node:assert/strict";
import { validateSocialPost } from "@shared/social-hub";
import { memorySocialHubStore, SocialHub } from "../server/social-hub/scheduler";
import { SocialPublishError } from "../server/social-hub/providers";

const creds = { get: async (network: any, accountId: string) => ({ network, accountId, accessToken: "t" }) };
const base = { brand: "kong", caption: "hola", mediaKind: "video" as const, mediaUrls: ["https://x/v.mp4"], targets: [{ network: "instagram" as const, accountId: "1" }, { network: "tiktok" as const, accountId: "2" }] };

test("validation flags missing media and subreddit", () => {
  assert.ok(validateSocialPost({ ...base, mediaKind: "none", mediaUrls: [], createdBy: "robert" }).some((p) => p.includes("instagram")));
  assert.ok(validateSocialPost({ ...base, mediaKind: "none", mediaUrls: [], targets: [{ network: "reddit", accountId: "u" }], createdBy: "robert" }).some((p) => p.includes("subreddit")));
});

test("agent posts wait for approval; robert posts are scheduled", () => {
  const hub = new SocialHub({ store: memorySocialHubStore(), credentials: creds });
  assert.equal(hub.create({ ...base, createdBy: "factory:marketing" }).status, "pending_approval");
  assert.equal(hub.create({ ...base, createdBy: "robert", publishAt: "2026-01-01T00:00:00Z" }).status, "scheduled");
});

test("publishing is off unless enabled", async () => {
  const hub = new SocialHub({ store: memorySocialHubStore(), credentials: creds });
  const p = hub.create({ ...base, createdBy: "robert" });
  await assert.rejects(hub.publishNow(p.id));
});

test("runDue publishes, retries retryable errors, marks partial", async () => {
  let ig = 0;
  const hub = new SocialHub({
    store: memorySocialHubStore(), credentials: creds, publishingEnabled: true, now: () => new Date("2026-02-01T00:00:00Z"),
    providers: {
      instagram: { network: "instagram", publish: async () => { if (++ig < 2) throw new SocialPublishError("instagram", "500"); return { externalId: "ig1" }; } },
      tiktok: { network: "tiktok", publish: async () => { throw new SocialPublishError("tiktok", "bad", false); } },
    },
  });
  hub.create({ ...base, createdBy: "robert", publishAt: "2026-01-01T00:00:00Z" });
  const [done] = await hub.runDue();
  assert.equal(done.status, "partially_published");
  assert.equal(done.results[0].externalId, "ig1");
  assert.equal(done.results[0].attempts, 2);
  assert.equal(done.results[1].attempts, 1);
});

test("best time is in the future on the hour", () => {
  const now = new Date("2026-02-01T10:07:00Z");
  const hub = new SocialHub({ store: memorySocialHubStore(), credentials: creds, now: () => now });
  const at = hub.bestTime(["tiktok"]);
  assert.ok(at > now && at.getMinutes() === 0);
});

test("collectMetrics stores snapshots and analytics aggregates latest per post", async () => {
  const hub = new SocialHub({
    store: memorySocialHubStore(), credentials: creds, publishingEnabled: true, now: () => new Date("2026-02-01T00:00:00Z"),
    providers: { instagram: { network: "instagram", publish: async () => ({ externalId: "ig9" }) }, tiktok: { network: "tiktok", publish: async () => ({ externalId: "tt9" }) } },
    fetchImpl: (async (url: string) => new Response(JSON.stringify(
      String(url).includes("tiktok") ? { data: { videos: [{ view_count: 100, like_count: 10, comment_count: 1, share_count: 2 }] } }
        : { data: [{ name: "views", values: [{ value: 50 }] }, { name: "likes", values: [{ value: 5 }] }] },
    ), { status: 200 })) as any,
  });
  hub.create({ ...base, createdBy: "robert", publishAt: "2026-01-31T00:00:00Z" });
  await hub.runDue();
  const r = await hub.collectMetrics();
  assert.equal(r.collected, 2);
  const a = hub.analytics();
  assert.equal(a.byNetwork.tiktok.views, 100);
  assert.equal(a.byNetwork.instagram.likes, 5);
  assert.equal(a.topPosts[0].network, "tiktok");
});

test("oauth: auth url has state+pkce, callback stores encrypted token, store resolves by handle", async () => {
  const { hydrateSocialHub, memoryBackend, kvFlush } = await import("../server/social-hub/persist");
  const backend = memoryBackend();
  await hydrateSocialHub(["state", "tokens"], backend);
  Object.assign(process.env, { SOCIAL_HUB_TOKEN_KEY: "k".repeat(32), SOCIAL_HUB_PUBLIC_URL: "https://ops.example", SH_TIKTOK_CLIENT_KEY: "ck", SH_TIKTOK_CLIENT_SECRET: "cs" });
  const { buildAuthUrl, completeOAuth, oauthCredentialStore } = await import("../server/social-hub/oauth");
  const url = new URL(buildAuthUrl("tiktok"));
  assert.equal(url.searchParams.get("client_key"), "ck");
  assert.ok(url.searchParams.get("code_challenge"));
  const f = (async (u: string) => new Response(JSON.stringify(String(u).includes("token") ? { access_token: "PLAIN_TOKEN_x", refresh_token: "RT", expires_in: 86400 } : { data: { user: { username: "kongnightlife" } } }), { status: 200 })) as any;
  const rows = await completeOAuth(url.searchParams.get("state")!, "code", f);
  assert.equal(rows[0].accountId, "kongnightlife");
  await kvFlush();
  const persisted = await backend.read("tokens");
  assert.ok(persisted && !persisted.includes("PLAIN_TOKEN_x"), "token is persisted encrypted");
  const store = oauthCredentialStore({ get: async () => null }, f);
  assert.equal((await store.get("tiktok", "@kongnightlife"))?.accessToken, "PLAIN_TOKEN_x");
  await assert.rejects(completeOAuth(url.searchParams.get("state")!, "code", f));

  // "Redeploy": fresh memory, same database → tokens and queue survive.
  const { persistentSocialHubStore } = await import("../server/social-hub/scheduler");
  persistentSocialHubStore().save({ posts: [], metrics: [{ network: "x", accountId: "1", capturedAt: "2026-01-01T00:00:00Z" }] });
  await kvFlush();
  await hydrateSocialHub(["state", "tokens"], backend);
  assert.equal((await store.get("tiktok", "kongnightlife"))?.accessToken, "PLAIN_TOKEN_x");
  assert.equal(persistentSocialHubStore().load().metrics.length, 1);
});
