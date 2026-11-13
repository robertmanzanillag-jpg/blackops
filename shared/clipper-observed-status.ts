/** Configured goals and legacy sample figures are not measured weekly analytics. */
export function withoutUnverifiedWeeklyViews<T extends {lastWeekViews:number}>(account:T):T & {weeklyViewsEvidence:"unavailable"} {
  return {...account,lastWeekViews:0,weeklyViewsEvidence:"unavailable"};
}
/** These are saved-input counts, not executing-agent or published-post claims. */
export function observedClipperPipeline(input:{trends:unknown[];sources:Array<{rightsStatus:string}>;drafts:unknown[];publishProposals:unknown[];metrics:unknown[]}) {
  return [
    {stage:"Tendencias registradas",count:input.trends.length,owner:"Trend Scout",status:"waiting" as const},
    {stage:"Fuentes pendientes de derechos",count:input.sources.filter(s=>s.rightsStatus!=="owned_or_permissioned").length,owner:"Rights Gate",status:"review_required" as const},
    {stage:"Especificaciones de edición",count:input.drafts.length,owner:"Clip Factory",status:"waiting" as const},
    {stage:"Propuestas de publicación (sin envío)",count:input.publishProposals.length,owner:"Publisher",status:"waiting" as const},
    {stage:"Registros de métricas importados",count:input.metrics.length,owner:"Optimizer",status:"waiting" as const},
  ];
}
export function unverifiedClipperAgents<T extends {status:string;output:string}>(agents:T[]):T[] {
  return agents.map(agent=>({...agent,status:agent.status === "active"?"waiting":agent.status,output:`Función configurada; ejecución individual no comprobada. ${agent.output}`}));
}
export function weeklyClipperGoalGap(accounts:Array<{lastWeekViews:number;weeklyViewsGoal:number;weeklyViewsEvidence?:string}>):number|null {
  if(accounts.some(a=>a.weeklyViewsEvidence!=="verified")) return null;
  return accounts.reduce((sum,a)=>sum+Math.max(0,a.weeklyViewsGoal-a.lastWeekViews),0);
}
export function missingWeeklyRecommendation(account:{id:string;weeklyViewsEvidence?:string}) {
  return account.weeklyViewsEvidence === "verified" ? undefined : {accountId:account.id,recommendation:"Obtener métricas semanales verificadas antes de cambiar el volumen.",reason:"No hay evidencia suficiente para evaluar el rendimiento semanal de esta cuenta."};
}
