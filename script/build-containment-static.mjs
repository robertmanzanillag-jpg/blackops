// Static compilation only. No execution of server, compact job or pip installer.
import { build } from 'esbuild';
import ts from 'typescript';
import { readFile, copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

// The complete existing client graph, using the already reviewed offline build.
await import('./build-agents-world-client.mjs');
const source = await readFile('script/build.ts', 'utf8');
const ast = ts.createSourceFile('build.ts', source, ts.ScriptTarget.Latest, true);
let allowlist;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'allowlist'
    && node.initializer && ts.isArrayLiteralExpression(node.initializer)) {
    allowlist = node.initializer.elements.map(item => {
      if (!ts.isStringLiteral(item)) throw Error('Unsupported production dependency allowlist');
      return item.text;
    });
  }
  ts.forEachChild(node, visit);
}
visit(ast);
if (!allowlist) throw Error('Production bundle allowlist not found');
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const externals = [...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.devDependencies || {})]
  .filter(dep => !allowlist.includes(dep));
const out = path.resolve('.local/containment-static-build');
await mkdir(out, { recursive: true });
const require = createRequire(import.meta.url);
await copyFile(path.join(path.dirname(require.resolve('connect-pg-simple/package.json')), 'table.sql'), path.join(out, 'table.sql'));
await build({
  entryPoints: ['server/index.ts'], platform: 'node', bundle: true, format: 'cjs',
  outfile: path.join(out, 'index.cjs'), define: { 'process.env.NODE_ENV': '"production"' },
  minify: true, external: externals, logLevel: 'error',
});
await build({
  entryPoints: ['script/compact-local-news-state.ts'], platform: 'node',
  bundle: true, format: 'cjs', outfile: path.join(out, 'compact-local-news-state.cjs'),
  minify: true, logLevel: 'error',
});
console.log('Complete client/server/compactor static compilation passed; server/pip never executed.');
