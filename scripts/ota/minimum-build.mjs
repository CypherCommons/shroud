#!/usr/bin/env node
// Sets the oldest native build allowed to run on a channel. Builds below it show "Update required",
// with a button to the store, and can't be used until they're updated.
//
//   node scripts/ota/minimum-build.mjs --channel production --ios 14 [--android 12] \
//     --upload deploy@updates.shroudwallet.com:/srv/shroud-updates
//
// Builds are counted by build number (CFBundleVersion, versionCode), which EAS raises with every
// store build; 0 means no minimum. A platform left out keeps its live minimum. Before uploading it
// shows the live and new minimums and asks to go ahead (--yes skips the question). It isn't an npm
// script on purpose: package.json scripts are part of the runtime version (fingerprint.config.js).

import { rm } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';

import {
  CHANNEL,
  DEFAULT_BASE_URL,
  PROJECT_ROOT as projectRoot,
  appendHistory,
  fetchLivePolicy,
  nextMinimumBuilds,
  parseBaseUrl,
  policyBody,
  stagePolicy,
  upload,
} from './lib.mjs';

const PLATFORMS = ['ios', 'android'];

const { values } = parseArgs({
  options: {
    channel: { type: 'string' },
    ios: { type: 'string' },
    android: { type: 'string' },
    'base-url': { type: 'string', default: DEFAULT_BASE_URL },
    out: { type: 'string', default: path.join(projectRoot, 'build', 'ota') },
    upload: { type: 'string' },
    yes: { type: 'boolean', default: false },
  },
});

function fail(message) {
  console.error(`minimum-build: ${message}`);
  process.exit(1);
}

if (!values.channel || !CHANNEL.test(values.channel)) fail('--channel is required (for example production or preview)');
const given = {};
for (const platform of PLATFORMS) {
  if (values[platform] === undefined) continue;
  if (!/^\d{1,15}$/.test(values[platform])) fail(`--${platform} must be a build number, 0 for none`);
  given[platform] = Number(values[platform]);
}
if (!Object.keys(given).length) fail('pass --ios, --android or both: the oldest build number allowed to run, 0 for none');
const baseUrl = parseBaseUrl(values['base-url']);
if (!baseUrl) fail('--base-url must be https (plain http only for localhost or the Android emulator)');

let live;
try {
  live = await fetchLivePolicy({ baseUrl, channel: values.channel });
} catch (error) {
  // Staging both numbers needs nothing from the server; anything else does.
  if (values.upload || Object.keys(given).length < PLATFORMS.length) {
    fail(`can't read the live policy (${error.message}); it's needed to keep the minimum you leave out and to upload`);
  }
  console.warn(`minimum-build: can't read the live policy (${error.message}); staging without it`);
}
let builds;
try {
  builds = nextMinimumBuilds({ live, ...given });
} catch (error) {
  fail(error.message);
}

console.log(`Channel ${values.channel}, minimum build:`);
for (const platform of PLATFORMS) {
  const before = live === undefined ? '?' : (live?.minimumBuild?.[platform] ?? 0);
  console.log(`  ${platform.padEnd(8)} ${before} -> ${builds[platform]}`);
}
if (live !== undefined && PLATFORMS.every(platform => (live?.minimumBuild?.[platform] ?? 0) === builds[platform])) {
  console.log('Nothing changes.');
  process.exit(0);
}

// Its own stage, so a publish staged for review under stage/ is neither uploaded nor wiped by this.
const stageDir = path.join(values.out, 'policy-stage');
await rm(stageDir, { recursive: true, force: true });
const updatedAt = new Date().toISOString();
await stagePolicy({ stageDir, channel: values.channel, body: policyBody({ ...builds, updatedAt }) });

if (values.upload) {
  console.log(
    '\nBuilds below these numbers stop working until they are updated. Raise a minimum only once a build that meets it\n' +
      'is live in its store (at 100% on Google Play), and never past the OS versions the blocked builds support.',
  );
  if (!values.yes) {
    if (!process.stdin.isTTY) fail('pass --yes to upload without being asked');
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await prompt.question(`Upload to ${values.upload}? Type "yes" to go ahead: `);
    prompt.close();
    if (answer.trim().toLowerCase() !== 'yes') fail('nothing was uploaded');
  }
  console.log(`minimum-build: uploading to ${values.upload}`);
  await upload(stageDir, values.upload);
}
await appendHistory(values.out, { kind: 'minimumBuild', channel: values.channel, ...builds, updatedAt, uploaded: Boolean(values.upload) });

console.log(
  values.upload
    ? '\nUploaded. Builds check on their next launch.'
    : `\nStaged in ${stageDir}. Nothing was uploaded; rerun with --upload.`,
);
