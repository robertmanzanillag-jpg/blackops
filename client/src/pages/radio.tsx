import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Radio, Users, AlertCircle, MessageSquare, Copy, Check, Plus, Trash2, RefreshCw, Send, FolderDown, HardDrive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { FlyerGenerator } from "@/components/flyer-generator";

interface RadioSlot {
  eventId: string;
  date: string;
  dateStr: string;
  slot7: string | null;
  slot8: string | null;
  slot9: string | null;
  emptySlots: number[];
}

interface DjContact {
  id: string;
  name: string;
  instagramHandle: string | null;
  email: string | null;
  genre: string | null;
  location: string | null;
  rating: number | null;
  status: string;
  driveLink: string | null;
}

interface RadioTemplateAsset {
  id: string;
  eventId: string;
  slotHour: number;
  djName: string;
  canvaEditUrl: string | null;
  canvaViewUrl: string | null;
  driveLink: string | null;
  status: "pending" | "generated" | "failed";
  errorMessage: string | null;
  lastGeneratedAt: string | null;
}

interface GoogleDriveStatus {
  configured: boolean;
  connected: boolean;
  scope: string | null;
}

export default function RadioPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [copiedMessage, setCopiedMessage] = useState<string | null>(null);
  const [newDjName, setNewDjName] = useState("");
  const [newDjInstagram, setNewDjInstagram] = useState("");
  const [selectedSlot, setSelectedSlot] = useState<{ eventDate: string; slot: number } | null>(null);
  const [generatedMessage, setGeneratedMessage] = useState("");

  const { data: slots = [], isLoading: slotsLoading } = useQuery<RadioSlot[]>({
    queryKey: ["/api/radio/slots"],
  });

  const { data: djs = [], isLoading: djsLoading } = useQuery<DjContact[]>({
    queryKey: ["/api/djs"],
  });

  const { data: templateAssets = [] } = useQuery<RadioTemplateAsset[]>({
    queryKey: ["/api/radio/templates/assets"],
  });

  const { data: driveStatus } = useQuery<GoogleDriveStatus>({
    queryKey: ["/api/google-drive/status"],
  });

  const importDjsMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/radio/import-djs", { method: "POST" });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/djs"] });
      toast({
        title: "DJs importados",
        description: `${data.imported} nuevos DJs importados, ${data.skipped} ya existían`,
      });
    },
  });

  const createDjMutation = useMutation({
    mutationFn: async (data: { name: string; instagramHandle?: string }) => {
      const res = await fetch("/api/djs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/djs"] });
      setNewDjName("");
      setNewDjInstagram("");
      toast({ title: "DJ agregado" });
    },
  });

  const deleteDjMutation = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/djs/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/djs"] });
      toast({ title: "DJ eliminado" });
    },
  });

  const notifySlotsMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/radio/notify-slots", { method: "POST" });
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: data.sent ? "Resumen enviado" : "No enviado",
        description: data.message,
      });
    },
  });

  const generateTemplatesMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/radio/templates/generate-today", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudieron generar los templates");
      return data as { generated: number; skipped: number; failed: number };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/radio/templates/assets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/radio/slots"] });
      toast({
        title: "Templates revisados",
        description: `${data.generated} generados, ${data.skipped} sin cambios, ${data.failed} fallidos`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "No se generaron los templates",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const generateMessageMutation = useMutation({
    mutationFn: async ({ djId, eventDate, slot }: { djId: string; eventDate: string; slot: number }) => {
      const res = await fetch(`/api/djs/${djId}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventDate, slot }),
      });
      return res.json();
    },
    onSuccess: (data) => {
      setGeneratedMessage(data.message);
    },
  });

  const copyToClipboard = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedMessage(id);
    setTimeout(() => setCopiedMessage(null), 2000);
  };

  const slotsWithEmpty = slots.filter(s => s.emptySlots.length > 0);
  const availableDjs = djs.filter(d => d.status === "available");
  const templateAssetsByEvent = templateAssets.reduce<Record<string, RadioTemplateAsset[]>>((acc, asset) => {
    acc[asset.eventId] ||= [];
    acc[asset.eventId].push(asset);
    return acc;
  }, {});

  return (
    <div className="min-h-screen bg-zinc-950 text-white p-4 pb-24" data-testid="radio-page">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Radio className="h-8 w-8 text-purple-500" />
            <div>
              <h1 className="text-2xl font-bold">Radio Agent</h1>
              <p className="text-zinc-400 text-sm">Gestión de slots y DJs</p>
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => notifySlotsMutation.mutate()}
              disabled={notifySlotsMutation.isPending}
              data-testid="notify-slots-button"
            >
              <Send className="h-4 w-4 mr-2" />
              Enviar resumen
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => generateTemplatesMutation.mutate()}
              disabled={generateTemplatesMutation.isPending}
              data-testid="generate-radio-templates-button"
            >
              <FolderDown className={`h-4 w-4 mr-2 ${generateTemplatesMutation.isPending ? "animate-pulse" : ""}`} />
              Templates hoy
            </Button>
          </div>
        </div>

        <FlyerGenerator slots={slots} />

        <Card className="bg-zinc-900 border-zinc-800">
          <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <HardDrive className={driveStatus?.connected ? "h-5 w-5 text-green-400" : "h-5 w-5 text-yellow-400"} />
              <div>
                <p className="text-sm font-medium text-white">
                  Google Drive {driveStatus?.connected ? "conectado" : "pendiente"}
                </p>
                <p className="text-xs text-zinc-500">
                  {driveStatus?.connected
                    ? "Los templates se guardan automáticamente en Drive."
                    : driveStatus?.configured
                      ? "Conecta Drive para subir los templates."
                      : "Faltan GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET."}
                </p>
              </div>
            </div>
            {!driveStatus?.connected && driveStatus?.configured && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => { window.location.href = "/api/google-drive/auth"; }}
                data-testid="connect-google-drive-button"
              >
                <HardDrive className="h-4 w-4 mr-2" />
                Conectar Drive
              </Button>
            )}
          </CardContent>
        </Card>

        {templateAssets.length > 0 && (
          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-purple-400">
                <FolderDown className="h-5 w-5" />
                Templates en Drive
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {templateAssets
                  .slice()
                  .sort((a, b) => a.eventId.localeCompare(b.eventId) || a.slotHour - b.slotHour)
                  .map((asset) => {
                    const primaryLink = asset.driveLink || asset.canvaEditUrl || asset.canvaViewUrl;

                    return primaryLink ? (
                        <span
                          key={asset.id}
                          className="inline-flex items-center gap-2 rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300"
                        >
                          <a
                            href={primaryLink}
                            target="_blank"
                            rel="noreferrer"
                            className="hover:text-white"
                          >
                            {asset.slotHour}pm · {asset.djName}
                          </a>
                          {asset.canvaEditUrl && (
                            <a
                              href={asset.canvaEditUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-purple-300 hover:text-purple-200"
                            >
                              Canva
                            </a>
                          )}
                        </span>
                      ) : (
                        <span key={asset.id} className="rounded border border-zinc-800 px-3 py-1.5 text-xs text-zinc-500">
                          {asset.slotHour}pm · {asset.djName} · {asset.status}
                        </span>
                      );
                  })}
              </div>
            </CardContent>
          </Card>
        )}

        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-purple-400">
              <AlertCircle className="h-5 w-5" />
              Slots Vacíos ({slotsWithEmpty.length} eventos)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {slotsLoading ? (
              <p className="text-zinc-500">Cargando...</p>
            ) : slotsWithEmpty.length === 0 ? (
              <p className="text-zinc-500">No hay slots vacíos en los próximos eventos</p>
            ) : (
              <div className="space-y-4">
                {slotsWithEmpty.map((slot) => (
                  <div
                    key={slot.eventId}
                    className="p-4 bg-zinc-800/50 rounded-lg border border-zinc-700"
                    data-testid={`radio-slot-${slot.eventId}`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <span className="font-medium text-white">{slot.dateStr}</span>
                      <div className="flex gap-1">
                        {slot.emptySlots.map((s) => (
                          <Badge key={s} variant="destructive" className="bg-red-900/50 text-red-300">
                            {s}pm vacío
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-sm">
                      <div className={`p-2 rounded ${slot.slot7 ? "bg-green-900/30 text-green-400" : "bg-red-900/30 text-red-400"}`}>
                        7pm: {slot.slot7 || "Vacío"}
                      </div>
                      <div className={`p-2 rounded ${slot.slot8 ? "bg-green-900/30 text-green-400" : "bg-red-900/30 text-red-400"}`}>
                        8pm: {slot.slot8 || "Vacío"}
                      </div>
                      <div className={`p-2 rounded ${slot.slot9 ? "bg-green-900/30 text-green-400" : "bg-red-900/30 text-red-400"}`}>
                        9pm: {slot.slot9 || "Vacío"}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-purple-400">
                <Users className="h-5 w-5" />
                DJs ({djs.length})
              </CardTitle>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => importDjsMutation.mutate()}
                  disabled={importDjsMutation.isPending}
                  data-testid="import-djs-button"
                >
                  <RefreshCw className={`h-4 w-4 mr-2 ${importDjsMutation.isPending ? "animate-spin" : ""}`} />
                  Importar del historial
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2 mb-4">
              <Input
                placeholder="Nombre del DJ"
                value={newDjName}
                onChange={(e) => setNewDjName(e.target.value)}
                className="bg-zinc-800 border-zinc-700"
                data-testid="new-dj-name-input"
              />
              <Input
                placeholder="@instagram"
                value={newDjInstagram}
                onChange={(e) => setNewDjInstagram(e.target.value)}
                className="bg-zinc-800 border-zinc-700 w-40"
                data-testid="new-dj-instagram-input"
              />
              <Button
                onClick={() => {
                  if (newDjName.trim()) {
                    createDjMutation.mutate({
                      name: newDjName.trim(),
                      instagramHandle: newDjInstagram.trim() || undefined,
                    });
                  }
                }}
                disabled={!newDjName.trim() || createDjMutation.isPending}
                data-testid="add-dj-button"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>

            {djsLoading ? (
              <p className="text-zinc-500">Cargando...</p>
            ) : djs.length === 0 ? (
              <p className="text-zinc-500">No hay DJs registrados. Importa del historial o agrega manualmente.</p>
            ) : (
              <div className="space-y-2">
                {djs.map((dj) => (
                  <div
                    key={dj.id}
                    className="flex items-center justify-between p-3 bg-zinc-800/50 rounded-lg"
                    data-testid={`dj-item-${dj.id}`}
                  >
                    <div className="flex items-center gap-3">
                      <div>
                        <span className="font-medium">{dj.name}</span>
                        {dj.instagramHandle && (
                          <span className="text-zinc-400 text-sm ml-2">@{dj.instagramHandle}</span>
                        )}
                      </div>
                      {dj.rating && (
                        <Badge variant="outline" className="text-yellow-500 border-yellow-500/50">
                          {"⭐".repeat(dj.rating)}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className={
                          dj.status === "available"
                            ? "text-green-400 border-green-400/50"
                            : dj.status === "contacted"
                            ? "text-yellow-400 border-yellow-400/50"
                            : "text-zinc-400 border-zinc-400/50"
                        }
                      >
                        {dj.status}
                      </Badge>
                      
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              if (slotsWithEmpty.length > 0) {
                                const firstSlot = slotsWithEmpty[0];
                                setSelectedSlot({
                                  eventDate: firstSlot.dateStr,
                                  slot: firstSlot.emptySlots[0],
                                });
                                generateMessageMutation.mutate({
                                  djId: dj.id,
                                  eventDate: firstSlot.dateStr,
                                  slot: firstSlot.emptySlots[0],
                                });
                              }
                            }}
                            data-testid={`generate-message-${dj.id}`}
                          >
                            <MessageSquare className="h-4 w-4" />
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="bg-zinc-900 border-zinc-800">
                          <DialogHeader>
                            <DialogTitle>Mensaje para {dj.name}</DialogTitle>
                          </DialogHeader>
                          <div className="space-y-4">
                            <div className="p-4 bg-zinc-800 rounded-lg whitespace-pre-wrap text-sm">
                              {generatedMessage || "Generando mensaje..."}
                            </div>
                            <Button
                              onClick={() => copyToClipboard(generatedMessage, dj.id)}
                              className="w-full"
                              data-testid={`copy-message-${dj.id}`}
                            >
                              {copiedMessage === dj.id ? (
                                <>
                                  <Check className="h-4 w-4 mr-2" />
                                  Copiado
                                </>
                              ) : (
                                <>
                                  <Copy className="h-4 w-4 mr-2" />
                                  Copiar mensaje
                                </>
                              )}
                            </Button>
                          </div>
                        </DialogContent>
                      </Dialog>

                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteDjMutation.mutate(dj.id)}
                        className="text-red-400 hover:text-red-300"
                        data-testid={`delete-dj-${dj.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
