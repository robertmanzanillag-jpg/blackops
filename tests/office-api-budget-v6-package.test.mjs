import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
test('v6 selective stage portable guards, no-clobber and exact public sources',()=>{
 const run=spawnSync('python3',[fileURLToPath(new URL('../script/office-api-budget-v6/test_stage.py',import.meta.url))],{encoding:'utf8',timeout:30000,env:{PATH:process.env.PATH}});
 assert.equal(run.status,0,run.stderr);assert.match(run.stderr,/Ran 15 tests/);
});
