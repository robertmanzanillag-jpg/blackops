import {createHash} from "node:crypto";
import type {loadSharedCreditRuntime} from "./shared-openai-credit-runtime";
import type {VerifiedCapabilityCost} from "./office-capability-training";

/** A priced, settled usage receipt from the SAME admitted account ledger.
 * This never calls the provider, initializes credit or trusts model prices. */
export function createTrainingReceiptReader(shared:Awaited<ReturnType<typeof loadSharedCreditRuntime>>){
 return async(request:{executionId:string;responseId:string;model:string;usage:{inputTokens:number;outputTokens:number;totalTokens:number}}):Promise<VerifiedCapabilityCost>=>{
  const {usage}=request,price=shared.pricing;
  if(request.model!==price.model || ![usage.inputTokens,usage.outputTokens,usage.totalTokens].every(n=>Number.isSafeInteger(n)&&n>=0) || usage.totalTokens!==usage.inputTokens+usage.outputTokens)throw Error("TRAINING_RECEIPT_USAGE_INVALID");
  const key=`office:${createHash("sha256").update(request.executionId).digest("hex")}`;
  const receipt=await shared.ledger.settledReceipt(key);
  const micro=(BigInt(usage.inputTokens)*BigInt(price.inputNanoUsdPerToken)+BigInt(usage.outputTokens)*BigInt(price.outputNanoUsdPerToken)+999n)/1000n;
  if(receipt.consumer!=="office" || receipt.reconciled || receipt.settlementEvidenceId!==request.responseId || receipt.actualMicroUsd===undefined || BigInt(receipt.actualMicroUsd)!==micro)throw Error("TRAINING_RECEIPT_MISMATCH");
  return {...request,receiptId:key,currency:"USD",usd:receipt.actualMicroUsd/1000000};
 };
}
