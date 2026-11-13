import { createHash } from 'node:crypto';
import type { FactoryEvidence } from './software-factory';
import { OFFICE_UI_STATIC_EXCLUSIONS } from '../script/software-factory-ui-static.mjs';
const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export const OFFICE_UI_JOURNEYS = ['office-session-login', 'office-company-navigation'] as const;
/** Caller must authenticate the exact artifact/run/workflow before invoking this
 * parser. This never downloads artifacts or trusts candidate-provided reports. */
export function officeUiSimulationEvidence(reportBytes: Uint8Array, screenshots: ReadonlyMap<string, Uint8Array>, expected: {
    projectId: string;
    baseSha: string;
    headSha: string;
    runId: string;
    runAttempt: string;
    workflowSha256: string;
    harnessSha256: string;
    now: Date;
}): FactoryEvidence {
    if (reportBytes.length > 2097152)
        throw Error('UI_EVIDENCE_SIZE');
    const report = JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(reportBytes));
    const p = report.provenance;
    if (JSON.stringify(p?.staticExclusions) !== JSON.stringify(OFFICE_UI_STATIC_EXCLUSIONS)) throw Error('UI_EVIDENCE_EXCLUSIONS');
    if (![expected.baseSha, expected.headSha].every(s => /^[a-f0-9]{40}$/.test(s)) || expected.baseSha === expected.headSha || ![expected.workflowSha256, expected.harnessSha256].every(s => /^[a-f0-9]{64}$/.test(s)) || report.version !== 1 || report.synthetic !== true || report.scope !== 'office-ui-regression' || report.projectId !== expected.projectId || p?.version !== 1 || p.scope !== 'office-ui-regression' || p.projectId !== expected.projectId || p.repository !== 'robertmanzanillag-jpg/blackops' || p.baseSha !== expected.baseSha || p.headSha !== expected.headSha || p.runId !== expected.runId || p.runAttempt !== expected.runAttempt || p.workflowSha256 !== expected.workflowSha256 || p.harnessSha256 !== expected.harnessSha256 || report.scenarioSha256 !== hash(JSON.stringify(OFFICE_UI_JOURNEYS)))
        throw Error('UI_EVIDENCE_IDENTITY');
    const age = expected.now.getTime() - Date.parse(report.createdAt);
    if (!Number.isFinite(age) || age < 0 || age > 3600000)
        throw Error('UI_EVIDENCE_STALE');
    const artifactIds = [hash(reportBytes)], warnings: string[] = [];
    for (const role of ['baseline', 'candidate'] as const) {
        const source = p[role], manifest = source?.staticManifest;
        if (!/^[a-f0-9]{64}$/.test(source?.sourceManifestSha256 ?? '') || !manifest || !Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > 2000 || !/^[a-f0-9]{64}$/.test(manifest.sha256 ?? '') || hash(JSON.stringify(manifest.files)) !== manifest.sha256)
            throw Error('UI_EVIDENCE_MANIFEST');
        const names = new Set<string>();
        for (const f of manifest.files) {
            if (typeof f?.path !== 'string' || f.path.length > 300 || f.path.split('/').some((s: string) => !s || s === '.' || s === '..' || s.startsWith('.')) || /[\\:\x00-\x20]/.test(f.path) || names.has(f.path.toLowerCase()) || !/^[a-f0-9]{64}$/.test(f.sha256 ?? ''))
                throw Error('UI_EVIDENCE_MANIFEST');
            names.add(f.path.toLowerCase());
        }
        if (!names.has('index.html'))
            throw Error('UI_EVIDENCE_MANIFEST');
        const version = report[role];
        if (version?.role !== role || version.headSha !== (role === 'baseline' ? expected.baseSha : expected.headSha) || !Array.isArray(version.cases) || version.cases.length !== 4)
            throw Error('UI_EVIDENCE_COVERAGE');
        for (const viewport of ['desktop', 'mobile'])
            for (const scenarioId of OFFICE_UI_JOURNEYS) {
                const matches = version.cases.filter((c: any) => c.viewport === viewport && c.scenarioId === scenarioId);
                if (matches.length !== 1)
                    throw Error('UI_EVIDENCE_COVERAGE');
                const c = matches[0], name = `screenshots/${role}-${viewport}-${scenarioId}.png`, bytes = screenshots.get(name);
                if (c.screenshot !== name || !bytes || bytes.length < 100 || bytes.length > 10485760 || !Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || !/^[a-f0-9]{64}$/.test(c.screenshotSha256 ?? '') || hash(bytes) !== c.screenshotSha256 || !Array.isArray(c.errors) || c.errors.length > 30 || c.errors.some((e: unknown) => typeof e !== 'string') || typeof c.passed !== 'boolean' || c.passed !== (c.errors.length === 0))
                    throw Error('UI_EVIDENCE_CASE');
                artifactIds.push(c.screenshotSha256);
                if (role === 'candidate' && !c.passed)
                    warnings.push(`${viewport}:${scenarioId}`);
            }
    }
    if (report.passed !== (warnings.length === 0))
        throw Error('UI_EVIDENCE_RESULT');
    return { projectId: expected.projectId, baseSha: expected.baseSha, headSha: expected.headSha, kind: 'simulation', passed: report.passed, warnings, createdAt: report.createdAt, actorId: 'trusted-office-ui-oracle', artifactIds, journeyIds: [...OFFICE_UI_JOURNEYS], baselineJourneyIds: [...OFFICE_UI_JOURNEYS], viewports: ['desktop', 'mobile'], syntheticData: true, externalServicesMocked: true };
}
