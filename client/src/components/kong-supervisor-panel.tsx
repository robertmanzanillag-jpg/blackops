import { useId, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { KONG_SUPERVISOR_ID, KONG_WORKERS, type KongChatAgentId, type KongSupervision } from "@shared/kong-supervisor";
import { kongSupervisorSessionScope, type SupervisorAuth } from "./kong-supervisor-session";

const AGENTS: Array<{ id: KongChatAgentId; name: string }> = [
  { id: KONG_SUPERVISOR_ID, name: "Supervisor KONG" },
  ...KONG_WORKERS.map(id => ({ id, name: id === "kong-videos" ? "Videos Kong" : id.slice(5) })),
];
async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000), credentials: "same-origin" });
  if (!response.ok) throw new Error(response.status === 401 ? "Inicia sesion para hablar con el equipo." : "No se pudo completar la solicitud. Puedes reintentar.");
  return response.json() as Promise<T>;
}

// This component can be mounted in both the 3D and the fallback office. The
// dialog owns focus handling; opening it only reads state, never runs a task.
export function KongSupervisorPanel() {
  const [open, setOpen] = useState(false);
  const [agentId, setAgentId] = useState<KongChatAgentId>(KONG_SUPERVISOR_ID);
  const [draft, setDraft] = useState<{ scope: string | null; text: string }>({ scope: null, text: "" });
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ scope: string | null; text: string } | null>(null);
  const requestRef = useRef<{ agentId: KongChatAgentId; message: string; requestId: string; scope: string } | null>(null);
  const sendingRef = useRef(false);
  const fieldId = useId();
  const queryClient = useQueryClient();
  const routerAuth = useQuery<SupervisorAuth>({ queryKey: ["auth-me"], enabled: false });
  const routerId = routerAuth.data?.user?.id || null;
  const verifiedAuth = useQuery({ queryKey: ["kong-supervisor-auth", routerId], queryFn: () => requestJson<SupervisorAuth>("/api/auth/me"), enabled: open && Boolean(routerId) && !routerAuth.isFetching, retry: false, staleTime: 0, gcTime: 0, refetchOnMount: "always" });
  const sessionScope = kongSupervisorSessionScope(routerAuth.data, verifiedAuth.data, routerAuth.isFetching, verifiedAuth.isFetching, verifiedAuth.isError, routerAuth.isError);
  const text = sessionScope && draft.scope === sessionScope ? draft.text : "";
  const error = sessionScope && failure?.scope === sessionScope ? failure.text : null;
  const stateKey = ["kong-supervisor-state", sessionScope];
  const lifeKey = ["kong-supervisor-life", sessionScope];
  const state = useQuery({ queryKey: stateKey, queryFn: () => requestJson<KongSupervision>("/api/kong-supervisor/state"), enabled: open && Boolean(sessionScope), retry: false, gcTime: 0 });
  const life = useQuery({ queryKey: lifeKey, queryFn: () => requestJson<{ company?: { careers?: Record<string, { battery: number; points: number; firedCount: number }> } }>("/api/agent-council/state"), enabled: open && Boolean(sessionScope) && state.isSuccess, retry: false, gcTime: 0 });
  const visibleState = sessionScope && !state.isError ? state.data : undefined;
  const career = visibleState ? life.data?.company?.careers?.[agentId] : undefined;
  const battery = typeof career?.battery === "number" && Number.isFinite(career.battery) ? Math.min(100, Math.max(0, career.battery)) : null;
  const messages = (visibleState?.messages || []).filter(message => message.agentId === agentId);
  const selectedName = AGENTS.find(agent => agent.id === agentId)?.name || agentId;

  async function send(message: string) {
    const trimmed = message.trim();
    if (!trimmed || sendingRef.current || !sessionScope || !visibleState) return;
    sendingRef.current = true;
    setBusy(true);
    setFailure(null);
    const previous = requestRef.current;
    const input = previous?.scope === sessionScope && previous.agentId === agentId && previous.message === trimmed ? previous : { agentId, message: trimmed, requestId: crypto.randomUUID(), scope: sessionScope };
    requestRef.current = input;
    try {
      const result = await requestJson<{ state: KongSupervision }>("/api/kong-supervisor/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
      queryClient.setQueryData(stateKey, result.state);
      requestRef.current = null;
      if (trimmed === text.trim()) setDraft({ scope: sessionScope, text: "" });
      await queryClient.invalidateQueries({ queryKey: lifeKey });
    } catch (failure) {
      setFailure({ scope: sessionScope, text: failure instanceof Error ? failure.message : "No se pudo enviar el mensaje." });
    } finally { sendingRef.current = false; setBusy(false); }
  }

  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button type="button" variant="outline">Supervisor KONG</Button></DialogTrigger>
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>Equipo KONG</DialogTitle>
        <DialogDescription>Consulta el estado del equipo o encarga una revision interna de disponibilidad. Las tareas externas requieren su integracion y aprobaciones.</DialogDescription>
      </DialogHeader>
      <label htmlFor={`${fieldId}-agent`}>Hablar con</label>
      <select id={`${fieldId}-agent`} className="rounded border bg-background p-2" value={agentId} disabled={busy} onChange={event => { setAgentId(event.target.value as KongChatAgentId); setFailure(null); }}>
        {AGENTS.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
      </select>
      {!sessionScope && <p role="status">{verifiedAuth.isError || !routerId ? "Inicia sesion con el propietario para abrir esta conversacion." : "Verificando la sesion..."}</p>}
      <div aria-label={`Vida de ${selectedName}`} className="rounded border p-3 text-sm">
        {life.isLoading ? "Cargando vida..." : life.isError ? "La vida no esta disponible ahora." : battery === null ? "Sin lectura de vida registrada." : <>
          <p>Vida: {battery}% · Puntos: {career?.points ?? 0}</p>
          <progress aria-label={`Bateria de ${selectedName}`} max={100} value={battery} className="w-full" />
        </>}
        <p className="mt-1 text-xs text-muted-foreground">La vida registrada se consulta por separado de esta conversacion. Una revision no produce contenido.</p>
      </div>
      {!sessionScope ? null : state.isLoading ? <p role="status">Cargando conversacion...</p> : state.isError ? <div role="alert"><p>No se pudo cargar la conversacion.</p><Button type="button" variant="outline" onClick={() => void state.refetch()}>Reintentar lectura</Button></div> : <div role="log" aria-label={`Conversacion con ${selectedName}`} aria-live="polite" aria-relevant="additions text" className="max-h-64 space-y-3 overflow-y-auto rounded border p-3">
        {messages.length ? messages.map(message => <div key={message.id} className="whitespace-pre-wrap break-words text-sm"><strong>{message.role === "user" ? "Tu" : selectedName}: </strong>{message.text}</div>) : <p className="text-sm text-muted-foreground">Escribe ayuda para conocer las capacidades disponibles.</p>}
      </div>}
      <div className="flex flex-wrap gap-2">
        {["ayuda", "estado", "revisar"].map(command => <Button key={command} type="button" variant="outline" disabled={busy || !visibleState} onClick={() => void send(command)}>{command === "revisar" ? "Asignar revision" : command === "estado" ? "Consultar estado" : "Ayuda"}</Button>)}
      </div>
      <form onSubmit={event => { event.preventDefault(); void send(text); }} className="space-y-2">
        <label htmlFor={`${fieldId}-message`}>Mensaje para {selectedName}</label>
        <textarea id={`${fieldId}-message`} value={text} onChange={event => setDraft({ scope: sessionScope, text: event.target.value })} disabled={busy || !sessionScope} maxLength={500} required className="min-h-20 w-full rounded border bg-background p-2" aria-describedby={`${fieldId}-hint${error ? ` ${fieldId}-error` : ""}`} />
        <p id={`${fieldId}-hint`} className="text-xs text-muted-foreground">Comandos disponibles: ayuda, estado, revisar. Las demas solicitudes recibiran una explicacion de sus limites.</p>
        {error && <p id={`${fieldId}-error`} role="alert">{error}</p>}
        <Button type="submit" disabled={busy || !text.trim() || !visibleState}>{busy ? "Procesando..." : "Enviar mensaje"}</Button>
      </form>
    </DialogContent>
  </Dialog>;
}
