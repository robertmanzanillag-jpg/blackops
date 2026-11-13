// Deterministic own-account observation, not an independent-agent debate.
export function compareBrandEvidence(blackroom,kong,now=new Date()) {
  const median=a=>a.length?a.sort((a,b)=>a-b)[Math.floor(a.length/2)]:null;
  const brands=[['blackroom','6585226',blackroom],['kong','6475033',kong]].map(([brand,id,report])=>{
    const rows=[]; const seen=new Set();
    if(report?.brandId===id) for(const item of report.imports||[]) for(const s of item.samples||[]) {
      const age=now.getTime()-Date.parse(s.observedAt),key=item.network+':'+s.id;
      if(!['facebook','tiktok','youtube'].includes(item.network)||typeof s.id!=='string'||seen.has(key)||!Number.isFinite(age)||age<0||age>7*86400000||!Number.isFinite(s.views)||s.views<0)continue;
      seen.add(key);rows.push({network:item.network,id:s.id,observedAt:s.observedAt,views:s.views,durationSeconds:Number.isFinite(s.durationSeconds)?s.durationSeconds:null});
    }
    return {brand,brandId:id,evidence:rows,networks:['facebook','tiktok','youtube'].map(network=>{
      const samples=rows.filter(r=>r.network===network), durations=samples.map(r=>r.durationSeconds).filter(x=>x>0);
      return {network,count:samples.length,durationSampleCount:durations.length,medianViews:median(samples.map(r=>r.views)),medianDurationSeconds:median(durations)};
    })};
  });
  return {evaluatedAt:now.toISOString(),mode:'observational_proposals',mayPublish:false,brands,
    proposals:brands.flatMap(b=>b.networks.filter(n=>n.durationSampleCount>=3&&n.medianDurationSeconds!==null).map(n=>({brand:b.brand,network:n.network,observedMedianSeconds:n.medianDurationSeconds,
      proposal:`Compare an own-content duration near ${n.medianDurationSeconds}s against the existing control.`,
      counterargument:`${n.count} observations with median ${n.medianViews} views are not age-matched; audience and distribution differ between brands.`,
      evidenceIds:b.evidence.filter(e=>e.network===n.network&&e.durationSeconds>0).map(e=>e.id),overrideWinner:false}))) };
}
