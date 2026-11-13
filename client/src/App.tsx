import { lazy, Suspense } from "react";
import { Switch, Route, Redirect, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useMutation, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import AuthPage from "@/pages/auth";
import { readAuthState } from "@/lib/auth-state";
import { useWorkspaceRole } from "@/lib/workspace-role";

const NotFound = lazy(() => import("@/pages/not-found"));
const Dashboard = lazy(() => import("@/pages/dashboard"));
const Portfolio = lazy(() => import("@/pages/portfolio"));
const InvestmentDetail = lazy(() => import("@/pages/investment-detail"));
const Projects = lazy(() => import("@/pages/projects"));
const RadioPage = lazy(() => import("@/pages/radio"));
const PromoVideoPage = lazy(() => import("@/pages/promo-video"));
const ClippersPage = lazy(() => import("@/pages/clippers"));
const AssistantPage = lazy(() => import("@/pages/assistant"));
const CodeAgentPage = lazy(() => import("@/pages/code-agent"));
const GitHubAgentPage = lazy(() => import("@/pages/github-agent"));
const CeoDashboardPage = lazy(() => import("@/pages/ceo-dashboard"));
const AutomationManagerPage = lazy(() => import("@/pages/automation-manager"));
const ToolsPage = lazy(() => import("@/pages/tools"));
const AgentsOfficePage = lazy(() => import("@/pages/agents-office"));
const AgentChatPage = lazy(() => import("@/pages/agent-chat"));
const RevenueEnginePage = lazy(() => import("@/pages/revenue-engine-simple"));
const RevenueEngineAdvancedPage = lazy(() => import("@/pages/revenue-engine"));
const DropshippingCeoPage = lazy(() => import("@/pages/dropshipping-ceo"));
const MarketingCommandCenterPage = lazy(() => import("@/pages/marketing-command-center"));
const CybersecurityAgentPage = lazy(() => import("@/pages/cybersecurity-agent"));
const AppQaAgentPage = lazy(() => import("@/pages/app-qa-agent"));
const LegalCompliancePage = lazy(() => import("@/pages/legal-compliance"));
const LocalNewsPublicPage = lazy(() => import("@/pages/local-news-public"));
const InvitePage = lazy(() => import("@/pages/invite"));

/** Partners ("socios") only get the office: every other page is owner data. */
function PartnerRouter() {
  const [location] = useLocation();
  return location === "/agents-office" ? <AgentsOfficePage /> : <Redirect to="/agents-office" />;
}

function useInviteToken(): string | null {
  const [location] = useLocation();
  const match = /^\/invite\/([^/?#]+)$/.exec(location);
  if (!match) return null;
  try { return decodeURIComponent(match[1]); } catch { return ""; }
}

type AuthMe = {
  authenticated: boolean;
  sessionBacked?: boolean;
  usingDevFallback?: boolean;
  user?: { id: string; username: string };
};

function AuthenticatedRouter() {
  const { data: auth, isLoading, isError: authError, refetch: retryAuth } = useQuery<AuthMe>({
    queryKey: ["auth-me"],
    queryFn: async () => {
      const response = await fetch("/api/auth/me");
      return readAuthState(response);
    },
    retry: false,
  });

  const workspace = useWorkspaceRole(Boolean(auth?.authenticated));
  const logoutMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
      if (!response.ok) throw new Error("No se pudo cerrar la sesión. Intenta nuevamente.");
    },
    onSuccess: async () => {
      await queryClient.cancelQueries({ queryKey: ["auth-me"] });
      queryClient.setQueryData(["auth-me"], { authenticated: false });
      queryClient.removeQueries({ predicate: query => query.queryKey[0] !== "auth-me" });
      queryClient.invalidateQueries({ queryKey: ["auth-me"] });
    },
  });

  if (isLoading) {
    return <div className="flex min-h-screen items-center justify-center bg-black text-sm text-zinc-400">Cargando BlackOps...</div>;
  }

  if (authError || !auth?.authenticated) {
    return <>{authError && <div role="alert" className="fixed inset-x-0 top-0 z-50 bg-amber-950 p-3 text-center text-sm text-amber-100">No se pudo verificar la sesión. <Button variant="ghost" onClick={() => retryAuth()}>Reintentar</Button></div>}<AuthPage /></>;
  }

  if (workspace.loading) {
    return <div className="flex min-h-screen items-center justify-center bg-black text-sm text-zinc-400">Cargando BlackOps...</div>;
  }

  if (workspace.revoked) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-black px-4 text-center text-sm text-zinc-300" role="alert">
        <p>Tu acceso de socio fue revocado. Si crees que es un error, habla con Robert.</p>
        <Button type="button" variant="ghost" onClick={() => logoutMutation.mutate()} disabled={logoutMutation.isPending}>Salir</Button>
      </div>
    );
  }

  return (
    <>
      <div className="fixed right-3 top-3 z-50 flex items-center gap-2 rounded-lg border border-white/10 bg-black/80 px-2 py-1 text-xs text-zinc-300 backdrop-blur">
        <span className="max-w-[160px] truncate">{auth.user?.username || auth.user?.id}</span>
        {auth.usingDevFallback && <span className="rounded border border-amber-400/30 px-1.5 py-0.5 text-amber-200">dev</span>}
        {auth.sessionBacked && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={logoutMutation.isPending}
            onClick={() => logoutMutation.mutate()}
            className="h-7 px-2 text-xs text-zinc-300 hover:text-white"
          >
            Salir
          </Button>
        )}
      </div>
      {logoutMutation.isError && <div role="alert" className="fixed inset-x-0 top-14 z-50 bg-amber-950 p-3 text-center text-sm text-amber-100">No se pudo cerrar la sesión. Intenta nuevamente.</div>}
      <Suspense fallback={<PageLoading />}>
        {workspace.isPartner ? <PartnerRouter /> : <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/dashboard" component={Dashboard} />
          <Route path="/assistant" component={AssistantPage} />
          <Route path="/ceo" component={CeoDashboardPage} />
          <Route path="/tools" component={ToolsPage} />
          <Route path="/agents-office" component={AgentsOfficePage} />
          <Route path="/agent-chat" component={AgentChatPage} />
          <Route path="/revenue-engine/advanced" component={RevenueEngineAdvancedPage} />
          <Route path="/revenue-engine" component={RevenueEnginePage} />
          <Route path="/dropshipping-ceo" component={DropshippingCeoPage} />
          <Route path="/marketing-command-center" component={MarketingCommandCenterPage} />
          <Route path="/cybersecurity-agent" component={CybersecurityAgentPage} />
          <Route path="/app-qa-agent" component={AppQaAgentPage} />
          <Route path="/legal-compliance" component={LegalCompliancePage} />
          <Route path="/automations" component={AutomationManagerPage} />
          <Route path="/code-agent" component={CodeAgentPage} />
          <Route path="/github-agent" component={GitHubAgentPage} />
          <Route path="/portfolio" component={Portfolio} />
          <Route path="/portfolio/:symbol" component={InvestmentDetail} />
          <Route path="/projects" component={Projects} />
          <Route path="/radio" component={RadioPage} />
          <Route path="/promo-video" component={PromoVideoPage} />
          <Route path="/clippers" component={ClippersPage} />
          <Route component={NotFound} />
        </Switch>}
      </Suspense>
    </>
  );
}

function Router() {
  const isPublicNewsRoute = typeof window !== "undefined" && window.location.pathname.startsWith("/news");
  // Partner invitation links (/invite/<token>) are public, outside the app's route catalog.
  const inviteToken = useInviteToken();
  if (inviteToken !== null) {
    return <Suspense fallback={<PageLoading />}><InvitePage token={inviteToken} /></Suspense>;
  }
  return (
    <Suspense fallback={isPublicNewsRoute ? <PublicPageLoading /> : <PageLoading />}>
      <Switch>
        <Route path="/news/article/:slug" component={LocalNewsPublicPage} />
        <Route path="/news/miami" component={LocalNewsPublicPage} />
        <Route path="/news/new-york" component={LocalNewsPublicPage} />
        <Route path="/news" component={LocalNewsPublicPage} />
        <Route component={AuthenticatedRouter} />
      </Switch>
    </Suspense>
  );
}

function PageLoading() {
  return <div className="flex min-h-screen items-center justify-center bg-black text-sm text-zinc-400">Cargando modulo...</div>;
}

function PublicPageLoading() {
  return <div className="flex min-h-screen items-center justify-center bg-[#fbfaf6] text-sm font-semibold uppercase tracking-[0.14em] text-[#17395c]">Loading Metro Current…</div>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Router />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
