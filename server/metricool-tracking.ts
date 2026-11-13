export type MetricoolNetwork =
  | "tiktok"
  | "instagram"
  | "youtube"
  | "pinterest"
  | "facebook"
  | "twitter"
  | "linkedin";

export type MetricoolBrandPlan = {
  id: string;
  name: string;
  ownerAgent: string;
  status: "ready_to_connect" | "draft_only" | "optional";
  networks: MetricoolNetwork[];
  notes: string;
};

export type MetricoolTrackingPlan = {
  brands: MetricoolBrandPlan[];
  brandCount: number;
  socialProfileCount: number;
  networks: Record<MetricoolNetwork, number>;
  recommendedPlan: "free" | "starter_10_brands" | "advanced_15_brands";
  directPlatformApisNeeded: boolean;
  optionalDirectPlatformApis: string[];
  setupActions: string[];
};

export type MetricoolConfigStatus = {
  userTokenConfigured: boolean;
  userIdConfigured: boolean;
  mcpUrl: string;
  readyForMcp: boolean;
  missingEnv: string[];
};

const PLACEHOLDER_PATTERN = /^(replace|paste|your-|<|\s*$)/i;

export const METRICOOL_MCP_URL = "https://ai.metricool.com/mcp";

export const METRICOOL_BRAND_PLAN: MetricoolBrandPlan[] = [
  {
    id: "black-room",
    name: "Black Room (Fiesta + Radio)",
    ownerAgent: "Black Room / Radio",
    status: "ready_to_connect",
    networks: ["instagram", "tiktok"],
    notes: "One shared brand for parties, radio, flyers, promo videos, event links, stories, and recaps.",
  },
  {
    id: "dropshipping",
    name: "Dropshipping 1",
    ownerAgent: "Dropshipping CEO",
    status: "ready_to_connect",
    networks: ["tiktok", "instagram", "youtube", "pinterest"],
    notes: "Tracks organic validation, UTM/SmartLink clicks, Shopify revenue, and product learning.",
  },
  {
    id: "dropshipping-2",
    name: "Dropshipping 2",
    ownerAgent: "Dropshipping CEO",
    status: "ready_to_connect",
    networks: ["tiktok", "instagram", "youtube", "pinterest"],
    notes: "Second dropshipping brand/account for testing a separate niche, offer, or angle without mixing analytics.",
  },
  {
    id: "kong",
    name: "Kong",
    ownerAgent: "KONG AI",
    status: "draft_only",
    networks: ["instagram"],
    notes: "Metricool only covers public social tracking; WhatsApp, email, and venue ops stay outside Metricool.",
  },
  {
    id: "sports-daily",
    name: "Sports Daily Clips",
    ownerAgent: "Clippers",
    status: "ready_to_connect",
    networks: ["tiktok", "instagram", "youtube"],
    notes: "Clip account for sports content with rights/approval gates before publishing.",
  },
  {
    id: "meme-radar",
    name: "Meme Radar",
    ownerAgent: "Clippers",
    status: "ready_to_connect",
    networks: ["tiktok", "instagram", "youtube"],
    notes: "Code prepares YouTube too; keep it disconnected if the launch decision remains TikTok + Instagram only.",
  },
  {
    id: "streamer-pulse",
    name: "Streamer Pulse",
    ownerAgent: "Clippers",
    status: "ready_to_connect",
    networks: ["tiktok", "instagram", "youtube"],
    notes: "Clip account for streamer content with source allowlist and creator permission checks.",
  },
  {
    id: "winner-account-1",
    name: "Miami News",
    ownerAgent: "Clippers",
    status: "ready_to_connect",
    networks: ["facebook", "twitter"],
    notes: "Local Miami news brand for Facebook and X/Twitter publishing through Metricool after connection and approval gates are ready.",
  },
  {
    id: "winner-account-2",
    name: "NY News",
    ownerAgent: "Clippers",
    status: "ready_to_connect",
    networks: ["facebook", "twitter"],
    notes: "Local New York news brand for Facebook and X/Twitter publishing through Metricool after connection and approval gates are ready.",
  },
  {
    id: "winner-account-3",
    name: "Winner Account 3",
    ownerAgent: "Marketing Command Center",
    status: "optional",
    networks: ["tiktok", "instagram", "youtube"],
    notes: "Reserved for the third winner so the 10-brand Metricool plan can scale into the best performers.",
  },
];

function hasRealValue(value: string | undefined): boolean {
  return Boolean(value && !PLACEHOLDER_PATTERN.test(value.trim()));
}

function emptyNetworkCounts(): Record<MetricoolNetwork, number> {
  return {
    tiktok: 0,
    instagram: 0,
    youtube: 0,
    pinterest: 0,
    facebook: 0,
    twitter: 0,
    linkedin: 0,
  };
}

export function getMetricoolConfigStatus(env: NodeJS.ProcessEnv = process.env): MetricoolConfigStatus {
  const missingEnv = [
    !hasRealValue(env.METRICOOL_USER_TOKEN) && "METRICOOL_USER_TOKEN",
    !hasRealValue(env.METRICOOL_USER_ID) && "METRICOOL_USER_ID",
  ].filter(Boolean) as string[];

  return {
    userTokenConfigured: hasRealValue(env.METRICOOL_USER_TOKEN),
    userIdConfigured: hasRealValue(env.METRICOOL_USER_ID),
    mcpUrl: hasRealValue(env.METRICOOL_MCP_URL) ? env.METRICOOL_MCP_URL! : METRICOOL_MCP_URL,
    readyForMcp: missingEnv.length === 0,
    missingEnv,
  };
}

export function getMetricoolTrackingPlan(brands = METRICOOL_BRAND_PLAN): MetricoolTrackingPlan {
  const networks = emptyNetworkCounts();
  for (const brand of brands) {
    for (const network of brand.networks) networks[network] += 1;
  }

  const brandCount = brands.length;
  const socialProfileCount = Object.values(networks).reduce((sum, count) => sum + count, 0);
  const recommendedPlan =
    brandCount <= 1 ? "free" : brandCount <= 10 ? "starter_10_brands" : "advanced_15_brands";

  return {
    brands,
    brandCount,
    socialProfileCount,
    networks,
    recommendedPlan,
    directPlatformApisNeeded: false,
    optionalDirectPlatformApis: [
      "TikTok/Meta/YouTube developer APIs only if Metricool cannot support a required publishing or analytics workflow.",
      "Shopify API remains needed for revenue, orders, add-to-cart, product drafts, and profit tracking.",
      "Google Drive/Canva APIs remain useful for asset production before content is scheduled.",
    ],
    setupActions: [
      "Create the Metricool account and plan with at least 10 brands.",
      "Create one Metricool brand per business/content brand listed in this plan.",
      "Keep Winner Account 3 reserved until performance data decides its exact niche.",
      "Connect each social profile inside its matching Metricool brand.",
      "Add METRICOOL_USER_TOKEN and METRICOOL_USER_ID only through local secrets or deployment secret manager.",
      "Run the Metricool MCP health check before enabling automatic scheduling.",
    ],
  };
}

export function buildMetricoolMcpClientConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    mcpServers: {
      "mcp-metricool": {
        command: "uvx",
        args: ["--upgrade", "mcp-metricool"],
        env: {
          METRICOOL_USER_TOKEN: hasRealValue(env.METRICOOL_USER_TOKEN) ? "<configured>" : "<METRICOOL_USER_TOKEN>",
          METRICOOL_USER_ID: hasRealValue(env.METRICOOL_USER_ID) ? "<configured>" : "<METRICOOL_USER_ID>",
        },
      },
    },
  };
}
