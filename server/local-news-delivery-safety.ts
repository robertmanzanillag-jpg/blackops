import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const destination = z.object({
  blogId: z.string().min(1),
  identityVerified: z.literal(true),
  permissionVerifiedUntil: z.string().datetime(),
  networkAccounts: z.object({ facebook: z.string().min(1).optional(), x: z.string().min(1).optional() }).default({}),
});
const policySchema = z.object({
  paused: z.boolean(),
  reason: z.string(),
  destinations: z.record(z.string(), destination),
});
export type LocalNewsDeliveryPolicy = z.infer<typeof policySchema>;
export type NewsPolicyReader = () => Promise<LocalNewsDeliveryPolicy>;

/** Deployment-wide safety floor. Never accepts HTTP body/env overrides.
 * The committed pause survives restart/new instances. Missing/invalid policy
 * fails closed. No unpause API is provided in this safety release.
 */
export async function readLocalNewsDeliveryPolicy(): Promise<LocalNewsDeliveryPolicy> {
  try {
    return policySchema.parse(JSON.parse(await readFile(path.resolve("config/local-news-delivery-policy.json"), "utf8")));
  } catch {
    return { paused: true, reason: "delivery_policy_missing_or_invalid", destinations: {} };
  }
}

const trackingParameter = /^(utm_.+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid)$/i;
export function canonicalNewsArticleUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) if (trackingParameter.test(key)) url.searchParams.delete(key);
    // Preserve article selectors such as Mduid_news, id, page and arbitrary
    // non-tracking parameters. Never collapse different articles on one path.
    url.searchParams.sort();
    return url.toString();
  } catch { return null; }
}
export function newsArticleIdentity(sourceUrl: string): string | null {
  const canonical = canonicalNewsArticleUrl(sourceUrl);
  return canonical ? createHash("sha256").update(canonical).digest("hex") : null;
}

export function destinationIdentityVerified(
  policy: LocalNewsDeliveryPolicy, lane: string, blogId: string, at: Date,
): boolean {
  const target = policy.destinations[lane];
  return Boolean(target && target.blogId === blogId && target.identityVerified
    && Date.parse(target.permissionVerifiedUntil) > at.getTime());
}

export function destinationNetworkVerified(policy: LocalNewsDeliveryPolicy, lane: string, platform: "facebook" | "x", observedAccount: string | null): boolean {
  const expected = policy.destinations[lane]?.networkAccounts?.[platform];
  return Boolean(expected && observedAccount && expected === observedAccount);
}

/** Explicit official connector + host + city. A missing source is not evidence. */
export function newsSourceMatchesCity(item: { lane: string; source?: string; sourceUrl?: string; evidence?: string[] }): boolean {
  if (!item.source?.trim() || item.source === "public-feed" || !item.sourceUrl) return false;
  const connector = item.evidence?.find(x => x.startsWith("connector="))?.slice(10);
  const connectors: Record<string, [string, string[]]> = {
    "miami-dade-news": ["miami-news", ["miamidade.gov"]],
    "mia-airport-news": ["miami-news", ["miami-airport.com"]],
    "fbi-miami": ["miami-news", ["fbi.gov"]],
    "fbi-ny": ["ny-news", ["fbi.gov"]],
    "doj-sdfl": ["miami-news", ["justice.gov"]],
    "doj-sdny": ["ny-news", ["justice.gov"]],
    "nws-miami": ["miami-news", ["weather.gov"]],
    "nws-nyc": ["ny-news", ["weather.gov"]],
    "notify-nyc": ["ny-news", ["nyc.gov", "notify.nyc", "everbridge.net"]],
    "ny511": ["ny-news", ["511ny.org"]],
    "fl511": ["miami-news", ["fl511.com"]],
  };
  const rule = connector && connectors[connector];
  if (!rule || rule[0] !== item.lane) return false;
  try {
    const host = new URL(item.sourceUrl).hostname;
    return rule[1].some(expected => host === expected || host.endsWith(`.${expected}`));
  } catch { return false; }
}
