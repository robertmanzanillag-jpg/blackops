import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, ChevronLeft, ChevronRight, ExternalLink, Users, X, ZoomIn, ZoomOut } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type Verdict = "pass" | "warn" | "fail" | "skip";
type Scalar = string | number | boolean | null;
export type MirrorCardView = {
  key: string; repo: string; prNumber: number; prUrl: string; artifactUrl: string | null; title: string; headSha: string; baseSha: string;
  overall: "pass" | "warn" | "fail"; approvable: boolean; warn: boolean; dataSource: "production-copy" | "sample"; generatedAt: string; statusLabel: string;
  whatChanges: string[];
  whyDoIt: { narrative: string; source: "ai" | "deterministic"; reason: string | null; arguments: string[] };
  agents: Array<{ id: string; name: string; verdict: Verdict; verdictLabel: string; summary: string; details: string[]; devilsAdvocate: boolean }>;
  metrics: Array<{ name: string; before: Scalar; after: Scalar; unit?: string; better?: "higher" | "lower" }>;
  otherMetrics: Array<{ name: string; value: Scalar }>;
  risks: { devilsAdvocate: { name: string; verdict: Verdict; summary: string; details: string[] } | null; items: string[] };
  improveLater: string[]; failReasons: string[];
  images: Array<{ id: string; key: string; url: string; page: string; viewport: string; kind: "before" | "after" | "diff"; caption: string }>;
  videos: Array<{ url: string; caption: string }>;
};
type ChangeRequest = { id: string; text: string; at: string; state: "posting" | "posted" | "failed"; commentUrl?: string | null };
type MirrorReportRow = {
  key: string; status: "received" | "carded" | "merging" | "merged" | "rejected" | "changes_requested" | "superseded"; pendingStatus: string | null; approvable: boolean; overall: string;
  prNumber: number; headSha: string; mergeSha?: string | null; lastRefusal?: { at: string; code: string; message: string }; rejectNote?: string; card: MirrorCardView | null;
  supersedes?: string; supersededBy?: string; changeRequests?: ChangeRequest[]; history?: Array<{ at: string; event: string; note: string }>;
};
type AiBudget = { spentUsd: number; capUsd: number; remainingUsd: number; calls: number };
type MirrorBudget = { label: string; pausedLabel: string | null; paused: boolean; perRunUsd: number; budgetUsd: number; spentUsd: number };
type ScoutProposal = { key: string; title: string; problem: string; status: string; kind: "code" | "decision"; risk: string; neverAutoArea: string | null; issueUrl: string | null; prNumber: number | null; pausedByBudget?: boolean };
type ScoutsView = { enabled: boolean; lastRunAt: string | null; lastError: string | null; counts: { open: number; building: number; testing: number; ready: number; decisions: number; proposed: number; merged: number }; proposals: ScoutProposal[] };
type ReportsResponse = { reports: MirrorReportRow[]; pendingCount: number; aiBudget?: AiBudget | null; mirrorBudget?: MirrorBudget | null; scouts?: ScoutsView | null;
  academy?: Array<{ id: string; title: string; detail: string; evaluatedAt: string }> };
type ChatMessage = { role: "user" | "assistant"; text: string; at: string; citations: string[]; source?: string; costUsd?: number; changeSuggestion?: { text: string } };
type ChatResult = { ok: boolean; reply: ChatMessage; thread: ChatMessage[]; fallbackSections?: Array<{ title: string; lines: string[] }> };
type DecisionResult = { ok: boolean; message?: string; steps?: string[]; code?: string; commentPosted?: boolean };

const VERDICT_STYLE: Record<Verdict, string> = {
  pass: "border-emerald-400/40 bg-emerald-400/10 text-emerald-200",
  warn: "border-amber-400/50 bg-amber-400/10 text-amber-200",
  fail: "border-rose-400/50 bg-rose-400/10 text-rose-200",
  skip: "border-zinc-500/40 bg-zinc-500/10 text-zinc-300",
};
const KIND_LABEL = { before: "Antes", after: "Después", diff: "Diferencia" } as const;

export function useKongMirrorReports(enabled = true) {
  return useQuery<ReportsResponse>({
    queryKey: ["kong-mirror-reports"],
    enabled,
    refetchInterval: 60_000,
    queryFn: async () => {
      const response = await fetch("/api/kong-mirror/reports", { credentials: "same-origin" });
      if (!response.ok) throw new Error("No se pudieron leer las mejoras del Mirror Lab");
      return response.json();
    },
  });
}

async function decide(key: string, decision: "approve" | "reject", body: Record<string, unknown>): Promise<DecisionResult> {
  const response = await fetch(`/api/kong-mirror/${encodeURIComponent(key)}/${decision}`, {
    method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({})) as DecisionResult;
  if (!response.ok) throw new Error(data.message || "No se pudo completar la decisión. No se fusionó nada.");
  return data;
}

function show(value: Scalar) { return value === null || value === undefined ? "-" : String(value); }

/** Full-size viewer with carousel and zoom. */
function ImageViewer({ images, index, onIndex, onClose }: { images: MirrorCardView["images"]; index: number; onIndex: (next: number) => void; onClose: () => void }) {
  const [zoom, setZoom] = useState(1);
  const image = images[index];
  useEffect(() => { setZoom(1); }, [index]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") onIndex((index + 1) % images.length);
      if (event.key === "ArrowLeft") onIndex((index - 1 + images.length) % images.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, images.length, onIndex]);
  if (!image) return null;
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[96vh] max-w-[96vw] overflow-hidden p-3 sm:max-w-[96vw]" data-testid="kong-mirror-image-viewer">
        <DialogHeader>
          <DialogTitle className="text-sm">{KIND_LABEL[image.kind]} · {image.page} · {image.viewport}</DialogTitle>
          <DialogDescription>{image.caption || "Captura del Mirror Lab"} · {index + 1} de {images.length}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => onIndex((index - 1 + images.length) % images.length)} aria-label="Foto anterior"><ChevronLeft className="h-4 w-4" /></Button>
          <Button size="sm" variant="outline" onClick={() => onIndex((index + 1) % images.length)} aria-label="Foto siguiente"><ChevronRight className="h-4 w-4" /></Button>
          <Button size="sm" variant="outline" onClick={() => setZoom((value) => Math.max(1, value - 0.5))} aria-label="Alejar"><ZoomOut className="h-4 w-4" /></Button>
          <span className="text-xs tabular-nums">{Math.round(zoom * 100)}%</span>
          <Button size="sm" variant="outline" onClick={() => setZoom((value) => Math.min(4, value + 0.5))} aria-label="Acercar"><ZoomIn className="h-4 w-4" /></Button>
          <a href={image.url} target="_blank" rel="noreferrer" className="ml-auto text-xs underline">Abrir original</a>
        </div>
        <div className="max-h-[72vh] overflow-auto rounded border border-white/10 bg-black">
          <img src={image.url} alt={`${KIND_LABEL[image.kind]} ${image.page}`} onClick={() => setZoom((value) => (value >= 3 ? 1 : value + 1))}
            style={{ width: `${zoom * 100}%`, maxWidth: "none", cursor: zoom >= 3 ? "zoom-out" : "zoom-in" }} className="block h-auto" />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children, testId }: { title: string; children: ReactNode; testId?: string }) {
  return <section className="space-y-2" data-testid={testId}><h3 className="text-sm font-semibold">{title}</h3>{children}</section>;
}

export function KongMirrorCard({ row }: { row: MirrorReportRow }) {
  const queryClient = useQueryClient();
  const card = row.card;
  const [viewer, setViewer] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState("");
  const [result, setResult] = useState<DecisionResult | null>(null);
  const mutation = useMutation({
    mutationFn: ({ decision, body }: { decision: "approve" | "reject"; body: Record<string, unknown> }) => decide(row.key, decision, body),
    onSuccess: (data) => { setResult(data); setConfirming(false); },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["kong-mirror-reports"] });
      queryClient.invalidateQueries({ queryKey: ["pending-actions"] });
    },
  });
  if (!card) return <p className="text-sm text-muted-foreground">Reporte recibido; preparando la tarjeta…</p>;
  const open = row.status === "carded" && ["pending", "edited", "snoozed"].includes(row.pendingStatus || "");
  const waitingChanges = row.status === "changes_requested";
  const groups = (["before", "after", "diff"] as const).map((kind) => ({ kind, items: card.images.map((image, index) => ({ image, index })).filter(({ image }) => image.kind === kind) }));
  return (
    <article className="space-y-4 rounded-xl border border-white/10 bg-black/30 p-4 text-sm" data-testid="kong-mirror-card">
      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold">{card.title}</h2>
          <span className={`rounded-full border px-2 py-0.5 text-xs ${VERDICT_STYLE[card.overall]}`} data-testid="kong-mirror-status">{card.statusLabel}</span>
          {card.dataSource === "sample" && <span className="rounded-full border border-zinc-500/40 px-2 py-0.5 text-xs">datos de ejemplo</span>}
        </div>
        <p className="text-xs text-muted-foreground">{card.repo} · PR #{card.prNumber} · probado en {card.headSha.slice(0, 7)} · {new Date(card.generatedAt).toLocaleString("es")}</p>
        {card.warn && <p role="alert" className="flex items-center gap-2 rounded border border-amber-400/50 p-2 text-amber-200"><AlertTriangle className="h-4 w-4" />Pasó con AVISOS. Lee los riesgos antes de aprobar.</p>}
      </header>

      {card.failReasons.length > 0 && (
        <Section title="Por qué falló (no se puede aprobar)" testId="kong-mirror-fail">
          <ul className="list-disc space-y-1 pl-5 text-rose-200">{card.failReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
        </Section>
      )}

      <Section title="Qué cambia"><ul className="list-disc space-y-1 pl-5">{card.whatChanges.map((line) => <li key={line}>{line}</li>)}</ul></Section>

      <Section title="Por qué deberíamos hacerlo" testId="kong-mirror-why">
        <p>{card.whyDoIt.narrative}</p>
        <p className="text-[11px] text-muted-foreground">{card.whyDoIt.source === "ai" ? "Resumen IA barato (solo texto del reporte)" : `Resumen del equipo sin IA${card.whyDoIt.reason ? ` · ${card.whyDoIt.reason}` : ""}`}</p>
        {card.whyDoIt.arguments.length > 0 && <ul className="list-disc space-y-1 pl-5 text-muted-foreground">{card.whyDoIt.arguments.map((line) => <li key={line}>{line}</li>)}</ul>}
      </Section>

      <Section title="El equipo de pruebas" testId="kong-mirror-agents">
        <ul className="grid gap-2 md:grid-cols-2">
          {card.agents.map((agent) => (
            <li key={agent.id} className="rounded-lg border border-white/10 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-1 font-medium"><Users className="h-3.5 w-3.5" />{agent.name}{agent.devilsAdvocate && !/diablo/i.test(agent.name) ? " · abogado del diablo" : ""}</p>
                <span className={`rounded-full border px-2 py-0.5 text-[11px] ${VERDICT_STYLE[agent.verdict]}`}>{agent.verdictLabel}</span>
              </div>
              <p className="mt-1">{agent.summary}</p>
              {agent.details.length > 0 && <details className="mt-1 text-xs text-muted-foreground"><summary>Detalles ({agent.details.length})</summary><ul className="list-disc pl-4">{agent.details.map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}</ul></details>}
            </li>
          ))}
        </ul>
      </Section>

      {card.images.length > 0 && (
        <Section title="Cómo se vería (fotos)" testId="kong-mirror-images">
          {groups.filter((group) => group.items.length).map((group) => (
            <div key={group.kind}>
              <p className="mb-1 text-xs font-medium text-muted-foreground">{KIND_LABEL[group.kind]}</p>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {group.items.map(({ image, index }) => (
                  <button key={image.key} type="button" onClick={() => setViewer(index)} className="shrink-0 rounded border border-white/10 text-left focus-visible:outline focus-visible:outline-2" aria-label={`Ver ${KIND_LABEL[image.kind]} ${image.page} en grande`}>
                    <img src={image.url} alt="" loading="lazy" className="h-28 w-auto max-w-[220px] rounded-t object-cover object-top" />
                    <span className="block max-w-[220px] truncate px-1 py-0.5 text-[11px]">{image.page} · {image.viewport}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
          {viewer !== null && <ImageViewer images={card.images} index={viewer} onIndex={setViewer} onClose={() => setViewer(null)} />}
        </Section>
      )}

      {(card.metrics.length > 0 || card.otherMetrics.length > 0) && (
        <Section title="Métricas antes vs después" testId="kong-mirror-metrics">
          {card.metrics.length > 0 && (
            <table className="w-full text-xs"><thead><tr className="text-left text-muted-foreground"><th className="py-1">Métrica</th><th>Antes</th><th>Después</th></tr></thead>
              <tbody>{card.metrics.map((metric) => <tr key={metric.name} className="border-t border-white/5"><td className="py-1">{metric.name}</td><td>{show(metric.before)}{metric.unit ? ` ${metric.unit}` : ""}</td><td className="font-medium">{show(metric.after)}{metric.unit ? ` ${metric.unit}` : ""}</td></tr>)}</tbody>
            </table>
          )}
          {card.otherMetrics.length > 0 && <p className="text-xs text-muted-foreground">{card.otherMetrics.map((metric) => `${metric.name}: ${show(metric.value)}`).join(" · ")}</p>}
        </Section>
      )}

      <Section title="Riesgos (abogado del diablo)" testId="kong-mirror-risks">
        {card.risks.devilsAdvocate ? (
          <div className="rounded border border-amber-400/30 p-2"><p className="font-medium">{card.risks.devilsAdvocate.name}</p><p>{card.risks.devilsAdvocate.summary}</p>
            {card.risks.devilsAdvocate.details.length > 0 && <ul className="list-disc pl-5 text-xs">{card.risks.devilsAdvocate.details.map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}</ul>}</div>
        ) : <p className="text-muted-foreground">El reporte no trae abogado del diablo.</p>}
        {card.risks.items.length > 0 && <ul className="list-disc pl-5 text-xs">{card.risks.items.map((line) => <li key={line}>{line}</li>)}</ul>}
      </Section>

      <Section title="Qué se podría mejorar después"><ul className="list-disc space-y-1 pl-5">{card.improveLater.map((line) => <li key={line}>{line}</li>)}</ul></Section>

      <div className="flex flex-wrap gap-3 text-xs">
        <a href={card.prUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">Ver PR #{card.prNumber}<ExternalLink className="h-3 w-3" /></a>
        {card.artifactUrl && <a href={card.artifactUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">Artefacto del laboratorio<ExternalLink className="h-3 w-3" /></a>}
        {card.videos.map((video, index) => <a key={video.url} href={video.url} target="_blank" rel="noreferrer" className="underline">Video {index + 1}{video.caption ? `: ${video.caption}` : ""}</a>)}
      </div>

      {row.lastRefusal && open && <p role="alert" className="rounded border border-rose-400/40 p-2 text-rose-200">Último intento rechazado: {row.lastRefusal.message}</p>}
      {row.status === "merged" && <p className="rounded border border-emerald-400/40 p-2 text-emerald-200">Merge hecho{row.mergeSha ? ` (${row.mergeSha.slice(0, 7)})` : ""}: falta republicar KONG en Replit.</p>}
      {row.status === "rejected" && <p className="text-muted-foreground">Rechazada{row.rejectNote ? `: ${row.rejectNote}` : "."}</p>}
      {waitingChanges && <div role="status" className="rounded border border-sky-400/40 p-2 text-sky-100" data-testid="kong-mirror-changes-requested">
        <p className="font-semibold">Cambios pedidos: aprobar queda desactivado hasta que llegue el nuevo reporte del Mirror Lab.</p>
        <ul className="list-disc pl-5 text-xs">{(row.changeRequests || []).filter((request) => request.state === "posted").map((request) => <li key={request.id}>{request.text}{request.commentUrl ? <> · <a className="underline" href={request.commentUrl} target="_blank" rel="noreferrer">ver en el PR</a></> : null}</li>)}</ul>
      </div>}
      {row.status === "superseded" && <p className="text-muted-foreground" data-testid="kong-mirror-superseded">Reemplazada por un reporte más nuevo del PR #{row.prNumber}. Se guarda como historial.</p>}
      {row.supersedes && <p className="text-xs text-muted-foreground">Esta tarjeta reemplaza a una versión anterior del mismo PR (ver historial abajo).</p>}
      {(row.history || []).length > 0 && <details className="text-xs text-muted-foreground"><summary>Historial de decisiones ({row.history!.length})</summary>
        <ul className="pl-4">{row.history!.map((item, index) => <li key={`${index}-${item.at}`}>{new Date(item.at).toLocaleString("es")} · {item.event}: {item.note}</li>)}</ul></details>}
      {row.status !== "superseded" && row.status !== "rejected" && <MirrorChat row={row} />}

      {result?.ok && result.steps && (
        <div className="space-y-1 rounded border border-emerald-400/40 p-3" data-testid="kong-mirror-merged"><p className="font-semibold text-emerald-200">{result.message}</p>
          <ol className="space-y-1 text-xs">{result.steps.map((step) => <li key={step}>{step}</li>)}</ol></div>
      )}
      {result?.ok && result.commentPosted !== undefined && <p className="text-xs text-muted-foreground">Rechazada.{result.commentPosted ? " Tu nota se publicó en el PR." : ""}</p>}
      {mutation.isError && <p role="alert" className="flex items-center gap-2 text-amber-300"><AlertTriangle className="h-4 w-4" />{(mutation.error as Error).message}</p>}

      {(open || waitingChanges) && (
        <div className="space-y-2 border-t border-white/10 pt-3">
          {card.approvable && waitingChanges && <Button size="sm" disabled title="Esperando el nuevo reporte del Mirror Lab"><Check className="mr-1 h-3.5 w-3.5" />Aprobar (esperando nuevo reporte)</Button>}
          {card.approvable && !waitingChanges && (confirming ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs">Se volverá a comprobar el SHA y los checks; si todo está igual, se fusiona el PR #{card.prNumber}.</span>
              <Button size="sm" disabled={mutation.isPending} onClick={() => mutation.mutate({ decision: "approve", body: { confirm: true, headSha: card.headSha } })} data-testid="kong-mirror-confirm"><Check className="mr-1 h-3.5 w-3.5" />Confirmar merge</Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>Cancelar</Button>
            </div>
          ) : (
            <Button size="sm" onClick={() => setConfirming(true)} data-testid="kong-mirror-approve"><Check className="mr-1 h-3.5 w-3.5" />Aprobar y fusionar</Button>
          ))}
          <Textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} placeholder="Nota opcional (se publica en el PR si rechazas)" className="min-h-[60px] text-xs" />
          <Button size="sm" variant="outline" disabled={mutation.isPending} onClick={() => mutation.mutate({ decision: "reject", body: { note } })} data-testid="kong-mirror-reject"><X className="mr-1 h-3.5 w-3.5" />{card.approvable ? "Rechazar" : "Archivar"}</Button>
        </div>
      )}
    </article>
  );
}

function newIdempotencyKey() {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `cambio-${random}`.replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, 90);
}

/** Per-card chat: grounded answers with citations, honest budget messages and "Pedir este cambio". */
function MirrorChat({ row }: { row: MirrorReportRow }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [fallback, setFallback] = useState<ChatResult["fallbackSections"]>();
  const [proposal, setProposal] = useState<{ text: string; key: string } | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const thread = useQuery<{ thread: ChatMessage[] }>({
    queryKey: ["kong-mirror-chat", row.key], enabled: open,
    queryFn: async () => { const response = await fetch(`/api/kong-mirror/${encodeURIComponent(row.key)}/chat`, { credentials: "same-origin" }); if (!response.ok) throw new Error("No se pudo leer el chat"); return response.json(); },
  });
  const ask = useMutation({
    mutationFn: async (text: string) => {
      const response = await fetch(`/api/kong-mirror/${encodeURIComponent(row.key)}/chat`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: text }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "No se pudo enviar la pregunta");
      return data as ChatResult;
    },
    onSuccess: (data) => {
      setMessage(""); setFallback(data.fallbackSections);
      if (data.reply.changeSuggestion) setProposal({ text: data.reply.changeSuggestion.text, key: newIdempotencyKey() });
      queryClient.setQueryData(["kong-mirror-chat", row.key], { thread: data.thread });
    },
  });
  const change = useMutation({
    mutationFn: async (input: { text: string; key: string }) => {
      const response = await fetch(`/api/kong-mirror/${encodeURIComponent(row.key)}/change-request`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: input.text, idempotencyKey: input.key }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "No se pudo pedir el cambio");
      return data as { warning?: string | null };
    },
    onSuccess: (data) => { setProposal(null); setWarning(data.warning || null); queryClient.invalidateQueries({ queryKey: ["kong-mirror-reports"] }); },
  });
  const messages = thread.data?.thread || [];
  return (
    <div className="rounded-lg border border-white/10 p-3" data-testid="kong-mirror-chat">
      <button type="button" className="text-sm font-semibold underline-offset-2 hover:underline" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        {open ? "Ocultar chat" : "Preguntar al equipo sobre esta mejora"}
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <ul className="max-h-72 space-y-2 overflow-y-auto text-xs">
            {messages.length === 0 && <li className="text-muted-foreground">Pregunta lo que quieras: por qué, qué archivos cambia, qué riesgos vio el equipo… Si pides otro cambio, te ofreceré «Pedir este cambio».</li>}
            {messages.map((item, index) => (
              <li key={`${index}-${item.at}`} className={item.role === "user" ? "ml-8 rounded bg-sky-900/40 p-2" : "mr-8 rounded bg-white/5 p-2"}>
                <p className="whitespace-pre-wrap">{item.text}</p>
                {item.citations.length > 0 && <p className="mt-1 text-[11px] text-muted-foreground">Fuentes: {item.citations.join(" · ")}</p>}
              </li>
            ))}
          </ul>
          {fallback && fallback.length > 0 && (
            <div className="rounded border border-amber-400/30 p-2 text-xs" data-testid="kong-mirror-chat-fallback">
              {fallback.map((section) => <div key={section.title}><p className="font-semibold">{section.title}</p><ul className="list-disc pl-4">{section.lines.map((line) => <li key={line}>{line}</li>)}</ul></div>)}
            </div>
          )}
          {proposal && (
            <div className="space-y-2 rounded border border-lime-300/40 p-2" data-testid="kong-mirror-change-box">
              <p className="text-xs font-semibold">Pedir este cambio</p>
              <p className="text-[11px] text-muted-foreground">Se publicará un comentario @codex en el PR #{row.prNumber} con tus palabras. El laboratorio volverá a probarlo.</p>
              <Textarea value={proposal.text} maxLength={1500} onChange={(event) => setProposal({ ...proposal, text: event.target.value })} className="min-h-[60px] text-xs" />
              <div className="flex gap-2">
                <Button size="sm" disabled={change.isPending || proposal.text.trim().length < 3} onClick={() => change.mutate(proposal)} data-testid="kong-mirror-change-confirm">Pedir este cambio</Button>
                <Button size="sm" variant="ghost" onClick={() => setProposal(null)}>Cancelar</Button>
              </div>
            </div>
          )}
          {warning && <p role="status" className="text-xs text-amber-200">{warning}</p>}
          {(ask.isError || change.isError) && <p role="alert" className="text-xs text-rose-300">{((ask.error || change.error) as Error).message}</p>}
          <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); if (message.trim().length >= 2) ask.mutate(message.trim()); }}>
            <Textarea value={message} maxLength={1000} onChange={(event) => setMessage(event.target.value)} placeholder="Ej.: ¿qué archivos cambia? · hazlo azul" className="min-h-[40px] text-xs" aria-label="Pregunta para el equipo" />
            <Button size="sm" type="submit" disabled={ask.isPending}>{ask.isPending ? "…" : "Enviar"}</Button>
          </form>
        </div>
      )}
    </div>
  );
}

const SCOUT_STATUS: Record<string, string> = { decision: "Requiere decisión de Robert", proposed: "Propuesta (sin issue todavía)", building: "En construcción (Codex)", testing: "En pruebas (Mirror Lab)", ready: "Lista para aprobar", merged: "Hecha", closed: "Cerrada" };
function ScoutsSummary({ data }: { data: ReportsResponse }) {
  const scouts = data.scouts, mirror = data.mirrorBudget, ai = data.aiBudget;
  return (
    <section className="space-y-2 rounded-xl border border-white/10 p-3 text-xs" data-testid="kong-mirror-scouts">
      <div className="flex flex-wrap gap-3">
        {ai && <span data-testid="kong-mirror-ai-budget">IA del mes: ${ai.spentUsd.toFixed(2)} de ${ai.capUsd}</span>}
        {mirror && <span data-testid="kong-mirror-run-budget">{mirror.label}</span>}
        {mirror?.pausedLabel && <span className="text-amber-200" data-testid="kong-mirror-run-paused">{mirror.pausedLabel}</span>}
      </div>
      {scouts && (
        <>
          <p className="font-semibold">Buscando mejoras{scouts.enabled ? "" : " (apagado: KONG_IMPROVEMENT_SCOUTS_ENABLED)"}</p>
          <p>Última búsqueda: {scouts.lastRunAt ? new Date(scouts.lastRunAt).toLocaleString("es") : "todavía no"} · propuestas abiertas {scouts.counts.open} · en construcción {scouts.counts.building} · en pruebas {scouts.counts.testing} · listas para aprobar {scouts.counts.ready}{scouts.counts.decisions ? ` · requieren tu decisión ${scouts.counts.decisions}` : ""}</p>
          {scouts.lastError && <p className="text-rose-300">{scouts.lastError}</p>}
          {scouts.proposals.length > 0 && <details><summary>Ver propuestas ({scouts.proposals.length})</summary>
            <ul className="space-y-1 pl-2">{scouts.proposals.map((item) => <li key={item.key}><span className="font-medium">{item.title}</span> · {SCOUT_STATUS[item.status] || item.status}{item.pausedByBudget ? " · en pausa por presupuesto" : ""} · riesgo {item.risk}{item.issueUrl ? <> · <a className="underline" href={item.issueUrl} target="_blank" rel="noreferrer">issue</a></> : null}<br /><span className="text-muted-foreground">{item.problem}</span></li>)}</ul></details>}
        </>
      )}
      {(data.academy || []).length > 0 && <details><summary>Skills aprendidas en la Academia ({data.academy!.length})</summary><ul className="pl-2">{data.academy!.map((lesson) => <li key={lesson.id}>{lesson.title}: {lesson.detail}</li>)}</ul></details>}
    </section>
  );
}

/** Agents office notification: one button with the count of improvements waiting for Robert. */
export function KongMirrorPanel({ reportKey, triggerLabel }: { reportKey?: string; triggerLabel?: string }) {
  const [open, setOpen] = useState(false);
  const query = useKongMirrorReports(true);
  const rows = (query.data?.reports || []).filter((row) => !reportKey || row.key === reportKey);
  const pending = query.data?.pendingCount || 0;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size={reportKey ? "sm" : "default"} data-testid="button-kong-mirror">
          {triggerLabel || <>Mejoras KONG{pending > 0 && <span className="ml-1 rounded-full bg-lime-300 px-1.5 text-[11px] font-bold text-slate-950" data-testid="kong-mirror-badge">{pending}</span>}</>}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl" data-testid="kong-mirror-dialog">
        <DialogHeader>
          <DialogTitle>Mejoras KONG del Mirror Lab</DialogTitle>
          <DialogDescription>Un equipo de agentes probó cada cambio en una copia de KONG. Si apruebas, se fusiona el PR (sin desplegar); republicar en Replit lo haces tú.</DialogDescription>
        </DialogHeader>
        {query.isError && <p role="alert" className="text-sm text-rose-400">No se pudieron leer las mejoras.</p>}
        {query.isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}
        {!query.isLoading && rows.length === 0 && <p className="text-sm text-muted-foreground">Todavía no hay reportes del laboratorio.</p>}
        {!reportKey && query.data && <ScoutsSummary data={query.data} />}
        <div className="space-y-4">{rows.map((row) => <KongMirrorCard key={row.key} row={row} />)}</div>
      </DialogContent>
    </Dialog>
  );
}
