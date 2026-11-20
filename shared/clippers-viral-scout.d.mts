export type ViralScoutCandidate = {
  creatorId: string; channelId: string; creatorName: string; videoId: string; title: string;
  url: string; sourceUrl: string; publishedAt: string; observedAt: string;
  views: number | null; likes: null; ageHoursWhenObserved: number;
  previousObservedAt: string | null; previousViews: number | null;
  sampleSpanHours: number | null; growthViews: number | null; growthPerHour: number | null;
  evidence: 'growth_observed' | 'popularity_observed' | 'metrics_unknown' | 'counter_unchanged' | 'counter_decreased';
  rights: 'unknown'; mayPublish: false;
};
export type ViralScoutView = {
  schemaVersion: 1; evaluatedAt: string; status: 'candidates' | 'no_recent_candidates' | 'no_data';
  source: 'official_youtube_feeds'; scope: 'configured_catalogue'; requestsAdded: 0;
  paidSpendUsd: 0; mayPublish: false; candidates: ViralScoutCandidate[];
};
export declare function buildViralScout(receipts: unknown, now?: Date): ViralScoutView;
export declare function parseViralScout(value: unknown, now?: number): ViralScoutView | null;
