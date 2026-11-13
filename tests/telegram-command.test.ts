import assert from "node:assert/strict";
import test from "node:test";
import { classifyTelegramControlCommand, normalizeTelegramCommand } from "../server/telegram-command";

test("normalizes Telegram slash commands", () => {
  assert.equal(normalizeTelegramCommand("/STATUS"), "status");
  assert.equal(normalizeTelegramCommand("  /Ayuda  "), "ayuda");
});

test("classifies CEO Telegram commands", () => {
  assert.equal(classifyTelegramControlCommand("/help"), "help");
  assert.equal(classifyTelegramControlCommand("brief"), "brief");
  assert.equal(classifyTelegramControlCommand("estado"), "brief");
  assert.equal(classifyTelegramControlCommand("estado ceo"), "readiness");
  assert.equal(classifyTelegramControlCommand("readiness"), "readiness");
  assert.equal(classifyTelegramControlCommand("estado sistema"), "health");
  assert.equal(classifyTelegramControlCommand("status"), "health");
  assert.equal(classifyTelegramControlCommand("top 3"), "top3");
  assert.equal(classifyTelegramControlCommand("foco"), "top3");
  assert.equal(classifyTelegramControlCommand("bloqueos"), "blockers");
  assert.equal(classifyTelegramControlCommand("qué bloqueo hay"), "blockers");
  assert.equal(classifyTelegramControlCommand("a quién tengo que perseguir"), "chase");
  assert.equal(classifyTelegramControlCommand("cerrar día"), "close_day");
  assert.equal(classifyTelegramControlCommand("pendientes"), "pending");
  assert.equal(classifyTelegramControlCommand("aprobar 00000000-0000-0000-0000-000000000000"), "approve");
  assert.equal(classifyTelegramControlCommand("rechazar 00000000-0000-0000-0000-000000000000"), "reject");
  assert.equal(classifyTelegramControlCommand("crea una tarea para mañana"), null);
});
