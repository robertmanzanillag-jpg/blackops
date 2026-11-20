import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';

const exec = promisify(execFile);
const source = new URL('../script/clippers-platform-keychain.swift', import.meta.url);

test('default native reader has one fixed noninteractive lookup and no update/delete/unlock path', async () => {
  const text = await readFile(source, 'utf8');
  assert.ok(text.includes('SecKeychainSetUserInteractionAllowed(false)'));
  assert.ok(text.includes('kSecUseAuthenticationUI: kSecUseAuthenticationUIFail'));
  assert.ok(text.includes('CommandLine.arguments.count == 1'));
  assert.ok(text.includes('guard outputSafe() else'));
  assert.ok(text.includes('fstat(STDOUT_FILENO'));
  assert.ok(text.includes('getsockname(STDOUT_FILENO'));
  assert.ok(text.includes('sa_family_t(AF_UNIX)'));
  assert.ok(text.includes('com.blackops.clippers-orchestra.replit-production'));
  assert.ok(text.includes('clippers-telemetry'));
  for (const forbidden of ['SecItemUpdate(', 'SecItemDelete(', 'SecKeychainUnlock(', 'Process(', 'osascript']) assert.equal(text.includes(forbidden), false);
});

test('native macOS helper compiles and runs only its synthetic dependency-injected test binary', {skip:process.platform!=='darwin'}, async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'clippers-keychain-native-'));
  try {
    const output = path.join(temporary, 'synthetic-reader');
    await exec('/usr/bin/xcrun', ['swiftc', '-D', 'CLIPPERS_KEYCHAIN_TEST', '-framework', 'Security', source.pathname, '-o', output], {timeout:30_000, maxBuffer:1_000_000});
    const result = await exec(output, [], {timeout:3000, maxBuffer:8192, env:{PATH:'/usr/bin:/bin'}});
    assert.deepEqual(JSON.parse(result.stdout), {syntheticTestsPassed:30,approvedInputTestsPassed:39,realKeychainQueries:0,realKeychainWrites:0});
    assert.equal(result.stderr, '');
    // Compile the AppKit/real-Security entry points, but never execute them.
    await exec('/usr/bin/xcrun', ['swiftc', '-typecheck', '-framework', 'Security', '-framework', 'AppKit', source.pathname], {timeout:30_000, maxBuffer:1_000_000});
  } finally {await rm(temporary,{recursive:true,force:true});}
});


test('setup is explicit user-only secure input with one exact-app ACL, add-only and no token output', async () => {
  const text=await readFile(source,'utf8');
  assert.ok(text.includes('CommandLine.arguments[1] == "--setup"'));
  assert.ok(text.includes('NSSecureTextField'));
  assert.ok(text.includes('SecTrustedApplicationCreateFromPath(nil, &trusted)'));
  assert.ok(text.includes('O_RDONLY | O_NOFOLLOW | O_NONBLOCK'));
  assert.ok(text.includes('sameBinaryFile(before, current)'));
  assert.ok(text.includes('[application] as CFArray'));
  assert.ok(text.includes('errSecDuplicateItem'));
  assert.ok(text.includes('current.1 == expected.1'));
  const setup=text.slice(text.indexOf('final class PlatformSetup'),text.indexOf('func userSetup()'));
  assert.equal(setup.includes('SecItemCopyMatching'),false);
  assert.equal(setup.includes('FileHandle.standardOutput'),false);
  assert.equal(setup.includes('print('),false);
  assert.ok(setup.includes('secure.stringValue = ""'));
});

test('approved stdin is a distinct bounded private-descriptor mode with status-only output', async () => {
  const text=await readFile(source,'utf8');
  assert.ok(text.includes('CommandLine.arguments[1] == "--store-approved-from-stdin"'));
  assert.ok(text.includes('info.st_uid == getuid()'));
  assert.ok(text.includes('info.st_nlink == 0 || info.st_mode & 0o077 == 0'));
  assert.ok(text.includes('getpeereid(descriptor, &peerUser, &peerGroup)'));
  assert.ok(text.includes('peerUser == getuid()'));
  assert.ok(text.includes('approvedInputDeadlineSeconds = 10.0'));
  assert.ok(text.includes('DispatchTime.now().uptimeNanoseconds'));
  assert.ok(text.includes('flags | O_NONBLOCK'));
  assert.ok(text.includes('poll(&descriptorInfo, 1, timeout)'));
  assert.ok(text.includes('maximumTokenBytes + 1 - bytes.count'));
  assert.ok(text.includes('approvedStoreReply(status)'));
  const entry=text.slice(text.lastIndexOf('} else {\n    let reply = CommandLine.arguments.count == 1'));
  assert.ok(entry.includes('platformCredential('));
  assert.equal(entry.includes('approvedDescriptorInput'),false);
  assert.equal(entry.includes('SecItemAdd'),false);
  assert.equal(entry.includes('installSetupMenu'),false);
  for(const forbidden of ['NSPasteboard','standardInput.readDataToEndOfFile','readLine(','SecItemUpdate(','SecItemDelete('])assert.equal(text.includes(forbidden),false);
});

test('only explicit setup installs the native paste menu and reports useful static validation',async()=>{
  const text=await readFile(source,'utf8');
  assert.ok(text.includes('NSMenu(title: "Edición")'));
  assert.ok(text.includes('#selector(NSText.paste(_:)), keyEquivalent: "v"'));
  assert.ok(text.includes('paste.keyEquivalentModifierMask = .command'));
  assert.ok(text.includes('No llegó ningún valor. Usa Edición > Pegar (Cmd+V)'));
  assert.ok(text.includes('sin espacios, saltos de línea ni prefijo Bearer'));
  const store=text.slice(text.indexOf('func approvedStdinSetup()'),text.indexOf('func installSetupMenu'));
  assert.ok(store.includes('storeApprovedCredential(readerIdentity: setupReaderIdentity'));
  assert.ok(store.includes('disableInteraction: { SecKeychainSetUserInteractionAllowed(false) }'));
  const core=text.slice(text.indexOf('func storeApprovedCredential('),text.indexOf('func platformCredential('));
  assert.ok(core.indexOf('guard let expected = readerIdentity()') < core.indexOf('storeApprovedInput(readInput: readInput'));
  assert.ok(core.includes('current.1 == expected.1'));
  assert.ok(core.includes('guard disableInteraction() == errSecSuccess'));
  assert.equal(store.includes('SecItemCopyMatching'),false);
  assert.equal(store.includes('FileHandle.standardOutput'),false);
});
