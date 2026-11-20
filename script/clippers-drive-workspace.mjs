// Durable Clippers workspace for cloud runs: inputs + media in Google Drive, small text state in PostgreSQL.
//
// Drive  (folder CLIPPERS_DRIVE_WORKSPACE_FOLDER_ID): a mirror of the Mac `clippers-workspace` tree (config/, manifests,
//        visuals + rights evidence, research/marketplace-snapshots/, rendered media). Seeded from the Mac by
//        script/clippers-mac-retire.sh --seed with the same OAuth client, so the default `drive.file` scope can see it.
// Postgres (council store, `clippers-cloud-workspace:<owner>`): every small text file (ledgers, reports, manifests
//        written by runs). On hydration the newer of the Drive copy and the stored copy wins.
// Absolute workspace paths inside text files are stored as WORKSPACE_TOKEN, so Mac ledgers keep working in the cloud.
// Credentials: GOOGLE_DRIVE_CLIENT_ID / GOOGLE_DRIVE_CLIENT_SECRET / GOOGLE_DRIVE_REFRESH_TOKEN (never logged).

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';

export const WORKSPACE_TOKEN = '{{CLIPPERS_WORKSPACE}}';
export const TEXT_EXTENSIONS = new Set(['.json', '.jsonl', '.md', '.txt', '.srt', '.vtt', '.csv']);
export const MAX_TEXT_FILE_BYTES = 1024 * 1024;
export const MAX_TEXT_TOTAL_BYTES = 6 * 1024 * 1024;
const FOLDER = 'application/vnd.google-apps.folder';
// Never mirrored: build/temp dirs, locks/partials, and anything that looks like a credential (env files, keys, tokens).
// Locks, partial/temp renders (content worker *.partial.mp4, ffmpeg/yt-dlp temp outputs, caption scratch dirs).
const SKIP = /(^|\/)(node_modules|\.git|tmp|source-drop)(\/|$)|\.lock$|\.partial(\.[^/]*)?$|\.part$|\.ytdl$|\.tmp(\.[a-z0-9]+)?$|\.temp(\.[a-z0-9]+)?$|\.captions(\/|$)|(^|\/)\._/i;
// Credential-like paths: any dot-file/dot-dir (.metricool/, .ssh/, .netrc, .env...); browser/session DIRECTORIES
// (not files that merely contain those words); credential words anywhere in a name; exact auth/session/login JSON;
// key stores by extension.
const SECRETISH = new RegExp([
  String.raw`(^|\/)\.[^/]+(\/|$)`,
  String.raw`(^|\/)(chrome|chromium|firefox|safari|profiles?|user-data|default|sessions?|logins?|cookies|keychains?)(-[^/]*)?\/`,
  String.raw`(^|\/)[^/]*(credential|creds|secret|token|oauth|password|passwd|apikey|api-key|private-key|cookie|keychain|storage-?state|auth[-_]?state|service[-_]?account|application_default|netrc|npmrc|id_rsa|id_ed25519|id_ecdsa)[^/]*(\/|$)`,
  String.raw`(^|\/)(auth|session|sessions|login|adc)\.json$`,
  String.raw`(^|\/)[^/]*(^|[-_.])adc([-_.][^/]*)?$`,
  String.raw`\.(pem|key|p12|pfx|jks|keystore|kdbx|sqlite|db|ldb)(\/|$)`,
].join('|'), 'i');
/** Seed (Mac -> cloud) is an allowlist: only these top-level folders, and only text or media files. */
export const SEED_PREFIXES = Object.freeze(['config/', 'content/', 'manifests/', 'visuals/', 'rights/', 'research/', 'renders/', 'reports/']);
export const MEDIA_EXTENSIONS = new Set(['.mp4', '.mov', '.m4a', '.mp3', '.wav', '.aac', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.srt', '.vtt', '.ttf', '.otf']);
export const seedAllowed = rel => safeRel(rel) && SEED_PREFIXES.some(p => rel.startsWith(p))
  && (TEXT_EXTENSIONS.has(path.extname(rel).toLowerCase()) || MEDIA_EXTENSIONS.has(path.extname(rel).toLowerCase()));
/** Ledger-like files are never evicted (they are what prevents duplicates). */
export const isLedgerPath = rel => /ledger|queue|publish|upload|receipt|reconcil/i.test(rel);

export const driveCredentials = (env = process.env) => {
  const pick = names => names.map(n => String(env[n] ?? '').trim()).find(Boolean) || '';
  return {
    clientId: pick(['GOOGLE_DRIVE_CLIENT_ID', 'GOOGLE_DRIVE_OAUTH_CLIENT_ID']),
    clientSecret: pick(['GOOGLE_DRIVE_CLIENT_SECRET', 'GOOGLE_DRIVE_OAUTH_CLIENT_SECRET']),
    refreshToken: pick(['GOOGLE_DRIVE_REFRESH_TOKEN']),
    folderId: pick(['CLIPPERS_DRIVE_WORKSPACE_FOLDER_ID']),
  };
};
export function missingDriveSecrets(env = process.env) {
  const c = driveCredentials(env);
  return [['GOOGLE_DRIVE_CLIENT_ID', c.clientId], ['GOOGLE_DRIVE_CLIENT_SECRET', c.clientSecret], ['GOOGLE_DRIVE_REFRESH_TOKEN', c.refreshToken], ['CLIPPERS_DRIVE_WORKSPACE_FOLDER_ID', c.folderId]]
    .filter(([, v]) => !v).map(([k]) => k);
}

const safeRel = rel => typeof rel === 'string' && rel.length < 400 && !rel.startsWith('/') && !rel.split('/').some(p => !p || p === '.' || p === '..') && !SKIP.test(rel) && !SECRETISH.test(rel);
export const isTextPath = rel => TEXT_EXTENSIONS.has(path.extname(rel).toLowerCase());
const q = v => String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

/** Minimal Drive v3 REST client (fetch injectable for tests). Errors carry fixed codes only. */
export function createDriveClient({ clientId, clientSecret, refreshToken, fetch: fetchImpl = globalThis.fetch }) {
  let token = null, expires = 0;
  async function auth() {
    if (token && Date.now() < expires - 60_000) return token;
    const res = await fetchImpl('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }).toString() });
    if (!res.ok) throw new Error(res.status === 400 || res.status === 401 ? 'drive_credential_invalid' : 'drive_token_unavailable');
    const body = await res.json();
    token = body.access_token; expires = Date.now() + Number(body.expires_in ?? 3600) * 1000;
    return token;
  }
  async function call(url, init = {}) {
    const res = await fetchImpl(url, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${await auth()}` } });
    if (res.status === 401 || res.status === 403) throw new Error('drive_permission_denied');
    if (res.status === 404) throw new Error('drive_not_found');
    if (!res.ok) throw new Error('drive_request_failed');
    return res;
  }
  async function list(folderId) {
    const out = []; let pageToken = '';
    do {
      const u = new URL('https://www.googleapis.com/drive/v3/files');
      u.searchParams.set('q', `'${q(folderId)}' in parents and trashed = false`);
      u.searchParams.set('fields', 'nextPageToken,files(id,name,mimeType,size,modifiedTime)');
      u.searchParams.set('pageSize', '1000');
      if (pageToken) u.searchParams.set('pageToken', pageToken);
      const body = await (await call(u)).json();
      out.push(...(body.files ?? []));
      pageToken = body.nextPageToken ?? '';
    } while (pageToken);
    return out;
  }
  return {
    list,
    /** Recursive listing: [{ rel, id, size, modifiedTime }] (folders resolved, unsafe names skipped). */
    async walk(rootId, { maxFiles = 5000 } = {}) {
      const files = [], folders = new Map([['', rootId]]), queue = [['', rootId]];
      while (queue.length) {
        const [prefix, id] = queue.shift();
        for (const f of await list(id)) {
          const rel = prefix ? `${prefix}/${f.name}` : f.name;
          if (!safeRel(rel)) continue;
          if (f.mimeType === FOLDER) { folders.set(rel, f.id); queue.push([rel, f.id]); }
          else if (!String(f.mimeType).startsWith('application/vnd.google-apps.')) files.push({ rel, id: f.id, size: Number(f.size ?? 0), modifiedTime: f.modifiedTime });
          if (files.length >= maxFiles) throw new Error('drive_workspace_too_many_files');
        }
      }
      return { files, folders };
    },
    async download(id, dest) {
      const res = await call(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`);
      await mkdir(path.dirname(dest), { recursive: true, mode: 0o700 });
      await pipeline(Readable.fromWeb(res.body), createWriteStream(dest, { mode: 0o600 }));
    },
    async ensureFolder(folders, rel) {
      if (folders.has(rel)) return folders.get(rel);
      const parentRel = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
      const parent = await this.ensureFolder(folders, parentRel);
      const res = await call('https://www.googleapis.com/drive/v3/files?fields=id', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: path.posix.basename(rel), mimeType: FOLDER, parents: [parent] }) });
      const id = (await res.json()).id; folders.set(rel, id); return id;
    },
    /** Resumable upload (create, or update when existingId is given). Works for multi-GB files. */
    async upload(localPath, { name, parentId, existingId = null, mimeType = 'application/octet-stream' }) {
      const size = (await stat(localPath)).size;
      const url = existingId ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(existingId)}?uploadType=resumable&fields=id`
        : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id';
      const start = await call(url, { method: existingId ? 'PATCH' : 'POST', headers: { 'content-type': 'application/json', 'x-upload-content-type': mimeType, 'x-upload-content-length': String(size) },
        body: JSON.stringify(existingId ? {} : { name, parents: [parentId] }) });
      const session = start.headers.get('location');
      if (!session) throw new Error('drive_upload_session_missing');
      const res = await fetchImpl(session, { method: 'PUT', headers: { 'content-length': String(size), 'content-type': mimeType }, body: Readable.toWeb(createReadStream(localPath)), duplex: 'half' });
      if (!res.ok) throw new Error('drive_upload_failed');
      return (await res.json()).id;
    },
  };
}

export const sha256 = buf => createHash('sha256').update(buf).digest('hex');
export const tokenize = (text, root) => text.split(root).join(WORKSPACE_TOKEN);
export const detokenize = (text, root) => text.split(WORKSPACE_TOKEN).join(root);

/** Every regular file under root -> Map(rel -> { size, sha256 }) (skips locks/partials/tmp). */
export async function snapshotTree(root) {
  const out = new Map();
  async function walk(dir, prefix) {
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (!safeRel(rel)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full, rel);
      else if (entry.isFile()) {
        const info = await stat(full);
        out.set(rel, { size: info.size, sha256: await hashFile(full) });
      }
    }
  }
  await walk(root, '');
  return out;
}
async function hashFile(file) { const h = createHash('sha256'); for await (const c of createReadStream(file)) h.update(c); return h.digest('hex'); }

/** Pure: which Drive files to download (age/size bounded media; text always). */
export function planHydration(driveFiles, { now = Date.now(), mediaMaxAgeDays = 3, maxFileBytes = 3 * 1024 ** 3, maxTotalBytes = 12 * 1024 ** 3, inputPrefixes = ['config/', 'content/', 'manifests/', 'visuals/', 'rights/', 'research/'] } = {}) {
  const chosen = []; let total = 0;
  const sorted = [...driveFiles].sort((a, b) => Date.parse(b.modifiedTime) - Date.parse(a.modifiedTime));
  for (const f of sorted) {
    if (f.size > maxFileBytes) continue;
    const input = isTextPath(f.rel) || inputPrefixes.some(p => f.rel.startsWith(p));
    if (!input && now - Date.parse(f.modifiedTime) > mediaMaxAgeDays * 86400_000) continue;
    if (total + f.size > maxTotalBytes) continue;
    chosen.push(f); total += f.size;
  }
  return chosen;
}

/** Pure: stored text file wins over the Drive copy when it is newer (or Drive has none). */
export function textOverlay(stored, driveFiles) {
  const drive = new Map(driveFiles.map(f => [f.rel, f]));
  return Object.entries(stored?.files ?? {}).filter(([rel, f]) => safeRel(rel) && typeof f?.content === 'string'
    && (!drive.has(rel) || Date.parse(f.updatedAt) >= Date.parse(drive.get(rel).modifiedTime))).map(([rel, f]) => ({ rel, content: f.content }));
}

/** Pure: split changed files into text (-> Postgres) and media (-> Drive). */
export function planPersist(before, after) {
  const text = [], media = [];
  for (const [rel, info] of after) {
    if (before.get(rel)?.sha256 === info.sha256) continue;
    (isTextPath(rel) && info.size <= MAX_TEXT_FILE_BYTES ? text : media).push(rel);
  }
  return { text: text.sort(), media: media.sort() };
}

/**
 * Merge changed text into the stored workspace document. Over the cap, non-ledger files are evicted oldest first;
 * ledger files are never evicted: if they alone exceed the cap the merge fails (workspace_text_over_cap) and
 * nothing is written.
 */
export async function mergeTextFiles(stored, root, rels, now) {
  const doc = { version: 1, files: { ...(stored?.files ?? {}) } };
  for (const rel of rels) {
    const content = tokenize(await readFile(path.join(root, rel), 'utf8'), root);
    doc.files[rel] = { content, sha256: sha256(content), updatedAt: new Date(now).toISOString() };
  }
  const size = f => Buffer.byteLength(f.content);
  const entries = Object.entries(doc.files);
  let total = entries.reduce((n, [, f]) => n + size(f), 0);
  if (total <= MAX_TEXT_TOTAL_BYTES) return doc;
  const ledgerBytes = entries.filter(([rel]) => isLedgerPath(rel)).reduce((n, [, f]) => n + size(f), 0);
  if (ledgerBytes > MAX_TEXT_TOTAL_BYTES) throw new Error('workspace_text_over_cap');
  const evictable = entries.filter(([rel]) => !isLedgerPath(rel) && !rels.includes(rel)).sort((a, b) => Date.parse(a[1].updatedAt) - Date.parse(b[1].updatedAt));
  for (const [rel, f] of evictable) { if (total <= MAX_TEXT_TOTAL_BYTES) break; delete doc.files[rel]; total -= size(f); }
  if (total > MAX_TEXT_TOTAL_BYTES) throw new Error('workspace_text_over_cap');
  return doc;
}

export async function writeOverlay(root, overlay) {
  for (const { rel, content } of overlay) {
    const dest = path.join(root, rel);
    await mkdir(path.dirname(dest), { recursive: true, mode: 0o700 });
    await writeFile(dest, detokenize(content, root), { mode: 0o600 });
  }
}
