import assert from "node:assert/strict";
import test from "node:test";
import { looksLikeBlackRoomAssistantRequest, parseBlackRoomChatCommand } from "../server/blackroom-chat";
import { formatBlackRoomChatStatus } from "../server/blackroom-chat-service";
import { createBlackRoomRemoteControlState, recordBlackRoomRemoteHeartbeat } from "../server/blackroom-remote-control";

const now = new Date("2026-07-21T14:00:00.000Z");

test("parses extra posts for today", () => {
  const result = parseBlackRoomChatCommand("sube 3 videos más hoy", { now });
  assert.equal(result.command?.type, "extra_posts");
  if (result.command?.type !== "extra_posts") throw new Error("expected extra_posts");
  assert.equal(result.command.posts, 3);
  assert.equal(result.command.targetDate, "2026-07-21");
});

test("targets Facebook and YouTube without adding the extra posts to TikTok", () => {
  const result = parseBlackRoomChatCommand("sube 2 videos más hoy para Facebook y YouTube", { now });
  assert.equal(result.command?.type, "extra_posts");
  if (result.command?.type !== "extra_posts") throw new Error("expected extra_posts");
  assert.deepEqual(result.command.networks, ["facebook", "youtube"]);
  assert.match(result.reply, /facebook y youtube/);
});

test("allows controlled manual daily targets from five through ten", () => {
  const result = parseBlackRoomChatCommand("quiero 5 videos por día", { now });
  assert.equal(result.command?.type, "daily_target");
  if (result.command?.type !== "daily_target") throw new Error("expected daily_target");
  assert.equal(result.command.posts, 5);
  const overCap = parseBlackRoomChatCommand("quiero 12 videos por día", { now });
  assert.equal(overCap.command, null);
  assert.match(overCap.reply, /límite absoluto.*10/i);
  const experiment = parseBlackRoomChatCommand("quiero 7 videos por día", { now });
  assert.equal(experiment.command?.type, "daily_target");
  if (experiment.command?.type !== "daily_target") throw new Error("expected daily target");
  assert.equal(experiment.command.posts, 7);
});

test("queues a specific YouTube source", () => {
  const result = parseBlackRoomChatCommand("saca clips de https://youtu.be/abc123xyz", { now });
  assert.equal(result.command?.type, "priority_source");
  if (result.command?.type !== "priority_source") throw new Error("expected priority_source");
  assert.match(result.command.url, /abc123xyz/);
});

test("does not invent an analytics recommendation with too little data", () => {
  const result = parseBlackRoomChatCommand("¿debería subir más según analytics?", { now, analyticsSamples: 4, currentPostsPerDay: 10 });
  assert.equal(result.command, null);
  assert.match(result.reply, /4\/21/);
});

test("enforces the five-post daily campaign floor", () => {
  const result = parseBlackRoomChatCommand("sube 3 videos por día", { now });
  assert.equal(result.command, null);
  assert.match(result.reply, /base mínima es 5/i);
});

test("rejects extra-today requests that no longer fit safely", () => {
  const late = new Date("2026-07-22T03:30:00.000Z"); // 23:30 America/New_York
  const result = parseBlackRoomChatCommand("sube 3 videos más hoy", { now: late });
  assert.equal(result.command, null);
  assert.match(result.reply, /solo cabe(?:n)? 1/);
});

test("starts and pauses BlackRoom from natural-language assistant commands", () => {
  const start = parseBlackRoomChatCommand("activa el agente de BlackRoom por 3 semanas", { now });
  assert.deepEqual(start.control, { enabled: true, weeks: 3 });
  assert.equal(start.command, null);

  const pause = parseBlackRoomChatCommand("pausa el agente de videos de BlackRoom", { now });
  assert.deepEqual(pause.control, { enabled: false });
  assert.equal(pause.command, null);
});

test("assistant routing recognizes BlackRoom orders without hijacking unrelated chat", () => {
  assert.equal(looksLikeBlackRoomAssistantRequest("sube 3 videos más hoy"), true);
  assert.equal(looksLikeBlackRoomAssistantRequest("saca clips de https://youtu.be/abc123xyz para BlackRoom"), true);
  assert.equal(looksLikeBlackRoomAssistantRequest("saca clips de https://youtu.be/abc123xyz para radio"), false);
  assert.equal(looksLikeBlackRoomAssistantRequest("saca clips del DJ Ana de https://youtu.be/abc123xyz para radio"), false);
  assert.equal(looksLikeBlackRoomAssistantRequest("¿qué recomiendan los analytics de los videos?"), true);
  assert.equal(looksLikeBlackRoomAssistantRequest("sube los ingresos de la empresa"), false);
  assert.equal(looksLikeBlackRoomAssistantRequest("pausa el calendario"), false);
  assert.equal(looksLikeBlackRoomAssistantRequest("desactiva el link del website de BlackRoom"), false);
  assert.equal(looksLikeBlackRoomAssistantRequest("agrega el video del DJ Ana https://youtu.be/abc123xyz al website de BlackRoom"), false);
  assert.equal(looksLikeBlackRoomAssistantRequest("¿cómo va la cola de BlackRoom?"), true);
  assert.equal(looksLikeBlackRoomAssistantRequest("activa Facebook para los videos de BlackRoom"), true);
  assert.equal(looksLikeBlackRoomAssistantRequest("activa YouTube Shorts para BlackRoom"), true);
});

test("start wording with para does not get mistaken for pause", () => {
  const result = parseBlackRoomChatCommand("activa el agente de BlackRoom para 3 semanas", { now });
  assert.deepEqual(result.control, { enabled: true, weeks: 3 });
});

test("one-week wording is normalized to the two-week campaign minimum", () => {
  const result = parseBlackRoomChatCommand("activa el agente de BlackRoom por 1 semana", { now });
  assert.deepEqual(result.control, { enabled: true, weeks: 2 });
  assert.match(result.reply, /2 semanas/);
});

test("reports the BlackRoom queue status from the same assistant chat", () => {
  const request = parseBlackRoomChatCommand("¿cómo va el estado de BlackRoom?", { now });
  assert.equal(request.statusRequested, true);
  const state = createBlackRoomRemoteControlState(now);
  state.desiredEnabled = true;
  recordBlackRoomRemoteHeartbeat(state, {
    deviceId: "blackroom-mac",
    queue: { totals: { queued: 12, processing: 1, retry: 2, scheduled: 4, completed: 8 } },
    worker: { running: true },
    lastError: null,
    appliedGeneration: 1,
  }, now);
  assert.match(formatBlackRoomChatStatus(state, now), /12 pendientes, 1 procesando, 2 reintentos, 4 agendados y 8 completados/);
});
