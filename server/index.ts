import "./env-loader";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { registerBlackRoomControlRoutes } from "./blackroom-control-routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { startReminderScheduler } from "./reminder-scheduler";
import { startHealthCheckScheduler } from "./health-check";
import { startMarketNewsScheduler } from "./market-news";
import { setupTelegramWebhook } from "./telegram-chat";
import { storage } from "./storage";
import { getSystemUserId, requireAppUser } from "./user-context";
import { registerLocalAuthRoutes } from "./local-auth";
import { enforceWorkspaceAccess, registerWorkspaceAccessRoutes } from "./workspace-access";
import { createSessionMiddleware, resolveSessionRuntimeSettings } from "./session-config";
import { startPromoVideoDailyScheduler } from "./promo-video-agent";
import { startCybersecurityScheduler } from "./cybersecurity-agent";
import { startAppQaScheduler } from "./app-qa-agent";
import { initializeRevenueEnginePersistence } from "./revenue-engine";
import { initializeBlackRoomRemoteControlPersistence } from "./blackroom-remote-control";
import { shouldStartResourceIntensiveSchedulers } from "./background-scheduler-policy";
import { officeWebProtocol } from "./office-protocol";
import {officeWebSourceStatus,startOfficeWebSourceExporter} from "./office-web-source-scheduler";
import {officeEditorialSourceStatus} from "./office-editorial-scheduler";

const app = express();
const httpServer = createServer(app);
const instanceStartedAt = new Date();
const instanceId = process.env.REPLIT_DEPLOYMENT_ID || `${process.pid}-${instanceStartedAt.getTime()}`;

if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

app.get(["/health", "/api/health"], (_req, res) => {
  res.status(200).json({
    status: "ok",
    ready: true,
    service: "blackops-reminder",
    officeProtocol: officeWebProtocol(),
    officeSources:officeWebSourceStatus(),
    officeEditorialSources:officeEditorialSourceStatus(),
    instanceId,
    checkedAt: new Date().toISOString(),
    startedAt: instanceStartedAt.toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    memoryRssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
  });
});

async function getStartupMaintenanceUserIds(): Promise<string[]> {
  const configuredOwners = (await storage.getEnabledTelegramConfigs())
    .map((config) => config.userId)
    .filter((userId): userId is string => Boolean(userId));
  const uniqueOwners = Array.from(new Set(configuredOwners));
  return uniqueOwners.length ? uniqueOwners : [getSystemUserId()];
}

async function runStartupTaskDeduplication(): Promise<void> {
  const userIds = await getStartupMaintenanceUserIds();
  await Promise.all(userIds.map(async (userId) => {
    const [weeklyRemoved, mainRemoved] = await Promise.all([
      storage.deduplicateRecurringTasks(userId),
      storage.deduplicateMainTasks(userId),
    ]);
    if (weeklyRemoved > 0) {
      log(`Cleaned up ${weeklyRemoved} duplicate weekly tasks for ${userId}`, "weekly-tasks");
    }
    if (mainRemoved > 0) {
      log(`Cleaned up ${mainRemoved} duplicate main tasks for ${userId}`, "tasks");
    }
  }));
}

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    limit: '8mb',
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false, limit: "64kb", parameterLimit: 100 }));

app.get("/tiktokzjohuZmzXSsUwXRmI6fqM3JDKo7jsLUN.txt", (_req, res) => {
  res
    .type("text/plain")
    .send("tiktok-developers-site-verification=zjohuZmzXSsUwXRmI6fqM3JDKo7jsLUN\n");
});

app.get("/tiktokxXFfBZAFcOIGUKNMLUhs8E9M66NBKXCP.txt", (_req, res) => {
  res
    .type("text/plain")
    .send("tiktok-developers-site-verification=xXFfBZAFcOIGUKNMLUhs8E9M66NBKXCP\n");
});

function clipperPrivacyContactHtml(): string {
  const email = (process.env.CLIPPERS_PRIVACY_CONTACT_EMAIL || "").trim();
  if (/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email)) {
    return `<p>For privacy, access, revocation, or deletion requests, contact <a href="mailto:${email}">${email}</a>.</p>`;
  }
  return "<p>For privacy, access, revocation, or deletion requests, contact the operator at the support email shown on this app's Google OAuth consent screen.</p>";
}

function renderClipperPublicLegalHtml(title: string, body: string[]): string {
  const escapedTitle = title.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    `<title>${escapedTitle}</title>`,
    '<style>body{font-family:Inter,Arial,sans-serif;max-width:860px;margin:0 auto;padding:40px 20px;line-height:1.6;color:#18181b}h1,h2{line-height:1.2}.meta{color:#71717a}</style>',
    "</head>",
    "<body>",
    `<h1>${escapedTitle}</h1>`,
    '<p class="meta">Last updated: August 26, 2026</p>',
    ...body,
    "</body>",
    "</html>",
  ].join("\n");
}

app.get("/clippers/legal/privacy", (_req, res) => {
  res.type("html").send(renderClipperPublicLegalHtml("Clippers Privacy Policy", [
    "<p>Clippers is an internal, owner-only content operations system. Its YouTube integration is used only by the owner or an authorized operator to verify a selected channel and upload owner-approved videos to channels the owner controls. It is not offered as a public uploader or multi-user service.</p>",
    "<h2>YouTube API Services</h2>",
    "<p>Clippers uses YouTube API Services. During OAuth it requests YouTube upload permission and read-only channel access. It uses that access to verify the authorized channel identity and upload operator-selected video files with operator-selected titles, descriptions, audience settings, privacy settings, and optional scheduled publication times.</p>",
    "<h2>Information Accessed, Collected, And Stored</h2>",
    "<p>The integration may access and store the authorized channel ID and basic channel identity returned by YouTube, OAuth authorization metadata and tokens, upload request metadata, YouTube video IDs, publication status, scheduled time, and exact API response data needed to reconcile an upload. If the owner explicitly enables a metrics import, it may also store exact channel or video statistics returned by YouTube and identifies them as YouTube-sourced data. Clippers also stores operator-created media, captions, rights evidence, QA evidence, and local audit records; those local records are not obtained from YouTube API Services.</p>",
    "<h2>How YouTube Data Is Used</h2>",
    "<p>YouTube API Data is used only to confirm that the authenticated channel is the intended owner-controlled channel, complete an authorized upload, prevent duplicate uploads, reconcile the result, and show the owner the status returned by YouTube. Clippers does not use YouTube API Data for advertising, surveillance, user profiling, credit decisions, or sale.</p>",
    "<h2>Storage, Security, And Sharing</h2>",
    "<p>OAuth tokens are kept in restricted server-side storage and are never displayed on public pages or in normal reports. Access is limited to the owner-authorized runtime. YouTube API Data is disclosed to Google/YouTube as required to perform the requested operation and to infrastructure providers only when necessary to operate the owner-authorized service. It is not sold or shared with advertisers or unrelated third parties.</p>",
    "<h2>Retention And Deletion</h2>",
    "<p>OAuth tokens are retained only while the owner keeps the connection active. Stored YouTube API Data is refreshed, deleted, or de-identified as required by the YouTube API Services policies. A deletion or revocation request made directly to Clippers is completed as soon as possible and within 7 calendar days. If the owner revokes authorization through Google, or authorization can no longer be verified, associated YouTube API Data is deleted as soon as possible and no later than 30 calendar days. Local media, rights, QA, and accounting records that were not obtained from YouTube may be retained when independently required for ownership, legal, fraud-prevention, or operational evidence.</p>",
    "<p>Deleting data from Clippers does not delete the same or related data held by YouTube. The owner must use YouTube or Google account controls, including YouTube Studio, to delete YouTube-side data or content.</p>",
    "<h2>Your Controls</h2>",
    '<p>The owner can revoke Clippers\' Google access at any time in <a href="https://myaccount.google.com/permissions">Google Account third-party connections</a> or <a href="https://security.google.com/settings/security/permissions">Google security permissions</a>.</p>',
    "<h2>Google Privacy Policy</h2>",
    '<p>Google\'s handling of information is governed by the <a href="https://policies.google.com/privacy">Google Privacy Policy</a>. Use of YouTube is also subject to the <a href="https://www.youtube.com/t/terms">YouTube Terms of Service</a>.</p>',
    "<h2>Content Rights</h2>",
    "<p>Third-party footage is blocked unless an allowlist or evidence record confirms ownership, license, official-source use, or creator/rightsholder permission.</p>",
    "<h2>Contact</h2>",
    clipperPrivacyContactHtml(),
  ]));
});

app.get("/clippers/legal/terms", (_req, res) => {
  res.type("html").send(renderClipperPublicLegalHtml("Clippers Terms of Service", [
    "<p>These terms govern the internal, owner-only Clippers uploader used to prepare and upload approved videos to YouTube channels owned or managed by the operator.</p>",
    "<h2>Acceptance Of YouTube Terms</h2>",
    '<p>By using the YouTube features in Clippers, the authorized operator agrees to be bound by the <a href="https://www.youtube.com/t/terms">YouTube Terms of Service</a>. Use of YouTube API Services must also comply with the <a href="https://developers.google.com/youtube/terms/api-services-terms-of-service">YouTube API Services Terms of Service</a>, the <a href="https://developers.google.com/youtube/terms/developer-policies">YouTube API Services Developer Policies</a>, the <a href="https://developers.google.com/youtube/terms/required-minimum-functionality">Required Minimum Functionality</a>, and the <a href="https://www.youtube.com/howyoutubeworks/policies/community-guidelines/">YouTube Community Guidelines</a>.</p>',
    "<h2>Authorized Use</h2>",
    "<p>Only the owner or an expressly authorized operator may use Clippers, and only for channels the owner controls or has documented permission to manage. Before YouTube features are enabled, the operator must review and agree to the Clippers Privacy Policy and these Terms. The owner defines and approves batch-specific manifest metadata, target channel, audience designation, privacy setting, and publication schedule before the worker executes; those choices remain editable in local configuration and manifests before delivery and in YouTube Studio afterward.</p>",
    "<h2>Publishing Controls</h2>",
    "<p>New projects and workflows remain private and approval-gated until credentials, permissions, content rights, quality checks, channel identity, and any required Google/YouTube compliance review are verified. Clippers does not claim that Google or YouTube has approved this client unless written approval has actually been received.</p>",
    "<h2>Content Rights</h2>",
    "<p>The operator certifies that every upload complies with the YouTube Community Guidelines and that all audiovisual material is owned, licensed, or explicitly authorized. Clippers must not be used to upload copyrighted, private, deceptive, harmful, or otherwise unauthorized content.</p>",
    "<h2>Prohibited Conduct And Data Use</h2>",
    "<p>Clippers must not be used to scrape or download restricted YouTube content, collect YouTube login credentials, circumvent platform restrictions or review, shard quota across projects, access undocumented APIs, impersonate another channel, sell YouTube API Data, profile or surveil users, create unauthorized derived metrics, or share authorized data with unrelated parties.</p>",
    "<h2>Privacy And Revocation</h2>",
    '<p>Use of the integration is subject to the <a href="/clippers/legal/privacy">Clippers Privacy Policy</a>. Access may be revoked at <a href="https://myaccount.google.com/permissions">Google Account third-party connections</a>. Privacy, access, revocation, or deletion requests may be sent to the contact listed in the Clippers Privacy Policy.</p>',
    "<h2>Suspension And Changes</h2>",
    "<p>Access may be disabled immediately when authorization, rights, security, API compliance, or channel identity cannot be verified. These terms may be updated to reflect changes in applicable YouTube or Google requirements.</p>",
  ]));
});

app.get("/clippers/review-demo", (_req, res) => {
  res.type("html").send([
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    "<title>Clippers App Review Demo</title>",
    '<style>body{font-family:Inter,Arial,sans-serif;margin:0;background:#09090b;color:#f4f4f5}main{max-width:980px;margin:0 auto;padding:40px 20px 56px}.hero,.card{border:1px solid #27272a;background:#18181b;border-radius:8px;padding:24px;margin:14px 0}h1,h2{line-height:1.15}p,li{line-height:1.65;color:#d4d4d8}a{color:#67e8f9}.tag{color:#a7f3d0;font-size:12px}</style>',
    "</head>",
    "<body>",
    "<main>",
    '<section class="hero">',
    '<p class="tag">Public reviewer demo, no login required</p>',
    "<h1>Clippers App Review Demo</h1>",
    "<p>Clippers is an internal, owner-only uploader for channels owned or managed by the operator. It prepares videos, verifies rights and QA evidence, checks the exact authorized YouTube channel through OAuth, uploads approved files and metadata, and reconciles the exact status returned by YouTube.</p>",
    "<p>This demo page is read-only. It does not expose tokens, secrets, private user data, or live publishing controls.</p>",
    "<p><strong>Compliance status:</strong> this page documents the client for review; it does not claim Google or YouTube approval. Public or scheduled publishing remains blocked until any required API compliance audit is actually approved and recorded.</p>",
    "</section>",
    '<section class="card">',
    "<h2>Reviewer Walkthrough</h2>",
    "<ol>",
    "<li>Review platform setup status, credential readiness, and permission blockers.</li>",
    "<li>Confirm rights evidence before any source item can move to publishing.</li>",
    "<li>Connect exactly one owner-controlled YouTube channel through OAuth using upload and read-only channel scopes.</li>",
    "<li>Verify the authenticated channel ID, then show the owner-approved batch manifest containing the local file, title (up to 100 characters), description, audience setting, visibility or future schedule, rights evidence, and QA result. These choices remain editable before worker delivery and in YouTube Studio afterward.</li>",
    "<li>Upload only after owner authorization. Record the video ID and status returned by YouTube; never infer a public outcome.</li>",
    "<li>Revoke access through Google Account permissions or request deletion from the contact listed in the Privacy Policy.</li>",
    "</ol>",
    "</section>",
    '<section class="card">',
    "<h2>Public Policy Links</h2>",
    '<p><a href="/clippers/legal/privacy">Privacy Policy</a> · <a href="/clippers/legal/terms">Terms of Service</a> · <a href="https://studio.youtube.com/">YouTube Studio</a> · <a href="https://www.youtube.com/t/terms">YouTube Terms</a> · <a href="https://policies.google.com/privacy">Google Privacy Policy</a> · <a href="https://myaccount.google.com/permissions">Revoke Google access</a></p>',
    "</section>",
    "</main>",
    "</body>",
    "</html>",
  ].join("\n"));
});

function renderDropshippingPublicLegalHtml(title: string, body: string[]): string {
  const escapedTitle = title.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    `<title>${escapedTitle}</title>`,
    '<style>body{font-family:Inter,Arial,sans-serif;max-width:860px;margin:0 auto;padding:40px 20px;line-height:1.6;color:#18181b}h1,h2{line-height:1.2}.meta{color:#71717a}.notice{border:1px solid #d4d4d8;background:#fafafa;padding:16px;border-radius:8px}</style>',
    "</head>",
    "<body>",
    `<h1>${escapedTitle}</h1>`,
    '<p class="meta">Draft operating policy for Dropshipping CEO. Last updated: June 18, 2026.</p>',
    '<p class="notice">This policy is a starter template for a no-inventory dropshipping store. Final store name, legal entity, contact email, supplier terms, payment processor, and jurisdiction should be reviewed before public launch.</p>',
    ...body,
    "</body>",
    "</html>",
  ].join("\n");
}

app.get("/dropshipping/legal/privacy", (_req, res) => {
  res.type("html").send(renderDropshippingPublicLegalHtml("Dropshipping Store Privacy Policy", [
    "<p>This store collects customer information only as needed to process orders, provide support, prevent fraud, improve the shopping experience, and comply with legal obligations.</p>",
    "<h2>Information We Process</h2>",
    "<p>Order details may include name, shipping address, email, phone number, billing details handled by the payment processor, payment status, product selections, support messages, device/session data, and marketing attribution data.</p>",
    "<h2>Service Providers</h2>",
    "<p>We may share order and fulfillment information with ecommerce, payment, shipping, analytics, email, advertising, and dropshipping supplier tools only when needed to operate the store.</p>",
    "<h2>Supplier Fulfillment</h2>",
    "<p>Because the store uses supplier fulfillment, limited order details may be shared with the supplier or fulfillment partner so the order can be shipped and tracked.</p>",
    "<h2>Marketing</h2>",
    "<p>Email, SMS, retargeting, and social advertising should run only after the customer has provided the required consent or where allowed by applicable law and platform policy.</p>",
    "<h2>Retention And Security</h2>",
    "<p>Order and support records should be retained only as long as needed for accounting, fraud prevention, legal compliance, customer support, and platform requirements. Tokens and secrets must not be exposed in public reports.</p>",
    "<h2>Customer Requests</h2>",
    "<p>Customers can request access, correction, deletion, or opt-out support through the store contact channel once configured.</p>",
  ]));
});

app.get("/dropshipping/legal/refund-policy", (_req, res) => {
  res.type("html").send(renderDropshippingPublicLegalHtml("Dropshipping Store Refund Policy", [
    "<p>Refunds and replacements are handled case by case. The store should clearly disclose shipping times, item condition requirements, and evidence needed before launch.</p>",
    "<h2>Cancellation Before Shipment</h2>",
    "<p>If an order cannot be shipped within the stated shipping window or a lawful delay notice cannot be completed, the customer should be offered cancellation and a prompt refund before the item ships.</p>",
    "<h2>Damaged Or Incorrect Items</h2>",
    "<p>Customers should contact support with the order number, photos or video, packaging evidence, and a short description of the issue within the posted return window.</p>",
    "<h2>Change Of Mind</h2>",
    "<p>Change-of-mind returns may be limited by supplier and product type. Any customer-paid return shipping should be clearly disclosed before checkout.</p>",
    "<h2>Non-Returnable Items</h2>",
    "<p>Hygiene, personalized, final-sale, used, or safety-sensitive items may be non-returnable when allowed by law and clearly disclosed.</p>",
    "<h2>Refund Timing</h2>",
    "<p>Approved refunds should be returned to the original payment method after inspection, supplier confirmation, cancellation, or delay handling, subject to payment processor timelines.</p>",
  ]));
});

app.get("/dropshipping/legal/shipping-policy", (_req, res) => {
  res.type("html").send(renderDropshippingPublicLegalHtml("Dropshipping Store Shipping Policy", [
    "<p>This store uses supplier fulfillment and does not hold bulk inventory. Shipping estimates must be displayed clearly on each product page before launch.</p>",
    "<h2>Processing Time</h2>",
    "<p>Orders should be reviewed for payment, fraud, address quality, supplier availability, and fulfillment approval before shipment. The shipment clock should be measured from a properly completed paid order.</p>",
    "<h2>Transit Time</h2>",
    "<p>Transit times vary by supplier, destination, carrier, customs, and seasonal demand. Product pages should show estimated ranges, not guaranteed delivery dates unless verified.</p>",
    "<h2>Delay Handling</h2>",
    "<p>If the store learns it cannot ship within the represented time, support should notify the customer quickly, provide a revised shipment date when available, and offer cancellation with a prompt refund where required.</p>",
    "<h2>Tracking</h2>",
    "<p>Tracking should be provided when available from the supplier or fulfillment partner. If tracking is delayed, customer support should communicate the current order state.</p>",
    "<h2>Customs And Duties</h2>",
    "<p>International customers may be responsible for customs, import taxes, duties, and local fees unless the checkout clearly states otherwise.</p>",
  ]));
});

app.get("/dropshipping/legal/terms", (_req, res) => {
  res.type("html").send(renderDropshippingPublicLegalHtml("Dropshipping Store Terms of Service", [
    "<p>These terms describe the starter operating rules for a no-inventory ecommerce store using supplier fulfillment.</p>",
    "<h2>Product Information</h2>",
    "<p>Product descriptions, photos, prices, availability, shipping estimates, and promotions should be accurate, current, and free of unsupported claims.</p>",
    "<h2>Orders</h2>",
    "<p>The store may refuse, cancel, or hold an order for fraud review, unavailable supplier stock, pricing errors, shipping restrictions, or policy violations.</p>",
    "<h2>No Medical Or Unsupported Claims</h2>",
    "<p>Marketing copy must not promise health, safety, legal, financial, or performance outcomes without reliable evidence and required approvals.</p>",
    "<h2>Limitation</h2>",
    "<p>The final public terms should be reviewed for the store jurisdiction, payment processor, supplier agreements, platform policies, and consumer protection rules.</p>",
  ]));
});

app.get("/dropshipping/legal/checkout-readiness", (_req, res) => {
  res.type("html").send(renderDropshippingPublicLegalHtml("Dropshipping Checkout Readiness Checklist", [
    "<p>This checklist is for pre-account setup. It becomes complete only after Shopify, payment processing, supplier operations, and tracking are connected and tested.</p>",
    "<h2>Before Enabling Checkout</h2>",
    "<ul><li>Product page shows price, estimated shipping range, return/refund link, privacy link, terms link, support contact, and no unsupported claims.</li><li>Shipping estimate has supplier evidence and a reasonable basis.</li><li>Payment processor is connected in test mode or live mode as appropriate.</li><li>Tax, shipping, discount, abandoned checkout, and order confirmation settings are reviewed.</li><li>Supplier primary and backup are documented before paid traffic.</li></ul>",
    "<h2>Test Order</h2>",
    "<ul><li>Create one test checkout with a low-risk product draft.</li><li>Verify payment authorization, receipt, order status, customer email, shipping address, tax/shipping display, refund path, and cancellation path.</li><li>Do not send supplier fulfillment until the order is paid and approval is recorded.</li></ul>",
    "<h2>First Live Order Guardrail</h2>",
    "<p>For the first real order, fulfillment must stay approval-required. The team should verify payment captured, product margin positive, supplier stock available, tracking available, and customer promise still accurate.</p>",
  ]));
});

const sessionSettings = resolveSessionRuntimeSettings();
const sessionMiddleware = createSessionMiddleware(sessionSettings);
if (sessionMiddleware) {
  app.use(sessionMiddleware);
  log(`Session auth enabled with ${sessionSettings.storeKind} store`, "auth");
} else {
  log("SESSION_SECRET not configured; local session auth is disabled", "auth");
}

// Also protect authentication failures before the owner-bound route runs.
app.use("/api/marketing-command-center", (_req,res,next)=>{res.setHeader("Cache-Control","no-store");next();});
app.use(requireAppUser);
// Partners (socios) only reach the explicit Black Room / read-only office allowlist; see server/workspace-access.ts.
app.use(enforceWorkspaceAccess());

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

const LOG_BODY_LIMIT = 700;
const LOG_STRING_LIMIT = 160;
const LOG_ARRAY_LIMIT = 3;
const LOG_OBJECT_KEY_LIMIT = 16;
const SENSITIVE_LOG_KEY_PATTERN = /(access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|secret|password|authorization|cookie|encryptedPayload|api[_-]?key|private[_-]?key)/i;

function redactLogString(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .replace(/(access_token|refresh_token|id_token|client_secret|api_key)=([^&\s]+)/gi, "$1=[redacted]")
    .replace(/(access_token|refresh_token|id_token|client_secret|api_key)"\s*:\s*"[^"]+"/gi, '$1":"[redacted]"');
}

function summarizeJsonForLog(value: unknown, depth = 0): unknown {
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") {
    const redacted = redactLogString(value);
    return redacted.length > LOG_STRING_LIMIT ? `${redacted.slice(0, LOG_STRING_LIMIT)}...[truncated ${redacted.length - LOG_STRING_LIMIT} chars]` : redacted;
  }
  if (Array.isArray(value)) {
    const sample = value.slice(0, LOG_ARRAY_LIMIT).map((item) => summarizeJsonForLog(item, depth + 1));
    return value.length > LOG_ARRAY_LIMIT ? [...sample, `[${value.length - LOG_ARRAY_LIMIT} more items]`] : sample;
  }
  if (typeof value === "object") {
    if (depth >= 4) return "[max depth]";
    const entries = Object.entries(value as Record<string, unknown>);
    const summarized: Record<string, unknown> = {};
    for (const [key, item] of entries.slice(0, LOG_OBJECT_KEY_LIMIT)) {
      summarized[key] = SENSITIVE_LOG_KEY_PATTERN.test(key) ? "[redacted]" : summarizeJsonForLog(item, depth + 1);
    }
    if (entries.length > LOG_OBJECT_KEY_LIMIT) summarized.__omittedKeys = entries.length - LOG_OBJECT_KEY_LIMIT;
    return summarized;
  }
  return String(value);
}

function formatJsonForLog(value: unknown): string {
  const text = JSON.stringify(summarizeJsonForLog(value));
  return text.length > LOG_BODY_LIMIT ? `${text.slice(0, LOG_BODY_LIMIT)}...[truncated ${text.length - LOG_BODY_LIMIT} chars]` : text;
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: unknown;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${formatJsonForLog(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  registerLocalAuthRoutes(app);
  await registerWorkspaceAccessRoutes(app);
  await initializeRevenueEnginePersistence();
  await initializeBlackRoomRemoteControlPersistence();
  await registerRoutes(httpServer, app);
  registerBlackRoomControlRoutes(app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(err);
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  const host = process.env.HOST || "0.0.0.0";
  httpServer.listen(
    {
      port,
      host,
      reusePort: host === "0.0.0.0",
    },
    () => {
      log(`serving on ${host}:${port}`);
      void startOfficeWebSourceExporter().catch(()=>log("Office source exporter unavailable; saved sources must not be treated as fresh.","scheduler"));
      startReminderScheduler();
      startHealthCheckScheduler();
      startMarketNewsScheduler();
      // Zero-cost peer review between agents (no AI calls). Disable with AGENT_COUNCIL_ENABLED=false.
      void import("./agent-council").then((council) => council.startAgentCouncilScheduler()).catch((error) => {
        log(`Failed to start agent council: ${error instanceof Error ? error.message : String(error)}`, "scheduler");
      });
      // Black Room team works on its own schedule (reports, web, competition, approved posts, CEO brief).
      // Read-only or approval-gated work only; disable with BLACKROOM_TEAM_SCHEDULER_ENABLED=false.
      void Promise.all([import("./blackroom-team/scheduler"), import("./blackroom-team-routes"), import("./user-context")]).then(([scheduler, routes, users]) => {
        const started = scheduler.startBlackRoomTeamScheduler({
          running: routes.BLACKROOM_TEAM_RUNNING,
          ownerUserId: () => { try { return users.getSystemUserId(); } catch { return null; } },
        });
        log(started ? "Black Room team scheduler started" : "Black Room team scheduler disabled", "scheduler");
      }).catch((error) => {
        log(`Failed to start Black Room team scheduler: ${error instanceof Error ? error.message : String(error)}`, "scheduler");
      });
      // Publishing and analytics are revenue-critical and intentionally stay
      // active on the small Replit deployment. The metadata growth scout is the
      // optional memory-heavy process governed by the resource policy below.
      void import("./clippers-local-news-scheduler").then((localNews) => {
        localNews.startClipperLocalNewsScheduler();
      }).catch((error) => {
        log(`Failed to start local-news publishing scheduler: ${error instanceof Error ? error.message : String(error)}`, "scheduler");
      });
      void import("./metricool-analytics-sync").then((metricoolAnalytics) => {
        metricoolAnalytics.startMetricoolAnalyticsScheduler();
      }).catch((error) => {
        log(`Failed to start Metricool analytics scheduler: ${error instanceof Error ? error.message : String(error)}`, "scheduler");
      });
      if (shouldStartResourceIntensiveSchedulers()) {
        startPromoVideoDailyScheduler();
        startCybersecurityScheduler();
        startAppQaScheduler();
        void import("./local-news-growth-scout").then((growthScout) => {
          growthScout.startLocalNewsGrowthScoutScheduler();
        }).catch((error) => {
          log(`Failed to start resource-intensive growth scout: ${error instanceof Error ? error.message : String(error)}`, "scheduler");
        });
      } else {
        log("Resource-intensive promo video, cybersecurity, App QA, and growth scout schedulers disabled for the memory-constrained Replit deployment; news publishing and analytics remain active", "scheduler");
      }
      
      runStartupTaskDeduplication().catch(err => {
        log(`Failed to deduplicate startup tasks: ${err.message}`, "tasks");
      });

      if (process.env.TELEGRAM_AUTO_SETUP_WEBHOOK === "true") {
        setupTelegramWebhook().then(result => {
          if (result.success) {
            log(`Telegram webhook configured: ${result.message}`, "telegram");
          } else {
            log(`Telegram webhook setup failed: ${result.message}`, "telegram");
          }
        }).catch(err => {
          log(`Telegram webhook error: ${err.message}`, "telegram");
        });
      } else {
        log("Telegram webhook auto-setup skipped; run `npm run telegram:webhook -- setup --execute` when ready", "telegram");
      }
    },
  );
})();
