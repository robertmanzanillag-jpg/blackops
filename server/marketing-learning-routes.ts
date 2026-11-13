import type {Express,Request,Response} from "express";
import {getCurrentUserId} from "./user-context";
import {getMarketingCommandCenterForOwner,runMarketingCommandCenterForOwner} from "./marketing-learning-service";
export function registerMarketingLearningRoutes(app:Pick<Express,"get"|"post">,deps={get:getMarketingCommandCenterForOwner,prepare:runMarketingCommandCenterForOwner,owner:getCurrentUserId}){
 const failure=(res:Response,error:unknown)=>{
  const code=error instanceof Error?error.message:"";
  if(code==="Authentication required")return res.status(401).json({error:"Authentication required"});
  if(["MARKETING_INPUT_INVALID","MARKETING_CLIENT_UNKNOWN","MARKETING_IDEMPOTENCY_KEY_INVALID"].includes(code))return res.status(400).json({error:"Invalid marketing preparation input"});
  return res.status(503).json({error:"Marketing history unavailable; no completion has been confirmed"});
 };
 app.get("/api/marketing-command-center",async(req:Request,res:Response)=>{res.setHeader("Cache-Control","no-store");try{res.json(await deps.get(deps.owner(req)));}catch(error){failure(res,error);}});
 app.post("/api/marketing-command-center/run-day",async(req:Request,res:Response)=>{res.setHeader("Cache-Control","no-store");try{res.json(await deps.prepare(deps.owner(req),req.body||{},req.header("Idempotency-Key")));}catch(error){failure(res,error);}});
}
