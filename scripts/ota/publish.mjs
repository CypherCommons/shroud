#!/usr/bin/env node
// Publishes an over-the-air update to update-server/.
//
//   node scripts/ota/publish.mjs --channel production --message "Fix fee rounding" \
//     --private-key <path to private-key.pem> --upload deploy@updates.shroudwallet.com:/srv/shroud-updates
//
// It exports the JavaScript bundle and assets, builds one manifest per platform for the runtime
// version (native fingerprint) of the current checkout, signs each manifest with the key, checks
// the signature against the certificate built into the app, and stages everything under --out.
// With --upload it then copies the stage to the server; without it, the stage is left for review.

import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

import {
  CHANNEL,
  DEFAULT_BASE_URL,
  EXPO_ENV,
  PLATFORMS,
  appendHistory,
  buildManifest,
  fingerprint,
  gitState,
  loadSigning,
  run,
  signBody,
  signatureHeader,
  stageUpdate,
  upload,
  verifyBody,
} from './lib.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const { values } = parseArgs({
  options: {
    channel: { type: 'string' },
    platform: { type: 'string', default: 'all' },
    message: { type: 'string', default: '' },
    'private-key': { type: 'string' },
    'base-url': { type: 'string', default: DEFAULT_BASE_URL },
    out: { type: 'string', default: path.join(projectRoot, 'build', 'ota') },
    upload: { type: 'string' },
    'allow-dirty': { type: 'boolean', default: false },
  },
});

function fail(message) {
  console.error(`publish: ${message}`);
  process.exit(1);
}

if (!values.channel || !CHANNEL.test(values.channel)) fail('--channel is required (for example production or preview)');
if (!values['private-key']) fail('--private-key is required: the update-signing key from the vault');
const platforms = values.platform === 'all' ? PLATFORMS : [values.platform];
if (!platforms.every(p => PLATFORMS.includes(p))) fail('--platform must be ios, android or all');
const baseUrl = values['base-url'].replace(/\/+$/, '');
if (!/^https:\/\//.test(baseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2)(:\d+)?$/.test(baseUrl)) {
  fail('--base-url must be https (plain http only for localhost or the Android emulator)');
}

const { commit, dirty } = gitState(projectRoot);
if (dirty && !values['allow-dirty']) fail('the working tree has uncommitted changes; commit them or pass --allow-dirty');
for (const name of Object.keys(process.env).filter(key => key.startsWith('EXPO_PUBLIC_'))) {
  console.warn(`publish: ${name} is set in this shell and will be built into the update`);
}

const signing = await loadSigning({ projectRoot, privateKeyPath: values['private-key'] });

console.log('publish: computing runtime versions');
const runtimeVersions = Object.fromEntries(platforms.map(platform => [platform, fingerprint(platform)]));

const workDir = await mkdtemp(path.join(os.tmpdir(), 'shroud-ota-'));
try {
  const exportDir = path.join(workDir, 'export');
  console.log('publish: exporting the bundle');
  run('npx', ['expo', 'export', ...platforms.flatMap(p => ['--platform', p]), '--output-dir', exportDir], {
    env: EXPO_ENV,
    capture: false,
  });
  const metadata = JSON.parse(await readFile(path.join(exportDir, 'metadata.json'), 'utf8'));
  const expoConfig = JSON.parse(run('npx', ['expo', 'config', '--json', '--type', 'public'], { env: EXPO_ENV }));

  const stageDir = path.join(values.out, 'stage');
  await rm(stageDir, { recursive: true, force: true });
  const createdAt = new Date().toISOString();
  const published = [];

  for (const platform of platforms) {
    const id = randomUUID();
    const runtimeVersion = runtimeVersions[platform];
    const { body, files } = await buildManifest({
      exportDir,
      platformMetadata: metadata.fileMetadata[platform],
      id,
      createdAt,
      runtimeVersion,
      baseUrl,
      expoConfig,
    });
    const signatureBase64 = signBody(body, signing.privateKeyPem);
    if (!verifyBody(body, signatureBase64, signing.publicKey)) throw new Error('The signature does not verify against the certificate');
    await stageUpdate({
      stageDir,
      channel: values.channel,
      runtimeVersion,
      platform,
      id,
      body,
      signature: signatureHeader(signatureBase64, signing.keyId),
      files,
      pointer: { createdAt, message: values.message, commit },
    });
    published.push({ platform, id, runtimeVersion, assets: files.length });
  }

  if (values.upload) {
    console.log(`publish: uploading to ${values.upload}`);
    upload(stageDir, values.upload);
  }
  for (const entry of published) {
    await appendHistory(values.out, {
      ...entry,
      channel: values.channel,
      createdAt,
      message: values.message,
      commit,
      uploaded: Boolean(values.upload),
    });
  }

  console.log(`\nChannel ${values.channel}, commit ${commit.slice(0, 9)}${dirty ? ' (with uncommitted changes)' : ''}`);
  for (const { platform, id, runtimeVersion, assets } of published) {
    console.log(`  ${platform.padEnd(8)} update ${id}  runtime ${runtimeVersion}  ${assets} files`);
  }
  console.log(
    values.upload
      ? '\nUploaded. Apps download it on their next launch and run it on the one after.'
      : `\nStaged in ${stageDir}. Nothing was uploaded; rerun with --upload to publish.`,
  );
} finally {
  await rm(workDir, { recursive: true, force: true });
}
