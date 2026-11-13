import type {CompanyOrder} from "../shared/agent-company";
import type {FactoryProject} from "./software-factory";
import {companyOrderJob,ASISTENTE_REPOSITORY} from "./software-factory-company";
import type {FactoryJob,FactoryJobInput} from "./software-factory-store";
import type {createSharedOpenAiCreditLedger} from "./shared-openai-credit-ledger";
import {createHash} from "node:crypto";

/** Reads existing main-company orders; never invents work or closes an order.
 * Enqueue uses the same idempotent credit-guarded operation as the owner route.
 * At most one pending order is admitted per scan. No model/provider calls here. */
export function createFactoryCompanyOrderScheduler(options:{
 owner:string; project:()=>Promise<FactoryProject>; readOrders:(owner:string)=>Promise<CompanyOrder[]>;
 ledger:ReturnType<typeof createSharedOpenAiCreditLedger>; reservationCents:number;
 admit:(owner:string,input:FactoryJobInput)=>Promise<FactoryJob>;
 /** "as-read" keeps the caller's priority (explicit mappings first, then
  * automatic orders oldest-first). Default remains newest-first. */
 ordering?:"newest-first"|"as-read";
}){
 const {owner,project,readOrders,ledger,reservationCents,admit}=options,ordering=options.ordering??"newest-first";
 if(!["newest-first","as-read"].includes(ordering))throw Error("FACTORY_COMPANY_SCHEDULE_INVALID");
 const ownerKey=createHash("sha256").update(owner).digest("hex");
 if(!owner.trim()||!Number.isSafeInteger(reservationCents)||reservationCents<1||reservationCents>10000)throw Error("FACTORY_COMPANY_SCHEDULE_INVALID");
 let active:Promise<void>|undefined;
 const scan=async()=>{
  const budget=await ledger.status();
  if(budget.expired||budget.uncertain||budget.overrun||budget.availableMicroUsd<reservationCents*10000)throw Error("FACTORY_COMPANY_CREDIT_UNAVAILABLE");
  const target=structuredClone(await project());
  if(target.repo!==ASISTENTE_REPOSITORY)throw Error("FACTORY_COMPANY_REPOSITORY_MISMATCH");
  const orders=structuredClone(await readOrders(owner));
  if(!Array.isArray(orders)||orders.length>1000||new Set(orders.map(o=>o.id)).size!==orders.length)throw Error("FACTORY_COMPANY_ORDERS_INVALID");
  if(ordering==="newest-first")orders.sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)||a.id.localeCompare(b.id));
  for(const order of orders){
   let input:FactoryJobInput;
   try{input=companyOrderJob(order,target,reservationCents);}catch{continue;}
   const admitted=await admit(owner,input);
   if(admitted.ownerKey!==ownerKey||admitted.key!==input.key||admitted.projectId!==target.id||admitted.kind!=="discover")throw Error("FACTORY_COMPANY_ADMISSION_UNVERIFIED");
   if(["pending","running"].includes(admitted.status))return;
   if(!["completed","blocked","failed"].includes(admitted.status))throw Error("FACTORY_COMPANY_ADMISSION_UNCONFIRMED");
  }
 };
 return async(requestOwner:string):Promise<void>=>{
  if(requestOwner!==owner)throw Error("FACTORY_COMPANY_OWNER_MISMATCH");
  if(!active)active=scan().finally(()=>{active=undefined;});
  return active;
 };
}
