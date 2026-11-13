import type { Source } from './agents-world';

/** Cached identity must match the current native session before owner reads. */
export function worldOwnerMatches(ownerId: string, auth: Source): boolean {
  if (!ownerId || auth.state !== 'ready' || !auth.data || typeof auth.data !== 'object') return false;
  const data = auth.data as { authenticated?: unknown; user?: { id?: unknown } };
  return data.authenticated === true && data.user?.id === ownerId;
}
