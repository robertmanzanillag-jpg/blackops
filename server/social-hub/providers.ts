// Official-API publishers for every network the Social Hub supports.
// Each provider only talks to the network's own API with the account's OAuth token.
import type { SocialNetwork, SocialPost, SocialPostTarget } from "@shared/social-hub";

export type FetchLike = typeof fetch;

export interface SocialAccountCredential {
  network: SocialNetwork;
  accountId: string; // page id, IG user id, channel id, org urn, reddit username…
  accessToken: string;
}

/** Codex task: replace env store with DB-backed OAuth store with refresh. */
export interface SocialCredentialStore {
  get(network: SocialNetwork, accountId: string): Promise<SocialAccountCredential | null>;
}

export interface PublishOutcome {
  externalId: string;
  url?: string;
}

export interface SocialProvider {
  network: SocialNetwork;
  publish(post: SocialPost, target: SocialPostTarget, cred: SocialAccountCredential, fetchImpl: FetchLike): Promise<PublishOutcome>;
}

export class SocialPublishError extends Error {
  network: SocialNetwork;
  retryable: boolean;
  constructor(network: SocialNetwork, message: string, retryable = true) {
    super(`${network}: ${message}`);
    this.network = network;
    this.retryable = retryable;
  }
}

const GRAPH = "https://graph.facebook.com/v21.0";
const THREADS = "https://graph.threads.net/v1.0";

async function call(network: SocialNetwork, fetchImpl: FetchLike, url: string, init: RequestInit): Promise<any> {
  const res = await fetchImpl(url, init);
  const text = await res.text();
  let body: any = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  if (!res.ok) {
    const retryable = res.status === 429 || res.status >= 500;
    const msg = body?.error?.message ?? body?.message ?? body?.detail ?? `HTTP ${res.status}`;
    throw new SocialPublishError(network, String(msg).slice(0, 300), retryable);
  }
  return body;
}

function form(params: Record<string, string>): URLSearchParams {
  return new URLSearchParams(params);
}

function captionFor(post: SocialPost, target: SocialPostTarget): string {
  return target.caption ?? post.caption;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function pollUntil(check: () => Promise<boolean>, tries = 30, everyMs = 4000) {
  for (let i = 0; i < tries; i++) {
    if (await check()) return;
    await wait(everyMs);
  }
  throw new SocialPublishError("instagram", "el contenedor de media no terminó de procesar");
}

export const facebookProvider: SocialProvider = {
  network: "facebook",
  async publish(post, target, cred, f) {
    const message = captionFor(post, target);
    const base = `${GRAPH}/${cred.accountId}`;
    const token = cred.accessToken;
    let body: any;
    if (post.mediaKind === "video") {
      body = await call("facebook", f, `${base}/videos`, { method: "POST", body: form({ file_url: post.mediaUrls[0], description: message, access_token: token }) });
    } else if (post.mediaKind === "image") {
      body = await call("facebook", f, `${base}/photos`, { method: "POST", body: form({ url: post.mediaUrls[0], caption: message, access_token: token }) });
    } else if (post.mediaKind === "carousel") {
      const ids: string[] = [];
      for (const url of post.mediaUrls) {
        const p = await call("facebook", f, `${base}/photos`, { method: "POST", body: form({ url, published: "false", access_token: token }) });
        ids.push(p.id);
      }
      const attached = Object.fromEntries(ids.map((id, i) => [`attached_media[${i}]`, JSON.stringify({ media_fbid: id })]));
      body = await call("facebook", f, `${base}/feed`, { method: "POST", body: form({ message, access_token: token, ...attached }) });
    } else {
      body = await call("facebook", f, `${base}/feed`, { method: "POST", body: form({ message, access_token: token }) });
    }
    const id = body.post_id ?? body.id;
    return { externalId: id, url: `https://www.facebook.com/${id}` };
  },
};

async function metaContainerPublish(network: "instagram" | "threads", root: string, post: SocialPost, target: SocialPostTarget, cred: SocialAccountCredential, f: FetchLike): Promise<PublishOutcome> {
  const token = cred.accessToken;
  const text = captionFor(post, target);
  const textKey = network === "instagram" ? "caption" : "text";
  const edge = network === "instagram" ? "media" : "threads";
  const base = `${root}/${cred.accountId}`;
  const mediaParams = (url: string, kind: "image" | "video"): Record<string, string> => {
    if (network === "instagram") return kind === "video" ? { media_type: "REELS", video_url: url } : { image_url: url };
    return kind === "video" ? { media_type: "VIDEO", video_url: url } : { media_type: "IMAGE", image_url: url };
  };
  const waitReady = async (id: string) => {
    await pollUntil(async () => {
      const s = await call(network, f, `${root}/${id}?fields=status_code,status&access_token=${encodeURIComponent(token)}`, { method: "GET" });
      if (s.status_code === "ERROR") throw new SocialPublishError(network, `procesamiento falló: ${s.status ?? ""}`, false);
      return s.status_code === "FINISHED" || s.status_code === undefined;
    });
  };
  let creationId: string;
  if (post.mediaKind === "carousel") {
    const children: string[] = [];
    for (const url of post.mediaUrls) {
      const kind = /\.(mp4|mov|m4v)(\?|$)/i.test(url) ? "video" : "image";
      const c = await call(network, f, `${base}/${edge}`, { method: "POST", body: form({ ...mediaParams(url, kind), is_carousel_item: "true", access_token: token }) });
      await waitReady(c.id);
      children.push(c.id);
    }
    const c = await call(network, f, `${base}/${edge}`, { method: "POST", body: form({ media_type: "CAROUSEL", children: children.join(","), [textKey]: text, access_token: token }) });
    creationId = c.id;
  } else if (post.mediaKind === "none") {
    const c = await call(network, f, `${base}/${edge}`, { method: "POST", body: form({ media_type: "TEXT", [textKey]: text, access_token: token }) });
    creationId = c.id;
  } else {
    const c = await call(network, f, `${base}/${edge}`, { method: "POST", body: form({ ...mediaParams(post.mediaUrls[0], post.mediaKind), [textKey]: text, access_token: token }) });
    creationId = c.id;
  }
  await waitReady(creationId);
  const published = await call(network, f, `${base}/${edge}_publish`, { method: "POST", body: form({ creation_id: creationId, access_token: token }) });
  return { externalId: published.id };
}

export const instagramProvider: SocialProvider = {
  network: "instagram",
  publish: (post, target, cred, f) => metaContainerPublish("instagram", GRAPH, post, target, cred, f),
};

export const threadsProvider: SocialProvider = {
  network: "threads",
  publish: (post, target, cred, f) => metaContainerPublish("threads", THREADS, post, target, cred, f),
};

export const tiktokProvider: SocialProvider = {
  network: "tiktok",
  async publish(post, target, cred, f) {
    const headers = { Authorization: `Bearer ${cred.accessToken}`, "Content-Type": "application/json; charset=UTF-8" };
    const privacy = String(target.options?.privacy ?? "PUBLIC_TO_EVERYONE");
    const title = captionFor(post, target);
    if (post.mediaKind === "video") {
      const body = await call("tiktok", f, "https://open.tiktokapis.com/v2/post/publish/video/init/", {
        method: "POST",
        headers,
        body: JSON.stringify({ post_info: { title, privacy_level: privacy }, source_info: { source: "PULL_FROM_URL", video_url: post.mediaUrls[0] } }),
      });
      return { externalId: body?.data?.publish_id };
    }
    const body = await call("tiktok", f, "https://open.tiktokapis.com/v2/post/publish/content/init/", {
      method: "POST",
      headers,
      body: JSON.stringify({
        post_info: { title: title.slice(0, 90), description: title, privacy_level: privacy },
        source_info: { source: "PULL_FROM_URL", photo_images: post.mediaUrls, photo_cover_index: 0 },
        post_mode: "DIRECT_POST",
        media_type: "PHOTO",
      }),
    });
    return { externalId: body?.data?.publish_id };
  },
};

export const youtubeProvider: SocialProvider = {
  network: "youtube",
  async publish(post, target, cred, f) {
    const media = await f(post.mediaUrls[0]);
    if (!media.ok) throw new SocialPublishError("youtube", `no pude descargar el video (${media.status})`);
    const bytes = new Uint8Array(await media.arrayBuffer());
    const meta = {
      snippet: { title: String(target.options?.title ?? "").slice(0, 100), description: captionFor(post, target), categoryId: String(target.options?.categoryId ?? "10") },
      status: { privacyStatus: String(target.options?.privacy ?? "public"), selfDeclaredMadeForKids: false },
    };
    const init = await f("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
      method: "POST",
      headers: { Authorization: `Bearer ${cred.accessToken}`, "Content-Type": "application/json", "X-Upload-Content-Length": String(bytes.byteLength), "X-Upload-Content-Type": "video/*" },
      body: JSON.stringify(meta),
    });
    const location = init.headers.get("location");
    if (!init.ok || !location) throw new SocialPublishError("youtube", `no se pudo iniciar la subida (${init.status})`, init.status >= 500 || init.status === 429);
    const done = await call("youtube", f, location, { method: "PUT", headers: { "Content-Type": "video/*" }, body: bytes });
    return { externalId: done.id, url: `https://youtu.be/${done.id}` };
  },
};

export const xProvider: SocialProvider = {
  network: "x",
  async publish(post, target, cred, f) {
    // Codex task: media upload (v2 /media/upload) and attach media_ids.
    if (post.mediaKind !== "none" && !target.options?.mediaIds) {
      throw new SocialPublishError("x", "subida de media a X aún no implementada (tarea Codex #X-MEDIA)", false);
    }
    const payload: any = { text: captionFor(post, target) };
    if (target.options?.mediaIds) payload.media = { media_ids: String(target.options.mediaIds).split(",") };
    const body = await call("x", f, "https://api.x.com/2/tweets", {
      method: "POST",
      headers: { Authorization: `Bearer ${cred.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return { externalId: body.data.id, url: `https://x.com/i/web/status/${body.data.id}` };
  },
};

export const linkedinProvider: SocialProvider = {
  network: "linkedin",
  async publish(post, target, cred, f) {
    // Codex task: image/video via /rest/images + /rest/videos initializeUpload.
    if (post.mediaKind !== "none") throw new SocialPublishError("linkedin", "media en LinkedIn aún no implementada (tarea Codex #LI-MEDIA)", false);
    const res = await f("https://api.linkedin.com/rest/posts", {
      method: "POST",
      headers: { Authorization: `Bearer ${cred.accessToken}`, "Content-Type": "application/json", "LinkedIn-Version": "202410", "X-Restli-Protocol-Version": "2.0.0" },
      body: JSON.stringify({
        author: cred.accountId, // urn:li:organization:123 or urn:li:person:abc
        commentary: captionFor(post, target),
        visibility: "PUBLIC",
        distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
        lifecycleState: "PUBLISHED",
        isReshareDisabledByAuthor: false,
      }),
    });
    if (!res.ok) throw new SocialPublishError("linkedin", `HTTP ${res.status}`, res.status >= 500 || res.status === 429);
    const id = res.headers.get("x-restli-id") ?? "";
    return { externalId: id, url: id ? `https://www.linkedin.com/feed/update/${id}` : undefined };
  },
};

export const redditProvider: SocialProvider = {
  network: "reddit",
  async publish(post, target, cred, f) {
    const sr = String(target.options?.subreddit ?? "").replace(/^r\//, "");
    const title = String(target.options?.title ?? captionFor(post, target)).slice(0, 300);
    const params: Record<string, string> = { sr, title, api_type: "json", resubmit: "true" };
    if (post.mediaKind === "none") Object.assign(params, { kind: "self", text: captionFor(post, target) });
    else Object.assign(params, { kind: "link", url: post.mediaUrls[0] });
    const body = await call("reddit", f, "https://oauth.reddit.com/api/submit", {
      method: "POST",
      headers: { Authorization: `Bearer ${cred.accessToken}`, "User-Agent": "blackops-social-hub/1.0" },
      body: form(params),
    });
    const errors = body?.json?.errors ?? [];
    if (errors.length) throw new SocialPublishError("reddit", errors.map((e: any[]) => e.join(" ")).join("; "), false);
    return { externalId: body.json.data.name, url: body.json.data.url };
  },
};

export const SOCIAL_PROVIDERS: Record<SocialNetwork, SocialProvider> = {
  facebook: facebookProvider,
  instagram: instagramProvider,
  threads: threadsProvider,
  tiktok: tiktokProvider,
  youtube: youtubeProvider,
  x: xProvider,
  linkedin: linkedinProvider,
  reddit: redditProvider,
};

/**
 * Env credential store: SOCIAL_HUB_ACCOUNTS='[{"network":"facebook","accountId":"123","tokenEnv":"FB_PAGE_TOKEN"}]'
 * Tokens stay in env/secrets; this file never stores them.
 */
export function envCredentialStore(env: NodeJS.ProcessEnv = process.env): SocialCredentialStore {
  let list: Array<{ network: SocialNetwork; accountId: string; tokenEnv: string }> = [];
  try { list = JSON.parse(env.SOCIAL_HUB_ACCOUNTS ?? "[]"); } catch { list = []; }
  return {
    async get(network, accountId) {
      const row = list.find((a) => a.network === network && a.accountId === accountId);
      const token = row ? env[row.tokenEnv] : undefined;
      return row && token ? { network, accountId, accessToken: token } : null;
    },
  };
}

export function listEnvAccounts(env: NodeJS.ProcessEnv = process.env): Array<{ network: SocialNetwork; accountId: string; connected: boolean }> {
  let list: Array<{ network: SocialNetwork; accountId: string; tokenEnv: string }> = [];
  try { list = JSON.parse(env.SOCIAL_HUB_ACCOUNTS ?? "[]"); } catch { list = []; }
  return list.map((a) => ({ network: a.network, accountId: a.accountId, connected: Boolean(env[a.tokenEnv]) }));
}
