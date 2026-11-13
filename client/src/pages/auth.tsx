import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { LockKeyhole, LogIn, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { queryClient } from "@/lib/queryClient";

type AuthMode = "login" | "register";

async function submitAuth(mode: AuthMode, username: string, password: string) {
  const response = await fetch(`/api/auth/${mode}`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!(response.headers.get("content-type") || "").includes("application/json")) {
    throw new Error("El servidor de login no está disponible.");
  }
  const payload = await response.json();
  if (!response.ok || payload?.authenticated !== true || !payload?.user?.id) {
    throw new Error(payload?.error || "No se pudo iniciar sesión.");
  }
  return payload;
}

export default function AuthPage() {
  const [mode, setMode] = useState<AuthMode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const authMutation = useMutation({
    mutationFn: () => submitAuth(mode, username, password),
    onSuccess: () => {
      queryClient.removeQueries({ predicate: query => query.queryKey[0] !== "auth-me" });
      queryClient.invalidateQueries({ queryKey: ["auth-me"] });
    },
  });
  const canSubmit = username.trim().length >= 2 && password.length >= 8 && !authMutation.isPending;

  return (
    <main className="min-h-screen bg-black text-white">
      <section className="mx-auto flex min-h-screen w-full max-w-md items-center px-4 py-10">
        <Card className="w-full border-white/10 bg-zinc-950/90">
          <CardHeader className="space-y-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04]">
              <LockKeyhole className="h-5 w-5 text-emerald-300" />
            </div>
            <CardTitle className="text-2xl text-white">BlackOps CEO</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-5 grid grid-cols-2 rounded-lg border border-white/10 bg-black p-1">
              <Button
                type="button"
                variant={mode === "login" ? "default" : "ghost"}
                className="gap-2"
                onClick={() => setMode("login")}
              >
                <LogIn className="h-4 w-4" />
                Entrar
              </Button>
              <Button
                type="button"
                variant={mode === "register" ? "default" : "ghost"}
                className="gap-2"
                onClick={() => setMode("register")}
              >
                <UserPlus className="h-4 w-4" />
                Crear
              </Button>
            </div>

            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (canSubmit) authMutation.mutate();
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="username" className="text-zinc-300">Usuario</Label>
                <Input
                  id="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoComplete="username"
                  className="border-white/10 bg-black"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password" className="text-zinc-300">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  className="border-white/10 bg-black"
                />
              </div>

              {authMutation.isError && (
                <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                  {(authMutation.error as Error).message}
                </p>
              )}

              <Button type="submit" disabled={!canSubmit} className="w-full gap-2">
                {mode === "login" ? <LogIn className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
                {mode === "login" ? "Entrar" : "Crear cuenta"}
              </Button>
            </form>

          </CardContent>
        </Card>
      </section>
    </main>
  );
}
