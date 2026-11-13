import {verifiedGitHubArtifactLocation} from "./software-factory-artifact-host";
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { officeUiSimulationEvidence, OFFICE_UI_JOURNEYS } from './software-factory-office-ui-evidence';
import { OFFICE_UI_HARNESS_FILES } from '../script/software-factory-ui-static.mjs';
const repository = 'robertmanzanillag-jpg/blackops', root = `https://api.github.com/repos/${repository}`;
const digest = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const paths = ['evidence.json', ...['baseline', 'candidate'].flatMap(role => ['desktop', 'mobile'].flatMap(viewport => OFFICE_UI_JOURNEYS.map(journey => `screenshots/${role}-${viewport}-${journey}.png`)))];
/** No filesystem extraction, ZIP64, encryption, directories, duplicates or extra files. */
export function readOfficeUiZip(zip: Buffer, expectedSha256: string): Map<string, Buffer> {
    if (zip.length < 22 || zip.length > 32 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(expectedSha256) || digest(zip) !== expectedSha256)
        throw Error('UI_ARCHIVE_DIGEST');
    const end = zip.length - 22;
    if (zip.readUInt32LE(end) !== 0x06054b50 || zip.readUInt16LE(end + 4) !== 0 || zip.readUInt16LE(end + 6) !== 0 || zip.readUInt16LE(end + 8) !== 9 || zip.readUInt16LE(end + 10) !== 9 || zip.readUInt16LE(end + 20) !== 0)
        throw Error('UI_ARCHIVE_LAYOUT');
    const central = zip.readUInt32LE(end + 16), centralSize = zip.readUInt32LE(end + 12);
    if (central + centralSize !== end)
        throw Error('UI_ARCHIVE_LAYOUT');
    let cursor = central, total = 0;
    const files = new Map<string, Buffer>(), ranges: Array<[
        number,
        number
    ]> = [];
    for (let i = 0; i < 9; i++) {
        if (cursor + 46 > end || zip.readUInt32LE(cursor) !== 0x02014b50)
            throw Error('UI_ARCHIVE_LAYOUT');
        const flags = zip.readUInt16LE(cursor + 8), method = zip.readUInt16LE(cursor + 10), compressed = zip.readUInt32LE(cursor + 20), size = zip.readUInt32LE(cursor + 24), nameLength = zip.readUInt16LE(cursor + 28), extra = zip.readUInt16LE(cursor + 30), comment = zip.readUInt16LE(cursor + 32), offset = zip.readUInt32LE(cursor + 42);
        if (cursor + 46 + nameLength + extra + comment > end || flags & ~0x808 || ![0, 8].includes(method) || zip.readUInt16LE(cursor + 34) !== 0 || size > 10 * 1024 * 1024 || (total += size) > 32 * 1024 * 1024)
            throw Error('UI_ARCHIVE_ENTRY');
        const name = new TextDecoder('utf8', { fatal: true }).decode(zip.subarray(cursor + 46, cursor + 46 + nameLength));
        if (!paths.includes(name) || files.has(name) || offset + 30 > central || zip.readUInt32LE(offset) !== 0x04034b50 || zip.readUInt16LE(offset + 6) !== flags || zip.readUInt16LE(offset + 8) !== method)
            throw Error('UI_ARCHIVE_ENTRY');
        const localName = zip.readUInt16LE(offset + 26), localExtra = zip.readUInt16LE(offset + 28), start = offset + 30 + localName + localExtra, finish = start + compressed;
        if (finish > central || localName !== nameLength || zip.subarray(offset + 30, offset + 30 + localName).toString('utf8') !== name || ranges.some(([a, b]) => offset < b && finish > a))
            throw Error('UI_ARCHIVE_OVERLAP');
        ranges.push([offset, finish]);
        const packed = zip.subarray(start, finish);
        const bytes = method === 0 ? Buffer.from(packed) : inflateRawSync(packed, { maxOutputLength: 10 * 1024 * 1024 });
        if (bytes.length !== size || (name === 'evidence.json' && size > 2097152))
            throw Error('UI_ARCHIVE_SIZE');
        files.set(name, bytes);
        cursor += 46 + nameLength + extra + comment;
    }
    if (cursor !== end)
        throw Error('UI_ARCHIVE_LAYOUT');
    return files;
}
async function bytes(response: Response, max: number) {
    const reader = response.body?.getReader();
    if (!reader)
        throw Error('UI_RESPONSE_EMPTY');
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
        for (;;) {
            const c = await reader.read();
            if (c.done)
                break;
            if ((total += c.value.length) > max)
                throw Error('UI_RESPONSE_SIZE');
            chunks.push(c.value);
        }
    }
    finally {
        await reader.cancel();
    }
    return Buffer.concat(chunks);
}
/** Requests must be credential-scoped to GitHub; download MUST NOT add credentials.
 * A controller-installed workflow/harness digest is required, never read from candidates. */
export function createOfficeUiArtifactReader(options: {
    apiRequest: (url: string, init: RequestInit) => Promise<Response>;
    download: (url: string, init: RequestInit) => Promise<Response>;
    archiveHosts: readonly string[];
    allowGitHubResultsAzureHosts?: boolean;
    workflowId: number;
    workflowSha256: string;
    harnessSha256: string;
    now?: () => Date;
}) {
    const config = { ...options, archiveHosts: [...options.archiveHosts] };
    if (!Number.isSafeInteger(config.workflowId) || config.workflowId < 1 || ![config.workflowSha256, config.harnessSha256].every(s => /^[a-f0-9]{64}$/.test(s)) || !config.archiveHosts.length || config.archiveHosts.some(h => !/^[-a-z0-9]+\.blob\.core\.windows\.net$/.test(h)))
        throw Error('UI_READER_CONFIGURATION');
    return async (input: {
        projectId: string;
        baseSha: string;
        headSha: string;
        runId: number;
        signal: AbortSignal;
    }) => {
        if (input.projectId !== 'asistente' || ![input.baseSha, input.headSha].every(s => /^[a-f0-9]{40}$/.test(s)) || input.baseSha === input.headSha || !Number.isSafeInteger(input.runId) || input.runId < 1)
            throw Error('UI_READER_INPUT');
        const signal = AbortSignal.any([input.signal, AbortSignal.timeout(60000)]);
        const json = async (url: string) => { const r = await config.apiRequest(url, { method: 'GET', signal, redirect: 'error' }); if (r.status !== 200) {
            await r.body?.cancel();
            throw Error('UI_GITHUB_READ_FAILED');
        } return JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(await bytes(r, 2097152))); };
        const repo = await json(root);
        if (repo.full_name !== repository || repo.private !== false || repo.archived !== false || repo.disabled !== false)
            throw Error('UI_PUBLIC_REPOSITORY_REQUIRED');
        const run = await json(`${root}/actions/runs/${input.runId}`);
        const branch = `factory/${input.baseSha}-`;
        if (run.id !== input.runId || run.workflow_id !== config.workflowId || run.run_attempt !== 1 || run.status !== 'completed' || run.conclusion !== 'success' || run.event !== 'push' || run.head_sha !== input.headSha || typeof run.head_branch !== 'string' || !run.head_branch.startsWith(branch) || !/^[a-f0-9]{64}$/.test(run.head_branch.slice(branch.length)) || run.repository?.full_name !== repository || run.head_repository?.full_name !== repository || run.html_url !== `https://github.com/${repository}/actions/runs/${input.runId}` || !['.github/workflows/factory-candidate-checks.yml', `.github/workflows/factory-candidate-checks.yml@refs/heads/${run.head_branch}`].includes(run.path))
            throw Error('UI_RUN_IDENTITY');
        for (const sha of [input.baseSha, input.headSha]) {
            const harness: Array<[
                string,
                string
            ]> = [];
            for (const file of ['.github/workflows/factory-candidate-checks.yml', ...OFFICE_UI_HARNESS_FILES]) {
                const content = await json(`${root}/contents/${file}?ref=${sha}`);
                if (content.type !== 'file' || content.path !== file || content.encoding !== 'base64' || typeof content.content !== 'string' || !Number.isSafeInteger(content.size) || content.size < 0 || content.size > 100000)
                    throw Error('UI_TRUSTED_SOURCE_REQUIRED');
                const encoded = content.content.replace(/\s/g, ''), decoded = Buffer.from(encoded, 'base64');
                if (decoded.toString('base64') !== encoded || decoded.length !== content.size)
                    throw Error('UI_TRUSTED_SOURCE_REQUIRED');
                const hash = digest(decoded);
                if (file === '.github/workflows/factory-candidate-checks.yml') {
                    if (hash !== config.workflowSha256)
                        throw Error('UI_TRUSTED_SOURCE_REQUIRED');
                }
                else
                    harness.push([file, hash]);
            }
            if (digest(Buffer.from(JSON.stringify(harness))) !== config.harnessSha256)
                throw Error('UI_TRUSTED_SOURCE_REQUIRED');
        }
        const jobs = await json(`${root}/actions/runs/${input.runId}/attempts/1/jobs?per_page=100`);
        if (jobs.total_count !== 1 || jobs.jobs?.length !== 1)
            throw Error('UI_JOB_IDENTITY');
        const job = jobs.jobs[0];
        if (job.run_id !== input.runId || job.head_sha !== input.headSha || job.name !== 'isolated-checks' || job.status !== 'completed' || job.conclusion !== 'success' || (job.run_attempt !== undefined && job.run_attempt !== 1) || !Array.isArray(job.labels) || !job.labels.includes('ubuntu-24.04') || job.labels.some((x: string) => !['ubuntu-24.04', 'Linux', 'X64'].includes(x)))
            throw Error('UI_JOB_IDENTITY');
        for (const name of ['Exact revision office UI regression', 'Save measured office UI regression']) {
            const steps = job.steps?.filter((s: any) => s.name === name);
            if (steps?.length !== 1 || steps[0].status !== 'completed' || steps[0].conclusion !== 'success')
                throw Error('UI_STEP_INCOMPLETE');
        }
        const listing = await json(`${root}/actions/runs/${input.runId}/artifacts?per_page=100`);
        if (!Number.isSafeInteger(listing.total_count) || listing.total_count !== listing.artifacts?.length || listing.total_count > 100)
            throw Error('UI_ARTIFACT_LIST');
        const matches = listing.artifacts.filter((a: any) => a.name === 'office-ui-simulation-v1');
        if (matches.length !== 1)
            throw Error('UI_ARTIFACT_REQUIRED');
        const a = matches[0];
        if (!Number.isSafeInteger(a.id) || a.id < 1 || a.expired !== false || a.workflow_run?.id !== input.runId || a.workflow_run?.head_sha !== input.headSha || !/^sha256:[a-f0-9]{64}$/.test(a.digest) || !Number.isSafeInteger(a.size_in_bytes) || a.size_in_bytes < 22 || a.size_in_bytes > 32 * 1024 * 1024 || a.archive_download_url !== `${root}/actions/artifacts/${a.id}/zip`)
            throw Error('UI_ARTIFACT_IDENTITY');
        const redirect = await config.apiRequest(a.archive_download_url, { method: 'GET', signal, redirect: 'manual' });
        if (redirect.status !== 302) {
            await redirect.body?.cancel();
            throw Error('UI_ARCHIVE_REDIRECT');
        }
        await redirect.body?.cancel();
        const location = verifiedGitHubArtifactLocation(redirect.headers.get('location') ?? '', config.archiveHosts, config.allowGitHubResultsAzureHosts);
        const response = await config.download(location.href, { method: 'GET', signal, redirect: 'error', credentials: 'omit', headers: {} });
        if (response.status !== 200) {
            await response.body?.cancel();
            throw Error('UI_ARCHIVE_DOWNLOAD');
        }
        const archive = await bytes(response, 32 * 1024 * 1024);
        if (archive.length !== a.size_in_bytes)
            throw Error('UI_ARCHIVE_SIZE');
        const files = readOfficeUiZip(archive, a.digest.slice(7)), report = files.get('evidence.json')!;
        const evidence = officeUiSimulationEvidence(report, files, { ...input, runId: String(input.runId), runAttempt: '1', workflowSha256: config.workflowSha256, harnessSha256: config.harnessSha256, now: config.now?.() ?? new Date() });
        evidence.artifactIds.unshift(`github-actions-artifact:${a.id}:${a.digest}`);
        return evidence;
    };
}
