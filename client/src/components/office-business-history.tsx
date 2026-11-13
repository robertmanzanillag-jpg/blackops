import {useQuery} from "@tanstack/react-query";
import {apiRequest} from "@/lib/queryClient";
type Job={id:string;role:string;generation:number;status:string;startedAt:string;completedAt?:string;reason?:string;artifact?:{text?:string;html?:string}};
type History={ownerId:string;checkedAt:string;jobs:Job[];capacity?:{reached:boolean;usedJobs:number;maxJobs:number};availability?:Array<{role:string;available:boolean;reason:string}>};
const names:Record<string,string>={automations:"Automatizaciones",portfolio:"Cartera",news:"Mesa editorial","news:ny-news":"Noticias de Nueva York","news:miami-news":"Noticias de Miami",revenue:"Revenue"};
const statuses:Record<string,string>={completed:"Entregable guardado",blocked:"Falta una condición necesaria",running:"En ejecución",unknown:"Resultado sin confirmar",failed:"Falló"};
const noCandidate="No hay otro prospecto con evidencia verificada disponible para preparar una maqueta.";
const admissionReasons:Record<string,string>={historical_score_unverified:"puntuación histórica sin verificar; requiere calificación de esta capacidad",training:"el reemplazo sigue en formación",depleted:"la puntuación guardada está en cero; requiere revisión antes de admitir trabajo",unverified:"no se pudo verificar su elegibilidad"};
const reasons:Record<string,string>={SOURCE_UNAVAILABLE:"No se pudo verificar la fuente de datos.",LEASE_EXPIRED:"La ejecución excedió su plazo; requiere revisión antes de repetirla.",HOLDER_CHANGED:"Cambió el agente asignado durante la ejecución.",HISTORY_CAPACITY:"El historial alcanzó su capacidad; requiere revisión.",STOP_REQUESTED:"El ejecutor se detuvo antes de consultar los datos.",ARTIFACT_LIMIT:"El entregable excede el espacio disponible; requiere revisión."};
export function OfficeBusinessHistory({sessionScope,ownerId,kind="business"}:{sessionScope:string|null|undefined;ownerId:string|null;kind?:"business"|"editorial"|"revenue"}){
 const title=kind==="revenue"?"Maquetas internas de Revenue":kind==="editorial"?"Paquetes editoriales":"Entregables de trabajo interno";
 const query=useQuery<History>({queryKey:["office-business-history",kind,sessionScope],queryFn:async()=>{const response=await apiRequest("GET",`/api/agents-office/${kind}-work`);return response.json();},enabled:Boolean(sessionScope&&ownerId),retry:false,staleTime:0,gcTime:0,refetchInterval:30000});
 const data=sessionScope&&ownerId&&!query.isError&&query.data?.ownerId===ownerId?query.data:undefined;
 return <section aria-label={title} className="space-y-2 border-t border-cyan-200/20 pt-3">
  <h3 className="text-sm font-semibold">{title}</h3>
  <p className="text-xs text-slate-300">{kind==="revenue"?"Conceptos visuales basados en evidencia guardada de prospectos. No se publican, no contactan negocios ni acreditan ventas o aprobación comercial.":kind==="editorial"?"Borradores atribuidos a fuentes públicas y mesa de revisión NY/Miami. Conservan las restricciones de la cola original; no se publican ni acreditan investigación independiente.":"Expedientes de automatizaciones y conciliación de cartera. No ejecutan reparaciones, operaciones financieras ni acciones externas; no acreditan el puesto completo."}</p>
  {!sessionScope||!ownerId?<p className="text-xs">Verificando acceso al historial…</p>:query.isError?<p role="alert" className="text-xs text-amber-200">No se pudo verificar el historial de entregables.</p>:!data?<p className="text-xs">Cargando entregables…</p>:<>
   <p className="text-xs text-slate-400">Consulta: {new Date(data.checkedAt).toLocaleString()}. Son resultados guardados, no una señal de actividad actual.</p>
   {data.availability?.filter(a=>!a.available).map(a=><p key={a.role} className="text-xs text-amber-200">{names[a.role]??a.role}: sin nuevas tareas porque {admissionReasons[a.reason]??"falta una condición verificada"}.</p>)}
   {data.capacity?.reached&&<p role="alert" className="text-xs text-amber-200">El historial alcanzó su capacidad. Las nuevas tareas de este historial están detenidas hasta revisar el archivo; sus resultados se conservan.</p>}
   {!data.jobs.length?<p className="text-xs">Todavía no hay entregables registrados.</p>:data.jobs.slice(-20).reverse().map(job=><article key={job.id} className="rounded-lg border border-white/10 p-2 text-xs">
    <p className="font-semibold">{names[job.role]??job.role} · generación {job.generation}</p>
    <p>{statuses[job.status]??"Estado sin verificar"} · {new Date(job.completedAt??job.startedAt).toLocaleString()}</p>
    {job.reason&&<p className="text-amber-200">{job.reason==="NO_ELIGIBLE_CANDIDATE"?noCandidate:reasons[job.reason]??"Existe un bloqueo pendiente de revisión."}</p>}
    {["completed","blocked"].includes(job.status)&&job.artifact?.text&&<details className="mt-2"><summary className="cursor-pointer">Leer entregable</summary><pre className="mt-2 whitespace-pre-wrap break-words font-sans">{job.artifact.text}</pre></details>}
    {kind==="revenue"&&job.status==="completed"&&job.artifact?.html&&<details className="mt-2"><summary className="cursor-pointer">Ver maqueta interna</summary><iframe title={`Maqueta interna ${job.id}`} sandbox="" referrerPolicy="no-referrer" srcDoc={job.artifact.html} className="mt-2 h-96 w-full rounded border border-white/10"/></details>}
   </article>)}
  </>}
 </section>;
}
