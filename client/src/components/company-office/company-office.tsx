import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useReducedMotion } from 'framer-motion';
import { Link } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Building2, ChevronRight, Pause, Play, Plus, Target, Users, Zap } from 'lucide-react';
import { departments, newSimulation, parseSimulation, SIMULATION_KEY, dailyCapacity, advanceDay, hireAgent, hireCost, upgradeCost, upgradeDepartment, nextMonth } from './company-simulation';
import './company-office.css';
import { ownerOfficeStorageKey } from '@/lib/owner-office-storage';
import { AgentsWorldOffice } from './agents-world-office';
const news = [
  ['Growth → Dirección', 'Encontramos una oportunidad. Validamos margen antes de avanzar.'],
  ['Ingeniería → Seguridad', 'Nueva entrega preparada. Necesitamos revisión y QA.'],
  ['Creativo → Growth', 'Compartimos tres ideas de campaña para el siguiente sprint.'],
  ['Finanzas → Dirección', 'Revisamos capacidad y recursos para llegar a la meta mensual.'],
  ['Seguridad → Ingeniería', 'La revisión vuelve al equipo con mejoras para el siguiente ciclo.'],
  ['Dirección → Todos', 'Reunión de equipo: priorizamos el trabajo que acerca la meta.'],
];
const agentLinks: Record<string,string> = { CEO:'/ceo', Asistente:'/assistant', Revenue:'/revenue-engine', Dropshipping:'/dropshipping-ceo', Code:'/code-agent', GitHub:'/github-agent', 'App QA':'/app-qa-agent', 'Claude Reviewer':'/github-agent', 'Marketing CMO':'/marketing-command-center', Radio:'/radio', Clippers:'/clippers', Portfolio:'/portfolio', Autos:'/automations', Cybersecurity:'/cybersecurity-agent', Legal:'/legal-compliance', Control:'/tools' };
export function CompanyOffice({ ownerId }: { ownerId: string }) {
  const storageKey = ownerOfficeStorageKey(SIMULATION_KEY, ownerId);
  const [state,setState] = useState(() => { try { return parseSimulation(localStorage.getItem(storageKey)); } catch { return newSimulation(); } });
  const [storageWarning,setStorageWarning] = useState(false);
  const [selected,setSelected] = useState(0);
  const [selectedAgent,setSelectedAgent] = useState('CEO');
  const reduced = useReducedMotion();
  const [paused,setPaused] = useState(false);
  const [tick,setTick] = useState(0);
  const [zoom,setZoom] = useState(1);
  const mapRef = useRef<HTMLDivElement>(null);
  const [mapWidth,setMapWidth] = useState(960);
  useEffect(() => {
    const element = mapRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setMapWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const sceneScale = Math.min(1, mapWidth / 1280) * zoom;
  const [goal,setGoal] = useState(state.goal);
  const [target,setTarget] = useState(String(state.target));
  const [notice,setNotice] = useState('Selecciona un departamento para dirigir tu empresa.');
  const running = !paused && !reduced;
  useEffect(() => { try { localStorage.setItem(storageKey,JSON.stringify(state)); setStorageWarning(false); } catch { setStorageWarning(true); } }, [state, storageKey]);
  useEffect(() => { if (!running) return; const interval = window.setInterval(() => setTick(t => t+1),6000); return () => clearInterval(interval); },[running]);
  const realGoals = useQuery<{id:string; title:string; completed:boolean}[]>({
    queryKey: ['company-office-real-monthly-goals', ownerId],
    queryFn: async () => {
      const response = await fetch('/api/monthly-goals', { credentials: 'include' });
      if (!response.ok) throw new Error('No se pudieron cargar las metas reales.');
      const data: unknown = await response.json();
      if (!Array.isArray(data) || !data.every(g => typeof g?.id === 'string' && typeof g?.title === 'string' && typeof g?.completed === 'boolean')) throw new Error('Respuesta de metas no disponible.');
      return data;
    }, retry: false, staleTime: 60000,
  });
  const department = departments[selected];
  const team = departments.reduce((n,d) => n+d.agents.length+state.hires[d.id],0);
  const progress = state.completed/state.target*100;
  const capacity = dailyCapacity(state);
  const projection = state.completed+(30-state.day)*capacity;
  const selectDepartment = (index: number) => { setSelected(index); setSelectedAgent(departments[index].agents[0]); };
  return <div className="company-office" data-paused={!running}>
    <header className="company-header">
      <div className="company-brand"><span className="company-logo"><Building2 size={24}/></span><div><span className="company-eyebrow">BLACKOPS · COMPANY WORLD</span><h1>Tu empresa, en movimiento.</h1></div></div>
      <Link href="/dashboard" className="company-link">Dashboard <ArrowUpRight size={15}/></Link>
    </header>
    <div className="company-intro"><p>Explora seis departamentos y planifica un mes de 30 días. Actividad y resultados simulados.</p><span className="simulation-badge">SIMULACIÓN · sin gasto real</span></div>
    <AgentsWorldOffice key={ownerId} ownerId={ownerId} suspended={!running} />
    <div className="company-stats">
      <div><span>Equipo simulado</span><strong>{team} <small>agentes</small></strong></div>
      <div><span>Recursos simulados</span><strong>{state.credits.toLocaleString('es')} <small>créditos</small></strong></div>
      <div><span>Mes {state.month} · día {state.day}/30</span><strong>{state.completed} <small>entregas simuladas</small></strong></div>
      <div><span>Meta del mes</span><strong>{Math.round(progress)}% <small>{progress >= 100 ? '¡Superada!' : `${state.target} entregas`}</small></strong></div>
    </div>
    <div className="company-layout">
      <section className="company-world" aria-label="Mapa de la empresa">
        <div className="company-map-toolbar"><div><span className="world-dot"/> CAMPUS / SIMULACIÓN</div><div className="company-map-actions"><label htmlFor="office-zoom">Zoom</label><input id="office-zoom" aria-label="Zoom del campus" type="range" min="0.75" max="1.2" step="0.05" value={zoom} onChange={e=>setZoom(Number(e.target.value))}/><button type="button" onClick={()=>setPaused(p=>!p)} disabled={!!reduced} aria-label={running?'Pausar movimiento':'Reanudar movimiento'}>{running?<Pause size={15}/>:<Play size={15}/>} {reduced?'Movimiento reducido':running?'Pausar':'Reanudar'}</button></div></div>
        <nav className="company-departments" aria-label="Departamentos">{departments.map((d,index)=><button key={d.id} type="button" aria-pressed={selected===index} onClick={()=>selectDepartment(index)} style={{'--department':d.color} as CSSProperties}><span>0{index+1}</span>{d.name}</button>)}</nav>
        <div ref={mapRef} className="company-map-scroll" tabIndex={0} aria-label="Campus desplazable">
          <div className="company-scene-frame" style={{width:1280*sceneScale,height:960*sceneScale}}>
          <div className="company-scene" style={{'--scene-scale':sceneScale} as CSSProperties}>
            <div className="company-campus">
              <div className="campus-road road-horizontal"/><div className="campus-road road-vertical"/>
              <div className="campus-plaza"><span>BLACKOPS</span><small>COMPANY CAMPUS</small><div className="plaza-fountain"/></div>
              {departments.map((d,index)=><div key={d.id} className={`company-building building-${index} ${selected===index?'building-selected':''}`} style={{'--department':d.color,'--level':state.levels[d.id]} as CSSProperties}>
                <div className="building-wall wall-back"/><div className="building-wall wall-side"/>
                <button className="building-floor" type="button" onClick={()=>selectDepartment(index)} aria-label={`Seleccionar departamento ${d.name}`} aria-pressed={selected===index}>
                  <div className="building-sign"><span>0{index+1}</span><strong>{d.name}</strong><small>NIVEL {state.levels[d.id]+1} · {d.agents.length+state.hires[d.id]} AGENTES</small></div>
                  <div className="building-furniture"><i className="office-desk"/><i className="office-desk"/><i className="office-desk"/><i className="office-plant"/><i className="office-rug"/>{state.levels[d.id]>0&&<i className="office-upgrade">★ {state.levels[d.id]}</i>}</div>
                </button>
              </div>)}
              {departments.flatMap((d,index)=>Array.from({length: d.agents.length+state.hires[d.id]},(_,i)=>{
                const name=d.agents[i] || `Scout ${i-d.agents.length+1}`;
                return <button key={`${d.id}-${i}`} type="button" aria-label={`Seleccionar agente ${name} de ${d.name}`} title={name} aria-pressed={selected===index && selectedAgent===name} className={`company-person person-dept-${index}`} style={{'--department':d.color,'--person-x':`${(index%3)*320+75+(i%4)*48}px`,'--person-y':`${Math.floor(index/3)*350+118+Math.floor(i/4)*44}px`,'--delay':`${i*1.4+index}s`,'--direction':i%2?1:-1} as CSSProperties} onClick={()=>{setSelected(index);setSelectedAgent(name);}}>
                  <span className="person-shadow"/><span className="person-legs"/><span className="person-body"/><span className="person-head"/><span className="person-name">{name}</span>
                </button>;
              }))}
              <div className="campus-tree tree-one"/><div className="campus-tree tree-two"/><div className="campus-tree tree-three"/>
              <div className="company-message" key={tick}><span>↗ {news[tick%news.length][0]}</span><p>{news[tick%news.length][1]}</p><small>INTERCAMBIO SIMULADO</small></div>
            </div>
          </div>
        </div>
        </div>
        <div className="company-map-footer"><span>6 departamentos · selecciona edificios o agentes</span><span>{reduced?'Movimiento reducido activo':running?'Movimiento simulado':'Movimiento pausado'}</span></div>
      </section>
      <aside className="company-panel" aria-label="Planificación de la simulación">
        <section className="company-card department-card" style={{'--department':department.color} as CSSProperties}>
          <span className="company-eyebrow">DEPARTAMENTO / 0{selected+1}</span><h2>{department.name}</h2><p>{department.subtitle}</p>
          <div className="department-team">{department.agents.map(name=><button key={name} type="button" aria-pressed={selectedAgent===name} onClick={()=>setSelectedAgent(name)}>{name}</button>)}{Array.from({length:state.hires[department.id]},(_,i)=><button key={i} type="button" aria-pressed={selectedAgent===`Scout ${i+1}`} onClick={()=>setSelectedAgent(`Scout ${i+1}`)}>Scout {i+1}</button>)}</div>
          <div className="company-selected-agent"><Users size={17}/><div><strong>{selectedAgent}</strong><small>{agentLinks[selectedAgent]?'Representación simulada · abrir herramienta real':'Nuevo miembro simulado · +2 entregas/día'}</small></div>{agentLinks[selectedAgent]&&<Link href={agentLinks[selectedAgent]} aria-label={`Abrir agente ${selectedAgent}`}><ArrowUpRight size={19}/></Link>}</div>
          <button type="button" className="company-action" disabled={state.hires[department.id]>=4 || state.credits<hireCost(state,department.id)} onClick={()=>{setState(s=>hireAgent(s,department.id));setNotice(`Nuevo scout simulado en ${department.name}.`);}}><Plus size={17}/> Contratar scout simulado <span>{state.hires[department.id]>=4?'Equipo completo':`${hireCost(state,department.id)} cr`}</span></button>
          <button type="button" className="company-action secondary" disabled={state.levels[department.id]>=3 || state.credits<upgradeCost(state,department.id)} onClick={()=>{setState(s=>upgradeDepartment(s,department.id));setNotice(`${department.name} mejorado: +1 entrega simulada/día.`);}}><Zap size={17}/> Mejorar en simulación <span>{state.levels[department.id]>=3?'Nivel máximo':`${upgradeCost(state,department.id)} cr`}</span></button>
          <small className="company-muted">Contratar +2 / día · mejorar +1 / día. Solo modifica esta simulación.</small>
        </section>
        <section className="company-card"><span className="company-eyebrow">DIRECCIÓN / META MENSUAL</span><h2>Construye el próximo mes.</h2><form onSubmit={e=>{e.preventDefault();const n=Number(target);if(!Number.isSafeInteger(n)||n<1||n>100000||!goal.trim()){setNotice('Escribe una meta y entre 1 y 100.000 entregas.');return;}setState(s=>({...s,goal:goal.trim(),target:n}));setNotice('Meta simulada guardada.');}}><label htmlFor="company-goal">Objetivo</label><input id="company-goal" maxLength={120} required value={goal} onChange={e=>setGoal(e.target.value)}/><label htmlFor="company-target">Entregas simuladas / mes</label><div className="company-goal-input"><input id="company-target" type="number" min={1} max={100000} required value={target} onChange={e=>setTarget(e.target.value)}/><button type="submit">Guardar</button></div></form>
          <div className="company-progress" role="progressbar" aria-label="Progreso de meta simulada" aria-valuemin={0} aria-valuemax={state.target} aria-valuenow={Math.min(state.completed,state.target)}><span style={{width:`${Math.min(100,progress)}%`}}/></div><div className="company-progress-label"><strong>{state.completed} / {state.target}</strong><span>{Math.round(progress)}%</span></div>
          <p className="company-forecast">Capacidad: {capacity}/día · proyección: {projection}<br/>{projection>=state.target?'Vas camino a alcanzar la meta.':'Refuerza el equipo para alcanzar la meta.'}</p>
          <button type="button" className="company-action" disabled={state.day>=30} onClick={()=>{setState(advanceDay);setNotice(`Jornada completada: +${capacity} entregas y +180 créditos simulados.`);}}>Avanzar un día <ChevronRight size={17}/></button>
          {state.day===30&&<><p className="month-result">{state.completed>=state.target?'¡Meta mensual alcanzada!':'Mes terminado. Ajusta tu estrategia para el siguiente.'}</p><button type="button" className="company-action secondary" onClick={()=>{setState(nextMonth);setNotice('Nuevo mes simulado. Tu equipo y mejoras continúan.');}}>Comenzar siguiente mes</button></>}
          {state.lastMonth&&<small className="company-muted">Mes anterior: {state.lastMonth.completed}/{state.lastMonth.target} entregas.</small>}
          <Link href="/ceo" className="company-real-link"><Target size={15}/> Gestionar metas reales <ArrowUpRight size={14}/></Link>
        </section>
      </aside>
    </div>
    <section className="company-real-goals company-card" aria-label="Metas reales del mes">
      <span className="company-eyebrow">EMPRESA REAL / MES ACTUAL</span><h2>Metas reales del mes</h2>
      {realGoals.isPending ? <p role="status">Cargando metas reales…</p> : realGoals.isError ? <p role="alert">No se pudieron cargar las metas reales. <button type="button" onClick={() => realGoals.refetch()}>Reintentar</button></p> : realGoals.data.length ? <ul>{realGoals.data.map(g => <li key={g.id}><span>{g.completed ? '✓ Completada' : '○ Pendiente'}</span> {g.title}</li>)}</ul> : <p>Aún no hay metas reales para este mes. Defínelas en tu dashboard.</p>}
      <Link href="/dashboard" className="company-real-link">Abrir dashboard y metas reales <ArrowUpRight size={14}/></Link>
    </section>
    <div className="company-status" role="status">{notice}{storageWarning?' No se puede guardar en este navegador; conserva la sesión abierta.':''}</div>
    <section className="company-news"><div><span className="company-eyebrow">LA EMPRESA COMPARTE</span><h2>Ideas que cruzan departamentos.</h2><p>Conversaciones de ejemplo. El progreso del juego no acredita resultados reales.</p></div>{[0,1,2].map(offset=>{const item=news[(tick+offset)%news.length];return <article key={offset}><span>{item[0]}</span><p>{item[1]}</p><small>NOTICIA SIMULADA · MES {state.month}</small></article>;})}</section>
  </div>;
}
