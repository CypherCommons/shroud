/**
 * A tiny `crypto.subtle` backed by @noble, for marmot-ts on Hermes.
 *
 * React Native has no WebCrypto, and marmot-ts's HPKE layer (`@hpke/core`) calls `crypto.subtle`
 * for X25519, HKDF and AES-GCM. This implements the subset marmot-ts / ts-mls reach for: SHA-2
 * digests, HMAC, HKDF, AES-GCM, X25519 and Ed25519. Anything else throws a clear error rather than
 * silently misbehaving.
 *
 * `@noble/hashes` is the app's pinned 1.3.3 (no `.js` suffix on subpaths); curves and ciphers are v2.
 */
import { sha256, sha384, sha512 } from '@noble/hashes/sha2';
import { hmac } from '@noble/hashes/hmac';
import { hkdf } from '@noble/hashes/hkdf';
import { gcm } from '@noble/ciphers/aes.js';
import { x25519, ed25519 } from '@noble/curves/ed25519.js';
import { base64urlnopad } from '@scure/base';

type HashFn = Parameters<typeof hmac>[0];
type AlgorithmInput = string | { name: string; [k: string]: any };

const HASHES: Record<string, HashFn> = { 'SHA-256': sha256, 'SHA-384': sha384, 'SHA-512': sha512 };

const algName = (a: AlgorithmInput): string => (typeof a === 'string' ? a : a.name).toUpperCase();

const hashOf = (a: any): HashFn => {
  const h = typeof a === 'string' ? a : a?.name;
  const fn = HASHES[String(h).toUpperCase()];
  if (!fn) throw new Error(`noble-subtle: unsupported hash ${h}`);
  return fn;
};

const bytes = (d: BufferSource): Uint8Array => {
  if (d instanceof Uint8Array) return new Uint8Array(d);
  if (ArrayBuffer.isView(d)) return new Uint8Array(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) as ArrayBuffer);
  return new Uint8Array(d as ArrayBuffer);
};

const ab = (u8: Uint8Array): ArrayBuffer => u8.slice().buffer as ArrayBuffer;
const b64u = (u8: Uint8Array): string => base64urlnopad.encode(u8);
const unb64u = (s: string): Uint8Array => base64urlnopad.decode(s);

class Key {
  readonly type: string;
  readonly algorithm: { name: string; hash?: { name: string } };
  readonly extractable: boolean;
  readonly usages: string[];
  readonly _raw!: Uint8Array;

  constructor(type: string, algorithm: Key['algorithm'], extractable: boolean, usages: string[], raw: Uint8Array) {
    this.type = type;
    this.algorithm = algorithm;
    this.extractable = extractable;
    this.usages = usages;
    // Non-enumerable so a Key never serialises its secret bytes.
    Object.defineProperty(this, '_raw', { value: raw });
  }
}

const ED_PKCS8_PREFIX = Uint8Array.from([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20]);
const X_PKCS8_PREFIX = Uint8Array.from([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20]);

const okp = (name: string) => (name === 'X25519' ? x25519 : ed25519);

const gcmFor = (alg: any, key: Key) => gcm(key._raw, bytes(alg.iv), alg.additionalData ? bytes(alg.additionalData) : undefined);

export const nobleSubtle = {
  async digest(alg: AlgorithmInput, data: BufferSource): Promise<ArrayBuffer> {
    return ab(hashOf(alg)(bytes(data)));
  },

  async importKey(format: string, keyData: any, alg: AlgorithmInput, extractable: boolean, usages: string[]): Promise<Key> {
    const name = algName(alg);
    if (name === 'HMAC' || name === 'AES-GCM' || name === 'HKDF') {
      if (format !== 'raw') throw new Error(`noble-subtle: ${name} import format ${format}`);
      const a = alg as any;
      const algorithm = name === 'HMAC' ? { name, hash: { name: typeof a.hash === 'string' ? a.hash : a.hash.name } } : { name };
      return new Key('secret', algorithm, extractable, usages, bytes(keyData));
    }
    if (name === 'X25519' || name === 'ED25519') {
      const algorithm = { name: name === 'X25519' ? 'X25519' : 'Ed25519' };
      if (format === 'raw') return new Key('public', algorithm, true, usages, bytes(keyData));
      if (format === 'pkcs8') return new Key('private', algorithm, extractable, usages, bytes(keyData).slice(-32));
      if (format === 'jwk') {
        return keyData.d
          ? new Key('private', algorithm, extractable, usages, unb64u(keyData.d))
          : new Key('public', algorithm, true, usages, unb64u(keyData.x));
      }
    }
    throw new Error(`noble-subtle: importKey ${format}/${name} unsupported`);
  },

  async exportKey(format: string, key: Key): Promise<ArrayBuffer | Record<string, unknown>> {
    const name = key.algorithm.name;
    if (format === 'raw') {
      if (key.type === 'private') throw new Error('noble-subtle: cannot export private key as raw');
      return ab(key._raw);
    }
    if (format === 'pkcs8' && key.type === 'private') {
      const prefix = name === 'X25519' ? X_PKCS8_PREFIX : ED_PKCS8_PREFIX;
      const out = new Uint8Array(prefix.length + 32);
      out.set(prefix);
      out.set(key._raw, prefix.length);
      return ab(out);
    }
    if (format === 'jwk' && (name === 'X25519' || name === 'Ed25519')) {
      const pub = key.type === 'private' ? okp(name).getPublicKey(key._raw) : key._raw;
      const jwk: Record<string, unknown> = { kty: 'OKP', crv: name, x: b64u(pub), ext: true, key_ops: key.usages };
      if (key.type === 'private') jwk.d = b64u(key._raw);
      return jwk;
    }
    throw new Error(`noble-subtle: exportKey ${format}/${name} unsupported`);
  },

  async generateKey(alg: AlgorithmInput, extractable: boolean, usages: string[]): Promise<{ privateKey: Key; publicKey: Key }> {
    const name = algName(alg) === 'X25519' ? 'X25519' : 'Ed25519';
    const curve = okp(name);
    const sk = curve.utils.randomSecretKey();
    return {
      privateKey: new Key(
        'private',
        { name },
        extractable,
        usages.filter(u => u !== 'verify'),
        sk,
      ),
      publicKey: new Key(
        'public',
        { name },
        true,
        usages.filter(u => u === 'verify'),
        curve.getPublicKey(sk),
      ),
    };
  },

  async deriveBits(alg: any, key: Key, length: number): Promise<ArrayBuffer> {
    const name = algName(alg);
    if (name === 'X25519') return ab(x25519.getSharedSecret(key._raw, alg.public._raw).slice(0, length / 8));
    if (name === 'HKDF') return ab(hkdf(hashOf(alg.hash), key._raw, bytes(alg.salt), bytes(alg.info), length / 8));
    throw new Error(`noble-subtle: deriveBits ${name} unsupported`);
  },

  async sign(alg: AlgorithmInput, key: Key, data: BufferSource): Promise<ArrayBuffer> {
    const name = algName(alg);
    if (name === 'HMAC') return ab(hmac(hashOf(key.algorithm.hash), key._raw, bytes(data)));
    if (name === 'ED25519') return ab(ed25519.sign(bytes(data), key._raw));
    throw new Error(`noble-subtle: sign ${name} unsupported`);
  },

  async verify(alg: AlgorithmInput, key: Key, sig: BufferSource, data: BufferSource): Promise<boolean> {
    const name = algName(alg);
    if (name === 'HMAC') {
      const expect = hmac(hashOf(key.algorithm.hash), key._raw, bytes(data));
      const got = bytes(sig);
      if (expect.length !== got.length) return false;
      // Constant-time compare: fold every byte difference rather than bailing at the first.
      let diff = 0;
      // eslint-disable-next-line no-bitwise
      for (let i = 0; i < expect.length; i++) diff |= expect[i] ^ got[i];
      return diff === 0;
    }
    if (name === 'ED25519') return ed25519.verify(bytes(sig), bytes(data), key._raw);
    throw new Error(`noble-subtle: verify ${name} unsupported`);
  },

  async encrypt(alg: any, key: Key, data: BufferSource): Promise<ArrayBuffer> {
    if (algName(alg) !== 'AES-GCM') throw new Error('noble-subtle: only AES-GCM');
    return ab(gcmFor(alg, key).encrypt(bytes(data)));
  },

  async decrypt(alg: any, key: Key, data: BufferSource): Promise<ArrayBuffer> {
    if (algName(alg) !== 'AES-GCM') throw new Error('noble-subtle: only AES-GCM');
    return ab(gcmFor(alg, key).decrypt(bytes(data)));
  },
};

/**
 * Installs the shim as `globalThis.crypto.subtle` only if the runtime has none. Lazy: the noble
 * modules above are already loaded by whoever imports this file, so `shim.js` instead installs a
 * getter that requires this module on first use, keeping app start-up unaffected.
 */
export function installNobleSubtle(target: any = globalThis): void {
  if (!target.crypto) target.crypto = {};
  if (!target.crypto.subtle) {
    Object.defineProperty(target.crypto, 'subtle', { value: nobleSubtle, configurable: true, writable: true });
  }
}
