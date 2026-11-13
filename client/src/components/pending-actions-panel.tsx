import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check, Clock3, Play, ShieldCheck, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { queryClient } from "@/lib/queryClient";

type PendingAction = {
  id: string;
  title: string;
  description: string;
  actionType: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  status: string;
  createdAt: string;
  input?: Record<string, unknown>;
  editedInput?: Record<string, unknown>;
};

function postAction(id: string, action: "approve" | "reject" | "execute") {
  return fetch(`/api/pending-actions/${id}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason: "Dashboard CEO" }),
  }).then(async (response) => {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "No se pudo actualizar la aprobacion");
    return data;
  });
}

function editAction(id: string, editedInput: Record<string, unknown>) {
  return fetch(`/api/pending-actions/${id}/edit`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ editedInput, note: "Nombre del DJ desde Dashboard CEO" }),
  }).then(async (response) => {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "No se pudo guardar el nombre");
    return data;
  });
}

function RadioDjNameResolver({
  action,
  disabled,
  onSave,
}: {
  action: PendingAction;
  disabled: boolean;
  onSave: (id: string, editedInput: Record<string, unknown>) => void;
}) {
  const currentName = String(action.editedInput?.djName || "");
  const [djName, setDjName] = useState(currentName);
  const baseInput = {
    ...(action.input || {}),
    ...(action.editedInput || {}),
  };

  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-white/10 pt-3 sm:flex-row">
      <Input
        value={djName}
        onChange={(event) => setDjName(event.target.value)}
        placeholder="Nombre del DJ"
        className="h-9 border-zinc-800 bg-zinc-950 text-sm text-white placeholder:text-zinc-600"
      />
      <Button
        size="sm"
        onClick={() => onSave(action.id, { ...baseInput, djName: djName.trim() })}
        disabled={disabled || djName.trim().length < 2}
        className="bg-zinc-100 text-zinc-950 hover:bg-white"
      >
        <Check className="mr-1 h-3.5 w-3.5" />
        Guardar nombre
      </Button>
    </div>
  );
}

export function PendingActionsPanel() {
  const { data: actionsResponse, isLoading } = useQuery<PendingAction[]>({
    queryKey: ["pending-actions"],
    queryFn: async () => {
      const response = await fetch("/api/pending-actions");
      const data = await response.json().catch(() => []);
      if (!response.ok) throw new Error((data as { error?: string }).error || "No se pudieron cargar aprobaciones");
      return Array.isArray(data) ? data : [];
    },
    refetchInterval: 30000,
  });
  const actions = Array.isArray(actionsResponse) ? actionsResponse : [];

  const mutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "approve" | "reject" | "execute" }) => postAction(id, action),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pending-actions"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["investments"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  const editMutation = useMutation({
    mutationFn: ({ id, editedInput }: { id: string; editedInput: Record<string, unknown> }) => editAction(id, editedInput),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pending-actions"] });
    },
  });

  const visibleActions = actions
    .filter((action) => ["pending", "edited", "snoozed", "approved"].includes(action.status))
    .slice(0, 5);

  if (!isLoading && visibleActions.length === 0) return null;

  return (
    <section className="rounded-2xl border border-white/10 bg-zinc-950/80 p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-zinc-900">
            <ShieldCheck className="h-5 w-5 text-zinc-300" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">Aprobaciones CEO</h2>
            <p className="text-xs text-zinc-500">Acciones sensibles esperando control manual.</p>
          </div>
        </div>
        <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-zinc-400">
          {visibleActions.length}
        </span>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <Clock3 className="h-4 w-4 animate-pulse" />
          Cargando aprobaciones...
        </div>
      ) : (
        <div className="space-y-3">
          {visibleActions.map((action) => (
            <div key={action.id} className="rounded-xl border border-white/10 bg-black/30 p-3">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium text-white">{action.title}</p>
                    <span className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] uppercase tracking-wide text-zinc-500">
                      {action.riskLevel}
                    </span>
                    {action.status === "approved" && (
                      <span className="rounded-full border border-emerald-400/20 px-2 py-0.5 text-[11px] text-emerald-300">
                        aprobado
                      </span>
                    )}
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-zinc-500">{action.description}</p>
                  <p className="mt-1 text-[11px] text-zinc-600">{action.actionType}</p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {action.actionType === "radio_edit.resolve_dj_name" ? null : action.status !== "approved" ? (
                    <Button
                      size="sm"
                      onClick={() => mutation.mutate({ id: action.id, action: "approve" })}
                      disabled={mutation.isPending}
                      className="bg-zinc-100 text-zinc-950 hover:bg-white"
                    >
                      <Check className="mr-1 h-3.5 w-3.5" />
                      Aprobar
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => mutation.mutate({ id: action.id, action: "execute" })}
                      disabled={mutation.isPending}
                      className="bg-zinc-100 text-zinc-950 hover:bg-white"
                    >
                      <Play className="mr-1 h-3.5 w-3.5" />
                      Ejecutar
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => mutation.mutate({ id: action.id, action: "reject" })}
                    disabled={mutation.isPending}
                    className="border-zinc-800 text-zinc-400"
                  >
                    <X className="mr-1 h-3.5 w-3.5" />
                    Rechazar
                  </Button>
                </div>
              </div>
              {action.actionType === "radio_edit.resolve_dj_name" && action.status !== "approved" && (
                <RadioDjNameResolver
                  action={action}
                  disabled={editMutation.isPending}
                  onSave={(id, editedInput) => editMutation.mutate({ id, editedInput })}
                />
              )}
            </div>
          ))}
          {(mutation.isError || editMutation.isError) && (
            <p className="flex items-center gap-2 text-xs text-amber-300">
              <AlertTriangle className="h-3.5 w-3.5" />
              {((mutation.error || editMutation.error) as Error).message}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
