import {emptyFactoryApiState,checkpointFactoryApiMonth,reserveFactoryApi,settleFactoryApi,unknownFactoryApi,factoryApiExecutionWindow,factoryApiBudgetStatus} from '../../server/software-factory-api-budget';
import {createFactoryApiInvocation} from '../../server/factory-api-invocation';
export function fixtureFactoryInvocation(clock:()=>Date=()=>new Date('2026-11-06T12:00:00.000Z'),parent?:{id:string;fence:string},fixedCents=0){
 const state=emptyFactoryApiState(),exposure={configured:true,fixedCents,spentCents:0,reservedCents:parent?100:0,unknown:false,parents:parent?[{jobId:parent.id,fence:parent.fence,status:"running",maximumCents:100,leaseExpiresAt:new Date(clock().getTime()+300000).toISOString()}]:[]};
 const now=()=>clock().toISOString();
 checkpointFactoryApiMonth(state,exposure,{month:now().slice(0,7),reconciledAt:now(),externalSpentMicroUsd:0,externalReservedMicroUsd:0,externalUnknownReservations:0,complete:true,evidenceSha256:'a'.repeat(64)},now());
 return createFactoryApiInvocation({owner:()=> 'synthetic-owner',now:clock,store:{
  async apiBudgetStatus(){return factoryApiBudgetStatus(state,exposure,now());},
  async reserveApi(_owner,input){return reserveFactoryApi(state,exposure,input,now());},
  async settleApi(_owner,key,input){return settleFactoryApi(state,key,input,now());},
  async unknownApi(_owner,key){unknownFactoryApi(state,key);},
  async executionWindowApi(_owner,key){return factoryApiExecutionWindow(state,exposure,key,now());},
 }});
}
export function fixtureFactoryPricing(model:string){return JSON.stringify({version:1,prices:[{provider:'openai',model,inputNanoUsdPerToken:400,outputNanoUsdPerToken:1600,validUntil:'2027-01-01T00:00:00.000Z',evidenceSha256:'a'.repeat(64)}]});}
