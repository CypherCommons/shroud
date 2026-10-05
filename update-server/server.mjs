// Read-only server for expo-updates (Expo Updates protocol v1).
//
// It never signs anything. Each update's manifest and signature are made on a publisher's
// machine by scripts/ota/publish.mjs and copied into DATA_DIR. A compromised server can't
// produce an update the app would accept, but it can withhold updates or resend anything
// signed earlier for the same runtime version (see README.md). It also keeps no request
// logs: an update check reveals a user's IP address, and nothing here records it.
//
// DATA_DIR layout (written only by the publish and rollback scripts):
//   assets/<sha256 hex><ext>                         update files, content-addressed
//   updates/<id>/manifest.json, updates/<id>/signature
//   directives/<id>/directive.json, directives/<id>/signature
//   channels/<channel>/<runtime version>/<platform>.json
//       the current pointer: {"kind":"update","id":…} or {"kind":"rollBackToEmbedded","id":…}

import { open, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';

import { ASSET_NAME, CHANNEL, RUNTIME_VERSION, UUID, contentTypeFor } from './protocol.mjs';

export function createUpdateServer({ dataDir }) {
  const root = path.resolve(dataDir);
  return createServer((req, res) => {
    handle(req, res, root).catch(error => {
      console.error('update-server: request failed:', error?.message ?? error);
      if (!res.headersSent) sendJson(res, 500, { error: 'Internal error' });
      else res.destroy();
    });
  });
}

async function handle(req, res, root) {
  const { pathname } = new URL(req.url ?? '/', 'http://localhost');
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Expected GET' });
  if (pathname === '/health') return sendText(res, 200, 'ok');
  if (pathname === '/manifest') return serveManifest(req, res, root);
  if (pathname.startsWith('/assets/')) return serveAsset(res, root, pathname.slice('/assets/'.length));
  return sendJson(res, 404, { error: 'Not found' });
}

async function serveManifest(req, res, root) {
  // Node joins a repeated header into one comma-separated value, which none of the checks below accept.
  const header = name => req.headers[name];

  if (header('expo-protocol-version') !== '1') return sendJson(res, 400, { error: 'Expected expo-protocol-version: 1' });
  const platform = header('expo-platform');
  if (platform !== 'ios' && platform !== 'android') return sendJson(res, 400, { error: 'Expected expo-platform: ios or android' });
  const runtimeVersion = header('expo-runtime-version');
  if (!runtimeVersion || !RUNTIME_VERSION.test(runtimeVersion)) return sendJson(res, 400, { error: 'Invalid expo-runtime-version' });
  // Builds name their channel in their request headers; production is the default in the app's native config.
  const channel = header('expo-channel-name') ?? 'production';
  if (!CHANNEL.test(channel)) return sendJson(res, 400, { error: 'Invalid expo-channel-name' });

  const pointer = await readJsonOrNull(path.join(root, 'channels', channel, runtimeVersion, `${platform}.json`));
  // Nothing published for this channel and runtime: a 204 tells the client to keep what it runs.
  if (!pointer) return noUpdate(res);
  if (typeof pointer.id !== 'string' || !UUID.test(pointer.id))
    throw new Error(`Malformed pointer for ${channel}/${runtimeVersion}/${platform}`);

  const currentUpdateId = header('expo-current-update-id');
  if (pointer.kind === 'update') {
    if (currentUpdateId === pointer.id) return noUpdate(res);
    const dir = path.join(root, 'updates', pointer.id);
    const [manifest, signature] = await Promise.all([readFile(path.join(dir, 'manifest.json')), readSignature(dir)]);
    return sendMultipart(res, [
      { name: 'manifest', body: manifest, headers: { 'content-type': 'application/json; charset=utf-8', 'expo-signature': signature } },
      { name: 'extensions', body: '{"assetRequestHeaders":{}}', headers: { 'content-type': 'application/json' } },
    ]);
  }
  if (pointer.kind === 'rollBackToEmbedded') {
    const embeddedUpdateId = header('expo-embedded-update-id');
    if (currentUpdateId && currentUpdateId === embeddedUpdateId) return noUpdate(res);
    const dir = path.join(root, 'directives', pointer.id);
    const [directive, signature] = await Promise.all([readFile(path.join(dir, 'directive.json')), readSignature(dir)]);
    return sendMultipart(res, [
      { name: 'directive', body: directive, headers: { 'content-type': 'application/json; charset=utf-8', 'expo-signature': signature } },
    ]);
  }
  throw new Error(`Unknown pointer kind ${JSON.stringify(pointer.kind)} for ${channel}/${runtimeVersion}/${platform}`);
}

async function serveAsset(res, root, name) {
  if (!ASSET_NAME.test(name)) return sendJson(res, 404, { error: 'Not found' });
  let file;
  try {
    file = await open(path.join(root, 'assets', name));
  } catch (error) {
    if (error.code === 'ENOENT') return sendJson(res, 404, { error: 'Not found' });
    throw error;
  }
  try {
    const info = await file.stat();
    if (!info.isFile()) return sendJson(res, 404, { error: 'Not found' });
    res.writeHead(200, {
      'content-type': contentTypeFor(path.extname(name)),
      'content-length': info.size,
      // The name is the file's hash, so its bytes never change.
      'cache-control': 'public, max-age=31536000, immutable',
    });
    await pipeline(file.createReadStream({ autoClose: false }), res);
  } catch (error) {
    // The client went away mid-download; there is nothing to answer.
    if (error.code !== 'ERR_STREAM_PREMATURE_CLOSE') throw error;
  } finally {
    await file.close();
  }
}

async function readSignature(dir) {
  const signature = (await readFile(path.join(dir, 'signature'), 'utf8')).trim();
  if (!signature.startsWith('sig=')) throw new Error(`Malformed signature in ${dir}`);
  return signature;
}

async function readJsonOrNull(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function noUpdate(res) {
  res.writeHead(204, { 'expo-protocol-version': '1', 'expo-sfv-version': '0', 'cache-control': 'private, max-age=0' });
  res.end();
}

function sendMultipart(res, parts) {
  const boundary = `shroud-${randomBytes(16).toString('hex')}`;
  const chunks = [];
  for (const part of parts) {
    let head = `--${boundary}\r\ncontent-disposition: form-data; name="${part.name}"\r\n`;
    for (const [key, value] of Object.entries(part.headers)) head += `${key}: ${value}\r\n`;
    chunks.push(Buffer.from(`${head}\r\n`), Buffer.isBuffer(part.body) ? part.body : Buffer.from(part.body), Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  const body = Buffer.concat(chunks);
  res.writeHead(200, {
    'expo-protocol-version': '1',
    'expo-sfv-version': '0',
    'cache-control': 'private, max-age=0',
    'content-type': `multipart/mixed; boundary=${boundary}`,
    'content-length': body.length,
  });
  res.end(body);
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

function sendText(res, status, text) {
  res.writeHead(status, { 'content-type': 'text/plain', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dataDir = process.env.DATA_DIR ?? '/data';
  const port = Number(process.env.PORT ?? 3000);
  const server = createUpdateServer({ dataDir }).listen(port, () => {
    console.log(`update-server: serving ${path.resolve(dataDir)} on port ${port}`);
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
}
