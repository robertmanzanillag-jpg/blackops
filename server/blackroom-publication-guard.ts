// Pure policy: no storage, environment loading, credentials or transport imports.
export function strictBlackRoomEnabled(value: unknown): boolean {
  return value === true;
}

export interface BlackRoomPublicationControl {
  desiredEnabled: unknown;
  queue: {
    enabled?: unknown;
    jobs?: Array<{ id?: string; status?: string; notBefore?: string }>;
  };
}

export function blackRoomPublicationFlagVeto(env: Readonly<Record<string, string | undefined>>): string | null {
  // Dedicated default-off authorization; never borrows Clippers/news consent.
  if (env.BLACKROOM_METRICOOL_BRIDGE_PUBLISH_AUTHORIZED !== "true") return "bridge_not_authorized";
  // This bridge has no per-post human approval proof. Fail closed by default.
  if (env.METRICOOL_REQUIRE_APPROVAL_FOR_PUBLISH !== "false") return "approval_required";
  return null;
}

export function blackRoomPublicationControlVeto(
  control: BlackRoomPublicationControl, jobId: string | undefined, now: Date,
): string | null {
  if (!strictBlackRoomEnabled(control.desiredEnabled)) return "control_disabled";
  if (control.queue.enabled !== true) return "queue_disabled";
  const job = jobId && control.queue.jobs?.find(item => item.id === jobId);
  if (!job || !["queued", "retry", "processing"].includes(job.status || "")) return "job_ineligible";
  if (job.notBefore && !(Date.parse(job.notBefore) <= now.getTime())) return "job_not_due";
  return null;
}

export class BlackRoomPublicationBlockedError extends Error {
  readonly blocked = true;
  readonly retainAttempt = true;
  readonly preserveUpload = true;
  readonly definitelyNotSubmitted = true;
  // Plain field (not a constructor parameter property): this module also runs under Node's native
  // type stripping (the local BlackRoom ledger runner), which rejects parameter properties.
  readonly reason: string;
  constructor(reason: string) {
    super(`BlackRoom publication blocked: ${reason}`);
    this.reason = reason;
    this.name = "BlackRoomPublicationBlockedError";
  }
}

export function retainBlackRoomAttempt(error: { uncertain?: boolean; retainAttempt?: boolean }): boolean {
  return error.uncertain === true || error.retainAttempt === true;
}
