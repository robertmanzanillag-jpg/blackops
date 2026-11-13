import assert from "node:assert/strict";
import test from "node:test";
import {
  processUserScheduledRemindersWithDeps,
  getReminderSchedulerConfig,
  runRadioTemplateGenerationForUserWithDeps,
  runScheduledAgentActionWithDeps,
  sendDailyNewsDigestForUserWithDeps,
  sendEveningReminderWithDeps,
  sendMorningReminderWithDeps,
  sendProactiveInsightsWithDeps,
  sendWeeklyReminderWithDeps,
  type EveningReminderSchedulerDeps,
  type MorningReminderSchedulerDeps,
  type NewsDigestSchedulerDeps,
  type ProactiveInsightsSchedulerDeps,
  type RadioTemplateGenerationDeps,
  type ScheduledAgentActionDeps,
  type UserScheduledReminderSchedulerDeps,
  type WeeklyReminderSchedulerDeps,
} from "../server/reminder-scheduler";
import type { NewsItem } from "../server/finance";
import type { RadioTemplateRunResult } from "../server/radio-template-agent";
import { getDateKeyFromClock, getZonedClock, shouldRunDailyScheduledJob, type SchedulerClock } from "../server/scheduler-time";

function clock(overrides: Partial<SchedulerClock> = {}): SchedulerClock {
  return {
    year: 2026,
    month: 6,
    day: 15,
    hour: 7,
    minute: 0,
    dayOfWeek: 1,
    ...overrides,
  };
}

function newsItem(id: number): NewsItem {
  return {
    id: `news-${id}`,
    headline: `Headline ${id}`,
    summary: `Summary ${id}`,
    url: `https://example.com/news-${id}`,
    source: "Example",
    datetime: new Date(`2026-06-${String(id).padStart(2, "0")}T12:00:00Z`),
    related: id % 2 === 0 ? "AAPL" : "MSFT",
  };
}

function radioTemplateResult(overrides: Partial<RadioTemplateRunResult> = {}): RadioTemplateRunResult {
  return {
    dateKey: "2026-06-18",
    generated: 0,
    skipped: 0,
    failed: 0,
    files: [],
    ...overrides,
  };
}

test("builds stable date keys from scheduler clocks", () => {
  assert.equal(getDateKeyFromClock(clock()), "2026-6-15");
});

test("runs daily scheduled job only at the configured hour and minute", () => {
  assert.equal(shouldRunDailyScheduledJob(clock({ hour: 7, minute: 0 }), 7, 0, null), true);
  assert.equal(shouldRunDailyScheduledJob(clock({ hour: 6, minute: 59 }), 7, 0, null), false);
  assert.equal(shouldRunDailyScheduledJob(clock({ hour: 7, minute: 1 }), 7, 0, null), false);
});

test("prevents duplicate daily scheduled jobs for the same local date", () => {
  assert.equal(shouldRunDailyScheduledJob(clock(), 7, 0, "2026-6-15"), false);
  assert.equal(shouldRunDailyScheduledJob(clock({ day: 16 }), 7, 0, "2026-6-15"), true);
});

test("uses configured scheduler timezone when reading the local clock", () => {
  const zonedClock = getZonedClock(new Date("2026-06-15T11:00:00Z"), "America/New_York");

  assert.equal(zonedClock.year, 2026);
  assert.equal(zonedClock.month, 6);
  assert.equal(zonedClock.day, 15);
  assert.equal(zonedClock.hour, 7);
  assert.equal(zonedClock.minute, 0);
});

test("reads scheduler env at runtime and falls back from invalid values", () => {
  const original = {
    SCHEDULER_TIMEZONE: process.env.SCHEDULER_TIMEZONE,
    CEO_BRIEF_HOUR: process.env.CEO_BRIEF_HOUR,
    CEO_BRIEF_MINUTE: process.env.CEO_BRIEF_MINUTE,
    INSIGHTS_HOUR: process.env.INSIGHTS_HOUR,
    NEWS_DIGEST_HOUR: process.env.NEWS_DIGEST_HOUR,
    EVENING_REVIEW_HOUR: process.env.EVENING_REVIEW_HOUR,
    DROPSHIPPING_CEO_CYCLE_HOUR: process.env.DROPSHIPPING_CEO_CYCLE_HOUR,
    DROPSHIPPING_CEO_CYCLE_MINUTE: process.env.DROPSHIPPING_CEO_CYCLE_MINUTE,
    DROPSHIPPING_CEO_MORNING_HOUR: process.env.DROPSHIPPING_CEO_MORNING_HOUR,
    DROPSHIPPING_CEO_MORNING_MINUTE: process.env.DROPSHIPPING_CEO_MORNING_MINUTE,
    DROPSHIPPING_CEO_EVENING_HOUR: process.env.DROPSHIPPING_CEO_EVENING_HOUR,
    DROPSHIPPING_CEO_EVENING_MINUTE: process.env.DROPSHIPPING_CEO_EVENING_MINUTE,
  };

  try {
    process.env.SCHEDULER_TIMEZONE = "America/Los_Angeles";
    process.env.CEO_BRIEF_HOUR = "6";
    process.env.CEO_BRIEF_MINUTE = "45";
    process.env.INSIGHTS_HOUR = "10";
    process.env.NEWS_DIGEST_HOUR = "11";
    process.env.EVENING_REVIEW_HOUR = "20";

    assert.deepEqual(getReminderSchedulerConfig(), {
      timezone: "America/Los_Angeles",
      ceoBriefHour: 6,
      ceoBriefMinute: 45,
      insightsHour: 10,
      newsDigestHour: 11,
      eveningReviewHour: 20,
      dropshippingCeoCycleHour: 7,
      dropshippingCeoCycleMinute: 20,
      dropshippingCeoMorningHour: 7,
      dropshippingCeoMorningMinute: 30,
      dropshippingCeoEveningHour: 21,
      dropshippingCeoEveningMinute: 0,
    });

    process.env.CEO_BRIEF_HOUR = "99";
    process.env.CEO_BRIEF_MINUTE = "-1";
    process.env.INSIGHTS_HOUR = "not-a-number";
    process.env.NEWS_DIGEST_HOUR = "24";
    process.env.EVENING_REVIEW_HOUR = "21.5";

    assert.deepEqual(getReminderSchedulerConfig(), {
      timezone: "America/Los_Angeles",
      ceoBriefHour: 7,
      ceoBriefMinute: 0,
      insightsHour: 8,
      newsDigestHour: 9,
      eveningReviewHour: 21,
      dropshippingCeoCycleHour: 7,
      dropshippingCeoCycleMinute: 20,
      dropshippingCeoMorningHour: 7,
      dropshippingCeoMorningMinute: 30,
      dropshippingCeoEveningHour: 21,
      dropshippingCeoEveningMinute: 0,
    });
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("runs morning reminder flow for discovered owners with mocked delivery and run records", async () => {
  const pushCalls: Array<{ userId: string; body: string }> = [];
  const telegramCalls: Array<{ userId: string; title: string; body: string; plainText: boolean }> = [];
  const runRecords: Array<{ userId: string; key: string; status: string; summary: string; metadata: unknown }> = [];
  const deps: MorningReminderSchedulerDeps = {
    getScheduledNotificationUserIds: async () => ["owner-a", "owner-b"],
    getTodaysTasks: async (userId) => ({
      pending: userId === "owner-a" ? ["Call venue", "Review approvals"] : [],
      completed: [],
    }),
    generateCeoMorningBrief: async (userId) => `Brief for ${userId}`,
    sendPushNotification: async (userId, payload) => {
      pushCalls.push({ userId, body: payload.body });
      return true;
    },
    sendTelegramNotificationToUser: async (userId, title, body, plainText) => {
      telegramCalls.push({ userId, title, body, plainText });
      return true;
    },
    recordScheduledAutomationRun: async (userId, key, _startedAt, outcome) => {
      runRecords.push({
        userId,
        key,
        status: outcome.status,
        summary: outcome.resultSummary,
        metadata: outcome.metadata,
      });
    },
    now: () => new Date("2026-06-18T11:00:00Z"),
  };

  const results = await sendMorningReminderWithDeps(deps);

  assert.deepEqual(results, [
    { userId: "owner-a", pendingCount: 2 },
    { userId: "owner-b", pendingCount: 0 },
  ]);
  assert.deepEqual(pushCalls, [
    { userId: "owner-a", body: "2 pendiente(s) para hoy." },
    { userId: "owner-b", body: "Brief ejecutivo listo." },
  ]);
  assert.deepEqual(telegramCalls, [
    { userId: "owner-a", title: "🌅 Brief CEO", body: "Brief for owner-a", plainText: true },
    { userId: "owner-b", title: "🌅 Brief CEO", body: "Brief for owner-b", plainText: true },
  ]);
  assert.deepEqual(runRecords.sort((a, b) => a.userId.localeCompare(b.userId)), [
    {
      userId: "owner-a",
      key: "morning-reminder",
      status: "success",
      summary: "CEO morning brief sent with 2 pending task(s).",
      metadata: { pendingCount: 2 },
    },
    {
      userId: "owner-b",
      key: "morning-reminder",
      status: "success",
      summary: "CEO morning brief sent with 0 pending task(s).",
      metadata: { pendingCount: 0 },
    },
  ]);
});

test("records failed morning reminder runs before surfacing delivery errors", async () => {
  const runRecords: Array<{ userId: string; status: string; errorMessage?: string | null }> = [];
  const deps: MorningReminderSchedulerDeps = {
    getScheduledNotificationUserIds: async () => ["owner-a"],
    getTodaysTasks: async () => ({ pending: ["Call venue"], completed: [] }),
    generateCeoMorningBrief: async () => "Brief",
    sendPushNotification: async () => {
      throw new Error("push unavailable");
    },
    sendTelegramNotificationToUser: async () => true,
    recordScheduledAutomationRun: async (userId, _key, _startedAt, outcome) => {
      runRecords.push({ userId, status: outcome.status, errorMessage: outcome.errorMessage });
    },
    now: () => new Date("2026-06-18T11:00:00Z"),
  };

  await assert.rejects(() => sendMorningReminderWithDeps(deps), /push unavailable/);
  assert.deepEqual(runRecords.sort((a, b) => a.userId.localeCompare(b.userId)), [
    { userId: "owner-a", status: "failed", errorMessage: "push unavailable" },
  ]);
});

test("runs evening reminder flow and skips users with no pending tasks", async () => {
  const pushCalls: Array<{ userId: string; body: string }> = [];
  const telegramCalls: Array<{ userId: string; title: string; body: string; plainText: boolean }> = [];
  const runRecords: Array<{ userId: string; status: string; summary: string; metadata: unknown }> = [];
  const deps: EveningReminderSchedulerDeps = {
    getScheduledNotificationUserIds: async () => ["owner-a", "owner-b"],
    getTodaysTasks: async (userId) => ({
      pending: userId === "owner-a"
        ? ["Call venue", "Review approvals", "Confirm DJ", "Send invoice", "Check door list", "Post story"]
        : [],
      completed: [],
    }),
    sendPushNotification: async (userId, payload) => {
      pushCalls.push({ userId, body: payload.body });
      return true;
    },
    sendTelegramNotificationToUser: async (userId, title, body, plainText) => {
      telegramCalls.push({ userId, title, body, plainText });
      return true;
    },
    recordScheduledAutomationRun: async (userId, _key, _startedAt, outcome) => {
      runRecords.push({
        userId,
        status: outcome.status,
        summary: outcome.resultSummary,
        metadata: outcome.metadata,
      });
    },
    now: () => new Date("2026-06-18T21:00:00-04:00"),
  };

  const results = await sendEveningReminderWithDeps(deps);

  assert.deepEqual(results, [
    { userId: "owner-a", sent: true, pendingCount: 6 },
    { userId: "owner-b", sent: false, pendingCount: 0 },
  ]);
  assert.equal(pushCalls.length, 1);
  assert.equal(pushCalls[0].userId, "owner-a");
  assert.match(pushCalls[0].body, /Quedan 6 tareas por hacer/);
  assert.match(pushCalls[0].body, /\+1 más/);
  assert.deepEqual(telegramCalls, [
    { userId: "owner-a", title: "🌙 Tareas sin Completar", body: pushCalls[0].body, plainText: true },
  ]);
  assert.deepEqual(runRecords.sort((a, b) => a.userId.localeCompare(b.userId)), [
    {
      userId: "owner-a",
      status: "success",
      summary: "Evening reminder sent with 6 pending task(s).",
      metadata: { sent: true, pendingCount: 6 },
    },
    {
      userId: "owner-b",
      status: "skipped",
      summary: "Evening reminder skipped because all tasks are complete.",
      metadata: { sent: false, pendingCount: 0 },
    },
  ]);
});

test("records failed evening reminder runs before surfacing delivery errors", async () => {
  const runRecords: Array<{ userId: string; status: string; errorMessage?: string | null }> = [];
  const deps: EveningReminderSchedulerDeps = {
    getScheduledNotificationUserIds: async () => ["owner-a"],
    getTodaysTasks: async () => ({ pending: ["Call venue"], completed: [] }),
    sendPushNotification: async () => true,
    sendTelegramNotificationToUser: async () => {
      throw new Error("telegram unavailable");
    },
    recordScheduledAutomationRun: async (userId, _key, _startedAt, outcome) => {
      runRecords.push({ userId, status: outcome.status, errorMessage: outcome.errorMessage });
    },
    now: () => new Date("2026-06-18T21:00:00-04:00"),
  };

  await assert.rejects(() => sendEveningReminderWithDeps(deps), /telegram unavailable/);
  assert.deepEqual(runRecords, [
    { userId: "owner-a", status: "failed", errorMessage: "telegram unavailable" },
  ]);
});

test("runs weekly reminder flow and skips users with completed weekly tasks", async () => {
  const pushCalls: Array<{ userId: string; body: string }> = [];
  const telegramCalls: Array<{ userId: string; title: string; body: string; plainText: boolean }> = [];
  const runRecords: Array<{ userId: string; status: string; summary: string; metadata: unknown }> = [];
  const deps: WeeklyReminderSchedulerDeps = {
    getScheduledNotificationUserIds: async () => ["owner-a", "owner-b"],
    getIncompleteWeeklyTasks: async (userId) => userId === "owner-a"
      ? ["Prep sponsor deck", "Close payroll", "Audit ad spend", "Review content queue", "Confirm guest list", "Send recap"]
      : [],
    sendPushNotification: async (userId, payload) => {
      pushCalls.push({ userId, body: payload.body });
      return true;
    },
    sendTelegramNotificationToUser: async (userId, title, body, plainText) => {
      telegramCalls.push({ userId, title, body, plainText });
      return true;
    },
    recordScheduledAutomationRun: async (userId, _key, _startedAt, outcome) => {
      runRecords.push({
        userId,
        status: outcome.status,
        summary: outcome.resultSummary,
        metadata: outcome.metadata,
      });
    },
    now: () => new Date("2026-06-21T18:00:00-04:00"),
  };

  const results = await sendWeeklyReminderWithDeps(deps);

  assert.deepEqual(results, [
    { userId: "owner-a", sent: true, incompleteCount: 6 },
    { userId: "owner-b", sent: false, incompleteCount: 0 },
  ]);
  assert.equal(pushCalls.length, 1);
  assert.equal(pushCalls[0].userId, "owner-a");
  assert.match(pushCalls[0].body, /Tienes 6 tareas semanales pendientes/);
  assert.match(pushCalls[0].body, /\+1 más/);
  assert.deepEqual(telegramCalls, [
    { userId: "owner-a", title: "📅 Tareas Semanales Pendientes", body: pushCalls[0].body, plainText: true },
  ]);
  assert.deepEqual(runRecords.sort((a, b) => a.userId.localeCompare(b.userId)), [
    {
      userId: "owner-a",
      status: "success",
      summary: "Weekly reminder sent with 6 incomplete task(s).",
      metadata: { sent: true, incompleteCount: 6 },
    },
    {
      userId: "owner-b",
      status: "skipped",
      summary: "Weekly reminder skipped because all weekly tasks are complete.",
      metadata: { sent: false, incompleteCount: 0 },
    },
  ]);
});

test("records failed weekly reminder runs before surfacing delivery errors", async () => {
  const runRecords: Array<{ userId: string; status: string; errorMessage?: string | null }> = [];
  const deps: WeeklyReminderSchedulerDeps = {
    getScheduledNotificationUserIds: async () => ["owner-a"],
    getIncompleteWeeklyTasks: async () => ["Prep sponsor deck"],
    sendPushNotification: async () => {
      throw new Error("push unavailable");
    },
    sendTelegramNotificationToUser: async () => true,
    recordScheduledAutomationRun: async (userId, _key, _startedAt, outcome) => {
      runRecords.push({ userId, status: outcome.status, errorMessage: outcome.errorMessage });
    },
    now: () => new Date("2026-06-21T18:00:00-04:00"),
  };

  await assert.rejects(() => sendWeeklyReminderWithDeps(deps), /push unavailable/);
  assert.deepEqual(runRecords, [
    { userId: "owner-a", status: "failed", errorMessage: "push unavailable" },
  ]);
});

test("runs proactive insights flow and records sent and skipped outcomes", async () => {
  const runRecords: Array<{ userId: string; status: string; summary: string; metadata: unknown }> = [];
  const deps: ProactiveInsightsSchedulerDeps = {
    getScheduledNotificationUserIds: async () => ["owner-a", "owner-b"],
    sendProactiveInsights: async (userId) => userId === "owner-a"
      ? { sent: true, insights: 3 }
      : { sent: false, insights: 0 },
    recordScheduledAutomationRun: async (userId, _key, _startedAt, outcome) => {
      runRecords.push({
        userId,
        status: outcome.status,
        summary: outcome.resultSummary,
        metadata: outcome.metadata,
      });
    },
    now: () => new Date("2026-06-18T12:00:00Z"),
  };

  const results = await sendProactiveInsightsWithDeps(deps);

  assert.deepEqual(results, [
    { userId: "owner-a", sent: true, insights: 3 },
    { userId: "owner-b", sent: false, insights: 0 },
  ]);
  assert.deepEqual(runRecords.sort((a, b) => a.userId.localeCompare(b.userId)), [
    {
      userId: "owner-a",
      status: "success",
      summary: "Proactive insights sent with 3 insight(s).",
      metadata: { sent: true, insights: 3 },
    },
    {
      userId: "owner-b",
      status: "skipped",
      summary: "Proactive insights skipped because nothing was sent.",
      metadata: { sent: false, insights: 0 },
    },
  ]);
});

test("records failed proactive insights runs before surfacing errors", async () => {
  const runRecords: Array<{ userId: string; status: string; errorMessage?: string | null }> = [];
  const deps: ProactiveInsightsSchedulerDeps = {
    getScheduledNotificationUserIds: async () => ["owner-a"],
    sendProactiveInsights: async () => {
      throw new Error("insights unavailable");
    },
    recordScheduledAutomationRun: async (userId, _key, _startedAt, outcome) => {
      runRecords.push({ userId, status: outcome.status, errorMessage: outcome.errorMessage });
    },
    now: () => new Date("2026-06-18T12:00:00Z"),
  };

  await assert.rejects(() => sendProactiveInsightsWithDeps(deps), /insights unavailable/);
  assert.deepEqual(runRecords, [
    { userId: "owner-a", status: "failed", errorMessage: "insights unavailable" },
  ]);
});

test("runs scheduled agent action flow and records action success and failed results", async () => {
  const actionCalls: Array<{ actionId: string; userId: string }> = [];
  const runRecords: Array<{ userId: string; key: string; status: string; summary: string; errorMessage?: string | null; metadata: unknown }> = [];
  const deps: ScheduledAgentActionDeps = {
    getScheduledNotificationUserIds: async () => ["owner-a", "owner-b"],
    executeAction: async (actionId, userId) => {
      actionCalls.push({ actionId, userId });
      return userId === "owner-a"
        ? { success: true, message: "Radio slots sent", data: { slots: 2 } }
        : { success: false, message: "Telegram disabled", data: { slots: 2 } };
    },
    recordScheduledAutomationRun: async (userId, key, _startedAt, outcome) => {
      runRecords.push({
        userId,
        key,
        status: outcome.status,
        summary: outcome.resultSummary,
        errorMessage: outcome.errorMessage,
        metadata: outcome.metadata,
      });
    },
    now: () => new Date("2026-06-22T12:00:00Z"),
  };

  const results = await runScheduledAgentActionWithDeps("radio-slot-check", "radio_notify_slots", deps);

  assert.deepEqual(actionCalls, [
    { actionId: "radio_notify_slots", userId: "owner-a" },
    { actionId: "radio_notify_slots", userId: "owner-b" },
  ]);
  assert.deepEqual(results, [
    { userId: "owner-a", success: true, message: "Radio slots sent", data: { slots: 2 } },
    { userId: "owner-b", success: false, message: "Telegram disabled", data: { slots: 2 } },
  ]);
  assert.deepEqual(runRecords.sort((a, b) => a.userId.localeCompare(b.userId)), [
    {
      userId: "owner-a",
      key: "radio-slot-check",
      status: "success",
      summary: "Radio slots sent",
      errorMessage: null,
      metadata: { success: true, message: "Radio slots sent", data: { slots: 2 } },
    },
    {
      userId: "owner-b",
      key: "radio-slot-check",
      status: "failed",
      summary: "Telegram disabled",
      errorMessage: "Telegram disabled",
      metadata: { success: false, message: "Telegram disabled", data: { slots: 2 } },
    },
  ]);
});

test("records failed scheduled agent action runs before surfacing thrown errors", async () => {
  const runRecords: Array<{ userId: string; key: string; status: string; summary: string; errorMessage?: string | null; metadata: unknown }> = [];
  const deps: ScheduledAgentActionDeps = {
    getScheduledNotificationUserIds: async () => ["owner-a"],
    executeAction: async () => {
      throw new Error("action unavailable");
    },
    recordScheduledAutomationRun: async (userId, key, _startedAt, outcome) => {
      runRecords.push({
        userId,
        key,
        status: outcome.status,
        summary: outcome.resultSummary,
        errorMessage: outcome.errorMessage,
        metadata: outcome.metadata,
      });
    },
    now: () => new Date("2026-06-22T12:00:00Z"),
  };

  await assert.rejects(
    () => runScheduledAgentActionWithDeps("portfolio-weekly-report", "portfolio_weekly_report", deps),
    /action unavailable/,
  );
  assert.deepEqual(runRecords, [
    {
      userId: "owner-a",
      key: "portfolio-weekly-report",
      status: "failed",
      summary: "portfolio-weekly-report failed",
      errorMessage: "action unavailable",
      metadata: { error: "action unavailable" },
    },
  ]);
});

test("records radio template generation runs from generated skipped and failed file totals", async () => {
  const automationRuns: Array<{ status: string; summary: string; errorMessage: string | null; metadata: unknown }> = [];
  const deps: RadioTemplateGenerationDeps = {
    ensureDefaultAutomations: async () => [
      { id: "automation-radio-template", costEstimate: "medium", metadata: { key: "radio-template-generation" } },
    ],
    generateRadioTemplatesForDate: async () => radioTemplateResult({
      generated: 2,
      skipped: 1,
      failed: 1,
      files: [
        {
          eventId: "radio-1",
          eventDate: "2026-06-18",
          slotHour: 9,
          djName: "DJ Ready",
          filename: "ready.png",
          canvaDesignId: null,
          canvaEditUrl: null,
          canvaViewUrl: null,
          driveFileId: null,
          driveLink: null,
          status: "failed",
          errorMessage: "Drive unavailable",
        },
      ],
    }),
    createAutomationRun: async (run) => {
      automationRuns.push({
        status: run.status,
        summary: run.resultSummary,
        errorMessage: run.errorMessage,
        metadata: run.metadata,
      });
    },
    now: () => new Date("2026-06-18T12:15:00Z"),
  };

  const summary = await runRadioTemplateGenerationForUserWithDeps("owner-a", deps);

  assert.equal(summary, "Radio templates failed: 2 generated, 1 skipped, 1 failed for 2026-06-18");
  assert.deepEqual(automationRuns, [
    {
      status: "failed",
      summary: "Radio templates failed: 2 generated, 1 skipped, 1 failed for 2026-06-18",
      errorMessage: "Drive unavailable",
      metadata: radioTemplateResult({
        generated: 2,
        skipped: 1,
        failed: 1,
        files: [
          {
            eventId: "radio-1",
            eventDate: "2026-06-18",
            slotHour: 9,
            djName: "DJ Ready",
            filename: "ready.png",
            canvaDesignId: null,
            canvaEditUrl: null,
            canvaViewUrl: null,
            driveFileId: null,
            driveLink: null,
            status: "failed",
            errorMessage: "Drive unavailable",
          },
        ],
      }),
    },
  ]);
});

test("records skipped radio template generation when there are no files to process", async () => {
  const automationRuns: Array<{ status: string; summary: string; errorMessage: string | null }> = [];
  const deps: RadioTemplateGenerationDeps = {
    ensureDefaultAutomations: async () => [
      { id: "automation-radio-template", costEstimate: "medium", metadata: { key: "radio-template-generation" } },
    ],
    generateRadioTemplatesForDate: async () => radioTemplateResult(),
    createAutomationRun: async (run) => {
      automationRuns.push({
        status: run.status,
        summary: run.resultSummary,
        errorMessage: run.errorMessage,
      });
    },
    now: () => new Date("2026-06-18T12:15:00Z"),
  };

  const summary = await runRadioTemplateGenerationForUserWithDeps("owner-a", deps);

  assert.equal(summary, "Radio templates skipped: 0 generated, 0 skipped, 0 failed for 2026-06-18");
  assert.deepEqual(automationRuns, [
    {
      status: "skipped",
      summary: "Radio templates skipped: 0 generated, 0 skipped, 0 failed for 2026-06-18",
      errorMessage: null,
    },
  ]);
});

test("records failed radio template generation when the generator throws", async () => {
  const automationRuns: Array<{ status: string; summary: string; errorMessage: string | null; metadata: unknown }> = [];
  const deps: RadioTemplateGenerationDeps = {
    ensureDefaultAutomations: async () => [
      { id: "automation-radio-template", costEstimate: "medium", metadata: { key: "radio-template-generation" } },
    ],
    generateRadioTemplatesForDate: async () => {
      throw new Error("Canva unavailable");
    },
    createAutomationRun: async (run) => {
      automationRuns.push({
        status: run.status,
        summary: run.resultSummary,
        errorMessage: run.errorMessage,
        metadata: run.metadata,
      });
    },
    now: () => new Date("2026-06-18T12:15:00Z"),
  };

  const summary = await runRadioTemplateGenerationForUserWithDeps("owner-a", deps);

  assert.equal(summary, "Radio templates failed: Canva unavailable");
  assert.deepEqual(automationRuns, [
    {
      status: "failed",
      summary: "Radio template generation failed",
      errorMessage: "Canva unavailable",
      metadata: { error: "Canva unavailable" },
    },
  ]);
});

test("sends due user scheduled reminders once per local date", async () => {
  const sentReminderKeys = new Map<string, string>();
  const telegramCalls: Array<{ userId: string; title: string; body: string; plainText: boolean }> = [];
  const deps: UserScheduledReminderSchedulerDeps = {
    getActiveScheduledReminders: async () => [
      {
        id: "reminder-due",
        userId: "owner-a",
        message: "Review ticket sales",
        hour: 7,
        minute: 30,
        daysOfWeek: ["monday"],
      },
      {
        id: "reminder-wrong-day",
        userId: "owner-a",
        message: "Sunday-only reminder",
        hour: 7,
        minute: 30,
        daysOfWeek: ["sunday"],
      },
      {
        id: "reminder-wrong-time",
        userId: "owner-b",
        message: "Later reminder",
        hour: 8,
        minute: 30,
        daysOfWeek: null,
      },
    ],
    getZonedClock: () => clock({ hour: 7, minute: 30, dayOfWeek: 1 }),
    sendTelegramNotificationToUser: async (userId, title, body, plainText) => {
      telegramCalls.push({ userId, title, body, plainText });
      return true;
    },
    sentReminderKeys,
  };

  const firstRun = await processUserScheduledRemindersWithDeps(
    new Date("2026-06-15T11:30:00Z"),
    "2026-6-15",
    deps,
  );
  const duplicateRun = await processUserScheduledRemindersWithDeps(
    new Date("2026-06-15T11:30:00Z"),
    "2026-6-15",
    deps,
  );

  assert.deepEqual(firstRun, [
    { reminderId: "reminder-due", userId: "owner-a", message: "Review ticket sales", sent: true },
  ]);
  assert.deepEqual(duplicateRun, []);
  assert.deepEqual(telegramCalls, [
    {
      userId: "owner-a",
      title: "⏰ Recordatorio",
      body: "Review ticket sales",
      plainText: true,
    },
  ]);
  assert.equal(sentReminderKeys.get("reminder-due-2026-6-15"), "2026-6-15");
});

test("lets daily user scheduled reminders run again on a new local date", async () => {
  const sentReminderKeys = new Map<string, string>([["reminder-daily-2026-6-15", "2026-6-15"]]);
  const telegramCalls: string[] = [];
  const deps: UserScheduledReminderSchedulerDeps = {
    getActiveScheduledReminders: async () => [
      {
        id: "reminder-daily",
        userId: "owner-a",
        message: "Daily closeout",
        hour: 21,
        minute: 0,
        daysOfWeek: null,
      },
    ],
    getZonedClock: () => clock({ day: 16, hour: 21, minute: 0, dayOfWeek: 2 }),
    sendTelegramNotificationToUser: async (_userId, _title, body) => {
      telegramCalls.push(body);
      return true;
    },
    sentReminderKeys,
  };

  const results = await processUserScheduledRemindersWithDeps(
    new Date("2026-06-17T01:00:00Z"),
    "2026-6-16",
    deps,
  );

  assert.deepEqual(results, [
    { reminderId: "reminder-daily", userId: "owner-a", message: "Daily closeout", sent: true },
  ]);
  assert.deepEqual(telegramCalls, ["Daily closeout"]);
  assert.equal(sentReminderKeys.get("reminder-daily-2026-6-16"), "2026-6-16");
});

test("does not mark user scheduled reminders as sent when Telegram delivery returns false", async () => {
  const sentReminderKeys = new Map<string, string>();
  const deps: UserScheduledReminderSchedulerDeps = {
    getActiveScheduledReminders: async () => [
      {
        id: "reminder-undelivered",
        userId: "owner-a",
        message: "Retry me",
        hour: 7,
        minute: 0,
        daysOfWeek: null,
      },
    ],
    getZonedClock: () => clock({ hour: 7, minute: 0 }),
    sendTelegramNotificationToUser: async () => false,
    sentReminderKeys,
  };

  const result = await processUserScheduledRemindersWithDeps(
    new Date("2026-06-15T11:00:00Z"),
    "2026-6-15",
    deps,
  );

  assert.deepEqual(result, []);
  assert.equal(sentReminderKeys.has("reminder-undelivered-2026-6-15"), false);
});

test("does not mark user scheduled reminders as sent when Telegram delivery throws", async () => {
  const sentReminderKeys = new Map<string, string>();
  const deps: UserScheduledReminderSchedulerDeps = {
    getActiveScheduledReminders: async () => [
      {
        id: "reminder-error",
        userId: "owner-a",
        message: "Retry after error",
        hour: 7,
        minute: 0,
        daysOfWeek: null,
      },
    ],
    getZonedClock: () => clock({ hour: 7, minute: 0 }),
    sendTelegramNotificationToUser: async () => {
      throw new Error("telegram unavailable");
    },
    sentReminderKeys,
  };

  await assert.rejects(
    () => processUserScheduledRemindersWithDeps(new Date("2026-06-15T11:00:00Z"), "2026-6-15", deps),
    /telegram unavailable/,
  );
  assert.equal(sentReminderKeys.has("reminder-error-2026-6-15"), false);
});

test("skips daily news digest when the user has no portfolio symbols", async () => {
  let newsRequested = false;
  const deps: NewsDigestSchedulerDeps = {
    getInvestments: async () => [],
    getPortfolioNews: async () => {
      newsRequested = true;
      return [];
    },
    sendTelegramNotificationToUser: async () => {
      throw new Error("telegram should not be called");
    },
  };

  const result = await sendDailyNewsDigestForUserWithDeps("owner-a", deps);

  assert.deepEqual(result, { sent: false, newsCount: 0 });
  assert.equal(newsRequested, false);
});

test("skips daily news digest when portfolio news is empty", async () => {
  const telegramCalls: string[] = [];
  const deps: NewsDigestSchedulerDeps = {
    getInvestments: async () => [{ symbol: "AAPL" }, { symbol: "MSFT" }],
    getPortfolioNews: async (symbols) => {
      assert.deepEqual(symbols, ["AAPL", "MSFT"]);
      return [];
    },
    sendTelegramNotificationToUser: async (_userId, _title, body) => {
      telegramCalls.push(body);
      return true;
    },
  };

  const result = await sendDailyNewsDigestForUserWithDeps("owner-a", deps);

  assert.deepEqual(result, { sent: false, newsCount: 0 });
  assert.deepEqual(telegramCalls, []);
});

test("sends daily news digest with top five links and total news count", async () => {
  const telegramCalls: Array<{ userId: string; title: string; body: string; plainText: boolean }> = [];
  const deps: NewsDigestSchedulerDeps = {
    getInvestments: async () => [{ symbol: "AAPL" }, { symbol: "MSFT" }],
    getPortfolioNews: async () => [1, 2, 3, 4, 5, 6].map(newsItem),
    sendTelegramNotificationToUser: async (userId, title, body, plainText) => {
      telegramCalls.push({ userId, title, body, plainText });
      return true;
    },
  };

  const result = await sendDailyNewsDigestForUserWithDeps("owner-a", deps);

  assert.deepEqual(result, { sent: true, newsCount: 6 });
  assert.equal(telegramCalls.length, 1);
  assert.equal(telegramCalls[0].userId, "owner-a");
  assert.equal(telegramCalls[0].title, "📰 Noticias de tu Portafolio");
  assert.equal(telegramCalls[0].plainText, true);
  assert.match(telegramCalls[0].body, /1\. MSFT: Headline 1/);
  assert.match(telegramCalls[0].body, /5\. MSFT: Headline 5/);
  assert.doesNotMatch(telegramCalls[0].body, /Headline 6/);
  assert.match(telegramCalls[0].body, /Total: 6 noticias disponibles/);
});
