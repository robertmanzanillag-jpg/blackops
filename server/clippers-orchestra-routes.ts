import type { Express, Request } from 'express';
import { getCurrentUserId, getSystemUserId } from './user-context';
import type { ClippersOrchestraStatus } from '../shared/clippers-orchestra';
/** Mounted inside the existing authenticated Clippers owner surface; repeats the canonical owner proof. */
export function registerClippersOrchestraRoutes(app:Pick<Express,'get'>, options:{
  isOwner?:(req:Request)=>boolean; read?:()=>Promise<ClippersOrchestraStatus|null>;
}={}){
  const isOwner=options.isOwner??((req:Request)=>getCurrentUserId(req)===getSystemUserId());
  const read=options.read??(async()=> (await import('./clippers-orchestra-state')).clippersOrchestraState().read());
  app.get('/api/clippers/orchestra/status',async(req,res)=>{
    res.set('Cache-Control','private, no-store, max-age=0');
    try{if(!isOwner(req))return res.status(403).json({error:'CLIPPERS_OWNER_REQUIRED'});}
    catch{return res.status(401).json({error:'CLIPPERS_AUTH_REQUIRED'});}
    if(Object.keys(req.query).length)return res.status(400).json({error:'CLIPPERS_FIXED_SCOPE_REQUIRED'});
    try{const report=await read();return report?res.json(report):res.status(503).json({error:'CLIPPERS_ORCHESTRA_UNAVAILABLE'});}
    catch{return res.status(503).json({error:'CLIPPERS_ORCHESTRA_UNAVAILABLE'});}
  });
}
