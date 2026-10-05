#!/usr/bin/env node
// Rolls a channel back to the code built into the app, for builds of one runtime version.
//
//   node scripts/ota/rollback.mjs --channel production \
//     --private-key <path to private-key.pem> --upload deploy@updates.shroudwallet.com:/srv/shroud-updates
//
// The runtime version defaults to the native fingerprint of the current checkout. That must
// match the installed builds, so check out the commit they were built from, or pass
// --runtime-version-ios / --runtime-version-android. To go back to an earlier update instead,
// check out its commit and publish it again.

import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

import {
  CHANNEL,
  PLATFORMS,
  RUNTIME_VERSION,
  appendHistory,
  fingerprint,
  loadSigning,
  rollBackToEmbeddedDirective,
  signBody,
  signatureHeader,
  stageRollback,
  upload,
  verifyBody,
} from './lib.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const { values } = parseArgs({
  options: {
    channel: { type: 'string' },
    platform: { type: 'string', default: 'all' },
    'private-key': { type: 'string' },
    'runtime-version-ios': { type: 'string' },
    'runtime-version-android': { type: 'string' },
    out: { type: 'string', default: path.join(projectRoot, 'build', 'ota') },
    upload: { type: 'string' },
  },
});

function fail(message) {
  console.error(`rollback: ${message}`);
  process.exit(1);
}

if (!values.channel || !CHANNEL.test(values.channel)) fail('--channel is required');
if (!values['private-key']) fail('--private-key is required: the update-signing key from the vault');
const platforms = values.platform === 'all' ? PLATFORMS : [values.platform];
if (!platforms.every(p => PLATFORMS.includes(p))) fail('--platform must be ios, android or all');

const signing = await loadSigning({ projectRoot, privateKeyPath: values['private-key'] });
const stageDir = path.join(values.out, 'stage');
await rm(stageDir, { recursive: true, force: true });
const commitTime = new Date().toISOString();
const staged = [];

for (const platform of platforms) {
  const runtimeVersion = values[`runtime-version-${platform}`] ?? fingerprint(platform);
  if (!RUNTIME_VERSION.test(runtimeVersion)) fail(`invalid runtime version for ${platform}: ${runtimeVersion}`);
  const id = randomUUID();
  const body = rollBackToEmbeddedDirective(commitTime);
  const signatureBase64 = signBody(body, signing.privateKeyPem);
  if (!verifyBody(body, signatureBase64, signing.publicKey)) throw new Error('The signature does not verify against the certificate');
  await stageRollback({
    stageDir,
    channel: values.channel,
    runtimeVersion,
    platform,
    id,
    body,
    signature: signatureHeader(signatureBase64, signing.keyId),
    pointer: { createdAt: commitTime },
  });
  staged.push({ platform, id, runtimeVersion });
}

if (values.upload) upload(stageDir, values.upload);
for (const entry of staged) {
  await appendHistory(values.out, {
    ...entry,
    kind: 'rollBackToEmbedded',
    channel: values.channel,
    createdAt: commitTime,
    uploaded: Boolean(values.upload),
  });
}

console.log(`\nChannel ${values.channel} rolled back to the embedded code:`);
for (const { platform, runtimeVersion } of staged) console.log(`  ${platform.padEnd(8)} runtime ${runtimeVersion}`);
console.log(
  values.upload
    ? '\nUploaded. Apps return to their built-in code on the launch after their next check.'
    : `\nStaged in ${stageDir}. Nothing was uploaded; rerun with --upload.`,
);
