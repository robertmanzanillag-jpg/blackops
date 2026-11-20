import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { kongSupervisorSessionScope, type SupervisorAuth } from "./kong-supervisor-session";
import { KongRepairStatusPanel } from "./kong-repair-status-panel";

async function readAuth(): Promise<SupervisorAuth> {
  const response = await fetch("/api/auth/me", { signal: AbortSignal.timeout(15_000), credentials: "same-origin" });
  if (!response.ok) throw new Error("No se pudo verificar la sesion.");
  return response.json() as Promise<SupervisorAuth>;
}

// Owner-only view of the KONG repair bridge (read-only GETs). The old "Supervisor KONG" chat and its
// readiness records were retired: KONG desks are chatted with from the office (agent chat -> KONG
// office-orders) and their state comes only from KONG's own snapshot.
export function KongRepairDialog() {
  const [open, setOpen] = useState(false);
  const routerAuth = useQuery<SupervisorAuth>({ queryKey: ["auth-me"], enabled: false });
  const routerId = routerAuth.data?.user?.id || null;
  const verifiedAuth = useQuery({ queryKey: ["kong-repairs-auth", routerId], queryFn: readAuth, enabled: open && Boolean(routerId) && !routerAuth.isFetching, retry: false, staleTime: 0, gcTime: 0, refetchOnMount: "always" });
  const sessionScope = kongSupervisorSessionScope(routerAuth.data, verifiedAuth.data, routerAuth.isFetching, verifiedAuth.isFetching, verifiedAuth.isError, routerAuth.isError);
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button type="button" variant="outline">Reparaciones KONG</Button></DialogTrigger>
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>Reparaciones KONG</DialogTitle>
        <DialogDescription>Estado del puente de reparaciones de KONG. Para hablar con un agente de KONG, abre su puesto en la Oficina KONG.</DialogDescription>
      </DialogHeader>
      {open && sessionScope && <KongRepairStatusPanel key={sessionScope} sessionScope={sessionScope} />}
      {open && !sessionScope && <p role="status">{verifiedAuth.isError || !routerId ? "Inicia sesion con el propietario para ver las reparaciones." : "Verificando la sesion..."}</p>}
    </DialogContent>
  </Dialog>;
}
