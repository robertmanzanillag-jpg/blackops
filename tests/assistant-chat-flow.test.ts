import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildDirectBlackRoomCommand,
  buildDirectGoogleCalendarCommand,
  buildDirectMetricoolCommand,
  buildDirectPromoVideoCommand,
  buildRadioYoutubeContinuationMessage,
  userAlreadyApprovedExecution,
} from "../server/assistant";
import { shouldUseCheapScoutForWebChat } from "../server/ai-router";
import { buildDirectRadioDriveVideoCommand, buildDirectRadioYoutubeCommand } from "../server/radio-youtube-command";

test("web assistant saves streamed responses and failures into shared CEO history", () => {
  const source = readFileSync("server/assistant.ts", "utf8");

  assert.match(source, /let requestUserId: string \| null = null/);
  assert.match(source, /requestUserId = userId/);
  assert.match(source, /saveCeoConversationMessage\(userId, "assistant", fullResponse\)/);
  assert.match(source, /saveCeoConversationMessage\(requestUserId, "assistant", userFacingError\)/);
});

test("web assistant never completes with an empty shared response", () => {
  const source = readFileSync("server/assistant.ts", "utf8");

  assert.match(source, /if \(!fullResponse\.trim\(\)\)/);
  assert.match(source, /No pude generar una respuesta útil esta vez/);
  assert.match(source, /res\.write\(`data: \$\{JSON\.stringify\(\{ content: fullResponse \}\)\}\\n\\n`\)/);
});

test("web assistant routes Black Room website link deactivation away from calendar", () => {
  const direct = buildDirectBlackRoomCommand(
    "QUIERO QUE ME DESACTIVES EL EVENTO DE BLACK ROOM & FRIENDS DE LOS LINSK DE BLACK ROOM"
  );

  assert.ok(direct);
  assert.match(direct.command, /BLACKROOM_LINK_DEACTIVATE/);
  assert.match(direct.command, /BLACK ROOM & FRIENDS/);
  assert.doesNotMatch(direct.command, /EDITAR_EVENTO_GOOGLE|MODIFICAR_RADIO/);
});

test("web assistant routes natural promo video requests to the local video agent", () => {
  const source = readFileSync("server/assistant.ts", "utf8");
  const direct = buildDirectPromoVideoCommand("creame 5 videos para TikTok de promo");

  assert.ok(direct);
  assert.match(source, /PROMO_VIDEO_GENERATE/);
  assert.match(direct.command, /PROMO_VIDEO_GENERATE/);
  assert.match(direct.command, /"count":5/);
  assert.match(direct.command, /"platform":"tiktok"/);
});

test("web assistant prioritizes YouTube clip requests before Developer Autopilot", () => {
  const source = readFileSync("server/assistant.ts", "utf8");
  const directRadioIndex = source.indexOf("const directRadioYoutubeCommand = buildDirectRadioYoutubeCommand(radioYoutubeMessage)");
  const developerIndex = source.indexOf("const developerAutopilotHandoff = message");
  const direct = buildDirectRadioYoutubeCommand(
    "Prueba QA Codex: https://youtu.be/jNQXAC9IVRw sacame un clip corto de prueba y guardalo en Drive en una carpeta llamada Codex QA Replit 2026-06-21. Dime si empezo la descarga o si fallo el procesador."
  );

  assert.ok(direct);
  assert.ok(directRadioIndex > -1);
  assert.ok(developerIndex > -1);
  assert.ok(directRadioIndex < developerIndex);
  assert.match(direct.content, /Voy a descargar ese YouTube/);
  assert.doesNotMatch(direct.content, /repo de GitHub/);
});

test("web assistant treats typoed Drive YouTube clip requests as local radio clip jobs", () => {
  const direct = buildDirectRadioYoutubeCommand(
    "https://youtu.be/GcVZvXkz2jU , quiero que saques los clips de instagram y de TikTok y los guardes en la carte de drives"
  );

  assert.ok(direct);
  assert.match(direct.content, /Voy a descargar ese YouTube/);
  assert.match(direct.command, /RADIO_YOUTUBE_CLIPS/);
  assert.deepEqual(direct.driveFolderPath, ["Videos creados"]);
  assert.equal(direct.createFolderIfMissing, true);
});

test("web assistant supports multiple YouTube clips per platform with source cleanup", () => {
  const source = readFileSync("server/assistant.ts", "utf8");
  const direct = buildDirectRadioYoutubeCommand(
    "https://youtu.be/GcVZvXkz2jU quiero 3 videos de ig y de tiktok diferentes, guardalos en carpeta Robert A/Lucia Reina del drive y despues borra el video largo"
  );

  assert.ok(direct);
  assert.equal(direct.instagramClipCount, 3);
  assert.equal(direct.tiktokClipCount, 3);
  assert.equal(direct.deleteSourceAfterSuccess, true);
  assert.match(source, /instagramClipCount/);
  assert.match(source, /tiktokClipCount/);
  assert.match(source, /deleteSourceAfterSuccess/);
});

test("web assistant continues YouTube clip requests when user replies with only the Drive folder", () => {
  const continuation = buildRadioYoutubeContinuationMessage("Robert a", [
    {
      role: "user",
      content: "https://youtu.be/GcVZvXkz2jU quiero que me saques un clip para TikTok y otro para ig y lo guardes en el drive",
    },
    {
      role: "assistant",
      content: "Puedo hacerlo. Mándame también el nombre o ruta de la carpeta de Google Drive donde quieres que guarde los clips.",
    },
  ]);

  assert.ok(continuation);
  const direct = buildDirectRadioYoutubeCommand(continuation);
  assert.ok(direct);
  assert.deepEqual(direct.driveFolderPath, ["Robert a"]);
  assert.match(direct.command, /RADIO_YOUTUBE_CLIPS/);
});

test("web assistant continues Drive MP4 clip requests when user replies with only the Drive folder", () => {
  const continuation = buildRadioYoutubeContinuationMessage("Robert a", [
    {
      role: "user",
      content: "https://drive.google.com/file/d/1abcDEFghiJKLmnopQRSTuv/view quiero que me saques un clip para TikTok y otro para ig",
    },
    {
      role: "assistant",
      content: "Puedo hacerlo con el MP4 de Google Drive. Mándame también el nombre, ruta o link de la carpeta de Google Drive donde quieres que guarde los clips.",
    },
  ]);

  assert.ok(continuation);
  const direct = buildDirectRadioDriveVideoCommand(continuation);
  assert.ok(direct);
  assert.deepEqual(direct.driveFolderPath, ["Robert a"]);
  assert.match(direct.command, /RADIO_DRIVE_VIDEO_CLIPS/);
});

test("web assistant routes Metricool posting requests into approval-gated automation", () => {
  const source = readFileSync("server/assistant.ts", "utf8");
  const executor = readFileSync("server/trust-executor.ts", "utf8");
  const direct = buildDirectMetricoolCommand("prepara Metricool para postear 6 clips en TikTok automatico");

  assert.ok(direct);
  assert.match(direct.command, /METRICOOL_AUTOMATION/);
  assert.match(direct.command, /"clipsPerAccount":6/);
  assert.match(direct.command, /"publishMode":"auto_after_connection"/);
  assert.match(source, /marketing\.metricool_automation/);
  assert.match(executor, /executeMetricoolAutomationAction/);
});

test("BlackOps chat loads local Claude skills into web and Telegram prompts", () => {
  const bridge = readFileSync("server/claude-skill-bridge.ts", "utf8");
  const webAssistant = readFileSync("server/assistant.ts", "utf8");
  const telegramAssistant = readFileSync("server/telegram-chat.ts", "utf8");
  const marketingSkill = readFileSync(".claude/skills/marketing-autopilot/SKILL.md", "utf8");
  const designSkill = readFileSync(".claude/skills/design-creative/SKILL.md", "utf8");

  assert.match(bridge, /buildClaudeSkillContext/);
  assert.match(bridge, /\.claude/);
  assert.match(bridge, /BLACKOPS_SKILLS_MAX_ACTIVE/);
  assert.match(bridge, /BLACKOPS_SKILLS_MAX_BODY_CHARS/);
  assert.match(bridge, /DEFAULT_MAX_SKILLS = 1/);
  assert.match(bridge, /DEFAULT_MAX_CONTEXT_CHARS = 2500/);
  assert.match(bridge, /if \(scored\.length === 0\) return ""/);
  assert.match(bridge, /Skill truncated for token budget/);
  assert.match(webAssistant, /buildClaudeSkillContext\(message\)/);
  assert.match(telegramAssistant, /buildClaudeSkillContext\(userMessage\)/);
  assert.match(marketingSkill, /Metricool/);
  assert.match(marketingSkill, /campaigns/);
  assert.match(designSkill, /UI, UX/);
  assert.match(designSkill, /Canva/);
});

test("main assistant routes BlackRoom controls before generic approval handling", () => {
  const source = readFileSync("server/assistant.ts", "utf8");
  const blackRoomHandler = source.indexOf("looksLikeBlackRoomAssistantRequest(message)");
  const approvalHandler = source.indexOf("executeSinglePendingApprovalFromChat(userId, message)");
  assert.ok(blackRoomHandler >= 0);
  assert.ok(approvalHandler > blackRoomHandler);
  assert.match(source, /executeBlackRoomChatMessage\(message\)/);
  assert.match(source, /blackRoomAgentError/);
  const assistantPage = readFileSync("client/src/pages/assistant.tsx", "utf8");
  assert.match(assistantPage, /text-blackroom-chat-help/);
  assert.match(assistantPage, /sube 3 videos más hoy/);
  assert.match(assistantPage, /cómo va la cola de BlackRoom/);
});

test("BlackOps chat enforces cheap-first AI cost policy", () => {
  const policy = readFileSync("server/ai-cost-policy.ts", "utf8");
  const webAssistant = readFileSync("server/assistant.ts", "utf8");
  const telegramAssistant = readFileSync("server/telegram-chat.ts", "utf8");
  const geminiClient = readFileSync("server/gemini-client.ts", "utf8");
  const router = readFileSync("server/ai-router.ts", "utf8");
  const agentRules = readFileSync("AGENTS.md", "utf8");

  assert.match(policy, /BLACKOPS_AI_MONTHLY_BUDGET_USD/);
  assert.match(policy, /500/);
  assert.match(policy, /cheap-first/);
  assert.match(policy, /paid generative video at scale/);
  assert.match(policy, /ChatGPT\/Codex Pro subscription handoff/);
  assert.match(policy, /BLACKOPS_STRICT_COST_MODE/);
  assert.match(policy, /Strict cost mode/);
  assert.match(policy, /compact, intent-selected context/);
  assert.match(router, /BLACKOPS_WEB_CHEAP_SCOUT_ENABLED/);
  assert.match(router, /cheap_scout/);
  assert.match(router, /subscription_handoff/);
  assert.match(router, /strong_supervisor/);
  assert.match(webAssistant, /shouldUseCheapScoutForWebChat/);
  assert.match(webAssistant, /modelRoute\.tier === "subscription_handoff"/);
  assert.match(webAssistant, /getCachedCheapScoutResponse/);
  assert.match(webAssistant, /buildCompactCheapScoutPrompt/);
  assert.match(webAssistant, /setCachedCheapScoutResponse/);
  assert.match(webAssistant, /const geminiClient = await getGeminiClient\(\)/);
  assert.match(webAssistant, /geminiClient\.models\.generateContent/);
  assert.match(webAssistant, /buildAiCostPolicyContext\("web"\)/);
  assert.match(webAssistant, /getOpenAiMaxCompletionTokens\(\)/);
  assert.match(webAssistant, /getAiConversationHistoryLimit\(\)/);
  assert.match(telegramAssistant, /buildAiCostPolicyContext\("telegram"\)/);
  assert.match(telegramAssistant, /getGeminiChatModel\(\{ hasImage: !!imageData \}\)/);
  assert.match(geminiClient, /gemini-2\.5-flash-lite/);
  assert.match(agentRules, /Target AI\/API spend below \$500\/month/);
});

test("Gemini SDK stays out of startup imports", () => {
  const modules = [
    "server/gemini-client.ts",
    "server/telegram-chat.ts",
    "server/replit_integrations/image/client.ts",
    "server/replit_integrations/image/routes.ts",
  ];

  for (const modulePath of modules) {
    const source = readFileSync(modulePath, "utf8");
    assert.doesNotMatch(
      source,
      /^import\s+\{[^}]+\}\s+from\s+["']@google\/genai["']/m,
      `${modulePath} should not load @google/genai during server startup`,
    );
  }

  assert.match(
    readFileSync("server/gemini-client.ts", "utf8"),
    /await import\("@google\/genai"\)/,
    "Gemini client should load the SDK lazily at request time",
  );
});

test("AI router sends low-risk work to cheap scout and risky work to strong supervisor", () => {
  const previousKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  const previousCheapScoutEnabled = process.env.BLACKOPS_WEB_CHEAP_SCOUT_ENABLED;
  process.env.AI_INTEGRATIONS_GEMINI_API_KEY = "test-gemini-key";
  process.env.BLACKOPS_WEB_CHEAP_SCOUT_ENABLED = "true";

  try {
    assert.equal(
      shouldUseCheapScoutForWebChat({ message: "haz captions simples para 5 clips de tiktok" }).tier,
      "cheap_scout",
    );
    assert.equal(
      shouldUseCheapScoutForWebChat({ message: "prepara metricool y organiza calendario" }).provider,
      "gemini",
    );
    assert.equal(
      shouldUseCheapScoutForWebChat({ message: "decide presupuesto y estrategia completa de ads" }).tier,
      "subscription_handoff",
    );
    assert.equal(
      shouldUseCheapScoutForWebChat({ message: "prepara una campana completa para clippers con multiples cuentas" }).provider,
      "membership",
    );
    assert.equal(
      shouldUseCheapScoutForWebChat({ message: "arregla bug de produccion en github repo" }).provider,
      "openai",
    );
    assert.equal(
      shouldUseCheapScoutForWebChat({ message: "necesito que me pienses una respuesta ".repeat(80) }).tier,
      "subscription_handoff",
    );
    assert.equal(
      shouldUseCheapScoutForWebChat({ message: "resume esta captura", hasImages: true }).tier,
      "strong_supervisor",
    );
  } finally {
    if (previousKey === undefined) delete process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
    else process.env.AI_INTEGRATIONS_GEMINI_API_KEY = previousKey;
    if (previousCheapScoutEnabled === undefined) delete process.env.BLACKOPS_WEB_CHEAP_SCOUT_ENABLED;
    else process.env.BLACKOPS_WEB_CHEAP_SCOUT_ENABLED = previousCheapScoutEnabled;
  }
});

test("AI router blocks automatic OpenAI fallback when cheap scout key is missing in strict mode", () => {
  const previousKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  const previousStrict = process.env.BLACKOPS_STRICT_COST_MODE;
  delete process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  process.env.BLACKOPS_STRICT_COST_MODE = "true";

  try {
    const route = shouldUseCheapScoutForWebChat({ message: "haz captions simples para 5 clips" });
    assert.equal(route.tier, "subscription_handoff");
    assert.equal(route.provider, "membership");
    assert.match(route.reason, /blocks automatic OpenAI fallback/);
  } finally {
    if (previousKey === undefined) delete process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
    else process.env.AI_INTEGRATIONS_GEMINI_API_KEY = previousKey;
    if (previousStrict === undefined) delete process.env.BLACKOPS_STRICT_COST_MODE;
    else process.env.BLACKOPS_STRICT_COST_MODE = previousStrict;
  }
});

test("dashboard exposes monthly AI spend tracking", () => {
  const policy = readFileSync("server/ai-cost-policy.ts", "utf8");
  const routes = readFileSync("server/routes.ts", "utf8");
  const dashboard = readFileSync("client/src/pages/dashboard.tsx", "utf8");
  const panel = readFileSync("client/src/components/monthly-spend-panel.tsx", "utf8");

  assert.match(policy, /buildMonthlyAiSpendReport/);
  assert.match(policy, /BLACKOPS_AI_MANUAL_MONTH_TO_DATE_USD/);
  assert.match(policy, /BLACKOPS_METRICOOL_MONTHLY_USD/);
  assert.match(routes, /\/api\/ai-spend\/monthly/);
  assert.match(routes, /buildMonthlyAiSpendReport\(runs\)/);
  assert.match(dashboard, /MonthlySpendPanel/);
  assert.match(panel, /monthly-spend-panel/);
  assert.match(panel, /\/api\/ai-spend\/monthly/);
  assert.match(panel, /Gasto mensual/);
});

test("web assistant prepares clear Google Calendar requests without model routing", () => {
  const direct = buildDirectGoogleCalendarCommand(
    "quiero que agreguemos para este martes en el google calendar: BLACK ROOM RADIO BERLIN 3pm: 4pm: 5pm: 6pm: 7pm:",
    new Date("2026-06-18T20:17:00-04:00"),
  );

  assert.ok(direct);
  assert.match(direct.command, /CREAR_EVENTO_GOOGLE/);
  assert.equal(direct.eventData.title, "BLACK ROOM RADIO BERLIN");
  assert.match(direct.eventData.date, /^2026-06-23T15:00:00-04:00$/);
  assert.match(direct.eventData.endDate, /^2026-06-23T20:00:00-04:00$/);
  assert.match(direct.eventData.description || "", /3:00 PM/);
  assert.doesNotMatch(direct.command, /BLACKROOM_LINK_ADD|BLACKROOM_LINK_DEACTIVATE/);
});

test("web assistant extracts promo video text and typography from natural requests", () => {
  const direct = buildDirectPromoVideoCommand(
    'hazme 5 videos para TikTok de promo que diga "NEW APP FOR PROMO" cta "JOIN THE GUESTLIST" con typo luxury'
  );

  assert.ok(direct);
  assert.match(direct.command, /"hookText":"NEW APP FOR PROMO"/);
  assert.match(direct.command, /"ctaText":"JOIN THE GUESTLIST"/);
  assert.match(direct.command, /"fontStyle":"luxury"/);
});

test("web assistant extracts promo video source folder from natural requests", () => {
  const direct = buildDirectPromoVideoCommand(
    'hazme 5 videos para TikTok de promo de la carpeta Pool parties que diga "POOL PARTY THIS WEEK"'
  );

  assert.ok(direct);
  assert.match(direct.command, /"sourceHint":"Pool parties"/);
  assert.match(direct.content, /carpeta "Pool parties"/);
});

test("web assistant asks for confirmation when promo source is unclear", () => {
  const source = readFileSync("server/assistant.ts", "utf8");

  assert.match(source, /PromoVideoSourceError/);
  assert.match(source, /promoVideoNeedsSourceConfirmation/);
  assert.match(source, /Confirmame cual carpeta quieres usar/);
});

test("web assistant routes Black Room website link add when URL is present", () => {
  const direct = buildDirectBlackRoomCommand(
    "AGREGA BLACK ROOM & FRIENDS A LOS LINKS DE BLACK ROOM https://kongnightlife.com/p/bio-friends"
  );

  assert.ok(direct);
  assert.match(direct.command, /BLACKROOM_LINK_ADD/);
  assert.match(direct.command, /BLACK ROOM & FRIENDS/);
  assert.match(direct.command, /https:\/\/kongnightlife\.com\/p\/bio-friends/);
  assert.doesNotMatch(direct.command, /CREAR_EVENTO_GOOGLE|EDITAR_EVENTO_GOOGLE|MODIFICAR_RADIO/);
});

test("web assistant does not add vague Black Room event link without URL", () => {
  const direct = buildDirectBlackRoomCommand(
    "AGG ESTE EVENTO A L LINK DE BLACK ROOM"
  );

  assert.equal(direct, null);
});

test("web assistant accepts Black Room link updates that only change the URL", () => {
  const source = readFileSync("server/assistant.ts", "utf8");

  assert.match(source, /typeof linkData\.matchTitle === "string" && linkData\.matchTitle\.trim\(\)/);
  assert.match(source, /Falta title o matchTitle para el link/);
});

test("dashboard assistant chat shows Black Room approval creation errors", () => {
  const source = readFileSync("client/src/components/dashboard-assistant-chat.tsx", "utf8");

  assert.match(source, /data\.blackRoomLinkError/);
  assert.match(source, /No pude completar la accion/);
});

test("assistant chats surface radio video status, errors, and cost", () => {
  const dashboardChat = readFileSync("client/src/components/dashboard-assistant-chat.tsx", "utf8");
  const assistantPage = readFileSync("client/src/pages/assistant.tsx", "utf8");
  const webAssistant = readFileSync("server/assistant.ts", "utf8");

  assert.match(dashboardChat, /data\.radioYoutubeError/);
  assert.match(dashboardChat, /data\.radioDriveVideoError/);
  assert.match(dashboardChat, /data\.assistantStatus/);
  assert.match(dashboardChat, /data\.radioYoutubeNeedsConfirmation/);
  assert.match(dashboardChat, /data\.radioDriveVideoNeedsDjName/);
  assert.match(dashboardChat, /streamBuffer/);
  assert.match(dashboardChat, /data\.actionExecutionError/);
  assert.match(assistantPage, /data\.radioYoutubeError/);
  assert.match(assistantPage, /data\.radioDriveVideoError/);
  assert.match(assistantPage, /data\.assistantStatus/);
  assert.match(assistantPage, /data\.radioYoutubeNeedsConfirmation/);
  assert.match(assistantPage, /data\.radioDriveVideoNeedsDjName/);
  assert.match(assistantPage, /streamBuffer/);
  assert.match(assistantPage, /data\.actionExecutionError/);
  assert.match(webAssistant, /actionExecutionError/);
  assert.match(webAssistant, /RADIO_DRIVE_VIDEO_STATUS_MESSAGE/);
  assert.match(webAssistant, /RADIO_YOUTUBE_STATUS_MESSAGE/);
  assert.match(webAssistant, /startAssistantStatusHeartbeat/);
  assert.match(webAssistant, /Tiempo trabajando/);
  assert.match(webAssistant, /withRadioEditEstimatedCost/);
});

test("production health check responds before static fallback", () => {
  const source = readFileSync("server/index.ts", "utf8");
  const healthIndex = source.indexOf('app.get(["/health", "/api/health"]');
  const staticIndex = source.indexOf("serveStatic(app)");

  assert.ok(healthIndex > -1);
  assert.ok(staticIndex > -1);
  assert.ok(healthIndex < staticIndex);
  assert.match(source, /status: "ok"/);
});

test("radio YouTube approval executor fails failed processor results", () => {
  const executor = readFileSync("server/trust-executor.ts", "utf8");

  assert.match(executor, /radioYoutubeResult\.status === "failed"/);
  assert.match(executor, /No pude procesar el link de YouTube para radio/);
});

test("web assistant only auto-executes after explicit chat approval", () => {
  assert.equal(userAlreadyApprovedExecution("si, hazlo"), true);
  assert.equal(userAlreadyApprovedExecution("lo apruebo, ejecutalo"), true);
  assert.equal(userAlreadyApprovedExecution("si quiero que empiece la tarea"), true);
  assert.equal(userAlreadyApprovedExecution("quiero que cambies el link de Black Room"), false);
  assert.equal(userAlreadyApprovedExecution("prepara la tarea para aprobar"), false);
});

test("web assistant can execute one pending approval directly from chat", () => {
  const source = readFileSync("server/assistant.ts", "utf8");

  assert.match(source, /executeSinglePendingApprovalFromChat/);
  assert.match(source, /Tengo varias aprobaciones pendientes/);
  assert.match(source, /Aprobado y ejecutado desde el chat/);
});

test("assistant approval prompt explains chat approval shortcut", () => {
  const dashboardChat = readFileSync("client/src/components/dashboard-assistant-chat.tsx", "utf8");
  const assistantPage = readFileSync("client/src/pages/assistant.tsx", "utf8");

  assert.match(dashboardChat, /Puedes decir "si, hazlo"/);
  assert.match(assistantPage, /Puedes decir "si, hazlo"/);
});
