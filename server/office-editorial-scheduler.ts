import {readWebEditorialSource,persistEditorialSource,type EditorialSource} from "./office-editorial-source";
import type {BusinessPool} from "./office-business-sources";
let status:{enabled:boolean;lastExportAt:string|null;status:"disabled"|"pending"|"ready"|"unavailable"}={enabled:false,lastExportAt:null,status:"disabled"};
export const officeEditorialSourceStatus=()=>({...status});
export function createEditorialExportCycle(options:{read:()=>Promise<EditorialSource>;persist:(source:EditorialSource)=>Promise<void>;now?:()=>number}){
 let running=false,stopped=false;
 return {stop(){stopped=true;},async tick(){
  if(running||stopped)return false;running=true;
  try{const source=await options.read();if(stopped)return false;await options.persist(source);status={enabled:true,lastExportAt:new Date((options.now??Date.now)()).toISOString(),status:source.status==="available"?"ready":"unavailable"};return true;}
  catch{status={...status,enabled:true,status:"unavailable"};return false;}finally{running=false;}
 }};
}
let installed=false;
/** Only the existing canonical source is projected. No agent cycle or publisher. */
export async function startOfficeEditorialExporter(options:{pool:BusinessPool;owner:string;workspaceDir:string}){
 if(installed)return;installed=true;status={enabled:true,lastExportAt:null,status:"pending"};
 const cycle=createEditorialExportCycle({read:()=>readWebEditorialSource({...options,configuredOwner:options.owner}),persist:source=>persistEditorialSource(options.pool,options.owner,options.owner,source)});
 await cycle.tick();const timer=setInterval(()=>{void cycle.tick();},60000);timer.unref();
}
