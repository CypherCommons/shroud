// node --test 'update-server/test/*.test.mjs'

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const { CHANNEL_HEADERS, setChannelHeader } = require('../../scripts/ota/channel-header.js');
const { fileHookTransform } = require('../../fingerprint.config.js');

const files = Object.keys(CHANNEL_HEADERS);

/** Runs a file through the fingerprint hook the way @expo/fingerprint does: 1 KB chunks, then the end. */
function hashInput(filePath, contents) {
  const source = { type: 'file', filePath };
  const bytes = Buffer.from(contents);
  const output = [];
  for (let offset = 0; offset < bytes.length; offset += 1024) {
    const result = fileHookTransform(source, bytes.subarray(offset, offset + 1024), false, 'utf8');
    if (result) output.push(Buffer.from(result));
  }
  const result = fileHookTransform(source, null, true, 'utf8');
  if (result) output.push(Buffer.from(result));
  return Buffer.concat(output).toString('utf8');
}

test('each native config names the update channel once, and builds ask for production', async () => {
  for (const file of files) {
    const contents = await readFile(path.join(repoRoot, file), 'utf8');
    const { contents: preview, count } = setChannelHeader(file, contents, 'preview');
    assert.equal(count, 1, file);
    assert.notEqual(preview, contents, file);
    assert.equal(setChannelHeader(file, preview, 'production').contents, contents, file);
  }
});

test('the runtime version fingerprint does not depend on the channel', async () => {
  for (const file of files) {
    const production = await readFile(path.join(repoRoot, file), 'utf8');
    const preview = setChannelHeader(file, production, 'preview').contents;
    assert.ok(production.length > 1024, `${file} should span several chunks`);
    assert.equal(hashInput(file, preview), hashInput(file, production), file);
    assert.notEqual(hashInput(file, production), production, file);
  }
});

test('the fingerprint hook leaves other files alone', () => {
  const chunk = Buffer.from('<string>production</string>');
  assert.equal(fileHookTransform({ type: 'file', filePath: 'ios/Shroud/Info.plist' }, chunk, false, 'utf8'), chunk);
  assert.equal(fileHookTransform({ type: 'contents', id: 'expoConfig' }, '{}', true, 'utf8'), '{}');
});
