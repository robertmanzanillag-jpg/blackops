import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getCalendarStatus, syncCalendar, syncZohoCalendar } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { RefreshCw, Check, X, Calendar, Loader2, Building2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Link } from "wouter";

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const queryClient = useQueryClient();
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const { data: calendarStatus, isLoading: statusLoading } = useQuery({
    queryKey: ["calendarStatus"],
    queryFn: getCalendarStatus,
    enabled: open,
  });

  const syncMutation = useMutation({
    mutationFn: syncCalendar,
    onSuccess: (data) => {
      if (data.synced > 0) {
        setSyncMessage(`Google: ${data.synced} nuevos de ${data.total} eventos encontrados ✓`);
      } else {
        setSyncMessage(`Google: calendario al día (${data.total} eventos) ✓`);
      }
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      setTimeout(() => setSyncMessage(null), 6000);
    },
    onError: (error: Error) => {
      setSyncMessage(`Error Google: ${error.message}`);
      setTimeout(() => setSyncMessage(null), 5000);
    },
  });

  const zohoSyncMutation = useMutation({
    mutationFn: syncZohoCalendar,
    onSuccess: (data) => {
      if (data.errors?.length > 0) {
        setSyncMessage(`Zoho: ${data.synced} eventos. Errores: ${data.errors[0]}`);
      } else {
        setSyncMessage(`Zoho: ${data.synced} eventos sincronizados`);
      }
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      setTimeout(() => setSyncMessage(null), 5000);
    },
    onError: (error: Error) => {
      setSyncMessage(`Error Zoho: ${error.message}`);
      setTimeout(() => setSyncMessage(null), 5000);
    },
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div 
        className="bg-zinc-900 border border-zinc-800 rounded-xl max-w-md w-full p-6"
        onClick={(e) => e.stopPropagation()}
        data-testid="settings-panel"
      >
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold text-white">Configuración</h2>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white p-1"
            data-testid="button-close-settings"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-6">
          <div>
            <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-4">
              Agentes
            </h3>
            <Link href="/agents-office">
              <Button
                variant="outline"
                className="h-auto w-full justify-start gap-3 rounded-lg border-zinc-700/50 bg-zinc-800/50 p-4 text-left text-white hover:bg-zinc-800 hover:text-white"
                onClick={onClose}
                data-testid="button-settings-agents-office"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-black">
                  <Building2 className="h-5 w-5 text-zinc-300" />
                </div>
                <div>
                  <div className="font-medium">Sala de agentes</div>
                  <div className="text-sm font-normal text-zinc-400">Ver oficina, cubiculos y agentes conectados.</div>
                </div>
              </Button>
            </Link>
          </div>

          <div>
            <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-4">
              Calendarios Conectados
            </h3>

            <div className="space-y-3">
              {/* Google Calendar */}
              <div className="flex items-center justify-between p-4 bg-zinc-800/50 rounded-lg border border-zinc-700/50">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center">
                    <Calendar className="w-6 h-6 text-zinc-400" />
                  </div>
                  <div>
                    <div className="font-medium text-white">Google Calendar</div>
                    <div className="text-sm text-zinc-400">
                      {statusLoading ? "Verificando..." : calendarStatus?.google ? "Conectado" : "No conectado"}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {statusLoading ? (
                    <Loader2 className="w-5 h-5 text-zinc-400 animate-spin" />
                  ) : calendarStatus?.google ? (
                    <>
                      <Check className="w-5 h-5 text-zinc-400" />
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => syncMutation.mutate()}
                        disabled={syncMutation.isPending}
                        className="text-zinc-400 hover:text-white"
                        data-testid="button-sync-google"
                      >
                        {syncMutation.isPending ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <RefreshCw className="w-4 h-4" />
                        )}
                      </Button>
                    </>
                  ) : (
                    <span className="text-xs text-zinc-500">Configurar en Replit</span>
                  )}
                </div>
              </div>

              {/* Zoho Calendar */}
              <div className="flex items-center justify-between p-4 bg-zinc-800/50 rounded-lg border border-zinc-700/50">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-zinc-900/20 rounded-lg flex items-center justify-center">
                    <Calendar className="w-6 h-6 text-zinc-400" />
                  </div>
                  <div>
                    <div className="font-medium text-white">Zoho Calendar</div>
                    <div className="text-sm text-zinc-400">
                      {statusLoading ? "Verificando..." : calendarStatus?.zoho ? "Conectado" : "Requiere configuración"}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {statusLoading ? (
                    <Loader2 className="w-5 h-5 text-zinc-400 animate-spin" />
                  ) : calendarStatus?.zoho ? (
                    <>
                      <Check className="w-5 h-5 text-zinc-400" />
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => zohoSyncMutation.mutate()}
                        disabled={zohoSyncMutation.isPending}
                        className="text-zinc-400 hover:text-white"
                        data-testid="button-sync-zoho"
                      >
                        {zohoSyncMutation.isPending ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <RefreshCw className="w-4 h-4" />
                        )}
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => zohoSyncMutation.mutate()}
                      disabled={zohoSyncMutation.isPending}
                      className="text-zinc-400 hover:text-white"
                      data-testid="button-sync-zoho"
                    >
                      {zohoSyncMutation.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <>
                          <RefreshCw className="w-4 h-4 mr-1" />
                          Sincronizar
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {syncMessage && (
            <div className={cn(
              "p-3 rounded-lg text-sm",
              syncMessage.startsWith("Error") 
                ? "bg-zinc-900/10 border border-white/10 text-zinc-400"
                : "bg-zinc-900/10 border border-white/10 text-zinc-400"
            )}>
              {syncMessage}
            </div>
          )}

          <div className="pt-4 border-t border-zinc-800">
            <p className="text-xs text-zinc-500 leading-relaxed">
              <strong className="text-zinc-400">Zoho Calendar:</strong> Requiere configurar ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET y ZOHO_REFRESH_TOKEN en las variables de entorno.
              <br /><br />
              <strong className="text-zinc-400">Google Calendar:</strong> Usa la integración automática de Replit.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
