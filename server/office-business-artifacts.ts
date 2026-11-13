import {canonicalEvidenceDigest as digest} from "./evidence-json";
import {validateBusinessSource,type BusinessRole,type BusinessSource} from "./office-business-sources";
export type BusinessFinding={code:string;recordIds:string[];detail:string;nextAction:string;closureCheck:string};
export type BusinessArtifact={version:1;role:BusinessRole;scope:string;status:"completed"|"blocked";sourceDigest:string;text:string;findings:BusinessFinding[];calculations:Record<string,string>;validation:{method:"deterministic_recomputation";fullRoleQualification:false;externalActions:0};artifactId:string};
const SCALE=10n**18n;
function atoms(value:string){const negative=value.startsWith("-"),[whole,fraction=""]=value.replace(/^-/,'').split('.');return (BigInt(whole)*SCALE+BigInt(fraction.padEnd(18,'0')))*(negative?-1n:1n);}
function decimal(value:bigint,scale=18){const negative=value<0n,raw=(negative?-value:value).toString().padStart(scale+1,'0'),fraction=raw.slice(-scale).replace(/0+$/,'');return `${negative?'-':''}${raw.slice(0,-scale)}${fraction?'.'+fraction:''}`;}

/** Actual document production from verified records, not a classifier score.
 * An independent reload recomputes every figure/step from the retained source. */
export function buildBusinessArtifact(raw:BusinessSource,owner:string,at:number):BusinessArtifact{
 const source=validateBusinessSource(raw,owner,at),findings:BusinessFinding[]=[],calculations:Record<string,string>={};
 let status:"completed"|"blocked"="completed",scope:string;
 const add=(code:string,ids:string[],detail:string,nextAction:string,closureCheck:string)=>findings.push({code,recordIds:ids,detail,nextAction,closureCheck});
 if(source.role==="automations"){
  scope="Expediente de reparacion de automatizaciones basado en definiciones y ultima ejecucion guardada por cada una; no ejecuta scheduler, cambios ni envios.";
  if(!source.definitions.length||source.definitionTotal>source.definitions.length){status="blocked";add("INCOMPLETE_DEFINITION_SET",[],`Definiciones disponibles: ${source.definitions.length}/${source.definitionTotal}.`,"Completar inventario antes de afirmar cobertura.","Consulta owner devuelve el conjunto completo y no vacio.");}
  for(const d of source.definitions){
   const run=source.latestRuns.find(r=>r.automationId===d.id),ids=[d.id,...(run?[run.id]:[])];
   let validTimezone=true;try{new Intl.DateTimeFormat('en',{timeZone:d.timezone}).format();}catch{validTimezone=false;}
   if(!validTimezone)add("INVALID_TIMEZONE",ids,`${d.name}: zona horaria guardada no reconocida.`,"Proponer correccion de zona con aprobacion; no alterar horario automaticamente.","Zona valida y proxima ejecucion calculada por el scheduler existente.");
   if(d.status!=="active"){add("NOT_SCHEDULED_ACTIVE",ids,`${d.name}: estado ${d.status}; no se interpreta como incumplimiento.`,"Revisar si la pausa/desactivacion sigue siendo intencional.","Decision del propietario o estado explicito conservado.");continue;}
   if(!run){add("NO_EXECUTION_RECEIPT",ids,`${d.name}: no hay ejecucion guardada para esta definicion.`,"Verificar registro y heartbeat del scheduler existente antes de habilitar o repetir trabajo.","Primer run autenticado del owner con inicio, fin y resultado.");continue;}
   if(run.status==="pending_approval"){add("WAITING_APPROVAL",ids,`${d.name}: espera de aprobacion registrada.`,"Abrir la aprobacion existente; no duplicar el envio ni descontar vida.","La aprobacion referida se resuelve y el mismo flujo registra su resultado.");continue;}
   if(!run.finishedAt){add("UNFINISHED_RECEIPT",ids,`${d.name}: ultimo run sin hora final.`,"Inspeccionar el worker y reconciliar el resultado antes de reintentar.","Recibo terminal del mismo run o reconciliacion explicita.");continue;}
   if(run.status==="failed"){
    const action:Record<string,string>={AUTH_REQUIRED:"Revalidar la conexion autorizada del ejecutor; no copiar credenciales.",RATE_LIMITED:"Revisar el limite del proveedor y su ventana; no aumentar concurrencia ni presupuesto.",MISSING_CONNECTION:"Identificar y completar la conexion existente que falta antes de reintentar.",VALIDATION_FAILED:"Comparar el contrato del handler con el resultado del run y preparar una correccion verificable.",TIMEOUT:"Verificar si hubo efectos externos antes de decidir un reintento.",UNKNOWN:"Examinar evidencia privada del run; la causa no esta determinada por el registro disponible."};
    add("FAILED_EXECUTION",ids,`${d.name}: fallo terminal registrado; codigo guardado ${run.failureCode}, sin afirmar causa reproducida.`,action[run.failureCode],"Correccion aprobada y siguiente ejecucion real del mismo handler termina correctamente, sin duplicar efectos.");
   }
   if(d.lastRunAt!==run.startedAt||d.lastStatus!==run.status)add("SUMMARY_RECEIPT_MISMATCH",ids,`${d.name}: resumen de definicion y ultimo recibo discrepan.`,"Preparar reconciliacion de metadatos usando este run y precondicion de no existir un run mas reciente.","Relectura atomica mantiene runID y summary lastRunAt/lastStatus coincide, sin tocar resultados.");
   if(!d.nextRunAt||(d.lastRunAt&&Date.parse(d.nextRunAt)<=Date.parse(d.lastRunAt)))add("NEXT_SCHEDULE_UNVERIFIED",ids,`${d.name}: fecha proxima ausente o ya consumida.`,"Revisar el calculo del scheduler para el scheduleKind guardado; no inventar nextRunAt.","Scheduler registra nueva fecha futura consistente con timezone y regla.");
  }
  calculations.definitions=String(source.definitionTotal);calculations.latestReceipts=String(source.latestRuns.length);
 }else{
  scope="Conciliacion exacta de posiciones y libro de transacciones guardados; no acredita saldo de broker, integridad historica, valor de mercado ni recomienda operaciones.";
  const complete=source.holdingTotal===source.holdings.length&&source.transactionTotal===source.transactions.length;
  if(!complete||!source.holdings.length||!source.transactions.length){status="blocked";add("LEDGER_COVERAGE_UNCONFIRMED",[],`Posiciones ${source.holdings.length}/${source.holdingTotal}; transacciones ${source.transactions.length}/${source.transactionTotal}.`,"Aportar el libro completo y saldos iniciales, transferencias y splits antes de cerrar conciliacion.","Ambos conjuntos completos con evidencia de periodo y saldo inicial.");}
  const quantities=new Map<string,bigint>(),costs=new Map<string,bigint>();
  for(const t of source.transactions){
   const quantity=atoms(t.quantity),price=atoms(t.price),total=atoms(t.totalValue);
   if(quantity<0n||price<0n||total<0n){add("NEGATIVE_TRANSACTION_VALUE",[t.id],"Cantidad/precio/importe negativo requiere aclarar contrato de signos.","Verificar documento original; no invertir el signo automaticamente.","Importe y signo documentados y conciliados.");continue;}
   const calculated=quantity*price,delta=total*SCALE-calculated;
   calculations[`transaction:${t.id}:quantityTimesPrice`]=decimal(calculated,36);
   if(delta!==0n)add("RECORDED_AMOUNT_DIFFERENCE",[t.id],`${t.currency}: declarado ${t.totalValue}, cantidad por precio ${decimal(calculated,36)}, diferencia ${decimal(delta,36)}.`,"Verificar comisiones/redondeo o error de carga contra recibo; no sustituir importes.","Diferencia explicada por componentes documentados o correccion aprobada.");
   const matches=t.investmentId?source.holdings.filter(h=>h.id===t.investmentId):source.holdings.filter(h=>h.symbol===t.symbol&&h.currency===t.currency);
   if(matches.length!==1||matches[0].symbol!==t.symbol||matches[0].currency!==t.currency){add("POSITION_LINK_UNRESOLVED",[t.id],"Transaccion sin enlace inequivoco a posicion del mismo owner, simbolo y moneda.","Revisar enlace original o aportar posicion faltante; no mezclar monedas ni propietarios.","Unica posicion compatible vinculada con aprobacion.");continue;}
   const h=matches[0];quantities.set(h.id,(quantities.get(h.id)||0n)+(t.type==="buy"?quantity:-quantity));
  }
  for(const h of source.holdings){
   const recorded=atoms(h.quantity),ledger=quantities.get(h.id),price=atoms(h.avgBuyPrice);
   if(price<0n){add("NEGATIVE_COST_BASIS",[h.id],"Precio medio negativo no permite costo fiable.","Verificar registro de costo original.","Costo documentado valido.");continue;}
   costs.set(h.currency,(costs.get(h.currency)||0n)+recorded*price);
   calculations[`position:${h.id}:recordedQuantity`]=h.quantity;
   if(ledger===undefined){add("NO_LINKED_TRANSACTIONS",[h.id],`${h.symbol}: ninguna transaccion vinculada en el libro disponible.`,"Aportar saldo inicial o historial; no asumir posicion inexistente.","Saldo respaldado por documento o libro completo.");continue;}
   calculations[`position:${h.id}:ledgerQuantity`]=decimal(ledger);calculations[`position:${h.id}:difference`]=decimal(recorded-ledger);
   if(recorded!==ledger)add("POSITION_LEDGER_DIFFERENCE",[h.id],`${h.symbol} ${h.currency}: posicion ${h.quantity}, neto del libro ${decimal(ledger)}, diferencia ${decimal(recorded-ledger)}.`,"Conciliar saldo inicial, transferencias y splits contra extracto antes de corregir.","Diferencia explicada con evidencia; no basta cambiar el numero guardado.");
  }
  for(const [currency,total] of costs)calculations[`recordedCostBasis:${currency}`]=decimal(total,36);
 }
 const text=[scope,`Estado del expediente: ${status}.`,...Object.entries(calculations).map(([key,value])=>`${key}: ${value}`),...findings.map((f,i)=>`${i+1}. ${f.code} [${f.recordIds.join(', ')}]\n${f.detail}\nSiguiente paso: ${f.nextAction}\nCierre verificable: ${f.closureCheck}`),findings.length?"Los hallazgos no ejecutan correcciones ni acciones externas.":"Sin diferencias en estas comprobaciones; no acredita capacidad completa ni conciliacion externa."].join('\n\n');
 const body={version:1 as const,role:source.role,scope,status,sourceDigest:source.sourceDigest,text,findings,calculations,validation:{method:"deterministic_recomputation" as const,fullRoleQualification:false as const,externalActions:0 as const}};
 return {...body,artifactId:digest(body)};
}
