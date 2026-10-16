// node --test 'update-server/test/*.test.mjs'

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

import { createUpdateServer } from '../server.mjs';
import { fetchLivePolicy, nextMinimumBuilds, policyBody, stagePolicy, upload } from '../../scripts/ota/lib.mjs';

let workDir, dataDir, server, baseUrl, body;

const getPolicy = (headers = {}) => fetch(`${baseUrl}/policy`, { headers });

before(async () => {
  workDir = await mkdtemp(path.join(os.tmpdir(), 'update-server-policy-test-'));
  dataDir = path.join(workDir, 'data');
  body = policyBody({ ios: 14, android: 12, updatedAt: '2026-10-16T12:00:00.000Z' });
  await stagePolicy({ stageDir: dataDir, channel: 'production', body });
  server = createUpdateServer({ dataDir }).listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
  await rm(workDir, { recursive: true, force: true });
});

describe('policy document', () => {
  test('holds both minimums, 0 meaning none', () => {
    assert.deepEqual(JSON.parse(policyBody({ ios: 0, android: 3, updatedAt: 'now' })), {
      minimumBuild: { ios: 0, android: 3 },
      updatedAt: 'now',
    });
  });

  test('refuses a minimum that is not a whole number', () => {
    for (const ios of [-1, 1.5, '14', undefined, Number.NaN]) {
      assert.throws(() => policyBody({ ios, android: 1 }), /minimum ios build/);
    }
  });

  test('refuses a channel that would leave the policies directory', async () => {
    await assert.rejects(stagePolicy({ stageDir: workDir, channel: '../x', body }), /Invalid channel/);
  });

  test('keeps the live minimum of a platform left out, so changing one never resets the other', () => {
    const live = { minimumBuild: { ios: 14, android: 12 } };
    assert.deepEqual(nextMinimumBuilds({ live, ios: 15 }), { ios: 15, android: 12 });
    assert.deepEqual(nextMinimumBuilds({ live, android: 0 }), { ios: 14, android: 0 });
    assert.deepEqual(nextMinimumBuilds({ live: null, ios: 3 }), { ios: 3, android: 0 });
    assert.deepEqual(nextMinimumBuilds({ live: { minimumBuild: { ios: 'x' } }, ios: 2, android: 1 }), { ios: 2, android: 1 });
  });

  test('refuses to carry over a live minimum that is not a build number', () => {
    assert.throws(() => nextMinimumBuilds({ live: { minimumBuild: { ios: 'x' } }, android: 1 }), /pass --ios/);
  });
});

describe('policy endpoint', () => {
  test("serves the channel's policy, uncached", async () => {
    const response = await getPolicy({ 'expo-channel-name': 'production' });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/json');
    assert.equal(response.headers.get('cache-control'), 'private, max-age=0');
    assert.deepEqual(await response.json(), JSON.parse(body));
  });

  test('defaults to production, like the manifest', async () => {
    assert.deepEqual(await (await getPolicy()).json(), JSON.parse(body));
  });

  test('answers 500 for a policy file that does not parse, so the operator sees it in the log', async () => {
    await writeFile(path.join(dataDir, 'policies', 'broken.json'), '{"minimumBuild":');
    assert.equal((await getPolicy({ 'expo-channel-name': 'broken' })).status, 500);
  });

  test('answers 204 for a channel with no policy', async () => {
    const response = await getPolicy({ 'expo-channel-name': 'preview' });
    assert.equal(response.status, 204);
    assert.equal(await response.text(), '');
  });

  test('rejects a malformed channel and anything but GET', async () => {
    assert.equal((await getPolicy({ 'expo-channel-name': '../production' })).status, 400);
    assert.equal((await fetch(`${baseUrl}/policy`, { method: 'POST' })).status, 405);
  });

  test('reports the live policy for the minimum-build script', async () => {
    assert.deepEqual(await fetchLivePolicy({ baseUrl, channel: 'production' }), JSON.parse(body));
    assert.equal(await fetchLivePolicy({ baseUrl, channel: 'preview' }), null);
  });

  test('says when the server predates /policy', async () => {
    const old = createServer((req, res) => res.writeHead(404).end()).listen(0);
    await new Promise(resolve => old.once('listening', resolve));
    try {
      await assert.rejects(fetchLivePolicy({ baseUrl: `http://127.0.0.1:${old.address().port}`, channel: 'production' }), /doesn't serve \/policy/);
    } finally {
      await new Promise(resolve => old.close(resolve));
    }
  });
});

describe('upload', { skip: spawnSync('rsync', ['--version']).error ? 'rsync is not installed' : false }, () => {
  test('sends a stage that holds only a policy, replacing the live one', async () => {
    const stageDir = path.join(workDir, 'policy-stage');
    const target = path.join(workDir, 'server-copy');
    await mkdir(path.join(target, 'policies'), { recursive: true });
    await writeFile(path.join(target, 'policies', 'production.json'), 'old\n');
    await stagePolicy({ stageDir, channel: 'production', body });

    await upload(stageDir, target);

    assert.equal(await readFile(path.join(target, 'policies', 'production.json'), 'utf8'), body);
    assert.equal(existsSync(path.join(target, 'channels')), false);
  });

  test('replaces a policy rewritten within the same second at the same size', async () => {
    const stageDir = path.join(workDir, 'same-second-stage');
    const target = path.join(workDir, 'same-second-copy');
    const same = { android: 12, updatedAt: '2026-10-16T12:00:00.000Z' };
    await stagePolicy({ stageDir, channel: 'production', body: policyBody({ ios: 2, ...same }) });
    await upload(stageDir, target);
    const changed = policyBody({ ios: 5, ...same });
    await stagePolicy({ stageDir, channel: 'production', body: changed });

    await upload(stageDir, target);

    assert.equal(await readFile(path.join(target, 'policies', 'production.json'), 'utf8'), changed);
  });

  test('refuses an empty stage', async () => {
    const stageDir = path.join(workDir, 'empty-stage');
    await mkdir(stageDir, { recursive: true });
    await assert.rejects(upload(stageDir, path.join(workDir, 'server-copy')), /Nothing to upload/);
  });
});
