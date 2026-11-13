// Compile tests only; never import a live service or connect to storage/providers.
import { build } from 'esbuild';
import ts from 'typescript';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const out = path.resolve('.local/containment-tests');
await mkdir(out, { recursive: true });
const fixture = path.resolve('tests/fixtures/containment-storage.ts');
const targets = new Map([
  [path.resolve('server/storage.ts'), `export { fakeStorage as storage } from ${JSON.stringify(fixture)};`],
  [path.resolve('server/trust-policy.ts'), 'export const writeAuditLog = () => { throw Error("unexpected audit"); }; export const createPendingActionForApproval = () => { throw Error("unexpected approval"); };'],
  [path.resolve('server/user-context.ts'), 'export const getSystemUserId = () => "fixture-owner";'],
  [path.resolve('server/clippers-local-news-agent.ts'), 'export const recordClipperLocalNewsMetrics = () => { throw Error("unexpected metrics IO"); };'],
  [path.resolve('server/db.ts'), 'export const db = new Proxy({}, {get(){ throw Error("real DB forbidden"); }});'],
]);
const builtins = {
  'node:fs/promises': ['mkdir', 'readFile', 'rename', 'writeFile', 'unlink', 'open', 'stat'],
  'node:fs': ['realpathSync', 'mkdtempSync', 'rmSync', 'writeFileSync'],
  'node:child_process': ['spawn'],
};
const failExports = names => names.map(name => `export const ${name} = () => { throw Error("real operational IO forbidden: ${name}"); };`).join('\n');
const source = await readFile('server/routes.ts', 'utf8');
const sf = ts.createSourceFile('routes.ts', source, ts.ScriptTarget.Latest, true);
const handlers = new Map();
const wanted = new Set(['/api/automations', '/api/automation-manager/summary', '/api/app-qa-agent/history']);
function walk(node) {
  if (ts.isCallExpression(node) && node.expression.getText(sf) === 'app.get'
    && ts.isStringLiteral(node.arguments[0]) && wanted.has(node.arguments[0].text)) {
    handlers.set(node.arguments[0].text, node.arguments[1].getText(sf));
  }
  ts.forEachChild(node, walk);
}
walk(sf);
if (handlers.size !== wanted.size) throw Error('Missing actual GET handlers');
const bridgeSource = await readFile('server/blackroom-control-routes.ts', 'utf8');
const bridgeAst = ts.createSourceFile('control.ts', bridgeSource, ts.ScriptTarget.Latest, true);
let scheduleHandler;
function findSchedule(node) {
  if (ts.isCallExpression(node) && node.expression.getText(bridgeAst) === 'app.post'
    && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === '/api/blackroom-agent/metricool/schedule') {
    scheduleHandler = node.arguments[1].getText(bridgeAst);
  }
  ts.forEachChild(node, findSchedule);
}
findSchedule(bridgeAst);
if (!scheduleHandler) throw Error('Missing actual schedule handler');
const cleanup = bridgeAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'cleanupExpiredBlackRoomUploads');
const workerSource = await readFile('script/blackroom-local-worker.ts', 'utf8');
const workerAst = ts.createSourceFile('worker.ts', workerSource, ts.ScriptTarget.Latest, true);
const worker = workerAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'publishOneReservedEntry');
let workerCatch, verifyExpression;
function workerVisit(node) {
  if (ts.isTryStatement(node) && node.tryBlock.getText(workerAst).includes('/api/blackroom-agent/metricool/schedule')) workerCatch = node.catchClause.getText(workerAst);
  if (ts.isVariableDeclaration(node) && node.name.getText(workerAst) === 'verifyOnly') verifyExpression = node.initializer.getText(workerAst);
  ts.forEachChild(node, workerVisit);
}
if (worker) workerVisit(worker);
if (!cleanup || !workerCatch || !verifyExpression) throw Error('Missing real cleanup/worker attempt logic');
const virtual = `import { BlackRoomMetricoolUncertainError } from ${JSON.stringify(path.resolve('server/blackroom-metricool-bridge.ts'))};
import { BlackRoomPublicationBlockedError } from ${JSON.stringify(path.resolve('server/blackroom-publication-guard.ts'))};
export function getHandlers(storage, getExistingAutomations, getCurrentUserId) {
  return {${[...handlers].map(([key, handler]) => `${JSON.stringify(key)}: ${handler}`).join(',')}};
}
export function scheduleHandler(deps) {
  const {hasValidBlackRoomRemoteToken, blackRoomUploads, scheduleBlackRoomMetricoolPost,
    readExistingBlackRoomRemoteControl, readBlackRoomQueue, mutateBlackRoomRemoteControl,
    recordBlackRoomPublicationExperiment, removeBlackRoomUpload} = deps;
  return ${scheduleHandler};
}
export function cleanupUploads(deps, now) {
  const {blackRoomUploads, removeBlackRoomUpload} = deps;
  ${cleanup.getText(bridgeAst)}
  cleanupExpiredBlackRoomUploads(now);
}
export function workerVerifyOnly(entry, network) { return ${verifyExpression}; }
export async function workerFailure(error, verifyOnly, entry, network, runNpm) {
  try { throw error; } ${workerCatch}
}`;
const result = await build({
  entryPoints: ['tests/legacy-publication-containment.test.ts'], bundle: true,
  platform: 'node', format: 'cjs', outfile: path.join(out, 'tests.cjs'), metafile: true,
  alias: { '@shared': path.resolve('shared') },
  plugins: [{
    name: 'no-live-adapters',
    setup(build) {
      build.onResolve({ filter: /^containment-handlers$/ }, () => ({ path: 'handlers', namespace: 'fake-handlers' }));
      build.onLoad({ filter: /.*/, namespace: 'fake-handlers' }, () => ({ contents: virtual, loader: 'ts', resolveDir: process.cwd() }));
      build.onResolve({ filter: /^node:/ }, args => args.path in builtins ? { path: args.path, namespace: 'forbidden-builtins' } : undefined);
      build.onLoad({ filter: /.*/, namespace: 'forbidden-builtins' }, args => ({ contents: failExports(builtins[args.path]), loader: 'js' }));
      build.onLoad({ filter: /\.ts$/ }, args => targets.has(args.path) ? { contents: targets.get(args.path), loader: 'ts', resolveDir: path.dirname(args.path) } : undefined);
    },
  }],
});
for (const input of Object.keys(result.metafile.inputs)) {
  if (/node_modules\/(pg|express-session|connect-pg-simple)\//.test(input)) throw Error(`Forbidden dependency in test graph: ${input}`);
}
const test = spawnSync(process.execPath, ['--test', path.join(out, 'tests.cjs')], { stdio: 'inherit', env: { PATH: process.env.PATH, HOME: '/tmp', NODE_ENV: 'test' } });
process.exitCode = test.status ?? 1;
