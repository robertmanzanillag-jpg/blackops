import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { launchOfficeUiFixture } from './software-factory-office-ui-fixture.mjs';
import { collectStaticBundle, validateStaticBundle } from './software-factory-ui-static.mjs';
import { isExpectedInitialSessionError } from './software-factory-ui-console.mjs';
const digest = b => createHash('sha256').update(b).digest('hex');
const input = JSON.parse(await readFile('/input/provenance.json', 'utf8'));
assert.equal(input.scope, 'office-ui-regression');
assert.notEqual(input.baseSha, input.headSha);
const journeyIds = ['office-session-login', 'office-company-navigation'];
await mkdir('/evidence/screenshots', { recursive: true });
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const versions = [];
try {
    for (const role of ['baseline', 'candidate']) {
        const headSha = role === 'baseline' ? input.baseSha : input.headSha;
        const actual = validateStaticBundle(await collectStaticBundle(`/static/${role}`));
        assert.deepEqual(actual, input[role].staticManifest);
        const fixture = await launchOfficeUiFixture(`/static/${role}`, headSha), cases = [];
        try {
            for (const viewport of ['desktop', 'mobile'])
                for (const scenarioId of journeyIds) {
                    const context = await browser.newContext({ viewport: viewport === 'desktop' ? { width: 1440, height: 1000 } : { width: 390, height: 844 }, serviceWorkers: 'block', acceptDownloads: false, reducedMotion: 'reduce' });
                    const errors = [], mockedResources = new Set();
                    const consoleErrors = [], initialSessionResponses = [];
                    let phase = 'initial';
                    const record = s => { if (errors.length < 30)
                        errors.push(s); };
                    const origin = new URL(fixture.baseUrl).origin;
                    await context.route('**/*', route => {
                        const u = new URL(route.request().url());
                        if (u.origin === origin)
                            return route.continue();
                        // Fixed synthetic font adapter; no connection is made to Google.
                        if (u.origin === 'https://fonts.googleapis.com' && u.pathname === '/css2') {
                            mockedResources.add('google-font-stylesheet');
                            return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
                        }
                        record('External request blocked');
                        return route.abort();
                    });
                    await context.routeWebSocket('**/*', socket => { record('WebSocket blocked'); socket.close(); });
                    const page = await context.newPage();
                    page.setDefaultTimeout(10000);
                    page.setDefaultNavigationTimeout(10000);
                    page.on('pageerror', () => record('Uncaught browser error'));
                    page.on('console', message => {
                        if (message.type() !== 'error') return;
                        if (consoleErrors.length >= 30) { record('Console error limit exceeded'); return; }
                        consoleErrors.push({ ...message.location(), text: message.text().slice(0, 256), argumentCount: message.args().length, phase });
                    });
                    page.on('response', r => {
                        if (r.status() >= 500) record('Server response error');
                        if (phase === 'initial' && r.url() === origin + '/api/auth/me') {
                            if (initialSessionResponses.length < 30)
                                initialSessionResponses.push({ url: r.url(), method: r.request().method(), status: r.status(), phase });
                            else record('Initial session response limit exceeded');
                        }
                    });
                    let screenshotSha256 = '';
                    const screenshot = `screenshots/${role}-${viewport}-${scenarioId}.png`;
                    try {
                        const [initialSession, response] = await Promise.all([
                            page.waitForResponse(r => r.url() === origin + '/api/auth/me' && r.request().method() === 'GET'),
                            page.goto(new URL('/agents-office', fixture.baseUrl).href)
                        ]);
                        assert.equal(initialSession.status(), 401);
                        assert.equal(response.status(), 200);
                        assert.equal(response.headers()['x-factory-head-sha'], headSha);
                        await page.getByLabel('Usuario', { exact: true }).waitFor();
                        assert.equal(await page.locator('.company-office').count(), 0);
                        await page.getByLabel('Usuario', { exact: true }).fill('fixture-member');
                        await page.getByLabel('Password', { exact: true }).fill('local-fixture-password');
                        phase = 'login';
                        const [login, session] = await Promise.all([
                            page.waitForResponse(r => r.url() === origin + '/api/auth/login' && r.request().method() === 'POST'),
                            page.waitForResponse(r => r.url() === origin + '/api/auth/me' && r.request().method() === 'GET'),
                            page.getByRole('button', { name: 'Entrar', exact: true }).last().click()
                        ]);
                        assert.equal(login.status(), 200);
                        assert.equal(session.status(), 200);
                        const auth = await session.json();
                        assert.equal(auth.sessionBacked, true);
                        assert.equal(auth.user.id, 'fixture-member');
                        phase = 'authenticated';
                        await page.getByTestId('button-back-home').waitFor();
                        if (scenarioId === 'office-company-navigation') {
                            await page.getByRole('button', { name: /^Abrir Company World/ }).click();
                            await page.locator('.company-office').getByRole('heading', { name: 'Tu empresa, en movimiento.' }).waitFor();
                        }
                        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
                    }
                    catch {
                        record('Actual UI journey failed');
                    }
                    try {
                        const bytes = await page.screenshot({ fullPage: true, timeout: 10000 });
                        screenshotSha256 = digest(bytes);
                        await writeFile(`/evidence/${screenshot}`, bytes, { flag: 'wx' });
                    }
                    catch {
                        record('Screenshot unavailable');
                    }
                    let expectedInitialSessionErrors = 0;
                    const consoleDiagnostics = consoleErrors.map(error => {
                        const expected = expectedInitialSessionErrors === 0 && isExpectedInitialSessionError(error, initialSessionResponses, origin);
                        if (expected) expectedInitialSessionErrors++;
                        else record('Browser console error');
                        return { phase: error.phase, endpoint: error.url === origin + '/api/auth/me' ? '/api/auth/me' : 'other', nativeInitial401: expected, argumentCount: Math.min(error.argumentCount, 100), lineNumber: Math.min(Math.max(error.lineNumber, 0), 100000), columnNumber: Math.min(Math.max(error.columnNumber, 0), 100000), nativeTextSignature: error.text === 'Failed to load resource: the server responded with a status of 401 (Unauthorized)' };
                    });
                    cases.push({ scenarioId, viewport, passed: errors.length === 0, errors, screenshot, screenshotSha256, mockedResources: [...mockedResources], initialSessionStatus: initialSessionResponses[0]?.status, expectedInitialSessionErrors, consoleDiagnostics });
                    await context.close();
                }
        }
        finally {
            await fixture.close();
        }
        versions.push({ role, headSha, cases });
    }
}
finally {
    await browser.close();
}
const [baseline, candidate] = versions;
const regressions = candidate.cases.filter((c, i) => !c.passed && baseline.cases[i].passed).map(c => `${c.viewport}:${c.scenarioId}`);
const report = { version: 1, projectId: input.projectId, synthetic: true, scope: 'office-ui-regression', createdAt: new Date().toISOString(), scenarioSha256: digest(JSON.stringify(journeyIds)), baseline, candidate, passed: candidate.cases.every(c => c.passed), regressions, provenance: input, coverage: 'Compiled Asistente UI, baseline authentication and synthetic services. Does not certify role-work improvements or live deployment.' };
await writeFile('/evidence/evidence.json', JSON.stringify(report), { flag: 'wx', mode: 0o600 });
if (!report.passed)
    process.exitCode = 1;
