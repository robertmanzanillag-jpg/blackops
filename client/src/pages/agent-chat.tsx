import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowLeft, Inbox, Loader2, MessageSquarePlus, Send, Share2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { ChatMarkdown } from "@/components/agent-chat/chat-markdown";

type AgentRow = { id: string; name: string; job: string; group?: string; groupLabel?: string; legacyIds?: string[]; status: { state: string; label: string } | null; fresh: boolean; mode: string; openOrders: number };
type Thread = { id: string; agentId: string; title: string; createdAt: string; inbox: boolean };
type Message = { id: string; threadId: string; role: "user" | "agent" | "handoff" | "peer"; agentId: string; fromAgentId?: string; text: string; at: string; handoffTo?: string };
type Handoff = { orderId: string; at: string; fromAgentId: string; toAgentIds: string[]; text: string; status: string; approvalRequired: boolean };

const enc = encodeURIComponent;
const getJson = async <T,>(url: string): Promise<T> => (await apiRequest("GET", url)).json();
const stateDot = (state?: string) => state === "working" ? "bg-emerald-400" : state === "error" ? "bg-red-400" : state === "available" ? "bg-sky-400" : "bg-zinc-500";
const newRequestId = () => `ac${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

export default function AgentChatPage() {
  const queryClient = useQueryClient();
  const initialAgent = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("agent") : null;
  const [agentId, setAgentId] = useState<string | null>(initialAgent);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<Message | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  // One requestId per draft: a retry after an error reuses it (server dedupes), reset only on success.
  const requestIdRef = useRef<string | null>(null);

  const agents = useQuery({ queryKey: ["agent-chat", "agents"], queryFn: () => getJson<{ agents: AgentRow[] }>("/api/agent-chat/agents"), staleTime: 30_000 });
  const threads = useQuery({ queryKey: ["agent-chat", "threads", agentId], enabled: !!agentId,
    queryFn: () => getJson<{ threads: Thread[] }>(`/api/agent-chat/${enc(agentId!)}/threads`), staleTime: 10_000 });
  const thread = useQuery({ queryKey: ["agent-chat", "thread", agentId, threadId], enabled: !!agentId && !!threadId,
    queryFn: () => getJson<{ thread: Thread; messages: Message[] }>(`/api/agent-chat/${enc(agentId!)}/threads/${enc(threadId!)}`), staleTime: 5_000 });
  const handoffs = useQuery({ queryKey: ["agent-chat", "handoffs"], enabled: showLog, queryFn: () => getJson<{ handoffs: Handoff[] }>("/api/agent-chat/handoffs") });

  const agent = agents.data?.agents.find(a => a.id === agentId);
  const names = useMemo(() => Object.fromEntries((agents.data?.agents || []).map(a => [a.id, a.name])), [agents.data]);
  const visibleAgents = (agents.data?.agents || []).filter(a => !filter || `${a.name} ${a.job} ${a.groupLabel || ""}`.toLowerCase().includes(filter.toLowerCase()));
  // Grouped like the office: BlackOps, Black Room, KONG central, KONG cities, factory, academy.
  const groups = useMemo(() => {
    const map = new Map<string, AgentRow[]>();
    for (const a of visibleAgents) map.set(a.groupLabel || "Agentes", [...(map.get(a.groupLabel || "Agentes") || []), a]);
    return [...map.entries()];
  }, [visibleAgents]);
  // "Hablar con X": opens the agent that owns what Robert asked, keeping the URL shareable.
  const openAgent = (id: string) => {
    setAgentId(id);
    try { window.history.replaceState(null, "", `/agent-chat?agent=${enc(id)}`); } catch { /* URL stays as is */ }
  };
  const messages = [...(threadId ? thread.data?.messages || [] : []), ...(pending ? [pending] : [])];

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages.length, pending]);
  useEffect(() => { setThreadId(null); setError(null); }, [agentId]);
  // Office ids that differ from the chat id (e.g. the KONG team popup) resolve to the same agent;
  // an agent that no longer exists (graduated trainee) opens the list instead of a dead conversation.
  useEffect(() => {
    if (!agentId || !agents.data || agents.data.agents.some(a => a.id === agentId)) return;
    setAgentId(agents.data.agents.find(a => a.legacyIds?.includes(agentId))?.id || null);
  }, [agentId, agents.data]);

  const send = async () => {
    const text = draft.trim();
    if (!text || !agentId || pending) return;
    setError(null);
    setDraft("");
    setPending({ id: "pending", threadId: threadId || "", role: "user", agentId, text, at: new Date().toISOString() });
    try {
      requestIdRef.current ||= newRequestId();
      const res = await apiRequest("POST", `/api/agent-chat/${enc(agentId)}/messages`, { text, requestId: requestIdRef.current, ...(threadId ? { threadId } : {}) });
      requestIdRef.current = null;
      const body = await res.json() as { thread: Thread; peerMessages: Message[]; route: { decision: string; targetAgentId: string } };
      setThreadId(body.thread.id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["agent-chat", "thread", agentId, body.thread.id] }),
        queryClient.invalidateQueries({ queryKey: ["agent-chat", "threads", agentId] }),
        queryClient.invalidateQueries({ queryKey: ["agent-chat", "threads", body.route.targetAgentId] }),
        queryClient.invalidateQueries({ queryKey: ["agent-chat", "agents"] }),
        queryClient.invalidateQueries({ queryKey: ["agent-chat", "handoffs"] }),
      ]);
    } catch (e) {
      setDraft(text);
      setError(e instanceof Error ? e.message.replace(/^\d+:\s*/, "").replace(/^\{"error":"(.*)"\}$/, "$1") : "No se pudo enviar.");
    } finally { setPending(null); }
  };

  const newThread = async () => {
    if (!agentId) return;
    const res = await apiRequest("POST", `/api/agent-chat/${enc(agentId)}/threads`, {});
    const body = await res.json() as { thread: Thread };
    await queryClient.invalidateQueries({ queryKey: ["agent-chat", "threads", agentId] });
    setThreadId(body.thread.id);
  };

  const sidebar = (
    <aside className={`${agentId ? "hidden md:flex" : "flex"} w-full flex-col border-r border-white/10 md:w-80`}>
      <div className="flex items-center gap-2 border-b border-white/10 p-3">
        <Link href="/agents-office"><button className="rounded p-1 hover:bg-white/10" aria-label="Volver a la oficina"><ArrowLeft className="h-4 w-4" /></button></Link>
        <h1 className="flex-1 font-semibold">Chats de agentes</h1>
        <button onClick={() => setShowLog(v => !v)} className="rounded p-1 hover:bg-white/10" aria-label="Derivaciones entre agentes" title="Derivaciones entre agentes"><Share2 className="h-4 w-4" /></button>
      </div>
      <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Buscar agente" className="m-3 rounded border border-white/10 bg-black px-3 py-2 text-sm" />
      <div className="flex-1 overflow-y-auto">
        {agents.isLoading && <p className="p-3 text-sm text-zinc-400">Cargando agentes…</p>}
        {agents.isError && <p className="p-3 text-sm text-red-300">No se pudieron cargar los agentes (solo el propietario puede usar estos chats).</p>}
        {groups.map(([label, rows]) => (<div key={label}>
          <p className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">{label} · {rows.length}</p>
          {rows.map(a => (
          <button key={a.id} onClick={() => setAgentId(a.id)} className={`flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-white/5 ${a.id === agentId ? "bg-white/10" : ""}`}>
            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${stateDot(a.status?.state)}`} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{a.name}{a.openOrders ? <span className="ml-1 rounded bg-amber-400/20 px-1 text-[10px] text-amber-200">{a.openOrders}</span> : null}</span>
              <span className="block truncate text-xs text-zinc-500">{a.status?.label || a.job}</span>
            </span>
          </button>
          ))}
        </div>))}
      </div>
    </aside>
  );

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] bg-zinc-950 text-zinc-100">
      {sidebar}
      {agentId && (
        <section className="flex min-w-0 flex-1">
          <div className="hidden w-60 flex-col border-r border-white/10 lg:flex">
            <button onClick={newThread} className="m-3 flex items-center justify-center gap-2 rounded border border-white/15 py-2 text-sm hover:bg-white/5"><MessageSquarePlus className="h-4 w-4" />Nueva conversación</button>
            <div className="flex-1 overflow-y-auto">
              {(threads.data?.threads || []).map(t => (
                <button key={t.id} onClick={() => setThreadId(t.id)} className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-white/5 ${t.id === threadId ? "bg-white/10" : ""}`}>
                  {t.inbox && <Inbox className="h-3.5 w-3.5 shrink-0 text-cyan-300" />}<span className="truncate">{t.title}</span>
                </button>
              ))}
              {threads.data && !threads.data.threads.length && <p className="px-3 text-xs text-zinc-500">Sin conversaciones todavía.</p>}
            </div>
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <header className="flex items-center gap-2 border-b border-white/10 p-3">
              <button onClick={() => setAgentId(null)} className="rounded p-1 hover:bg-white/10 md:hidden" aria-label="Volver a la lista"><ArrowLeft className="h-4 w-4" /></button>
              <span className={`h-2 w-2 rounded-full ${stateDot(agent?.status?.state)}`} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{agent?.name || agentId}</p>
                <p className="truncate text-xs text-zinc-500">{agent?.job}</p>
              </div>
              <select value={threadId || ""} onChange={e => e.target.value === "__new" ? void newThread() : setThreadId(e.target.value || null)} className="max-w-[45%] rounded border border-white/10 bg-black px-2 py-1 text-xs lg:hidden" aria-label="Conversaciones">
                <option value="">Nueva conversación</option>
                {(threads.data?.threads || []).map(t => <option key={t.id} value={t.id}>{t.inbox ? "📥 " : ""}{t.title}</option>)}
              </select>
            </header>
            <div className="flex-1 space-y-3 overflow-y-auto p-3 sm:p-4">
              {!messages.length && !thread.isLoading && (
                <div className="mx-auto max-w-md pt-10 text-center text-sm text-zinc-400">
                  <p className="font-medium text-zinc-200">Habla con {agent?.name || "este agente"}</p>
                  <p className="mt-1">Pregunta «estado», «órdenes» o «último trabajo», o dale una tarea. Responde solo con sus datos registrados; si no los tiene, te dice qué agente sí y te da el botón para hablar con él. Nada se publica ni despliega sin tu aprobación.</p>
                </div>
              )}
              {thread.isLoading && <p className="text-sm text-zinc-400">Cargando…</p>}
              {messages.map(m => (
                <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[88%] rounded-2xl px-3 py-2 sm:max-w-[75%] ${m.role === "user" ? "bg-cyan-500/20 text-cyan-50" : m.role === "handoff" ? "border border-amber-300/30 bg-amber-400/10" : m.role === "peer" ? "border border-violet-300/30 bg-violet-400/10" : "bg-white/[0.07]"}`}>
                    <p className="mb-0.5 text-[10px] uppercase tracking-wide text-zinc-400">
                      {m.role === "user" ? "Tú" : m.role === "handoff" ? `Derivación · ${names[m.agentId] || m.agentId}` : m.role === "peer" ? `De ${names[m.fromAgentId || ""] || m.fromAgentId} → ${names[m.agentId] || m.agentId}` : names[m.agentId] || m.agentId}
                      {m.id !== "pending" && <span className="ml-2 normal-case text-zinc-500">{new Date(m.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}
                    </p>
                    <ChatMarkdown text={m.text} />
                    {m.handoffTo && m.handoffTo !== agentId && (
                      <button type="button" onClick={() => openAgent(m.handoffTo!)} className="mt-2 rounded-full border border-cyan-300/40 bg-cyan-400/10 px-3 py-1 text-xs font-semibold text-cyan-100 hover:bg-cyan-400/20" data-testid="button-agent-chat-handoff">
                        Hablar con {names[m.handoffTo] || m.handoffTo}
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {pending && <div className="flex items-center gap-2 text-xs text-zinc-400"><Loader2 className="h-3 w-3 animate-spin" />{agent?.name || "El agente"} está respondiendo…</div>}
              <div ref={endRef} />
            </div>
            {error && <p role="alert" className="border-t border-red-400/20 bg-red-950/40 px-3 py-2 text-xs text-red-200">{error}</p>}
            <form className="flex items-end gap-2 border-t border-white/10 p-3" onSubmit={e => { e.preventDefault(); void send(); }}>
              <textarea value={draft} onChange={e => { setDraft(e.target.value); requestIdRef.current = null; }} maxLength={2000} rows={1}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
                placeholder={`Escribe a ${agent?.name || "este agente"}…`} className="max-h-40 min-h-[44px] flex-1 resize-y rounded-xl border border-white/10 bg-black px-3 py-2.5 text-base sm:text-sm" />
              <button type="submit" disabled={!draft.trim() || !!pending} className="flex h-11 w-11 items-center justify-center rounded-full bg-zinc-100 text-zinc-950 disabled:opacity-40" aria-label="Enviar"><Send className="h-4 w-4" /></button>
            </form>
          </div>
        </section>
      )}
      {showLog && (
        <aside className="fixed inset-x-0 bottom-0 z-40 max-h-[60dvh] overflow-y-auto border-t border-white/10 bg-zinc-900 p-3 md:static md:max-h-none md:w-80 md:border-l md:border-t-0">
          <div className="mb-2 flex items-center justify-between"><h2 className="font-semibold">Agente → agente</h2><button onClick={() => setShowLog(false)} className="text-xs text-zinc-400">Cerrar</button></div>
          {handoffs.isLoading && <p className="text-sm text-zinc-400">Cargando…</p>}
          {handoffs.data && !handoffs.data.handoffs.length && <p className="text-sm text-zinc-500">Todavía no hay derivaciones entre agentes.</p>}
          <ul className="space-y-2">
            {(handoffs.data?.handoffs || []).map(h => (
              <li key={h.orderId} className="rounded border border-white/10 p-2 text-xs">
                <p className="font-medium">{names[h.fromAgentId] || h.fromAgentId} → {h.toAgentIds.map(id => names[id] || id).join(", ")}</p>
                <p className="text-zinc-300">{h.text}</p>
                <p className="mt-1 text-zinc-500">{new Date(h.at).toLocaleString()} · {h.status} · <code>{h.orderId}</code>{h.approvalRequired ? " · requiere aprobación" : ""}</p>
              </li>
            ))}
          </ul>
        </aside>
      )}
    </div>
  );
}
