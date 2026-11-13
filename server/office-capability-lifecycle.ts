import {replayCapabilityPolicyLife,type CapabilityLifeEvidence} from "../shared/office-capability-lifecycle";
import type {CapabilityTrainingState} from "./office-capability-training";
import type {RoleWorkState} from "./office-role-work";

type Run=CapabilityTrainingState["runs"][number];
type Policy=CapabilityTrainingState["policies"][number];
type Grade=(task:Run["task"],text:string)=>{passed:boolean};
const sourceExempt=new Set(["SOURCE_UNAVAILABLE","NO_SOURCE_RECORDS","CAPABILITY_UNAVAILABLE","EXPORT_MISSING","EXPORT_INVALID_OR_STALE","SOURCE_MISSING","SOURCE_INVALID","SOURCE_LIMIT","SOURCE_STALE","SOURCE_TIME_UNKNOWN","PARTIAL_COVERAGE","NO_RECORDS"]);

/** Caller MUST first parseCapabilityTraining. Persisted journal is append-only:
 * its existing hard 200-run/100-policy limits block admission, never prune it.
 * This projection therefore survives JSONB/restart without a second mutable
 * battery, partial checkpoint or independently forgeable scoring receipt. */
export function capabilityPolicyLife(state:CapabilityTrainingState,policy:Policy,currentPrompt:string,grade:Grade){
  const evidence:CapabilityLifeEvidence[]=state.runs.filter(r=>r.policyVersion===policy.version&&r.kind==="production"&&r.status==="completed").map(r=>({
    runId:r.id,artifactId:r.artifactId!,policyVersion:r.policyVersion,generation:r.generation,startedAt:r.startedAt,completedAt:r.trained!.result.completedAt,
    verified:r.promptVersion===currentPrompt&&grade(r.task,r.trained!.result.text).passed,
    outcome:r.promptVersion!==currentPrompt||r.task.sourceBlocked||r.task.issueCodes.some(c=>sourceExempt.has(c))?"exempt":grade(r.task,r.trained!.result.text).passed?"passed":"attributable_failure",
  }));
  return replayCapabilityPolicyLife(policy.version,policy.generation,evidence);
}

export function capabilityLifecycleSummary(state:CapabilityTrainingState,currentPrompt:string,grade:Grade,work?:RoleWorkState,generations?:Record<string,number>){
  return state.policies.map(policy=>{
    const life=capabilityPolicyLife(state,policy,currentPrompt,grade);
    const current=policy.promptVersion===currentPrompt;
    // The trainer's shared admission lane is global, including uncertain older
    // generations. Do not advertise a different role as presently admissible.
    const blocking=state.runs.some(r=>r.status==="running"||r.status==="unknown");
    const pending=(work?.jobs||[]).filter(j=>j.role===policy.role&&j.generation===policy.generation&&["completed","blocked"].includes(j.status)&&!state.runs.some(r=>r.kind==="production"&&r.promptVersion===currentPrompt&&r.task.id===j.id)).map(j=>j.id);
    const siblings=state.policies.filter(p=>p.role===policy.role&&p.generation===policy.generation&&p.promptVersion===currentPrompt);
    const anyRunnable=siblings.some(p=>["active","probation"].includes(p.status)&&!capabilityPolicyLife(state,p,currentPrompt,grade).retiredAt);
    const preparing=siblings.some(p=>p.status==="candidate");
    const localAdmissionEligible=current&&!blocking&&state.runs.length<200&&state.policies.length<100&&!life.retiredAt&&["active","probation"].includes(policy.status);
    return {role:policy.role,capability:"source-triage-v1" as const,...life,
      status:!current?"historical":life.retiredAt?"retired":blocking?"execution_unresolved":policy.status,
      capabilityStatus:!current?"historical":anyRunnable?"policy_available":preparing?"awaiting_qualified_successor":"blocked_no_qualified_successor",
      ...(current&&!anyRunnable&&!preparing?{blockedReason:"Preparation exhausted: new verified feedback/curriculum is required; no automatic clone or life reset."}:{}),
      localAdmissionEligible,currentGenerationVerified:generations!==undefined,
      currentGenerationMatches:generations?generations[policy.role]===policy.generation:undefined,
      productionAdmissible:localAdmissionEligible&&generations?.[policy.role]===policy.generation,
      pendingSourceJobIds:work?pending:undefined,queueEvidenceAvailable:Boolean(work),transferredFromPolicyVersion:policy.parentVersion,
      transferScope:"Only unconsumed saved-audit triage tasks; no business orders or full career transfer",
      historyRetention:"append_only_no_pruning",fullRoleReplacement:false,
    };
  });
}
