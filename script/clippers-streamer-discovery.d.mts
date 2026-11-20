export interface StreamerState { version: 1; failureStreak?: number; updatedAt: string | null; lastRun: any; creators: Record<string, any>; takedowns: any[]; candidates: any[]; signals: any[]; cityPages?: any[] }
export declare const STREAMER_SECRET_NAMES: readonly string[];
export declare const STREAMER_APPROVAL_ACTION: string;
export declare function STREAMER_STATE_NAMESPACE(owner: string): string;
export declare function parseStreamerState(raw: string | null): StreamerState;
export declare function emptyStreamerState(): StreamerState;
export declare function localWorkQueue(state: StreamerState): Array<Record<string, unknown>>;
export declare function streamerConfig(env?: Record<string, string | undefined>): Record<string, any>;
export declare function runStreamerDiscovery(input: Record<string, any>): Promise<{ report: any; state: StreamerState }>;
export declare function parseStreamerStateStrict(raw: string | null): StreamerState | null;
export declare function creatorPolicyChecked(state: StreamerState, candidate: any): boolean;
export declare const approvalInsertLockKey: (row: { userId: string; actionType: string; resourceId: string }) => string;
export declare function createPendingActionsQueue(query: (sql: string, values?: unknown[]) => Promise<{ rows: any[] }>, options?: { transaction?: <T>(fn: (query: (sql: string, values?: unknown[]) => Promise<{ rows: any[] }>) => Promise<T>) => Promise<T> }): { insert(row: any): Promise<string>; rejectCandidates(owner: string, ids: string[], reason: string): Promise<number>; statuses(owner: string, ids: string[]): Promise<Map<string, string>> };
