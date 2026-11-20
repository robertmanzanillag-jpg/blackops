// Retired "Supervisor KONG" (PR #315): a BlackOps-side readiness ledger and chat for kong-videos and
// four placeholder roles (KONG AI, Promoters + Mesas, Venues, Kong Legal) whose real agents already
// exist in KONG's own snapshot. It no longer runs, scores or answers anything:
// - KONG desks show only KONG's snapshot state (client/src/lib/kong-office-wing.ts);
// - chatting with a KONG desk goes through server/agent-chat.ts + KONG office-orders;
// - kong-videos keeps its normal office live probe (promo video status) and kong-ops.
// Old persisted `kongSupervision` state is kept verbatim (never deleted) and only parsed here so
// the owner can still read the stored conversation (GET /api/kong-supervisor/state, read-only).
const LEGACY_AGENT_IDS = ["kong-supervisor", "kong-videos", "kong:KONG AI", "kong:Promoters + Mesas", "kong:Venues", "kong:Kong Legal"] as const;
export type LegacyKongChatAgentId = typeof LEGACY_AGENT_IDS[number];
export type LegacyKongChatMessage = { id: string; requestId: string; agentId: LegacyKongChatAgentId; at: string; role: "user" | "assistant"; text: string };
export type LegacyKongSupervisionRecord = { agentId: LegacyKongChatAgentId; task: "review-readiness"; checkedAt: string; result: "completed" | "blocked" | "failed"; reason: string };
export type LegacyKongSupervisionArchive = { archived: true; lastRunAt: string | null; records: LegacyKongSupervisionRecord[]; messages: LegacyKongChatMessage[] };

const isLegacyId = (value: unknown): value is LegacyKongChatAgentId => typeof value === "string" && (LEGACY_AGENT_IDS as readonly string[]).includes(value);
const validAt = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));

/** Read-only view of the stored supervisor history. Corrupt or missing state is an empty archive. */
export function parseLegacyKongSupervision(value: unknown): LegacyKongSupervisionArchive {
  const input = value as { version?: unknown; records?: unknown; messages?: unknown; lastRunAt?: unknown } | null;
  if (!input || typeof input !== "object" || input.version !== 1) return { archived: true, lastRunAt: null, records: [], messages: [] };
  const records = (Array.isArray(input.records) ? input.records : []).filter((item): item is LegacyKongSupervisionRecord => Boolean(item) && typeof item === "object" &&
    isLegacyId(item.agentId) && item.agentId !== "kong-supervisor" && item.task === "review-readiness" && ["completed", "blocked", "failed"].includes(item.result) && typeof item.reason === "string" && validAt(item.checkedAt)).slice(0, 50);
  const messages = (Array.isArray(input.messages) ? input.messages : []).filter((item): item is LegacyKongChatMessage => Boolean(item) && typeof item === "object" &&
    isLegacyId(item.agentId) && typeof item.id === "string" && typeof item.requestId === "string" && validAt(item.at) && ["user", "assistant"].includes(item.role) && typeof item.text === "string")
    .slice(-80).map(item => ({ ...item, text: item.text.slice(0, 2000) }));
  return { archived: true, lastRunAt: validAt(input.lastRunAt) ? input.lastRunAt : null, records, messages };
}
