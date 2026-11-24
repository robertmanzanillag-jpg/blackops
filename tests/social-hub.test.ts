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
