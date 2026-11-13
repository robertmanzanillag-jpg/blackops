import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createOfficeUiArtifactReader, readOfficeUiZip } from '../server/software-factory-office-ui-artifact';
import { OFFICE_UI_JOURNEYS } from '../server/software-factory-office-ui-evidence';
import { OFFICE_UI_HARNESS_FILES, OFFICE_UI_STATIC_EXCLUSIONS } from '../script/software-factory-ui-static.mjs';
const hash = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
function zipFiles(files: Map<string, Buffer>) {
    const local: Buffer[] = [], central: Buffer[] = [];
    let offset = 0;
    for (const [name, bytes] of files) {
        const n = Buffer.from(name), h = Buffer.alloc(30), c = Buffer.alloc(46);
        h.writeUInt32LE(0x04034b50);
        h.writeUInt16LE(20, 4);
        h.writeUInt32LE(bytes.length, 18);
        h.writeUInt32LE(bytes.length, 22);
        h.writeUInt16LE(n.length, 26);
        c.writeUInt32LE(0x02014b50);
        c.writeUInt16LE(20, 4);
        c.writeUInt16LE(20, 6);
        c.writeUInt32LE(bytes.length, 20);
        c.writeUInt32LE(bytes.length, 24);
        c.writeUInt16LE(n.length, 28);
        c.writeUInt32LE(offset, 42);
        local.push(h, n, bytes);
        central.push(c, n);
        offset += h.length + n.length + bytes.length;
    }
    const directory = Buffer.concat(central), end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50);
    end.writeUInt16LE(files.size, 8);
    end.writeUInt16LE(files.size, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...local, directory, end]);
}
function fixture(allowGitHubResultsAzureHosts = false) {
    const repository = 'robertmanzanillag-jpg/blackops', root = `https://api.github.com/repos/${repository}`, baseSha = 'a'.repeat(40), headSha = 'b'.repeat(40), branch = `factory/${baseSha}-${'c'.repeat(64)}`, now = new Date('2026-11-07T02:00:00Z');
    const input = { projectId: 'asistente', baseSha, headSha, runId: 123, signal: new AbortController().signal }, workflow = 'trusted workflow', workflowSha256 = hash(workflow), harnessSha256 = hash(JSON.stringify(OFFICE_UI_HARNESS_FILES.map((p: string) => [p, hash(p)])));
    const sourceFiles = [{ path: 'index.html', sha256: hash('html') }], source = { sourceManifestSha256: 'd'.repeat(64), staticManifest: { files: sourceFiles, sha256: hash(JSON.stringify(sourceFiles)) } };
    const report: any = { version: 1, projectId: 'asistente', synthetic: true, scope: 'office-ui-regression', createdAt: now.toISOString(), scenarioSha256: hash(JSON.stringify(OFFICE_UI_JOURNEYS)), passed: true, provenance: { version: 1, scope: 'office-ui-regression', projectId: 'asistente', repository, baseSha, headSha, runId: '123', runAttempt: '1', workflowSha256, harnessSha256, baseline: source, candidate: source } };
    report.provenance.staticExclusions = OFFICE_UI_STATIC_EXCLUSIONS;
    const files = new Map<string, Buffer>();
    for (const role of ['baseline', 'candidate'])
        report[role] = { role, headSha: role === 'baseline' ? baseSha : headSha, cases: ['desktop', 'mobile'].flatMap(viewport => OFFICE_UI_JOURNEYS.map(scenarioId => { const screenshot = `screenshots/${role}-${viewport}-${scenarioId}.png`, bytes = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(101)]); files.set(screenshot, bytes); return { scenarioId, viewport, passed: true, errors: [], screenshot, screenshotSha256: hash(bytes) }; })) };
    files.set('evidence.json', Buffer.from(JSON.stringify(report)));
    const archive = zipFiles(files);
    const run: any = { id: 123, workflow_id: 7, run_attempt: 1, status: 'completed', conclusion: 'success', event: 'push', head_sha: headSha, head_branch: branch, repository: { full_name: repository }, head_repository: { full_name: repository }, html_url: `https://github.com/${repository}/actions/runs/123`, path: '.github/workflows/factory-candidate-checks.yml' };
    let downloads = 0, host = 'productionresultssa7.blob.core.windows.net';
    const apiRequest = async (url: string, init: RequestInit) => {
        assert.equal(init.method, 'GET');
        assert.ok(init.signal);
        if (url === root)
            return Response.json({ full_name: repository, private: false, archived: false, disabled: false });
        if (url === `${root}/actions/runs/123`)
            return Response.json(run);
        if (url.includes('/contents/')) {
            const path = new URL(url).pathname.split('/contents/')[1], text = path.startsWith('.github/') ? workflow : path;
            return Response.json({ type: 'file', path, encoding: 'base64', content: Buffer.from(text).toString('base64'), size: Buffer.byteLength(text) });
        }
        if (url.includes('/attempts/'))
            return Response.json({ total_count: 1, jobs: [{ run_id: 123, head_sha: headSha, name: 'isolated-checks', status: 'completed', conclusion: 'success', labels: ['ubuntu-24.04'], steps: ['Exact revision office UI regression', 'Save measured office UI regression'].map(name => ({ name, status: 'completed', conclusion: 'success' })) }] });
        if (url.includes('/artifacts?'))
            return Response.json({ total_count: 1, artifacts: [{ name: 'office-ui-simulation-v1', id: 77, expired: false, workflow_run: { id: 123, head_sha: headSha }, digest: `sha256:${hash(archive)}`, size_in_bytes: archive.length, archive_download_url: `${root}/actions/artifacts/77/zip` }] });
        if (url === `${root}/actions/artifacts/77/zip`)
            return new Response(null, { status: 302, headers: { location: `https://${host}/archive?fixture=1` } });
        throw Error('Unexpected request');
    };
    const reader = createOfficeUiArtifactReader({ apiRequest, download: async (_url, init) => { downloads++; assert.equal(init.credentials, 'omit'); assert.deepEqual(init.headers, {}); assert.equal(init.redirect, 'error'); return new Response(archive); }, archiveHosts: [host], allowGitHubResultsAzureHosts, workflowId: 7, workflowSha256, harnessSha256, now: () => now });
    return { reader, input, run, archive, files, get downloads() { return downloads; }, set host(h: string) { host = h; } };
}
test('authenticated run and artifact produce exact simulation evidence without archive credentials', async () => {
    const f = fixture(), e = await f.reader(f.input);
    assert.equal(e.kind, 'simulation');
    assert.equal(e.passed, true);
    assert.equal(e.headSha, f.input.headSha);
    assert.deepEqual(e.journeyIds, [...OFFICE_UI_JOURNEYS]);
    assert.equal(f.downloads, 1);
});
test('UI reader requires opt-in for authenticated GitHub result shard redirects', async () => {
    const denied = fixture(); denied.host = 'productionresultssa12.blob.core.windows.net';
    await assert.rejects(denied.reader(denied.input)); assert.equal(denied.downloads, 0);
    const allowed = fixture(true); allowed.host = 'productionresultssa12.blob.core.windows.net';
    assert.equal((await allowed.reader(allowed.input)).passed, true); assert.equal(allowed.downloads, 1);
    const wrongRun = fixture(true); wrongRun.host = 'productionresultssa12.blob.core.windows.net'; wrongRun.run.head_sha = 'e'.repeat(40);
    await assert.rejects(wrongRun.reader(wrongRun.input)); assert.equal(wrongRun.downloads, 0);
});
test('wrong run identity and unapproved redirect cannot reach download', async () => {
    for (const change of [(r: any) => r.head_sha = 'e'.repeat(40), (r: any) => r.run_attempt = 2, (r: any) => r.event = 'pull_request', (r: any) => r.conclusion = 'failure']) {
        const f = fixture();
        change(f.run);
        await assert.rejects(f.reader(f.input));
        assert.equal(f.downloads, 0);
    }
    const f = fixture();
    f.host = 'attacker.example';
    await assert.rejects(f.reader(f.input), /HOST/);
    assert.equal(f.downloads, 0);
});
test('archive rejects wrong digest, extra files, paths and missing screenshots', () => {
    const f = fixture();
    assert.equal(readOfficeUiZip(f.archive, hash(f.archive)).size, 9);
    assert.throws(() => readOfficeUiZip(f.archive, '0'.repeat(64)));
    for (const name of ['../escape', 'screenshots/unknown.png']) {
        const files = new Map(f.files);
        const [first] = files.keys();
        files.delete(first);
        files.set(name, Buffer.from('x'));
        const archive = zipFiles(files);
        assert.throws(() => readOfficeUiZip(archive, hash(archive)));
    }
    const files = new Map(f.files);
    files.delete('evidence.json');
    const archive = zipFiles(files);
    assert.throws(() => readOfficeUiZip(archive, hash(archive)));
});
