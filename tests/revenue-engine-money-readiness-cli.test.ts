import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRevenueMoneyReadinessReport,
  formatRevenueMoneyReadinessText,
  hydrateRevenueMoneyReadinessSnapshot,
  parseRevenueMoneyReadinessArgs,
  validateRevenueMoneyReadinessOptions,
} from "../server/revenue-engine-money-readiness-cli";

function snapshotFixture(overrides: Partial<Parameters<typeof buildRevenueMoneyReadinessReport>[0]> = {}) {
  const base = {
    dailyMoneyCommand: {
      status: "search",
      primaryAction: "Buscar negocios publicos hoy y guardar candidatos verificados.",
      runPacket: {
        apiAction: "/api/revenue-engine/scout-dispatch",
        gate: "Public evidence only.",
      },
      safety: {
        sendsOutreach: false,
        spendsMoney: false,
        deploys: false,
      },
    },
    moneyActivationPlan: {
      status: "dry_run_research_only",
      headline: "Puede buscar negocios en modo dry-run; falta activar money mode real.",
      canStartToday: true,
      canContactBusinesses: false,
      canCollectMoney: false,
      canBuildWebsites: false,
      nextRobertAction: "Crear Postgres persistente.",
      allowedToday: ["buscar negocios publicos", "guardar candidatos con evidencia verificable"],
      blockedUntilApproved: ["client charge/deposit confirmation"],
      missingBeforeRealMoney: [
        {
          id: "production_database",
          label: "Configurar DATABASE_URL real",
          nextStep: "Crear Postgres en Replit o proveedor gestionado.",
        },
      ],
      evidenceGate: {
        status: "empty",
        readyCandidates: 0,
        blockedCandidates: 0,
        requiredFields: ["sourceUrl", "contactPath"],
        blockedActions: ["run Money Sprint from placeholders", "contact business before Robert approval"],
      },
      productionLaunchChecklist: {
        status: "blocked",
        deploymentApprovalPacket: {
          status: "waiting_for_external_evidence",
          blockedUntil: ["DATABASE_URL real: Crear Postgres en Replit o proveedor gestionado."],
        },
        productionSetupPacket: {
          status: "blocked",
          requiredEnv: [
            { key: "DATABASE_URL", status: "blocked", nextStep: "Crear Postgres." },
            { key: "SESSION_SECRET", status: "blocked", nextStep: "Configurar SESSION_SECRET fuerte." },
          ],
        },
      },
    },
  };

  return {
    ...base,
    ...overrides,
    dailyMoneyCommand: {
      ...base.dailyMoneyCommand,
      ...overrides.dailyMoneyCommand,
    },
    moneyActivationPlan: {
      ...base.moneyActivationPlan,
      ...overrides.moneyActivationPlan,
    },
  };
}

test("parses Revenue Engine money readiness CLI options", () => {
  assert.deepEqual(parseRevenueMoneyReadinessArgs([]), { json: false, mode: "research", userId: "" });
  assert.deepEqual(parseRevenueMoneyReadinessArgs(["--json", "--mode=first-sprint", "--user-id=owner-a"]), { json: true, mode: "first-sprint", userId: "owner-a" });
});

test("hydrates durable state for the requested owner before reading the real snapshot", async () => {
  const calls: string[] = [];
  const snapshot = { marker: "hydrated" };
  const result = await hydrateRevenueMoneyReadinessSnapshot(
    { json: true, mode: "first-sprint", userId: "owner-a" },
    {
      async initializePersistence() { calls.push("initialize"); },
      async prepareState(userId) { calls.push(`prepare:${userId}`); },
      getSnapshot() { calls.push("snapshot"); return snapshot; },
    },
    { DATABASE_URL: "postgres://configured" },
  );

  assert.equal(result, snapshot);
  assert.deepEqual(calls, ["initialize", "prepare:owner-a", "snapshot"]);
});

test("requires an explicit durable owner when DATABASE_URL is configured", async () => {
  await assert.rejects(
    hydrateRevenueMoneyReadinessSnapshot(
      { json: false, mode: "research", userId: "" },
      {
        async initializePersistence() {},
        async prepareState() {},
        getSnapshot() { return snapshotFixture(); },
      },
      { DATABASE_URL: "postgres://configured" },
    ),
    /--user-id or DEFAULT_USER_ID/,
  );
});

test("validates Revenue Engine money readiness mode", () => {
  assert.deepEqual(validateRevenueMoneyReadinessOptions(parseRevenueMoneyReadinessArgs(["--mode=money-mode"])), []);
  assert.deepEqual(validateRevenueMoneyReadinessOptions(parseRevenueMoneyReadinessArgs(["--mode=fast-money"])), [
    "--mode must be one of: research, first-sprint, money-mode, production-launch.",
  ]);
});

test("reports research mode ready while real money remains blocked", () => {
  const report = buildRevenueMoneyReadinessReport(snapshotFixture(), { json: false, mode: "research" });

  assert.equal(report.ready, true);
  assert.equal(report.canStartToday, true);
  assert.equal(report.canCollectMoney, false);
  assert.equal(report.checks.find((check) => check.id === "safe_public_research")?.ok, true);
  assert.equal(report.checks.find((check) => check.id === "production_persistence")?.ok, false);
  assert.equal(report.blockedUntil.some((item) => item.includes("DATABASE_URL")), true);
});

test("requires production persistence for first sprint readiness", () => {
  const report = buildRevenueMoneyReadinessReport(snapshotFixture({
    moneyActivationPlan: {
      status: "ready_for_first_sprint",
      headline: "Listo para preparar el primer sprint.",
      canStartToday: true,
      canContactBusinesses: false,
      canCollectMoney: true,
      canBuildWebsites: false,
      nextRobertAction: "Aprobar el siguiente batch controlado.",
      allowedToday: ["buscar negocios publicos"],
      blockedUntilApproved: ["outreach send", "cobrar cliente"],
      missingBeforeRealMoney: [],
      evidenceGate: {
        status: "ready",
        readyCandidates: 3,
        blockedCandidates: 1,
        requiredFields: ["sourceUrl", "contactPath"],
        blockedActions: ["run Money Sprint from placeholders"],
      },
      productionLaunchChecklist: {
        status: "blocked",
        deploymentApprovalPacket: {
          status: "waiting_for_external_evidence",
          blockedUntil: ["App QA release gate"],
        },
        productionSetupPacket: {
          status: "ready",
          requiredEnv: [
            { key: "DATABASE_URL", status: "ready", nextStep: "Correr db check." },
            { key: "SESSION_SECRET", status: "ready", nextStep: "Mantener como secret." },
          ],
        },
      },
    },
  }), { json: false, mode: "first-sprint" });

  assert.equal(report.ready, true);
  assert.equal(report.canCollectMoney, true);
  assert.equal(report.checks.find((check) => check.id === "production_persistence")?.ok, true);
  assert.equal(report.checks.find((check) => check.id === "session_secret")?.ok, true);
  assert.equal(report.checks.find((check) => check.id === "production_launch")?.ok, false);
});

test("blocks first sprint when session secret is missing", () => {
  const report = buildRevenueMoneyReadinessReport(snapshotFixture({
    moneyActivationPlan: {
      status: "ready_for_first_sprint",
      headline: "Listo para preparar el primer sprint.",
      canStartToday: true,
      canContactBusinesses: false,
      canCollectMoney: true,
      canBuildWebsites: false,
      nextRobertAction: "Configurar SESSION_SECRET.",
      allowedToday: ["buscar negocios publicos"],
      blockedUntilApproved: ["outreach send", "cobrar cliente"],
      missingBeforeRealMoney: [],
      evidenceGate: {
        status: "ready",
        readyCandidates: 3,
        blockedCandidates: 1,
        requiredFields: ["sourceUrl", "contactPath"],
        blockedActions: ["run Money Sprint from placeholders"],
      },
      productionLaunchChecklist: {
        status: "blocked",
        deploymentApprovalPacket: {
          status: "waiting_for_external_evidence",
          blockedUntil: ["App QA release gate"],
        },
        productionSetupPacket: {
          status: "blocked",
          requiredEnv: [
            { key: "DATABASE_URL", status: "ready", nextStep: "Correr db check." },
            { key: "SESSION_SECRET", status: "blocked", nextStep: "Configurar SESSION_SECRET fuerte." },
          ],
        },
      },
    },
  }), { json: false, mode: "first-sprint" });

  assert.equal(report.ready, false);
  assert.equal(report.checks.find((check) => check.id === "production_persistence")?.ok, true);
  assert.equal(report.checks.find((check) => check.id === "session_secret")?.ok, false);
});

test("production launch mode requires launch checklist and production setup packet", () => {
  const report = buildRevenueMoneyReadinessReport(snapshotFixture({
    moneyActivationPlan: {
      status: "ready_for_first_sprint",
      headline: "Launch evidence ready but setup incomplete.",
      canStartToday: true,
      canContactBusinesses: false,
      canCollectMoney: true,
      canBuildWebsites: true,
      nextRobertAction: "Configurar SESSION_SECRET.",
      allowedToday: ["buscar negocios publicos"],
      blockedUntilApproved: ["deploy/publish"],
      missingBeforeRealMoney: [],
      evidenceGate: {
        status: "ready",
        readyCandidates: 3,
        blockedCandidates: 0,
        requiredFields: ["sourceUrl", "contactPath"],
        blockedActions: ["run Money Sprint from placeholders"],
      },
      productionLaunchChecklist: {
        status: "ready",
        deploymentApprovalPacket: {
          status: "approved",
          blockedUntil: ["none"],
        },
        productionSetupPacket: {
          status: "blocked",
          requiredEnv: [
            { key: "DATABASE_URL", status: "ready", nextStep: "Correr db check." },
            { key: "SESSION_SECRET", status: "blocked", nextStep: "Configurar SESSION_SECRET fuerte." },
          ],
        },
      },
    },
  }), { json: false, mode: "production-launch" });

  assert.equal(report.ready, false);
  assert.equal(report.checks.find((check) => check.id === "production_launch")?.ok, false);
  assert.equal(report.checks.find((check) => check.id === "session_secret")?.ok, false);
});

test("money mode requires production setup packet", () => {
  const report = buildRevenueMoneyReadinessReport(snapshotFixture({
    moneyActivationPlan: {
      status: "ready_for_money_mode",
      headline: "Controlled money mode otherwise ready.",
      canStartToday: true,
      canContactBusinesses: false,
      canCollectMoney: true,
      canBuildWebsites: false,
      nextRobertAction: "Configurar SESSION_SECRET.",
      allowedToday: ["buscar negocios publicos"],
      blockedUntilApproved: ["outreach send", "cobrar cliente"],
      missingBeforeRealMoney: [],
      evidenceGate: {
        status: "ready",
        readyCandidates: 3,
        blockedCandidates: 1,
        requiredFields: ["sourceUrl", "contactPath"],
        blockedActions: ["run Money Sprint from placeholders"],
      },
      productionLaunchChecklist: {
        status: "blocked",
        deploymentApprovalPacket: {
          status: "waiting_for_external_evidence",
          blockedUntil: ["App QA release gate"],
        },
        productionSetupPacket: {
          status: "blocked",
          requiredEnv: [
            { key: "DATABASE_URL", status: "ready", nextStep: "Correr db check." },
            { key: "SESSION_SECRET", status: "blocked", nextStep: "Configurar SESSION_SECRET fuerte." },
          ],
        },
      },
    },
  }), { json: false, mode: "money-mode" });

  assert.equal(report.ready, false);
  assert.equal(report.checks.find((check) => check.id === "money_mode")?.ok, false);
  assert.equal(report.checks.find((check) => check.id === "session_secret")?.ok, false);
});

test("production launch mode passes only when launch checklist and setup packet are ready", () => {
  const report = buildRevenueMoneyReadinessReport(snapshotFixture({
    moneyActivationPlan: {
      status: "ready_for_first_sprint",
      headline: "Launch evidence ready.",
      canStartToday: true,
      canContactBusinesses: false,
      canCollectMoney: true,
      canBuildWebsites: true,
      nextRobertAction: "Deploy approval recorded.",
      allowedToday: ["buscar negocios publicos"],
      blockedUntilApproved: ["deploy/publish"],
      missingBeforeRealMoney: [],
      evidenceGate: {
        status: "ready",
        readyCandidates: 3,
        blockedCandidates: 0,
        requiredFields: ["sourceUrl", "contactPath"],
        blockedActions: ["run Money Sprint from placeholders"],
      },
      productionLaunchChecklist: {
        status: "ready",
        deploymentApprovalPacket: {
          status: "approved",
          blockedUntil: ["none"],
        },
        productionSetupPacket: {
          status: "ready",
          requiredEnv: [
            { key: "DATABASE_URL", status: "ready", nextStep: "Correr db check." },
            { key: "SESSION_SECRET", status: "ready", nextStep: "Mantener como secret." },
          ],
        },
      },
    },
  }), { json: false, mode: "production-launch" });

  assert.equal(report.ready, true);
  assert.equal(report.checks.find((check) => check.id === "production_launch")?.ok, true);
  assert.equal(report.checks.find((check) => check.id === "session_secret")?.ok, true);
});

test("formats Revenue Engine money readiness output", () => {
  const output = formatRevenueMoneyReadinessText(
    buildRevenueMoneyReadinessReport(snapshotFixture(), { json: false, mode: "research" }),
  );

  assert.match(output, /Revenue Engine Money Readiness/);
  assert.match(output, /Mode: research/);
  assert.match(output, /Ready: yes/);
  assert.match(output, /Allowed today:/);
  assert.match(output, /Blocked until:/);
});
