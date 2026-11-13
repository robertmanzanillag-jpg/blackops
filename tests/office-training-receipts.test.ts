import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {createTrainingReceiptReader} from "../server/office-training-receipts";
test("training cost requires exact settled execution, response, model and priced usage",async()=>{
 const request={executionId:"assignment:trained",responseId:"resp_1",model:"fixture",usage:{inputTokens:10,outputTokens:2,totalTokens:12}};
 let receipt:any={consumer:"office",status:"settled",actualMicroUsd:28,settlementEvidenceId:"resp_1",reconciled:false};
 const reader=createTrainingReceiptReader({pricing:{model:"fixture",inputNanoUsdPerToken:2000,outputNanoUsdPerToken:4000,validUntil:"2026-12-01T00:00:00Z"},ledger:{settledReceipt:async(key:string)=>{assert.equal(key,`office:${createHash("sha256").update(request.executionId).digest("hex")}`);return receipt;}}} as any);
 assert.equal((await reader(request)).usd,0.000028);
 for(const patch of [{consumer:"factory"},{actualMicroUsd:27},{settlementEvidenceId:"resp_other"},{reconciled:true}]){const saved=receipt;receipt={...receipt,...patch};await assert.rejects(reader(request));receipt=saved;}
 await assert.rejects(reader({...request,model:"other"}));await assert.rejects(reader({...request,usage:{...request.usage,totalTokens:99}}));
});
