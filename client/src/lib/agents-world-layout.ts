import { departments, type Department, type Entity } from './agents-world';
export const rooms: Record<Department, { x: number; z: number; width: number; depth: number; color: string }> = {
  Dirección: { x: -21, z: -12, width: 13, depth: 18, color: '#46c9c0' },
  Ingresos: { x: -7, z: -12, width: 13, depth: 18, color: '#efc47f' },
  Marketing: { x: 7, z: -12, width: 13, depth: 18, color: '#8fbeed' },
  Ingeniería: { x: 21, z: -12, width: 13, depth: 18, color: '#ab94ec' },
  Seguridad: { x: -21, z: 9, width: 13, depth: 18, color: '#e79ebf' },
  Calidad: { x: -7, z: 9, width: 13, depth: 18, color: '#83c6ad' },
  Finanzas: { x: 7, z: 9, width: 13, depth: 18, color: '#d8ad7c' },
  Contenido: { x: 21, z: 9, width: 13, depth: 18, color: '#8fbeed' },
  Operaciones: { x: -21, z: 30, width: 13, depth: 18, color: '#9bb6c8' },
  'IA y evaluación': { x: -7, z: 30, width: 13, depth: 18, color: '#b6a4d8' },
  Legal: { x: 7, z: 30, width: 13, depth: 18, color: '#c2b28c' },
  Coordinación: { x: 21, z: 30, width: 13, depth: 18, color: '#79b7b3' },
};
/** Deterministic conceptual placement. Never interpreted as presence or work. */
export function stationLayout(entities: Entity[]) {
  return departments.flatMap(department => {
    const items=entities.filter(entity=>entity.department===department), room=rooms[department];
    const cols=Math.max(1,Math.ceil(Math.sqrt(items.length*room.width/room.depth)));
    const rows=Math.max(1,Math.ceil(items.length/cols));
    return items.map((entity,i)=>({entity,color:room.color,
      x:room.x-room.width/2+3+(i%cols+.5)*(room.width-6)/cols,
      z:room.z-room.depth/2+4+(Math.floor(i/cols)+.5)*(room.depth-7)/rows,
    }));
  });
}
export function visualMotion(phase: number, seconds: number, enabled: boolean) {
  if (!enabled) return {x:0,z:0,leg:0,yaw:0};
  const t=seconds*.65+phase;
  return {x:Math.sin(t)*.6,z:Math.cos(t)*.45,leg:Math.sin(t*5)*.2,yaw:t};
}
export const renderBudget = (mobile: boolean, devicePixelRatio: number) => ({
  fps:mobile?20:30,pixelRatio:Math.max(1,Math.min(mobile?1:1.5,devicePixelRatio||1)),
});
