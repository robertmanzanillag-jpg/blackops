import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {factoryWorkerEnvironment,superviseFactoryChild} from '../script/software-factory-windows-worker.mjs';
const office={DATABASE_URL:'postgres://fixture',DEFAULT_USER_ID:'fixture-owner',OPENAI_API_KEY:'sk-'+ 'x'.repeat(30),UNAPPROVED_SECRET:'never-copy'};
const github={FACTORY_GITHUB_TOKEN:'github_pat_'+'x'.repeat(30)};
const paths={repo:'/fixture/repo',operatorConfig:'/private/operator.json',creditConfig:'/private/credit.json'};
test('factory launcher copies only explicit private values and blocks inherited Node injection',()=>{
 const env=factoryWorkerEnvironment(office,github,paths,{SystemRoot:'C:/Windows',PGPASSWORD:'never-copy',OPENAI_API_KEY:'wrong',NODE_ENV:'development'});
 assert.equal(env.OPENAI_API_KEY,office.OPENAI_API_KEY);assert.equal(env.SOFTWARE_FACTORY_GITHUB_TOKEN,github.FACTORY_GITHUB_TOKEN);
 assert.equal(env.PGPASSWORD,undefined);assert.equal(env.UNAPPROVED_SECRET,undefined);assert.equal(env.NODE_ENV,'production');
 assert.equal(env.SOFTWARE_FACTORY_OWNER_ID,office.DEFAULT_USER_ID);assert.equal(env.OPENAI_SHARED_CREDITS_REQUIRED,'true');
 assert.throws(()=>factoryWorkerEnvironment(office,github,paths,{SystemRoot:'C:/Windows',NODE_OPTIONS:'--require injected'}));
 assert.throws(()=>factoryWorkerEnvironment({...office,OPENAI_API_KEY:''},github,paths,{SystemRoot:'C:/Windows'}));
});
test('owned factory supervisor sends one graceful stop and waits for actual child exit',async()=>{
 const child=new EventEmitter();child.connected=true;const messages=[];child.send=(m,cb)=>{messages.push(m);cb();setTimeout(()=>child.emit('exit',0),15);};
 const code=await superviseFactoryChild(child,{identity:{parentPid:123},stopRequested:()=>true},{},{pollMs:2,parentAlive:()=>true});
 assert.equal(code,0);assert.deepEqual(messages,[{type:'factory-shutdown'}]);
});
