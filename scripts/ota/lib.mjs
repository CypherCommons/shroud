// Builds, signs and stages updates for update-server/. Signing happens here, on the
// publisher's machine: the server only ever receives finished manifests and their signatures.

import { createHash, createPublicKey, sign, verify, X509Certificate, constants } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { access, appendFile, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const CHANNEL = /^[a-z0-9][a-z0-9._-]{0,63}$/;
export const RUNTIME_VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
export const PLATFORMS = ['ios', 'android'];
export const SIGNING_ALGORITHM = 'rsa-v1_5-sha256';
export const DEFAULT_BASE_URL = 'https://updates.shroudwallet.com';

const CONTENT_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  json: 'application/json',
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
  woff2: 'font/woff2',
};

export function contentTypeFor(ext) {
  return CONTENT_TYPES[ext.toLowerCase()] ?? 'application/octet-stream';
}

export function digests(bytes) {
  return {
    sha256Hex: createHash('sha256').update(bytes).digest('hex'),
    // What expo-updates checks a downloaded file against: base64url, no padding.
    sha256Base64Url: createHash('sha256').update(bytes).digest('base64url'),
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
 * exact JSON that gets signed and served.
 */
export async function buildManifest({ exportDir, platformMetadata, id, createdAt, runtimeVersion, baseUrl, expoConfig }) {
  const files = new Map();
  const describe = async (relativePath, ext, isLaunchAsset) => {
    const source = path.join(exportDir, relativePath);
    const bytes = await readFile(source);
    const { sha256Hex, sha256Base64Url, md5Hex } = digests(bytes);
    const fileExtension = isLaunchAsset ? '.bundle' : `.${ext}`;
    const name = `${sha256Hex}${fileExtension}`;
    files.set(name, source);
    return {
      hash: sha256Base64Url,
      key: md5Hex,
      contentType: isLaunchAsset ? 'application/javascript' : contentTypeFor(ext),
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
    metadata: {},
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

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

/** Lays an update out the way update-server reads it, under `stageDir`. */
export async function stageUpdate({ stageDir, channel, runtimeVersion, platform, id, body, signature, files, pointer }) {
  await mkdir(path.join(stageDir, 'assets'), { recursive: true });
  for (const { name, source } of files) {
    const target = path.join(stageDir, 'assets', name);
    if (!(await exists(target))) await copyFile(source, target);
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
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed${capture ? `:\n${result.stderr || result.stdout}` : ''}`);
  }
  return result.stdout;
}

// .env files stay out of published updates. Expo CLI would otherwise inline whatever
// EXPO_PUBLIC_* values sit on the publisher's machine into the bundle every user downloads,
// while store builds use the shipped defaults.
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

/**
 * Copies the staged tree to the server with rsync over SSH: files first, the channel pointers
 * last, so a client never sees a pointer to an update that isn't fully there yet.
 */
export function upload(stageDir, target) {
  const base = ['-rt', '--chmod=Du=rwx,Dgo=rx,Fu=rw,Fgo=r'];
  const content = ['assets', 'updates', 'directives'].filter(dir => spawnSync('test', ['-d', path.join(stageDir, dir)]).status === 0);
  if (content.length)
    run('rsync', [...base, '--ignore-existing', ...content.map(dir => path.join(stageDir, dir)), `${target}/`], { capture: false });
  run('rsync', [...base, path.join(stageDir, 'channels'), `${target}/`], { capture: false });
}

export async function appendHistory(outDir, entry) {
  await mkdir(outDir, { recursive: true });
  await appendFile(path.join(outDir, 'history.jsonl'), `${JSON.stringify(entry)}\n`);
}
