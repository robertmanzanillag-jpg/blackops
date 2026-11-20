import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const installerPath = require.resolve('onnxruntime-node/script/install.js');
const installer = await readFile(installerPath, 'utf8');

// Execute the installed package's actual installer in an isolated Linux/x64
// environment. All network and filesystem access is replaced, never bypassed.
function install(env) {
  const downloads = [], exited = Symbol('exit');
  let code;
  const context = {
    __dirname: path.dirname(installerPath),
    process: { env, argv: ['node', installerPath], exit: value => { code = value; throw exited; } },
    console: { log() {}, warn() {} },
    require: name => {
      switch (name) {
        case 'os': return { platform: () => 'linux', arch: () => 'x64' };
        case 'fs': return { existsSync: value => !value.endsWith('libonnxruntime_providers_cuda.so') };
        case 'https': return { get: url => { downloads.push(url); return { on() {} }; } };
        case 'path': return path;
        case 'tar': return {};
        case 'global-agent': return { bootstrap() {} };
        case 'child_process': return { execFileSync: () => { throw Object.assign(Error('No GPU compiler'), { code: 'ENOENT' }); } };
        case '../package.json': return require('onnxruntime-node/package.json');
        default: throw Error(`Unexpected installer dependency: ${name}`);
      }
    },
  };
  try { vm.runInNewContext(installer, context, { timeout: 1000 }); }
  catch (error) { if (error !== exited) throw error; }
  return { code, downloads };
}

test('default Linux installer attempts a GPU download; CPU workers and operator diagnostics exit without it', async () => {
  const baseline = install({});
  assert.equal(baseline.downloads.length, 1);
  assert.match(baseline.downloads[0], /onnxruntime-linux-x64-gpu-/);
  for (const [file, count] of [['office-worker-cloud.yml', 3], ['factory-ops.yml', 1]]) {
    const workflow = await readFile(new URL(`../.github/workflows/${file}`, import.meta.url), 'utf8');
    const steps = workflow.split(/^      - /m).filter(step => step.startsWith('name: Install dependencies\n'));
    assert.equal(steps.length, count, `${file} retains its install steps`);
    for (const step of steps) {
      const value = step.match(/^          ONNXRUNTIME_NODE_INSTALL_CUDA: (\S+)$/m)?.[1];
      const fixed = install({ ONNXRUNTIME_NODE_INSTALL_CUDA: value });
      assert.equal(fixed.code, 0);
      assert.deepEqual(fixed.downloads, []);
      assert.match(step, /run: npm ci --no-audit --no-fund/);
      assert.doesNotMatch(step, /--ignore-scripts/, 'keep unrelated dependency installation checks');
    }
  }
});
