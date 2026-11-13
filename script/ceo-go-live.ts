import "../server/env-loader";
import {
  CEO_GO_LIVE_EVIDENCE_CATEGORY,
  buildCeoGoLiveEvidenceFlags,
  buildCeoGoLiveEvidenceMeta,
  buildCeoGoLiveEvidenceMutation,
  buildCeoGoLiveReport,
  formatCeoGoLiveJson,
  formatCeoGoLiveText,
  parseCeoGoLiveArgs,
  validateCeoGoLiveOptions,
} from "../server/ceo-go-live-cli";
import { hasRealValue } from "../server/ceo-doctor-cli";

async function readPersistedGoLiveEvidence(userId: string) {
  if (!hasRealValue(process.env.DATABASE_URL)) {
    throw new Error("DATABASE_URL is not configured; persisted go-live evidence cannot be read.");
  }

  const { storage } = await import("../server/storage");
  const evidence = await storage.getUserProfileDataByCategory(userId, CEO_GO_LIVE_EVIDENCE_CATEGORY);
  return {
    flags: buildCeoGoLiveEvidenceFlags(evidence.map((item) => item.key)),
    meta: buildCeoGoLiveEvidenceMeta(evidence.map((item) => ({
      key: item.key,
      value: item.value,
      source: item.source,
    }))),
  };
}

async function applyGoLiveEvidenceMutation(options: ReturnType<typeof parseCeoGoLiveArgs>) {
  const checkId = options.confirmCheckId || options.revokeCheckId;
  if (!checkId) return;
  if (!hasRealValue(process.env.DATABASE_URL)) {
    throw new Error("DATABASE_URL is not configured; go-live evidence cannot be persisted.");
  }

  const { mutation, error } = buildCeoGoLiveEvidenceMutation({
    checkId,
    confirmed: options.confirmCheckId ? true : false,
    note: options.evidenceNote,
  });
  if (error || !mutation) throw new Error(error || "Invalid go-live evidence mutation.");

  const { storage } = await import("../server/storage");
  if (mutation.action === "save") {
    await storage.saveUserProfileData(options.userId, {
      userId: options.userId,
      category: CEO_GO_LIVE_EVIDENCE_CATEGORY,
      key: mutation.key,
      value: mutation.value,
      confidence: "confirmed",
      source: mutation.source,
    });
    console.error(`[ceo:go-live] Persisted evidence for ${mutation.checkId}.`);
  } else {
    const existing = await storage.getUserProfileDataByKey(options.userId, mutation.key);
    if (existing) await storage.deleteUserProfileData(existing.id);
    console.error(`[ceo:go-live] Revoked evidence for ${mutation.checkId}.`);
  }
}

async function main() {
  const options = parseCeoGoLiveArgs(process.argv.slice(2));
  const errors = validateCeoGoLiveOptions(options);

  if (errors.length > 0) {
    console.error(errors.join("\n"));
    console.error("Usage: npm run ceo:go-live -- --user-id=<real-user-id> --chat-id=<telegram-chat-id> [--confirm-check=<check-id> --note=<non-sensitive-note> --execute] [--revoke-check=<check-id> --execute] [--smoke-ready --backup-executed --restore-verified --brief-verified --telegram-commands-verified --conversation-history-verified] [--json]");
    process.exit(1);
  }

  await applyGoLiveEvidenceMutation(options);

  let persistedEvidence = null;
  try {
    persistedEvidence = await readPersistedGoLiveEvidence(options.userId);
  } catch (error) {
    console.error("[ceo:go-live] Could not read persisted go-live evidence; using CLI flags only.", error instanceof Error ? error.message : error);
  }

  const report = buildCeoGoLiveReport({
    ...options,
    smokeReady: options.smokeReady || Boolean(persistedEvidence?.flags.smokeReady),
    backupExecuted: options.backupExecuted || Boolean(persistedEvidence?.flags.backupExecuted),
    restoreVerified: options.restoreVerified || Boolean(persistedEvidence?.flags.restoreVerified),
    briefVerified: options.briefVerified || Boolean(persistedEvidence?.flags.briefVerified),
    telegramCommandsVerified: options.telegramCommandsVerified || Boolean(persistedEvidence?.flags.telegramCommandsVerified),
    conversationHistoryVerified: options.conversationHistoryVerified || Boolean(persistedEvidence?.flags.conversationHistoryVerified),
    evidence: persistedEvidence?.meta,
  });
  console.log(options.json ? formatCeoGoLiveJson(report) : formatCeoGoLiveText(report));
  process.exit(report.ready ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
