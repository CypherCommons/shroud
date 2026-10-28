#!/usr/bin/env node
// Drafts the GitHub release of an Android version, for people who install with Obtainium or check
// the download themselves (VERIFY.md):
//   - a universal APK, made with bundletool from the same .aab that went to Google Play and signed
//     with the same upload key, so it carries the Play build's code, version code and runtime
//     version (and receives the same over-the-air updates);
//   - SHA256SUMS, signed with the release OpenPGP key (SHA256SUMS.asc);
//   - release notes with the verification steps.
// It stages everything under build/release/<tag>/. With --upload it also creates a *draft* GitHub
// release; publishing the draft stays a manual step.
//
//   read -s SHROUD_KS_PASS && read -s SHROUD_KEY_PASS && export SHROUD_KS_PASS SHROUD_KEY_PASS
//   node scripts/release/github.mjs --aab build/shroud-1.0.0.aab --keystore <upload keystore.jks> \
//     --key-alias <alias> [--upload]
//
// The keystore passwords come from the environment, so they never appear in the process list.
// This is not an npm script on purpose: package.json scripts are part of the runtime version
// fingerprint.

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REPO = 'CypherCommons/shroud';
const PACKAGE = 'com.shroudwallet.app';
// SHA-256 of the upload key's certificate (the EAS-managed keystore). Google re-signs Play installs
// with its own app signing key; APKs on GitHub keep this one.
const UPLOAD_CERT_SHA256 = '75E05E0E8E399DC85593B1E152D647FE7393AD26A22C8D7D0ACD79C5E4A0AF87';
// The release OpenPGP key, which signs SHA256SUMS (contrib/release-keys/shroud-release.asc).
const RELEASE_KEY = '64609910C0EA35EC650DED3C107A83191C6D828D';

const { values } = parseArgs({
  options: {
    aab: { type: 'string' },
    keystore: { type: 'string' },
    'key-alias': { type: 'string' },
    'gpg-key': { type: 'string', default: RELEASE_KEY },
    tag: { type: 'string' },
    'expect-cert': { type: 'string', default: UPLOAD_CERT_SHA256 },
    out: { type: 'string' },
    upload: { type: 'boolean', default: false },
  },
});

function fail(message) {
  console.error(`release: ${message}`);
  process.exit(1);
}

function run(command, args, { capture = true, allowFailure = false } = {}) {
  const result = spawnSync(command, args, { cwd: PROJECT_ROOT, encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
  if (result.error) fail(`could not run ${command}: ${result.error.message}`);
  if (result.status !== 0 && !allowFailure) {
    fail(`${command} ${args[0]} failed${capture ? `:\n${(result.stderr || result.stdout).trim()}` : ''}`);
  }
  return result;
}

const hex = value => value.replace(/[^0-9a-f]/gi, '').toUpperCase();
const colons = value => hex(value).match(/../g).join(':');
const groups = value => hex(value).match(/.{4}/g).join(' ');

function findApksigner() {
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? path.join(os.homedir(), 'Library/Android/sdk');
  const buildTools = path.join(sdk, 'build-tools');
  if (existsSync(buildTools)) {
    const versions = readdirSync(buildTools).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    for (const version of versions.reverse()) {
      const candidate = path.join(buildTools, version, 'apksigner');
      if (existsSync(candidate)) return candidate;
    }
  }
  return 'apksigner';
}

// ---- Inputs ----

for (const flag of ['aab', 'keystore', 'key-alias']) if (!values[flag]) fail(`--${flag} is required`);
const aab = path.resolve(values.aab);
const keystore = path.resolve(values.keystore);
if (!existsSync(aab)) fail(`no such file: ${aab}`);
if (!existsSync(keystore)) fail(`no such keystore: ${keystore}`);
const gpgKey = hex(values['gpg-key']);
if (gpgKey.length !== 40) fail('--gpg-key must be the full 40-character fingerprint of the release key');
const expectedCert = hex(values['expect-cert']);
const { SHROUD_KS_PASS: ksPass, SHROUD_KEY_PASS: keyPass = process.env.SHROUD_KS_PASS } = process.env;
if (!ksPass) fail('set SHROUD_KS_PASS (and SHROUD_KEY_PASS if the key has its own password), e.g. with read -s');

const dump = xpath => run('bundletool', ['dump', 'manifest', '--bundle', aab, '--xpath', xpath]).stdout.trim();
const packageName = dump('/manifest/@package');
if (packageName !== PACKAGE) fail(`the bundle is ${packageName}, not ${PACKAGE}`);
const versionName = dump('/manifest/@android:versionName');
const versionCode = dump('/manifest/@android:versionCode');
const tag = values.tag ?? `v${versionName}`;

if (run('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`], { allowFailure: true }).status !== 0) {
  fail(`tag ${tag} doesn't exist; create it on the release commit with git tag -s ${tag} and push it`);
}
const commit = run('git', ['rev-list', '-n', '1', tag]).stdout.trim();
if (run('git', ['tag', '-v', tag], { allowFailure: true }).status !== 0) {
  console.warn(`release: warning: tag ${tag} has no valid signature (create it with git tag -s)`);
}

const outDir = path.resolve(values.out ?? path.join(PROJECT_ROOT, 'build', 'release', tag));
const apkName = `shroud-${versionName}-universal.apk`;
await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

// ---- Universal APK ----

const workDir = await mkdtemp(path.join(os.tmpdir(), 'shroud-release-'));
try {
  const ksPassFile = path.join(workDir, 'ks-pass');
  const keyPassFile = path.join(workDir, 'key-pass');
  await writeFile(ksPassFile, ksPass, { mode: 0o600 });
  await writeFile(keyPassFile, keyPass, { mode: 0o600 });
  await chmod(workDir, 0o700);
  console.log(`release: building the universal APK of ${versionName} (${versionCode})`);
  const apks = path.join(workDir, 'universal.apks');
  run('bundletool', [
    'build-apks',
    '--bundle',
    aab,
    '--output',
    apks,
    '--mode',
    'universal',
    '--ks',
    keystore,
    '--ks-key-alias',
    values['key-alias'],
    '--ks-pass',
    `file:${ksPassFile}`,
    '--key-pass',
    `file:${keyPassFile}`,
  ]);
  run('unzip', ['-q', '-o', apks, 'universal.apk', '-d', workDir]);
  await copyFile(path.join(workDir, 'universal.apk'), path.join(outDir, apkName));
  await chmod(path.join(outDir, apkName), 0o644);
} finally {
  await rm(workDir, { recursive: true, force: true });
}
const apk = path.join(outDir, apkName);

// ---- Signing certificate ----

const verified = run(findApksigner(), ['verify', '--verbose', '--print-certs', apk]).stdout;
const certs = [...new Set([...verified.matchAll(/certificate SHA-256 digest: ([0-9a-f]{64})/gi)].map(match => hex(match[1])))];
if (certs.length !== 1) fail(`expected one signer, apksigner found ${certs.length}`);
if (certs[0] !== expectedCert)
  fail(`the APK is signed with ${colons(certs[0])}, not the upload key ${colons(expectedCert)}; wrong keystore?`);
if (
  !/Verified using v2 scheme \(APK Signature Scheme v2\): true|Verified using v3 scheme \(APK Signature Scheme v3\): true/.test(verified)
) {
  fail('the APK has no v2 or v3 signature');
}

// ---- Checksums and their signature ----

const apkHash = createHash('sha256')
  .update(await readFile(apk))
  .digest('hex');
const sums = path.join(outDir, 'SHA256SUMS');
await writeFile(sums, `${apkHash}  ${apkName}\n`);
console.log(`release: signing SHA256SUMS with ${groups(gpgKey)}`);
run('gpg', ['--local-user', gpgKey, '--armor', '--detach-sign', '--output', `${sums}.asc`, sums], { capture: false });
const status = run('gpg', ['--status-fd', '1', '--verify', `${sums}.asc`, sums]).stdout;
const validSig = /\[GNUPG:\] VALIDSIG ([0-9A-F]{40}) .* ([0-9A-F]{40})$/m.exec(status);
if (!validSig || (validSig[1] !== gpgKey && validSig[2] !== gpgKey)) fail('SHA256SUMS.asc does not verify against the release key');

// ---- Release notes ----

const notes = `## Shroud ${versionName} for Android

This is the same build as version ${versionName} (${versionCode}) on Google Play, signed with Cypher Commons' own key instead of Google's.

### Install
- **With Obtainium:** add \`https://github.com/${REPO}\`. Obtainium installs this release and checks for new ones.
- **By hand:** download \`${apkName}\` below and open it on your phone.

A copy installed from Google Play is signed with a different key, so one can't update the other. To switch, back up your recovery phrase, uninstall, install this APK and restore the wallet.

### Verify
Full instructions are in [VERIFY.md](https://github.com/${REPO}/blob/master/VERIFY.md).

| | |
| --- | --- |
| Release key (signs \`SHA256SUMS\`) | \`${groups(gpgKey)}\` |
| APK signing certificate, SHA-256 | \`${colons(certs[0])}\` |
| Source | tag \`${tag}\`, commit \`${commit}\` |

\`\`\`sh
gpg --keyserver hkps://keys.openpgp.org --recv-keys ${gpgKey}
gpg --verify SHA256SUMS.asc SHA256SUMS
shasum -a 256 --ignore-missing --check SHA256SUMS   # or: sha256sum --ignore-missing --check SHA256SUMS
apksigner verify --print-certs ${apkName}
\`\`\`

On GrapheneOS, AppVerifier checks the installed app against \`${PACKAGE}\` and the certificate above.

These checks prove the APK is the file Cypher Commons released. Shroud's builds aren't reproducible yet, so they don't prove the APK was built from the published source.
`;
await writeFile(path.join(outDir, 'release-notes.md'), notes);

const files = [apk, sums, `${sums}.asc`];
console.log(`\n${tag} (commit ${commit.slice(0, 9)}), ${versionName} (${versionCode})`);
console.log(`  ${apkName}  sha256 ${apkHash}`);
console.log(`  certificate ${colons(certs[0])}`);
if (!values.upload) {
  console.log(`\nStaged in ${outDir}. Nothing was uploaded; rerun with --upload to create a draft release.`);
  process.exit(0);
}

run(
  'gh',
  [
    'release',
    'create',
    tag,
    '--repo',
    REPO,
    '--draft',
    '--verify-tag',
    '--title',
    `Shroud ${versionName}`,
    '--notes-file',
    path.join(outDir, 'release-notes.md'),
    ...files,
  ],
  {
    capture: false,
  },
);
console.log('\nDraft release created. Review it on GitHub, then publish it; Obtainium only sees published releases.');
