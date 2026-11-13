import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { useState } from "react";
import type { ComponentType, ReactNode } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  Clock,
  Copy,
  FileText,
  HeartPulse,
  Landmark,
  Loader2,
  Megaphone,
  MessageSquareText,
  Pencil,
  Radio,
  Rocket,
  ShieldCheck,
  Siren,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { queryClient } from "@/lib/queryClient";

type DashboardItem = {
  id?: string;
  name?: string;
  title?: string;
  message?: string;
  description?: string | null;
  priority?: string;
  severity?: string;
  type?: string;
  dueAt?: string;
  startsAt?: string;
  endsAt?: string | null;
  status?: string;
  error?: string | null;
  symbol?: string;
  condition?: string;
  targetPrice?: string;
  triggeredAt?: string | null;
  createdAt?: string;
};

type CeoDashboardData = {
  backendUnavailable?: boolean;
  partial?: boolean;
  agenda?: DashboardItem[];
  topPriorities?: DashboardItem[];
  todayPriorities?: DashboardItem[];
  pendingApprovals?: DashboardItem[];
  criticalRisks?: DashboardItem[];
  appHealth?: {
    projects?: {
      total: number;
      online: number;
      offline: number;
      degraded: number;
      items?: DashboardItem[];
    };
    integrations?: {
      googleCalendar: boolean;
      github: boolean;
    };
    trust?: {
      pendingApprovals: number;
      permissionsConfigured: number;
      recentFailures: number;
    };
  };
  financeAlerts?: DashboardItem[];
  marketingContentStatus?: { openItems?: DashboardItem[]; needsDataModel?: boolean };
  marketingContentAlerts?: DashboardItem[];
  blackRoomEvents?: { upcoming?: DashboardItem[]; djContacts?: number };
  kongDropkitStatus?: { projects?: DashboardItem[]; connectedToGithub?: boolean; needsBusinessUnitModel?: boolean };
  automationFailures?: DashboardItem[];
  operationalHealth?: {
    status: "ready" | "warning" | "blocked";
    totals: {
      automations: number;
      active: number;
      paused: number;
      failedDefinitions: number;
      failedRuns: number;
      pendingApprovalRuns: number;
      overdueRuns: number;
    };
    recentRuns: Array<{
      id: string;
      automationId: string;
      title: string;
      status: string;
      startedAt: string;
      finishedAt: string | null;
      errorMessage: string | null;
    }>;
    items: DashboardItem[];
  };
  followUpsDue?: DashboardItem[];
  reminders?: DashboardItem[];
  meetingPreps?: Array<DashboardItem & {
    attendees?: string[];
    context?: string[];
    suggestedQuestions?: string[];
    followUps?: string[];
    risks?: string[];
  }>;
  decisions?: DashboardItem[];
  people?: DashboardItem[];
  commitments?: DashboardItem[];
};

type TelegramHealth = {
  tokenConfigured: boolean;
  aiConfigured: boolean;
  chatConfigured: boolean;
  enabled: boolean;
  webhookUrl: string | null;
  pendingUpdates: number;
  lastWebhookError: string | null;
  readyForBriefs: boolean;
  readyForChat: boolean;
};

type CeoReadiness = {
  ready: boolean;
  status: "ready" | "warning" | "blocked";
  checks: Array<{
    id: string;
    label: string;
    status: "ready" | "warning" | "blocked";
    detail: string;
  }>;
};

type CeoGoLive = {
  ready: boolean;
  automaticReady: boolean;
  manualReady: boolean;
  checks: Array<{
    id: string;
    label: string;
    ok: boolean;
    detail: string;
    evidenceCommand: string;
    evidence?: {
      confirmedAt: string | null;
      source: string;
      note?: string | null;
    };
  }>;
  nextCommands: string[];
};

type CeoConversationHistory = {
  messages: Array<{
    id: number;
    role: string;
    content: string;
    createdAt: string;
  }>;
};

type MemoryType = "decisions" | "people" | "commitments";

const EMPTY_DASHBOARD: CeoDashboardData = {
  agenda: [],
  topPriorities: [],
  todayPriorities: [],
  pendingApprovals: [],
  criticalRisks: [],
  appHealth: {
    projects: { total: 0, online: 0, offline: 0, degraded: 0, items: [] },
    integrations: { googleCalendar: false, github: false },
    trust: { pendingApprovals: 0, permissionsConfigured: 0, recentFailures: 0 },
  },
  financeAlerts: [],
  marketingContentStatus: { openItems: [], needsDataModel: true },
  marketingContentAlerts: [],
  blackRoomEvents: { upcoming: [], djContacts: 0 },
  kongDropkitStatus: { projects: [], connectedToGithub: false, needsBusinessUnitModel: true },
  automationFailures: [],
  operationalHealth: {
    status: "ready",
    totals: { automations: 0, active: 0, paused: 0, failedDefinitions: 0, failedRuns: 0, pendingApprovalRuns: 0, overdueRuns: 0 },
    recentRuns: [],
    items: [],
  },
  followUpsDue: [],
  reminders: [],
  meetingPreps: [],
  decisions: [],
  people: [],
  commitments: [],
};

function formatTime(value?: string | null) {
  if (!value) return "";
  return new Date(value).toLocaleTimeString("es-US", { hour: "numeric", minute: "2-digit" });
}

function statusTone(value?: string) {
  if (value === "critical" || value === "offline" || value === "failed" || value === "high" || value === "blocked") {
    return "border-red-500/30 bg-red-500/10 text-red-200";
  }
  if (value === "medium" || value === "degraded" || value === "pending" || value === "warning") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-200";
  }
  return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
}

function EmptyLine({ text = "Nada urgente ahora." }: { text?: string }) {
  return <p className="rounded-lg border border-white/10 bg-white/[0.03] p-3 text-sm text-zinc-500">{text}</p>;
}

function ItemList({
  items = [],
  empty,
  onComplete,
  onDelete,
  onEdit,
}: {
  items?: DashboardItem[];
  empty?: string;
  onComplete?: (id: string) => void;
  onDelete?: (id: string) => void;
  onEdit?: (item: DashboardItem) => void;
}) {
  if (!items.length) return <EmptyLine text={empty} />;

  return (
    <div className="space-y-2">
      {items.slice(0, 6).map((item, index) => (
        <div key={item.id || `${item.title}-${index}`} className="rounded-lg border border-white/10 bg-zinc-950/70 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-white">{item.title || item.name || item.message || item.description || item.symbol || "Item"}</p>
              {(item.description || item.error) && (
                <p className="mt-1 line-clamp-2 text-xs text-zinc-500">{item.description || item.error}</p>
              )}
            </div>
            {(item.priority || item.severity || item.status || item.type) && (
              <Badge variant="outline" className={statusTone(item.severity || item.priority || item.status)}>
                {item.severity || item.priority || item.status || item.type}
              </Badge>
            )}
          </div>
          {(item.dueAt || item.startsAt || item.createdAt || item.triggeredAt) && (
            <p className="mt-2 text-xs text-zinc-500">
              {formatTime(item.dueAt || item.startsAt || item.createdAt || item.triggeredAt)}
            </p>
          )}
          {onComplete && item.id && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-3 h-8 border-white/10 bg-white/[0.03] text-xs text-zinc-300 hover:bg-emerald-500/10 hover:text-emerald-100"
              onClick={() => onComplete(item.id!)}
            >
              Completar
            </Button>
          )}
          {onEdit && item.id && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="mt-3 mr-2 h-8 text-xs text-zinc-500 hover:bg-cyan-500/10 hover:text-cyan-100"
              onClick={() => onEdit(item)}
            >
              <Pencil className="mr-2 h-3.5 w-3.5" />
              Editar
            </Button>
          )}
          {onDelete && item.id && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="mt-3 h-8 text-xs text-zinc-500 hover:bg-red-500/10 hover:text-red-200"
              onClick={() => onDelete(item.id!)}
            >
              <Trash2 className="mr-2 h-3.5 w-3.5" />
              Borrar
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}

function CommandCard({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: ComponentType<{ className?: string }>;
  children: ReactNode;
}) {
  return (
    <Card className="border-white/10 bg-zinc-950/80 shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
          <Icon className="h-4 w-4 text-cyan-300" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function MeetingPrepList({ items = [] }: { items?: CeoDashboardData["meetingPreps"] }) {
  if (!items?.length) return <EmptyLine text="No hay reuniones próximas que requieran prep." />;

  return (
    <div className="space-y-3">
      {items.slice(0, 3).map((item) => (
        <div key={item.id || item.title} className="rounded-lg border border-white/10 bg-zinc-950/70 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-white">{item.title}</p>
              <p className="mt-1 text-xs text-zinc-500">{formatTime(item.startsAt)}</p>
            </div>
            <Badge variant="outline" className={statusTone(item.risks?.length ? "medium" : "online")}>
              prep
            </Badge>
          </div>
          {!!item.context?.length && (
            <div className="mt-3 space-y-1">
              <p className="text-xs font-medium text-zinc-300">Contexto</p>
              {item.context.slice(0, 2).map((line, index) => (
                <p key={index} className="line-clamp-2 text-xs text-zinc-500">{line}</p>
              ))}
            </div>
          )}
          {!!item.suggestedQuestions?.length && (
            <div className="mt-3 space-y-1">
              <p className="text-xs font-medium text-zinc-300">Preguntas</p>
              {item.suggestedQuestions.slice(0, 2).map((question, index) => (
                <p key={index} className="text-xs text-zinc-500">• {question}</p>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default function CeoDashboardPage() {
  const [followUp, setFollowUp] = useState({
    person: "",
    topic: "",
    dueAt: "",
    channel: "",
    notes: "",
    priority: "normal",
  });
  const [decision, setDecision] = useState({
    title: "",
    decision: "",
    context: "",
  });
  const [person, setPerson] = useState({
    name: "",
    role: "",
    company: "",
    notes: "",
  });
  const [commitment, setCommitment] = useState({
    owner: "",
    commitment: "",
    dueAt: "",
    context: "",
  });
  const [communicationDraft, setCommunicationDraft] = useState({
    recipient: "",
    channel: "",
    subject: "",
    message: "",
    context: "",
  });
  const [copiedGoLiveCommand, setCopiedGoLiveCommand] = useState("");
  const [copyGoLiveCommandError, setCopyGoLiveCommandError] = useState("");
  const [editingMemory, setEditingMemory] = useState<{
    type: MemoryType;
    id: string;
    title: string;
    value: string;
  } | null>(null);

  const { data, isLoading, isError } = useQuery<CeoDashboardData>({
    queryKey: ["ceo-dashboard"],
    queryFn: async () => {
      try {
        const res = await fetch("/api/ceo-dashboard");
        if (!res.ok) {
          return { ...EMPTY_DASHBOARD, backendUnavailable: true };
        }
        const payload = await res.json();
        if (payload?.error) {
          return { ...EMPTY_DASHBOARD, backendUnavailable: true };
        }
        return { ...EMPTY_DASHBOARD, ...payload };
      } catch {
        return { ...EMPTY_DASHBOARD, backendUnavailable: true };
      }
    },
    refetchInterval: 30000,
  });

  const { data: telegramHealth } = useQuery<TelegramHealth>({
    queryKey: ["telegram-health"],
    queryFn: () => fetch("/api/telegram/health").then((response) => response.json()),
    refetchInterval: 60000,
  });

  const { data: ceoReadiness } = useQuery<CeoReadiness | null>({
    queryKey: ["ceo-readiness"],
    queryFn: async () => {
      const response = await fetch("/api/ceo/readiness");
      if (!response.ok) return null;
      return response.json();
    },
    refetchInterval: 60000,
  });

  const { data: ceoGoLive } = useQuery<CeoGoLive | null>({
    queryKey: ["ceo-go-live"],
    queryFn: async () => {
      const response = await fetch("/api/ceo/go-live");
      if (!response.ok) return null;
      return response.json();
    },
    refetchInterval: 60000,
  });

  const { data: ceoConversationHistory } = useQuery<CeoConversationHistory>({
    queryKey: ["ceo-conversation-history"],
    queryFn: async () => {
      const response = await fetch("/api/ceo/conversation-history?limit=6");
      if (!response.ok) return { messages: [] };
      return response.json();
    },
    refetchInterval: 60000,
  });

  const health = data?.appHealth;
  const operationalHealth = data?.operationalHealth;
  const hasCritical = Boolean((data?.criticalRisks?.length || 0) > 0 || (health?.projects?.offline || 0) > 0);
  const goLivePassed = ceoGoLive?.checks.filter((check) => check.ok).length || 0;
  const goLiveTotal = ceoGoLive?.checks.length || 0;
  const missingGoLiveChecks = ceoGoLive?.checks.filter((check) => !check.ok) || [];
  const confirmedGoLiveChecks = ceoGoLive?.checks.filter((check) => check.ok) || [];
  const canManuallyConfirmGoLiveCheck = (checkId: string) => checkId !== "smoke_ready";

  const createFollowUp = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/ceo/follow-ups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(followUp),
      });
      if (!res.ok) throw new Error("No se pudo crear el follow-up");
      return res.json();
    },
    onSuccess: () => {
      setFollowUp({ person: "", topic: "", dueAt: "", channel: "", notes: "", priority: "normal" });
      queryClient.invalidateQueries({ queryKey: ["ceo-dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  const completeFollowUp = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/ceo/follow-ups/${id}/complete`, { method: "POST" });
      if (!res.ok) throw new Error("No se pudo completar el follow-up");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ceo-dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  const saveDecision = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/ceo/decisions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(decision),
      });
      if (!res.ok) throw new Error("No se pudo guardar la decision");
      return res.json();
    },
    onSuccess: () => {
      setDecision({ title: "", decision: "", context: "" });
      queryClient.invalidateQueries({ queryKey: ["ceo-dashboard"] });
    },
  });

  const savePerson = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/ceo/people", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(person),
      });
      if (!res.ok) throw new Error("No se pudo guardar la persona");
      return res.json();
    },
    onSuccess: () => {
      setPerson({ name: "", role: "", company: "", notes: "" });
      queryClient.invalidateQueries({ queryKey: ["ceo-dashboard"] });
    },
  });

  const saveCommitment = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/ceo/commitments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(commitment),
      });
      if (!res.ok) throw new Error("No se pudo guardar el compromiso");
      return res.json();
    },
    onSuccess: () => {
      setCommitment({ owner: "", commitment: "", dueAt: "", context: "" });
      queryClient.invalidateQueries({ queryKey: ["ceo-dashboard"] });
    },
  });

  const editMemoryItem = useMutation({
    mutationFn: async (item: { type: MemoryType; id: string; title: string; value: string }) => {
      const res = await fetch(`/api/ceo/${item.type}/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: item.title, value: item.value }),
      });
      if (!res.ok) throw new Error("No se pudo editar el item");
      return res.json();
    },
    onSuccess: () => {
      setEditingMemory(null);
      queryClient.invalidateQueries({ queryKey: ["ceo-dashboard"] });
    },
  });

  const deleteMemoryItem = useMutation({
    mutationFn: async ({ type, id }: { type: MemoryType; id: string }) => {
      const res = await fetch(`/api/ceo/${type}/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("No se pudo borrar el item");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ceo-dashboard"] });
    },
  });

  const createCommunicationDraft = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/ceo/communication-drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(communicationDraft),
      });
      if (!res.ok) throw new Error("No se pudo crear el borrador");
      return res.json();
    },
    onSuccess: () => {
      setCommunicationDraft({ recipient: "", channel: "", subject: "", message: "", context: "" });
      queryClient.invalidateQueries({ queryKey: ["ceo-dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["pending-actions"] });
    },
  });

  const sendCeoBrief = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/telegram/test-ceo-brief", { method: "POST" });
      if (!res.ok) throw new Error("No se pudo enviar el brief CEO");
      return res.json();
    },
  });

  const markGoLiveEvidence = useMutation({
    mutationFn: async ({ checkId, confirmed }: { checkId: string; confirmed: boolean }) => {
      const res = await fetch("/api/ceo/go-live/evidence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checkId, confirmed }),
      });
      if (!res.ok) throw new Error("No se pudo guardar la evidencia go-live");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ceo-go-live"] });
    },
  });

  const canCreateFollowUp = followUp.person.trim().length > 0 && followUp.topic.trim().length > 0;
  const canSaveDecision = decision.title.trim().length > 0 && decision.decision.trim().length > 0;
  const canSavePerson = person.name.trim().length > 0;
  const canSaveCommitment = commitment.owner.trim().length > 0 && commitment.commitment.trim().length > 0;
  const canCreateCommunicationDraft = communicationDraft.recipient.trim().length > 0 && communicationDraft.channel.trim().length > 0 && communicationDraft.message.trim().length > 0;
  const copyGoLiveCommand = async (command: string) => {
    try {
      await navigator.clipboard.writeText(command);
      setCopiedGoLiveCommand(command);
      setCopyGoLiveCommandError("");
    } catch {
      setCopiedGoLiveCommand("");
      setCopyGoLiveCommandError("No se pudo copiar el comando. Seleccionalo manualmente.");
    }
  };

  return (
    <div className="min-h-screen bg-black pb-8 text-white">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-black/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-4">
          <div className="flex items-center gap-3">
            <Link href="/">
              <Button variant="ghost" size="icon" className="rounded-full text-zinc-400 hover:bg-zinc-900 hover:text-white">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-cyan-300">BlackOps</p>
              <h1 className="text-xl font-semibold sm:text-2xl">CEO Dashboard</h1>
            </div>
          </div>
          <Badge variant="outline" className={hasCritical ? statusTone("critical") : statusTone("online")}>
            {hasCritical ? "Watch" : "Clear"}
          </Badge>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-4 px-4 py-5">
        {isLoading ? (
          <div className="flex h-72 items-center justify-center text-zinc-400">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Cargando mando CEO...
          </div>
        ) : (
          <>
            {(isError || data?.backendUnavailable) && (
              <Card className="border-amber-500/20 bg-amber-950/20 shadow-none">
                <CardContent className="flex items-center gap-2 p-4 text-sm text-amber-100">
                  <AlertTriangle className="h-4 w-4" />
                  Backend no conectado en este preview. Te muestro el tablero listo con estados vacios.
                </CardContent>
              </Card>
            )}

            <section className="grid gap-3 md:grid-cols-4">
              <Card className="border-white/10 bg-zinc-950/80 md:col-span-2">
                <CardContent className="grid grid-cols-3 gap-3 p-4 text-center">
                  <div>
                    <p className="text-2xl font-semibold text-white">{data?.pendingApprovals?.length || 0}</p>
                    <p className="text-xs text-zinc-500">Aprobaciones</p>
                  </div>
                  <div>
                    <p className="text-2xl font-semibold text-white">{data?.criticalRisks?.length || 0}</p>
                    <p className="text-xs text-zinc-500">Riesgos</p>
                  </div>
                  <div>
                    <p className="text-2xl font-semibold text-white">{health?.projects?.online || 0}/{health?.projects?.total || 0}</p>
                    <p className="text-xs text-zinc-500">Apps online</p>
                  </div>
                </CardContent>
              </Card>
              <CommandCard title="Integraciones" icon={ShieldCheck}>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline" className={statusTone(health?.integrations?.googleCalendar ? "online" : "pending")}>Calendar</Badge>
                  <Badge variant="outline" className={statusTone(health?.integrations?.github ? "online" : "pending")}>GitHub</Badge>
                  <Badge variant="outline" className={statusTone(telegramHealth?.readyForChat ? "online" : "pending")}>Telegram</Badge>
                </div>
                {telegramHealth?.lastWebhookError && (
                  <p className="mt-2 line-clamp-2 text-xs text-amber-300">{telegramHealth.lastWebhookError}</p>
                )}
              </CommandCard>
              <CommandCard title="Automations" icon={Bot}>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-2xl font-semibold capitalize">{operationalHealth?.status || "unknown"}</p>
                  <Badge variant="outline" className={statusTone(operationalHealth?.status)}>
                    {operationalHealth?.totals.active || 0}/{operationalHealth?.totals.automations || 0} active
                  </Badge>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-md border border-white/10 bg-black p-2">
                    <p className="text-lg font-semibold text-red-200">{operationalHealth?.totals.failedRuns || 0}</p>
                    <p className="text-[10px] text-zinc-500">failed</p>
                  </div>
                  <div className="rounded-md border border-white/10 bg-black p-2">
                    <p className="text-lg font-semibold text-amber-200">{operationalHealth?.totals.pendingApprovalRuns || 0}</p>
                    <p className="text-[10px] text-zinc-500">approval</p>
                  </div>
                  <div className="rounded-md border border-white/10 bg-black p-2">
                    <p className="text-lg font-semibold text-cyan-200">{operationalHealth?.totals.overdueRuns || 0}</p>
                    <p className="text-[10px] text-zinc-500">overdue</p>
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!telegramHealth?.readyForBriefs || sendCeoBrief.isPending}
                  onClick={() => sendCeoBrief.mutate()}
                  className="mt-3 border-white/10 bg-white/[0.03] text-xs"
                >
                  Enviar brief ahora
                </Button>
                {sendCeoBrief.isSuccess && <p className="mt-2 text-xs text-emerald-300">Brief enviado a Telegram.</p>}
                {sendCeoBrief.isError && <p className="mt-2 text-xs text-red-300">No se pudo enviar el brief.</p>}
              </CommandCard>
              <CommandCard title="CEO readiness" icon={ShieldCheck}>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-2xl font-semibold capitalize">{ceoReadiness?.status || "unknown"}</p>
                  <Badge variant="outline" className={statusTone(ceoReadiness?.status)}>
                    {ceoReadiness?.ready ? "Ready" : ceoReadiness?.status || "Loading"}
                  </Badge>
                </div>
                <div className="mt-3 space-y-2">
                  {(ceoReadiness?.checks || []).slice(0, 4).map((check) => (
                    <div key={check.id} className="flex items-start justify-between gap-3 rounded-lg border border-white/10 bg-zinc-950/70 p-2">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-zinc-200">{check.label}</p>
                        <p className="mt-0.5 line-clamp-2 text-xs text-zinc-500">{check.detail}</p>
                      </div>
                      <Badge variant="outline" className={statusTone(check.status)}>
                        {check.status}
                      </Badge>
                    </div>
                  ))}
                  {!ceoReadiness?.checks?.length && <EmptyLine text="Readiness no disponible." />}
                </div>
              </CommandCard>
            </section>

            <section className="grid gap-4 lg:grid-cols-3">
              <CommandCard title="Go-live" icon={Rocket}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-2xl font-semibold">{ceoGoLive?.ready ? "Ready" : "Bloqueado"}</p>
                    <p className="mt-1 text-xs text-zinc-500">
                      {goLivePassed}/{goLiveTotal || 6} checks completados
                    </p>
                  </div>
                  <Badge variant="outline" className={statusTone(ceoGoLive?.ready ? "ready" : "blocked")}>
                    {ceoGoLive?.ready ? "Encender" : "Falta evidencia"}
                  </Badge>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-center">
                  <div className="rounded-md border border-white/10 bg-black p-2">
                    <p className="text-lg font-semibold text-cyan-200">{ceoGoLive?.automaticReady ? "OK" : "No"}</p>
                    <p className="text-[10px] text-zinc-500">smoke</p>
                  </div>
                  <div className="rounded-md border border-white/10 bg-black p-2">
                    <p className="text-lg font-semibold text-amber-200">{ceoGoLive?.manualReady ? "OK" : "No"}</p>
                    <p className="text-[10px] text-zinc-500">externo</p>
                  </div>
                </div>
              </CommandCard>
              <CommandCard title="Bloqueos go-live" icon={AlertTriangle}>
                {missingGoLiveChecks.length ? (
                  <div className="space-y-2">
                    {missingGoLiveChecks.map((check) => (
                      <div key={check.id} className="rounded-lg border border-white/10 bg-zinc-950/70 p-2">
                        <div className="flex items-start justify-between gap-3">
                          <p className="min-w-0 truncate text-xs font-medium text-zinc-200">{check.label}</p>
                          <Badge variant="outline" className={statusTone("blocked")}>missing</Badge>
                        </div>
                        <p className="mt-1 line-clamp-2 text-xs text-zinc-500">{check.detail}</p>
                        {canManuallyConfirmGoLiveCheck(check.id) ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={markGoLiveEvidence.isPending}
                            onClick={() => markGoLiveEvidence.mutate({ checkId: check.id, confirmed: true })}
                            className="mt-2 h-8 border-white/10 bg-white/[0.03] text-xs text-zinc-300 hover:bg-emerald-500/10 hover:text-emerald-100"
                          >
                            <CheckCircle2 className="mr-2 h-3.5 w-3.5" />
                            Confirmar
                          </Button>
                        ) : (
                          <p className="mt-2 text-[11px] text-cyan-300">Se verifica ejecutando el comando de smoke.</p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyLine text={ceoGoLive?.ready ? "El asistente esta listo para salida." : "Go-live no disponible."} />
                )}
                {markGoLiveEvidence.isSuccess && <p className="mt-2 text-xs text-emerald-300">Evidencia actualizada.</p>}
                {markGoLiveEvidence.isError && <p className="mt-2 text-xs text-red-300">No se pudo guardar la evidencia.</p>}
              </CommandCard>
              <CommandCard title="Siguiente evidencia" icon={FileText}>
                {ceoGoLive?.nextCommands?.length ? (
                  <div className="space-y-2">
                    {ceoGoLive.nextCommands.map((command) => (
                      <div key={command} className="flex items-start gap-2 rounded-lg border border-white/10 bg-black p-2">
                        <p className="min-w-0 flex-1 break-words font-mono text-[11px] leading-relaxed text-zinc-300">
                          {command}
                        </p>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          title="Copiar comando"
                          onClick={() => copyGoLiveCommand(command)}
                          className="h-7 w-7 shrink-0 text-zinc-500 hover:bg-cyan-500/10 hover:text-cyan-100"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyLine text={ceoGoLive?.ready ? "No quedan comandos pendientes." : "Sin evidencia pendiente cargada."} />
                )}
                {copiedGoLiveCommand && <p className="mt-2 text-xs text-cyan-300">Comando copiado.</p>}
                {copyGoLiveCommandError && <p className="mt-2 text-xs text-amber-300">{copyGoLiveCommandError}</p>}
                {!!confirmedGoLiveChecks.length && (
                  <div className="mt-3 space-y-2 border-t border-white/10 pt-3">
                    {confirmedGoLiveChecks.map((check) => (
                      <div key={check.id} className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-zinc-950/70 p-2">
                        <div className="min-w-0">
                          <p className="truncate text-xs text-zinc-300">{check.label}</p>
                          <p className="mt-0.5 truncate text-[11px] text-zinc-600">
                            {check.evidence?.source || "manual"}
                            {check.evidence?.confirmedAt ? ` · ${formatTime(check.evidence.confirmedAt)}` : ""}
                          </p>
                          {check.evidence?.note && (
                            <p className="mt-0.5 truncate text-[11px] text-zinc-500">{check.evidence.note}</p>
                          )}
                        </div>
                        {canManuallyConfirmGoLiveCheck(check.id) ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={markGoLiveEvidence.isPending}
                            onClick={() => markGoLiveEvidence.mutate({ checkId: check.id, confirmed: false })}
                            className="h-7 px-2 text-xs text-zinc-500 hover:bg-red-500/10 hover:text-red-200"
                          >
                            Reset
                          </Button>
                        ) : (
                          <p className="shrink-0 text-[11px] text-cyan-300">comando</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CommandCard>
            </section>

            <section className="grid gap-4 lg:grid-cols-3">
              <CommandCard title="Agenda de hoy" icon={CalendarDays}>
                <ItemList items={data?.agenda} empty="No hay eventos pendientes hoy." />
              </CommandCard>
              <CommandCard title="Meeting prep" icon={MessageSquareText}>
                <MeetingPrepList items={data?.meetingPreps} />
              </CommandCard>
              <CommandCard title="Top 3 prioridades" icon={Rocket}>
                <ItemList items={data?.topPriorities} empty="Sin prioridades criticas." />
              </CommandCard>
            </section>

            <section className="grid gap-4 lg:grid-cols-3">
              <CommandCard title="Historial CEO" icon={MessageSquareText}>
                {ceoConversationHistory?.messages?.length ? (
                  <div className="space-y-2">
                    {ceoConversationHistory.messages.slice(-6).map((message) => (
                      <div key={message.id} className="rounded-lg border border-white/10 bg-zinc-950/70 p-3">
                        <div className="mb-1 flex items-center justify-between gap-3">
                          <Badge variant="outline" className={statusTone(message.role === "assistant" ? "online" : "pending")}>
                            {message.role === "assistant" ? "Assistant" : "Usuario"}
                          </Badge>
                          <p className="text-xs text-zinc-600">{formatTime(message.createdAt)}</p>
                        </div>
                        <p className="line-clamp-3 text-sm text-zinc-300">{message.content}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyLine text="Sin historial compartido todavía." />
                )}
              </CommandCard>
              <CommandCard title="Aprobaciones" icon={CheckCircle2}>
                <ItemList items={data?.pendingApprovals} empty="No hay nada esperando aprobacion." />
              </CommandCard>
              <CommandCard title="Riesgos criticos" icon={Siren}>
                <ItemList items={data?.criticalRisks} empty="No hay riesgos criticos." />
              </CommandCard>
            </section>

            <section className="grid gap-4 lg:grid-cols-3">
              <CommandCard title="App health" icon={HeartPulse}>
                <ItemList items={health?.projects?.items} empty="No hay proyectos monitoreados." />
              </CommandCard>
              <CommandCard title="Finance alerts" icon={CircleDollarSign}>
                <ItemList items={data?.financeAlerts} empty="No hay alertas financieras activas." />
              </CommandCard>
            </section>

            <section className="grid gap-4 lg:grid-cols-3">
              <CommandCard title="Marketing / content" icon={Megaphone}>
                <ItemList items={data?.marketingContentStatus?.openItems || data?.marketingContentAlerts} empty="No hay piezas de contenido abiertas." />
              </CommandCard>
              <CommandCard title="Black Room" icon={Radio}>
                <ItemList items={data?.blackRoomEvents?.upcoming} empty="No hay eventos Black Room proximos." />
                <p className="mt-3 text-xs text-zinc-500">{data?.blackRoomEvents?.djContacts || 0} DJ contacts guardados</p>
              </CommandCard>
              <CommandCard title="Kong / Dropkit" icon={AlertTriangle}>
                <ItemList items={data?.kongDropkitStatus?.projects} empty="Agrega proyectos Kong/Dropkit en Apps para verlos aqui." />
              </CommandCard>
            </section>

            <section className="grid gap-4 lg:grid-cols-2">
              <CommandCard title="Automation failures" icon={AlertTriangle}>
                <ItemList items={data?.automationFailures} empty="No hay fallas recientes." />
              </CommandCard>
              <CommandCard title="Job health" icon={Bot}>
                <ItemList items={operationalHealth?.items} empty="No hay jobs configurados." />
              </CommandCard>
            </section>

            <section className="grid gap-4 lg:grid-cols-2">
              <CommandCard title="Follow-ups due" icon={Clock}>
                <ItemList
                  items={data?.followUpsDue}
                  empty="No hay follow-ups vencidos."
                  onComplete={(id) => completeFollowUp.mutate(id)}
                />
              </CommandCard>
            </section>

            <section className="grid gap-4 lg:grid-cols-2">
              <CommandCard title="Nuevo follow-up" icon={UserPlus}>
                <form
                  className="space-y-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (canCreateFollowUp) createFollowUp.mutate();
                  }}
                >
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Input
                      value={followUp.person}
                      onChange={(event) => setFollowUp((prev) => ({ ...prev, person: event.target.value }))}
                      placeholder="Persona o equipo"
                      className="border-white/10 bg-zinc-950"
                    />
                    <Input
                      value={followUp.topic}
                      onChange={(event) => setFollowUp((prev) => ({ ...prev, topic: event.target.value }))}
                      placeholder="Qué hay que seguir"
                      className="border-white/10 bg-zinc-950"
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Input
                      type="datetime-local"
                      value={followUp.dueAt}
                      onChange={(event) => setFollowUp((prev) => ({ ...prev, dueAt: event.target.value }))}
                      className="border-white/10 bg-zinc-950"
                    />
                    <Input
                      value={followUp.channel}
                      onChange={(event) => setFollowUp((prev) => ({ ...prev, channel: event.target.value }))}
                      placeholder="Canal"
                      className="border-white/10 bg-zinc-950"
                    />
                    <select
                      value={followUp.priority}
                      onChange={(event) => setFollowUp((prev) => ({ ...prev, priority: event.target.value }))}
                      className="h-10 rounded-md border border-white/10 bg-zinc-950 px-3 text-sm text-white"
                    >
                      <option value="normal">Normal</option>
                      <option value="high">Alta</option>
                      <option value="medium">Media</option>
                      <option value="low">Baja</option>
                    </select>
                  </div>
                  <Textarea
                    value={followUp.notes}
                    onChange={(event) => setFollowUp((prev) => ({ ...prev, notes: event.target.value }))}
                    placeholder="Notas, contexto o siguiente paso"
                    className="min-h-20 border-white/10 bg-zinc-950"
                  />
                  <Button type="submit" disabled={!canCreateFollowUp || createFollowUp.isPending} className="bg-cyan-600 hover:bg-cyan-700">
                    Crear follow-up
                  </Button>
                </form>
              </CommandCard>

              <CommandCard title="Reminders activos" icon={FileText}>
                <ItemList items={data?.reminders} empty="No hay recordatorios activos." />
              </CommandCard>
            </section>

            {editingMemory && (
              <CommandCard title="Editar memoria" icon={Pencil}>
                <form
                  className="space-y-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    editMemoryItem.mutate(editingMemory);
                  }}
                >
                  <Input
                    value={editingMemory.title}
                    onChange={(event) => setEditingMemory((prev) => prev ? { ...prev, title: event.target.value } : prev)}
                    placeholder="Título"
                    className="border-white/10 bg-zinc-950"
                  />
                  <Textarea
                    value={editingMemory.value}
                    onChange={(event) => setEditingMemory((prev) => prev ? { ...prev, value: event.target.value } : prev)}
                    placeholder="Contenido"
                    className="min-h-24 border-white/10 bg-zinc-950"
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button type="submit" disabled={editMemoryItem.isPending || !editingMemory.title.trim() || !editingMemory.value.trim()} className="bg-cyan-600 hover:bg-cyan-700">
                      Guardar cambios
                    </Button>
                    <Button type="button" variant="outline" className="border-white/10" onClick={() => setEditingMemory(null)}>
                      Cancelar
                    </Button>
                  </div>
                </form>
              </CommandCard>
            )}

            <section className="grid gap-4 lg:grid-cols-2">
              <CommandCard title="Decision log" icon={Landmark}>
                <ItemList
                  items={data?.decisions}
                  empty="No hay decisiones guardadas."
                  onEdit={(item) => setEditingMemory({ type: "decisions", id: item.id!, title: item.title || "", value: item.description || "" })}
                  onDelete={(id) => deleteMemoryItem.mutate({ type: "decisions", id })}
                />
              </CommandCard>
              <CommandCard title="Guardar decisión" icon={ShieldCheck}>
                <form
                  className="space-y-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (canSaveDecision) saveDecision.mutate();
                  }}
                >
                  <Input
                    value={decision.title}
                    onChange={(event) => setDecision((prev) => ({ ...prev, title: event.target.value }))}
                    placeholder="Título de la decisión"
                    className="border-white/10 bg-zinc-950"
                  />
                  <Textarea
                    value={decision.decision}
                    onChange={(event) => setDecision((prev) => ({ ...prev, decision: event.target.value }))}
                    placeholder="Qué se decidió"
                    className="min-h-20 border-white/10 bg-zinc-950"
                  />
                  <Textarea
                    value={decision.context}
                    onChange={(event) => setDecision((prev) => ({ ...prev, context: event.target.value }))}
                    placeholder="Contexto o razón"
                    className="min-h-16 border-white/10 bg-zinc-950"
                  />
                  <Button type="submit" disabled={!canSaveDecision || saveDecision.isPending} className="bg-cyan-600 hover:bg-cyan-700">
                    Guardar decisión
                  </Button>
                </form>
              </CommandCard>
            </section>

            <section className="grid gap-4 lg:grid-cols-2">
              <CommandCard title="Personas clave" icon={Users}>
                <ItemList
                  items={data?.people}
                  empty="No hay personas clave guardadas."
                  onEdit={(item) => setEditingMemory({ type: "people", id: item.id!, title: item.title || "", value: item.description || "" })}
                  onDelete={(id) => deleteMemoryItem.mutate({ type: "people", id })}
                />
              </CommandCard>
              <CommandCard title="Guardar persona" icon={UserPlus}>
                <form
                  className="space-y-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (canSavePerson) savePerson.mutate();
                  }}
                >
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Input
                      value={person.name}
                      onChange={(event) => setPerson((prev) => ({ ...prev, name: event.target.value }))}
                      placeholder="Nombre"
                      className="border-white/10 bg-zinc-950"
                    />
                    <Input
                      value={person.role}
                      onChange={(event) => setPerson((prev) => ({ ...prev, role: event.target.value }))}
                      placeholder="Rol"
                      className="border-white/10 bg-zinc-950"
                    />
                  </div>
                  <Input
                    value={person.company}
                    onChange={(event) => setPerson((prev) => ({ ...prev, company: event.target.value }))}
                    placeholder="Empresa/proyecto"
                    className="border-white/10 bg-zinc-950"
                  />
                  <Textarea
                    value={person.notes}
                    onChange={(event) => setPerson((prev) => ({ ...prev, notes: event.target.value }))}
                    placeholder="Notas importantes"
                    className="min-h-16 border-white/10 bg-zinc-950"
                  />
                  <Button type="submit" disabled={!canSavePerson || savePerson.isPending} className="bg-cyan-600 hover:bg-cyan-700">
                    Guardar persona
                  </Button>
                </form>
              </CommandCard>
            </section>

            <section className="grid gap-4 lg:grid-cols-2">
              <CommandCard title="Compromisos abiertos" icon={ShieldCheck}>
                <ItemList
                  items={data?.commitments}
                  empty="No hay compromisos guardados."
                  onEdit={(item) => setEditingMemory({ type: "commitments", id: item.id!, title: item.title || "", value: item.description || "" })}
                  onDelete={(id) => deleteMemoryItem.mutate({ type: "commitments", id })}
                />
              </CommandCard>
              <CommandCard title="Guardar compromiso" icon={FileText}>
                <form
                  className="space-y-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (canSaveCommitment) saveCommitment.mutate();
                  }}
                >
                  <Input
                    value={commitment.owner}
                    onChange={(event) => setCommitment((prev) => ({ ...prev, owner: event.target.value }))}
                    placeholder="Quién lo debe"
                    className="border-white/10 bg-zinc-950"
                  />
                  <Textarea
                    value={commitment.commitment}
                    onChange={(event) => setCommitment((prev) => ({ ...prev, commitment: event.target.value }))}
                    placeholder="Qué prometió o qué queda pendiente"
                    className="min-h-20 border-white/10 bg-zinc-950"
                  />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Input
                      type="datetime-local"
                      value={commitment.dueAt}
                      onChange={(event) => setCommitment((prev) => ({ ...prev, dueAt: event.target.value }))}
                      className="border-white/10 bg-zinc-950"
                    />
                    <Input
                      value={commitment.context}
                      onChange={(event) => setCommitment((prev) => ({ ...prev, context: event.target.value }))}
                      placeholder="Contexto"
                      className="border-white/10 bg-zinc-950"
                    />
                  </div>
                  <Button type="submit" disabled={!canSaveCommitment || saveCommitment.isPending} className="bg-cyan-600 hover:bg-cyan-700">
                    Guardar compromiso
                  </Button>
                </form>
              </CommandCard>
            </section>

            <CommandCard title="Borrador de comunicación" icon={MessageSquareText}>
              <form
                className="space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (canCreateCommunicationDraft) createCommunicationDraft.mutate();
                }}
              >
                <div className="grid gap-3 sm:grid-cols-3">
                  <Input
                    value={communicationDraft.recipient}
                    onChange={(event) => setCommunicationDraft((prev) => ({ ...prev, recipient: event.target.value }))}
                    placeholder="Destinatario"
                    className="border-white/10 bg-zinc-950"
                  />
                  <Input
                    value={communicationDraft.channel}
                    onChange={(event) => setCommunicationDraft((prev) => ({ ...prev, channel: event.target.value }))}
                    placeholder="Canal"
                    className="border-white/10 bg-zinc-950"
                  />
                  <Input
                    value={communicationDraft.subject}
                    onChange={(event) => setCommunicationDraft((prev) => ({ ...prev, subject: event.target.value }))}
                    placeholder="Asunto"
                    className="border-white/10 bg-zinc-950"
                  />
                </div>
                <Textarea
                  value={communicationDraft.message}
                  onChange={(event) => setCommunicationDraft((prev) => ({ ...prev, message: event.target.value }))}
                  placeholder="Mensaje propuesto"
                  className="min-h-24 border-white/10 bg-zinc-950"
                />
                <Input
                  value={communicationDraft.context}
                  onChange={(event) => setCommunicationDraft((prev) => ({ ...prev, context: event.target.value }))}
                  placeholder="Contexto interno"
                  className="border-white/10 bg-zinc-950"
                />
                <Button type="submit" disabled={!canCreateCommunicationDraft || createCommunicationDraft.isPending} className="bg-cyan-600 hover:bg-cyan-700">
                  Crear borrador para aprobación
                </Button>
              </form>
            </CommandCard>
          </>
        )}
      </main>
    </div>
  );
}
