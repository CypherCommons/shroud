/* eslint-disable no-bitwise */
import { webcrypto } from 'crypto';
import { nobleSubtle } from '../../helpers/chat/nobleSubtle';

// Typed loosely: TS 5.9's Uint8Array<ArrayBufferLike> no longer satisfies lib.dom's BufferSource.
const node: any = webcrypto.subtle;
const hex = (b: ArrayBuffer | Uint8Array): string => Buffer.from(b instanceof Uint8Array ? b : new Uint8Array(b)).toString('hex');
const rnd = (n: number): Uint8Array => webcrypto.getRandomValues(new Uint8Array(n)) as Uint8Array;

describe('nobleSubtle matches Node WebCrypto', () => {
  it('digest', async () => {
    const data = rnd(777);
    for (const name of ['SHA-256', 'SHA-384', 'SHA-512']) {
      expect(hex(await nobleSubtle.digest(name, data))).toBe(hex(await node.digest(name, data)));
      expect(hex(await nobleSubtle.digest({ name }, data))).toBe(hex(await node.digest(name, data)));
    }
  });

  it('HMAC sign and verify', async () => {
    const raw = rnd(32);
    const data = rnd(100);
    for (const hash of ['SHA-256', 'SHA-512']) {
      const a = { name: 'HMAC', hash };
      const nk = await nobleSubtle.importKey('raw', raw, a, false, ['sign', 'verify']);
      const wk = await node.importKey('raw', raw, a, false, ['sign', 'verify']);
      const sig = await nobleSubtle.sign('HMAC', nk, data);
      expect(hex(sig)).toBe(hex(await node.sign('HMAC', wk, data)));
      expect(await nobleSubtle.verify('HMAC', nk, sig, data)).toBe(true);
      const bad = new Uint8Array(sig.slice(0));
      bad[0] ^= 1;
      expect(await nobleSubtle.verify('HMAC', nk, bad, data)).toBe(false);
      expect(await nobleSubtle.verify('HMAC', nk, bad.slice(1), data)).toBe(false);
    }
  });

  it('HKDF deriveBits', async () => {
    const ikm = rnd(32);
    const salt = rnd(16);
    const info = rnd(9);
    for (const hash of ['SHA-256', 'SHA-384']) {
      const nk = await nobleSubtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
      const wk = await node.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
      const params = { name: 'HKDF', hash, salt, info };
      expect(hex(await nobleSubtle.deriveBits(params, nk, 8 * 77))).toBe(hex(await node.deriveBits(params, wk, 8 * 77)));
    }
  });

  it('AES-GCM, both directions, with and without AAD', async () => {
    const raw = rnd(32);
    const iv = rnd(12);
    const data = rnd(321);
    const aad = rnd(7);
    const nk = await nobleSubtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
    const wk = await node.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
    for (const additionalData of [undefined, aad]) {
      const p = { name: 'AES-GCM', iv, additionalData };
      const ct = await nobleSubtle.encrypt(p, nk, data);
      expect(hex(ct)).toBe(hex(await node.encrypt(p, wk, data)));
      expect(hex(await nobleSubtle.decrypt(p, nk, ct))).toBe(hex(data));
      expect(hex(await node.decrypt(p, wk, ct))).toBe(hex(data));
    }
    const ct = new Uint8Array(await nobleSubtle.encrypt({ name: 'AES-GCM', iv }, nk, data));
    ct[0] ^= 1;
    await expect(nobleSubtle.decrypt({ name: 'AES-GCM', iv }, nk, ct)).rejects.toBeDefined();
  });

  it('X25519 key agreement across both implementations', async () => {
    const wa = (await node.generateKey('X25519', true, ['deriveBits'])) as { privateKey: any; publicKey: any };
    const wb = (await node.generateKey('X25519', true, ['deriveBits'])) as { privateKey: any; publicKey: any };
    const aPriv = new Uint8Array(await node.exportKey('pkcs8', wa.privateKey));
    const bPubRaw = new Uint8Array(await node.exportKey('raw', wb.publicKey));

    const nobleAPriv = await nobleSubtle.importKey('pkcs8', aPriv, 'X25519', true, ['deriveBits']);
    const nobleBPub = await nobleSubtle.importKey('raw', bPubRaw, 'X25519', true, []);
    const viaNoble = await nobleSubtle.deriveBits({ name: 'X25519', public: nobleBPub }, nobleAPriv, 256);
    const viaNode = await node.deriveBits({ name: 'X25519', public: wb.publicKey }, wa.privateKey, 256);
    expect(hex(viaNoble)).toBe(hex(viaNode));

    // generateKey + export round-trips into Node
    const g = await nobleSubtle.generateKey('X25519', true, ['deriveBits']);
    const pkcs8 = (await nobleSubtle.exportKey('pkcs8', g.privateKey)) as ArrayBuffer;
    const raw = (await nobleSubtle.exportKey('raw', g.publicKey)) as ArrayBuffer;
    const nodePriv = await node.importKey('pkcs8', pkcs8, 'X25519', true, ['deriveBits']);
    const nodePub = await node.importKey('raw', raw, 'X25519', true, []);
    const s1 = await node.deriveBits({ name: 'X25519', public: wb.publicKey }, nodePriv, 256);
    const s2 = await nobleSubtle.deriveBits(
      { name: 'X25519', public: await nobleSubtle.importKey('raw', bPubRaw, 'X25519', true, []) },
      g.privateKey,
      256,
    );
    expect(hex(s1)).toBe(hex(s2));
    const s3 = await node.deriveBits({ name: 'X25519', public: nodePub }, wb.privateKey, 256);
    expect(hex(s3)).toBe(hex(s2));

    // JWK export matches Node's
    const nj = (await nobleSubtle.exportKey('jwk', nobleAPriv)) as Record<string, string>;
    const wj = await node.exportKey('jwk', wa.privateKey);
    expect(nj.x).toBe(wj.x);
    expect(nj.d).toBe(wj.d);
  });

  it('Ed25519 sign is deterministic and verifies across implementations', async () => {
    const w = (await node.generateKey('Ed25519', true, ['sign', 'verify'])) as { privateKey: any; publicKey: any };
    const pkcs8 = new Uint8Array(await node.exportKey('pkcs8', w.privateKey));
    const pubRaw = new Uint8Array(await node.exportKey('raw', w.publicKey));
    const data = rnd(64);

    const nPriv = await nobleSubtle.importKey('pkcs8', pkcs8, 'Ed25519', true, ['sign']);
    const nPub = await nobleSubtle.importKey('raw', pubRaw, 'Ed25519', true, ['verify']);
    const sig = await nobleSubtle.sign('Ed25519', nPriv, data);
    expect(hex(sig)).toBe(hex(await node.sign('Ed25519', w.privateKey, data)));
    expect(await nobleSubtle.verify('Ed25519', nPub, sig, data)).toBe(true);
    expect(await node.verify('Ed25519', w.publicKey, sig, data)).toBe(true);
    expect(await nobleSubtle.verify('Ed25519', nPub, sig, rnd(64))).toBe(false);

    const exported = (await nobleSubtle.exportKey('pkcs8', nPriv)) as ArrayBuffer;
    expect(hex(exported)).toBe(hex(pkcs8));
  });

  it('refuses algorithms it does not implement', async () => {
    await expect(nobleSubtle.digest('SHA-1', rnd(4))).rejects.toThrow(/unsupported hash/);
    await expect(nobleSubtle.deriveBits({ name: 'PBKDF2' }, {} as any, 8)).rejects.toThrow(/unsupported/);
  });
});
