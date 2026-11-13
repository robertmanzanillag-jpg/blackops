import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCeoGoLiveEvidenceMeta,
  buildCeoGoLiveEvidenceMutation,
  buildCeoGoLiveEvidenceFlags,
  buildCeoGoLiveSmokeEvidenceMutation,
  buildCeoGoLiveReport,
  formatCeoGoLiveJson,
  formatCeoGoLiveText,
  getCeoGoLiveEvidenceKey,
  isCeoGoLiveCheckId,
  isCeoGoLiveManualEvidenceCheckId,
  parseCeoGoLiveArgs,
  parseCeoGoLiveEvidenceConfirmation,
  sanitizeCeoGoLiveEvidenceNote,
  validateCeoGoLiveOptions,
} from "../server/ceo-go-live-cli";

test("parses CEO go-live CLI options", () => {
  assert.deepEqual(
    parseCeoGoLiveArgs([
      "--user-id=user-1",
      "--chat-id=123",
      "--smoke-ready",
      "--backup-executed",
      "--restore-verified",
      "--brief-verified",
      "--telegram-commands-verified",
      "--conversation-history-verified",
      "--confirm-check=backup_executed",
      "--note=backup manifest verified",
      "--execute",
      "--json",
    ]),
    {
      userId: "user-1",
      chatId: "123",
      smokeReady: true,
      execute: true,
      confirmCheckId: "backup_executed",
      revokeCheckId: "",
      evidenceNote: "backup manifest verified",
      backupExecuted: true,
      restoreVerified: true,
      briefVerified: true,
      telegramCommandsVerified: true,
      conversationHistoryVerified: true,
      json: true,
    },
  );
});

test("requires user and chat ids for go-live gate", () => {
  assert.deepEqual(validateCeoGoLiveOptions(parseCeoGoLiveArgs([])), [
    "--user-id=<real-user-id> must be a real value, not a placeholder.",
    "--chat-id=<telegram-chat-id> must be a real value, not a placeholder.",
  ]);
  assert.deepEqual(validateCeoGoLiveOptions(parseCeoGoLiveArgs(["--user-id=<real-user-id>", "--chat-id=<telegram-chat-id>"])), [
    "--user-id=<real-user-id> must be a real value, not a placeholder.",
    "--chat-id=<telegram-chat-id> must be a real value, not a placeholder.",
  ]);
});

test("validates go-live evidence CLI persistence options", () => {
  assert.deepEqual(validateCeoGoLiveOptions(parseCeoGoLiveArgs(["--user-id=user-1", "--chat-id=123", "--confirm-check=backup_executed"])), [
    "--execute is required to persist or revoke go-live evidence.",
  ]);
  assert.deepEqual(validateCeoGoLiveOptions(parseCeoGoLiveArgs(["--user-id=user-1", "--chat-id=123", "--confirm-check=smoke_ready", "--execute"])), [
    "smoke_ready must be verified by its command, not manual evidence.",
  ]);
  assert.deepEqual(validateCeoGoLiveOptions(parseCeoGoLiveArgs(["--user-id=user-1", "--chat-id=123", "--confirm-check=backup_executed", "--revoke-check=restore_verified", "--execute"])), [
    "Use either --confirm-check or --revoke-check, not both.",
  ]);
  assert.deepEqual(validateCeoGoLiveOptions(parseCeoGoLiveArgs(["--user-id=user-1", "--chat-id=123", "--revoke-check=../../../secrets", "--execute"])), [
    "../../../secrets is not a valid go-live check id.",
  ]);
});

test("blocks go-live until smoke and external evidence are confirmed", () => {
  const report = buildCeoGoLiveReport(parseCeoGoLiveArgs(["--user-id=user-1", "--chat-id=123", "--smoke-ready"]));

  assert.equal(report.ready, false);
  assert.equal(report.automaticReady, true);
  assert.equal(report.manualReady, false);
  assert.equal(report.nextCommands.some((command) => command.includes("ceo:backup")), true);
  assert.equal(report.checks.find((check) => check.id === "backup_executed")?.evidenceCommand, 'npm run ceo:backup -- --label="$BACKUP_LABEL" --execute');
  assert.equal(report.checks.find((check) => check.id === "restore_verified")?.evidenceCommand, 'RESTORE_DATABASE_URL="$RESTORE_DATABASE_URL" npm run ceo:restore -- --dump="$BACKUP_DIR/postgres.dump" --artifacts="$BACKUP_DIR/local-artifacts.tgz" --manifest="$BACKUP_DIR/backup-manifest.json" --artifacts-output-dir="restored-artifacts/$BACKUP_LABEL" --confirm-restore --execute');
  assert.doesNotMatch(report.nextCommands.join("\n"), /<backup-dir>|<yyyy-mm-dd>|<staging-db-url>/);
  assert.equal(report.finalCommand, "npm run ceo:go-live -- --user-id=user-1 --chat-id=123 --smoke-ready --backup-executed --restore-verified --brief-verified --telegram-commands-verified --conversation-history-verified");
  assert.match(formatCeoGoLiveText(report), /CEO Assistant Go-Live Gate/);
  assert.match(formatCeoGoLiveText(report), /Manual\/external checks: needs_action/);
  assert.match(formatCeoGoLiveText(report), /Final runtime-flag command after external evidence is verified/);
});

test("reports ready when all go-live evidence is confirmed", () => {
  const report = buildCeoGoLiveReport(parseCeoGoLiveArgs([
    "--user-id=user-1",
    "--chat-id=123",
    "--smoke-ready",
    "--backup-executed",
    "--restore-verified",
    "--brief-verified",
    "--telegram-commands-verified",
    "--conversation-history-verified",
  ]));

  assert.equal(report.ready, true);
  assert.equal(report.nextCommands.length, 0);
  assert.equal(JSON.parse(formatCeoGoLiveJson(report)).ready, true);
  assert.deepEqual(report.checks.find((check) => check.id === "backup_executed")?.evidence, {
    confirmedAt: null,
    source: "runtime-flag",
  });
});

test("builds go-live readiness flags from persisted evidence keys", () => {
  const flags = buildCeoGoLiveEvidenceFlags([
    getCeoGoLiveEvidenceKey("smoke_ready"),
    getCeoGoLiveEvidenceKey("backup_executed"),
    "ceo_go_live:unknown",
  ]);

  assert.equal(flags.smokeReady, true);
  assert.equal(flags.backupExecuted, true);
  assert.equal(flags.restoreVerified, false);
  assert.equal(flags.briefVerified, false);
  assert.equal(flags.telegramCommandsVerified, false);
  assert.equal(flags.conversationHistoryVerified, false);
});

test("builds go-live evidence metadata from persisted values", () => {
  const evidence = buildCeoGoLiveEvidenceMeta([
    {
      key: getCeoGoLiveEvidenceKey("smoke_ready"),
      value: JSON.stringify({ confirmedAt: "2026-06-18T12:00:00.000Z", source: "manual" }),
      source: "manual",
    },
    {
      key: getCeoGoLiveEvidenceKey("backup_executed"),
      value: JSON.stringify({ confirmedAt: "2026-06-18T13:00:00.000Z", source: "manual", note: "backup 2026-06-18 staging ok" }),
      source: "manual",
    },
  ]);
  const report = buildCeoGoLiveReport({
    ...parseCeoGoLiveArgs(["--user-id=user-1", "--chat-id=123", "--smoke-ready", "--backup-executed"]),
    evidence,
  });

  assert.deepEqual(report.checks.find((check) => check.id === "smoke_ready")?.evidence, {
    confirmedAt: "2026-06-18T12:00:00.000Z",
    source: "manual",
  });
  assert.deepEqual(report.checks.find((check) => check.id === "backup_executed")?.evidence, {
    confirmedAt: "2026-06-18T13:00:00.000Z",
    source: "manual",
    note: "backup 2026-06-18 staging ok",
  });
});

test("sanitizes optional go-live evidence notes", () => {
  assert.equal(sanitizeCeoGoLiveEvidenceNote(undefined), null);
  assert.equal(sanitizeCeoGoLiveEvidenceNote("  backup\nverified\tin staging  "), "backup verified in staging");
  assert.equal(sanitizeCeoGoLiveEvidenceNote("x".repeat(260))?.length, 240);
});

test("validates go-live check ids and manual evidence boundaries before persistence", () => {
  assert.equal(isCeoGoLiveCheckId("smoke_ready"), true);
  assert.equal(isCeoGoLiveCheckId("restore_verified"), true);
  assert.equal(isCeoGoLiveCheckId("../../../secrets"), false);
  assert.equal(isCeoGoLiveCheckId(""), false);
  assert.equal(isCeoGoLiveManualEvidenceCheckId("smoke_ready"), false);
  assert.equal(isCeoGoLiveManualEvidenceCheckId("restore_verified"), true);
});

test("requires explicit go-live evidence confirmation values", () => {
  assert.equal(parseCeoGoLiveEvidenceConfirmation(true), true);
  assert.equal(parseCeoGoLiveEvidenceConfirmation(false), false);
  assert.equal(parseCeoGoLiveEvidenceConfirmation("true"), true);
  assert.equal(parseCeoGoLiveEvidenceConfirmation("1"), true);
  assert.equal(parseCeoGoLiveEvidenceConfirmation("yes"), true);
  assert.equal(parseCeoGoLiveEvidenceConfirmation("false"), false);
  assert.equal(parseCeoGoLiveEvidenceConfirmation("0"), false);
  assert.equal(parseCeoGoLiveEvidenceConfirmation("no"), false);
  assert.equal(parseCeoGoLiveEvidenceConfirmation(undefined), null);
  assert.equal(parseCeoGoLiveEvidenceConfirmation(""), null);
  assert.equal(parseCeoGoLiveEvidenceConfirmation("maybe"), null);
});

test("builds go-live evidence mutations without destructive defaults", () => {
  const save = buildCeoGoLiveEvidenceMutation({
    checkId: "backup_executed",
    confirmed: true,
    confirmedAt: "2026-06-18T12:00:00.000Z",
    note: "backup manifest verified",
  });
  assert.equal(save.error, null);
  assert.deepEqual(save.mutation, {
    action: "save",
    checkId: "backup_executed",
    key: getCeoGoLiveEvidenceKey("backup_executed"),
    value: JSON.stringify({ checkId: "backup_executed", confirmedAt: "2026-06-18T12:00:00.000Z", source: "manual", note: "backup manifest verified" }),
    source: "manual",
  });

  const deletion = buildCeoGoLiveEvidenceMutation({ checkId: "backup_executed", confirmed: false });
  assert.equal(deletion.error, null);
  assert.deepEqual(deletion.mutation, {
    action: "delete",
    checkId: "backup_executed",
    key: getCeoGoLiveEvidenceKey("backup_executed"),
  });

  const missingConfirmation = buildCeoGoLiveEvidenceMutation({ checkId: "backup_executed", confirmed: null });
  assert.equal(missingConfirmation.mutation, null);
  assert.match(missingConfirmation.error || "", /confirmed=true\|false/);

  const invalidCheck = buildCeoGoLiveEvidenceMutation({ checkId: "../../../secrets", confirmed: false });
  assert.equal(invalidCheck.mutation, null);
  assert.match(invalidCheck.error || "", /Invalid go-live check id/);

  const automaticCheck = buildCeoGoLiveEvidenceMutation({ checkId: "smoke_ready", confirmed: true });
  assert.equal(automaticCheck.mutation, null);
  assert.match(automaticCheck.error || "", /must be verified by its command/);
});

test("builds automatic smoke evidence for the go-live dashboard", () => {
  const mutation = buildCeoGoLiveSmokeEvidenceMutation({
    confirmedAt: "2026-06-18T14:00:00.000Z",
    note: "ceo:smoke passed",
  });

  assert.deepEqual(mutation, {
    action: "save",
    checkId: "smoke_ready",
    key: getCeoGoLiveEvidenceKey("smoke_ready"),
    value: JSON.stringify({
      checkId: "smoke_ready",
      confirmedAt: "2026-06-18T14:00:00.000Z",
      source: "ceo:smoke",
      note: "ceo:smoke passed",
    }),
    source: "ceo:smoke",
  });
});
