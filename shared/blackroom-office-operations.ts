/** The office supervises the existing publisher; it never starts a second one. */
export const BLACKROOM_OFFICE_POLICY = {
  minimumDailyClips: 3,
  targetDailyClips: 5,
  maximumDailyClips: 5,
  networks: ["tiktok", "facebook", "youtube"],
  publisher: "blackroom-primary",
  automaticSpend: false,
  deleteOnlyAfterAllDestinationReceipts: true,
  youtubeShortsOnly: true,
} as const;

export type BlackRoomOfficeNetwork = typeof BLACKROOM_OFFICE_POLICY.networks[number];
export type BlackRoomOfficeAction = {
  id: "restore-worker" | "verify-calendar" | "restore-metrics" | "reconcile-identities" | "review-cadence" | "apply-generation" | "inspect-worker-error";
  owner: "blackroom-videos" | "marketing" | "mechanic";
  severity: "warning" | "critical";
  message: string;
  /** These are recovery proposals, not proof that a repair was executed. */
  executed: false;
};

export interface BlackRoomOfficeOperations {
  checkedAt: string;
  policy: typeof BLACKROOM_OFFICE_POLICY;
  state: "paused" | "blocked" | "working" | "waiting";
  worker: { online: boolean; seenAt: string | null; generationApplied: boolean; processing: boolean; progressEventId: string | null; progressAt: string | null };
  queue: { queued: number; processing: number; retry: number; scheduled: number; completed: number; authoritative: boolean };
  coverage: { status: "unverified"; reason: string };
  learning: Record<BlackRoomOfficeNetwork, {
    sourceObservedAt: string | null;
    sourceStatus: "missing" | "fresh" | "stale" | "invalid";
    samples: number;
    exactAttributed: number;
    comparableSnapshots: number;
    status: "missing" | "stale" | "collecting" | "testing";
    provisionalWinner: string | null;
    reason: string;
  }>;
  actions: BlackRoomOfficeAction[];
  /** Company supervision can run in the cloud; rendering is still device-bound. */
  execution: { publisherOwner: "existing-worker"; newPublisherStarted: false; requiresWorkerOnline: true; cloud24x7Verified: false };
}
