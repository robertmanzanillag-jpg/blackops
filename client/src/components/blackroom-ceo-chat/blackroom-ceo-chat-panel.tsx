import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

// Chat with the CEO Black Room (owner and partner). Server: server/blackroom-ceo-chat-routes.ts.

type Author = { userId: string; role: "owner" | "partner" | "ceo"; name: string };
type Approval = { agentId: string; id: string; title: string; summary: string; status: string; createdAt: string; publicationDateTime?: string | null; networks?: string[]; dryRun: boolean };
type ResultCard = { agentId: string; agentName: string; operation: string; label: string; ok: boolean; summary: string; details: string[]; blocked: boolean; needs: string[]; timedOut?: boolean; approvals: Approval[]; orderId?: string | null; orderClosed?: boolean };
type Message = { id: string; at: string; author: Author; text: string; results?: ResultCard[]; orderIds?: string[]; routedBy?: string };
type ChatView = { messages: Message[]; pendingApprovals: Approval[]; maxExecutions: number; role: "owner" | "partner"; me: string };

export const BLACKROOM_CEO_CHAT_KEY = ["blackroom-ceo-chat"] as const;

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error((body as { error?: string } | null)?.error || `Error ${response.status}`);
  return body as T;
}

function time(iso: string): string {
  const at = Date.parse(iso);
  return Number.isFinite(at) ? new Date(at).toLocaleString("es", { weekday: "short", hour: "2-digit", minute: "2-digit" }) : "";
}

const SUGGESTIONS = ["Dame el reporte de la semana", "¿Qué está haciendo la competencia?", "Hazme 3 ideas de video para el viernes", "Revisa la web", "¿Qué hay por aprobar?", "¿Cómo va el equipo?"];

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1" aria-label="El CEO está escribiendo">
      {[0, 1, 2].map((i) => <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-fuchsia-200" style={{ animationDelay: `${i * 150}ms` }} />)}
    </span>
  );
}

export function BlackRoomCeoChatPanel({ onClose, onShowTasks, title = "Chat con el CEO" }: { onClose: () => void; onShowTasks?: () => void; title?: string }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [pendingText, setPendingText] = useState<string | null>(null);
  const chat = useQuery<ChatView>({
    queryKey: BLACKROOM_CEO_CHAT_KEY,
    queryFn: async () => readJson<ChatView>(await fetch("/api/blackroom-ceo-chat", { credentials: "same-origin", headers: { Accept: "application/json" } })),
    refetchInterval: 20_000,
    retry: false,
  });
  const messages = chat.data?.messages || [];
  const pending = chat.data?.pendingApprovals || [];

  useEffect(() => {
    const node = listRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages.length, pendingText]);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const post = async (url: string, body?: unknown) => readJson<{ pendingApprovals?: Approval[] }>(await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));

  const send = async (value = text) => {
    const message = value.trim();
    if (!message || sending) return;
    setSending(true);
    setError(null);
    setPendingText(message);
    setText("");
    try {
      await post("/api/blackroom-ceo-chat/messages", { text: message });
    } catch (err) {
      setText(message);
      setError(err instanceof Error ? err.message : "No se pudo enviar el mensaje.");
    }
    await queryClient.invalidateQueries({ queryKey: BLACKROOM_CEO_CHAT_KEY });
    await queryClient.invalidateQueries({ queryKey: ["agent-council-state"] });
    setPendingText(null);
    setSending(false);
    inputRef.current?.focus();
  };

  const decide = async (id: string, decision: "approve" | "reject") => {
    setDeciding(id);
    setError(null);
    try {
      await post(`/api/blackroom-ceo-chat/approvals/${encodeURIComponent(id)}/${decision}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo registrar la decision.");
    }
    await queryClient.invalidateQueries({ queryKey: BLACKROOM_CEO_CHAT_KEY });
    setDeciding(null);
  };

  return (
    <section className="absolute top-[220px] right-3 z-30 sm:top-36 lg:top-24 flex h-[min(620px,72vh)] w-[min(460px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl border border-fuchsia-200/25 bg-[#0f0616]/95 text-white shadow-2xl [color-scheme:dark]" aria-label={title} data-testid="blackroom-ceo-chat">
      <header className="flex shrink-0 items-center gap-3 border-b border-white/10 px-4 py-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-fuchsia-400 to-amber-300 text-sm font-black text-black">CEO</div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold">{title}</p>
          <p className="truncate text-[11px] text-emerald-300">{sending ? "escribiendo..." : "en línea · Black Room"}{chat.data?.role === "partner" ? " · Robert ve esta conversación" : ""}</p>
        </div>
        {onShowTasks && <button type="button" onClick={onShowTasks} className="rounded-full border border-white/15 px-2 py-1 text-[11px] text-zinc-300 hover:bg-white/10" data-testid="blackroom-ceo-chat-tasks">Tareas</button>}
        <button type="button" onClick={onClose} className="rounded-full px-2 py-1 text-sm text-zinc-400 hover:bg-white/10 hover:text-white" aria-label="Cerrar chat">✕</button>
      </header>

      {pending.length > 0 && (
        <div className="shrink-0 space-y-1.5 border-b border-amber-200/20 bg-amber-300/5 px-3 py-2" data-testid="blackroom-ceo-chat-approvals">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-200">Esperan tu aprobación · {pending.length}</p>
          {pending.slice(0, 3).map((item) => (
            <div key={item.id} className="flex items-center gap-2 rounded-lg bg-black/40 p-2 text-[11px]" data-testid="blackroom-ceo-chat-approval">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{item.title}</p>
                <p className="truncate text-[10px] text-zinc-400">{item.networks?.join(", ")}{item.dryRun ? " · modo simulación" : ""}</p>
              </div>
              <button type="button" disabled={deciding !== null} onClick={() => decide(item.id, "approve")} className="rounded-full bg-emerald-400 px-2.5 py-1 text-[11px] font-bold text-black disabled:opacity-50" data-testid="blackroom-ceo-chat-approve">Aprobar</button>
              <button type="button" disabled={deciding !== null} onClick={() => decide(item.id, "reject")} className="rounded-full border border-rose-300/50 px-2.5 py-1 text-[11px] text-rose-100 disabled:opacity-50" data-testid="blackroom-ceo-chat-reject">Rechazar</button>
            </div>
          ))}
        </div>
      )}

      <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3" data-testid="blackroom-ceo-chat-messages">
        {chat.isLoading && <p className="text-center text-xs text-zinc-500">Cargando conversación...</p>}
        {chat.isError && <p className="text-center text-xs text-rose-200">{chat.error instanceof Error ? chat.error.message : "No se pudo cargar el chat."}</p>}
        {!chat.isLoading && !chat.isError && messages.length === 0 && !pendingText && (
          <div className="flex gap-2">
            <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-fuchsia-400 to-amber-300 text-[9px] font-black text-black">CEO</div>
            <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-white/[0.07] px-3 py-2 text-[13px] leading-5 text-zinc-100">
              ¡Hola! Soy el CEO de Black Room. Pídeme lo que necesites y pongo al equipo a trabajar: reportes de redes, competencia, ideas de video, revisar la web o preparar posts. Toca una sugerencia abajo para empezar.
            </div>
          </div>
        )}
        {messages.map((message) => {
          const fromCeo = message.author.role === "ceo";
          if (!fromCeo) {
            return (
              <div key={message.id} className="flex justify-end" data-testid="blackroom-ceo-chat-message">
                <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-fuchsia-500/80 px-3 py-2 text-[13px] leading-5 text-white">
                  {message.author.role === "partner" && <p className="text-[10px] font-semibold text-fuchsia-100/80">{message.author.name} · socio</p>}
                  <p className="whitespace-pre-wrap">{message.text}</p>
                  <p className="mt-0.5 text-right text-[10px] text-fuchsia-100/70">{time(message.at)}</p>
                </div>
              </div>
            );
          }
          return (
            <div key={message.id} className="flex gap-2" data-testid="blackroom-ceo-chat-message">
              <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-fuchsia-400 to-amber-300 text-[9px] font-black text-black">CEO</div>
              <div className="max-w-[85%] space-y-1.5">
                <div className="rounded-2xl rounded-tl-sm bg-white/[0.07] px-3 py-2 text-[13px] leading-5 text-zinc-100">
                  <p className="whitespace-pre-wrap">{message.text.split("\n").filter((line) => !/^\s*(✔|⛔|✖|Necesita:)/.test(line)).join("\n")}</p>
                  <p className="mt-0.5 text-[10px] text-zinc-500">{time(message.at)}</p>
                </div>
                {(message.results || []).map((card, index) => (
                  <details key={`${message.id}-${index}`} open={card.ok && card.details.length > 0 && card.details.length <= 6} className={cn("rounded-xl border px-3 py-2", card.ok ? "border-emerald-300/25 bg-emerald-400/5" : "border-amber-300/30 bg-amber-400/5")} data-testid="blackroom-ceo-chat-result">
                    <summary className="cursor-pointer list-none text-[12px]">
                      <span className="font-semibold">{card.ok ? "✅" : card.timedOut ? "⏳" : "⚠️"} {card.agentName}</span>
                      <span className="text-zinc-400"> · {card.label}</span>
                      <p className={cn("mt-0.5 text-[12px]", card.ok ? "text-emerald-100" : "text-amber-100")}>{card.summary}</p>
                    </summary>
                    {card.details.length > 0 && <ul className="mt-1 space-y-0.5">{card.details.map((line) => <li key={line} className="text-[11px] text-zinc-300">• {line}</li>)}</ul>}
                    {!card.ok && card.needs.length > 0 && <p className="mt-1 text-[11px] text-amber-200">Para que funcione falta: {card.needs.join("; ")}</p>}
                  </details>
                ))}
              </div>
            </div>
          );
        })}
        {pendingText && (
          <>
            <div className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-fuchsia-500/60 px-3 py-2 text-[13px] leading-5 text-white"><p className="whitespace-pre-wrap">{pendingText}</p></div>
            </div>
            <div className="flex gap-2">
              <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-fuchsia-400 to-amber-300 text-[9px] font-black text-black">CEO</div>
              <div className="rounded-2xl rounded-tl-sm bg-white/[0.07] px-3 py-2.5"><TypingDots /></div>
            </div>
          </>
        )}
      </div>

      <div className="shrink-0 border-t border-white/10 px-3 pb-3 pt-2">
        {error && <p role="status" className="mb-1 text-[11px] text-rose-200">{error}</p>}
        <div className="mb-2 flex gap-1 overflow-x-auto pb-1">
          {SUGGESTIONS.map((suggestion) => <button key={suggestion} type="button" disabled={sending} onClick={() => send(suggestion)} className="shrink-0 rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-zinc-300 hover:bg-white/10 disabled:opacity-40">{suggestion}</button>)}
        </div>
        <div className="flex gap-2">
          <input
            ref={inputRef}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") void send(); }}
            aria-label="Mensaje para el CEO"
            placeholder="Escríbele al CEO..."
            maxLength={1000}
            disabled={sending}
            className="min-w-0 flex-1 rounded-full border border-white/10 bg-black/50 px-4 py-2.5 text-[13px] text-white placeholder:text-zinc-500 focus:border-fuchsia-200/50 focus:outline-none"
            data-testid="blackroom-ceo-chat-input"
          />
          <button type="button" onClick={() => send()} disabled={sending || !text.trim()} aria-label="Enviar" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-fuchsia-400 text-base font-bold text-black hover:bg-fuchsia-300 disabled:opacity-40" data-testid="blackroom-ceo-chat-send">➤</button>
        </div>
      </div>
    </section>
  );
}
