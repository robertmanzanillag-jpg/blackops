export interface ClipPolicyResult { status: 'allowed_unless_prohibited' | 'prohibited'; source: string; evidence: Record<string, unknown> | null; checkedAt: string }
export interface Takedown { id: string | null; creatorKey: string | null; creatorGroupId: string | null; candidateId: string | null; reason: string; receivedAt: string; removeBy: string; removedAt: string | null }
export interface CityPage { brandId: string; city: string; name: string | null; handle?: string; status: 'named' | 'name_pending_owner'; source?: 'default' | 'env' }
export declare const STREAMER_CLIP_MAX_SECONDS: number;
export declare const TAKEDOWN_SLA_HOURS: number;
export declare const PROHIBITION_PATTERNS: readonly RegExp[];
export declare const CITY_PAGE_BRANDS: Readonly<Record<string, string>>;
export declare const DEFAULT_CITY_PAGE_NAMES: Readonly<Record<string, Readonly<{ name: string; handle: string }>>>;
export declare function detectClipProhibition(text: unknown): { prohibited: boolean; matched: string | null; excerpt: string | null };
export declare function creatorKey(platform: string, id: string): string;
export declare function isCreatorKey(value: unknown): boolean;
export declare function parseTakedown(value: unknown, now?: number): Takedown | null;
export declare function takedownBlocks(takedowns: readonly Takedown[] | undefined, target: { creatorKey?: string | null; creatorGroupId?: string | null; candidateId?: string | null }): Takedown | null;
export declare function resolveClipPolicy(input: Record<string, unknown>): ClipPolicyResult;
export declare function buildCreditCaption(input: { handle: string; platform: string; sourceUrl: string; title?: string; language?: string }): string;
export declare function captionHasCredit(caption: unknown, handle: string, sourceUrl: string): boolean;
export declare function parseCityPageNames(raw: unknown): { pages: CityPage[]; heldReasons: string[] };
export declare function clipLengthAllowed(seconds: unknown): boolean;
