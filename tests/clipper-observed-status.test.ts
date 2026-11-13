import test from "node:test";
import assert from "node:assert/strict";
import {withoutUnverifiedWeeklyViews,observedClipperPipeline,unverifiedClipperAgents,weeklyClipperGoalGap,missingWeeklyRecommendation} from "../shared/clipper-observed-status";
test("legacy sample views cannot masquerade as weekly analytics; goals remain configured",()=>{
 const original={id:"sports",lastWeekViews:286000,weeklyViewsGoal:1000000};const result=withoutUnverifiedWeeklyViews(original);
 assert.equal(result.lastWeekViews,0);assert.equal(result.weeklyViewsEvidence,"unavailable");assert.equal(result.weeklyViewsGoal,1000000);assert.equal(original.lastWeekViews,286000);
});
test("empty evidence produces zero pipeline counts regardless of configured target",()=>{
 const rows=observedClipperPipeline({trends:[],sources:[],drafts:[],publishProposals:[],metrics:[]});assert.ok(rows.every(row=>row.count===0));assert.ok(rows.every(row=>row.status!==("active" as string)));
});
test("observed stage counts preserve distinctions between proposals, rights and metrics",()=>{
 const rows=observedClipperPipeline({trends:[1,2],sources:[{rightsStatus:"review_required"},{rightsStatus:"owned_or_permissioned"}],drafts:[1],publishProposals:[1,2,3],metrics:[1,2,3,4]});assert.deepEqual(rows.map(r=>r.count),[2,1,1,3,4]);assert.match(rows[3].stage,/sin envío/);
});
test("configured subagents are not claimed active without individual execution evidence",()=>{
 const agents=[{status:"active",output:"Detects trends"},{status:"review_required",output:"Check rights"}];const result=unverifiedClipperAgents(agents);assert.equal(result[0].status,"waiting");assert.match(result[0].output,/no comprobada/);assert.equal(result[1].status,"review_required");assert.equal(agents[0].status,"active");
});
test("unknown analytics cannot imply underperformance or trigger volume recommendations",()=>{
 const account={id:"account",lastWeekViews:0,weeklyViewsGoal:1000000};assert.equal(weeklyClipperGoalGap([account]),null);assert.match(missingWeeklyRecommendation(account)!.reason,/No hay evidencia/);
 assert.equal(weeklyClipperGoalGap([{...account,lastWeekViews:100,weeklyViewsEvidence:"verified"}]),999900);assert.equal(missingWeeklyRecommendation({...account,weeklyViewsEvidence:"verified"}),undefined);
});
