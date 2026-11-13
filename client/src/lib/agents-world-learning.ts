import { freshness, type Source } from './agents-world';
const obj=(v:unknown):Record<string,unknown> => v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const str=(v:unknown)=>typeof v==='string'?v:undefined;
/** Whitelisted projection of the existing owner-protected BlackRoom decisions. */
export function readLearning(source:Source,now:number) {
  if(source.state!=='ready')return [];
  const data=obj(source.data),remote=obj(data.remote);
  const commands=Array.isArray(remote.commands)?remote.commands:[];
  const candidate=commands.map(obj).filter(c=>c.type==='ceo_schedule').map(c=>obj(c.analytics));
  candidate.push(obj(obj(data.agent).analytics));
  const analytics=candidate.filter(a=>str(a.lastCheckedAt)&&Number.isFinite(Date.parse(String(a.lastCheckedAt)))&&Date.parse(String(a.lastCheckedAt))<=now).sort((a,b)=>Date.parse(String(b.lastCheckedAt))-Date.parse(String(a.lastCheckedAt)))[0];
  return ['tiktok','facebook','youtube'].flatMap(network=>{
    const d=obj(obj(analytics?.verifiedLearning)[network]);
    if(!str(d.id)||!str(d.testId))return [];
    const recent=freshness(d.sourceObservedAt,now,12*3600_000)==='Señal reciente';
    const validWindow=[24,72,168].includes(Number(d.windowHours));
    const evidence=Array.isArray(d.evidencePostIds)?d.evidencePostIds.filter((id):id is string=>typeof id==='string'&&!!id):[];
    return [{network,id:str(d.id)!,testId:str(d.testId)!,observedAt:str(d.sourceObservedAt)||'Sin señal',
      window:[24,72,168].includes(Number(d.windowHours))?`${d.windowHours}h`:'Sin ventana comparable',
      evidence,status:!recent?'Sin observaciones recientes verificadas':validWindow&&d.status==='testing'&&evidence.length?'Evaluación reportada · provisional':'Recolectando; sin evaluación verificable',
      winner:recent&&validWindow&&d.status==='testing'&&evidence.length&&['drop_first','instant_drop'].includes(String(d.winner))?`Hipótesis favorecida provisionalmente: ${d.winner}. No implica entrenamiento.`:'Sin mejora verificada',
    }];
  });
}
