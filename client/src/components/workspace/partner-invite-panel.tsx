import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

type InvitationRow = { id: string; createdAt: string; expiresAt: string; status: "open" | "used" | "expired" | "revoked" | "claimed"; usedBy: string | null };
type PartnerRow = { userId: string; username: string; joinedAt: string; active: boolean; revokedAt: string | null };

const STATUS_TEXT: Record<InvitationRow["status"], string> = { open: "abierta", used: "usada", expired: "vencida", revoked: "revocada", claimed: "en uso" };

async function call<T>(method: string, url: string): Promise<T> {
  const response = await fetch(url, { method, credentials: "same-origin", headers: { Accept: "application/json" } });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error || "No se pudo completar la acción.");
  return payload as T;
}

/** Owner-only: create a single-use partner invitation link, list partners/invitations, revoke. */
export function PartnerInvitePanel({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const invitations = useQuery<{ invitations: InvitationRow[] }>({ queryKey: ["workspace-invitations"], queryFn: () => call("GET", "/api/workspace/invitations"), retry: false });
  const partners = useQuery<{ partners: PartnerRow[] }>({ queryKey: ["workspace-partners"], queryFn: () => call("GET", "/api/workspace/partners"), retry: false });
  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["workspace-invitations"] }),
    queryClient.invalidateQueries({ queryKey: ["workspace-partners"] }),
  ]);
  const create = useMutation({
    mutationFn: () => call<{ link: string }>("POST", "/api/workspace/invitations"),
    onSuccess: async (result) => { setCopied(false); setLink(`${window.location.origin}${result.link}`); await refresh(); },
  });
  const revokeInvitation = useMutation({ mutationFn: (id: string) => call("DELETE", `/api/workspace/invitations/${encodeURIComponent(id)}`), onSuccess: refresh });
  const revokePartner = useMutation({ mutationFn: (userId: string) => call("DELETE", `/api/workspace/partners/${encodeURIComponent(userId)}`), onSuccess: refresh });
  const error = create.error || revokeInvitation.error || revokePartner.error || invitations.error || partners.error;
  const copy = async () => {
    if (!link) return;
    try { await navigator.clipboard.writeText(link); setCopied(true); } catch { setCopied(false); }
  };

  return (
    <section aria-label="Invitar socio" className="absolute right-3 top-[220px] z-30 flex max-h-[60%] w-[min(420px,calc(100vw-1.5rem))] flex-col overflow-y-auto rounded-2xl border border-fuchsia-200/25 bg-[#12051a]/95 p-4 text-xs text-white shadow-2xl sm:top-36 lg:top-24" data-testid="world-partner-panel">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-fuchsia-200">Invitar socio</p>
        <button type="button" onClick={onClose} className="text-xs text-zinc-400 hover:text-white" aria-label="Cerrar invitar socio">✕</button>
      </div>
      <p className="mt-1 text-[11px] text-zinc-400">El socio ve toda la oficina (solo lectura) y puede hablar, dar órdenes y aprobar publicaciones del equipo de Black Room. No puede tocar KONG, finanzas, ajustes, integraciones ni código. El enlace sirve una sola vez y vence en 7 días.</p>
      <button type="button" onClick={() => create.mutate()} disabled={create.isPending} className="mt-3 rounded-full bg-fuchsia-300 px-3 py-2 text-xs font-bold text-black hover:bg-fuchsia-200 disabled:opacity-50" data-testid="world-partner-create">Crear enlace de invitación</button>
      {link && (
        <div className="mt-2 rounded-xl border border-fuchsia-200/20 bg-black/40 p-2" data-testid="world-partner-link">
          <p className="break-all font-mono text-[10px] text-fuchsia-100">{link}</p>
          <div className="mt-1 flex items-center gap-2">
            <button type="button" onClick={copy} className="rounded-full border border-white/20 px-2 py-0.5 text-[10px]">Copiar</button>
            {copied && <span className="text-[10px] text-emerald-200">Copiado</span>}
            <span className="text-[10px] text-zinc-500">Se muestra solo ahora; compártelo por un canal privado.</span>
          </div>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-[11px] text-rose-200">{(error as Error).message}</p>}

      <p className="mt-4 text-[9px] uppercase tracking-[0.18em] text-fuchsia-200">Socios</p>
      {(partners.data?.partners || []).length === 0 && <p className="mt-1 text-zinc-500">Todavía no hay socios.</p>}
      {(partners.data?.partners || []).map((partner) => (
        <div key={partner.userId} className="mt-1 flex items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-white/[0.03] px-2 py-1" data-testid="world-partner-row">
          <span>{partner.username} <span className="text-zinc-500">· {partner.active ? `desde ${new Date(partner.joinedAt).toLocaleDateString("es")}` : "acceso revocado"}</span></span>
          {partner.active && <button type="button" onClick={() => revokePartner.mutate(partner.userId)} disabled={revokePartner.isPending} className="text-[10px] font-semibold text-rose-200 hover:underline" data-testid="world-partner-revoke">Revocar acceso</button>}
        </div>
      ))}

      <p className="mt-4 text-[9px] uppercase tracking-[0.18em] text-fuchsia-200">Invitaciones</p>
      {(invitations.data?.invitations || []).length === 0 && <p className="mt-1 text-zinc-500">Sin invitaciones.</p>}
      {(invitations.data?.invitations || []).slice(0, 10).map((invitation) => (
        <div key={invitation.id} className="mt-1 flex items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-white/[0.03] px-2 py-1">
          <span>{new Date(invitation.createdAt).toLocaleDateString("es")} <span className="text-zinc-500">· {STATUS_TEXT[invitation.status]} · vence {new Date(invitation.expiresAt).toLocaleDateString("es")}</span></span>
          {invitation.status === "open" && <button type="button" onClick={() => revokeInvitation.mutate(invitation.id)} disabled={revokeInvitation.isPending} className="text-[10px] font-semibold text-rose-200 hover:underline">Revocar</button>}
        </div>
      ))}
    </section>
  );
}
