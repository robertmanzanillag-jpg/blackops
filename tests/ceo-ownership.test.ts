import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";
import { registerRoutes } from "../server/routes";

test("project health alerts are scoped to the project owner", () => {
  const source = readFileSync("server/health-check.ts", "utf8");

  assert.doesNotMatch(source, /sendNotificationToAll/, "health alerts should not broadcast to every push subscriber");
  assert.match(source, /storage\.getTelegramConfig\(project\.userId\)/, "health alerts should use the project owner's Telegram config");
  assert.match(source, /sendPushNotification\(project\.userId,/, "health alerts should push only to the project owner");
});

test("market updates process enabled Telegram users instead of one global user", () => {
  const source = readFileSync("server/market-news.ts", "utf8");

  assert.doesNotMatch(source, /getSystemUserId/, "market updates should not use a global system user");
  assert.match(source, /storage\.getEnabledTelegramConfigs\(\)/, "market updates should discover enabled Telegram users");
  assert.match(source, /sendDailyMarketUpdateForUser\(userId\)/, "market updates should run per owner user id");
  assert.match(source, /storage\.getInvestments\(userId\)/, "portfolio summary should read investments for the owner user id");
});

test("Zoho calendar sync imports events into the authenticated owner account", () => {
  const zohoSource = readFileSync("server/zoho-calendar.ts", "utf8");
  const routesSource = readFileSync("server/routes.ts", "utf8");

  assert.doesNotMatch(zohoSource, /getSystemUserId/, "Zoho sync should not use a global system user");
  assert.match(zohoSource, /syncZohoCalendar\(userId: string\)/, "Zoho sync should require an explicit user id");
  assert.match(zohoSource, /storage\.getTasks\(userId\)/, "Zoho sync should search existing tasks for the owner user id");
  assert.match(zohoSource, /storage\.createTask\(userId, taskData\)/, "Zoho sync should create tasks for the owner user id");
  assert.match(routesSource, /syncZohoCalendar\(getCurrentUserId\(req\)\)/, "Zoho sync route should pass the authenticated user id");
});

test("Telegram webhook does not auto-bind unknown chats to the system user", () => {
  const telegramSource = readFileSync("server/telegram-chat.ts", "utf8");

  assert.doesNotMatch(telegramSource, /getSystemUserId/, "Telegram chat handler should not bind unknown chats to DEFAULT_USER_ID");
  assert.match(telegramSource, /storage\.getTelegramConfigByChatId\(chatId\)/, "Telegram chat handler should resolve owner from existing chat mapping");
  assert.match(telegramSource, /if \(!config\) \{[\s\S]*todavía no está vinculado[\s\S]*telegram:configure[\s\S]*return;/, "unknown Telegram chats should receive linking instructions and stop");
});

test("Telegram config route binds chats to the authenticated owner only", () => {
  const routesSource = readFileSync("server/telegram-routes.ts", "utf8");

  assert.match(routesSource, /const chatId = String\(req\.body\?\.chatId \|\| ""\)\.trim\(\)/, "Telegram config API should require an explicit chat ID");
  assert.match(routesSource, /storage\.saveTelegramConfig\(getCurrentUserId\(req\), chatId\)/, "manual Telegram config should save mapping for authenticated owner");
  assert.doesNotMatch(routesSource, /getTelegramUpdates/, "Telegram config API should not auto-bind the latest bot update to the authenticated owner");
  assert.doesNotMatch(routesSource, /saveTelegramConfig\(getSystemUserId\(\)/, "Telegram config routes should not bind chat IDs to the system user");
});

test("startup task dedupe runs for discovered owners instead of one system user", () => {
  const indexSource = readFileSync("server/index.ts", "utf8");

  assert.match(indexSource, /getStartupMaintenanceUserIds\(\)/, "startup should resolve maintenance owners through a helper");
  assert.match(indexSource, /storage\.getEnabledTelegramConfigs\(\)/, "startup dedupe should discover enabled Telegram owners");
  assert.match(indexSource, /userIds\.map\(async \(userId\)/, "startup dedupe should iterate over all discovered owners");
  assert.match(indexSource, /storage\.deduplicateRecurringTasks\(userId\)/, "weekly task dedupe should run for each discovered owner");
  assert.match(indexSource, /storage\.deduplicateMainTasks\(userId\)/, "main task dedupe should run for each discovered owner");
  assert.doesNotMatch(indexSource, /deduplicate(?:Recurring|Main)Tasks\(getSystemUserId\(\)\)/, "startup dedupe should not target only DEFAULT_USER_ID");
});

test("promo video daily scheduler uploads under discovered owners", () => {
  const promoSource = readFileSync("server/promo-video-agent.ts", "utf8");

  assert.match(promoSource, /getPromoVideoSchedulerUserIds\(\)/, "promo scheduler should resolve owners through a helper");
  assert.match(promoSource, /storage\.getEnabledTelegramConfigs\(\)/, "promo scheduler should discover enabled Telegram owners");
  assert.match(promoSource, /runPromoVideoAutoDaily\(\{[^}]*userId/s, "promo scheduler should pass an explicit user id to auto daily runs");
  assert.doesNotMatch(promoSource, /runPromoVideoAutoDaily\(\{ maxVideos: 5, targetSeconds: 15, cuts: 3, style: "full" \}\)/, "promo scheduler should not run auto daily without an owner");
});

test("promo video local workspace routes are scoped to the authenticated owner", () => {
  const routesSource = readFileSync("server/routes.ts", "utf8");
  const promoSource = readFileSync("server/promo-video-agent.ts", "utf8");
  const scriptSource = readFileSync("scripts/edit-promo-videos.sh", "utf8");

  assert.match(routesSource, /getPromoVideoStatus\(getCurrentUserId\(req\)\)/, "promo status route should inspect only the authenticated owner's workspace");
  assert.match(routesSource, /setPromoVideoSourceDir\(req\.body\?\.sourceDir, getCurrentUserId\(req\)\)/, "promo source route should write source config for the authenticated owner");
  assert.match(routesSource, /importPromoVideosFromSource\(req\.body \|\| \{\}, getCurrentUserId\(req\)\)/, "promo import route should copy files into the authenticated owner's workspace");
  assert.match(routesSource, /deletePromoOutputVideo\(req\.params\.filename, getCurrentUserId\(req\)\)/, "promo delete route should delete only from the authenticated owner's output workspace");

  assert.match(promoSource, /const USERS_DIR = path\.join\(ROOT_DIR, "users"\)/, "promo workspaces should live under per-user local folders");
  assert.match(promoSource, /function getPromoVideoWorkspacePaths\(userId = getSystemUserId\(\)\)/, "promo agent should resolve local workspace paths by user id");
  assert.match(promoSource, /const rootDir = path\.join\(USERS_DIR, safeUserId\)/, "promo workspace root should include the sanitized user id");
  assert.match(promoSource, /PROMO_OUTPUT_DIR: paths\.outputDir/, "promo edit subprocess should write outputs to the owner workspace");
  assert.match(scriptSource, /OUTPUT_DIR="\$\{PROMO_OUTPUT_DIR:-\$ROOT_DIR\/promo_video_edits\/03_listos_para_subir\}"/, "promo edit script should accept an owner-scoped output directory override");
});

test("Revenue Engine routes scope durable state to the authenticated user", () => {
  const routesSource = readFileSync("server/routes.ts", "utf8");
  const revenueSource = readFileSync("server/revenue-engine.ts", "utf8");

  assert.match(routesSource, /app\.use\("\/api\/revenue-engine"/, "Revenue Engine should have a route-level owner scope");
  assert.match(routesSource, /prepareRevenueEngineState\(getCurrentUserId\(req\)\)/, "Revenue Engine routes should hydrate data for the authenticated user");
  assert.match(routesSource, /let revenueEngineRouteQueue = Promise\.resolve\(\)/, "Revenue Engine routes should serialize access while module state is in-memory");
  assert.match(routesSource, /res\.once\("finish", release\)/, "Revenue Engine route queue should release after the response finishes");
  assert.doesNotMatch(routesSource, /Revenue Engine is limited to the configured single-user owner/, "Revenue Engine should not reject non-owner users now that local JSON is scoped");
  assert.match(revenueSource, /revenue_engine_data", "users", safeRevenueUserId\(userId\)/, "Revenue Engine JSON paths should include a sanitized user id");
  assert.match(revenueSource, /createHash\("sha256"\)\.update\(canonical\)/, "Revenue Engine durable owner keys should avoid sanitized-path collisions");
});

test("developer code and GitHub tools are gated to the configured single-user owner", () => {
  const routesSource = readFileSync("server/routes.ts", "utf8");

  assert.match(routesSource, /app\.use\(\["\/api\/code", "\/api\/github"\]/, "developer tools should have a shared route guard");
  assert.match(routesSource, /const userId = getCurrentUserId\(req\);[\s\S]*const toolOwnerUserId = getSystemUserId\(\);/s, "developer tool guard should compare authenticated user to configured owner");
  assert.match(routesSource, /if \(userId !== toolOwnerUserId\) \{[\s\S]*res\.status\(403\)/s, "developer tools should reject non-owner users");
  assert.match(routesSource, /per-user repo and filesystem permissions/, "developer tool rejection should explain the missing permission model");
  assert.match(routesSource, /app\.use\(\["\/api\/projects\/github-overview", "\/api\/projects\/import-github"\]/, "project routes backed by the shared GitHub connector should have an owner guard");
  assert.match(routesSource, /const githubProjectOwnerUserId = getSystemUserId\(\);/, "shared GitHub project routes should resolve the configured owner");
  assert.match(routesSource, /if \(userId !== githubProjectOwnerUserId\) \{[\s\S]*res\.status\(403\)/s, "shared GitHub project routes should reject non-owner users");
});

test("Shopify connection routes are gated to the configured single-user owner", () => {
  const shopifyRoutesSource = readFileSync("server/shopify-routes.ts", "utf8");

  assert.match(shopifyRoutesSource, /app\.use\("\/api\/shopify"/, "the first registered Shopify router should have an owner guard");
  assert.match(shopifyRoutesSource, /const userId = getCurrentUserId\(req\);/, "Shopify guard should use the authenticated user");
  assert.match(shopifyRoutesSource, /const shopifyOwnerUserId = getSystemUserId\(\);/, "Shopify guard should resolve the configured owner");
  assert.match(shopifyRoutesSource, /if \(userId !== shopifyOwnerUserId\) \{[\s\S]*res\.status\(403\)/s, "Shopify guard should reject non-owner users before OAuth token writes");
  assert.match(shopifyRoutesSource, /store token is shared/, "Shopify rejection should explain the shared credential boundary");
});

test("shared GitHub and Shopify connector routes reject authenticated non-owners at runtime", async () => {
  const previousDefaultUserId = process.env.DEFAULT_USER_ID;
  process.env.DEFAULT_USER_ID = "connector-owner";

  const app = express();
  app.use(express.json());
  // Supply an authenticated request fixture; dev headers are not authentication.
  app.use((req, _res, next) => {
    (req as typeof req & { user: { id: string } }).user = { id: "authenticated-non-owner" };
    next();
  });
  const server = createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const requests = [
      ["GET", "/api/projects/github-overview"],
      ["POST", "/api/projects/import-github"],
      ["GET", "/api/shopify/install?shop=test.myshopify.com"],
      ["GET", "/api/shopify/oauth/start?shop=test.myshopify.com"],
      ["GET", "/api/shopify/oauth/callback?code=test&state=test&shop=test.myshopify.com"],
    ] as const;

    for (const [method, route] of requests) {
      const response = await fetch(`${baseUrl}${route}`, {
        method,
        headers: { "content-type": "application/json" },
      });
      assert.equal(response.status, 403, `${method} ${route} should reject a non-owner`);
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    if (previousDefaultUserId === undefined) delete process.env.DEFAULT_USER_ID;
    else process.env.DEFAULT_USER_ID = previousDefaultUserId;
  }
});

test("Clippers API is gated to the configured single-user owner while local artifacts are shared", () => {
  const routesSource = readFileSync("server/routes.ts", "utf8");

  assert.match(routesSource, /app\.use\("\/api\/clippers"/, "Clippers API should have a shared route guard");
  assert.doesNotMatch(routesSource, /app\.use\("\/api\/clippers"[\s\S]*if \(isPublicApiRequest\(req\)\) return next\(\);/s, "Clippers OAuth callbacks should not bypass the owner guard while tokens are stored in a shared vault");
  assert.match(routesSource, /const userId = getCurrentUserId\(req\);[\s\S]*const clipperOwnerUserId = getSystemUserId\(\);/s, "Clippers guard should compare authenticated user to configured owner");
  assert.match(routesSource, /if \(userId !== clipperOwnerUserId\) \{[\s\S]*res\.status\(403\)/s, "Clippers API should reject non-owner users while artifacts are shared");
  assert.match(routesSource, /local workspace, token vault, and launch artifacts are shared/, "Clippers rejection should explain the shared local artifact limitation");
});

test("shared Google integrations are gated to the configured single-user owner", () => {
  const routesSource = readFileSync("server/routes.ts", "utf8");

  assert.match(routesSource, /app\.use\(\["\/api\/calendar", "\/api\/google-drive"\]/, "shared Google APIs should have a route guard");
  assert.match(routesSource, /if \(isPublicApiRequest\(req\)\) return next\(\);/, "Google OAuth callbacks should bypass the owner guard after public callback classification");
  assert.match(routesSource, /const userId = getCurrentUserId\(req\);[\s\S]*const googleOwnerUserId = getSystemUserId\(\);/s, "Google guard should compare authenticated user to configured owner");
  assert.match(routesSource, /if \(userId !== googleOwnerUserId\) \{[\s\S]*res\.status\(403\)/s, "Google APIs should reject non-owner users while connectors are shared");
  assert.match(routesSource, /shared Google integrations are connected/, "Google rejection should explain the shared integration limitation");
});

test("Replit chat conversation routes are scoped to the authenticated owner", () => {
  const routesSource = readFileSync("server/replit_integrations/chat/routes.ts", "utf8");
  const storageSource = readFileSync("server/replit_integrations/chat/storage.ts", "utf8");

  assert.match(routesSource, /getAllConversations\(getCurrentUserId\(req\)\)/, "conversation list should read only the authenticated owner's conversations");
  assert.match(routesSource, /getConversation\(id, getCurrentUserId\(req\)\)/, "conversation detail should verify owner before returning messages");
  assert.match(routesSource, /createConversation\(title \|\| "New Chat", getCurrentUserId\(req\)\)/, "conversation creation should write owner-scoped records");
  assert.match(routesSource, /deleteConversation\(id, getCurrentUserId\(req\)\)/, "conversation delete should be owner-scoped");
  assert.match(routesSource, /getConversation\(conversationId, getCurrentUserId\(req\)\)/, "message send should verify conversation owner before mutating history");
  assert.match(storageSource, /ownerTitlePrefix\(userId: string\)/, "chat storage should have an owner marker for legacy conversation rows");
  assert.match(storageSource, /conversation\.title\.startsWith\(ownerTitlePrefix\(userId\)\)/, "chat storage should reject records outside the owner marker");
  assert.match(storageSource, /stripScopedConversationTitle/, "chat storage should hide the internal owner marker from clients");
});

test("Clippers OAuth callbacks and token vault records keep explicit owner metadata", () => {
  const routesSource = readFileSync("server/routes.ts", "utf8");
  const clippersSource = readFileSync("server/clippers-agent.ts", "utf8");

  assert.match(routesSource, /recordClipperOAuthCallback\(\{[\s\S]*\}, getCurrentUserId\(req\)\)/s, "Clippers OAuth callback should bind to the authenticated owner after the route guard");
  assert.match(clippersSource, /export interface ClipperOAuthConnection \{[\s\S]*ownerUserId: string;/s, "OAuth connection records should include owner metadata");
  assert.match(clippersSource, /export interface ClipperTokenSummary \{[\s\S]*ownerUserId: string;/s, "token vault summaries should include owner metadata");
  assert.match(clippersSource, /saveClipperTokenPayload\([\s\S]*ownerUserIdOrAccountId = getSystemUserId\(\)[\s\S]*accountId\?: string \| null/s, "token vault writes should accept an explicit owner and optional account");
  assert.match(clippersSource, /tryExchangeAndStoreClipperToken\([\s\S]*ownerUserId: string,[\s\S]*accountId\?: string \| null/s, "OAuth token exchange should carry owner metadata through storage");
});

test("public API classification keeps shared OAuth token writers behind owner auth", () => {
  const userContextSource = readFileSync("server/user-context.ts", "utf8");

  assert.doesNotMatch(userContextSource, /\/api\/shopify\/oauth\/callback/, "Shopify OAuth callback should require the owner session before writing the shared store token");
  assert.doesNotMatch(userContextSource, /\/api\/shopify\/oauth\/start/, "Shopify OAuth start should require the owner session before creating a shared token flow");
  assert.doesNotMatch(userContextSource, /\/api\/shopify\/install/, "Shopify install should require the owner session before creating a shared token flow");
  assert.doesNotMatch(userContextSource, /clippers\/oauth/, "Clippers OAuth callbacks should require the owner session before writing shared publisher tokens");
});

test("local auth mutations reject cross-site and non-json requests", () => {
  const localAuthSource = readFileSync("server/local-auth.ts", "utf8");

  assert.match(localAuthSource, /function requireSameOriginAuthRequest/, "local auth should have a same-origin guard");
  assert.match(localAuthSource, /sec-fetch-site/, "local auth should inspect browser fetch metadata");
  assert.match(localAuthSource, /sameOriginMatchesRequestHost/, "local auth should compare Origin to the request host or configured public origin");
  assert.match(localAuthSource, /function requireJsonAuthRequest/, "local auth should require JSON request bodies for credential submissions");
  assert.match(localAuthSource, /app\.post\("\/api\/auth\/register", requireSameOriginAuthRequest, requireJsonAuthRequest, localAuthRateLimit/, "registration should run origin and JSON guards before rate-limited auth");
  assert.match(localAuthSource, /app\.post\("\/api\/auth\/login", requireSameOriginAuthRequest, requireJsonAuthRequest, localAuthRateLimit/, "login should run origin and JSON guards before rate-limited auth");
  assert.match(localAuthSource, /app\.post\("\/api\/auth\/logout", requireSameOriginAuthRequest/, "logout should reject cross-site requests");
});

test("global request parsers keep unauthenticated bodies small", () => {
  const indexSource = readFileSync("server/index.ts", "utf8");

  assert.doesNotMatch(indexSource, /limit:\s*['"]50mb['"]/, "global JSON parser should not accept 50MB unauthenticated bodies");
  assert.match(indexSource, /limit:\s*['"]8mb['"]/, "global JSON parser should stay below the previous unauthenticated abuse ceiling");
  assert.match(indexSource, /express\.urlencoded\(\{ extended: false, limit: "64kb", parameterLimit: 100 \}\)/, "urlencoded parser should have an explicit small limit");
});

test("assistant shared connector commands are owner-only", () => {
  const assistantSource = readFileSync("server/assistant.ts", "utf8");
  const routesSource = readFileSync("server/routes.ts", "utf8");

  assert.match(assistantSource, /import \{ isConfiguredSingleUserOwner \} from "\.\/single-user-owner"/);
  assert.match(assistantSource, /await isConfiguredSingleUserOwner\(userId\)/);
  assert.match(assistantSource, /writeOwnerOnlySharedConnectorBlock/, "assistant should emit a clear block message for non-owner shared connector commands");
  assert.match(assistantSource, /if \(!isOwnerUser\) \{[\s\S]*YouTube, Google Drive y clips de radio/s, "radio YouTube command execution should be owner-only");
  assert.match(assistantSource, /if \(!isOwnerUser\) \{[\s\S]*Google Calendar/s, "calendar command execution should be owner-only");
  assert.match(assistantSource, /if \(!isOwnerUser\) \{[\s\S]*Google Drive/s, "Drive command execution should be owner-only");
  assert.match(routesSource, /Developer Autopilot GitHub handoffs are limited to the configured single-user owner/, "GitHub handoff route should be owner-only while GitHub connectors are shared");
});

test("public OAuth callback pages escape dynamic text and do not print tokens", () => {
  const routesSource = readFileSync("server/routes.ts", "utf8");

  assert.match(routesSource, /function escapeHtml\(value: unknown\): string/, "routes should define an HTML escaping helper for callback pages");
  assert.match(routesSource, /<p>\$\{escapeHtml\(errorDescription \|\| error\)\}<\/p>/, "OAuth provider error descriptions should be escaped before rendering");
  assert.match(routesSource, /Scopes: \$\{escapeHtml\(result\.scope \|\| "guardados"\)\}/, "OAuth scopes should be escaped before rendering");
  assert.match(routesSource, /escapeHtml\(connection\.note\)/, "Clippers OAuth callback notes should be escaped before rendering");
  assert.doesNotMatch(routesSource, /\$\{result\.refresh_token\}/, "Zoho callback page should not render the refresh token secret");
  assert.match(routesSource, /No se muestra en pantalla por seguridad/, "Zoho callback should explain that the refresh token is hidden");
});

test("manual notification test endpoints target the authenticated user only", () => {
  const routesSource = readFileSync("server/routes.ts", "utf8");
  const schedulerSource = readFileSync("server/reminder-scheduler.ts", "utf8");

  assert.doesNotMatch(routesSource, /sendNotificationToAll/, "manual push tests should not broadcast to every subscriber");
  assert.match(routesSource, /sendPushNotification\(getCurrentUserId\(req\),/, "manual push test should target the authenticated user");
  assert.match(routesSource, /testMorningReminder\(getCurrentUserId\(req\)\)/, "manual morning test should target the authenticated user");
  assert.match(routesSource, /testEveningReminder\(getCurrentUserId\(req\)\)/, "manual evening test should target the authenticated user");
  assert.match(routesSource, /testWeeklyReminder\(getCurrentUserId\(req\)\)/, "manual weekly test should target the authenticated user");
  assert.match(routesSource, /testProactiveInsights\(getCurrentUserId\(req\)\)/, "manual insights test should target the authenticated user");
  assert.match(routesSource, /testNewsDigest\(getCurrentUserId\(req\)\)/, "manual news test should target the authenticated user");

  assert.match(schedulerSource, /testMorningReminder\(userId\?: string\)/, "manual reminder helper should accept an explicit user id");
  assert.match(schedulerSource, /testProactiveInsights\(userId\?: string\)/, "manual insights helper should accept an explicit user id");
  assert.match(schedulerSource, /testNewsDigest\(userId\?: string\)/, "manual news helper should accept an explicit user id");
});

test("scheduled notification jobs discover Telegram and push owners", () => {
  const schedulerSource = readFileSync("server/reminder-scheduler.ts", "utf8");

  assert.match(schedulerSource, /getScheduledNotificationUserIds\(\)/, "scheduler should use a shared owner discovery helper");
  assert.match(schedulerSource, /storage\.getEnabledTelegramConfigs\(\)/, "scheduler should discover Telegram-enabled owners");
  assert.match(schedulerSource, /storage\.getAllPushSubscriptions\(\)/, "scheduler should discover push-notification owners");
  assert.match(schedulerSource, /\.\.\.telegramConfigs\.map\(\(config\) => config\.userId\)/, "scheduler should include Telegram owner ids");
  assert.match(schedulerSource, /\.\.\.pushSubscriptions\.map\(\(subscription\) => subscription\.userId\)/, "scheduler should include push subscription owner ids");
  assert.match(schedulerSource, /Array\.from\(new Set\(userIds\)\)/, "scheduler should deduplicate discovered owner ids");
  assert.doesNotMatch(schedulerSource, /getEnabledTelegramUserIds/, "scheduler should not rely on Telegram-only owner discovery");
});

test("portfolio routes read and send reports for the authenticated owner", () => {
  const routesSource = readFileSync("server/routes.ts", "utf8");

  assert.match(routesSource, /getPortfolioSummary\(getCurrentUserId\(req\)\)/, "portfolio summary should use authenticated user id");
  assert.match(routesSource, /getGainsByPeriod\(period, getCurrentUserId\(req\)\)/, "portfolio gains should use authenticated user id");
  assert.match(routesSource, /analyzeRebalancing\(getCurrentUserId\(req\)\)/, "portfolio rebalance should use authenticated user id");
  assert.match(routesSource, /checkPriceOpportunities\(getCurrentUserId\(req\)\)/, "portfolio opportunities should use authenticated user id");
  assert.match(routesSource, /generateWeeklyReport\(getCurrentUserId\(req\)\)/, "portfolio report preview should use authenticated user id");
  assert.match(routesSource, /sendWeeklyPortfolioReport\(getCurrentUserId\(req\)\)/, "portfolio report send should use authenticated user id");
  assert.match(routesSource, /sendDailyMarketUpdateForUser\(getCurrentUserId\(req\)\)/, "manual market update test should target only the authenticated user");
  assert.doesNotMatch(routesSource, /sendDailyMarketUpdate\(\)/, "manual market update test should not trigger the global scheduled job");
});

test("DJ contact mutation routes verify the authenticated owner before acting", () => {
  const routesSource = readFileSync("server/routes.ts", "utf8");

  assert.match(routesSource, /const existing = await storage\.getDjContact\(req\.params\.id\);\s*if \(!existing \|\| existing\.userId !== userId\)/s, "DJ update/delete should verify contact owner");
  assert.match(routesSource, /const dj = await storage\.getDjContact\(req\.params\.id\);\s*if \(!dj \|\| dj\.userId !== userId\)/s, "DJ message generation should verify contact owner");
  assert.match(routesSource, /storage\.updateDjContact\(req\.params\.id, req\.body\)/, "DJ update should happen only after the owner guard");
  assert.match(routesSource, /storage\.deleteDjContact\(req\.params\.id\)/, "DJ delete should happen only after the owner guard");
});

test("monitored project routes verify the authenticated owner before reading or mutating by id", () => {
  const routesSource = readFileSync("server/routes.ts", "utf8");

  assert.match(routesSource, /const project = await storage\.getMonitoredProject\(req\.params\.id\);\s*if \(!project \|\| project\.userId !== userId\)/s, "project read/check/log routes should verify owner");
  assert.match(routesSource, /const existing = await storage\.getMonitoredProject\(req\.params\.id\);\s*if \(!existing \|\| existing\.userId !== userId\)/s, "project update/delete routes should verify owner");
  assert.match(routesSource, /storage\.updateMonitoredProject\(req\.params\.id, req\.body\)/, "project update should happen only after owner guard");
  assert.match(routesSource, /storage\.deleteMonitoredProject\(req\.params\.id\)/, "project delete should happen only after owner guard");
  assert.match(routesSource, /checkSingleProject\(req\.params\.id\)/, "manual project check should happen only after owner guard");
  assert.match(routesSource, /storage\.getHealthCheckLogs\(req\.params\.id, limit\)/, "project logs should be fetched only after owner guard");
  assert.match(routesSource, /storage\.getIncidents\(req\.params\.id\)/, "project incidents should be fetched only after owner guard");
});

test("weekly summary update verifies the authenticated owner before mutating by id", () => {
  const routesSource = readFileSync("server/routes.ts", "utf8");
  const storageSource = readFileSync("server/storage.ts", "utf8");

  assert.match(storageSource, /getWeeklySummaryById\(id: string\): Promise<WeeklySummary \| undefined>/, "storage should expose weekly summary lookup by id for owner guards");
  assert.match(routesSource, /const existing = await storage\.getWeeklySummaryById\(req\.params\.id\);\s*if \(!existing \|\| existing\.userId !== userId\)/s, "weekly summary update should verify owner before update");
  assert.match(routesSource, /storage\.updateWeeklySummary\(req\.params\.id, body\)/, "weekly summary update should happen only after owner guard");
});

test("request-triggered Clippers daily plan uses the authenticated owner", () => {
  const routesSource = readFileSync("server/routes.ts", "utf8");
  const clippersSource = readFileSync("server/clippers-agent.ts", "utf8");

  assert.match(routesSource, /runClipperDailyPlan\(req\.body \|\| \{\}, getCurrentUserId\(req\)\)/, "Clippers daily plan route should pass the authenticated user id");
  assert.match(routesSource, /readClipperReport\(req\.params\.id, getCurrentUserId\(req\)\)/, "Clippers report reads should be scoped to the authenticated user id");
  assert.match(clippersSource, /runClipperDailyPlan\(input: unknown = \{\}, userId = getSystemUserId\(\)\)/, "Clippers daily plan should accept an explicit user id for request-bound calls");
  assert.match(clippersSource, /const status = await getClipperStatus\(userId\)/, "Clippers daily plan should build its status for the explicit owner");
  assert.match(clippersSource, /const report: ClipperReport = \{[\s\S]*userId,/s, "Clippers daily reports should persist their owner user id");
  assert.match(clippersSource, /readClipperReport\(id: string, userId = getSystemUserId\(\)\)/, "Clippers report reader should accept the expected owner user id");
  assert.match(clippersSource, /if \(report\.userId !== userId\) \{[\s\S]*return null;/, "Clippers report reader should hide reports owned by other users");
  assert.match(clippersSource, /return \{ report, status: await getClipperStatus\(userId\) \}/, "Clippers daily plan should return final status for the explicit owner");
});

test("request-triggered Clippers account setup routes use the authenticated owner", () => {
  const routesSource = readFileSync("server/routes.ts", "utf8");
  const clippersSource = readFileSync("server/clippers-agent.ts", "utf8");

  const routeCalls = [
    "bootstrapClipperAccounts",
    "bootstrapClipperWorkspace",
    "prepareClipperAccountIdentityKit",
    "prepareClipperAccountLaunchKit",
    "prepareClipperAccountCreationPack",
    "prepareClipperManualPostingPack",
    "prepareClipperAccountEvidenceVault",
    "prepareClipperProductionQueue",
  ];

  for (const helper of routeCalls) {
    assert.match(routesSource, new RegExp(`${helper}\\(getCurrentUserId\\(req\\)\\)`), `${helper} route should pass the authenticated user id`);
    assert.match(clippersSource, new RegExp(`${helper}\\(userId = getSystemUserId\\(\\)\\)`), `${helper} should accept an explicit user id for request-bound calls`);
  }

  assert.match(clippersSource, /const queueResult = await prepareClipperProductionQueue\(userId\)/, "manual posting pack should keep the explicit owner through its production queue dependency");
});

test("request-triggered Clippers credential and platform routes use the authenticated owner", () => {
  const routesSource = readFileSync("server/routes.ts", "utf8");
  const clippersSource = readFileSync("server/clippers-agent.ts", "utf8");

  const routeCalls = [
    "prepareClipperCredentialSetupCenter",
    "prepareClipperCredentialDoctor",
    "importClipperCredentialDropFiles",
    "prepareClipperPlatformReadinessMatrix",
    "prepareClipperOfficialPermissionMatrix",
    "prepareClipperAppReviewSubmissionPack",
    "prepareClipperAppReviewDemoPack",
    "prepareClipperDeveloperApplicationDrafts",
    "prepareClipperGoLiveExecutionPack",
    "prepareClipperPublisherConnectors",
    "prepareClipperProductionUrlSetup",
    "verifyClipperProductionUrl",
    "prepareClipperHttpsTunnelPlan",
    "prepareClipperLegalPolicyPack",
    "prepareClipperOAuthGoLivePreflight",
    "prepareClipperOAuthConnectionPack",
    "reloadClipperCredentials",
  ];

  for (const helper of routeCalls) {
    assert.match(routesSource, new RegExp(`${helper}\\(getCurrentUserId\\(req\\)\\)`), `${helper} route should pass the authenticated user id`);
    assert.match(clippersSource, new RegExp(`${helper}\\(userId = getSystemUserId\\(\\)\\)`), `${helper} should accept an explicit user id for request-bound calls`);
  }
});

test("request-triggered Clippers permission source and trend routes use the authenticated owner", () => {
  const routesSource = readFileSync("server/routes.ts", "utf8");
  const clippersSource = readFileSync("server/clippers-agent.ts", "utf8");

  const routeCalls = [
    "prepareClipperDeveloperAppEvidenceVault",
    "prepareClipperExternalSetupQueue",
    "prepareClipperExternalExecutionHandoff",
    "prepareClipperExternalExecutionSession",
    "prepareClipperExternalLaunchDossier",
    "prepareClipperPlatformPortalChecklist",
    "prepareClipperBlockerResolutionPack",
    "prepareClipperPermissionPack",
    "prepareClipperPermissionTracker",
    "prepareClipperPermissionRequestPack",
    "importClipperSourceDropFiles",
    "prepareClipperSourceAcquisitionPlan",
    "prepareClipperRightsOutreachPack",
    "prepareClipperDraftSpecs",
    "prepareClipperPublishingPackage",
    "prepareClipperIntakeKit",
    "ingestClipperMetrics",
    "ingestClipperTrends",
    "prepareClipperTrendRightsOutreachPack",
  ];

  for (const helper of routeCalls) {
    assert.match(routesSource, new RegExp(`${helper}\\(getCurrentUserId\\(req\\)\\)`), `${helper} route should pass the authenticated user id`);
    assert.match(clippersSource, new RegExp(`${helper}\\(userId = getSystemUserId\\(\\)\\)`), `${helper} should accept an explicit user id for request-bound calls`);
  }

  assert.match(clippersSource, /prepareClipperExternalExecutionHandoff\(userId\)/, "external execution session should keep the explicit owner through handoff generation");
  assert.match(clippersSource, /prepareClipperProductionQueue\(userId\)/, "source and draft helpers should keep the explicit owner through production queue generation");
});

test("request-triggered Clippers record import render and automation routes use the authenticated owner", () => {
  const routesSource = readFileSync("server/routes.ts", "utf8");
  const clippersSource = readFileSync("server/clippers-agent.ts", "utf8");

  const routeCalls = [
    "recordClipperAccountEvidence",
    "recordClipperDeveloperAppEvidence",
    "previewClipperCredentialSecretsBatch",
    "recordClipperCredentialSecret",
    "recordClipperCredentialSecretsBatch",
    "recordClipperProductionPublicUrl",
    "previewClipperLaunchEvidenceBatch",
    "recordClipperLaunchEvidenceBatch",
    "importClipperLaunchEvidenceDropFiles",
    "recordClipperPermissionStatus",
    "prepareClipperSourceHuntSheet",
    "recordClipperSourceIntakeBatch",
    "prepareClipperViralDiscoveryPack",
    "recordClipperSourceRights",
    "renderClipperDraftVideos",
    "recordClipperTrendCandidatesBatch",
    "prepareClipperAutomationSchedule",
    "runClipperAutomationCycle",
  ];

  for (const helper of routeCalls) {
    assert.match(routesSource, new RegExp(`${helper}\\([^\\n]*getCurrentUserId\\(req\\)`), `${helper} route should pass the authenticated user id`);
    assert.match(clippersSource, new RegExp(`${helper}\\([^\\)]*userId = getSystemUserId\\(\\)`, "s"), `${helper} should accept an explicit user id for request-bound calls`);
  }

  assert.match(clippersSource, /processClipperLaunchEvidenceBatch\(input, \{ dryRun: false \}, userId\)/, "launch evidence import should keep owner through batch processing");
  assert.match(clippersSource, /prepareClipperSourceAcquisitionPlan\(userId\)/, "source intake should keep owner through acquisition regeneration");
  assert.match(clippersSource, /const draftResult = await prepareClipperDraftSpecs\(userId\)/, "render should keep owner through draft spec generation");
  assert.match(clippersSource, /runClipperAutomationCycle\(\{ publishMode: "approval_required", riskTolerance: "growth" \}, userId\)/, "autopilot should keep owner through automation-cycle execution");
  assert.match(clippersSource, /JSON\.stringify\(\{[\s\S]*userId,[\s\S]*automation,/s, "automation cycle reports should persist their owner user id");
});
