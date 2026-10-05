#!/usr/bin/env node
// Points a build at the update channel of its EAS build profile (`channel` in eas.json).
//
//   node scripts/ota/set-build-channel.mjs <profile>
//
// The native projects ship asking for production. EAS Build changes that per profile only when
// updates come from EAS Update (u.expo.dev), so scripts/eas-build-pre-install.sh runs this for our
// server. It edits the build's copy of android/ and ios/; fingerprint.config.js leaves the channel
// out of the runtime version.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { CHANNEL } from '../../update-server/protocol.mjs';
import channelHeader from './channel-header.js';
import { PROJECT_ROOT } from './lib.mjs';

function fail(message) {
  console.error(`set-build-channel: ${message}`);
  process.exit(1);
}

const profileName = process.argv[2];
if (!profileName) fail('usage: set-build-channel.mjs <EAS build profile>');
const { build: profiles = {} } = JSON.parse(await readFile(path.join(PROJECT_ROOT, 'eas.json'), 'utf8'));

function channelOf(name, seen = new Set()) {
  const profile = profiles[name];
  if (!profile || seen.has(name)) fail(`eas.json has no usable build profile ${name}`);
  seen.add(name);
  return profile.channel ?? (profile.extends ? channelOf(profile.extends, seen) : undefined);
}

const channel = channelOf(profileName);
if (!channel || !CHANNEL.test(channel)) fail(`build profile ${profileName} needs a valid channel in eas.json`);

for (const file of Object.keys(channelHeader.CHANNEL_HEADERS)) {
  const fullPath = path.join(PROJECT_ROOT, file);
  const { contents, count } = channelHeader.setChannelHeader(file, await readFile(fullPath, 'utf8'), channel);
  if (count !== 1) fail(`expected ${file} to name the update channel once, found ${count}`);
  await writeFile(fullPath, contents);
}
console.log(`set-build-channel: ${profileName} builds ask for updates on channel ${channel}`);
