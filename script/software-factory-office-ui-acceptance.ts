import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, rm, readFile, writeFile, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { checkedRoot, exportRevision, removeAcceptanceContainer } from "./software-factory-role-acceptance";
import { materializeStaticBundle, OFFICE_UI_HARNESS_FILES, OFFICE_UI_STATIC_EXCLUSIONS } from "./software-factory-ui-static.mjs";
const exec = promisify(execFile);
const NODE = "docker.io/library/node@sha256:c0a93797ee78814ae6d32fcca2561fdbbe423149c3f5389aad32d86e9fd85bd4";
const BROWSER = "mcr.microsoft.com/playwright@sha256:5b8f294aff9041b7191c34a4bab3ac270157a28774d4b0660e9743297b697e48";
const digest = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');
let stage = 'startup';
function diagnostic(error: unknown) {
    const e = error as {code?: unknown; message?: unknown; stderr?: unknown};
    const code = typeof e?.code === 'number' ? `EXIT_${e.code}` : typeof e?.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(e.code) ? e.code : typeof e?.message === 'string' && /^(UI|QA)_[A-Z0-9_]{1,60}$/.test(e.message) ? e.message : 'UNCONFIRMED';
    // Only bounded stderr from credentialless containers, never stdout bundles,
    // host environment, exception command strings, private configuration or keys.
    const stderr = typeof e?.stderr === 'string' ? e.stderr.slice(-4096).replace(/\x1b\[[0-9;]*[a-zA-Z]/g,'').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,'').replace(/(?:sk-|github_pat_|ghp_)[A-Za-z0-9_-]+/g,'[redacted]').replace(/postgres(?:ql)?:\/\/\S+/g,'[redacted]') : undefined;
    console.error(JSON.stringify({scope:'isolated-ui-diagnostic',stage,code,...(stderr?{stderr}:{})}));
}
async function container(args: string[], timeout: number, maxBuffer = 1048576) {
    const name = `factory-acceptance-${randomUUID()}`;
    try {
        return await exec('docker', ['run', '--rm', '--init', '--name', name, '--label', `office.factory.ui=${process.env.GITHUB_RUN_ID}`, '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--user', `${process.getuid!()}:${process.getgid!()}`, '--memory', '3g', '--cpus', '2', '--pids-limit', '256', '--shm-size', '256m', '--tmpfs', '/tmp:rw,nosuid,exec,size=256m,mode=1777', '--env', 'HOME=/tmp', ...args], { timeout, maxBuffer, killSignal: 'SIGKILL' });
    }
    finally {
        await removeAcceptanceContainer(name);
    }
}
async function main() {
    stage = 'validate-input';
    if (process.platform !== 'linux' || process.env.FACTORY_QA_ISOLATED !== 'true' || !/^\d+$/.test(process.env.GITHUB_RUN_ID ?? '') || !/^\d+$/.test(process.env.GITHUB_RUN_ATTEMPT ?? ''))
        throw Error('UI_ISOLATED_CI_REQUIRED');
    const [baseRoot, baseSha, headRoot, headSha, output, dependencyRoot] = process.argv.slice(2);
    if (process.argv.length !== 8)
        throw Error('UI_ARGUMENTS_REQUIRED');
    const base = await checkedRoot(baseRoot, baseSha), head = await checkedRoot(headRoot, headSha), deps = await realpath(dependencyRoot);
    if (base === head || baseSha === headSha || !path.isAbsolute(output) || /[\r\n,]/.test(deps) || path.resolve(output).startsWith(base + path.sep) || path.resolve(output).startsWith(head + path.sep))
        throw Error('UI_DISTINCT_ROOTS_REQUIRED');
    // The model may edit only this approved backend leaf and its test. It cannot change the oracle, auth, UI, dependency or build policy.
    const changed = (await exec('git', ['-C', head, 'diff', '--name-only', baseSha, headSha], { timeout: 10000 })).stdout.trim().split('\n').filter(Boolean);
    if (!changed.length || changed.some(p => !['server/office-role-work.ts', 'tests/office-role-work.test.ts'].includes(p)))
        throw Error('UI_CANDIDATE_SCOPE_INVALID');
    for (const file of ['package.json', 'package-lock.json'])
        if (!(await readFile(path.join(base, file))).equals(await readFile(path.join(head, file))))
            throw Error('UI_DEPENDENCIES_CHANGED');
    const temp = await mkdtemp(path.join(os.tmpdir(), 'factory-ui-'));
    let baseline: any, candidate: any;
    try {
        stage = 'export-source';
        baseline = await exportRevision(base, baseSha);
        candidate = await exportRevision(head, headSha);
        await mkdir(path.join(temp, 'static'));
        await mkdir(path.join(temp, 'input'));
        await mkdir(output, { recursive: false });
        const harness = await Promise.all(OFFICE_UI_HARNESS_FILES.map(async (file: string) => [file, digest(await readFile(path.join(base, file)))]));
        const provenance: any = { version: 1, scope: 'office-ui-regression', projectId: 'asistente', repository: 'robertmanzanillag-jpg/blackops', baseSha, headSha, runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT, workflowSha256: digest(await readFile(path.join(base, '.github/workflows/factory-candidate-checks.yml'))), harnessSha256: digest(JSON.stringify(harness)), staticExclusions: OFFICE_UI_STATIC_EXCLUSIONS };
        for (const [role, source] of [['baseline', baseline], ['candidate', candidate]] as const) {
            stage = `build-${role}`;
            const built = await container(['--tmpfs', '/work:rw,nosuid,size=512m,mode=1777', '--tmpfs', '/build-output:rw,nosuid,size=64m,mode=1777', '--tmpfs', '/dependencies/node_modules/.vite-temp:rw,nosuid,size=32m,mode=1777', '--mount', `type=bind,src=${source.directory},dst=/source,readonly`, '--mount', `type=bind,src=${baseline.directory},dst=/controller,readonly`, '--mount', `type=bind,src=${deps},dst=/dependencies/node_modules,readonly`, '--workdir', '/work', NODE, 'sh', '-c', 'cp -R /source/. /work/ && ln -s /dependencies/node_modules node_modules && (node /dependencies/node_modules/vite/bin/vite.js build --outDir /build-output --emptyOutDir >/tmp/build.log 2>&1 || { status=$?; tail -c 4096 /tmp/build.log >&2; exit "$status"; }) && node /controller/script/software-factory-ui-static.mjs export /build-output'], 180000, 48 * 1024 * 1024);
            stage = `validate-static-${role}`;
            const bundle = JSON.parse(built.stdout);
            const staticManifest = await materializeStaticBundle(bundle, path.join(temp, 'static', role));
            provenance[role] = { sourceManifestSha256: source.sourceManifestSha256, staticManifest };
        }
        await writeFile(path.join(temp, 'input', 'provenance.json'), JSON.stringify(provenance), { flag: 'wx' });
        stage = 'browser-oracle';
        await container(['--mount', `type=bind,src=${baseline.directory},dst=/controller,readonly`, '--mount', `type=bind,src=${deps},dst=/node_modules,readonly`, '--mount', `type=bind,src=${path.join(temp, 'static')},dst=/static,readonly`, '--mount', `type=bind,src=${path.join(temp, 'input')},dst=/input,readonly`, '--mount', `type=bind,src=${output},dst=/evidence`, '--workdir', '/controller', BROWSER, 'node', 'script/software-factory-office-ui-oracle.mjs'], 240000);
    }
    finally {
        if (baseline)
            await rm(baseline.directory, { recursive: true, force: true });
        if (candidate)
            await rm(candidate.directory, { recursive: true, force: true });
        await rm(temp, { recursive: true, force: true });
    }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
    void main().catch(error => { diagnostic(error); console.error('Isolated UI acceptance failed; no UI pass is inferred.'); process.exitCode = 1; });
