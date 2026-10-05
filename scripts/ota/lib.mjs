// Builds, signs and stages updates for update-server/. Signing happens here, on the
// publisher's machine: the server only ever receives finished manifests and their signatures.

import { createHash, createPublicKey, sign, verify, X509Certificate, constants } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { appendFile, chmod, copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ASSET_NAME, CHANNEL, PLATFORMS, RUNTIME_VERSION, contentTypeFor } from '../../update-server/protocol.mjs';

export { CHANNEL, PLATFORMS, RUNTIME_VERSION };
export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const SIGNING_ALGORITHM = 'rsa-v1_5-sha256';
export const DEFAULT_BASE_URL = 'https://updates.shroudwallet.com';

/**
 * The server's URL without a trailing slash, or null unless it is https (plain http only for this
 * machine or the Android emulator).
 */
export function parseBaseUrl(value) {
  const baseUrl = value.replace(/\/+$/, '');
  const allowed = /^https:\/\//.test(baseUrl) || /^http:\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2)(:\d+)?$/.test(baseUrl);
  return allowed ? baseUrl : null;
}

export function digests(bytes) {
  const sha256 = createHash('sha256').update(bytes).digest();
  return {
    sha256Hex: sha256.toString('hex'),
    // What expo-updates checks a downloaded file against: base64url, no padding.
    sha256Base64Url: sha256.toString('base64url'),
    md5Hex: createHash('md5').update(bytes).digest('hex'),
  };
}

/** RSASSA-PKCS1-v1_5 with SHA-256 over the exact UTF-8 bytes the server will send. */
export function signBody(body, privateKeyPem) {
  return sign('sha256', Buffer.from(body, 'utf8'), { key: privateKeyPem, padding: constants.RSA_PKCS1_PADDING }).toString('base64');
}

export function verifyBody(body, signatureBase64, publicKey) {
  return verify(
    'sha256',
    Buffer.from(body, 'utf8'),
    { key: publicKey, padding: constants.RSA_PKCS1_PADDING },
    Buffer.from(signatureBase64, 'base64'),
  );
}

/** The expo-signature header: an Expo structured-field dictionary of strings. */
export function signatureHeader(signatureBase64, keyId) {
  if (!/^[A-Za-z0-9+/=]+$/.test(signatureBase64)) throw new Error('Signature is not base64');
  if (!/^[A-Za-z0-9._-]+$/.test(keyId)) throw new Error(`Unsupported key id ${keyId}`);
  return `sig="${signatureBase64}", keyid="${keyId}"`;
}

/**
 * Refuses a key that doesn't belong to the certificate built into the app: every update it
 * signed would be rejected on every phone.
 */
export function assertKeyMatchesCertificate(privateKeyPem, certificatePem, now = new Date()) {
  const certificate = new X509Certificate(certificatePem);
  const fromKey = createPublicKey(privateKeyPem).export({ type: 'spki', format: 'der' });
  const fromCertificate = certificate.publicKey.export({ type: 'spki', format: 'der' });
  if (!fromKey.equals(fromCertificate)) throw new Error('The private key does not match the code-signing certificate built into the app');
  if (new Date(certificate.validTo) <= now) throw new Error(`The code-signing certificate expired on ${certificate.validTo}`);
  return certificate;
}

/**
 * The manifest for one platform of an `expo export`, plus the files it points at. `body` is the
 * exact JSON that gets signed and served. `metadata` holds strings only, and is signed with it.
 */
export async function buildManifest({ exportDir, platformMetadata, id, createdAt, runtimeVersion, baseUrl, expoConfig, metadata = {} }) {
  const files = new Map();
  const describe = async (relativePath, ext, isLaunchAsset) => {
    const source = path.join(exportDir, relativePath);
    const bytes = await readFile(source);
    const { sha256Hex, sha256Base64Url, md5Hex } = digests(bytes);
    const fileExtension = isLaunchAsset ? '.bundle' : `.${ext.toLowerCase()}`;
    const name = `${sha256Hex}${fileExtension}`;
    if (!ASSET_NAME.test(name)) throw new Error(`The update server cannot serve ${relativePath} (extension ${ext})`);
    files.set(name, source);
    return {
      hash: sha256Base64Url,
      key: md5Hex,
      contentType: contentTypeFor(fileExtension),
      fileExtension,
      url: `${baseUrl}/assets/${name}`,
    };
  };

  const manifest = {
    id,
    createdAt,
    runtimeVersion,
    launchAsset: await describe(platformMetadata.bundle, null, true),
    assets: await Promise.all(platformMetadata.assets.map(asset => describe(asset.path, asset.ext, false))),
    metadata,
    extra: { expoClient: expoConfig },
  };
  return { manifest, body: JSON.stringify(manifest), files: [...files].map(([name, source]) => ({ name, source })) };
}

export function rollBackToEmbeddedDirective(commitTime) {
  return JSON.stringify({ type: 'rollBackToEmbedded', parameters: { commitTime } });
}

function pointerFile(stageDir, channel, runtimeVersion, platform) {
  if (!CHANNEL.test(channel)) throw new Error(`Invalid channel ${channel}`);
  if (!RUNTIME_VERSION.test(runtimeVersion)) throw new Error(`Invalid runtime version ${runtimeVersion}`);
  if (!PLATFORMS.includes(platform)) throw new Error(`Invalid platform ${platform}`);
  return path.join(stageDir, 'channels', channel, runtimeVersion, `${platform}.json`);
}

/** Lays an update out the way update-server reads it, under `stageDir`. */
export async function stageUpdate({ stageDir, channel, runtimeVersion, platform, id, body, signature, files, pointer }) {
  await mkdir(path.join(stageDir, 'assets'), { recursive: true });
  for (const { name, source } of files) {
    const target = path.join(stageDir, 'assets', name);
    if (!existsSync(target)) await copyFile(source, target);
  }
  const dir = path.join(stageDir, 'updates', id);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'manifest.json'), body);
  await writeFile(path.join(dir, 'signature'), `${signature}\n`);
  const file = pointerFile(stageDir, channel, runtimeVersion, platform);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify({ kind: 'update', id, ...pointer })}\n`);
}

/** Points a channel back at the code built into the app, with a signed directive. */
export async function stageRollback({ stageDir, channel, runtimeVersion, platform, id, body, signature, pointer }) {
  const dir = path.join(stageDir, 'directives', id);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'directive.json'), body);
  await writeFile(path.join(dir, 'signature'), `${signature}\n`);
  const file = pointerFile(stageDir, channel, runtimeVersion, platform);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify({ kind: 'rollBackToEmbedded', id, ...pointer })}\n`);
}

// ---- Command-line helpers shared by publish.mjs and rollback.mjs ----

export function run(command, args, { env, capture = true } = {}) {
  const result = spawnSync(command, args, {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed${capture ? `:\n${result.stderr || result.stdout}` : ''}`);
  }
  return result.stdout;
}

// .env files stay out of published updates: Expo CLI would otherwise inline whatever
// EXPO_PUBLIC_* values sit in the publisher's checkout into the bundle every user downloads.
// Store builds take those variables from their EAS environment, so an update gets the same
// values only when it is published under `eas env:exec <environment>` (see RELEASE.md).
export const EXPO_ENV = { EXPO_NO_DOTENV: '1' };

export function fingerprint(platform) {
  const output = run('npx', ['expo-updates', 'fingerprint:generate', '--platform', platform], { env: EXPO_ENV });
  const { hash } = JSON.parse(output);
  if (!RUNTIME_VERSION.test(hash ?? '')) throw new Error(`Unexpected fingerprint for ${platform}: ${hash}`);
  return hash;
}

export async function loadSigning({ projectRoot, privateKeyPath }) {
  const appJson = JSON.parse(await readFile(path.join(projectRoot, 'app.json'), 'utf8'));
  const updates = appJson.expo?.updates ?? {};
  const { keyid, alg } = updates.codeSigningMetadata ?? {};
  if (alg !== SIGNING_ALGORITHM) throw new Error(`app.json codeSigningMetadata.alg is ${alg}, expected ${SIGNING_ALGORITHM}`);
  if (!keyid) throw new Error('app.json codeSigningMetadata.keyid is missing');
  const certificatePem = await readFile(path.join(projectRoot, updates.codeSigningCertificate), 'utf8');
  const privateKeyPem = await readFile(privateKeyPath, 'utf8');
  const certificate = assertKeyMatchesCertificate(privateKeyPem, certificatePem);
  return { keyId: keyid, privateKeyPem, publicKey: certificate.publicKey };
}

export function gitState(projectRoot) {
  const commit = run('git', ['-C', projectRoot, 'rev-parse', 'HEAD']).trim();
  const dirty = run('git', ['-C', projectRoot, 'status', '--porcelain']).trim() !== '';
  return { commit, dirty };
}

/** Makes the staged tree readable by the server's container, whatever the publisher's umask is. */
async function makeReadable(dir) {
  await chmod(dir, 0o755);
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) await makeReadable(entryPath);
    else await chmod(entryPath, 0o644);
  }
}

/**
 * Copies the staged tree to the server with rsync over SSH: files first, the channel pointers
 * last, so a client never sees a pointer to an update that isn't fully there yet. `target` is
 * `user@host:/path`, or `user@host:` when the key is restricted to the directory with rrsync.
 */
export async function upload(stageDir, target) {
  // -p keeps the modes set here. Without it the server's umask decides, and may leave the files
  // unreadable to the container. (--chmod would do instead, but macOS's openrsync ignores it.)
  await makeReadable(stageDir);
  const base = ['-rtp'];
  const destination = /[:/]$/.test(target) ? target : `${target}/`;
  const content = ['assets', 'updates', 'directives'].filter(dir => existsSync(path.join(stageDir, dir)));
  if (content.length)
    run('rsync', [...base, '--ignore-existing', ...content.map(dir => path.join(stageDir, dir)), destination], { capture: false });
  run('rsync', [...base, path.join(stageDir, 'channels'), destination], { capture: false });
}

/** Splits a multipart/mixed response from the update server into its named parts. */
export function parseMultipart(contentType, body) {
  const boundary = /boundary=([^;]+)/.exec(contentType ?? '')?.[1];
  if (!boundary) throw new Error(`Expected a multipart response, got ${contentType}`);
  return body
    .split(`--${boundary}`)
    .slice(1, -1)
    .map(chunk => {
      const [head, ...rest] = chunk.replace(/^\r\n/, '').split('\r\n\r\n');
      const headers = Object.fromEntries(
        head.split('\r\n').map(line => [line.slice(0, line.indexOf(':')).toLowerCase(), line.slice(line.indexOf(':') + 1).trim()]),
      );
      return {
        name: /name="([^"]+)"/.exec(headers['content-disposition'])?.[1],
        headers,
        body: rest.join('\r\n\r\n').replace(/\r\n$/, ''),
      };
    });
}

/**
 * What the server hands a build of `runtimeVersion` on `channel` right now: null when nothing is
 * published for it, otherwise the update or roll-back directive with its time.
 */
export async function fetchLive({ baseUrl, channel, runtimeVersion, platform }) {
  const response = await fetch(`${baseUrl}/manifest`, {
    headers: {
      'expo-protocol-version': '1',
      'expo-platform': platform,
      'expo-runtime-version': runtimeVersion,
      'expo-channel-name': channel,
    },
  });
  if (response.status === 204) return null;
  if (response.status !== 200) throw new Error(`${baseUrl}/manifest answered ${response.status} for ${platform} on ${channel}`);
  const parts = parseMultipart(response.headers.get('content-type'), await response.text());
  const manifest = parts.find(part => part.name === 'manifest');
  if (manifest) {
    const { id, createdAt } = JSON.parse(manifest.body);
    return { kind: 'update', id, createdAt };
  }
  const directive = parts.find(part => part.name === 'directive');
  if (directive) return { kind: 'rollBackToEmbedded', createdAt: JSON.parse(directive.body).parameters.commitTime };
  throw new Error(`${baseUrl}/manifest sent neither a manifest nor a directive`);
}

/**
 * Apps ignore an update or roll-back that is not newer than the update they run, so a clock
 * behind the one that made the live update would publish something that changes nothing.
 */
export function assertNewerThanLive(live, createdAt, what) {
  if (live && !(Date.parse(live.createdAt) < Date.parse(createdAt))) {
    throw new Error(
      `${what} would be dated ${createdAt}, but the live ${live.kind === 'update' ? 'update' : 'roll-back'} is dated ${live.createdAt}. ` +
        "Apps would ignore it; check this machine's clock.",
    );
  }
}

export async function appendHistory(outDir, entry) {
  await mkdir(outDir, { recursive: true });
  await appendFile(path.join(outDir, 'history.jsonl'), `${JSON.stringify(entry)}\n`);
}
