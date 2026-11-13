export function kongOfficeSnapshotKey(ownerId: string | undefined) {
  return ["/api/agents-office/kong-snapshot", ownerId ?? "no-session"] as const;
}

export async function readOwnerKongSnapshot(ownerId: string | undefined, currentOwner: () => string | undefined, signal?: AbortSignal) {
  if (!ownerId || currentOwner() !== ownerId) throw new Error("401: Sesión sin verificar");
  const response = await fetch("/api/agents-office/kong-snapshot", { credentials: "include", signal });
  if (!response.ok) throw new Error(`${response.status}: No se pudo verificar KONG`);
  const value = await response.json();
  if (currentOwner() !== ownerId) throw new Error("401: La sesión cambió durante la consulta");
  return value;
}
