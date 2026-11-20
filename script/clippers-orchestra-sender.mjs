import { constants } from 'node:fs';
import { open, realpath, lstat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createClippersOrchestraRelay, clippersOrchestraRemoteEligibility } from './clippers-orchestra-relay.mjs';

export const CLIPPERS_TELEMETRY_CREDENTIAL_PLIST = path.join(os.homedir(), 'Library/LaunchAgents/com.blackroom.content-agent.plist');
export const CLIPPERS_PLATFORM_KEYCHAIN_SERVICE = 'com.blackops.clippers-orchestra.replit-production';
export const CLIPPERS_PLATFORM_KEYCHAIN_ACCOUNT = 'clippers-telemetry';
export const CLIPPERS_PLATFORM_KEYCHAIN_HELPER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'clippers-platform-keychain');
const MAX_BYTES = 262144;
const MAX_ACK_BYTES = 8192;
const ACK_CODES = new Set(['CLIPPERS_ORCHESTRA_ACCEPTED', 'CLIPPERS_ORCHESTRA_DUPLICATE', 'CLIPPERS_ORCHESTRA_CAREERS_PENDING']);
const fail = code => Object.assign(new Error(code), { code });

const platformTokenValid = value => typeof value === 'string' && value.length >= 16 && value.length <= MAX_ACK_BYTES && /^[A-Za-z0-9._~+/-]+=*$/.test(value) && !/[\s,]/.test(value);
// The separately reviewed native Security.framework executable performs one fixed
// noninteractive lookup. Its stdout is a bounded private pipe, never a terminal,
// log, URL, argument value, environment value or new credential file.
export async function validateClippersPlatformHelper() {
  try {
    if (await realpath(CLIPPERS_PLATFORM_KEYCHAIN_HELPER) !== CLIPPERS_PLATFORM_KEYCHAIN_HELPER) throw fail('PLATFORM_ACCESS_HELPER_UNSAFE');
    const info = await lstat(CLIPPERS_PLATFORM_KEYCHAIN_HELPER);
    if (!info.isFile() || info.nlink !== 1 || info.uid !== process.getuid?.() || (info.mode & 0o777) !== 0o700 || info.size > 25_000_000) throw fail('PLATFORM_ACCESS_HELPER_UNSAFE');
    return CLIPPERS_PLATFORM_KEYCHAIN_HELPER;
  } catch (error) { throw fail(error?.code === 'PLATFORM_ACCESS_HELPER_UNSAFE' ? error.code : 'PLATFORM_ACCESS_HELPER_REQUIRED'); }
}
export async function readClippersPlatformToken({ spawnImpl = spawn, validateHelper = validateClippersPlatformHelper } = {}) {
  const executable = await validateHelper();
  return new Promise((resolve, reject) => {
    let child;
    try { child = spawnImpl(executable, [], {
      stdio: ['ignore', 'pipe', 'ignore'], env: { PATH: '/usr/bin:/bin' },
    }); } catch { reject(fail('PLATFORM_ACCESS_TOKEN_UNAVAILABLE')); return; }
    const chunks = []; let bytes = 0, settled = false;
    const finish = (code, value) => { if (settled) return; settled = true; clearTimeout(timer); code ? reject(fail(code)) : resolve(value); };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish('PLATFORM_ACCESS_TOKEN_UNAVAILABLE'); }, 3000);
    child.on('error', () => finish('PLATFORM_ACCESS_TOKEN_UNAVAILABLE'));
    child.stdout.on('error', () => finish('PLATFORM_ACCESS_TOKEN_UNAVAILABLE'));
    child.stdout.on('data', chunk => { bytes += chunk.length; if (bytes > MAX_ACK_BYTES + 512) { child.kill('SIGKILL'); finish('PLATFORM_ACCESS_TOKEN_INVALID'); } else chunks.push(chunk); });
    child.on('close', code => {
      if (code !== 0) return finish('PLATFORM_ACCESS_TOKEN_UNAVAILABLE');
      try {
        const record = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!record || Array.isArray(record) || Object.keys(record).some(key => !['status', 'token'].includes(key))) return finish('PLATFORM_ACCESS_TOKEN_INVALID');
        if (record.status === 'missing') return finish('PLATFORM_ACCESS_TOKEN_REQUIRED');
        if (record.status !== 'found') return finish('PLATFORM_ACCESS_TOKEN_UNAVAILABLE');
        if (!platformTokenValid(record.token)) return finish('PLATFORM_ACCESS_TOKEN_INVALID');
        finish(null, record.token);
      } catch { finish('PLATFORM_ACCESS_TOKEN_INVALID'); }
    });
  });
}

// macOS parses the already-open descriptor. Neither credential content nor a token
// is passed in arguments, environment, stderr, output logs or a newly written file.
function parsePlistDescriptor(descriptor) {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '/dev/fd/3'], {
      stdio: ['ignore', 'pipe', 'ignore', descriptor], env: { PATH: '/usr/bin:/bin' },
    });
    const chunks = []; let bytes = 0, settled = false;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(fail(error)) : resolve(value); };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish('CREDENTIAL_PARSE_UNAVAILABLE'); }, 3000);
    child.on('error', () => finish('CREDENTIAL_PARSE_UNAVAILABLE'));
    child.stdout.on('data', chunk => { bytes += chunk.length; if (bytes > MAX_BYTES) { child.kill('SIGKILL'); finish('CREDENTIAL_SOURCE_TOO_LARGE'); } else chunks.push(chunk); });
    child.on('close', code => {
      if (code !== 0) return finish('CREDENTIAL_PARSE_UNAVAILABLE');
      try { finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { finish('CREDENTIAL_PARSE_UNAVAILABLE'); }
    });
  });
}
export async function readClippersTelemetryCredential(plistPath = CLIPPERS_TELEMETRY_CREDENTIAL_PLIST, { parse = parsePlistDescriptor, uid = process.getuid?.() } = {}) {
  let file;
  try {
    if (!path.isAbsolute(plistPath) || await realpath(plistPath) !== plistPath || uid === undefined) throw fail('CREDENTIAL_SOURCE_UNSAFE');
    file = await open(plistPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = await file.stat();
    if (!before.isFile() || before.nlink !== 1 || before.uid !== uid || (before.mode & 0o777) !== 0o600 || before.size > MAX_BYTES) throw fail('CREDENTIAL_SOURCE_UNSAFE');
    const parsed = await parse(file.fd);
    const after = await file.stat(), current = await lstat(plistPath);
    const fields = ['ino', 'dev', 'mode', 'uid', 'nlink', 'size', 'mtimeMs', 'ctimeMs'];
    if (await realpath(plistPath) !== plistPath || !current.isFile() ||
        fields.some(key => before[key] !== after[key] || before[key] !== current[key])) throw fail('CREDENTIAL_SOURCE_CHANGED');
    const env = parsed?.EnvironmentVariables;
    const token = typeof env?.BLACKROOM_REMOTE_CONTROL_TOKEN === 'string' ? env.BLACKROOM_REMOTE_CONTROL_TOKEN.trim() : '';
    const remoteUrl = env?.BLACKROOM_REMOTE_CONTROL_URL;
    if (token.length < 32 || /replace|example|your[-_ ]?token/i.test(token)) throw fail('EXISTING_DEVICE_AUTH_UNAVAILABLE');
    const eligibility = clippersOrchestraRemoteEligibility(remoteUrl, true);
    if (!eligibility.allowed) throw fail('OFFICE_ORIGIN_UNVERIFIED');
    return { token, origin: new URL(remoteUrl).origin };
  } catch (error) {
    throw fail(['CREDENTIAL_SOURCE_UNSAFE', 'CREDENTIAL_SOURCE_CHANGED', 'CREDENTIAL_SOURCE_TOO_LARGE', 'CREDENTIAL_PARSE_UNAVAILABLE', 'EXISTING_DEVICE_AUTH_UNAVAILABLE', 'OFFICE_ORIGIN_UNVERIFIED'].includes(error?.code) ? error.code : 'CREDENTIAL_SOURCE_UNAVAILABLE');
  } finally { await file?.close(); }
}
async function boundedAck(response) {
  if (!response.ok || !response.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw fail('TELEMETRY_ACK_UNCONFIRMED');
  const reader = response.body?.getReader(); if (!reader) throw fail('TELEMETRY_ACK_UNCONFIRMED');
  const chunks = []; let bytes = 0;
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; bytes += value.length; if (bytes > MAX_ACK_BYTES) throw fail('TELEMETRY_ACK_UNCONFIRMED'); chunks.push(value); }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || Object.keys(body).join(',') !== 'clippersOrchestra') throw fail('TELEMETRY_ACK_UNCONFIRMED');
    const ack = body.clippersOrchestra;
    if (!ack || typeof ack !== 'object' || Array.isArray(ack) || Object.keys(ack).some(key => !['accepted', 'duplicate', 'code'].includes(key)) ||
        ack.accepted !== true || (ack.duplicate !== undefined && typeof ack.duplicate !== 'boolean') || !ACK_CODES.has(ack.code)) throw fail('TELEMETRY_ACK_UNCONFIRMED');
    return ack;
  } catch { await reader.cancel().catch(() => {}); throw fail('TELEMETRY_ACK_UNCONFIRMED'); }
}
/** One telemetry-only POST. Never consumes a control/command response, retries a
 * write, imports a model/provider, mutates a publication queue or restarts BlackRoom. */
export async function runClippersOrchestraSender({ workspaceRoot = path.join(os.homedir(), '.local/share/blackops/clippers-workspace'),
  readCredential = readClippersTelemetryCredential, readPlatformToken = readClippersPlatformToken, fetchImpl = fetch, relayFactory = createClippersOrchestraRelay, timeoutMs = 10_000 } = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10_000) throw fail('SENDER_CONFIGURATION_INVALID');
  let relay, httpStatus = null;
  try {
    // Private-only service: a missing production token never sends an app token
    // alone, reads the device plist, refreshes a report or retries another origin.
    const platformToken = await readPlatformToken();
    if (!platformTokenValid(platformToken)) throw fail('PLATFORM_ACCESS_TOKEN_INVALID');
    relay = relayFactory({ workspaceRoot });
    await relay.refresh();
    const envelope = relay.getEnvelope();
    if (!envelope) return { state: 'held', reasonCode: 'TELEMETRY_REPORT_UNAVAILABLE', paidSpendUsd: 0 };
    const body = JSON.stringify({ kind: 'clippers-orchestra', clippersOrchestra: envelope });
    if (Buffer.byteLength(body) > MAX_BYTES) return { state: 'held', reasonCode: 'TELEMETRY_REPORT_TOO_LARGE', paidSpendUsd: 0 };
    const credential = await readCredential();
    if (!clippersOrchestraRemoteEligibility(credential.origin, typeof credential.token === 'string' && credential.token.length >= 32).allowed) throw fail('OFFICE_ORIGIN_UNVERIFIED');
    if (/[\s,]/.test(credential.token) || credential.token.length > 8192) throw fail('EXISTING_DEVICE_AUTH_UNAVAILABLE');
    if (credential.token === platformToken) throw fail('CREDENTIAL_ROLES_CONFLICT');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(credential.origin + '/api/blackroom-agent/clippers-orchestra', {
        method: 'POST', redirect: 'manual', cache: 'no-store', signal: controller.signal,
        headers: { authorization: 'Bearer ' + platformToken, 'x-clippers-device-token': credential.token, 'content-type': 'application/json' }, body,
      });
      httpStatus = Number.isInteger(response.status) && response.status >= 100 && response.status <= 599 ? response.status : null;
      if (httpStatus >= 300 && httpStatus < 400) { await response.body?.cancel().catch(() => {}); throw fail('PLATFORM_ACCESS_REDIRECT'); }
      const ack = await boundedAck(response);
      relay.acknowledge(envelope.nonce);
      return { state: 'acknowledged', reasonCode: ack.code, generatedAt: envelope.generatedAt, duplicate: ack.duplicate === true, httpStatus, paidSpendUsd: 0 };
    } finally { clearTimeout(timer); }
  } catch (error) {
    const code = error?.code;
    const heldCodes = ['CREDENTIAL_SOURCE_UNSAFE', 'CREDENTIAL_SOURCE_CHANGED', 'CREDENTIAL_SOURCE_TOO_LARGE', 'CREDENTIAL_PARSE_UNAVAILABLE', 'CREDENTIAL_SOURCE_UNAVAILABLE', 'EXISTING_DEVICE_AUTH_UNAVAILABLE', 'OFFICE_ORIGIN_UNVERIFIED', 'PLATFORM_ACCESS_TOKEN_REQUIRED', 'PLATFORM_ACCESS_TOKEN_UNAVAILABLE', 'PLATFORM_ACCESS_TOKEN_INVALID', 'PLATFORM_ACCESS_REDIRECT', 'CREDENTIAL_ROLES_CONFLICT', 'PLATFORM_ACCESS_HELPER_REQUIRED', 'PLATFORM_ACCESS_HELPER_UNSAFE'];
    return { state: heldCodes.includes(code) ? 'held' : 'unconfirmed', reasonCode: heldCodes.includes(code) ? code : 'TELEMETRY_ACK_UNCONFIRMED', httpStatus, paidSpendUsd: 0 };
  } finally { relay?.stop(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.slice(2).some(arg => arg !== '--once') || process.argv.slice(2).length > 1) {
    process.stdout.write(JSON.stringify({ state: 'held', reasonCode: 'SENDER_CONFIGURATION_INVALID', paidSpendUsd: 0 }) + '\n');
    process.exitCode = 1;
  } else {
    const result = await runClippersOrchestraSender();
    process.stdout.write(JSON.stringify(result) + '\n');
    process.exitCode = result.state === 'acknowledged' ? 0 : 1;
  }
}
