export interface AuthState {
  authenticated: boolean;
  sessionBacked?: boolean;
  usingDevFallback?: boolean;
  user?: { id: string; username: string };
}

export async function readAuthState(response: Response): Promise<AuthState> {
  if (response.status === 401) return { authenticated: false };
  if (!response.ok || !(response.headers.get("content-type") || "").includes("application/json")) {
    throw new Error("No se pudo verificar la sesión. Intenta nuevamente.");
  }
  const payload = await response.json();
  if (payload?.authenticated === false) return { authenticated: false };
  if (payload?.authenticated !== true || typeof payload?.user?.id !== "string" || !payload.user.id.trim()
    || typeof payload?.user?.username !== "string" || !payload.user.username.trim()) {
    throw new Error("Respuesta de sesión inválida.");
  }
  return payload;
}
