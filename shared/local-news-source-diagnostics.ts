export type SourceOutcome = "recent_news" | "candidates_only" | "empty" | "no_recent_news" | "undated" | "error";
export type SourceErrorCategory = "potentially_transient" | "configuration_or_access" | "invalid_response" | "unknown";
export interface SourceError {
  code: string;
  category: SourceErrorCategory;
  message: string;
  httpStatus?: number;
}
export interface SourceObservation {
  attemptId: string;
  sourceId: string;
  lane: "miami-news" | "ny-news";
  checkedAt: string;
  outcome: SourceOutcome;
  receivedCount: number | null;
  acceptedCount: number;
  recentCandidateCount: number;
  recentCount: number;
  ingestionComplete: boolean;
  undatedCount: number;
  newestOriginalPublishedAt: string | null;
  error: SourceError | null;
}
export interface SourceDiagnostic {
  id: string;
  name: string;
  city: "Miami" | "New York";
  configured: boolean;
  status: SourceOutcome | "disabled" | "not_observed" | "stale";
  lastAttemptAt: string | null;
  lastFetchSuccessAt: string | null;
  lastNewsSuccessAt: string | null;
  latest: SourceObservation | null;
  history: SourceObservation[];
}
export interface SourceDiagnostics {
  available: boolean;
  storageError: "missing" | "invalid" | "write_failed" | null;
  scope: "local_instance";
  recentWindowHours: 72;
  retentionDays: 7;
  maxHistoryPerSource: 100;
  observationMaxAgeMinutes: number;
  sources: SourceDiagnostic[];
}
