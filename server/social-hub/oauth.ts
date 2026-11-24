// "Conectar cuenta" — OAuth for every Social Hub network. Tokens are encrypted at rest.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { kvGet, kvSet } from "./persist";
import type { SocialNetwork } from "@shared/social-hub";
import type { FetchLike, SocialAccountCredential, SocialCredentialStore } from "./providers";

interface OAuthApp {
  authUrl: string;
  tokenUrl: string;
  scopes: string[];
  clientIdEnv: string;
  clientSecretEnv: string;
  scopeSep?: string;
  pkce?: boolean;
  extraAuth?: Record<string, string>;
  clientKeyName?: string; // TikTok uses client_key
  basicAuth?: boolean; // Reddit, X
}

/** App credentials come from env: SH_<APP>_CLIENT_ID / SH_<APP>_CLIENT_SECRET. */
export const OAUTH_APPS: Record<SocialNetwork, OAuthApp> = {
  facebook: { authUrl: "https://www.facebook.com/v21.0/dialog/oauth", tokenUrl: "https://graph.facebook.com/v21.0/oauth/access_token", scopes: ["pages_show_list", "pages_manage_posts", "pages_read_engagement", "read_insights", "instagram_basic", "instagram_content_publish", "instagram_manage_insights", "business_management"], clientIdEnv: "SH_META_CLIENT_ID", clientSecretEnv: "SH_META_CLIENT_SECRET", scopeSep: "," },
  instagram: { authUrl: "https://www.facebook.com/v21.0/dialog/oauth", tokenUrl: "https://graph.facebook.com/v21.0/oauth/access_token", scopes: ["pages_show_list", "instagram_basic", "instagram_content_publish", "instagram_manage_insights", "business_management"], clientIdEnv: "SH_META_CLIENT_ID", clientSecretEnv: "SH_META_CLIENT_SECRET", scopeSep: "," },
  threads: { authUrl: "https://threads.net/oauth/authorize", tokenUrl: "https://graph.threads.net/oauth/access_token", scopes: ["threads_basic", "threads_content_publish", "threads_manage_insights"], clientIdEnv: "SH_THREADS_CLIENT_ID", clientSecretEnv: "SH_THREADS_CLIENT_SECRET", scopeSep: "," },
  tiktok: { authUrl: "https://www.tiktok.com/v2/auth/authorize/", tokenUrl: "https://open.tiktokapis.com/v2/oauth/token/", scopes: ["user.info.basic", "video.publish", "video.upload", "video.list"], clientIdEnv: "SH_TIKTOK_CLIENT_KEY", clientSecretEnv: "SH_TIKTOK_CLIENT_SECRET", scopeSep: ",", clientKeyName: "client_key", pkce: true },
  youtube: { authUrl: "https://accounts.google.com/o/oauth2/v2/auth", tokenUrl: "https://oauth2.googleapis.com/token", scopes: ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"], clientIdEnv: "SH_GOOGLE_CLIENT_ID", clientSecretEnv: "SH_GOOGLE_CLIENT_SECRET", extraAuth: { access_type: "offline", prompt: "consent" } },
  x: { authUrl: "https://x.com/i/oauth2/authorize", tokenUrl: "https://api.x.com/2/oauth2/token", scopes: ["tweet.read", "tweet.write", "users.read", "media.write", "offline.access"], clientIdEnv: "SH_X_CLIENT_ID", clientSecretEnv: "SH_X_CLIENT_SECRET", pkce: true, basicAuth: true },
  linkedin: { authUrl: "https://www.linkedin.com/oauth/v2/authorization", tokenUrl: "https://www.linkedin.com/oauth/v2/accessToken", scopes: ["w_organization_social", "r_organization_social", "rw_organization_admin", "w_member_social"], clientIdEnv: "SH_LINKEDIN_CLIENT_ID", clientSecretEnv: "SH_LINKEDIN_CLIENT_SECRET" },
  reddit: { authUrl: "https://www.reddit.com/api/v1/authorize", tokenUrl: "https://www.reddit.com/api/v1/access_token", scopes: ["identity", "submit", "read"], clientIdEnv: "SH_REDDIT_CLIENT_ID", clientSecretEnv: "SH_REDDIT_CLIENT_SECRET", basicAuth: true, extraAuth: { duration: "permanent" } },
};

export interface StoredToken {
  network: SocialNetwork;
  accountId: string;
  label: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  connectedAt: string;
}

// ---- encrypted file store (key: SOCIAL_HUB_TOKEN_KEY, any long random string) ----
function key(): Buffer {
  const secret = process.env.SOCIAL_HUB_TOKEN_KEY;
  if (!secret || secret.length < 16) throw new Error("Falta SOCIAL_HUB_TOKEN_KEY (16+ caracteres) para guardar tokens.");
  return createHash("sha256").update(secret).digest();
}
function seal(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}
function unseal(sealed: string): string {
  const [iv, tag, enc] = sealed.split(".").map((s) => Buffer.from(s, "base64"));
  const d = createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

export function loadTokens(): StoredToken[] {
  const raw = kvGet("tokens");
  if (!raw) return [];
  try { return JSON.parse(unseal(raw)); } catch { return []; }
}
function saveTokens(list: StoredToken[]) {
  kvSet("tokens", seal(JSON.stringify(list)));
}
export function upsertTokens(rows: StoredToken[]) {
  const list = loadTokens().filter((t) => !rows.some((r) => r.network === t.network && r.accountId === t.accountId));
  saveTokens([...list, ...rows]);
}
export function removeToken(network: SocialNetwork, accountId: string) {
  saveTokens(loadTokens().filter((t) => !(t.network === network && t.accountId === accountId)));
}

// ---- auth flow ----
const pending = new Map<string, { network: SocialNetwork; verifier?: string; createdAt: number }>();

export function oauthConfigured(network: SocialNetwork): boolean {
  const app = OAUTH_APPS[network];
  return Boolean(process.env[app.clientIdEnv] && process.env[app.clientSecretEnv] && process.env.SOCIAL_HUB_PUBLIC_URL);
}
const redirectUri = () => `${process.env.SOCIAL_HUB_PUBLIC_URL!.replace(/\/$/, "")}/api/social-hub/oauth/callback`;

export function buildAuthUrl(network: SocialNetwork): string {
  const app = OAUTH_APPS[network];
  if (!oauthConfigured(network)) throw new Error(`Falta configurar ${app.clientIdEnv}, ${app.clientSecretEnv} o SOCIAL_HUB_PUBLIC_URL.`);
  for (const [k, v] of Array.from(pending)) if (Date.now() - v.createdAt > 15 * 60_000) pending.delete(k);
  const state = randomBytes(16).toString("hex");
  const params = new URLSearchParams({
    [app.clientKeyName ?? "client_id"]: process.env[app.clientIdEnv]!,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: app.scopes.join(app.scopeSep ?? " "),
    state,
    ...(app.extraAuth ?? {}),
  });
  let verifier: string | undefined;
  if (app.pkce) {
    verifier = randomBytes(32).toString("base64url");
    params.set("code_challenge", createHash("sha256").update(verifier).digest("base64url"));
    params.set("code_challenge_method", "S256");
  }
  pending.set(state, { network, verifier, createdAt: Date.now() });
  return `${app.authUrl}?${params}`;
}

async function exchange(network: SocialNetwork, body: Record<string, string>, f: FetchLike): Promise<any> {
  const app = OAUTH_APPS[network];
  const id = process.env[app.clientIdEnv]!;
  const secret = process.env[app.clientSecretEnv]!;
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "blackops-social-hub/1.0" };
  const params: Record<string, string> = { ...body };
  if (app.basicAuth) headers.Authorization = `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
  else Object.assign(params, { [app.clientKeyName ?? "client_id"]: id, client_secret: secret });
  if (app.basicAuth && network === "x") params.client_id = id;
  const res = await f(app.tokenUrl, { method: "POST", headers, body: new URLSearchParams(params) });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(`${network}: no se pudo obtener el token (${json.error_description ?? json.error?.message ?? json.error ?? res.status})`);
  return json;
}

const expiry = (seconds?: number) => (seconds ? new Date(Date.now() + seconds * 1000).toISOString() : undefined);

/** Finishes the login and returns every account it unlocked (a Meta login can unlock several pages + IG). */
export async function completeOAuth(state: string, code: string, f: FetchLike = fetch): Promise<StoredToken[]> {
  const p = pending.get(state);
  if (!p) throw new Error("La sesión de conexión expiró. Vuelve a darle a Conectar.");
  pending.delete(state);
  const tok = await exchange(p.network, { grant_type: "authorization_code", code, redirect_uri: redirectUri(), ...(p.verifier ? { code_verifier: p.verifier } : {}) }, f);
  const now = new Date().toISOString();
  const base = { connectedAt: now, refreshToken: tok.refresh_token, expiresAt: expiry(tok.expires_in) };
  const auth = { Authorization: `Bearer ${tok.access_token}` };
  const rows: StoredToken[] = [];

  if (p.network === "facebook" || p.network === "instagram") {
    // Long-lived user token → page tokens (never expire) → linked IG accounts.
    const app = OAUTH_APPS.facebook;
    const ll: any = await (await f(`https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${process.env[app.clientIdEnv]}&client_secret=${process.env[app.clientSecretEnv]}&fb_exchange_token=${tok.access_token}`)).json();
    const userToken = ll.access_token ?? tok.access_token;
    const pages: any = await (await f(`https://graph.facebook.com/v21.0/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&limit=100&access_token=${userToken}`)).json();
    for (const pg of pages.data ?? []) {
      rows.push({ network: "facebook", accountId: pg.id, label: pg.name, accessToken: pg.access_token, connectedAt: now });
      const ig = pg.instagram_business_account;
      if (ig) rows.push({ network: "instagram", accountId: ig.id, label: `@${ig.username}`, accessToken: pg.access_token, connectedAt: now });
    }
  } else if (p.network === "threads") {
    const app = OAUTH_APPS.threads;
    const ll: any = await (await f(`https://graph.threads.net/access_token?grant_type=th_exchange_token&client_secret=${process.env[app.clientSecretEnv]}&access_token=${tok.access_token}`)).json();
    const token = ll.access_token ?? tok.access_token;
    const me: any = await (await f(`https://graph.threads.net/v1.0/me?fields=id,username&access_token=${token}`)).json();
    rows.push({ network: "threads", accountId: me.id, label: `@${me.username}`, accessToken: token, connectedAt: now, expiresAt: expiry(ll.expires_in) });
  } else if (p.network === "tiktok") {
    const me: any = await (await f("https://open.tiktokapis.com/v2/user/info/?fields=open_id,username,display_name", { headers: auth })).json();
    const u = me.data?.user ?? {};
    rows.push({ network: "tiktok", accountId: u.username ?? tok.open_id, label: `@${u.username ?? u.display_name}`, accessToken: tok.access_token, ...base });
  } else if (p.network === "youtube") {
    const me: any = await (await f("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", { headers: auth })).json();
    for (const ch of me.items ?? []) rows.push({ network: "youtube", accountId: ch.id, label: ch.snippet?.customUrl ?? ch.snippet?.title, accessToken: tok.access_token, ...base });
  } else if (p.network === "x") {
    const me: any = await (await f("https://api.x.com/2/users/me", { headers: auth })).json();
    rows.push({ network: "x", accountId: me.data?.id, label: `@${me.data?.username}`, accessToken: tok.access_token, ...base });
  } else if (p.network === "linkedin") {
    const orgs: any = await (await f("https://api.linkedin.com/rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR", { headers: { ...auth, "LinkedIn-Version": "202410", "X-Restli-Protocol-Version": "2.0.0" } })).json();
    for (const o of orgs.elements ?? []) rows.push({ network: "linkedin", accountId: o.organization, label: o.organization, accessToken: tok.access_token, ...base });
  } else if (p.network === "reddit") {
    const me: any = await (await f("https://oauth.reddit.com/api/v1/me", { headers: { ...auth, "User-Agent": "blackops-social-hub/1.0" } })).json();
    rows.push({ network: "reddit", accountId: me.name, label: `u/${me.name}`, accessToken: tok.access_token, ...base });
  }
  if (!rows.length) throw new Error(`${p.network}: el login funcionó pero no encontré cuentas que administres.`);
  upsertTokens(rows);
  return rows;
}

async function refreshIfNeeded(t: StoredToken, f: FetchLike): Promise<StoredToken> {
  if (!t.expiresAt || !t.refreshToken || Date.parse(t.expiresAt) - Date.now() > 5 * 60_000) return t;
  const tok = await exchange(t.network, { grant_type: "refresh_token", refresh_token: t.refreshToken }, f);
  const fresh = { ...t, accessToken: tok.access_token, refreshToken: tok.refresh_token ?? t.refreshToken, expiresAt: expiry(tok.expires_in) };
  upsertTokens([fresh]);
  return fresh;
}

/** OAuth tokens first; falls back to env tokens. TikTok/IG imported handles also match by label. */
export function oauthCredentialStore(fallback: SocialCredentialStore, f: FetchLike = fetch): SocialCredentialStore {
  return {
    async get(network, accountId): Promise<SocialAccountCredential | null> {
      let list: StoredToken[] = [];
      try { list = loadTokens(); } catch { list = []; }
      const t = list.find((x) => x.network === network && (x.accountId === accountId || x.label.replace(/^[@u/]+/, "") === accountId.replace(/^@/, "")));
      if (t) {
        const fresh = await refreshIfNeeded(t, f);
        return { network, accountId: fresh.accountId, accessToken: fresh.accessToken };
      }
      return fallback.get(network, accountId);
    },
  };
}
