import { createHash } from "node:crypto";
import { captureLearningSnapshots, learningSourceHealth, type LearningNetwork, type LearningSnapshot, type LearningWindowHours } from "./blackroom-learning-observations";
import type { BlackRoomPublicationExperiment } from "./blackroom-growth-ceo";

export const BLACKROOM_HOOK_TEST_ID = "hook-15s-en-vertical-v1";
export const BLACKROOM_DURATION_TEST_ID = "duration-15-30-60-v1";
export const DURATION_ARMS = [15, 30, 60] as const;
type Arm = (typeof DURATION_ARMS)[number];
export interface DurationDecision {
  id: string;
  sourceObservedAt: string | null;
  declared: number;
  exact: number;
  matchedBlocks: number;
  windowHours: LearningWindowHours | null;
  recommendedSeconds: Arm | null;
  reason: string;
  evidencePostIds: string[];
}

/** Reproducible evidence fingerprint bound to a test and network, not a
 * credential. Local reports must still come from the private worker path. */
export function durationDecisionId(network: LearningNetwork, decision: DurationDecision): string {
  return createHash("sha256").update(JSON.stringify([BLACKROOM_DURATION_TEST_ID, network, { ...decision, id: "" }])).digest("hex").slice(0,20);
}

/** Duration is tested independently of the hook. Require all arms in the
 * same DJ/set/local six-hour daypart on distinct dates, and rotate which arm
 * runs first across sets. Lifetime counts and scheduled times never qualify. */
export function evaluateDurationLearning(
  input: Parameters<typeof evaluateBlackRoomLearning>[0],
): Record<LearningNetwork, DurationDecision> {
  const local = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  });
  const snapshots = captureLearningSnapshots(input.snapshots, [], input.now);
  return Object.fromEntries(
    BLACKROOM_LEARNING_NETWORKS.map((network) => {
      const sourceObservedAt = input.sourceObservedAt[network] || null;
      const d: DurationDecision = {
        id: "",
        sourceObservedAt,
        declared: 0,
        exact: 0,
        matchedBlocks: 0,
        windowHours: null,
        recommendedSeconds: null,
        evidencePostIds: [],
        reason: "Sin pruebas declaradas de duración.",
      };
      const finish = () => {
        d.id = durationDecisionId(network, d);
        return [network, d];
      };
      if (learningSourceHealth(sourceObservedAt, input.now).status !== "fresh") {
        d.reason = "Sin métricas recientes.";
        return finish();
      }
      const identities = new Map<string, BlackRoomPublicationExperiment[]>();
      const declared = new Set<string>();
      for (const e of input.experiments) {
        if (e.network !== network) continue;
        const id = canonicalLearningPostId(network, e.platformPostId || "");
        if (e.learningTestId === BLACKROOM_DURATION_TEST_ID) declared.add(e.reservationId);
        if (!id) continue;
        const found = identities.get(id) || [];
        if (
          !found.some(
            (x) =>
              x.reservationId === e.reservationId &&
              x.durationSeconds === e.durationSeconds &&
              x.learningTestId === e.learningTestId &&
              x.format === e.format &&
              x.language === e.language &&
              x.creativeStrategy === e.creativeStrategy &&
              x.dj === e.dj &&
              x.sourceVideoId === e.sourceVideoId,
          )
        )
          found.push(e);
        identities.set(id, found);
      }
      d.declared = declared.size;
      const valid = new Map(
        [...identities].flatMap(([id, es]) => {
          const e = es[0];
          return es.length === 1 &&
            e.learningTestId === BLACKROOM_DURATION_TEST_ID &&
            DURATION_ARMS.includes(e.durationSeconds as Arm) &&
            e.dj &&
            e.dj !== "unknown" &&
            e.sourceVideoId &&
            e.format === "vertical" &&
            e.language === "en" &&
            e.creativeStrategy === "drop_first"
            ? [[id, e] as const]
            : [];
        }),
      );
      const reservations = new Map<string, number>();
      for (const e of valid.values()) reservations.set(e.reservationId, (reservations.get(e.reservationId) || 0) + 1);
      for (const [id, e] of valid) if (reservations.get(e.reservationId) !== 1) valid.delete(id);
      d.exact = valid.size;
      if (d.declared)
        d.reason = d.exact
          ? "Faltan observaciones comparables a 24, 72 o 168 horas."
          : "Esperando identificar publicaciones reales.";
      for (const window of [168, 72, 24] as const) {
        type Row = { id: string; date: string; part: number; arm: Arm; views: number; dj: string };
        const groups = new Map<string, Row[]>(),
          seen = new Set<string>();
        for (const snap of snapshots) {
          const id = canonicalLearningPostId(network, snap.postId);
          if (
            snap.network !== network ||
            snap.windowHours !== window ||
            !id ||
            seen.has(id) ||
            input.now.getTime() - Date.parse(snap.publishedAt) > 28 * 86400_000
          )
            continue;
          const e = valid.get(id);
          if (!e) continue;
          seen.add(id);
          const parts = local.formatToParts(new Date(snap.publishedAt));
          const date = parts
            .filter((p) => ["year", "month", "day"].includes(p.type))
            .map((p) => p.value)
            .join("-");
          const part = Math.floor(Number(parts.find((p) => p.type === "hour")?.value) / 6),
            dj = e.dj!;
          const key = JSON.stringify([dj, e.sourceVideoId, part]),
            group = groups.get(key) || [];
          group.push({ id, date, part, dj, views: snap.views, arm: e.durationSeconds as Arm });
          groups.set(key, group);
        }
        const blocks: Row[][] = [];
        for (const group of groups.values()) {
          group.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
          // Pick earliest arm on distinct days without looking at outcome.
          const used = new Set<string>(),
            arms = new Set<Arm>(),
            chosen: Row[] = [];
          for (const r of group)
            if (!used.has(r.date) && !arms.has(r.arm)) {
              chosen.push(r);
              used.add(r.date);
              arms.add(r.arm);
            }
          if (chosen.length === 3) blocks.push(chosen);
        }
        if (seen.size && (d.windowHours === null || blocks.length > d.matchedBlocks)) {
          d.windowHours = window;
          d.matchedBlocks = blocks.length;
          d.reason = "Faltan 5 bloques completos, 3 DJs, 2 franjas y rotación del orden de las 3 duraciones.";
        }
        if (
          blocks.length < 5 ||
          new Set(blocks.map((b) => b[0].dj)).size < 3 ||
          new Set(blocks.map((b) => b[0].part)).size < 2 ||
          new Set(blocks.map((b) => b[0].arm)).size < 3
        )
          continue;
        d.windowHours = window;
        d.matchedBlocks = blocks.length;
        d.evidencePostIds = blocks
          .flat()
          .map((r) => r.id)
          .sort();
        for (const a of DURATION_ARMS) {
          if (
            DURATION_ARMS.filter((x) => x !== a).every((other) => {
              const ratios = blocks.map(
                (b) => (1 + b.find((r) => r.arm === a)!.views) / (1 + b.find((r) => r.arm === other)!.views),
              );
              return median(ratios) >= 1.3 && ratios.filter((x) => x > 1).length / ratios.length >= 2 / 3;
            }) &&
            median(blocks.map((b) => b.find((r) => r.arm === a)!.views)) >= 20
          ) {
            d.recommendedSeconds = a;
            break;
          }
        }
        d.reason = d.recommendedSeconds
          ? `Preferencia provisional de ${d.recommendedSeconds}s por vistas a ${window}h; mantener exploración.`
          : "Sin ventaja consistente entre las tres duraciones.";
        break;
      }
      return finish();
    }),
  ) as Record<LearningNetwork, DurationDecision>;
}
export const BLACKROOM_LEARNING_NETWORKS: LearningNetwork[] = ["tiktok", "facebook", "youtube"];
export type VerifiedLearningStatus = "missing" | "stale" | "collecting" | "testing";
export interface VerifiedLearningDecision {
  id: string;
  network: LearningNetwork;
  testId: string;
  status: VerifiedLearningStatus;
  sourceObservedAt: string | null;
  windowHours: LearningWindowHours | null;
  matchedSnapshots: number;
  samplesByArm: { drop_first: number; instant_drop: number };
  matchedBlocks: number;
  metric: "retention" | "views" | null;
  winner: "drop_first" | "instant_drop" | null;
  lift: number | null;
  reason: string;
  /** Exact evidence IDs let operators reproduce a decision. */
  evidencePostIds: string[];
  declaredExperiments?: number;
  exactIdentities?: number;
}

export function canonicalLearningPostId(network: LearningNetwork, value: string): string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (!raw.includes("://")) return /^[A-Za-z0-9_-]+$/.test(raw) ? raw : null;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (network === "youtube" && (host === "youtube.com" || host === "youtu.be")) {
      return host === "youtu.be" ? url.pathname.split("/")[1] || null
        : url.searchParams.get("v") || /^\/(?:shorts|live)\/([^/]+)/.exec(url.pathname)?.[1] || null;
    }
    if (network === "tiktok" && host === "tiktok.com") return /\/video\/(\d+)/.exec(url.pathname)?.[1] || null;
    if (network === "facebook" && ["facebook.com", "m.facebook.com", "fb.watch"].includes(host)) {
      return url.searchParams.get("v") || /\/(?:reel|videos|posts)\/(\d+)/.exec(url.pathname)?.[1] || null;
    }
  } catch { /* Invalid source IDs are never guessed from captions or timestamps. */ }
  return null;
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const i = Math.floor(sorted.length / 2);
  return sorted.length ? sorted.length % 2 ? sorted[i] : (sorted[i - 1] + sorted[i]) / 2 : 0;
};

const comparisonBlock = (experiment: BlackRoomPublicationExperiment) =>
  JSON.stringify([experiment.dj, experiment.sourceVideoId, Math.floor(Number(experiment.slot.split(":")[0]) / 6)]);

/** Compare only exact identities, a declared single-factor test, one age window,
 * and matching DJ/daypart strata. Historical time-based attribution is useful
 * for reporting but intentionally cannot select a winner here. */
export function evaluateBlackRoomLearning(input: {
  snapshots: LearningSnapshot[];
  experiments: BlackRoomPublicationExperiment[];
  sourceObservedAt: Partial<Record<LearningNetwork, string | null>>;
  now: Date;
}): Record<LearningNetwork, VerifiedLearningDecision> {
  return Object.fromEntries(BLACKROOM_LEARNING_NETWORKS.map((network) => {
    const sourceObservedAt = input.sourceObservedAt[network] || null;
    const health = learningSourceHealth(sourceObservedAt, input.now);
    const decision: VerifiedLearningDecision = {
      id: "", network, testId: BLACKROOM_HOOK_TEST_ID,
      status: health.status === "fresh" ? "collecting" : health.status === "stale" ? "stale" : "missing",
      sourceObservedAt, windowHours: null, matchedSnapshots: 0,
      samplesByArm: { drop_first: 0, instant_drop: 0 }, matchedBlocks: 0,
      metric: null, winner: null, lift: null, evidencePostIds: [],
      reason: health.status === "fresh" ? "Recolectando observaciones comparables; sin ganador todavía."
        : "Sin métricas recientes verificables; no se aplican ganadores ni aumentos de volumen.",
    };
    const finish = () => {
      decision.id = createHash("sha256").update(JSON.stringify(decision)).digest("hex").slice(0, 20);
      return [network, decision];
    };
    if (health.status !== "fresh") return finish();
    const identities = new Map<string, BlackRoomPublicationExperiment[]>();
    const declared = new Set<string>();
    for (const experiment of input.experiments) {
      if (experiment.network !== network || experiment.learningTestId !== BLACKROOM_HOOK_TEST_ID) continue;
      if (experiment.durationSeconds !== 15 || experiment.format !== "vertical" || experiment.language !== "en") continue;
      if (!experiment.dj || experiment.dj === "unknown" || !experiment.sourceVideoId) continue;
      if (!["drop_first", "instant_drop"].includes(experiment.creativeStrategy)) continue;
      declared.add(experiment.reservationId);
      // Platform ID must come from the published receipt, not the scheduler ID.
      const id = canonicalLearningPostId(network, experiment.platformPostId || "");
      if (!id) continue;
      const entries = identities.get(id) || [];
      if (!entries.some((entry) => entry.reservationId === experiment.reservationId)) entries.push(experiment);
      identities.set(id, entries);
    }
    decision.declaredExperiments = declared.size;
    decision.exactIdentities = [...identities.values()].filter((entries) => entries.length === 1).length;
    const valid = captureLearningSnapshots(input.snapshots, [], input.now).flatMap((snapshot) => {
      if (snapshot.network !== network || Date.parse(snapshot.observedAt) > input.now.getTime()
        || input.now.getTime() - Date.parse(snapshot.publishedAt) > 28 * 86400_000) return [];
      const id = canonicalLearningPostId(network, snapshot.postId);
      const matches = id ? identities.get(id) || [] : [];
      if (matches.length !== 1) return [];
      return [{ snapshot, experiment: matches[0], id: id! }];
    });
    // Select a single mature window. Never mix a 24-hour post with a 7-day post.
    for (const windowHours of [168, 72, 24] as LearningWindowHours[]) {
      const deduped = new Map<string, typeof valid[number]>();
      for (const row of valid.filter((item) => item.snapshot.windowHours === windowHours)) {
        if (!deduped.has(row.id)) deduped.set(row.id, row);
      }
      const rows = [...deduped.values()];
      const counts = { drop_first: 0, instant_drop: 0 };
      for (const row of rows) counts[row.experiment.creativeStrategy as keyof typeof counts]++;
      if (!decision.windowHours || rows.length > decision.matchedSnapshots) {
        decision.windowHours = windowHours; decision.matchedSnapshots = rows.length; decision.samplesByArm = counts;
      }
      if (Math.min(counts.drop_first, counts.instant_drop) < 5) continue;
      const dates = new Set(rows.map((row) => row.snapshot.publishedAt.slice(0, 10)));
      if (dates.size < 3) continue;
      const retention = rows.every((row) => typeof row.snapshot.averageWatchSeconds === "number");
      const blocks = new Map<string, { drop_first: number[]; instant_drop: number[] }>();
      for (const row of rows) {
        const hour = Number(row.experiment.slot.split(":")[0]);
        if (!Number.isInteger(hour) || hour < 0 || hour > 23) continue;
        const key = comparisonBlock(row.experiment);
        const block = blocks.get(key) || { drop_first: [], instant_drop: [] };
        const score = retention ? row.snapshot.averageWatchSeconds! / 15 : row.snapshot.views;
        block[row.experiment.creativeStrategy as keyof typeof block].push(score);
        blocks.set(key, block);
      }
      const paired = [...blocks].filter(([, block]) => block.drop_first.length && block.instant_drop.length);
      if (paired.length < 3 || new Set(paired.map(([key]) => JSON.parse(key)[0])).size < 3) continue;
      const pairedKeys = new Set(paired.map(([key]) => key));
      const evidence = rows.filter((row) => pairedKeys.has(comparisonBlock(row.experiment)));
      const pairedCounts = { drop_first: 0, instant_drop: 0 };
      for (const row of evidence) pairedCounts[row.experiment.creativeStrategy as keyof typeof pairedCounts]++;
      if (Math.min(pairedCounts.drop_first, pairedCounts.instant_drop) < 5
        || new Set(evidence.map((row) => row.snapshot.publishedAt.slice(0, 10))).size < 3) continue;
      const ratios = paired.map(([, block]) => (median(block.instant_drop) + 0.01) / (median(block.drop_first) + 0.01));
      const ratio = median(ratios);
      const threshold = retention ? 1.2 : 1.3;
      const winner = ratio >= threshold && ratios.filter((value) => value > 1).length / ratios.length >= 2 / 3 ? "instant_drop"
        : ratio <= 1 / threshold && ratios.filter((value) => value < 1).length / ratios.length >= 2 / 3 ? "drop_first" : null;
      Object.assign(decision, { windowHours, matchedSnapshots: evidence.length, samplesByArm: pairedCounts,
        matchedBlocks: paired.length, metric: retention ? "retention" : "views", winner,
        lift: winner ? winner === "instant_drop" ? ratio - 1 : 1 / ratio - 1 : null,
        status: "testing", evidencePostIds: evidence.map((row) => row.id).sort(),
        reason: winner ? `Ganador provisional ${winner}: comparación a ${windowHours}h en ${paired.length} bloques DJ/set/horario. Los cortes distintos pueden influir; mantener 20% de exploración.`
          : `Prueba a ${windowHours}h sin mejora consistente; mantener comparación equilibrada, 5 publicaciones/día.`,
      });
      break;
    }
    if (decision.status === "collecting") {
      if (!declared.size) decision.reason = "Sin clips de la prueba declarada; el historial anterior no sustituye una prueba controlada.";
      else if (!decision.exactIdentities) decision.reason = `${declared.size} clips de prueba registrados; esperando publicación e identidad exacta en las métricas. Programado no significa publicado.`;
      else if (!decision.matchedSnapshots) decision.reason = "Hay identidades exactas, pero faltan mediciones de la prueba a 24h, 72h o 7 días; no se reconstruyen datos históricos.";
      else decision.reason = "Faltan parejas comparables: mínimo 5 por edición, 3 días y 3 DJs con el mismo set y franja horaria. Sin ganador todavía.";
      if (!decision.matchedSnapshots) decision.windowHours = null;
    }
    return finish();
  })) as Record<LearningNetwork, VerifiedLearningDecision>;
}
