export type RevenueMoneyReadinessMode = "research" | "first-sprint" | "money-mode" | "production-launch";

export type RevenueMoneyReadinessCliOptions = {
  json: boolean;
  mode: RevenueMoneyReadinessMode;
  userId?: string;
};

type RevenueMoneyReadinessCheck = {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
};

type RevenueMoneyReadinessSnapshot = {
  dailyMoneyCommand: {
    status: string;
    primaryAction: string;
    runPacket: {
      apiAction: string;
      gate: string;
    };
    safety: {
      sendsOutreach: boolean;
      spendsMoney: boolean;
      deploys: boolean;
    };
  };
  moneyActivationPlan: {
    status: string;
    headline: string;
    canStartToday: boolean;
    canContactBusinesses: boolean;
    canCollectMoney: boolean;
    canBuildWebsites: boolean;
    nextRobertAction: string;
    allowedToday: string[];
    blockedUntilApproved: string[];
    missingBeforeRealMoney: Array<{ id: string; label: string; nextStep: string }>;
    evidenceGate: {
      status: string;
      readyCandidates: number;
      blockedCandidates: number;
      requiredFields: string[];
      blockedActions: string[];
    };
    productionLaunchChecklist: {
      status: string;
      deploymentApprovalPacket: {
        status: string;
        blockedUntil: string[];
      };
      productionSetupPacket: {
        status: string;
        requiredEnv: Array<{ key: string; status: string; nextStep: string }>;
      };
    };
  };
};

export type RevenueMoneyReadinessReport = {
  ready: boolean;
  mode: RevenueMoneyReadinessMode;
  status: string;
  headline: string;
  nextAction: string;
  nextApiAction: string;
  canStartToday: boolean;
  canContactBusinesses: boolean;
  canCollectMoney: boolean;
  canBuildWebsites: boolean;
  checks: RevenueMoneyReadinessCheck[];
  blockedUntil: string[];
  allowedToday: string[];
};

const modes: RevenueMoneyReadinessMode[] = ["research", "first-sprint", "money-mode", "production-launch"];

export function parseRevenueMoneyReadinessArgs(argv: string[]): RevenueMoneyReadinessCliOptions {
  const getValue = (name: string) => {
    const prefix = `${name}=`;
    const arg = argv.find((value) => value.startsWith(prefix));
    return arg ? arg.slice(prefix.length).trim() : "";
  };

  const mode = getValue("--mode") || "research";
  return {
    json: argv.includes("--json"),
    mode: mode as RevenueMoneyReadinessMode,
    userId: getValue("--user-id"),
  };
}

export async function hydrateRevenueMoneyReadinessSnapshot<T>(
  options: RevenueMoneyReadinessCliOptions,
  dependencies: {
    initializePersistence: () => Promise<unknown>;
    prepareState: (userId: string) => Promise<unknown>;
    getSnapshot: () => T;
  },
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): Promise<T> {
  if (env.DATABASE_URL) {
    const userId = options.userId || env.DEFAULT_USER_ID?.trim() || "";
    if (!userId) {
      throw new Error("--user-id or DEFAULT_USER_ID is required to verify Revenue Engine durable persistence.");
    }
    await dependencies.initializePersistence();
    await dependencies.prepareState(userId);
  }
  return dependencies.getSnapshot();
}

export function validateRevenueMoneyReadinessOptions(options: RevenueMoneyReadinessCliOptions): string[] {
  return modes.includes(options.mode)
    ? []
    : [`--mode must be one of: ${modes.join(", ")}.`];
}

export function buildRevenueMoneyReadinessReport(
  snapshot: RevenueMoneyReadinessSnapshot,
  options: RevenueMoneyReadinessCliOptions,
): RevenueMoneyReadinessReport {
  const plan = snapshot.moneyActivationPlan;
  const command = snapshot.dailyMoneyCommand;
  const productionDatabaseMissing = plan.missingBeforeRealMoney.some((item) => item.id === "production_database");
  const setupPacket = plan.productionLaunchChecklist.productionSetupPacket;
  const sessionSecretReady = setupPacket.requiredEnv.some((item) => item.key === "SESSION_SECRET" && item.status === "ready");
  const safeDryRun = command.safety.sendsOutreach === false
    && command.safety.spendsMoney === false
    && command.safety.deploys === false;
  const researchReady = plan.canStartToday && safeDryRun;
  const productionSetupReady = setupPacket.status === "ready" && sessionSecretReady && !productionDatabaseMissing;
  const firstSprintReady = ["ready_for_first_sprint", "ready_for_money_mode"].includes(plan.status)
    && plan.canCollectMoney
    && productionSetupReady;
  const moneyModeReady = plan.status === "ready_for_money_mode" && productionSetupReady;
  const productionLaunchReady = plan.productionLaunchChecklist.status === "ready" && productionSetupReady;

  const modeReady = {
    research: researchReady,
    "first-sprint": firstSprintReady,
    "money-mode": moneyModeReady,
    "production-launch": productionLaunchReady,
  }[options.mode];

  const checks: RevenueMoneyReadinessCheck[] = [
    {
      id: "safe_public_research",
      label: "Safe public research",
      ok: researchReady,
      detail: researchReady
        ? `Can start today with ${command.runPacket.apiAction}.`
        : `Blocked by ${command.status}: ${command.runPacket.gate}`,
    },
    {
      id: "evidence_gate",
      label: "Lead evidence gate",
      ok: plan.evidenceGate.requiredFields.includes("sourceUrl")
        && plan.evidenceGate.blockedActions.includes("run Money Sprint from placeholders"),
      detail: `${plan.evidenceGate.readyCandidates} ready candidates, ${plan.evidenceGate.blockedCandidates} blocked candidates, required fields: ${plan.evidenceGate.requiredFields.join(", ")}.`,
    },
    {
      id: "production_persistence",
      label: "Production persistence",
      ok: !productionDatabaseMissing,
      detail: productionDatabaseMissing
        ? plan.missingBeforeRealMoney.find((item) => item.id === "production_database")?.nextStep || "Configure production DATABASE_URL."
        : "Production DATABASE_URL is ready for first sprint state.",
    },
    {
      id: "session_secret",
      label: "Session secret",
      ok: sessionSecretReady,
      detail: sessionSecretReady
        ? "SESSION_SECRET is strong enough for production setup."
        : setupPacket.requiredEnv.find((item) => item.key === "SESSION_SECRET")?.nextStep || "Configure strong SESSION_SECRET.",
    },
    {
      id: "money_mode",
      label: "Controlled money mode",
      ok: moneyModeReady,
      detail: moneyModeReady
        ? "Controlled autopilot money mode is ready."
        : `Current activation status: ${plan.status}.`,
    },
    {
      id: "production_launch",
      label: "Production launch gate",
      ok: productionLaunchReady,
      detail: productionLaunchReady
        ? "Production launch checklist is ready."
        : `Launch checklist ${plan.productionLaunchChecklist.status}; deploy approval packet ${plan.productionLaunchChecklist.deploymentApprovalPacket.status}.`,
    },
  ];

  return {
    ready: modeReady,
    mode: options.mode,
    status: plan.status,
    headline: plan.headline,
    nextAction: plan.nextRobertAction,
    nextApiAction: command.runPacket.apiAction,
    canStartToday: plan.canStartToday,
    canContactBusinesses: plan.canContactBusinesses,
    canCollectMoney: plan.canCollectMoney,
    canBuildWebsites: plan.canBuildWebsites,
    checks,
    blockedUntil: Array.from(new Set([
      ...plan.blockedUntilApproved,
      ...plan.missingBeforeRealMoney.map((item) => `${item.label}: ${item.nextStep}`),
      ...plan.productionLaunchChecklist.deploymentApprovalPacket.blockedUntil,
    ])).filter((item) => item !== "none"),
    allowedToday: plan.allowedToday,
  };
}

export function formatRevenueMoneyReadinessText(report: RevenueMoneyReadinessReport): string {
  return [
    "Revenue Engine Money Readiness",
    `Mode: ${report.mode}`,
    `Status: ${report.status}`,
    `Ready: ${report.ready ? "yes" : "no"}`,
    `Headline: ${report.headline}`,
    `Next API: ${report.nextApiAction}`,
    `Next action: ${report.nextAction}`,
    "",
    "Capabilities:",
    `- Start today: ${report.canStartToday ? "yes" : "no"}`,
    `- Contact businesses: ${report.canContactBusinesses ? "yes" : "no"}`,
    `- Collect money: ${report.canCollectMoney ? "yes" : "no"}`,
    `- Build websites: ${report.canBuildWebsites ? "yes" : "no"}`,
    "",
    "Checks:",
    ...report.checks.map((check) => `- [${check.ok ? "ok" : "blocked"}] ${check.label}: ${check.detail}`),
    "",
    "Allowed today:",
    ...(report.allowedToday.length ? report.allowedToday.map((item) => `- ${item}`) : ["- none"]),
    "",
    "Blocked until:",
    ...(report.blockedUntil.length ? report.blockedUntil.map((item) => `- ${item}`) : ["- none"]),
  ].join("\n");
}
