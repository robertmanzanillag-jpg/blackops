import { readdir, lstat, readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const MAX = 32 * 1024 * 1024;
export const OFFICE_UI_STATIC_EXCLUSIONS = ['AppleDouble metadata filenames starting with ._'];
export const OFFICE_UI_HARNESS_FILES = ['script/software-factory-office-ui-acceptance.ts', 'script/software-factory-office-ui-fixture.mjs', 'script/software-factory-office-ui-oracle.mjs', 'script/software-factory-ui-console.mjs', 'script/software-factory-ui-static.mjs', 'script/software-factory-role-acceptance.ts', 'server/software-factory-role-acceptance.ts', 'server/software-factory-role-deadline.ts', 'server/office-role-snapshots.ts'];
export function validateStaticBundle(value) {
    if (!value || value.version !== 1 || !Array.isArray(value.files) || !value.files.length || value.files.length > 2000)
        throw Error('UI_STATIC_INVALID');
    const names = new Set();
    let total = 0;
    for (const file of value.files) {
        if (!file || typeof file.path !== 'string' || file.path.length > 300 || file.path.split('/').some(p => !p || p === '.' || p === '..' || p.startsWith('.')) || /[\\:\x00-\x20]/.test(file.path) || names.has(file.path.toLowerCase()) || typeof file.content !== 'string' || file.content.length > MAX * 2)
            throw Error('UI_STATIC_PATH_INVALID');
        names.add(file.path.toLowerCase());
        const bytes = Buffer.from(file.content, 'base64');
        if (bytes.toString('base64') !== file.content || sha(bytes) !== file.sha256 || (total += bytes.length) > MAX)
            throw Error('UI_STATIC_BYTES_INVALID');
    }
    if (!names.has('index.html'))
        throw Error('UI_STATIC_ENTRY_REQUIRED');
    return { files: value.files.map(({ path, sha256 }) => ({ path, sha256 })), sha256: sha(JSON.stringify(value.files.map(({ path, sha256 }) => ({ path, sha256 })))) };
}
export async function collectStaticBundle(root) {
    const files = [];
    let total = 0;
    async function walk(dir, prefix = '') {
        for (const name of (await readdir(dir)).sort()) {
            // Vite copies tracked macOS metadata from client/public. Express's
            // dotfiles:'deny' never serves it; do not admit other hidden files.
            if (name.startsWith('._')) continue;
            const file = path.join(dir, name), stat = await lstat(file), relative = prefix + name;
            if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()))
                throw Error('UI_STATIC_SPECIAL_FILE');
            if (stat.isDirectory())
                await walk(file, relative + '/');
            else {
                if ((total += stat.size) > MAX || files.length >= 2000)
                    throw Error('UI_STATIC_LIMIT');
                const bytes = await readFile(file);
                files.push({ path: relative, sha256: sha(bytes), content: bytes.toString('base64') });
            }
        }
    }
    await walk(root);
    const bundle = { version: 1, files };
    validateStaticBundle(bundle);
    return bundle;
}
export async function materializeStaticBundle(bundle, root) {
    const manifest = validateStaticBundle(bundle);
    await mkdir(root, { recursive: false });
    for (const file of bundle.files) {
        const target = path.join(root, ...file.path.split('/'));
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, Buffer.from(file.content, 'base64'), { flag: 'wx', mode: 0o400 });
    }
    return manifest;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    if (process.argv[2] !== 'export' || process.argv[3] !== '/build-output')
        throw Error('UI_STATIC_COMMAND_INVALID');
    process.stdout.write(JSON.stringify(await collectStaticBundle('/build-output')));
}
