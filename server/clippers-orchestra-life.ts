import { advanceCompany, type CompanyState } from '../shared/agent-company';
import { CLIPPERS_AGENTS, CLIPPERS_AGENT_NAMES } from '../shared/clippers-office-agents';
import type { ClippersOrchestraStatus, ClippersVerifiedOutcome } from '../shared/clippers-orchestra';

const REASONS: Record<string, string[]> = {
  analytics:['verified_metric_snapshot'], trends:['paired_public_growth_observation'], streamers:['public_metadata_receipt'],
  editor:['verified_render_receipt'], checker:['reviewed_scoped_media_receipt'], publisher:['provider_schedule_or_publication_receipt'],
  learning:['three_current_verified_comparisons'], supervisor:[], health:[],
};
/** Heartbeats, held sources and missing rights are never career successes or failures. */
export function applyClippersReceiptOutcomes(company: CompanyState, report: ClippersOrchestraStatus, now: number): CompanyState {
  const statuses=Object.fromEntries(CLIPPERS_AGENTS.filter(a=>!company.careers[a.id]).map(a=>[a.id,{state:'available' as const,label:'Registrado; pendiente de entregables verificables'}]));
  let next=advanceCompany(company,{now,roles:CLIPPERS_AGENT_NAMES,statuses}).state;
  for(const role of report.roles){
    for(const o of role.outcomes??[]){
      const career=next.careers[role.id];
      if(!career || o.outcome!=='verified_deliverable' || !REASONS[role.stage]?.includes(o.reason) ||
        !new RegExp(`^clippers:${o.artifactSha256}:${role.stage}$`).test(o.evidenceId) ||
        Date.parse(o.completedAt)<=Date.parse(career.hiredAt) || Date.parse(o.completedAt)>now || now-Date.parse(o.completedAt)>7*86400000 ||
        career.inTrainingUntilGeneration || career.scoreReconciliation || career.lastEvidenceId===o.evidenceId || career.evaluatedEvidenceIds?.includes(o.evidenceId))continue;
      next=advanceCompany(next,{now,roles:CLIPPERS_AGENT_NAMES,statuses:{[role.id]:{state:'working',label:`Entregable verificado: ${o.reason}`,evidenceId:o.evidenceId}}}).state;
    }
  }
  return next;
}
export function clippersCareerView(company: CompanyState | undefined, id: string) {
  const c=company?.careers[id];
  return c?{registered:true,generation:c.generation,points:c.points,battery:c.battery,inTraining:!!c.inTrainingUntilGeneration,hiredAt:c.hiredAt,skillIds:(c.skills??[]).map(s=>s.id),lastEvidenceId:c.lastEvidenceId??null}:
    {registered:false,generation:null,points:null,battery:null,inTraining:false,hiredAt:null,skillIds:[],lastEvidenceId:null};
}
