import test from 'node:test';
import assert from 'node:assert/strict';
import { newSimulation, parseSimulation, advanceDay, nextMonth, hireAgent, upgradeDepartment, dailyCapacity } from '../client/src/components/company-office/company-simulation';
test('a month contains 30 productive days and closes before rolling over', () => {
 let state = newSimulation(); for(let i=0;i<30;i++) state=advanceDay(state);
 assert.equal(state.day,30); assert.equal(state.completed,180); assert.equal(advanceDay(state),state);
 const next=nextMonth(state); assert.equal(next.day,0); assert.equal(next.month,2); assert.equal(next.completed,0); assert.deepEqual(next.lastMonth,{completed:180,target:180});
 assert.equal(nextMonth(newSimulation()).month,1);
});
test('hiring and upgrades consume credits, increase capacity, and enforce limits',()=>{
 let state=newSimulation(); state=hireAgent(state,'engineering'); assert.equal(state.credits,1800); assert.equal(dailyCapacity(state),8);
 state=upgradeDepartment(state,'engineering'); assert.equal(state.credits,1000); assert.equal(dailyCapacity(state),9);
 assert.equal(upgradeDepartment({...state,credits:0},'engineering').levels.engineering,1);
 state={...state,credits:100000}; for(let i=0;i<8;i++)state=hireAgent(state,'engineering'); assert.equal(state.hires.engineering,4);
 for(let i=0;i<8;i++)state=upgradeDepartment(state,'engineering');assert.equal(state.levels.engineering,3);
 const rollover=nextMonth({...state,day:30});assert.equal(rollover.hires.engineering,4);assert.equal(rollover.levels.engineering,3);
});
test('invalid or corrupted storage recovers without poisoned numeric state',()=>{
 for(const value of ['{', 'null', JSON.stringify({...newSimulation(),credits:-1}),JSON.stringify({...newSimulation(),hires:{}}),JSON.stringify({...newSimulation(),target:1e100}),JSON.stringify({...newSimulation(),lastMonth:{completed:'180',target:180}})]) assert.deepEqual(parseSimulation(value),newSimulation());
 const valid=hireAgent(newSimulation(),'growth');assert.deepEqual(parseSimulation(JSON.stringify(valid)),valid);
});
