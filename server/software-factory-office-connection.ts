import path from "node:path";
import {pathToFileURL} from "node:url";
import type {CompanyOrder} from "../shared/agent-company";
import {configuredSoftwareFactoryStore} from "./software-factory-store-provider";
import {getSystemUserId} from "./user-context";
export type FactoryOfficeAdmission={reservationCents:number;readMainOrder(owner:string,id:string):Promise<CompanyOrder|undefined>;admitWithinCredits:typeof configuredSoftwareFactoryStore.enqueue};

/** The operator module must install the same guarded ledger as its worker.
 * No browser payload, order, model answer or project metadata selects this module.
 * A missing module leaves order admission unavailable, never generic enqueue.
 */
export function createFactoryOfficeConnection(options:{
 configuration:()=>{enabled:boolean;modulePath?:string};
 owner:()=>string;
 store:typeof configuredSoftwareFactoryStore;
 readMainOrder:(owner:string,id:string)=>Promise<CompanyOrder|undefined>;
 loadModule:(url:string)=>Promise<unknown>;
}){
 let connection:Promise<FactoryOfficeAdmission>|undefined;
 return async():Promise<FactoryOfficeAdmission|undefined>=>{
  const config=options.configuration();
  if(!config.enabled)return undefined;
  if(!config.modulePath || !path.isAbsolute(config.modulePath))throw Error("FACTORY_OFFICE_MODULE_REQUIRED");
  return connection ??= (async()=>{
   const owner=options.owner(); if(!owner.trim())throw Error("FACTORY_OFFICE_OWNER_REQUIRED");
   const readMainOrder=async(requestOwner:string,id:string)=>{
    if(requestOwner!==owner)throw Error("FACTORY_OFFICE_OWNER_MISMATCH");
    const order=await options.readMainOrder(owner,id);
    if(order && order.id!==id)throw Error("FACTORY_OFFICE_ORDER_MISMATCH");
    return order?structuredClone(order):undefined;
   };
   const module=await options.loadModule(pathToFileURL(config.modulePath!).href) as {createFactoryOfficeAdmission?:unknown};
   if(typeof module?.createFactoryOfficeAdmission!=="function")throw Error("FACTORY_OFFICE_CREDIT_ADMISSION_REQUIRED");
   const result=await module.createFactoryOfficeAdmission({owner,store:options.store,readMainOrder});
   if(result?.store!==options.store || result?.owner!==owner || typeof result.admitWithinCredits!=="function" || !Number.isSafeInteger(result.reservationCents) || result.reservationCents<1 || result.reservationCents>10000)throw Error("FACTORY_OFFICE_CONNECTION_INVALID");
   return {reservationCents:result.reservationCents,readMainOrder,admitWithinCredits:async(requestOwner,input)=>{
    if(requestOwner!==owner)throw Error("FACTORY_OFFICE_OWNER_MISMATCH");
    return result.admitWithinCredits(owner,input);
   }};
  })();
 };
}

export const getFactoryOfficeAdmission=createFactoryOfficeConnection({
 configuration:()=>({enabled:process.env.SOFTWARE_FACTORY_OFFICE_ENABLED==="true",modulePath:process.env.SOFTWARE_FACTORY_ADAPTER_MODULE}),
 owner:getSystemUserId,
 store:configuredSoftwareFactoryStore,
 readMainOrder:async(owner,id)=>{
  if(owner!==getSystemUserId())throw Error("FACTORY_OFFICE_OWNER_MISMATCH");
  const {getAgentCouncil,setAgentCouncilUser}=await import("./agent-council");
  setAgentCouncilUser(owner);
  return (await getAgentCouncil().load()).company.orders.find(order=>order.id===id);
 },
 loadModule:url=>import(url),
});
