export type ClipPolicy = 'allowed_unless_prohibited' | 'prohibited';
export interface LegacyDiscoveryCreator { readonly id: string; readonly handle: string; readonly channelId: string; readonly language: string | null; readonly identityEvidenceUrl: string; readonly identityVerifiedAt: string }
export interface DiscoveryCreator extends LegacyDiscoveryCreator { readonly creatorGroupId: string; readonly name: string; readonly role: string; readonly permission: 'unknown'; readonly mayPublish: false; readonly clipPolicy: ClipPolicy }
export interface CreatorGroup { readonly id: string; readonly name: string; readonly aliases: readonly string[] }
export declare const LEGACY_DISCOVERY_CREATORS: readonly LegacyDiscoveryCreator[];
export declare const DISCOVERY_CREATORS: typeof LEGACY_DISCOVERY_CREATORS;
export declare const PRIORITY_CREATORS: readonly DiscoveryCreator[];
export declare const DISCOVERY_CANDIDATES: readonly DiscoveryCreator[];
export declare const CHALLENGER_CREATORS: readonly DiscoveryCreator[];
export declare const ALL_DISCOVERY_CREATORS: readonly DiscoveryCreator[];
export declare const CREATOR_GROUPS: readonly CreatorGroup[];
export declare const KNOWN_CREATOR_GROUPS: readonly CreatorGroup[];
export declare function resolveCreatorGroup(value: unknown): CreatorGroup | null;
export declare function resolveCreatorChannel(channelId: unknown): DiscoveryCreator | null;
export declare function canonicalSourceIdentity(value: unknown): string | null;
export declare const CLIP_POLICIES: readonly ClipPolicy[];
export interface KnownProhibitedCreator { readonly creatorGroupId?: string; readonly creatorKey?: string; readonly evidenceUrl?: string; readonly evidenceText?: string; readonly recordedAt?: string }
export declare const KNOWN_PROHIBITED_CREATORS: readonly KnownProhibitedCreator[];
export declare const TWITCH_LOGIN_CANDIDATES: Readonly<Record<string, readonly string[]>>;
