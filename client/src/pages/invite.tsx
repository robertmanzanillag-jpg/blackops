import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Handshake, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { queryClient } from "@/lib/queryClient";

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!(response.headers.get("content-type") || "").includes("application/json")) throw new Error("El servidor no está disponible.");
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error || "No se pudo completar la invitación.");
  return payload as T;
}

/** /invite/:token — the partner ("socio") creates a username + password and joins the office. */
export default function InvitePage({ token }: { token: string }) {
  const [, navigate] = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const preview = useQuery<{ status: "open" | "unavailable" | "invalid"; expiresAt?: string | null }>({
    queryKey: ["workspace-invite-preview", token],
    queryFn: () => postJson("/api/workspace/invitations/preview", { token }),
    enabled: Boolean(token),
    retry: false,
  });

  const accept = useMutation({
    mutationFn: () => postJson<{ authenticated: boolean }>("/api/workspace/invitations/accept", { token, username, password }),
    onSuccess: () => {
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== "auth-me" });
      queryClient.invalidateQueries({ queryKey: ["auth-me"] });
      navigate("/agents-office");
    },
  });

  const passwordsMatch = password === confirm;
  const canSubmit = preview.data?.status === "open" && username.trim().length >= 2 && password.length >= 8 && passwordsMatch && !accept.isPending;
  const unavailable = preview.isError || (preview.data && preview.data.status !== "open");

  return (
    <main className="min-h-screen bg-black text-white">
      <section className="mx-auto flex min-h-screen w-full max-w-md items-center px-4 py-10">
        <Card className="w-full border-white/10 bg-zinc-950/90">
          <CardHeader className="space-y-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04]">
              <Handshake className="h-5 w-5 text-fuchsia-300" />
            </div>
            <CardTitle className="text-2xl text-white">Invitación de socio</CardTitle>
            <p className="text-sm text-zinc-400">
              Robert te invitó a la oficina de BlackOps. Vas a poder ver toda la oficina y trabajar con el equipo de Black Room: hablar con sus agentes, darles órdenes y aprobar publicaciones.
            </p>
          </CardHeader>
          <CardContent>
            {preview.isLoading && <p className="text-sm text-zinc-400">Revisando la invitación…</p>}
            {unavailable && (
              <p role="alert" className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100" data-testid="invite-unavailable">
                Esta invitación no es válida, ya se usó, venció o fue revocada. Pide a Robert un enlace nuevo.
              </p>
            )}
            {preview.data?.status === "open" && (
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (canSubmit) accept.mutate();
                }}
              >
                <div className="space-y-2">
                  <Label htmlFor="invite-username" className="text-zinc-300">Usuario</Label>
                  <Input id="invite-username" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" className="border-white/10 bg-black" data-testid="invite-username" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="invite-password" className="text-zinc-300">Contraseña (mínimo 8 caracteres)</Label>
                  <Input id="invite-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" className="border-white/10 bg-black" data-testid="invite-password" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="invite-confirm" className="text-zinc-300">Repite la contraseña</Label>
                  <Input id="invite-confirm" type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="new-password" className="border-white/10 bg-black" />
                  {!passwordsMatch && confirm.length > 0 && <p className="text-xs text-amber-200">Las contraseñas no coinciden.</p>}
                </div>
                {accept.isError && (
                  <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{(accept.error as Error).message}</p>
                )}
                <Button type="submit" disabled={!canSubmit} className="w-full gap-2" data-testid="invite-accept">
                  <UserPlus className="h-4 w-4" />
                  Crear mi cuenta de socio
                </Button>
                {preview.data.expiresAt && <p className="text-center text-xs text-zinc-500">El enlace vence el {new Date(preview.data.expiresAt).toLocaleDateString("es")}. Solo se puede usar una vez.</p>}
              </form>
            )}
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
