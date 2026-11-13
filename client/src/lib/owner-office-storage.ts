/** Owner-less legacy state must not be attributed to whoever signs in next. */
export function ownerOfficeStorageKey(key: string, ownerId: string): string {
  if (!ownerId.trim()) throw new Error("Office storage requires an authenticated owner.");
  return `${key}:owner:${encodeURIComponent(ownerId)}`;
}
