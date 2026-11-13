import { useEffect, useRef, useState } from "react";
import { Bot, CalendarPlus, Loader2, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

interface MiniMessage {
  role: "user" | "assistant";
  content: string;
}

const PROMPTS = [
  "Agenda una reunion manana a las 10am",
  "Que tengo hoy?",
  "Recuerdame revisar mi cartera el viernes",
  "Prepara un brief para usar mi membresia Pro en una campana fuerte",
];

export function DashboardAssistantChat() {
  const [messages, setMessages] = useState<MiniMessage[]>([
    {
      role: "assistant",
      content: "Soy tu asistente, Robert. Escribeme una tarea, evento o pregunta y la trabajo contigo.",
    },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [assistantStatus, setAssistantStatus] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isLoading, assistantStatus]);

  useEffect(() => {
    if (!inputRef.current) return;
    inputRef.current.style.height = "0px";
    inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 128)}px`;
  }, [input]);

  const cleanAssistantText = (content: string) => {
    return content
      .replace(/\[CREAR_TAREA:.*?\]/g, "Listo, agregue la tarea.")
      .replace(/\[CREAR_EVENTO_GOOGLE:.*?\]/g, "Listo, lo mande al calendario.")
      .replace(/\[EDITAR_EVENTO_GOOGLE:.*?\]/g, "Listo, actualice el evento.")
      .replace(/\[MODIFICAR_RADIO:.*?\]/g, "Listo, actualice Radio.")
      .replace(/\[RADIO_YOUTUBE_CLIPS:.*?\]/g, "")
      .replace(/\[RADIO_DRIVE_VIDEO_CLIPS:.*?\]/g, "")
      .replace(/\[AGREGAR_INVERSION:.*?\]/g, "Listo, agregue la inversion.")
      .replace(/\[ACTUALIZAR_INVERSION:.*?\]/g, "Listo, actualice la inversion.")
      .replace(/\[ELIMINAR_INVERSION:.*?\]/g, "Listo, elimine la inversion.")
      .replace(/\[CREAR_RECORDATORIO:.*?\]/g, "Listo, cree el recordatorio.")
      .replace(/\[ELIMINAR_RECORDATORIO:.*?\]/g, "Listo, elimine el recordatorio.")
      .replace(/\[PROMO_VIDEO_GENERATE:.*?\]/g, "")
      .replace(/\[GUARDAR_INFO:.*?\]/g, "")
      .trim();
  };

  const sendMessage = async (override?: string) => {
    const text = (override || input).trim();
    if (!text || isLoading) return;

    const previousMessages = [...messages];
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setInput("");
    setIsLoading(true);
    setAssistantStatus("Revisando tu contexto...");

    try {
      const response = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          conversationHistory: previousMessages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
        }),
      });

      if (!response.ok) throw new Error("Assistant request failed");

      const reader = response.body?.getReader();
      if (!reader) throw new Error("Missing response stream");

      const decoder = new TextDecoder();
      let assistantMessage = "";
      let streamBuffer = "";
      let sawAssistantStatus = false;
      let sawTerminalAssistantEvent = false;
      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

      const updateAssistantMessage = () => {
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = {
            role: "assistant",
            content: cleanAssistantText(assistantMessage) || "Trabajando...",
          };
          return next;
        });
      };

      const handleStreamData = (data: any) => {
        if (data.content) {
          assistantMessage += data.content;
          setAssistantStatus("");
          updateAssistantMessage();
        }
        if (typeof data.assistantStatus === "string" && data.assistantStatus.trim()) {
          sawAssistantStatus = true;
          setAssistantStatus(data.assistantStatus.trim());
        }
        if (
          data.radioYoutubeProcessed ||
          data.radioYoutubeNeedsConfirmation ||
          data.radioYoutubeNeedsDjName ||
          data.radioDriveVideoProcessed ||
          data.radioDriveVideoNeedsConfirmation ||
          data.radioDriveVideoNeedsDjName
        ) {
          sawTerminalAssistantEvent = true;
          setAssistantStatus("");
        }
        if (
          data.taskCreated ||
          data.googleEventCreated ||
          data.actionExecuted ||
          data.radioUpdated ||
          data.investmentCreated ||
          data.investmentUpdated ||
          data.promoVideosGenerated
        ) {
          queryClient.invalidateQueries({ queryKey: ["tasks"] });
          queryClient.invalidateQueries({ queryKey: ["investments"] });
          queryClient.invalidateQueries({ queryKey: ["/api/promo-video/status"] });
        }
        if (data.promoVideoError) {
          sawTerminalAssistantEvent = true;
          setAssistantStatus("");
          assistantMessage += `\n\nNo pude generar los videos de promo: ${data.promoVideoError}`;
          updateAssistantMessage();
        }
        if (data.actionExecuted) {
          sawTerminalAssistantEvent = true;
          setAssistantStatus("");
          assistantMessage += `\n\nEjecutado: ${data.title || "accion completada"}.`;
          queryClient.invalidateQueries({ queryKey: ["tasks"] });
          queryClient.invalidateQueries({ queryKey: ["pending-actions"] });
          updateAssistantMessage();
        }
        if (data.googleEventError || data.radioError || data.radioYoutubeError || data.radioDriveVideoError || data.blackRoomLinkError || data.metricoolAutomationError || data.actionExecutionError) {
          sawTerminalAssistantEvent = true;
          setAssistantStatus("");
          assistantMessage += `\n\nNo pude completar la accion: ${data.googleEventError || data.radioError || data.radioYoutubeError || data.radioDriveVideoError || data.blackRoomLinkError || data.metricoolAutomationError || data.actionExecutionError}`;
          updateAssistantMessage();
        }
        if (data.approvalRequired && data.pendingAction) {
          sawTerminalAssistantEvent = true;
          setAssistantStatus("");
          assistantMessage += `\n\nPendiente de aprobacion: ${data.pendingAction.title}. Puedes decir "si, hazlo" aqui mismo o revisarlo en approvals antes de ejecutar.`;
          queryClient.invalidateQueries({ queryKey: ["pending-actions"] });
          updateAssistantMessage();
        }
      };

      const processStreamEvent = (eventText: string) => {
        for (const line of eventText.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          try {
            handleStreamData(JSON.parse(line.slice(6)));
          } catch (error) {}
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        streamBuffer += decoder.decode(value, { stream: true });
        const events = streamBuffer.split("\n\n");
        streamBuffer = events.pop() || "";
        for (const eventText of events) processStreamEvent(eventText);
      }
      streamBuffer += decoder.decode();
      if (streamBuffer.trim()) processStreamEvent(streamBuffer);
      if (sawAssistantStatus && !sawTerminalAssistantEvent && !/Listo\.|No pude completar|Pendiente de aprobacion|Total estimado de esta edición/i.test(assistantMessage)) {
        assistantMessage += "\n\nNo pude completar la accion: el proceso terminó sin devolver resultado final. Gasto estimado de esta corrida: $0.00 USD.";
        updateAssistantMessage();
      }
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Ahora mismo no pude conectar con el asistente. Si estas en preview visual, falta el backend o la base de datos.",
        },
      ]);
    } finally {
      setIsLoading(false);
      setAssistantStatus("");
      inputRef.current?.focus();
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  };

  return (
    <section className="relative overflow-hidden border-y border-white/10 bg-black/20 py-5">
      <div className="flex items-center justify-between gap-3 px-1 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-800 text-zinc-950">
            <Bot className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-white">Chat de Robert</h2>
            <p className="text-xs text-zinc-500">Agenda, tareas y calendario desde aqui</p>
          </div>
        </div>
        <div className="hidden items-center gap-2 rounded-full bg-zinc-900/10 px-3 py-1 text-xs text-zinc-400 sm:flex">
          <CalendarPlus className="h-3.5 w-3.5" />
          Puede agendar
        </div>
      </div>

      <div ref={scrollRef} className="max-h-[360px] min-h-[220px] overflow-y-auto py-2">
        <div className="space-y-4">
          {messages.map((message, index) => (
            <div
              key={index}
              className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}
            >
              <div
                className={cn(
                  "max-w-[86%] px-4 py-3 text-sm leading-6",
                  message.role === "user"
                    ? "rounded-3xl rounded-br-md bg-zinc-800 text-zinc-950"
                    : "border-l border-white/10 bg-transparent text-zinc-100"
                )}
              >
                {message.content || "Trabajando..."}
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex items-center gap-2 text-sm text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
              {assistantStatus || "Revisando tu calendario..."}
            </div>
          )}
        </div>
      </div>

      <div className="pt-4">
        <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
          {PROMPTS.map((prompt) => (
            <button
              key={prompt}
              onClick={() => sendMessage(prompt)}
              className="shrink-0 rounded-full bg-white/[0.04] px-3 py-1.5 text-xs text-zinc-400 transition hover:bg-zinc-800/10 hover:text-white"
            >
              <Sparkles className="mr-1 inline h-3 w-3 text-zinc-400" />
              {prompt}
            </button>
          ))}
        </div>
        <div className="flex items-end gap-2 rounded-full border border-white/10 bg-zinc-950/70 px-3 py-2 focus-within:border-white/10">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder="Escribe: agenda llamada con Juan manana a las 3..."
            className="max-h-32 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-sm text-white outline-none placeholder:text-zinc-600"
            disabled={isLoading}
          />
          <Button
            onClick={() => sendMessage()}
            disabled={!input.trim() || isLoading}
            size="icon"
            className="h-10 w-10 shrink-0 rounded-full bg-zinc-800 text-zinc-950 hover:bg-zinc-800"
          >
            {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
          </Button>
        </div>
      </div>
    </section>
  );
}
