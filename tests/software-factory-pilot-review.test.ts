import test from "node:test";
import assert from "node:assert/strict";
import { classifyPilotTextChange, createPilotIndependentReview } from "../server/software-factory-pilot-review";
const source = { repository: "robertmanzanillag-jpg/software-factory-pilot", baseSha: "a".repeat(40), headSha: "b".repeat(40), changedFiles: ["site/index.html"], baseline: '<html><h1>Prueba</h1><p>Texto</p></html>', candidate: '<html><h1>Prueba independiente</h1><p>Texto</p></html>' };
const restoration = { baseSha: source.baseSha, artifactSha256: "c".repeat(64), verified: true };
test("only bounded text with verified restoration qualifies as reversible low risk", () => {
  assert.equal(classifyPilotTextChange(source, restoration).risk, "low");
  for (const candidate of ['<html><h1 onclick="evil()">Prueba</h1><p>Texto</p></html>', '<html><h1>Prueba</h1><script>evil()</script></html>', '<style>body{display:none}</style>', source.baseline])
    assert.equal(classifyPilotTextChange({ ...source, candidate }, restoration).risk, "unknown");
  assert.equal(classifyPilotTextChange(source, { ...restoration, verified: false }).risk, "unknown");
  assert.equal(classifyPilotTextChange({ ...source, repository: 'owner/kong' }, restoration).risk, "unknown");
  assert.equal(classifyPilotTextChange({ ...source, changedFiles: ['.github/workflows/pilot.yml'] }, restoration).risk, "unknown");
});
test("review is bound to exact source, separate actor and valid bounded result", async () => {
  const candidate = { projectId:'pilot', baseSha: source.baseSha, headSha:source.headSha, changedFiles:source.changedFiles, builderId:'factory-remote-builder' } as any;
  const state = { candidate, finding:{request:'Clarify heading'} } as any;
  const context = { signal:new AbortController().signal, maxCostCents:2 };
  let calls=0;
  const make = (text:string, loaded=source) => createPilotIndependentReview({ load:async()=>loaded, now:()=>new Date('2026-11-06T12:00:00Z'), generate:async input=>{calls++;assert.equal(input.maxCostCents,2);return {status:'completed',text,costCents:1,inputTokens:1,outputTokens:1};} });
  const review=await make('{"passed":true,"warnings":[]}')({id:'pilot',repo:source.repository} as any,state,context);
  assert.equal(review.evidence.headSha,source.headSha); assert.equal(review.evidence.passed,true); assert.equal(review.costCents,1);
  assert.equal((await make('{"passed":true,"warnings":["unsafe"]}')({repo:source.repository} as any,state,context)).evidence.passed,false);
  assert.equal((await make('invalid JSON')({repo:source.repository} as any,state,context)).evidence.passed,false);
  const before=calls;
  await assert.rejects(make('{}',{...source,headSha:'d'.repeat(40)})({repo:source.repository} as any,state,context));
  assert.equal(calls,before);
});

test("unknown review preserves reservation while a terminal failure settles without approval",async()=>{
  const candidate={projectId:'pilot',baseSha:source.baseSha,headSha:source.headSha,changedFiles:source.changedFiles,builderId:'builder'} as any;
  const state={candidate,finding:{request:'Clarify heading'}} as any;
  for(const status of ['unknown','failed'] as const){
    const review=createPilotIndependentReview({load:async()=>source,now:()=>new Date(),generate:async()=>({status,costCents:1,reason:'provider failure'})});
    const result=review({id:'pilot',repo:source.repository} as any,state,{signal:new AbortController().signal,maxCostCents:2});
    if(status==='unknown')await assert.rejects(result);
    else {const value=await result;assert.equal(value.costCents,1);assert.equal(value.evidence.passed,false);}
  }
});

