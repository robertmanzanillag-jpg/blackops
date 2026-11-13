import { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Bot,
  Brain,
  CalendarDays,
  CheckCircle2,
  Clock3,
  ImagePlus,
  Loader2,
  MessageSquare,
  Mic,
  Plus,
  Send,
  Sparkles,
  Square,
  Trash2,
  Upload,
  Wallet,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { queryClient } from "@/lib/queryClient";
import { Link } from "wouter";

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  images?: string[];
}

const QUICK_ACTIONS = [
  { label: "Que tengo hoy", prompt: "Que tengo hoy?", icon: CalendarDays },
  { label: "Crear tarea", prompt: "Ayudame a crear una tarea para hoy", icon: Plus },
  { label: "Resumen semanal", prompt: "Hazme un resumen de mi semana", icon: CheckCircle2 },
  { label: "Portafolio", prompt: "Como va mi cartera?", icon: Wallet },
  { label: "Subir imagen", prompt: "", icon: Upload, upload: true },
];

const CONTEXT_CARDS = [
  {
    icon: CalendarDays,
    label: "Agenda",
    value: "Calendario y tareas",
    detail: "Pregunta por huecos, eventos o pendientes.",
  },
  {
    icon: Brain,
    label: "Memoria",
    value: "Datos personales",
    detail: "Recuerda preferencias, metas y contexto.",
  },
  {
    icon: Wallet,
    label: "Finanzas",
    value: "Portafolio",
    detail: "Analiza posiciones, capturas y movimientos.",
  },
];

export default function AssistantPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [assistantStatus, setAssistantStatus] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [selectedImages, setSelectedImages] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const voiceStreamRef = useRef<MediaStream | null>(null);
  const recordingTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isLoading, assistantStatus]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    return () => {
      if (recordingTimeoutRef.current) window.clearTimeout(recordingTimeoutRef.current);
      voiceStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    if (!inputRef.current) return;
    inputRef.current.style.height = "0px";
    inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 160)}px`;
  }, [input]);

  const clearChat = () => {
    setMessages([]);
    setSelectedImages([]);
    setAssistantStatus("");
  };

  const compressImage = (file: File, maxWidth = 1200, quality = 0.7): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          let width = img.width;
          let height = img.height;

          if (width > maxWidth) {
            height = (height * maxWidth) / width;
            width = maxWidth;
          }

          canvas.width = width;
          canvas.height = height;

          const ctx = canvas.getContext("2d");
          if (!ctx) {
            reject(new Error("Could not get canvas context"));
            return;
          }

          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", quality));
        };
        img.onerror = () => reject(new Error("Failed to load image"));
        img.src = e.target?.result as string;
      };
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsDataURL(file);
    });
  };

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const validFiles = Array.from(files).filter((file) => {
      if (file.size > 20 * 1024 * 1024) {
        alert(`La imagen ${file.name} es muy grande. Maximo 20MB.`);
        return false;
      }
      return true;
    });

    const newImages: string[] = [];
    for (const file of validFiles) {
      try {
        newImages.push(await compressImage(file));
      } catch (err) {
        console.error("Error compressing image:", err);
      }
    }

    if (newImages.length > 0) {
      setSelectedImages((prev) => [...prev, ...newImages]);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeImage = (index: number) => {
    setSelectedImages((prev) => prev.filter((_, i) => i !== index));
  };

  const blobToDataUrl = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error("No pude leer el audio"));
      reader.readAsDataURL(blob);
    });
  };

  const cleanupRecording = () => {
    if (recordingTimeoutRef.current) {
      window.clearTimeout(recordingTimeoutRef.current);
      recordingTimeoutRef.current = null;
    }
    voiceStreamRef.current?.getTracks().forEach((track) => track.stop());
    voiceStreamRef.current = null;
    mediaRecorderRef.current = null;
    setIsRecording(false);
  };

  const sendVoiceForTranscription = async (blob: Blob) => {
    if (!blob.size) return;
    setIsTranscribing(true);
    try {
      const audio = await blobToDataUrl(blob);
      const response = await fetch("/api/assistant/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio }),
      });
      if (!response.ok) throw new Error("Voice transcription failed");
      const data = await response.json();
      const transcript = typeof data.text === "string" ? data.text.trim() : "";
      if (!transcript) throw new Error("Empty transcript");
      await sendMessage(transcript);
    } catch (error) {
      console.error("Error transcribing voice:", error);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "No pude entender esa nota de voz. Intenta grabarla otra vez un poco mas cerca del microfono.",
          timestamp: new Date(),
        },
      ]);
    } finally {
      setIsTranscribing(false);
    }
  };

  const startVoiceRecording = async () => {
    if (isLoading || isTranscribing || isRecording) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      alert("Tu navegador no permite grabar audio aqui.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/mp4")
          ? "audio/mp4"
          : "";
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      audioChunksRef.current = [];
      voiceStreamRef.current = stream;
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        audioChunksRef.current = [];
        cleanupRecording();
        void sendVoiceForTranscription(audioBlob);
      };
      recorder.onerror = () => cleanupRecording();

      recorder.start();
      setIsRecording(true);
      recordingTimeoutRef.current = window.setTimeout(() => {
        if (mediaRecorderRef.current?.state === "recording") {
          mediaRecorderRef.current.stop();
        }
      }, 90_000);
    } catch (error) {
      console.error("Error starting voice recording:", error);
      cleanupRecording();
      alert("No pude acceder al microfono.");
    }
  };

  const stopVoiceRecording = () => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    } else {
      cleanupRecording();
    }
  };

  const toggleVoiceRecording = () => {
    if (isRecording) {
      stopVoiceRecording();
    } else {
      void startVoiceRecording();
    }
  };

  const sendMessage = async (messageText?: string) => {
    const userMessage = (messageText || input).trim();
    if ((!userMessage && selectedImages.length === 0) || isLoading) return;

    const historyBeforeSend = [...messages];
    const currentImages = [...selectedImages];
    setInput("");
    setSelectedImages([]);

    const imageCountText =
      currentImages.length > 1
        ? `${currentImages.length} imagenes adjuntas`
        : currentImages.length === 1
          ? "Imagen adjunta"
          : "";

    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        content: userMessage || imageCountText || "Analiza estas imagenes",
        timestamp: new Date(),
        images: currentImages.length > 0 ? currentImages : undefined,
      },
    ]);
    setIsLoading(true);
    setAssistantStatus("Pensando y revisando tu contexto...");

    try {
      const defaultMessage =
        currentImages.length > 1
          ? `Analiza estas ${currentImages.length} imagenes de mi broker/cartera y extrae la informacion de mis inversiones. Si encuentras acciones, ETFs o criptomonedas, agregalas a mi portafolio.`
          : "Analiza esta imagen de mi broker/cartera y extrae la informacion de mis inversiones. Si encuentras acciones, ETFs o criptomonedas, agregalas a mi portafolio.";

      const response = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMessage || defaultMessage,
          conversationHistory: historyBeforeSend.map((m) => ({ role: m.role, content: m.content })),
          images: currentImages.length > 0 ? currentImages : undefined,
        }),
      });

      if (!response.ok) throw new Error("Failed to send message");

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No reader");

      const decoder = new TextDecoder();
      let assistantMessage = "";
      let streamBuffer = "";
      let sawAssistantStatus = false;
      let sawTerminalAssistantEvent = false;

      setMessages((prev) => [...prev, { role: "assistant", content: "", timestamp: new Date() }]);

      const updateAssistantMessage = () => {
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            role: "assistant",
            content: assistantMessage,
            timestamp: new Date(),
          };
          return updated;
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
        if (data.blackRoomControlled) {
          queryClient.invalidateQueries({ queryKey: ["/api/blackroom-agent"] });
        }
        if (
          data.taskCreated ||
          data.radioUpdated ||
          data.actionExecuted ||
          data.googleEventCreated ||
          data.investmentCreated ||
          data.investmentUpdated ||
          data.promoVideosGenerated
        ) {
          queryClient.invalidateQueries({ queryKey: ["tasks"] });
          queryClient.invalidateQueries({ queryKey: ["investments"] });
          queryClient.invalidateQueries({ queryKey: ["/api/promo-video/status"] });
        }
        if (data.actionExecuted) {
          assistantMessage += `\n\nEjecutado: ${data.title || "accion completada"}.`;
          queryClient.invalidateQueries({ queryKey: ["tasks"] });
          queryClient.invalidateQueries({ queryKey: ["pending-actions"] });
          updateAssistantMessage();
        }
        if (data.googleEventError || data.radioError || data.radioYoutubeError || data.radioDriveVideoError || data.blackRoomLinkError || data.blackRoomAgentError || data.promoVideoError || data.metricoolAutomationError || data.actionExecutionError) {
          sawTerminalAssistantEvent = true;
          setAssistantStatus("");
          assistantMessage += `\n\nNo pude completar la accion: ${data.googleEventError || data.radioError || data.radioYoutubeError || data.radioDriveVideoError || data.blackRoomLinkError || data.blackRoomAgentError || data.promoVideoError || data.metricoolAutomationError || data.actionExecutionError}`;
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
          } catch (e) {}
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
      console.error("Error sending message:", error);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "No pude procesar eso ahora mismo. Revisa la conexion o intenta enviarlo otra vez en unos segundos.",
          timestamp: new Date(),
        },
      ]);
    } finally {
      setIsLoading(false);
      setAssistantStatus("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  };

  const formatContent = (content: string) => {
    return content
      .replace(/\[CREAR_TAREA:.*?\]/g, "Tarea creada")
      .replace(/\[MODIFICAR_RADIO:.*?\]/g, "Radio actualizado")
      .replace(/\[RADIO_YOUTUBE_CLIPS:.*?\]/g, "")
      .replace(/\[RADIO_DRIVE_VIDEO_CLIPS:.*?\]/g, "")
      .replace(/\[CREAR_EVENTO_GOOGLE:.*?\]/g, "Evento creado en Google Calendar")
      .replace(/\[EDITAR_EVENTO_GOOGLE:.*?\]/g, "Evento actualizado en Google Calendar")
      .replace(/\[AGREGAR_INVERSION:.*?\]/g, "Inversion agregada")
      .replace(/\[ACTUALIZAR_INVERSION:.*?\]/g, "Inversion actualizada")
      .replace(/\[ELIMINAR_INVERSION:.*?\]/g, "Inversion eliminada")
      .replace(/\[CREAR_RECORDATORIO:.*?\]/g, "Recordatorio creado")
      .replace(/\[ELIMINAR_RECORDATORIO:.*?\]/g, "Recordatorio eliminado")
      .replace(/\[LISTAR_RECORDATORIOS:.*?\]/g, "")
      .replace(/\[PROMO_VIDEO_GENERATE:.*?\]/g, "")
      .replace(/\[GUARDAR_INFO:.*?\]/g, "")
      .trim();
  };

  return (
    <div className="min-h-screen bg-background text-zinc-100">
      <div className="flex min-h-screen flex-col lg:flex-row">
        <aside className="border-b border-white/10 bg-black/50 px-4 py-4 backdrop-blur lg:w-80 lg:border-b-0 lg:border-r lg:px-5">
          <div className="flex items-center justify-between gap-3 lg:block">
            <div className="flex items-center gap-3">
              <Link href="/">
                <Button variant="ghost" size="icon" className="h-9 w-9 text-zinc-400 hover:text-white" data-testid="button-back">
                  <ArrowLeft className="h-5 w-5" />
                </Button>
              </Link>
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-500">BlackOps</p>
                <h1 className="text-xl font-semibold text-white">Centro de mando</h1>
              </div>
            </div>
            {messages.length > 0 && (
              <Button
                variant="ghost"
                size="icon"
                onClick={clearChat}
                className="text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200 lg:mt-6"
                data-testid="button-clear-chat"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>

          <div className="mt-5 hidden lg:block">
            <div className="rounded-lg border border-white/15 bg-zinc-950/80 p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium text-zinc-100">
                <Sparkles className="h-4 w-4" />
                Asistente activo
              </div>
              <p className="text-sm leading-6 text-zinc-300">
                Puedo ayudarte con agenda, tareas, recordatorios, portafolio, radio y lo que voy aprendiendo de ti.
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-2 sm:grid-cols-3 lg:grid-cols-1">
            {CONTEXT_CARDS.map((card) => (
              <div key={card.label} className="rounded-lg border border-white/10 bg-zinc-950/70 p-3">
                <div className="mb-2 flex items-center gap-2">
                  <card.icon className="h-4 w-4 text-zinc-300" />
                  <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">{card.label}</span>
                </div>
                <div className="text-sm font-medium text-white">{card.value}</div>
                <p className="mt-1 text-xs leading-5 text-zinc-500">{card.detail}</p>
              </div>
            ))}
          </div>

          <div className="mt-5">
            <p className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">Acciones rapidas</p>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
              {QUICK_ACTIONS.map((action) => (
                <button
                  key={action.label}
                  onClick={() => (action.upload ? fileInputRef.current?.click() : sendMessage(action.prompt))}
                  className="flex min-h-12 items-center gap-3 rounded-lg border border-white/10 bg-zinc-950/70 px-3 py-2 text-left text-sm text-zinc-300 transition hover:border-white/25 hover:bg-zinc-900 hover:text-white"
                  data-testid={`quick-action-${action.label.toLowerCase().replace(/\s+/g, "-")}`}
                >
                  <action.icon className="h-4 w-4 text-zinc-300" />
                  <span>{action.label}</span>
                </button>
              ))}
            </div>
          </div>
        </aside>

        <main className="flex min-h-screen flex-1 flex-col">
          <header className="border-b border-white/10 bg-black/35 px-4 py-4 backdrop-blur">
            <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-white/15 bg-zinc-950">
                  <Bot className="h-5 w-5 text-zinc-100" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-white">Tu asistente personal</h2>
                  <p className="text-xs text-zinc-500">Chat, contexto y acciones en un solo lugar</p>
                </div>
              </div>
              <div className="hidden items-center gap-2 rounded-full border border-white/10 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-400 sm:flex">
                <span className="h-2 w-2 rounded-full bg-zinc-300" />
                Listo para trabajar
              </div>
            </div>
          </header>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6">
            <div className="mx-auto max-w-5xl">
              {messages.length === 0 ? (
                <div className="flex min-h-[58vh] flex-col justify-center">
                  <div className="max-w-2xl">
                    <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/15 bg-zinc-950 px-3 py-1 text-xs font-medium text-zinc-300">
                      <MessageSquare className="h-3.5 w-3.5" />
                      Conversacion nueva
                    </div>
                    <h3 className="text-3xl font-semibold tracking-tight text-white md:text-5xl">
                      Dime que necesitas resolver hoy.
                    </h3>
                    <p className="mt-4 max-w-xl text-sm leading-7 text-zinc-400">
                      Puedes hablar natural: revisar tu dia, crear una tarea, analizar tu cartera o subir una captura para que la procese.
                    </p>
                  </div>
                  <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {QUICK_ACTIONS.filter((action) => !action.upload).map((action) => (
                      <button
                        key={action.label}
                        onClick={() => sendMessage(action.prompt)}
                        className="rounded-lg border border-white/10 bg-zinc-950/70 p-4 text-left transition hover:border-white/25 hover:bg-zinc-900"
                        data-testid={`suggestion-${action.label.toLowerCase().replace(/\s+/g, "-")}`}
                      >
                        <action.icon className="mb-4 h-5 w-5 text-zinc-300" />
                        <div className="text-sm font-medium text-white">{action.label}</div>
                        <p className="mt-1 text-xs leading-5 text-zinc-500">{action.prompt}</p>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-5 pb-4">
                  {messages.map((msg, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.2 }}
                      className={cn("flex gap-3", msg.role === "user" ? "justify-end" : "justify-start")}
                    >
                      {msg.role === "assistant" && (
                        <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/15 bg-zinc-950">
                          <Bot className="h-4 w-4 text-zinc-100" />
                        </div>
                      )}
                      <div className={cn("max-w-[88%] md:max-w-[72%]", msg.role === "user" && "flex flex-col items-end")}>
                        <div
                          className={cn(
                            "rounded-lg px-4 py-3 text-sm leading-7 shadow-sm",
                            msg.role === "user"
                              ? "bg-zinc-100 text-zinc-950"
                              : "border border-white/10 bg-zinc-950/85 text-zinc-100"
                          )}
                          data-testid={`message-${msg.role}-${i}`}
                        >
                          {msg.images && msg.images.length > 0 && (
                            <div className="mb-3 flex flex-wrap gap-2">
                              {msg.images.map((img, imgIdx) => (
                                <img
                                  key={imgIdx}
                                  src={img}
                                  alt={`Imagen adjunta ${imgIdx + 1}`}
                                  className="h-28 w-28 rounded-md border border-white/20 object-cover"
                                  data-testid={`image-${msg.role}-${i}-${imgIdx}`}
                                />
                              ))}
                            </div>
                          )}
                          <p className="whitespace-pre-wrap">{formatContent(msg.content) || (isLoading && i === messages.length - 1 ? "Trabajando..." : "Listo.")}</p>
                        </div>
                        <span className="mt-1 block px-1 text-[11px] text-zinc-600">{formatTime(msg.timestamp)}</span>
                      </div>
                    </motion.div>
                  ))}
                  {isLoading && (messages[messages.length - 1]?.role === "user" || assistantStatus) && (
                    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex gap-3">
                      <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/15 bg-zinc-950">
                        <Bot className="h-4 w-4 text-zinc-100" />
                      </div>
                      <div className="flex max-w-[88%] items-center gap-3 rounded-lg border border-white/10 bg-zinc-950/85 px-4 py-3 text-sm text-zinc-400 md:max-w-[72%]" data-testid="assistant-working-status">
                        <Loader2 className="h-4 w-4 animate-spin text-zinc-300" />
                        {assistantStatus || "Pensando y revisando tu contexto..."}
                      </div>
                    </motion.div>
                  )}
                  {isTranscribing && (
                    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex gap-3">
                      <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/15 bg-zinc-950">
                        <Bot className="h-4 w-4 text-zinc-100" />
                      </div>
                      <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-zinc-950/85 px-4 py-3 text-sm text-zinc-400">
                        <Loader2 className="h-4 w-4 animate-spin text-zinc-300" />
                        Entendiendo tu nota de voz...
                      </div>
                    </motion.div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="border-t border-white/10 bg-black/55 px-4 py-4 backdrop-blur">
            <div className="mx-auto max-w-5xl">
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleImageSelect}
                accept="image/*"
                multiple
                className="hidden"
                data-testid="input-image-file"
              />

              {selectedImages.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-2">
                  {selectedImages.map((img, idx) => (
                    <div key={idx} className="relative">
                      <img
                        src={img}
                        alt={`Preview ${idx + 1}`}
                        className="h-16 w-16 rounded-md border border-white/10 object-cover"
                        data-testid={`image-preview-${idx}`}
                      />
                      <button
                        onClick={() => removeImage(idx)}
                        className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full border border-white/15 bg-zinc-950 text-zinc-200 shadow-lg hover:bg-zinc-900 hover:text-white"
                        data-testid={`button-remove-image-${idx}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                  <span className="self-end pb-1 text-xs text-zinc-500">
                    {selectedImages.length} {selectedImages.length === 1 ? "imagen" : "imagenes"} listas
                  </span>
                </div>
              )}

              <div className="flex items-end gap-2 rounded-lg border border-white/10 bg-zinc-950 p-2">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isLoading || isTranscribing || isRecording}
                  className="h-10 w-10 shrink-0 rounded-md text-zinc-400 hover:bg-zinc-900 hover:text-white"
                  title="Subir imagen"
                  data-testid="button-upload-image"
                >
                  <ImagePlus className="h-5 w-5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={toggleVoiceRecording}
                  disabled={isLoading || isTranscribing}
                  className={cn(
                    "h-10 w-10 shrink-0 rounded-md text-zinc-400 hover:bg-zinc-900 hover:text-white",
                    isRecording && "bg-red-950/60 text-red-200 hover:bg-red-900/70 hover:text-white"
                  )}
                  title={isRecording ? "Detener nota de voz" : "Grabar nota de voz"}
                  data-testid="button-record-voice"
                >
                  {isRecording ? <Square className="h-4 w-4 fill-current" /> : <Mic className="h-5 w-5" />}
                </Button>
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={
                    isRecording
                      ? "Grabando..."
                      : isTranscribing
                        ? "Transcribiendo voz..."
                        : selectedImages.length > 0
                          ? "Describe que quieres analizar..."
                          : "Escribele a tu asistente..."
                  }
                  rows={1}
                  className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
                  disabled={isLoading || isTranscribing || isRecording}
                  data-testid="input-assistant-message"
                />
                <Button
                  onClick={() => sendMessage()}
                  disabled={(!input.trim() && selectedImages.length === 0) || isLoading || isTranscribing || isRecording}
                  size="icon"
                  className="h-10 w-10 shrink-0 rounded-md bg-zinc-100 text-zinc-950 hover:bg-white disabled:opacity-50"
                  data-testid="button-send-message"
                >
                  {isLoading || isTranscribing ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                </Button>
              </div>
              <div className="mt-2 flex items-center gap-2 text-xs text-zinc-600">
                {isRecording ? <Mic className="h-3.5 w-3.5 text-red-300" /> : <Clock3 className="h-3.5 w-3.5" />}
                {isRecording ? "Grabando nota de voz. Toca detener para enviarla." : "Enter envia, Shift + Enter crea una nueva linea."}
              </div>
              {!isRecording && !isTranscribing && (
                <p className="mt-1 text-xs text-zinc-600" data-testid="text-blackroom-chat-help">
                  BlackRoom: prueba “sube 3 videos más hoy”, “activa el agente por 2 semanas” o “¿cómo va la cola de BlackRoom?”.
                </p>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
