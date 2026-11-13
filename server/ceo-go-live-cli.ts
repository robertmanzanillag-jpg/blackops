import { validateRequiredRealCliValue } from "./cli-validation";

export type CeoGoLiveOptions = {
  userId: string;
  chatId: string;
  json: boolean;
  execute: boolean;
  confirmCheckId: string;
  revokeCheckId: string;
  evidenceNote: string;
  smokeReady: boolean;
  backupExecuted: boolean;
  restoreVerified: boolean;
  briefVerified: boolean;
  telegramCommandsVerified: boolean;
  conversationHistoryVerified: boolean;
  evidence?: Record<string, CeoGoLiveEvidenceMeta>;
};

export type CeoGoLiveEvidenceMeta = {
  confirmedAt: string | null;
  source: string;
  note?: string | null;
};

export type CeoGoLiveEvidenceMutation =
  | {
      action: "save";
      checkId: string;
      key: string;
      value: string;
      source: "manual" | "ceo:smoke";
    }
  | {
      action: "delete";
      checkId: string;
      key: string;
    };

export type CeoGoLiveCheck = {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  evidenceCommand: string;
  evidence?: CeoGoLiveEvidenceMeta;
};

export type CeoGoLiveReport = {
  ready: boolean;
  automaticReady: boolean;
  manualReady: boolean;
  checks: CeoGoLiveCheck[];
  nextCommands: string[];
  finalCommand: string;
};

export type CeoGoLiveEvidenceFlags = Pick<
  CeoGoLiveOptions,
  | "smokeReady"
  | "backupExecuted"
  | "restoreVerified"
  | "briefVerified"
  | "telegramCommandsVerified"
  | "conversationHistoryVerified"
>;

export const CEO_GO_LIVE_EVIDENCE_CATEGORY = "ceo_go_live_evidence";
export const CEO_GO_LIVE_EVIDENCE_PREFIX = "ceo_go_live:";

export const CEO_GO_LIVE_FLAG_BY_CHECK_ID: Record<string, keyof CeoGoLiveEvidenceFlags> = {
  smoke_ready: "smokeReady",
  backup_executed: "backupExecuted",
  restore_verified: "restoreVerified",
  brief_verified: "briefVerified",
  telegram_commands_verified: "telegramCommandsVerified",
  conversation_history_verified: "conversationHistoryVerified",
};

export const CEO_GO_LIVE_MANUAL_EVIDENCE_CHECK_IDS = [
  "backup_executed",
  "restore_verified",
  "brief_verified",
  "telegram_commands_verified",
  "conversation_history_verified",
] as const;

const CEO_GO_LIVE_MANUAL_EVIDENCE_CHECK_ID_SET = new Set<string>(CEO_GO_LIVE_MANUAL_EVIDENCE_CHECK_IDS);

export function isCeoGoLiveCheckId(value: string): boolean {
  return Boolean(CEO_GO_LIVE_FLAG_BY_CHECK_ID[value]);
}

export function isCeoGoLiveManualEvidenceCheckId(value: string): boolean {
  return CEO_GO_LIVE_MANUAL_EVIDENCE_CHECK_ID_SET.has(value);
}

export function getCeoGoLiveEvidenceKey(checkId: string): string {
  return `${CEO_GO_LIVE_EVIDENCE_PREFIX}${checkId}`;
}

export function parseCeoGoLiveEvidenceConfirmation(value: unknown): boolean | null {
  if (value === true) return true;
  if (value === false) return false;
  if (typeof value !== "string") return null;

  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes"].includes(normalized)) return true;
  if (["false", "0", "no"].includes(normalized)) return false;
  return null;
}

export function sanitizeCeoGoLiveEvidenceNote(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  return normalized.slice(0, 240);
}

export function buildCeoGoLiveEvidenceMutation(input: {
  checkId: string;
  confirmed: boolean | null;
  confirmedAt?: string;
  note?: unknown;
}): { mutation: CeoGoLiveEvidenceMutation | null; error: string | null } {
  const checkId = input.checkId.trim();
  if (!isCeoGoLiveCheckId(checkId)) {
    return { mutation: null, error: "Invalid go-live check id" };
  }
  if (!isCeoGoLiveManualEvidenceCheckId(checkId)) {
    return { mutation: null, error: "This go-live check must be verified by its command, not manual evidence" };
  }
  if (input.confirmed === null) {
    return { mutation: null, error: "confirmed=true|false is required to update go-live evidence" };
  }

  const key = getCeoGoLiveEvidenceKey(checkId);
  if (!input.confirmed) {
    return { mutation: { action: "delete", checkId, key }, error: null };
  }

  return {
    mutation: {
      action: "save",
      checkId,
      key,
      value: JSON.stringify({
        checkId,
        confirmedAt: input.confirmedAt || new Date().toISOString(),
        source: "manual",
        note: sanitizeCeoGoLiveEvidenceNote(input.note),
      }),
      source: "manual",
    },
    error: null,
  };
}

export function buildCeoGoLiveSmokeEvidenceMutation(input: {
  confirmedAt?: string;
  note?: unknown;
} = {}): CeoGoLiveEvidenceMutation {
  const checkId = "smoke_ready";
  return {
    action: "save",
    checkId,
    key: getCeoGoLiveEvidenceKey(checkId),
    value: JSON.stringify({
      checkId,
      confirmedAt: input.confirmedAt || new Date().toISOString(),
      source: "ceo:smoke",
      note: sanitizeCeoGoLiveEvidenceNote(input.note),
    }),
    source: "ceo:smoke",
  };
}

export function buildCeoGoLiveEvidenceFlags(keys: Iterable<string>): CeoGoLiveEvidenceFlags {
  const confirmed = new Set(keys);

  return Object.fromEntries(
    Object.entries(CEO_GO_LIVE_FLAG_BY_CHECK_ID).map(([checkId, flagName]) => [
      flagName,
      confirmed.has(getCeoGoLiveEvidenceKey(checkId)),
    ]),
  ) as CeoGoLiveEvidenceFlags;
}

export function parseCeoGoLiveEvidenceValue(value: string | null | undefined, fallbackSource = "manual"): CeoGoLiveEvidenceMeta {
  if (!value) return { confirmedAt: null, source: fallbackSource };

  try {
    const parsed = JSON.parse(value);
    const note = sanitizeCeoGoLiveEvidenceNote(parsed?.note);
    const evidence: CeoGoLiveEvidenceMeta = {
      confirmedAt: typeof parsed?.confirmedAt === "string" ? parsed.confirmedAt : null,
      source: typeof parsed?.source === "string" ? parsed.source : fallbackSource,
    };
    if (note) evidence.note = note;
    return evidence;
  } catch {
    return { confirmedAt: null, source: fallbackSource };
  }
}

export function buildCeoGoLiveEvidenceMeta(
  items: Iterable<{ key: string; value?: string | null; source?: string | null }>,
): Record<string, CeoGoLiveEvidenceMeta> {
  const result: Record<string, CeoGoLiveEvidenceMeta> = {};

  for (const item of items) {
    for (const checkId of Object.keys(CEO_GO_LIVE_FLAG_BY_CHECK_ID)) {
      if (item.key !== getCeoGoLiveEvidenceKey(checkId)) continue;
      result[checkId] = parseCeoGoLiveEvidenceValue(item.value, item.source || "manual");
    }
  }

  return result;
}

function getArgValue(argv: string[], name: string): string {
  const prefix = `${name}=`;
  const arg = argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length).trim() : "";
}

export function parseCeoGoLiveArgs(argv: string[]): CeoGoLiveOptions {
  return {
    userId: getArgValue(argv, "--user-id"),
    chatId: getArgValue(argv, "--chat-id"),
    json: argv.includes("--json"),
    execute: argv.includes("--execute"),
    confirmCheckId: getArgValue(argv, "--confirm-check"),
    revokeCheckId: getArgValue(argv, "--revoke-check"),
    evidenceNote: getArgValue(argv, "--note"),
    smokeReady: argv.includes("--smoke-ready"),
    backupExecuted: argv.includes("--backup-executed"),
    restoreVerified: argv.includes("--restore-verified"),
    briefVerified: argv.includes("--brief-verified"),
    telegramCommandsVerified: argv.includes("--telegram-commands-verified"),
    conversationHistoryVerified: argv.includes("--conversation-history-verified"),
  };
}

export function validateCeoGoLiveOptions(options: CeoGoLiveOptions): string[] {
  const errors: string[] = [];
  const userIdError = validateRequiredRealCliValue(options.userId, "--user-id=<real-user-id>");
  const chatIdError = validateRequiredRealCliValue(options.chatId, "--chat-id=<telegram-chat-id>");
  if (userIdError) errors.push(userIdError);
  if (chatIdError) errors.push(chatIdError);
  if (options.confirmCheckId && options.revokeCheckId) {
    errors.push("Use either --confirm-check or --revoke-check, not both.");
  }
  for (const checkId of [options.confirmCheckId, options.revokeCheckId].filter(Boolean)) {
    if (!isCeoGoLiveCheckId(checkId)) {
      errors.push(`${checkId} is not a valid go-live check id.`);
    } else if (!isCeoGoLiveManualEvidenceCheckId(checkId)) {
      errors.push(`${checkId} must be verified by its command, not manual evidence.`);
    }
  }
  if ((options.confirmCheckId || options.revokeCheckId) && !options.execute) {
    errors.push("--execute is required to persist or revoke go-live evidence.");
  }
  return errors;
}

function effectiveGoLiveEvidence(options: CeoGoLiveOptions, checkId: string, ok: boolean): CeoGoLiveEvidenceMeta | undefined {
  return options.evidence?.[checkId] || (ok ? { confirmedAt: null, source: "runtime-flag" } : undefined);
}

export function buildCeoGoLiveReport(options: CeoGoLiveOptions): CeoGoLiveReport {
  const userId = options.userId || "<real-user-id>";
  const chatId = options.chatId || "<telegram-chat-id>";
  const finalCommand = `npm run ceo:go-live -- --user-id=${userId} --chat-id=${chatId} --smoke-ready --backup-executed --restore-verified --brief-verified --telegram-commands-verified --conversation-history-verified`;
  const checks: CeoGoLiveCheck[] = [
    {
      id: "smoke_ready",
      label: "Combined smoke preflight",
      ok: options.smokeReady,
      evidence: effectiveGoLiveEvidence(options, "smoke_ready", options.smokeReady),
      detail: options.smokeReady
        ? "ceo:smoke completed successfully."
        : "Run ceo:smoke successfully, then pass --smoke-ready.",
      evidenceCommand: `npm run ceo:smoke -- --user-id=${userId} --chat-id=${chatId}`,
    },
    {
      id: "backup_executed",
      label: "Production backup executed",
      ok: options.backupExecuted,
      evidence: effectiveGoLiveEvidence(options, "backup_executed", options.backupExecuted),
      detail: options.backupExecuted
        ? "A real backup has been generated."
        : "Run a real backup and confirm postgres.dump plus backup-manifest.json exist.",
      evidenceCommand: 'npm run ceo:backup -- --label="$BACKUP_LABEL" --execute',
    },
    {
      id: "restore_verified",
      label: "Staging restore verified",
      ok: options.restoreVerified,
      evidence: effectiveGoLiveEvidence(options, "restore_verified", options.restoreVerified),
      detail: options.restoreVerified
        ? "A restore into a separate staging database has been verified."
        : "Restore the generated dump into staging and verify manifest checksums.",
      evidenceCommand: 'RESTORE_DATABASE_URL="$RESTORE_DATABASE_URL" npm run ceo:restore -- --dump="$BACKUP_DIR/postgres.dump" --artifacts="$BACKUP_DIR/local-artifacts.tgz" --manifest="$BACKUP_DIR/backup-manifest.json" --artifacts-output-dir="restored-artifacts/$BACKUP_LABEL" --confirm-restore --execute',
    },
    {
      id: "brief_verified",
      label: "Real CEO brief delivered",
      ok: options.briefVerified,
      evidence: effectiveGoLiveEvidence(options, "brief_verified", options.briefVerified),
      detail: options.briefVerified
        ? "A real CEO brief was delivered to the production Telegram chat."
        : "Send a real brief and confirm it arrives in Telegram.",
      evidenceCommand: `npm run ceo:send-brief -- --user-id=${userId} --execute`,
    },
    {
      id: "telegram_commands_verified",
      label: "Telegram command loop verified",
      ok: options.telegramCommandsVerified,
      evidence: effectiveGoLiveEvidence(options, "telegram_commands_verified", options.telegramCommandsVerified),
      detail: options.telegramCommandsVerified
        ? "Core Telegram commands responded correctly."
        : "In Telegram, test: health, readiness, brief, pendientes, aprobar ID, rechazar ID.",
      evidenceCommand: "Manual Telegram test in the real chat.",
    },
    {
      id: "conversation_history_verified",
      label: "Shared conversation history verified",
      ok: options.conversationHistoryVerified,
      evidence: effectiveGoLiveEvidence(options, "conversation_history_verified", options.conversationHistoryVerified),
      detail: options.conversationHistoryVerified
        ? "Telegram and web assistant share CEO conversation history."
        : "Send a Telegram conversation and confirm it appears in /api/ceo/conversation-history.",
      evidenceCommand: "GET /api/ceo/conversation-history after a real Telegram exchange.",
    },
  ];

  const automaticReady = checks.find((check) => check.id === "smoke_ready")?.ok === true;
  const manualReady = checks.filter((check) => check.id !== "smoke_ready").every((check) => check.ok);
  const ready = automaticReady && manualReady;

  return {
    ready,
    automaticReady,
    manualReady,
    checks,
    nextCommands: checks.filter((check) => !check.ok).map((check) => check.evidenceCommand),
    finalCommand,
  };
}

export function formatCeoGoLiveText(report: CeoGoLiveReport): string {
  return [
    "CEO Assistant Go-Live Gate",
    `Ready: ${report.ready ? "yes" : "no"}`,
    `Automatic checks: ${report.automaticReady ? "ready" : "needs_action"}`,
    `Manual/external checks: ${report.manualReady ? "ready" : "needs_action"}`,
    "",
    "Checks:",
    ...report.checks.map((check) => `- [${check.ok ? "ok" : "missing"}] ${check.label}: ${check.detail}`),
    "",
    "Next commands/evidence:",
    ...report.nextCommands.map((command) => `- ${command}`),
    "",
    "Final runtime-flag command after external evidence is verified:",
    `- ${report.finalCommand}`,
  ].join("\n");
}

export function formatCeoGoLiveJson(report: CeoGoLiveReport): string {
  return JSON.stringify(report, null, 2);
}
