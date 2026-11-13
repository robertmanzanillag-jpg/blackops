// Offline browser harness: no HTTP listener, Express, app startup or real APIs.
import { build } from 'esbuild';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

if (!process.env.AGENTS_WORLD_BROWSER) throw new Error('Supply an already installed Chromium executable; no downloads.');
const output = path.resolve('.local/agents-world-harness');
await mkdir(output, { recursive: true });
await build({
  entryPoints: ['tests/harness/agents-world-integrated.tsx'],
  bundle: true, format: 'esm', platform: 'browser', jsx: 'automatic',
  outfile: path.join(output, 'harness.js'),
  alias: { '@': path.resolve('client/src'), '@shared': path.resolve('shared') },
  define: { 'process.env.NODE_ENV': '"test"', 'import.meta.env.DEV': 'false' },
});
const js = await readFile(path.join(output, 'harness.js'), 'utf8');
const css = await readFile(path.join(output, 'harness.css'), 'utf8');
const html = '<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/harness.css"><body style="margin:0;background:#080e18;color:#d7e7ef"><div id="root"></div><script type="module" src="/harness.js"></script></body></html>';
const origin = 'http://agents-world-harness.invalid';
const browser = await chromium.launch({
  executablePath: process.env.AGENTS_WORLD_BROWSER, headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--disable-background-networking', '--disable-component-update', '--disable-sync'],
});
const results = [];
let checks = 0;
function check(value, message) { assert.ok(value, message); checks++; console.log(`PASS ${message}`); }
const timestamp = new Date().toISOString();
async function scenario(options = {}) {
  const context = await browser.newContext({
    viewport: { width: options.mobile ? 390 : 1440, height: options.mobile ? 844 : 1000 },
    reducedMotion: options.reduced ? 'reduce' : 'no-preference',
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const state = { owner: 'fixture-user', expired: !!options.expired, empty: !!options.empty, refreshError: false };
  const requests = [], forbidden = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  if (options.fallback) await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) {
      if (String(type).includes('webgl')) return null;
      return original.call(this, type, ...args);
    };
  });
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), pathname = url.pathname;
    requests.push({ path: pathname, method: request.method() });
    if (url.origin !== origin || request.method() !== 'GET') {
      forbidden.push(request.url()); return route.abort();
    }
    if (pathname === '/agents-office') return route.fulfill({ contentType: 'text/html', body: html });
    if (pathname === '/harness.js') return route.fulfill({ contentType: 'text/javascript', body: js });
    if (pathname === '/harness.css') return route.fulfill({ contentType: 'text/css', body: css });
    const fixtures = {
      '/api/auth/me': state.expired ? { authenticated: false } : { authenticated: true, user: { id: state.owner } },
      '/api/projects': state.empty ? [] : [
        { id: 'fixture-kong', userId: 'fixture-user', name: 'KONG · TEST FIXTURE', status: 'online', lastCheck: timestamp },
        { id: 'foreign', userId: 'other', name: 'PRIVATE FOREIGN PROJECT' },
        ...(options.large ? Array.from({ length: 1000 }, (_, index) => ({ id: `large:${index}`, userId: 'fixture-user', name: `Inventory fixture ${index}` })) : []),
      ],
      '/api/tasks': state.empty ? [] : [{ id: 'fixture-task', userId: 'fixture-user', title: 'TEST FIXTURE task', updatedAt: '2020-01-01T00:00:00Z', completed: true }],
      // Existing CompanyOffice read retained, not added to the world transport.
      '/api/monthly-goals': [{ id: `goal:${state.owner}`, title: `TEST FIXTURE goal ${state.owner}`, completed: false }],
    };
    if (!(pathname in fixtures)) { forbidden.push(pathname); return route.abort(); }
    const status = pathname === '/api/auth/me' && state.expired ? 401
      : pathname === '/api/projects' && state.refreshError ? 500
      : pathname === '/api/projects' && options.denied ? 403 : 200;
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(fixtures[pathname]) });
  });
  await page.goto(`${origin}/agents-office`);
  await page.getByRole('heading', { name: 'Mundo 3D · departamentos y evidencia' }).waitFor();
  const world = page.locator('.company-agents-world');
  await page.waitForFunction(() => !document.querySelector('.world-sources')?.textContent.includes('Consultando'));
  check(await page.getByRole('button', { name: /Abrir centro operativo existente/ }).getAttribute('aria-expanded') === 'false', 'legacy center stays closed');
  check(await page.locator('.company-stats').count() === 1, 'existing CompanyOffice simulation preserved');
  check(!(await world.innerText()).includes('PRIVATE FOREIGN'), 'foreign project excluded');
  check(requests.every(request => request.path !== '/api/blackroom-agent'), 'no automatic BlackRoom GET or persistence initialization');
  check(await world.getByText('Movimiento ambiental decorativo', { exact: true }).isVisible(), 'decorative motion disclaimer');
  if (options.fallback) {
    await world.getByRole('status').filter({ hasText: 'WebGL no disponible' }).waitFor();
    check(await world.locator('.ops-webgl-fallback button').count() >= 26, 'WebGL fallback selects same entities');
    await world.locator('.ops-webgl-fallback button').filter({ hasText: 'Publicación' }).click();
    await world.getByRole('heading', { name: 'Publicación', exact: true }).waitFor();
  } else {
    const canvas = world.locator('canvas');
    await page.waitForFunction(() => Number(document.querySelector('.ops-3d-stage canvas')?.dataset.frame) > 0);
    check(await canvas.evaluate(element => element.getContext('webgl2') instanceof WebGL2RenderingContext), 'integrated real WebGL2 renderer');
    check(Number(await canvas.getAttribute('data-station-limit')) === (options.mobile ? 32 : 48), 'mobile/desktop station budget');
    await canvas.scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelector('.ops-3d-stage canvas')?.dataset.motion === (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'paused' : 'decorative'));
    if (options.reduced) {
      check(await world.getByRole('button', { name: 'Movimiento reducido', exact: true }).isDisabled(), 'reduced motion cannot be overridden');
    } else {
      const pose = await canvas.getAttribute('data-decorative-pose');
      await page.waitForFunction(value => document.querySelector('.ops-3d-stage canvas')?.dataset.decorativePose !== value, pose);
      check(await canvas.getAttribute('data-decorative-pose') !== pose, 'decorative character movement');
      await world.getByRole('button', { name: 'Pausar decoración' }).click();
      await page.waitForFunction(() => document.querySelector('.ops-3d-stage canvas')?.dataset.motion === 'paused');
    }
    const frames = await canvas.getAttribute('data-frame');
    await page.waitForTimeout(120);
    check(await canvas.getAttribute('data-frame') === frames, 'pause/reduced motion stops render work');
    const camera = await canvas.getAttribute('data-camera');
    await world.getByRole('button', { name: 'Acercar escenario' }).click();
    check(await canvas.getAttribute('data-camera') !== camera, 'camera zoom connected');
    const zoomed = await canvas.getAttribute('data-camera');
    await world.getByRole('button', { name: 'Girar cámara derecha' }).click();
    check(await canvas.getAttribute('data-camera') !== zoomed, 'camera orbit connected');
    await canvas.focus(); const beforeKey = await canvas.getAttribute('data-camera');
    await page.keyboard.press('ArrowRight');
    check(await canvas.getAttribute('data-camera') !== beforeKey, 'keyboard camera connected');
    const label = world.locator('.ops-3d-label:visible').first();
    await label.click();
    check(await label.getAttribute('aria-pressed') === 'true', 'scene label selection updates integrated detail');
    await world.getByLabel('Seleccionar entidad 3D').selectOption('content-publication');
    await world.getByRole('heading', { name: 'Publicación', exact: true }).waitFor();
  }
  check((await world.locator('.world-detail').innerText()).includes('No conectado'), 'selected content role stays disconnected');
  check((await world.locator('.world-detail').innerText()).includes('Sin evidencia de ejecución') || (await world.locator('.world-detail').innerText()).includes('sin identidad operativa'), 'detail does not fabricate execution');
  await world.getByRole('button', { name: 'Lista accesible' }).click();
  check(await world.locator('.world-directory button').count() >= 26, 'accessible list connected to same data');
  if (options.large) check(await world.locator('.world-directory button').count() === 1028, 'large inventory retained outside render cap');
  const departmentFilter = world.getByLabel('Departamento', { exact: true });
  const brandFilter = world.getByLabel('Marca / proyecto', { exact: true });
  check(!(await departmentFilter.innerText()).includes('KONG'), 'departments do not double as brand/project options');
  await departmentFilter.selectOption('Ingeniería');
  await world.locator('.world-directory button[data-entity-id="cto"]').waitFor();
  check(await world.locator('.world-directory button[data-entity-id="cto"]').count() === 1, 'CTO belongs to conceptual engineering department');
  await brandFilter.selectOption('KONG');
  await world.getByText('Sin entidades para estos filtros.', { exact: false }).waitFor();
  check(await world.locator('.world-directory button').count() === 0, 'brand/project and department filters combine independently');
  await departmentFilter.selectOption('Desconocido');
  await world.locator('.world-directory button[data-entity-id="kong"]').waitFor();
  check(await world.locator('.world-directory button').count() === 1, 'catalog brand reference keeps unknown department');
  await brandFilter.selectOption('Todas');
  await departmentFilter.selectOption('Todos');
  for (const [id, name] of [['cto', 'CTO'], ['ai-evaluator', 'Entrenador/evaluador de IA']]) {
    await world.locator(`.world-directory button[data-entity-id="${id}"]`).click();
    await world.getByRole('heading', { name, exact: true }).waitFor();
    const detail = world.locator('.world-detail');
    check((await detail.innerText()).includes('Propuesto · No conectado'), `${name} visibly proposed and disconnected`);
    check((await detail.innerText()).includes('Sin tarea actual verificada') && (await detail.innerText()).includes('No verificado'), `${name} does not claim execution/training`);
    check(await detail.locator('a').count() === 0, `${name} has no operational action`);
  }
  check((await world.getByLabel('Proceso de autorización').innerText()).includes('Revisión independiente'), 'descriptive review process visible');
  check((await world.locator('.world-governance').innerText()).includes('no son presupuestos'), 'cost criteria never grant budget or spending');
  await world.getByLabel('Buscar entidad').fill('not-found-fixture');
  check(await world.getByText('Sin entidades para estos filtros.', { exact: false }).isVisible(), 'empty filter state');
  await world.getByLabel('Buscar entidad').fill('');
  if (options.denied) check((await world.locator('.world-sources').innerText()).includes('Sin permiso'), 'owner-only denied source explicit');
  if (options.expired) check(requests.filter(request => ['/api/projects', '/api/tasks', '/api/blackroom-agent'].includes(request.path)).length === 0, 'expired native session blocks all new owner reads');
  if (!options.expired && !options.empty) {
    state.empty = true;
    await world.getByRole('button', { name: 'Actualizar lecturas' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.world-directory button').length === 26);
    check(!(await world.innerText()).includes('TEST FIXTURE task'), 'refresh removes old rows');
    state.refreshError = true;
    await world.getByRole('button', { name: 'Actualizar lecturas' }).click();
    await page.waitForFunction(() => document.querySelector('.world-sources li:first-child')?.textContent?.includes('Fuente no disponible'));
    check((await world.locator('.world-sources li:first-child').innerText()).includes('Fuente no disponible'), 'projects HTTP failure not masked by permanently disconnected BlackRoom');
    state.owner = 'second-user';
    await page.evaluate(() => window.setFixtureOwner('second-user'));
    await page.locator('.company-real-goals').getByText('TEST FIXTURE goal second-user', { exact: false }).waitFor();
    check(!(await world.innerText()).includes('KONG · TEST FIXTURE'), 'owner switch cannot retain first user rows');
    check(await page.evaluate(() => Object.keys(localStorage).filter(key => key.includes('fixture-user')).length > 0), 'old simulation remains in its own user storage');
  }
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no horizontal viewport overflow');
  check(forbidden.length === 0, `no network escape or forbidden GET (${JSON.stringify(forbidden)})`);
  check(errors.length === 0, `no browser errors (${JSON.stringify(errors)})`);
  if (!options.fallback && !options.reduced && !options.expired && !options.large && !options.denied) {
    await world.getByRole('button', { name: 'Vista 3D' }).click();
    await world.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, options.mobile ? 'mobile.png' : 'desktop.png') });
  }
  results.push({ options, requests, errors, forbidden });
  await context.close();
}
try {
  await scenario();
  if (!process.argv.includes('--smoke')) {
    await scenario({ mobile: true });
    await scenario({ reduced: true, empty: true });
    await scenario({ fallback: true });
    await scenario({ denied: true });
    await scenario({ expired: true });
    await scenario({ mobile: true, large: true });
  }
  await writeFile(path.join(output, process.argv.includes('--smoke') ? 'results-smoke.json' : 'results.json'), JSON.stringify({ checks, results, realApiCalls: 0, serversStarted: 0 }, null, 2));
  console.log(`${checks} checks passed; ${results.length} scenarios; all browser requests intercepted; no server or real API.`);
} finally { await browser.close(); }
