import {GITHUB_AUDIT_ROLES,PENDING_OFFICE_ROLES,SQL_AUDIT_ROLES,sourceDigest,validateRoleSnapshot,type GithubAuditRole,type PendingOfficeRole,type RoleSnapshot} from "./office-role-snapshots";
export type RoleAudit={role:PendingOfficeRole;status:"completed"|"blocked";capability:string;scope:string;sourceDigest?:string;selected:number;total:number|null;completeCoverage:boolean;findings:Array<{code:string;recordIds:string[];detail:string}>;metrics:Record<string,number>;artifactId:string};
const limits="Auditoría de registros guardados; no acredita ejecución comercial, conexión actual, entrenamiento ni promoción.";
const blocked:Partial<Record<PendingOfficeRole,string>>={code:"Requiere PR/diff identificado y ejecutor de revisión",github:"Requiere repositorios registrados y lectura autorizada",news:"Requiere evidencia del editor existente; no iniciar otro publicador","news:ny-news":"Requiere evidencia del editor de Nueva York","news:miami-news":"Requiere evidencia del editor de Miami","blackroom-videos":"Requiere el worker externo y sus resultados",clippers:"Requiere fuentes y resultados del worker multimedia",dropshipping:"Requiere almacenamiento canónico de productos/proveedores; no usar archivos vacíos de la PC","marketing-cmo":"Requiere campañas y métricas auténticas por cliente"};
const githubLimits="Lectura de solo consulta de GitHub (metadatos, PR abiertos, checks); no acredita revisión de código, fusión, despliegue, entrenamiento ni promoción.";
const DAY=86400000,STALE_REPOSITORY_DAYS=30,STALE_PR_DAYS=7,REVIEW_WAIT_MS=DAY;
const failingConclusions=new Set(["failure","timed_out","startup_failure","action_required"]);
/** `sourceAttempted` distinguishes a configured GitHub read that failed (SOURCE_UNAVAILABLE)
 * from a worker without the GitHub reader (historical CAPABILITY_UNAVAILABLE, unchanged). */
export function auditSavedRole(role:PendingOfficeRole,source:RoleSnapshot|undefined,owner:string,now=Date.now(),options:{sourceAttempted?:boolean}={}):RoleAudit {
 if(!PENDING_OFFICE_ROLES.includes(role))throw new Error("Unknown role");
 if(GITHUB_AUDIT_ROLES.includes(role as GithubAuditRole) && (source || options.sourceAttempted))return auditGithubRole(role as GithubAuditRole,source,owner,now);
 const result:Omit<RoleAudit,"artifactId">={role,status:"blocked",capability:`saved-record-audit:${role}:v1`,scope:limits,selected:0,total:null,completeCoverage:false,findings:[],metrics:{}};
 const finish=()=>({...result,artifactId:sourceDigest(result)});
 if(!SQL_AUDIT_ROLES.includes(role as any)){result.findings.push({code:"CAPABILITY_UNAVAILABLE",recordIds:[],detail:blocked[role]!});return finish();}
 if(!source || source.role!==role){result.findings.push({code:"SOURCE_UNAVAILABLE",recordIds:[],detail:"No hay una lectura canónica verificada."});return finish();}
 const data=validateRoleSnapshot(source,owner,now);result.sourceDigest=data.sourceDigest;result.selected=data.rows.length;result.total=data.total;result.completeCoverage=data.rows.length===data.total;
 if(!data.rows.length){result.findings.push({code:"NO_SOURCE_RECORDS",recordIds:[],detail:"La consulta no devolvió registros; no prueba trabajo comercial completado."});return finish();}
 const add=(code:string,id:string,detail:string)=>result.findings.push({code,recordIds:[id],detail});
 try {
 if(role==="control"){
  const scopes=new Map<string,string[]>();for(const r of data.rows){if(r.enabled){scopes.set(r.scope,[...(scopes.get(r.scope)||[]),r.id]);if(r.level==="autonomous" && ["high","critical"].includes(r.risk))add("HIGH_RISK_AUTONOMY",r.id,"Permiso activo de alto riesgo sin aprobación.");} }
  for(const [scope,ids] of scopes)if(ids.length>1)result.findings.push({code:"DUPLICATE_SCOPE",recordIds:ids,detail:`${scope}: ${ids.length} permisos activos requieren reconciliación.`});result.metrics.enabledPermissions=data.rows.filter(r=>r.enabled).length;
 }else if(role==="automations"){
  for(const r of data.rows){if(r.failureCount>0 || r.lastStatus==="failed")add("RECORDED_FAILURE",r.id,`${r.failureCount} fallos registrados; causa no atribuida al agente.`);
   if(r.status==="active" && (!r.nextRunAt || (r.lastRunAt && Date.parse(r.nextRunAt)<=Date.parse(r.lastRunAt))))add("SCHEDULE_UNVERIFIED",r.id,"Próxima ejecución ausente o consumida; no se inventa una fecha.");
   if(r.nextRunAt && Date.parse(r.nextRunAt)<now && (!r.lastRunAt || Date.parse(r.nextRunAt)>Date.parse(r.lastRunAt)))add("SAVED_RUN_TIME_PASSED",r.id,"Fecha guardada vencida; verificar scheduler antes de atribuir incumplimiento.");}
  result.metrics.activeDefinitions=data.rows.filter(r=>r.status==="active").length;
 }else if(role==="portfolio"){
  for(const r of data.rows){if(!/^(?:\d+\.?\d*|\.\d+)$/.test(r.quantity)||!/^(?:\d+\.?\d*|\.\d+)$/.test(r.avgBuyPrice))throw new Error("Invalid holding");const cost=Number(r.quantity)*Number(r.avgBuyPrice);if(!Number.isFinite(cost))throw new Error("Invalid cost");const key=`costBasis:${r.currency}`;result.metrics[key]=(result.metrics[key]||0)+cost;}
  result.findings.push({code:"MARKET_VALUE_UNVERIFIED",recordIds:data.rows.map(r=>r.id),detail:"Solo costo de adquisición por moneda; sin precios actuales no se calculan valor actual ni ganancias."});
 }else if(role==="revenue"){
  result.metrics.bookedIncomeUsd=0;result.metrics.collectedIncomeUsd=0;result.metrics.recordedExpensesUsd=0;
  for(const r of data.rows){if(!["website_sale","automation_sale","bundle_sale","retainer","expense"].includes(r.kind))throw new Error("Unknown ledger kind");if(Date.parse(r.updatedAt)>now+30000)throw new Error("Future ledger");
   if(r.kind==="expense")result.metrics.recordedExpensesUsd+=r.amountUsd;else{result.metrics.bookedIncomeUsd+=r.amountUsd;result.metrics.collectedIncomeUsd+=r.cashCollectedUsd;if(r.cashCollectedUsd>r.amountUsd)add("COLLECTION_EXCEEDS_BOOKED",r.id,"Cobro registrado supera importe; conciliar antes de interpretar beneficio.");}
   if(now-Date.parse(r.updatedAt)>86400000)add("STALE_LEDGER_COLLECTION",r.id,"Colección sin actualizar en más de 24 horas; no acredita conciliación bancaria actual.");}
  result.metrics.uncollectedRecordedIncomeUsd=result.metrics.bookedIncomeUsd-result.metrics.collectedIncomeUsd;
 }else if(role==="legal"){
  for(const r of data.rows){if(!r.publicUrl)add("PUBLIC_SURFACE_MISSING",r.id,"Falta URL para identificar documentos públicos aplicables.");if(!r.repoOwner||!r.repoName)add("REPOSITORY_TRACE_MISSING",r.id,"Falta repositorio vinculado para verificar versión de documentos.");add("DOCUMENT_REVIEW_REQUIRED",r.id,`${r.name}: inventario guardado (${r.environment}); privacidad/términos/licencias no inspeccionados.`);}
  result.metrics.projectsInventoried=data.rows.length;
 }
 if(Object.values(result.metrics).some(v=>!Number.isFinite(v)))throw new Error("Invalid totals");result.status="completed";
 }catch{result.metrics={};result.findings=[{code:"INVALID_SOURCE_VALUES",recordIds:[],detail:"Datos inválidos impiden cálculos fiables."}];}
 return finish();
}

function auditGithubRole(role:GithubAuditRole,source:RoleSnapshot|undefined,owner:string,now:number):RoleAudit {
 const result:Omit<RoleAudit,"artifactId">={role,status:"blocked",capability:`github-read-audit:${role}:v1`,scope:githubLimits,selected:0,total:null,completeCoverage:false,findings:[],metrics:{}};
 const finish=()=>({...result,artifactId:sourceDigest(result)});
 if(!source || source.role!==role){result.findings.push({code:"SOURCE_UNAVAILABLE",recordIds:[],detail:"La lectura de GitHub o del inventario no terminó; no se reintenta automáticamente."});return finish();}
 const data=validateRoleSnapshot(source,owner,now),scope=data.github!;
 result.sourceDigest=data.sourceDigest;result.selected=data.rows.length;result.total=data.total;
 if(scope.blocked){
  const detail:Record<string,string>={NO_REGISTERED_REPOSITORIES:"El inventario app_projects no tiene repositorios github.com registrados.",GITHUB_TOKEN_INVALID:"GITHUB_TOKEN tiene un formato no reconocido; no se envió.",GITHUB_AUTH_REJECTED:"GitHub rechazó la credencial (401).",GITHUB_RATE_LIMITED:"Límite de tasa de GitHub alcanzado; se reintentará en el siguiente ciclo diario.",GITHUB_TIMEOUT:"Una solicitud a GitHub superó 10 s.",GITHUB_READ_DEADLINE:"La lectura superó el plazo total.",GITHUB_NETWORK_ERROR:"Error de red hacia api.github.com.",GITHUB_UPSTREAM_ERROR:"GitHub respondió con error de servidor.",GITHUB_RESPONSE_INVALID:"Respuesta de GitHub con forma inesperada."};
  result.findings.push({code:scope.blocked,recordIds:[],detail:detail[scope.blocked]});return finish();
 }
 const rows=data.rows as any[],add=(code:string,id:string,detail:string)=>result.findings.push({code,recordIds:[id],detail});
 const read=Math.min(scope.repositories,10);
 result.completeCoverage=!scope.truncated;
 if(role==="github"){
  const readable=rows.filter(r=>r.readable);
  for(const r of rows){
   if(!r.readable){add("REPOSITORY_UNREADABLE",r.id,`${r.repo}: no accesible (404/403) con la credencial actual.`);continue;}
   if(r.archived)add("REPOSITORY_ARCHIVED",r.id,`${r.repo}: archivado pero registrado en el inventario.`);
   else if(!r.pushedAt || now-Date.parse(r.pushedAt)>STALE_REPOSITORY_DAYS*DAY)add("STALE_REPOSITORY",r.id,`${r.repo}: sin push en más de ${STALE_REPOSITORY_DAYS} días.`);
   if(!r.runsReadable)add("WORKFLOW_UNREADABLE",r.id,`${r.repo}: ejecuciones de Actions no legibles.`);
   else if(r.latestRun && r.latestRun.status==="completed" && failingConclusions.has(r.latestRun.conclusion))add("FAILING_DEFAULT_BRANCH",r.id,`${r.repo}: última ejecución en ${r.defaultBranch} terminó en ${r.latestRun.conclusion}.`);
  }
  result.metrics={registeredRepositories:scope.repositories,repositoriesRead:rows.length,readableRepositories:readable.length,archivedRepositories:readable.filter(r=>r.archived).length,openIssuesAndPullRequests:readable.reduce((n,r)=>n+(r.openIssues??0),0),failingDefaultBranches:result.findings.filter(f=>f.code==="FAILING_DEFAULT_BRANCH").length,staleRepositories:result.findings.filter(f=>f.code==="STALE_REPOSITORY").length};
  if(!readable.length){result.findings=[{code:"REPOSITORIES_UNREADABLE",recordIds:rows.map(r=>r.id),detail:"Ningún repositorio registrado fue legible; revisar credencial y acceso."}];return finish();}
 }else{
  const prs=rows.filter(r=>r.kind==="pull_request"),unreadable=rows.filter(r=>r.kind==="repository");
  for(const r of unreadable)add("REPOSITORY_UNREADABLE",r.id,`${r.repo}: pull requests no accesibles con la credencial actual.`);
  for(const r of prs){
   const label=`${r.repo}#${r.number}`,age=now-Date.parse(r.createdAt);
   if(now-Date.parse(r.updatedAt)>STALE_PR_DAYS*DAY)add("PR_STALE",r.id,`${label}: sin actividad en más de ${STALE_PR_DAYS} días.`);
   if(r.checks===null)add("CHECKS_UNREADABLE",r.id,`${label}: check-runs no legibles.`);
   else if(r.checks.failing>0)add("PR_FAILING_CHECKS",r.id,`${label}: ${r.checks.failing} de ${r.checks.total} checks fallidos.`);
   if(r.mergeableState==="dirty")add("PR_CONFLICTED",r.id,`${label}: conflictos con la rama base.`);
   if(!r.draft && age>REVIEW_WAIT_MS && (r.requestedReviewers>0 || r.mergeableState==="blocked"))add("PR_NEEDS_REVIEW",r.id,`${label}: revisión solicitada o requerida pendiente desde hace más de 24 h.`);
  }
  result.metrics={registeredRepositories:scope.repositories,repositoriesRead:read,unreadableRepositories:unreadable.length,openPullRequests:prs.length,draftPullRequests:prs.filter(r=>r.draft).length,failingCheckPullRequests:result.findings.filter(f=>f.code==="PR_FAILING_CHECKS").length,needsReviewPullRequests:result.findings.filter(f=>f.code==="PR_NEEDS_REVIEW").length,stalePullRequests:result.findings.filter(f=>f.code==="PR_STALE").length,oldestPullRequestAgeDays:prs.length?Math.floor(Math.max(...prs.map(r=>now-Date.parse(r.createdAt)))/DAY):0};
  if(unreadable.length===read){result.findings=[{code:"REPOSITORIES_UNREADABLE",recordIds:unreadable.map(r=>r.id),detail:"Ningún repositorio registrado fue legible; revisar credencial y acceso."}];return finish();}
 }
 if(scope.truncated)result.findings.push({code:"PARTIAL_COVERAGE",recordIds:[],detail:`Lectura acotada (máx. 10 repositorios / 30 PR); cobertura parcial.`});
 if(Object.values(result.metrics).some(v=>!Number.isFinite(v))){result.metrics={};result.findings=[{code:"INVALID_SOURCE_VALUES",recordIds:[],detail:"Datos inválidos impiden cálculos fiables."}];return finish();}
 result.status="completed";return finish();
}
