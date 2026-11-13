// Run ONLY from the reviewed baseline tree. Candidate assets are served as bytes.
import { build } from 'esbuild';
import express from 'express';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
export async function launchOfficeUiFixture(staticRoot, revision) {
    if (!/^[a-f0-9]{40}$/.test(revision))
        throw Error('UI_REVISION_INVALID');
    const temp = await mkdtemp(path.join(os.tmpdir(), 'office-ui-'));
    const keys = ['NODE_ENV', 'ALLOW_DEV_USER_FALLBACK', 'DEFAULT_USER_ID'];
    const saved = keys.map(k => [k, process.env[k]]);
    process.env.NODE_ENV = 'development';
    delete process.env.ALLOW_DEV_USER_FALLBACK;
    process.env.DEFAULT_USER_ID = 'fixture-owner';
    const users = new Map();
    globalThis.__factoryUiUsers = users;
    let server;
    const close = async () => { if (server)
        await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); for (const [k, v] of saved) {
        if (v === undefined)
            delete process.env[k];
        else
            process.env[k] = v;
    } delete globalThis.__factoryUiUsers; await rm(temp, { recursive: true, force: true }); };
    try {
        await build({ stdin: { contents: `export {registerLocalAuthRoutes,hashPassword} from './server/local-auth';export {createSessionMiddleware} from './server/session-config';export {resolveCurrentUserId} from './server/user-context';`, resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm', packages: 'external', outfile: path.join(temp, 'auth.mjs'), plugins: [{ name: 'synthetic-storage', setup(b) { b.onResolve({ filter: /^\.\/storage$/ }, () => ({ path: 'storage', namespace: 'fixture' })); b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const storage={getUser:async id=>globalThis.__factoryUiUsers.get(id),getUserByUsername:async name=>[...globalThis.__factoryUiUsers.values()].find(u=>u.username===name),checkPersistentRateLimit:async()=>({allowed:true,remaining:19,resetAt:Date.now()+900000})};' })); } }] });
        const auth = await import(pathToFileURL(path.join(temp, 'auth.mjs')).href);
        for (const id of ['fixture-owner', 'fixture-member'])
            users.set(id, { id, username: id, password: await auth.hashPassword('local-fixture-password') });
        const app = express();
        app.use((_req, res, next) => { res.setHeader('x-factory-head-sha', revision); next(); });
        app.use(express.json());
        app.use(auth.createSessionMiddleware({ enabled: true, secret: 'isolated-fixture-session-key', storeKind: 'memory', production: false, secureCookie: false }));
        auth.registerLocalAuthRoutes(app);
        app.use('/api', (req, res, next) => { const id = auth.resolveCurrentUserId(req); if (!id)
            return res.status(401).json({ error: 'Authentication required' }); req.fixtureUserId = id; next(); });
        app.get('/api/monthly-goals', (req, res) => res.json([{ id: req.fixtureUserId + '-goal', title: 'Synthetic UI regression fixture', completed: false }]));
        app.get('/api/agents-office/connections', (_req, res) => { const blocked = { status: 'blocked', reason: 'Synthetic fixture; no external connection', checkedAt: new Date().toISOString() }; res.json({ claude: blocked, kong: blocked, worker: blocked }); });
        app.get('/api/agents-office/kong-snapshot', (_req, res) => res.json({ text: 'Synthetic disconnected fixture', evidence: { agents: [], cities: [], cityAgentsEnabled: false } }));
        app.get('/api/agent-council/state', (_req, res) => res.json({ enabled: false, cycles: 0, costUsd: 0, lessons: [], debates: [], proposals: [], overrides: {}, scout: { lastRunAt: null, latest: [], error: null } }));
        app.get('/api/ceo/conversation-history', (_req, res) => res.json({ messages: [] }));
        for (const route of ['/api/ceo/go-live', '/api/ceo/readiness'])
            app.get(route, (_req, res) => res.json({ status: 'blocked', checks: [] }));
        app.get('/api/legal-compliance/reports', (_req, res) => res.json({ reports: [], summary: { critico: 0, revisar: 0, info: 0 } }));
        app.use('/api', (req, res) => req.method === 'GET' ? res.json([]) : res.status(403).json({ error: 'Fixture forbids mutation' }));
        app.use(express.static(staticRoot, { dotfiles: 'deny', redirect: false }));
        const html = await readFile(path.join(staticRoot, 'index.html'));
        app.use((req, res) => ['GET', 'HEAD'].includes(req.method) ? res.type('html').send(html) : res.sendStatus(405));
        server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
        return { baseUrl: `http://127.0.0.1:${server.address().port}/`, close };
    }
    catch (error) {
        await close();
        throw error;
    }
}
