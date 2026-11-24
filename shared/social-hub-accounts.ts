// Accounts imported from Metricool (2026-11-24). Tokens are NOT here: each account must be
// connected once via the network's OAuth and its token stored in the env var named in tokenEnv.
import type { SocialNetwork } from "./social-hub";

export interface SocialHubAccount {
  brand: string;
  metricoolBlogId: number;
  network: SocialNetwork;
  /** Page id / channel id / handle as Metricool reports it. IG publishing needs the numeric IG user id (resolved on connect). */
  accountId: string;
  handle?: string;
  tokenEnv: string;
}

export const METRICOOL_IMPORTED_ACCOUNTS: SocialHubAccount[] = [
  { brand: "memes", metricoolBlogId: 6431685, network: "tiktok", accountId: "streamersus", handle: "@streamersus", tokenEnv: "SH_TIKTOK_STREAMERSUS" },
  { brand: "sport", metricoolBlogId: 6431687, network: "tiktok", accountId: "streamersclipusa", handle: "@streamersclipusa", tokenEnv: "SH_TIKTOK_STREAMERSCLIPUSA" },
  { brand: "kong", metricoolBlogId: 6431692, network: "tiktok", accountId: "kongnightlife", handle: "@kongnightlife", tokenEnv: "SH_TIKTOK_KONGNIGHTLIFE" },
  { brand: "kong", metricoolBlogId: 6475033, network: "facebook", accountId: "1251688224688420", tokenEnv: "SH_FB_KONG" },
  { brand: "kong", metricoolBlogId: 6475033, network: "instagram", accountId: "kong.app", handle: "@kong.app", tokenEnv: "SH_IG_KONG" },
  { brand: "blackroom", metricoolBlogId: 6585226, network: "facebook", accountId: "1290355464151585", tokenEnv: "SH_FB_BLACKROOM" },
  { brand: "blackroom", metricoolBlogId: 6585226, network: "tiktok", accountId: "blackroom.clipss", handle: "@blackroom.clipss", tokenEnv: "SH_TIKTOK_BLACKROOM" },
  { brand: "blackroom", metricoolBlogId: 6585226, network: "youtube", accountId: "UCi__qHBfHLlYg0fu86BUA8g", handle: "@blackroom_us", tokenEnv: "SH_YT_BLACKROOM" },
  { brand: "miami-news", metricoolBlogId: 6591612, network: "facebook", accountId: "1193011863901514", tokenEnv: "SH_FB_MIAMI_NEWS" },
  { brand: "miami-news", metricoolBlogId: 6591612, network: "tiktok", accountId: "news305miami", handle: "@news305miami", tokenEnv: "SH_TIKTOK_NEWS305MIAMI" },
  { brand: "ny-news", metricoolBlogId: 6595747, network: "facebook", accountId: "1198281286708321", tokenEnv: "SH_FB_NY_NEWS" },
];
