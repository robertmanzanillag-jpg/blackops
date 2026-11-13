export function planBlackRoomRemoteSync({ control, localEnabled, localWorkerRunning = false, lastAppliedGeneration }) {
  const generation = Math.max(0, Math.floor(Number(control?.generation || 0)));
  if (generation < lastAppliedGeneration) {
    return { action: "ignore", generation: lastAppliedGeneration };
  }
  const desiredEnabled = Boolean(control?.desiredEnabled);
  if (desiredEnabled && !localEnabled) return { action: "start", generation };
  if (!desiredEnabled && (localEnabled || localWorkerRunning)) return { action: "pause", generation };
  return { action: "none", generation };
}

function blackRoomLocalWallClock(now, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}:${values.second}`;
}

function isValidBlackRoomPublicationDateTime(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 19) === value;
}

export function summarizeBlackRoomDeliveryLedger(ledger, now = new Date(), timezone = "America/New_York") {
  const currentLocal = blackRoomLocalWallClock(now, timezone);
  let scheduled = 0;
  let completed = 0;
  for (const entry of Array.isArray(ledger?.entries) ? ledger.entries : []) {
    const receipts = entry?.networkReceipts && typeof entry.networkReceipts === "object" ? entry.networkReceipts : {};
    const fullyConfirmed = entry?.status === "confirmed"
      && ["tiktok", "facebook", "youtube"].every((network) => Boolean(String(receipts[network] || "").trim()));
    const publicationDateTime = String(entry?.publicationDateTime || "");
    if (!fullyConfirmed || !isValidBlackRoomPublicationDateTime(publicationDateTime)) continue;
    if (publicationDateTime > currentLocal) scheduled += 1;
    else completed += 1;
  }
  return { scheduled, completed, confirmed: scheduled + completed };
}

export function applyBlackRoomDeliveryCounts(queue, delivery) {
  const scheduled = Math.max(0, Math.floor(Number(delivery?.scheduled || 0)));
  const completed = Math.max(0, Math.floor(Number(delivery?.completed || 0)));
  return {
    ...queue,
    totals: { ...(queue?.totals || {}), scheduled, completed },
    delivery: {
      scheduled,
      completed,
      confirmed: Math.max(0, Math.floor(Number(delivery?.confirmed || scheduled + completed))),
    },
  };
}

const creativeStrategies = new Set(["drop_first", "instant_drop", "build_then_drop", "crowd_reaction_first", "context_open_loop"]);

/** Converts immutable, confirmed per-network receipts into the experiment
 * identities consumed by the remote CEO. No network call and no AI is used. */
export function buildBlackRoomPublicationExperiments(ledger) {
  const byReceipt = new Map();
  for (const entry of Array.isArray(ledger?.entries) ? ledger.entries : []) {
    if (entry?.status !== "confirmed") continue;
    const receipts = { ...(entry.networkReceipts && typeof entry.networkReceipts === "object" ? entry.networkReceipts : {}) };
    for (const part of String(entry.metricoolId || "").split("|")) {
      const match = /^(tiktok|facebook|youtube):([^|\s]+)$/.exec(part);
      if (match && !receipts[match[1]]) receipts[match[1]] = match[2];
    }
    for (const network of ["tiktok", "facebook", "youtube"]) {
      const metricoolId = String(receipts[network] || "").trim();
      const reservationId = String(entry.reservationId || "").trim();
      if (!metricoolId || !reservationId) continue;
      const strategy = creativeStrategies.has(entry.creativeStrategy) ? entry.creativeStrategy : "drop_first";
      const experiment = {
        metricoolId, reservationId, network, creativeStrategy: strategy,
        learningTestId: entry.learningTestId,
        learningReference: entry.learningReference,
        learningDecisionIds: entry.learningDecisionIds,
        allocationMode: entry.allocationMode,
        durationSeconds: Number(entry.durationSeconds || 0),
        format: entry.format === "horizontal" ? "horizontal" : "vertical",
        language: entry.language === "es" ? "es" : "en",
        slot: String(entry.slot || ""),
        publishedAt: String(entry.publicationDateTime || entry.updatedAt || entry.createdAt || ""),
        dj: String(entry.dj || "unknown"), sourceVideoId: String(entry.videoId || ""),
        sourceVideoTitle: String(entry.sourceVideoTitle || ""),
        segmentStartSeconds: Number(entry.segmentStartSeconds), segmentEndSeconds: Number(entry.segmentEndSeconds),
        dropOffsetSeconds: Number(entry.dropOffsetSeconds), hookFamily: String(entry.hookFamily || strategy),
        captionVariant: String(entry.captionVariant || "legacy"),
        creativeArmId: String(entry.creativeArmId || `${network}:${strategy}:${entry.language || "en"}:${entry.format || "vertical"}:${entry.durationSeconds || 0}`),
      };
      byReceipt.set(`${network}:${metricoolId}`, experiment);
    }
  }
  return [...byReceipt.values()];
}
