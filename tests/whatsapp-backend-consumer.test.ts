import test from "node:test";
import assert from "node:assert/strict";
import { createBackendHttpFixture } from "./fixtures/whatsapp-backend-http";
import { buildKongOfficeWing } from "../client/src/lib/kong-office-wing";
import { advanceKongCompany } from "../server/kong-company";
import { emptyCompanyState } from "../shared/agent-company";
import { WHATSAPP_CAREER_ID as ID, type WhatsAppReaderEvidence } from "../shared/whatsapp-office-agent";

test("actual backend office HTTP projection feeds the consumer parser, desk and PR330 ledger", { skip: process.env.KONG_WHATSAPP_BACKEND_FIXTURE === undefined ? "Optional cross-repository integration: set KONG_WHATSAPP_BACKEND_FIXTURE to the pinned backend checkout" : false }, async()=>{
  const fixture=await createBackendHttpFixture();
  try {
    const now=Date.now(); const at=(minutes:number)=>new Date(now+minutes*60000).toISOString();
    const reader:WhatsAppReaderEvidence={version:1,scopeId:"kong-venues-four-groups",ownerId:"11111111-1111-4111-8111-111111111111",observedAt:at(-0.1),scheduler:"active",intervalMinutes:30,reader:"idle",session:"connected",lastReviewAt:at(-0.1),lastAttemptAt:at(-1),lastSuccessAt:at(-1),groupsRead:4,lastSuccessGroupCount:4,blocker:"none",checkpointsRetained:true};
    const cases:[WhatsAppReaderEvidence|null,string][]=[ [null,"unverified"], [{...reader,reader:"blocked",session:"unknown",blocker:"missing-reference"},"blocked"],
      [{...reader,session:"unknown"},"unverified"], [{...reader,observedAt:at(-61),lastReviewAt:at(-61),lastAttemptAt:at(-62),lastSuccessAt:at(-62)},"stale"],
      [{...reader,reader:"reading"},"reading"], [reader,"recent"], [{...reader,reader:"blocked",blocker:"permission-required"},"blocked"],
      [{...reader,reader:"blocked",blocker:"interaction-failed"},"blocked"] ];
    for(const [value,expected] of cases) {
      const result=await fixture.audit(value);
      assert.deepEqual(result.projection.whatsappReader,value??undefined);
      assert.deepEqual(result.audit.evidence.whatsappReader,value??undefined);
      const desks=buildKongOfficeWing(result.audit.evidence,[],{},Date.now()).agents.filter(a=>a.id===ID);
      assert.equal(desks.length,1);assert.equal(desks[0].whatsappEvidence?.status,expected);
      const scored=advanceKongCompany({company:emptyCompanyState(),evidenceAt:{},evidence:result.audit.evidence,now:Date.now()});
      assert.equal(scored.company.careers[ID]?.points,expected==="recent"?10:undefined);
      const replay=advanceKongCompany({company:scored.company,evidenceAt:scored.evidenceAt,evidence:result.audit.evidence,now:Date.now()});
      assert.deepEqual(replay.company.careers[ID],scored.company.careers[ID]);
    }
  }finally{await fixture.close();}
});
