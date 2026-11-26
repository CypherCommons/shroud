import { encodeSilentPaymentAddress } from '@silent-pay/core';
import { getPublicKey } from 'nostr-tools/pure';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import ecc from '../../modules/noble_ecc';
import { getNetwork } from '../../modules/network';
import {
  deriveChatIdentity,
  nostrIdentityTweak,
  pubkeyFromAddress,
  pubkeyFromScanKey,
  secretFromScanKey,
} from '../../helpers/chat/identity';

// Cross-checked against an independent implementation: both directions must produce these exact bytes.
const VECTOR = {
  scanSecret: 'e6fc561d1ee6d5a0a50a27013899450c05d04c3cefa69f4d723caef6712e5154',
  scanPubkey: '023db9788ed8210250e68eafad02b86e6d53a75f688c21a092bd48ff47cdd265a6',
  t: '1fede499ccb2223a47800dae648eaa3c914d2663f453fe64bc0875eca92658f7',
  chatSecret: '06ea3ab6eb98f7daec8a34af9d27ef49dc6e95ba34b1fd766e72c6564a1e690a',
  chatPubkey: 'c4090b55878c2c5c7fe3bea148af9f4b7a2ec6f41396d4f8cab38f730af9ccc9',
};

const SIGNET = getNetwork('signet');
const MAINNET = getNetwork('bitcoin');

describe('chat identity derivation', () => {
  const scanSecret = hexToBytes(VECTOR.scanSecret);
  const scanPub = hexToBytes(VECTOR.scanPubkey);

  it('matches the test vector, secret → pubkey', () => {
    expect(bytesToHex(ecc.pointFromScalar(scanSecret, true)!)).toBe(VECTOR.scanPubkey);
    expect(bytesToHex(nostrIdentityTweak(scanPub))).toBe(VECTOR.t);
    expect(bytesToHex(secretFromScanKey(scanSecret, scanPub))).toBe(VECTOR.chatSecret);
  });

  it('matches the test vector, address side (no secret) → pubkey', () => {
    expect(pubkeyFromScanKey(scanPub)).toBe(VECTOR.chatPubkey);
  });

  it('wallet side and address side agree: schnorr pubkey(secret) == pubkeyFromAddress(address)', () => {
    const secret = secretFromScanKey(scanSecret, scanPub);
    const spend = ecc.pointFromScalar(hexToBytes('11'.repeat(32)), true)!;
    const address = encodeSilentPaymentAddress(scanPub, spend, SIGNET.bitcoinjs);
    expect(getPublicKey(secret)).toBe(VECTOR.chatPubkey);
    expect(pubkeyFromAddress(address, SIGNET.bitcoinjs)).toBe(getPublicKey(secret));
  });

  it('holds for many random scan keys, including ones whose tweaked point has odd Y', () => {
    for (let i = 1; i <= 40; i++) {
      const priv = hexToBytes(i.toString(16).padStart(64, '0').replace(/^0{2}/, 'a1'));
      const pub = ecc.pointFromScalar(priv, true)!;
      expect(getPublicKey(secretFromScanKey(priv, pub))).toBe(pubkeyFromScanKey(pub));
    }
  });

  it('is case-insensitive and rejects an address from the wrong network', () => {
    const spend = ecc.pointFromScalar(hexToBytes('22'.repeat(32)), true)!;
    const address = encodeSilentPaymentAddress(scanPub, spend, SIGNET.bitcoinjs);
    expect(pubkeyFromAddress(address.toUpperCase(), SIGNET.bitcoinjs)).toBe(VECTOR.chatPubkey);
    expect(() => pubkeyFromAddress(address, MAINNET.bitcoinjs)).toThrow();
    expect(() => pubkeyFromAddress('not an address', SIGNET.bitcoinjs)).toThrow();
  });

  it('derives the wallet identity from a seed, and it matches what a contact computes from the address', () => {
    const seed = Buffer.alloc(64, 7);
    const id = deriveChatIdentity(seed, SIGNET);
    expect(getPublicKey(id.secretKey)).toBe(id.pubkey);
    expect(pubkeyFromAddress(id.address, SIGNET.bitcoinjs)).toBe(id.pubkey);
    expect(id.address.startsWith('tsp1')).toBe(true);
    // Mainnet derives a different key, so a different identity.
    expect(deriveChatIdentity(seed, MAINNET).pubkey).not.toBe(id.pubkey);
  });
});
