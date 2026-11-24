// Per-post analytics collectors for every Social Hub network (official read APIs only).
import type { SocialMetricSnapshot, SocialNetwork, SocialPost } from "@shared/social-hub";
import { engagementOf } from "@shared/social-hub";
import type { FetchLike, SocialAccountCredential } from "./providers";

type Metrics = Omit<SocialMetricSnapshot, "network" | "accountId" | "externalId" | "capturedAt">;
type Collector = (externalId: string, cred: SocialAccountCredential, f: FetchLike) => Promise<Metrics>;

const GRAPH = "https://graph.facebook.com/v21.0";
const THREADS = "https://graph.threads.net/v1.0";

async function getJson(f: FetchLike, url: string, init: RequestInit = {}): Promise<any> {
  const res = await f(url, init);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const insightsToMap = (data: any[] = []): Record<string, number> =>
  Object.fromEntries(data.map((d) => [d.name, Number(d.values?.[0]?.value ?? d.total_value?.value ?? 0)]));

export const COLLECTORS: Record<SocialNetwork, Collector> = {
  async facebook(id, c, f) {
    const t = encodeURIComponent(c.accessToken);
    const base = await getJson(f, `${GRAPH}/${id}?fields=shares,reactions.summary(true).limit(0),comments.summary(true).limit(0)&access_token=${t}`);
    let ins: Record<string, number> = {};
    try { ins = insightsToMap((await getJson(f, `${GRAPH}/${id}/insights?metric=post_impressions,post_impressions_unique,post_clicks&access_token=${t}`)).data); } catch { /* insights need page perms */ }
    return { likes: base.reactions?.summary?.total_count, comments: base.comments?.summary?.total_count, shares: base.shares?.count ?? 0, impressions: ins.post_impressions, reach: ins.post_impressions_unique, clicks: ins.post_clicks };
  },
  async instagram(id, c, f) {
    const m = insightsToMap((await getJson(f, `${GRAPH}/${id}/insights?metric=reach,views,likes,comments,shares,saved&access_token=${encodeURIComponent(c.accessToken)}`)).data);
    return { reach: m.reach, views: m.views, likes: m.likes, comments: m.comments, shares: m.shares, saves: m.saved };
  },
  async threads(id, c, f) {
    const m = insightsToMap((await getJson(f, `${THREADS}/${id}/insights?metric=views,likes,replies,reposts,quotes&access_token=${encodeURIComponent(c.accessToken)}`)).data);
    return { views: m.views, likes: m.likes, comments: m.replies, shares: (m.reposts ?? 0) + (m.quotes ?? 0) };
  },
  async tiktok(id, c, f) {
    // TikTok returns publish_id on post; the video id arrives via status/fetch. Accept either "video:<id>" or a raw video id.
    const videoId = id.startsWith("video:") ? id.slice(6) : id;
    const body = await getJson(f, "https://open.tiktokapis.com/v2/video/query/?fields=id,view_count,like_count,comment_count,share_count", {
      method: "POST",
      headers: { Authorization: `Bearer ${c.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ filters: { video_ids: [videoId] } }),
    });
    const v = body?.data?.videos?.[0] ?? {};
    return { views: v.view_count, likes: v.like_count, comments: v.comment_count, shares: v.share_count };
  },
  async youtube(id, c, f) {
    const body = await getJson(f, `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${c.accessToken}` } });
    const s = body.items?.[0]?.statistics ?? {};
    return { views: Number(s.viewCount ?? 0), likes: Number(s.likeCount ?? 0), comments: Number(s.commentCount ?? 0) };
  },
  async x(id, c, f) {
    const body = await getJson(f, `https://api.x.com/2/tweets/${encodeURIComponent(id)}?tweet.fields=public_metrics`, { headers: { Authorization: `Bearer ${c.accessToken}` } });
    const m = body.data?.public_metrics ?? {};
    return { impressions: m.impression_count, likes: m.like_count, comments: m.reply_count, shares: (m.retweet_count ?? 0) + (m.quote_count ?? 0), saves: m.bookmark_count };
  },
  async linkedin(id, c, f) {
    const body = await getJson(f, `https://api.linkedin.com/rest/socialActions/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${c.accessToken}`, "LinkedIn-Version": "202410", "X-Restli-Protocol-Version": "2.0.0" } });
    return { likes: body.likesSummary?.totalLikes, comments: body.commentsSummary?.aggregatedTotalComments };
  },
  async reddit(id, c, f) {
    const body = await getJson(f, `https://oauth.reddit.com/api/info?id=${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${c.accessToken}`, "User-Agent": "blackops-social-hub/1.0" } });
    const d = body.data?.children?.[0]?.data ?? {};
    return { likes: d.score, comments: d.num_comments };
  },
};

/** Collects fresh snapshots for every published target of the given posts. Errors are skipped, not thrown. */
export async function collectPostMetrics(
  posts: SocialPost[],
  getCred: (n: SocialNetwork, accountId: string) => Promise<SocialAccountCredential | null>,
  f: FetchLike,
  now: Date,
  collectors: Partial<Record<SocialNetwork, Collector>> = COLLECTORS,
): Promise<{ snapshots: SocialMetricSnapshot[]; errors: string[] }> {
  const snapshots: SocialMetricSnapshot[] = [];
  const errors: string[] = [];
  for (const post of posts) for (const r of post.results) {
    if (r.status !== "published" || !r.externalId) continue;
    const collect = collectors[r.network];
    const cred = await getCred(r.network, r.accountId);
    if (!collect || !cred) continue;
    try {
      const m = await collect(r.externalId, cred, f);
      snapshots.push({ network: r.network, accountId: r.accountId, externalId: r.externalId, capturedAt: now.toISOString(), ...m });
    } catch (e) {
      errors.push(`${r.network}/${r.externalId}: ${e instanceof Error ? e.message : e}`);
    }
  }
  return { snapshots, errors };
}

export interface SocialAnalyticsSummary {
  byNetwork: Record<string, { posts: number; views: number; likes: number; comments: number; shares: number; engagement: number }>;
  topPosts: Array<{ network: SocialNetwork; externalId: string; engagement: number; views: number }>;
}

/** Latest snapshot per post, aggregated per network, plus top 10 posts. */
export function summarizeMetrics(metrics: SocialMetricSnapshot[], sinceIso?: string): SocialAnalyticsSummary {
  const latest = new Map<string, SocialMetricSnapshot>();
  for (const m of metrics) {
    if (!m.externalId || (sinceIso && m.capturedAt < sinceIso)) continue;
    const k = `${m.network}:${m.externalId}`;
    const prev = latest.get(k);
    if (!prev || prev.capturedAt < m.capturedAt) latest.set(k, m);
  }
  const byNetwork: SocialAnalyticsSummary["byNetwork"] = {};
  const top: SocialAnalyticsSummary["topPosts"] = [];
  for (const m of Array.from(latest.values())) {
    const n = (byNetwork[m.network] ||= { posts: 0, views: 0, likes: 0, comments: 0, shares: 0, engagement: 0 });
    const e = engagementOf(m);
    n.posts++; n.views += m.views ?? m.impressions ?? 0; n.likes += m.likes ?? 0; n.comments += m.comments ?? 0; n.shares += m.shares ?? 0; n.engagement += e;
    top.push({ network: m.network, externalId: m.externalId!, engagement: e, views: m.views ?? m.impressions ?? 0 });
  }
  top.sort((a, b) => b.engagement - a.engagement);
  return { byNetwork, topPosts: top.slice(0, 10) };
}
