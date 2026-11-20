export type LaneId = 'content' | 'youtube_delivery' | 'marketplace' | 'watchdog' | 'sleep_content' | 'sleep_delivery';
export interface LaneRun { at: string; status: string; heldReasons: string[]; errors: string[]; counts: Record<string, number>; dryRun: boolean }
export interface LanesState {
  version: 1;
  lanes: Partial<Record<LaneId, { lastRun: LaneRun | null; lastDryRun: LaneRun | null; failureStreak: number }>>;
  leases: Partial<Record<LaneId, { holder: 'mac' | 'cloud'; at: string; host: string | null }>>;
  retired: Partial<Record<LaneId, { at: string; by: string }>>;
}
export interface LaneView { lane: LaneId; state: 'completed' | 'idle' | 'held' | 'stale' | 'disconnected'; reasons: string[]; counts: Record<string, number>;
  lastRunAt: string | null; retiredAt: string | null; macActive: boolean; note: string | null; failureStreak: number }
export declare const CLOUD_LANES_NAMESPACE: (owner: string) => string;
export declare const CLOUD_WORKSPACE_NAMESPACE: (owner: string) => string;
export declare const LANE_LEASE_MS: number;
export declare const CLOUD_LANE_STALE_MS: number;
export declare const CLOUD_LANE_FAILURE_STREAK_THRESHOLD: number;
export declare const MAC_LANES: Readonly<Record<LaneId, { label: string; macTime: string; roles: string[]; cloud: string; coveredOnly?: boolean; cloudOnly?: boolean; macLane?: LaneId }>>;
export declare const LANE_IDS: readonly LaneId[];
export declare const CLOUD_LEASED_LANES: readonly LaneId[];
export declare const MAC_LANE_IDS: readonly LaneId[];
export declare function macLaneOf(lane: string): LaneId;
export declare function laneKind(lane: string): LaneId;
export declare const CLOUD_JOBS: Readonly<Record<'owned_content' | 'sleep' | 'marketplace', LaneId[]>>;
export declare const INFORMATIONAL_REASONS: ReadonlySet<string>;
export declare function isInformational(reason: string): boolean;
export declare function safeCodes(list: unknown): string[];
export declare function emptyLanesState(): LanesState;
export declare function parseLanesState(raw: unknown): LanesState;
export declare function acquireLane(state: LanesState, lane: string, holder: 'mac' | 'cloud', now: number, options?: { host?: string | null }): { ok: boolean; reason: string | null; since?: string };
export declare function recordLaneRun(state: LanesState, lane: string, run: Partial<LaneRun> & { at: string; status: string }): LanesState;
export declare function retireMacLanes(state: LanesState, lanes: string[], now: number, by?: string): LanesState;
export declare function unretireMacLanes(state: LanesState, lanes: string[], now?: number): LanesState;
export declare function laneCloudQa(state: LanesState, lane: string, now: number): { ok: boolean; evidence: string | null };
export declare function laneView(state: LanesState, lane: LaneId, now: number): LaneView;
