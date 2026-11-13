import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'wouter';
import { departments, buildWorld, filterWorld, readSource, type Entity, type Source } from '@/lib/agents-world';
import { readLearning } from '@/lib/agents-world-learning';
import { worldOwnerMatches } from '@/lib/agents-world-session';
import './agents-world-office.css';

const AgentsWorldScene = lazy(() => import('@/components/agents-world-scene').then(module => ({ default: module.AgentsWorldScene })));
const sourcePaths = ['/api/projects', '/api/tasks', '/api/blackroom-agent'] as const;
const initialSources = (): Source[] => [{ state: 'loading' }, { state: 'loading' }, { state: 'error' }];
const sourceLabels = { loading: 'Consultando', ready: 'Lectura disponible', denied: 'Sin permiso', error: 'Fuente no disponible' };

/** Read-only client projection. Never mounts the legacy operational center. */
export function AgentsWorldOffice({ ownerId, suspended = false }: { ownerId: string; suspended?: boolean }) {
  const [sources, setSources] = useState<Source[]>(initialSources);
  const [now, setNow] = useState(Date.now);
  const [refresh, setRefresh] = useState(0);
  const [selectedId, setSelectedId] = useState('');
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('Todos');
  const [brandProject, setBrandProject] = useState('Todas');
  const [signal, setSignal] = useState('Todas');
  const [view, setView] = useState<'scene' | 'list'>('scene');
  const detail = useRef<HTMLElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    setSources(initialSources());
    if (!ownerId) return () => controller.abort();
    void (async () => {
      const auth = await readSource('/api/auth/me', controller.signal);
      if (controller.signal.aborted) return;
      if (!worldOwnerMatches(ownerId, auth)) {
        setSources(sourcePaths.map(() => ({ state: auth.state === 'error' ? 'error' : 'denied' })));
        return;
      }
      // BlackRoom GET can initialize persistence. No automatic request until a
      // separately reviewed passive owner-only endpoint is available.
      const values = await Promise.all(sourcePaths.slice(0, 2).map(path => readSource(path, controller.signal)));
      if (controller.signal.aborted) return;
      // An expired session invalidates the whole batch, even if another read succeeded.
      setSources(values[0].state === 'denied' || values[1].state === 'denied'
        ? sourcePaths.map(() => ({ state: 'denied' }))
        : [...values, { state: 'error' }]);
      setNow(Date.now());
    })();
    return () => controller.abort();
  }, [ownerId, refresh]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const entities = useMemo(() => buildWorld(ownerId, sources[0], sources[1], sources[2], now), [ownerId, sources, now]);
  const brandProjects = useMemo(
    () => [...new Set(entities.map(entity => entity.brandProject).filter(value => value !== 'Desconocido'))].sort((a, b) => a.localeCompare(b, 'es')),
    [entities],
  );
  useEffect(() => {
    if (brandProject !== 'Todas' && brandProject !== 'Desconocido' && !brandProjects.includes(brandProject)) setBrandProject('Todas');
  }, [brandProject, brandProjects]);
  const visible = useMemo(() => filterWorld(entities, search, department, brandProject, signal), [entities, search, department, brandProject, signal]);
  const selected = visible.find(entity => entity.id === selectedId);
  const learning = useMemo(() => readLearning(sources[2], now), [sources, now]);
  const select = (entity: Entity) => {
    setSelectedId(entity.id);
    requestAnimationFrame(() => detail.current?.focus({ preventScroll: true }));
  };
  return <section className="company-agents-world ops-world" aria-labelledby="agents-world-heading">
     <header className="world-heading">
       <div><h2 id="agents-world-heading">Mundo 3D · departamentos y evidencia</h2><p>Solo lectura · catálogo conceptual y registros disponibles. Una figura no demuestra trabajo real.</p></div>
      <button type="button" onClick={() => setRefresh(value => value + 1)}>Actualizar lecturas</button>
    </header>
     <aside className="world-classification" aria-label="Alcance de la clasificación">
       <strong>Mapa funcional conceptual</strong>
       <span>No es un organigrama: no representa personas, asignaciones reales ni KPIs. Departamento y marca/proyecto son campos independientes; sin relación verificable, se muestra «Desconocido».</span>
     </aside>
    <ul className="world-sources" aria-label="Estado de fuentes">{sourcePaths.map((path, index) => <li key={path}><code>{path}</code> · {sourceLabels[sources[index].state]}</li>)}</ul>
     <p>BlackRoom: fuente deshabilitada en esta vista; no se solicita su endpoint ni se infiere actividad.</p>
    <div className="world-filters">
       <label>Buscar entidad<input type="search" value={search} onChange={event => setSearch(event.target.value)} /></label>
       <label>Departamento<select aria-label="Departamento" value={department} onChange={event => setDepartment(event.target.value)}>{['Todos', ...departments, 'Desconocido'].map(value => <option key={value}>{value}</option>)}</select></label>
       <label>Marca / proyecto<select aria-label="Marca / proyecto" value={brandProject} onChange={event => setBrandProject(event.target.value)}>{['Todas', ...brandProjects, 'Desconocido'].map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Señal<select value={signal} onChange={event => setSignal(event.target.value)}>{['Todas', 'Sin señal', 'No verificado', 'Señal reciente', 'Obsoleto'].map(value => <option key={value}>{value}</option>)}</select></label>
      <div role="group" aria-label="Vista del mundo"><button type="button" aria-pressed={view === 'scene'} onClick={() => setView('scene')}>Vista 3D</button><button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}>Lista accesible</button></div>
    </div>
     <p role="status">{visible.length} entidades · catálogo y registros; no indica agentes ejecutándose.</p>
    {view === 'scene'
      ? <Suspense fallback={<p role="status">Cargando renderer 3D…</p>}><AgentsWorldScene entities={entities} visible={visible} selectedId={selected?.id} suspended={suspended} onSelect={select} /></Suspense>
       : <ul className="world-directory" aria-label="Directorio de entidades">{visible.map(entity => <li key={entity.id}><button type="button" data-entity-id={entity.id} aria-pressed={selected?.id === entity.id} onClick={() => select(entity)}>{entity.name}<small>Departamento: {entity.department} · Marca/proyecto: {entity.brandProject}</small><small>{entity.catalogStatus} · {entity.connection} · {entity.signal}</small></button></li>)}</ul>}
    {!visible.length && <p role="status">Sin entidades para estos filtros. No implica ausencia de actividad real.</p>}
    {selected && <aside ref={detail} tabIndex={-1} className="world-detail" aria-labelledby="world-detail-heading">
       <h3 id="world-detail-heading">{selected.name}</h3><p>{selected.catalogStatus} · {selected.connection}</p><p>{selected.role}</p>
       <p><strong>Departamento:</strong> {selected.department} · <strong>Marca/proyecto:</strong> {selected.brandProject}</p>
      <dl><dt>Señal</dt><dd>{selected.signal}{selected.lastSignal && ` · ${selected.lastSignal}`}</dd><dt>Tarea</dt><dd>{selected.task}</dd><dt>Dependencias</dt><dd>{selected.dependencies}</dd><dt>Resultado</dt><dd>{selected.result}</dd><dt>Evidencia</dt><dd>{selected.evidence}</dd></dl>
      {selected.href && <Link href={selected.href}>Abrir herramienta existente · conserva sus permisos</Link>}
      <button type="button" onClick={() => setSelectedId('')}>Cerrar ficha</button>
    </aside>}
    <section className="world-learning" aria-label="Aprendizaje y cooperación">
      <h3>Aprendizaje y cooperación</h3>
      <p>No hay cooperación, ejecución ni aprendizaje verificados por esta vista. Los roles de contenido permanecen «No conectado».</p>
      {learning.length ? learning.map(item => <article key={`${item.network}:${item.id}`}><strong>{item.network} · decisión reportada {item.id}</strong><p>{item.status} · {item.window}</p><p>{item.winner}</p><small>Fuente owner: /api/blackroom-agent · {item.observedAt} · test {item.testId}</small></article>) : <p>Sin observaciones de aprendizaje verificables disponibles.</p>}
    </section>
     <section className="world-governance" aria-labelledby="world-governance-heading">
       <h3 id="world-governance-heading">De propuesta a despliegue</h3>
       <ol aria-label="Proceso de autorización">
         <li><strong>Propuesta</strong><span>Alcance y criterio de éxito documentados.</span></li>
         <li><strong>Pruebas</strong><span>Validación con evidencia y límites acordados.</span></li>
         <li><strong>Revisión independiente</strong><span>Evaluación separada antes de cualquier decisión.</span></li>
         <li><strong>Despliegue autorizado</strong><span>Solo tras autorización explícita; este catálogo no ejecuta cambios.</span></li>
       </ol>
       <p>Los límites de coste son criterios descriptivos para revisión; no son presupuestos, métricas reales ni permisos de gasto.</p>
     </section>
  </section>;
}
