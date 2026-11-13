import { hasRealValue } from "../server/ceo-doctor-cli";

const DEFAULT_BASE_URL = "https://robplanner.replit.app";
const TIKTOK_VERIFICATION_FILE = "tiktokxXFfBZAFcOIGUKNMLUhs8E9M66NBKXCP.txt";

type Check = {
  label: string;
  path: string;
  requiredText?: string;
};

const checks: Check[] = [
  {
    label: "TikTok URL verification file",
    path: `/${TIKTOK_VERIFICATION_FILE}`,
    requiredText: "tiktok-developers-site-verification=xXFfBZAFcOIGUKNMLUhs8E9M66NBKXCP",
  },
  {
    label: "Privacy Policy",
    path: "/clippers/legal/privacy",
    requiredText: "Clippers Privacy Policy",
  },
  {
    label: "Terms of Service",
    path: "/clippers/legal/terms",
    requiredText: "Clippers Terms of Service",
  },
  {
    label: "App Review Demo",
    path: "/clippers/review-demo",
    requiredText: "Clippers App Review Demo",
  },
  {
    label: "TikTok OAuth callback",
    path: "/api/clippers/oauth/tiktok/callback",
    requiredText: "Callback recibido sin authorization code",
  },
];

function normalizeBaseUrl(raw: string | undefined) {
  const configuredBaseUrl = raw ?? process.env.PUBLIC_BASE_URL;
  if (configuredBaseUrl !== undefined && !hasRealValue(configuredBaseUrl)) {
    throw new Error("Base URL must be a real public HTTPS URL, not a placeholder.");
  }

  const baseUrl = (configuredBaseUrl || DEFAULT_BASE_URL).trim().replace(/\/$/, "");
  if (!/^https:\/\/[^/]+/i.test(baseUrl)) {
    throw new Error(`Base URL must be public HTTPS. Received: ${baseUrl}`);
  }
  return baseUrl;
}

async function runCheck(baseUrl: string, check: Check) {
  const url = `${baseUrl}${check.path}`;
  try {
    const response = await fetch(url, { redirect: "manual" });
    const body = await response.text().catch(() => "");
    const okStatus = response.status >= 200 && response.status < 400;
    const okText = check.requiredText ? body.includes(check.requiredText) : true;
    return {
      ...check,
      url,
      status: response.status,
      ok: okStatus && okText,
      reason: !okStatus
        ? `HTTP ${response.status}`
        : !okText
          ? `Missing expected text: ${check.requiredText}`
          : "ok",
    };
  } catch (error) {
    return {
      ...check,
      url,
      status: 0,
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main() {
  const baseUrl = normalizeBaseUrl(process.argv[2]);
  const results = await Promise.all(checks.map((check) => runCheck(baseUrl, check)));
  const failed = results.filter((result) => !result.ok);

  console.log(`Clippers TikTok preflight: ${baseUrl}`);
  for (const result of results) {
    console.log(`${result.ok ? "OK" : "FAIL"} ${result.label} ${result.status} ${result.url}`);
    if (!result.ok) console.log(`  ${result.reason}`);
  }

  if (failed.length > 0) {
    process.exitCode = 1;
    console.log(`\n${failed.length} check(s) failed. Fix deploy/domain before clicking Verify in TikTok.`);
    return;
  }

  console.log("\nAll TikTok public URL checks passed. You can verify URL properties in TikTok.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
