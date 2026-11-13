export const departments = [
  { id: 'leadership', name: 'Dirección', subtitle: 'Estrategia & personas', color: '#c4b5fd', agents: ['CEO', 'Asistente'], href: '/ceo' },
  { id: 'growth', name: 'Growth & ventas', subtitle: 'Pipeline & oportunidades', color: '#6ee7b7', agents: ['Revenue', 'Dropshipping'], href: '/revenue-engine' },
  { id: 'engineering', name: 'Ingeniería', subtitle: 'Producto & calidad', color: '#7dd3fc', agents: ['Code', 'GitHub', 'App QA', 'Claude Reviewer'], href: '/code-agent' },
  { id: 'creative', name: 'Estudio creativo', subtitle: 'Contenido & campañas', color: '#f9a8d4', agents: ['Marketing CMO', 'Radio', 'Clippers'], href: '/marketing-command-center' },
  { id: 'finance', name: 'Finanzas & operaciones', subtitle: 'Recursos & automatización', color: '#fcd34d', agents: ['Portfolio', 'Autos'], href: '/portfolio' },
  { id: 'trust', name: 'Seguridad & legal', subtitle: 'Confianza & protección', color: '#a5b4fc', agents: ['Cybersecurity', 'Legal', 'Control'], href: '/cybersecurity-agent' },
] as const;
export type DepartmentId = typeof departments[number]['id'];
export type SimulationState = { version: 1; day: number; month: number; credits: number; completed: number; target: number; goal: string; hires: Record<DepartmentId, number>; levels: Record<DepartmentId, number>; lastMonth: null | { completed: number; target: number } };
export const SIMULATION_KEY = 'blackops.company-simulation.v1';
const initialMap = () => Object.fromEntries(departments.map(d => [d.id, 0])) as Record<DepartmentId, number>;
export function newSimulation(): SimulationState { return { version: 1, day: 0, month: 1, credits: 2400, completed: 0, target: 180, goal: 'Entregar oportunidades y proyectos de calidad', hires: initialMap(), levels: initialMap(), lastMonth: null }; }
const integer = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max;
export function parseSimulation(raw: string | null): SimulationState {
  if (!raw) return newSimulation();
  try {
    const value = JSON.parse(raw);
    if (value?.version !== 1 || !integer(value.day, 0, 30) || !integer(value.month, 1, 100000) || !integer(value.credits, 0, 100000000) || !integer(value.completed, 0, 100000000) || !integer(value.target, 1, 100000) || typeof value.goal !== 'string' || value.goal.length > 120 || !value.goal.trim()) return newSimulation();
    for (const d of departments) if (!integer(value.hires?.[d.id], 0, 4) || !integer(value.levels?.[d.id], 0, 3)) return newSimulation();
    if (value.lastMonth !== null && (!integer(value.lastMonth?.completed, 0, 100000000) || !integer(value.lastMonth?.target, 1, 100000))) return newSimulation();
    return { ...value, hires: Object.fromEntries(departments.map(d => [d.id, value.hires[d.id]])), levels: Object.fromEntries(departments.map(d => [d.id, value.levels[d.id]])) };
  } catch { return newSimulation(); }
}
export function dailyCapacity(state: SimulationState) { return 6 + Object.values(state.hires).reduce((a,b) => a+b,0) * 2 + Object.values(state.levels).reduce((a,b) => a+b,0); }
export function advanceDay(state: SimulationState): SimulationState {
  if (state.day >= 30) return state;
  return { ...state, day: state.day + 1, completed: Math.min(100000000, state.completed + dailyCapacity(state)), credits: Math.min(100000000, state.credits + 180) };
}
export function hireCost(state: SimulationState, id: DepartmentId) { return 600 + state.hires[id] * 200; }
export function upgradeCost(state: SimulationState, id: DepartmentId) { return 800 + state.levels[id] * 400; }
export function hireAgent(state: SimulationState, id: DepartmentId): SimulationState {
  const cost = hireCost(state,id); if (state.hires[id] >= 4 || state.credits < cost) return state;
  return { ...state, credits: state.credits-cost, hires: {...state.hires,[id]: state.hires[id]+1} };
}
export function upgradeDepartment(state: SimulationState, id: DepartmentId): SimulationState {
  const cost = upgradeCost(state,id); if (state.levels[id] >= 3 || state.credits < cost) return state;
  return { ...state, credits: state.credits-cost, levels: {...state.levels,[id]: state.levels[id]+1} };
}
export function nextMonth(state: SimulationState): SimulationState {
  if (state.day !== 30 || state.month >= 100000) return state;
  return {...state, day: 0, month: state.month+1, completed: 0, lastMonth: { completed: state.completed, target: state.target } };
}
