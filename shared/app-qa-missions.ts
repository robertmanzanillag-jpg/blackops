export const QA_MISSIONS = [
  { id: 'direction', label: 'Dirección y equipo', paths: ['/', '/dashboard', '/assistant', '/ceo', '/agents-office'] },
  { id: 'business', label: 'Negocio y finanzas', paths: ['/revenue-engine', '/revenue-engine/advanced', '/dropshipping-ceo', '/portfolio', '/portfolio/:symbol'] },
  { id: 'operations', label: 'Producto y operaciones', paths: ['/tools', '/projects', '/automations', '/code-agent', '/github-agent', '/app-qa-agent'] },
  { id: 'trust', label: 'Seguridad y legal', paths: ['/cybersecurity-agent', '/legal-compliance'] },
  { id: 'content', label: 'Contenido y noticias', paths: ['/marketing-command-center', '/radio', '/promo-video', '/clippers', '/news', '/news/miami', '/news/new-york', '/news/article/:slug'] },
] as const;

export type QaMissionId = typeof QA_MISSIONS[number]['id'];
export type QaMissionStatus = 'pass' | 'warn' | 'fail' | 'pending';
type Route = { path: string; label: string; status: 'pass' | 'warn' | 'fail' };
type Visual = { path: string; status: QaMissionStatus; consoleErrors?: string[] };
type Finding = { id: string; severity: 'critical' | 'high' | 'medium' | 'low' | 'info'; url?: string | null; area?: string; sourceAgent?: string };

export function missionForRoute(path: string): QaMissionId | null {
  const clean = path.split(/[?#]/, 1)[0];
  for (const mission of QA_MISSIONS) {
    for (const pattern of mission.paths) {
      const routeParts = pattern.split('/');
      const parts = clean.split('/');
      if (routeParts.length === parts.length && routeParts.every((part, i) => part.startsWith(':') ? Boolean(parts[i]) : part === parts[i])) return mission.id;
    }
  }
  return null;
}

export function routeMissionCoverage(routes: readonly { path: string }[]) {
  const paths = routes.map(r => r.path);
  return {
    totalRoutes: paths.length,
    classifiedRoutes: paths.filter(p => missionForRoute(p)).length,
    unclassifiedPaths: paths.filter(p => !missionForRoute(p)),
    duplicatePaths: [...new Set(paths.filter((p, i) => paths.indexOf(p) !== i))],
    missingPaths: QA_MISSIONS.flatMap(m => [...m.paths]).filter(p => !paths.includes(p)),
  };
}

export type QaMissionReport = {
  id: QaMissionId | 'unclassified';
  label: string;
  status: QaMissionStatus;
  routeCount: number;
  reviewedRoutes: number;
  passedRoutes: number;
  localFindingCount: number;
  globalFindingCount: number;
  routes: Array<{ path: string; label: string; inventoryStatus: Route['status']; visualStatus: QaMissionStatus }>;
};

export type QaMissionBreakdown = {
  coverage: ReturnType<typeof routeMissionCoverage>;
  missions: QaMissionReport[];
  globalFindingIds: string[];
};

// Findings with no local route (DB, external app/API, inventory) remain global;
// they propagate to mission outcomes and are never dropped from the release gate.
export function buildMissionBreakdown(routes: readonly Route[], visuals: readonly Visual[], findings: readonly Finding[], localOrigin?: string | null): QaMissionBreakdown {
  const findingMission = (finding: Finding) => {
    if (!finding.url || finding.area === 'App QA data dependency' || finding.sourceAgent === 'api-scout' || finding.area === 'Inventory') return null;
    if (finding.url.startsWith('/')) return missionForRoute(finding.url);
    try {
      const url = new URL(finding.url);
      return localOrigin && url.origin === new URL(localOrigin).origin ? missionForRoute(url.pathname) : null;
    } catch { return null; }
  };
  const globalFindings = findings.filter(f => !findingMission(f));
  const definitions: Array<{ id: QaMissionId | 'unclassified'; label: string }> = [...QA_MISSIONS];
  if (routes.some(r => !missionForRoute(r.path))) definitions.push({ id: 'unclassified', label: 'Rutas sin misión' });
  const missions = definitions.map(({ id, label }): QaMissionReport => {
    const items = routes.filter(r => (missionForRoute(r.path) || 'unclassified') === id).map(route => {
      const scans = visuals.filter(v => v.path === route.path || (route.path.includes(':') && v.path.split('/').length === route.path.split('/').length && missionForRoute(v.path) === id && route.path.split('/').every((part, i) => part.startsWith(':') ? Boolean(v.path.split('/')[i]) : part === v.path.split('/')[i])));
      const visualStatus = scans.some(s => s.status === 'fail' || (s.status !== 'pending' && s.consoleErrors?.length)) ? 'fail' : scans.some(s => s.status === 'warn') ? 'warn' : scans.length && scans.every(s => s.status === 'pass') ? 'pass' : 'pending';
      return { path: route.path, label: route.label, inventoryStatus: route.status, visualStatus } as QaMissionReport['routes'][number];
    });
    const localFindings = findings.filter(f => findingMission(f) === id);
    const relevant = [...globalFindings, ...localFindings];
    const status = id === 'unclassified' || relevant.some(f => f.severity === 'critical' || f.severity === 'high') || items.some(r => r.inventoryStatus === 'fail' || r.visualStatus === 'fail') ? 'fail'
      : relevant.some(f => f.severity === 'medium' || f.severity === 'low') || items.some(r => r.inventoryStatus === 'warn' || r.visualStatus === 'warn') ? 'warn'
      : !items.length || items.some(r => r.visualStatus === 'pending') ? 'pending' : 'pass';
    return { id, label, status, routeCount: items.length, reviewedRoutes: items.filter(r => r.visualStatus !== 'pending').length, passedRoutes: items.filter(r => r.visualStatus === 'pass').length, localFindingCount: localFindings.length, globalFindingCount: globalFindings.length, routes: items };
  });
  return { coverage: routeMissionCoverage(routes), missions, globalFindingIds: globalFindings.map(f => f.id) };
}
