import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { collectStaticBundle, validateStaticBundle, materializeStaticBundle } from '../script/software-factory-ui-static.mjs';
import { isExpectedInitialSessionError } from '../script/software-factory-ui-console.mjs';
test('only the measured initial native session 401 is expected', () => {
    const origin = 'http://127.0.0.1:3141';
    const response = { url: `${origin}/api/auth/me`, method: 'GET', status: 401, phase: 'initial' };
    const error = { url: response.url, phase: 'initial', text: 'Failed to load resource: the server responded with a status of 401 (Unauthorized)', argumentCount: 0, lineNumber: 0, columnNumber: 0 };
    assert.equal(isExpectedInitialSessionError(error, [response], origin), true);
    for (const change of [{ phase: 'login' }, { phase: 'authenticated' }, { argumentCount: 1 }, { lineNumber: 8 }, { columnNumber: 1 }, { url: `${origin}/assets/app.js` }, { text: 'Application failed' }])
        assert.equal(isExpectedInitialSessionError({ ...error, ...change }, [response], origin), false);
    for (const change of [{ phase: 'authenticated' }, { status: 500 }, { method: 'POST' }, { url: `${origin}/api/other` }])
        assert.equal(isExpectedInitialSessionError(error, [{ ...response, ...change }], origin), false);
    assert.equal(isExpectedInitialSessionError(error, [], origin), false);
    assert.equal(isExpectedInitialSessionError(error, [response, response], origin), false);
});
test('candidate static bytes are bounded validated data, never imported Node modules', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ui-static-'));
    try {
        await writeFile(path.join(root, 'index.html'), '<h1>Actual built bytes</h1>');
        await writeFile(path.join(root, '._opengraph.jpg'), 'Synthetic AppleDouble metadata');
        const bundle = await collectStaticBundle(root), manifest = validateStaticBundle(bundle);
        assert.equal(manifest.files.length, 1);
        const out = path.join(root, 'copied');
        await materializeStaticBundle(bundle, out);
        assert.equal(await readFile(path.join(out, 'index.html'), 'utf8'), '<h1>Actual built bytes</h1>');
        for (const name of ['../escape', '/root', 'x/../../escape', 'x\\escape', '.env', 'x/.secret', 'x:evil'])
            assert.throws(() => validateStaticBundle({ ...bundle, files: [{ ...bundle.files[0], path: name }] }));
        assert.throws(() => validateStaticBundle({ ...bundle, files: [{ ...bundle.files[0], sha256: 'a'.repeat(64) }] }));
        assert.throws(() => validateStaticBundle({ ...bundle, files: [bundle.files[0], bundle.files[0]] }));
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
