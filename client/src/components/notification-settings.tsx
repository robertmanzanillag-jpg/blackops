import { useState, useEffect } from "react";
import { Bell, BellOff, Check, Loader2, Send, ShieldCheck, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type NotificationStatus =
  | "loading"
  | "unsupported"
  | "denied"
  | "misconfigured"
  | "subscribed"
  | "unsubscribed";

type NotificationSettingsProps = {
  variant?: "icon" | "panel";
};

export function NotificationSettings({ variant = "icon" }: NotificationSettingsProps) {
  const [status, setStatus] = useState<NotificationStatus>("loading");
  const [isProcessing, setIsProcessing] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    checkNotificationStatus();
  }, []);

  async function checkNotificationStatus() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setStatus("unsupported");
      return;
    }

    if (!("Notification" in window)) {
      setStatus("unsupported");
      return;
    }

    const permission = Notification.permission;
    if (permission === "denied") {
      setStatus("denied");
      return;
    }

    try {
      const registration = await ensureServiceWorker();
      const subscription = await registration.pushManager.getSubscription();
      setStatus(subscription ? "subscribed" : "unsubscribed");
    } catch {
      setStatus("unsubscribed");
    }
  }

  async function subscribe() {
    setIsProcessing(true);
    setMessage("");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus("denied");
        setMessage("El permiso quedo bloqueado. Activalo desde la configuracion del navegador.");
        return;
      }

      const registration = await ensureServiceWorker();

      const res = await fetch("/api/push/vapid-key");
      if (!res.ok) throw new Error("No se pudo leer la llave publica de notificaciones.");
      const { publicKey } = await res.json();
      if (!publicKey) {
        setStatus("misconfigured");
        setMessage("Faltan las llaves VAPID en el servidor. Configuralas para activar notificaciones reales.");
        return;
      }

      const currentSubscription = await registration.pushManager.getSubscription();
      if (currentSubscription) {
        await currentSubscription.unsubscribe();
      }

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      const saveRes = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
      if (!saveRes.ok) throw new Error("No se pudo guardar este dispositivo.");

      setStatus("subscribed");
      setMessage("Este dispositivo ya esta conectado para recibir alertas.");

      await fetch("/api/push/test", { method: "POST" });
    } catch (err) {
      console.error("Failed to subscribe:", err);
      setMessage(err instanceof Error ? err.message : "No se pudo activar la notificacion.");
    } finally {
      setIsProcessing(false);
    }
  }

  async function unsubscribe() {
    setIsProcessing(true);
    setMessage("");
    try {
      const registration = await ensureServiceWorker();
      const subscription = await registration.pushManager.getSubscription();
      
      if (subscription) {
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }
      
      setStatus("unsubscribed");
      setMessage("Este dispositivo quedo desconectado.");
    } catch (err) {
      console.error("Failed to unsubscribe:", err);
      setMessage("No se pudo desactivar aqui. Intentalo otra vez.");
    } finally {
      setIsProcessing(false);
    }
  }

  async function sendTestNotification() {
    setIsProcessing(true);
    setMessage("");
    try {
      const res = await fetch("/api/push/test", { method: "POST" });
      if (!res.ok) throw new Error("No se pudo enviar la prueba.");
      setMessage("Prueba enviada. Revisa este telefono.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "No se pudo enviar la prueba.");
    } finally {
      setIsProcessing(false);
    }
  }

  if (variant === "panel") {
    const isSubscribed = status === "subscribed";
    const isBlocked = status === "denied" || status === "unsupported" || status === "misconfigured";

    return (
      <section className="mb-6 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950/80">
        <div className="grid gap-4 p-4 md:grid-cols-[1fr_auto] md:items-center md:p-5">
          <div className="flex gap-4">
            <div
              className={cn(
                "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border",
                isSubscribed
                  ? "border-white/15 bg-zinc-900 text-zinc-200"
                  : "border-white/10 bg-zinc-950 text-zinc-400"
              )}
            >
              <Smartphone className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white">
                {isSubscribed ? "Tu telefono esta conectado" : "Conectar notificaciones al telefono"}
              </p>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-zinc-400">
                Abre esta app desde tu telefono, agregala a la pantalla de inicio si usas iPhone, y activa las notificaciones. Asi te llegan alertas cuando un proyecto se cae o se recupera.
              </p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-zinc-500">
                <span className="rounded-full border border-zinc-800 px-3 py-1">iPhone: Safari + Agregar a inicio</span>
                <span className="rounded-full border border-zinc-800 px-3 py-1">Android: Chrome + Instalar app</span>
                <span className="rounded-full border border-zinc-800 px-3 py-1">Alertas de proyectos incluidas</span>
              </div>
              {message && (
                <p className={cn("mt-3 text-sm", isBlocked ? "text-zinc-300" : "text-zinc-400")}>{message}</p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 md:justify-end">
            {isSubscribed && (
              <Button
                variant="outline"
                onClick={sendTestNotification}
                disabled={isProcessing}
                className="border-zinc-700"
                data-testid="button-send-test-phone-notification"
              >
                {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                Probar
              </Button>
            )}
            <Button
              onClick={isSubscribed ? unsubscribe : subscribe}
              disabled={isProcessing || status === "loading" || status === "unsupported"}
              className={cn(
                isSubscribed
                  ? "bg-zinc-800 text-white hover:bg-zinc-700"
                  : "bg-zinc-100 text-zinc-950 hover:bg-white"
              )}
              data-testid={isSubscribed ? "button-disconnect-phone-notifications" : "button-connect-phone-notifications"}
            >
              {isProcessing || status === "loading" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : isSubscribed ? (
                <BellOff className="mr-2 h-4 w-4" />
              ) : (
                <ShieldCheck className="mr-2 h-4 w-4" />
              )}
              {isSubscribed ? "Desconectar" : "Activar en este telefono"}
            </Button>
          </div>
        </div>
      </section>
    );
  }

  if (status === "loading") {
    return (
      <Button variant="ghost" size="icon" disabled className="text-zinc-500 h-7 w-7 md:h-10 md:w-10">
        <Loader2 className="w-4 h-4 md:w-6 md:h-6 animate-spin" />
      </Button>
    );
  }

  if (status === "unsupported") {
    return (
      <Button variant="ghost" size="icon" disabled className="text-zinc-500 h-7 w-7 md:h-10 md:w-10" title="Tu navegador no soporta notificaciones">
        <BellOff className="w-4 h-4 md:w-6 md:h-6" />
      </Button>
    );
  }

  if (status === "denied") {
    return (
      <Button variant="ghost" size="icon" disabled className="text-zinc-400 h-7 w-7 md:h-10 md:w-10" title="Notificaciones bloqueadas. Actívalas en configuración del navegador.">
        <BellOff className="w-4 h-4 md:w-6 md:h-6" />
      </Button>
    );
  }

  if (status === "subscribed") {
    return (
      <Button
        variant="ghost"
        size="icon"
        onClick={unsubscribe}
        disabled={isProcessing}
        className="text-zinc-400 hover:text-white h-7 w-7 md:h-10 md:w-10 relative"
        title="Notificaciones activadas. Clic para desactivar."
        data-testid="button-notifications-active"
      >
        {isProcessing ? <Loader2 className="w-4 h-4 md:w-6 md:h-6 animate-spin" /> : <Bell className="w-4 h-4 md:w-6 md:h-6" />}
        <Check className="w-2 h-2 md:w-3 md:h-3 absolute bottom-0.5 right-0.5" />
      </Button>
    );
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={subscribe}
      disabled={isProcessing}
      className="text-zinc-400 hover:text-white h-7 w-7 md:h-10 md:w-10"
      title="Activar notificaciones"
      data-testid="button-enable-notifications"
    >
      {isProcessing ? <Loader2 className="w-4 h-4 md:w-6 md:h-6 animate-spin" /> : <Bell className="w-4 h-4 md:w-6 md:h-6" />}
    </Button>
  );
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function ensureServiceWorker(): Promise<ServiceWorkerRegistration> {
  const existingRegistration = await navigator.serviceWorker.getRegistration("/");
  if (existingRegistration) return existingRegistration;

  await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  return navigator.serviceWorker.ready;
}
