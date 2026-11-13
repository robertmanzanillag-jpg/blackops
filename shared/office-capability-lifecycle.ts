/** These are capability-policy lives, never whole-agent careers. Match the
 * existing company battery rules; a source outage is not an agent failure. */
export const CAPABILITY_LIFE_RULES = Object.freeze({ initial:80, maximum:100, failure:10, success:6, minimumTenureMs:86400000 });
export type CapabilityLifeEvidence = {
  runId:string; artifactId:string; policyVersion:string; generation:number;
  completedAt:string; startedAt:string;
  outcome:"passed"|"attributable_failure"|"exempt";
  verified?:boolean;
};
export type CapabilityPolicyLife = {
  policyVersion:string; generation:number; life:number; evaluatedRunIds:string[];
  firstExecutionAt?:string; firstVerifiedRunId?:string;
  retiredAt?:string; retirementRunId?:string;
};

/** Input must come from the validated, COMPLETE immutable training journal.
 * No rolling-window history or synthetic/module-completion scores are valid. */
export function replayCapabilityPolicyLife(policyVersion:string,generation:number,evidence:CapabilityLifeEvidence[]):CapabilityPolicyLife {
  const life:CapabilityPolicyLife={policyVersion,generation,life:CAPABILITY_LIFE_RULES.initial,evaluatedRunIds:[]};
  const seen=new Set<string>(),artifacts=new Set<string>();
  for(const record of [...evidence].sort((a,b)=>Date.parse(a.startedAt)-Date.parse(b.startedAt)||a.runId.localeCompare(b.runId))){
    if(record.policyVersion!==policyVersion||record.generation!==generation)throw Error("CAPABILITY_LIFE_IDENTITY_MISMATCH");
    if(!record.runId||!record.artifactId||seen.has(record.runId)||artifacts.has(record.artifactId)||!Number.isFinite(Date.parse(record.startedAt))||!Number.isFinite(Date.parse(record.completedAt))||Date.parse(record.completedAt)<Date.parse(record.startedAt)-30000)throw Error("CAPABILITY_LIFE_EVIDENCE_INVALID");
    seen.add(record.runId);artifacts.add(record.artifactId);
    life.firstExecutionAt??=record.startedAt;
    life.evaluatedRunIds.push(record.runId);
    if(life.retiredAt)continue;
    if(record.verified||record.outcome==="passed")life.firstVerifiedRunId??=record.runId;
    if(record.outcome==="exempt")continue;
    if(record.outcome==="passed"){
      life.life=Math.min(CAPABILITY_LIFE_RULES.maximum,life.life+CAPABILITY_LIFE_RULES.success);
      life.firstVerifiedRunId??=record.runId;
    }else if(record.outcome==="attributable_failure")life.life=Math.max(0,life.life-CAPABILITY_LIFE_RULES.failure);
    else throw Error("CAPABILITY_LIFE_OUTCOME_INVALID");
    if(life.life===0&&Date.parse(record.completedAt)-Date.parse(life.firstExecutionAt)>=CAPABILITY_LIFE_RULES.minimumTenureMs){life.retiredAt=record.completedAt;life.retirementRunId=record.runId;}
  }
  return life;
}
