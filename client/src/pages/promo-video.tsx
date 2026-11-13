import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Clapperboard, Copy, ExternalLink, FileVideo, Folder, FolderInput, HardDrive, Loader2, Play, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

type PromoVideoStyle = "full" | "post";
type PromoVideoObjective = "auto" | "nightlife" | "dinner" | "pool" | "yacht" | "guestlist";
type PromoVideoFontStyle = "bold" | "clean" | "luxury" | "impact" | "neon";

interface PromoTemplate {
  id: PromoVideoObjective;
  label: string;
  hook: string;
  cta: string;
}

interface PromoVideoFile {
  name: string;
  path: string;
  sizeMb: number;
  modifiedAt: string;
}

interface PromoVideoStatus {
  rootDir: string;
  inputDir: string;
  outputDir: string;
  reportDir: string;
  sourceDir: string | null;
  inputVideos: PromoVideoFile[];
  outputVideos: PromoVideoFile[];
  sourceVideos: PromoVideoFile[];
  templates: PromoTemplate[];
}

interface PromoVideoRunResult {
  ok: boolean;
  output: string;
  reportPath: string;
  status: PromoVideoStatus;
  driveUploads?: Array<{
    fileName: string;
    category: string;
    dateFolder: string;
    webViewLink: string | null;
  }>;
}

interface GoogleDriveStatus {
  configured: boolean;
  connected: boolean;
  expiresAt: string | null;
  scope: string | null;
  redirectUri: string | null;
  storageError?: string | null;
}

interface DriveFolderSetupResult {
  rootFolderId: string;
  folders: Array<{
    label: string;
    path: string[];
    folderId: string;
  }>;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function FileList({ title, files, emptyText, onDelete }: { title: string; files: PromoVideoFile[]; emptyText: string; onDelete?: (file: PromoVideoFile) => void }) {
  return (
    <Card className="border-zinc-800 bg-zinc-950/70">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base text-white">
          <FileVideo className="h-4 w-4 text-zinc-300" />
          {title}
          <Badge variant="secondary" className="ml-auto bg-white/10 text-zinc-200">
            {files.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {files.length === 0 ? (
          <p className="text-sm text-zinc-500">{emptyText}</p>
        ) : (
          files.slice(0, 12).map((file) => (
            <div key={file.path} className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-black/40 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-zinc-100">{file.name}</p>
                <p className="text-xs text-zinc-500">{file.sizeMb} MB · {formatDate(file.modifiedAt)}</p>
              </div>
              {onDelete && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onDelete(file)}
                  className="h-8 w-8 shrink-0 text-zinc-500 hover:text-red-300"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

export default function PromoVideoPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [objective, setObjective] = useState<PromoVideoObjective>("auto");
  const [clipsPerVideo, setClipsPerVideo] = useState(5);
  const [maxVideos, setMaxVideos] = useState(0);
  const [targetSeconds, setTargetSeconds] = useState(15);
  const [cuts, setCuts] = useState(3);
  const [style, setStyle] = useState<PromoVideoStyle>("full");
  const [hookText, setHookText] = useState("");
  const [ctaText, setCtaText] = useState("");
  const [fontStyle, setFontStyle] = useState<PromoVideoFontStyle>("bold");
  const [sourceDir, setSourceDir] = useState("");
  const [lastRun, setLastRun] = useState<PromoVideoRunResult | null>(null);

  const { data: status, isLoading } = useQuery<PromoVideoStatus>({
    queryKey: ["/api/promo-video/status"],
  });

  const { data: driveStatus } = useQuery<GoogleDriveStatus>({
    queryKey: ["/api/google-drive/status"],
  });

  const organizeDriveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/google-drive/organize", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No pude acomodar Google Drive");
      return data as DriveFolderSetupResult;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/google-drive/status"] });
      toast({
        title: "Drive acomodado",
        description: `Robert A creado/actualizado con ${data.folders.length} subcarpetas.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "No pude acomodar Drive",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const selectedTemplate = useMemo(() => {
    return status?.templates.find((template) => template.id === objective);
  }, [objective, status?.templates]);

  useEffect(() => {
    if (status?.sourceDir) setSourceDir(status.sourceDir);
  }, [status?.sourceDir]);

  const sourceMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/promo-video/source", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceDir }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No pude leer esa carpeta");
      return data as PromoVideoStatus;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/promo-video/status"], data);
      toast({
        title: "Carpeta conectada",
        description: `${data.sourceVideos.length} videos encontrados.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "No pude conectar esa carpeta",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const importMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/promo-video/import-source", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No pude importar los videos");
      return data as { imported: number; skipped: number; status: PromoVideoStatus };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/promo-video/status"], data.status);
      toast({
        title: "Videos importados",
        description: `${data.imported} nuevos, ${data.skipped} ya estaban.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "No pude importar",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/promo-video/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          objective,
          clipsPerVideo,
          targetSeconds,
          cuts,
          style,
          maxVideos,
          hookText: hookText || undefined,
          ctaText: ctaText || undefined,
          fontStyle,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudieron generar los clips");
      return data as PromoVideoRunResult;
    },
    onSuccess: (data) => {
      setLastRun(data);
      queryClient.invalidateQueries({ queryKey: ["/api/promo-video/status"] });
      toast({
        title: "Clips generados",
        description: `${data.status.outputVideos.length} videos listos en la carpeta final.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "No se generaron los clips",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const autoDailyMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/promo-video/auto-daily", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxVideos: 5, targetSeconds, cuts, style, hookText: hookText || undefined, ctaText: ctaText || undefined, fontStyle }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No pude correr el auto diario");
      return data as PromoVideoRunResult;
    },
    onSuccess: (data) => {
      setLastRun(data);
      queryClient.setQueryData(["/api/promo-video/status"], data.status);
      toast({ title: "Auto diario listo", description: "Genere al menos 5 edits para revisar." });
    },
    onError: (error: Error) => {
      toast({ title: "Auto diario fallo", description: error.message, variant: "destructive" });
    },
  });

  const deleteOutputMutation = useMutation({
    mutationFn: async (file: PromoVideoFile) => {
      const res = await fetch(`/api/promo-video/output/${encodeURIComponent(file.name)}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No pude borrar el clip");
      return data as PromoVideoStatus;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/promo-video/status"], data);
      toast({ title: "Clip borrado", description: "Puedes correr Auto 5 edits para reemplazarlo." });
    },
    onError: (error: Error) => {
      toast({ title: "No pude borrar", description: error.message, variant: "destructive" });
    },
  });

  const copyPath = async (path: string, label: string) => {
    await navigator.clipboard.writeText(path);
    toast({ title: "Ruta copiada", description: label });
  };

  return (
    <div className="min-h-screen bg-zinc-950 px-4 py-6 text-white md:px-8" data-testid="promo-video-page">
      <div className="mx-auto max-w-6xl space-y-5">
        <header className="flex flex-col gap-4 border-b border-white/10 pb-5 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <Link href="/tools">
              <Button variant="ghost" size="icon" data-testid="button-back-tools">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-white/10 bg-black">
              <Clapperboard className="h-5 w-5 text-fuchsia-300" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold">Promo Video Agent</h1>
              <p className="text-sm text-zinc-500">BlackOps local editor</p>
            </div>
          </div>
          <Button
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending || isLoading || !status?.inputVideos.length}
            className="bg-white text-zinc-950 hover:bg-zinc-200"
            data-testid="generate-promo-videos-button"
          >
            {generateMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
            Generar clips
          </Button>
          <Button
            onClick={() => autoDailyMutation.mutate()}
            disabled={autoDailyMutation.isPending || isLoading || !status?.sourceDir}
            className="bg-fuchsia-200 text-zinc-950 hover:bg-fuchsia-100"
            data-testid="auto-daily-promo-videos-button"
          >
            {autoDailyMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            Auto 5 edits
          </Button>
        </header>

        <div className="grid gap-4 lg:grid-cols-[1fr_0.9fr]">
          <Card className="border-zinc-800 bg-zinc-950/70">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base text-white">
                <Sparkles className="h-4 w-4 text-fuchsia-300" />
                Template
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Objetivo</Label>
                <Select value={objective} onValueChange={(value) => setObjective(value as PromoVideoObjective)}>
                  <SelectTrigger className="border-zinc-800 bg-black">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(status?.templates || []).map((template) => (
                      <SelectItem key={template.id} value={template.id}>{template.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Formato</Label>
                <Select value={style} onValueChange={(value) => setStyle(value as PromoVideoStyle)}>
                  <SelectTrigger className="border-zinc-800 bg-black">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="full">Full vertical</SelectItem>
                    <SelectItem value="post">Post centrado</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Hook</Label>
                <Input
                  value={hookText}
                  onChange={(event) => setHookText(event.target.value)}
                  placeholder={selectedTemplate?.hook || "BEST APP TO GO OUT"}
                  className="border-zinc-800 bg-black"
                />
              </div>

              <div className="space-y-2">
                <Label>CTA</Label>
                <Input
                  value={ctaText}
                  onChange={(event) => setCtaText(event.target.value)}
                  placeholder={selectedTemplate?.cta || "JOIN THE GUESTLIST"}
                  className="border-zinc-800 bg-black"
                />
              </div>

              <div className="space-y-2">
                <Label>Typo</Label>
                <Select value={fontStyle} onValueChange={(value) => setFontStyle(value as PromoVideoFontStyle)}>
                  <SelectTrigger className="border-zinc-800 bg-black">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bold">Bold</SelectItem>
                    <SelectItem value="clean">Clean</SelectItem>
                    <SelectItem value="luxury">Luxury</SelectItem>
                    <SelectItem value="impact">Impact</SelectItem>
                    <SelectItem value="neon">Neon</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Clips por video</Label>
                <Input
                  type="number"
                  min={1}
                  max={30}
                  value={clipsPerVideo}
                  onChange={(event) => setClipsPerVideo(Number(event.target.value))}
                  className="border-zinc-800 bg-black"
                />
              </div>

              <div className="space-y-2">
                <Label>Segundos</Label>
                <Input
                  type="number"
                  min={6}
                  max={90}
                  value={targetSeconds}
                  onChange={(event) => setTargetSeconds(Number(event.target.value))}
                  className="border-zinc-800 bg-black"
                />
              </div>

              <div className="space-y-2">
                <Label>Cortes internos</Label>
                <Input
                  type="number"
                  min={1}
                  max={12}
                  value={cuts}
                  onChange={(event) => setCuts(Number(event.target.value))}
                  className="border-zinc-800 bg-black"
                />
              </div>

              <div className="space-y-2">
                <Label>Limite videos</Label>
                <Input
                  type="number"
                  min={0}
                  max={5000}
                  value={maxVideos}
                  onChange={(event) => setMaxVideos(Number(event.target.value))}
                  className="border-zinc-800 bg-black"
                />
              </div>
            </CardContent>
          </Card>

          <Card className="border-zinc-800 bg-zinc-950/70">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base text-white">
                <HardDrive className={driveStatus?.connected ? "h-4 w-4 text-green-300" : "h-4 w-4 text-yellow-300"} />
                Google Drive
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-md border border-white/10 bg-black/40 p-3">
                <p className="text-sm font-medium text-zinc-100">
                  {driveStatus?.connected ? "Conectado" : "Pendiente de conectar"}
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  Los clips finales se suben a Robert A / Videos de Kong con subcarpetas por categoria y fecha.
                </p>
                {driveStatus?.storageError && (
                  <p className="mt-2 text-xs text-yellow-200">Drive necesita DB local o refresh token en env para guardar OAuth.</p>
                )}
                {!driveStatus?.connected && driveStatus?.configured && (
                  <Button
                    type="button"
                    onClick={() => { window.location.href = "/api/google-drive/auth"; }}
                    className="mt-3 h-9 rounded-full bg-white text-zinc-950 hover:bg-zinc-200"
                  >
                    <HardDrive className="mr-2 h-4 w-4" />
                    Conectar Drive
                  </Button>
                )}
                {driveStatus?.connected && (
                  <Button
                    type="button"
                    onClick={() => organizeDriveMutation.mutate()}
                    disabled={organizeDriveMutation.isPending}
                    className="mt-3 h-9 rounded-full bg-cyan-200 text-zinc-950 hover:bg-cyan-100"
                  >
                    {organizeDriveMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Folder className="mr-2 h-4 w-4" />}
                    Acomodar Drive
                  </Button>
                )}
              </div>

              {[
                ["Cache originales", status?.inputDir],
                ["Cache local", status?.outputDir],
                ["Reportes", status?.reportDir],
              ].map(([label, path]) => (
                <div key={label} className="rounded-md border border-white/10 bg-black/40 p-3">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-zinc-100">{label}</p>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={!path}
                      onClick={() => path && copyPath(path, label || "")}
                      className="h-8 w-8 text-zinc-400 hover:text-white"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="break-all text-xs text-zinc-500">{path || "..."}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <Card className="border-zinc-800 bg-zinc-950/70">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-white">
              <FolderInput className="h-4 w-4 text-fuchsia-300" />
              Carpeta de la PC
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 lg:grid-cols-[1fr_auto_auto]">
            <div className="space-y-2">
              <Label>Ruta origen</Label>
              <Input
                value={sourceDir}
                onChange={(event) => setSourceDir(event.target.value)}
                placeholder="~/Movies/promos"
                className="border-zinc-800 bg-black"
                data-testid="promo-video-source-input"
              />
            </div>
            <div className="flex items-end">
              <Button
                variant="outline"
                onClick={() => sourceMutation.mutate()}
                disabled={sourceMutation.isPending || !sourceDir.trim()}
                className="w-full border-zinc-800"
                data-testid="promo-video-source-button"
              >
                {sourceMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                Escanear
              </Button>
            </div>
            <div className="flex items-end">
              <Button
                onClick={() => importMutation.mutate()}
                disabled={importMutation.isPending || !status?.sourceVideos.length}
                className="w-full bg-fuchsia-200 text-zinc-950 hover:bg-fuchsia-100"
                data-testid="promo-video-import-button"
              >
                {importMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FolderInput className="mr-2 h-4 w-4" />}
                Importar
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-3">
          <FileList
            title="PC origen"
            files={status?.sourceVideos || []}
            emptyText="Sin carpeta conectada."
          />
          <FileList
            title="Originales"
            files={status?.inputVideos || []}
            emptyText="Sin videos crudos todavia."
          />
          <FileList
            title="Cache local"
            files={status?.outputVideos || []}
            emptyText="Aun no hay clips exportados."
            onDelete={(file) => deleteOutputMutation.mutate(file)}
          />
        </div>

        {lastRun && (
          <Card className="border-zinc-800 bg-zinc-950/70">
            <CardHeader>
              <CardTitle className="text-base text-white">Ultima corrida</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="break-all text-xs text-zinc-500">{lastRun.reportPath}</p>
              {!!lastRun.driveUploads?.length && (
                <div className="space-y-2 rounded-md border border-green-300/20 bg-green-950/10 p-3">
                  <p className="text-sm font-medium text-green-100">Subidos a Google Drive</p>
                  {lastRun.driveUploads.map((upload) => (
                    <a
                      key={`${upload.fileName}-${upload.webViewLink}`}
                      href={upload.webViewLink || "#"}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-black/35 px-3 py-2 text-xs text-zinc-200 hover:bg-white/5"
                    >
                      <span className="min-w-0 truncate">{upload.category}/{upload.dateFolder}/{upload.fileName}</span>
                      <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                    </a>
                  ))}
                </div>
              )}
              <pre className="max-h-56 overflow-auto rounded-md border border-white/10 bg-black p-3 text-xs text-zinc-300">
                {lastRun.output}
              </pre>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
