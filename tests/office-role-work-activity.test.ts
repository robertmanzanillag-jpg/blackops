import test from "node:test";
import assert from "node:assert/strict";
import { applyRoleWorkActivity, countRoleWorkCompleted, parseRoleWorkActivity, roleWorkActivityView } from "../shared/office-role-work-activity";

const now = Date.parse("2026-11-12T11:30:00Z");
const job = (role: string, status: string, startedAt: string, extra: Record<string, unknown> = {}) => ({
  id: `${role}-${startedAt}`, role, status, slot: startedAt.slice(0, 10), startedAt,
  expiresAt: new Date(Date.parse(startedAt) + 60_000).toISOString(),
  ...(status === "completed" || status === "blocked" ? { completedAt: new Date(Date.parse(startedAt) + 5_000).toISOString() } : {}),
  audit: { secret: "never exposed" }, source: { private: true }, artifactId: "a", ...extra,
});

test("view keeps only today's latest job per role and no private proof", () => {
  const view = roleWorkActivityView([
    job("news", "completed", "2026-11-11T09:00:00.000Z"),
    job("news", "completed", "2026-11-12T09:00:00.000Z"),
    job("code", "blocked", "2026-11-12T08:00:00.000Z"),
    job("legal", "weird", "2026-11-12T08:00:00.000Z"),
  ], now);
  assert.deepEqual(view.map(item => [item.agentId, item.status]), [["code", "blocked"], ["news", "completed"]]);
  for (const item of view) assert.deepEqual(Object.keys(item).sort(), ["agentId", "completedAt", "expiresAt", "startedAt", "status"]);
  assert.deepEqual(roleWorkActivityView(undefined, now), []);
});

test("completed work is counted and shown without upgrading the desk state", () => {
  const [news] = roleWorkActivityView([job("news", "completed", "2026-11-12T09:00:00.000Z")], now);
  const status = applyRoleWorkActivity({ state: "available", label: "Ronda registrada", activity: ["x"] }, news, now)!;
  assert.equal(status.state, "available");
  assert.equal(status.activity?.[0], "Trabajo verificado hoy · 09:00 UTC");
  assert.equal(countRoleWorkCompleted([news], ["news", "code"]), 1);
  assert.equal(countRoleWorkCompleted([news], ["code"]), 0);
});

test("only a live lease shows working; expired or external never do", () => {
  const running = { agentId: "code", status: "running" as const, startedAt: "2026-11-12T11:29:40.000Z", expiresAt: "2026-11-12T11:30:40.000Z" };
  assert.equal(applyRoleWorkActivity({ state: "available", label: "GitHub conectado" }, running, now)?.state, "working");
  assert.equal(applyRoleWorkActivity({ state: "available", label: "GitHub conectado" }, running, now + 120_000)?.state, "available");
  assert.equal(applyRoleWorkActivity({ state: "offline", label: "Externo · lo publica Codex" }, running, now)?.state, "offline");
  assert.equal(applyRoleWorkActivity(undefined, undefined, now), undefined);
});

test("old servers without the field parse to an empty list", () => {
  assert.deepEqual(parseRoleWorkActivity(undefined), []);
  assert.deepEqual(parseRoleWorkActivity([{ agentId: "news" }, null, { agentId: "code", status: "completed", startedAt: "t", expiresAt: "t" }]).map(item => item.agentId), ["code"]);
});

test("completed today marks a healthy desk on duty; failures, setup, external and other days stay as they were", () => {
  const [news] = roleWorkActivityView([job("news", "completed", "2026-11-12T09:00:00.000Z")], now);
  const onDuty = applyRoleWorkActivity({ state: "offline", label: "Sin lectura" }, news, now)!;
  assert.equal(onDuty.state, "available");
  assert.equal(onDuty.label, "Activo · al día");
  assert.equal(onDuty.onDuty?.lastWorkAt, "2026-11-12T09:00:05.000Z");
  assert.match(onDuty.detail || "", /^Último trabajo \d{2}:\d{2} · turno diario del ejecutor de la oficina$/);
  assert.equal(applyRoleWorkActivity({ state: "error", label: "Falló" }, news, now)?.onDuty, undefined);
  assert.equal(applyRoleWorkActivity({ state: "needs-setup", label: "Falta conector" }, news, now)?.onDuty, undefined);
  assert.equal(applyRoleWorkActivity({ state: "offline", label: "Externo · lo publica Codex" }, news, now)?.onDuty, undefined);
  assert.equal(applyRoleWorkActivity({ state: "available", label: "x" }, news, Date.parse("2026-11-13T00:30:00Z"))?.onDuty, undefined);
  const blocked = { agentId: "code", status: "blocked" as const, startedAt: "2026-11-12T08:00:00.000Z", expiresAt: "2026-11-12T08:01:00.000Z", completedAt: "2026-11-12T08:00:05.000Z" };
  assert.equal(applyRoleWorkActivity({ state: "available", label: "x" }, blocked, now)?.onDuty, undefined);
});
