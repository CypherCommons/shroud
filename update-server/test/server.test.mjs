// node --test 'update-server/test/*.test.mjs'

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import certs from '@expo/code-signing-certificates';

import { createUpdateServer } from '../server.mjs';
import {
  assertKeyMatchesCertificate,
  buildManifest,
  rollBackToEmbeddedDirective,
  signBody,
  signatureHeader,
  stageRollback,
  stageUpdate,
  verifyBody,
} from '../../scripts/ota/lib.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// A throwaway key and self-signed certificate, made the way `expo-updates codesigning:generate` makes them.
const keyPair = certs.generateKeyPair();
const { privateKeyPEM } = certs.convertKeyPairToPEM(keyPair);
const certificate = certs.generateSelfSignedCodeSigningCertificate({
  keyPair,
  validityNotBefore: new Date(Date.now() - 60_000),
  validityNotAfter: new Date(Date.now() + 86_400_000),
  commonName: 'update-server test',
});
const certificatePEM = certs.convertCertificateToCertificatePEM(certificate);
const publicKey = assertKeyMatchesCertificate(privateKeyPEM, certificatePEM).publicKey;

const ID = '6f0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d';
const ROLLBACK_ID = '0a1b2c3d-4e5f-4a6b-9c7d-8e9fa0b1c2d3';
const EMBEDDED_ID = '11111111-2222-4333-8444-555555555555';

let workDir, dataDir, server, baseUrl, manifestBody;

async function fakeExport(dir) {
  await mkdir(path.join(dir, '_expo/static/js/android'), { recursive: true });
  await mkdir(path.join(dir, 'assets'), { recursive: true });
  await writeFile(path.join(dir, '_expo/static/js/android/index-abc.hbc'), 'console.log("update")');
  await writeFile(path.join(dir, 'assets/f00d'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  return { bundle: '_expo/static/js/android/index-abc.hbc', assets: [{ path: 'assets/f00d', ext: 'png' }] };
}

function parseMultipart(contentType, body) {
  const boundary = /boundary=([^;]+)/.exec(contentType)[1];
  return body
    .split(`--${boundary}`)
    .slice(1, -1)
    .map(chunk => {
      const [head, ...rest] = chunk.replace(/^\r\n/, '').split('\r\n\r\n');
      const headers = Object.fromEntries(
        head.split('\r\n').map(line => [line.slice(0, line.indexOf(':')).toLowerCase(), line.slice(line.indexOf(':') + 1).trim()]),
      );
      return { name: /name="([^"]+)"/.exec(headers['content-disposition'])[1], headers, body: rest.join('\r\n\r\n').replace(/\r\n$/, '') };
    });
}

function signatureOf(header) {
  return Object.fromEntries([...header.matchAll(/(\w+)="([^"]*)"/g)].map(([, key, value]) => [key, value]));
}

const updateHeaders = (overrides = {}) => ({
  'expo-protocol-version': '1',
  'expo-platform': 'android',
  'expo-runtime-version': 'rt1',
  'expo-channel-name': 'production',
  'expo-expect-signature': 'sig, keyid="main", alg="rsa-v1_5-sha256"',
  ...overrides,
});

const getManifest = headers => fetch(`${baseUrl}/manifest`, { headers });

before(async () => {
  workDir = await mkdtemp(path.join(os.tmpdir(), 'update-server-test-'));
  dataDir = path.join(workDir, 'data');
  const exportDir = path.join(workDir, 'export');
  const platformMetadata = await fakeExport(exportDir);
  server = createUpdateServer({ dataDir }).listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const built = await buildManifest({
    exportDir,
    platformMetadata,
    id: ID,
    createdAt: '2026-10-05T12:00:00.000Z',
    runtimeVersion: 'rt1',
    baseUrl,
    expoConfig: { name: 'Shroud' },
  });
  manifestBody = built.body;
  await stageUpdate({
    stageDir: dataDir,
    channel: 'production',
    runtimeVersion: 'rt1',
    platform: 'android',
    id: ID,
    body: built.body,
    signature: signatureHeader(signBody(built.body, privateKeyPEM), 'main'),
    files: built.files,
    pointer: { createdAt: '2026-10-05T12:00:00.000Z' },
  });
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
  await rm(workDir, { recursive: true, force: true });
});

describe('signing', () => {
  test('matches the signature Expo tooling produces for the same bytes', () => {
    const ours = signBody(manifestBody, privateKeyPEM);
    const expos = certs.signBufferRSASHA256AndVerify(keyPair.privateKey, certificate, Buffer.from(manifestBody, 'utf8'));
    assert.equal(ours, expos);
    assert.ok(verifyBody(manifestBody, ours, publicKey));
  });

  test('refuses a key that does not belong to the app certificate', async () => {
    const appCertificate = await readFile(path.join(repoRoot, 'certs/certificate.pem'), 'utf8');
    assert.throws(() => assertKeyMatchesCertificate(privateKeyPEM, appCertificate), /does not match/);
  });

  test('refuses an expired certificate', () => {
    assert.throws(() => assertKeyMatchesCertificate(privateKeyPEM, certificatePEM, new Date(Date.now() + 2 * 86_400_000)), /expired/);
  });

  test('signature header is an Expo structured-field dictionary', () => {
    assert.equal(signatureHeader('YWJj', 'main'), 'sig="YWJj", keyid="main"');
    assert.throws(() => signatureHeader('YWJj', 'ma"in'), /key id/);
  });

  test('stage paths reject traversal', async () => {
    await assert.rejects(
      stageRollback({
        stageDir: dataDir,
        channel: '../x',
        runtimeVersion: 'rt1',
        platform: 'android',
        id: ROLLBACK_ID,
        body: '{}',
        signature: 'sig="x"',
        pointer: {},
      }),
      /Invalid channel/,
    );
  });
});

describe('manifest endpoint', () => {
  test('serves the stored manifest with its signature and protocol headers', async () => {
    const response = await getManifest(updateHeaders());
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('expo-protocol-version'), '1');
    assert.equal(response.headers.get('expo-sfv-version'), '0');
    assert.equal(response.headers.get('cache-control'), 'private, max-age=0');
    const parts = parseMultipart(response.headers.get('content-type'), await response.text());
    assert.deepEqual(
      parts.map(part => part.name),
      ['manifest', 'extensions'],
    );
    const [manifest] = parts;
    assert.equal(manifest.body, manifestBody);
    const { sig, keyid } = signatureOf(manifest.headers['expo-signature']);
    assert.equal(keyid, 'main');
    assert.ok(verifyBody(manifest.body, sig, publicKey));
    assert.equal(JSON.parse(manifest.body).id, ID);
  });

  test('serves assets whose bytes match the manifest hashes', async () => {
    const manifest = JSON.parse(manifestBody);
    for (const asset of [manifest.launchAsset, ...manifest.assets]) {
      const response = await fetch(asset.url);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), asset.contentType);
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.equal(createHash('sha256').update(bytes).digest('base64url'), asset.hash);
    }
  });

  test('answers 204 when the client already runs the current update', async () => {
    const response = await getManifest(updateHeaders({ 'expo-current-update-id': ID }));
    assert.equal(response.status, 204);
  });

  test('answers 204 when nothing is published for the runtime version or channel', async () => {
    assert.equal((await getManifest(updateHeaders({ 'expo-runtime-version': 'rt2' }))).status, 204);
    assert.equal((await getManifest(updateHeaders({ 'expo-channel-name': 'preview' }))).status, 204);
  });

  test('defaults to the production channel', async () => {
    const headers = updateHeaders();
    delete headers['expo-channel-name'];
    assert.equal((await getManifest(headers)).status, 200);
  });

  test('rejects malformed requests', async () => {
    assert.equal((await getManifest(updateHeaders({ 'expo-protocol-version': '0' }))).status, 400);
    assert.equal((await getManifest(updateHeaders({ 'expo-platform': 'web' }))).status, 400);
    assert.equal((await getManifest(updateHeaders({ 'expo-runtime-version': '../rt1' }))).status, 400);
    assert.equal((await getManifest(updateHeaders({ 'expo-channel-name': '../production' }))).status, 400);
    assert.equal((await fetch(`${baseUrl}/manifest`, { method: 'POST', headers: updateHeaders() })).status, 405);
  });

  test('does not serve files outside the asset store', async () => {
    assert.equal((await fetch(`${baseUrl}/assets/..%2Fchannels%2Fproduction%2Frt1%2Fandroid.json`)).status, 404);
    assert.equal((await fetch(`${baseUrl}/assets/not-a-hash.png`)).status, 404);
    assert.equal((await fetch(`${baseUrl}/updates/${ID}/manifest.json`)).status, 404);
  });

  test('serves a signed rollBackToEmbedded directive once a rollback is staged', async () => {
    const body = rollBackToEmbeddedDirective('2026-10-05T13:00:00.000Z');
    await stageRollback({
      stageDir: dataDir,
      channel: 'production',
      runtimeVersion: 'rt1',
      platform: 'android',
      id: ROLLBACK_ID,
      body,
      signature: signatureHeader(signBody(body, privateKeyPEM), 'main'),
      pointer: { createdAt: '2026-10-05T13:00:00.000Z' },
    });
    const response = await getManifest(updateHeaders({ 'expo-current-update-id': ID, 'expo-embedded-update-id': EMBEDDED_ID }));
    assert.equal(response.status, 200);
    const [directive] = parseMultipart(response.headers.get('content-type'), await response.text());
    assert.equal(directive.name, 'directive');
    assert.deepEqual(JSON.parse(directive.body), { type: 'rollBackToEmbedded', parameters: { commitTime: '2026-10-05T13:00:00.000Z' } });
    assert.ok(verifyBody(directive.body, signatureOf(directive.headers['expo-signature']).sig, publicKey));

    const alreadyEmbedded = await getManifest(
      updateHeaders({ 'expo-current-update-id': EMBEDDED_ID, 'expo-embedded-update-id': EMBEDDED_ID }),
    );
    assert.equal(alreadyEmbedded.status, 204);
  });

  test('health check', async () => {
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'ok');
  });
});
