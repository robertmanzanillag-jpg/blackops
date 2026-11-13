import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { officeUiSimulationEvidence, OFFICE_UI_JOURNEYS } from '../server/software-factory-office-ui-evidence';
import { OFFICE_UI_STATIC_EXCLUSIONS } from '../script/software-factory-ui-static.mjs';
const hash = (v: string | Uint8Array) => createHash('sha256').update(v).digest('hex');
test('only exact complete two-version/two-viewport browser evidence is admitted', () => {
    const expected = { projectId: 'asistente', baseSha: 'a'.repeat(40), headSha: 'b'.repeat(40), runId: '123', runAttempt: '1', workflowSha256: 'c'.repeat(64), harnessSha256: 'd'.repeat(64), now: new Date('2026-11-07T01:00:00Z') };
    const screenshots = new Map<string, Uint8Array>();
    const report: any = { version: 1, projectId: 'asistente', synthetic: true, scope: 'office-ui-regression', createdAt: expected.now.toISOString(), scenarioSha256: hash(JSON.stringify(OFFICE_UI_JOURNEYS)), passed: true, provenance: { ...expected, version: 1, scope: 'office-ui-regression', repository: 'robertmanzanillag-jpg/blackops' } };
    report.provenance.staticExclusions = OFFICE_UI_STATIC_EXCLUSIONS;
    for (const role of ['baseline', 'candidate']) {
        const files = [{ path: 'index.html', sha256: hash('synthetic HTML') }];
        report.provenance[role] = { sourceManifestSha256: 'e'.repeat(64), staticManifest: { files, sha256: hash(JSON.stringify(files)) } };
        report[role] = { role, headSha: role === 'baseline' ? expected.baseSha : expected.headSha, cases: ['desktop', 'mobile'].flatMap(viewport => OFFICE_UI_JOURNEYS.map(scenarioId => { const screenshot = `screenshots/${role}-${viewport}-${scenarioId}.png`, bytes = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(101, 7)]); screenshots.set(screenshot, bytes); return { scenarioId, viewport, passed: true, errors: [], screenshot, screenshotSha256: hash(bytes) }; })) };
    }
    const parse = (r = report) => officeUiSimulationEvidence(Buffer.from(JSON.stringify(r)), screenshots, expected);
    assert.equal(parse().passed, true);
    assert.deepEqual(parse().baselineJourneyIds, [...OFFICE_UI_JOURNEYS]);
    for (const change of [(r: any) => r.provenance.headSha = expected.baseSha, (r: any) => r.provenance.runId = 'other', (r: any) => delete r.provenance.baseline, (r: any) => r.provenance.candidate.staticManifest.files[0].sha256 = 'bad', (r: any) => r.baseline.cases.pop(), (r: any) => r.candidate.cases[0].passed = false, (r: any) => r.candidate.cases[0].screenshotSha256 = 'bad']) {
        const copy = structuredClone(report);
        change(copy);
        assert.throws(() => parse(copy));
    }
    const failed = structuredClone(report);
    failed.candidate.cases[0].passed = false;
    failed.candidate.cases[0].errors = ['Measured failure'];
    failed.passed = false;
    assert.equal(parse(failed).passed, false);
    screenshots.delete(report.baseline.cases[0].screenshot);
    assert.throws(() => parse());
});
