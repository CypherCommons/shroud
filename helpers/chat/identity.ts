import { createTaggedHash, decodeSilentPaymentAddress } from '@silent-pay/core';
import type { Network } from 'bitcoinjs-lib';
import { bytesToHex } from '@noble/hashes/utils';
import ecc from '../../modules/noble_ecc';
import { getScanPrivateKey, getSilentPaymentAddress } from '../silent-payments/SilentPaymentKeyDerivation';
import type { NetworkConfig } from '../../modules/network';

/**
 * The SP address is the chat address.
 *
 *   t      = TaggedHash("Shroud/NostrIdentity", B_scan)      (read as a scalar)
 *   secret = b_scan + t  (mod n)                             (only the wallet can compute it)
 *   pubkey = x-only(B_scan + t·G)                            (anyone holding the address can)
 *
 * so every saved contact maps to a Nostr pubkey without a lookup server, and every wallet, decoy
 * bucket and network gets its own chat identity. The cost: the chat key is exactly as sensitive as
 * the scan key. Never send `b_scan` anywhere, and never log `secret`.
 */
export const NOSTR_IDENTITY_TAG = 'Shroud/NostrIdentity';

export interface ChatIdentity {
  /** 32-byte secret key. Treat like the scan key. */
  secretKey: Uint8Array;
  /** x-only pubkey, 64 hex chars: the Nostr / Marmot identity. */
  pubkey: string;
  /** The silent payment address this identity belongs to. */
  address: string;
}

/** The additive tweak for a scan public key. Throws if it isn't a valid scalar (probability ~2^-128). */
export function nostrIdentityTweak(scanPubKey: Uint8Array): Uint8Array {
  return createTaggedHash(NOSTR_IDENTITY_TAG, scanPubKey);
}

/** The chat pubkey (x-only hex) for a 33-byte compressed scan public key. */
export function pubkeyFromScanKey(scanPubKey: Uint8Array): string {
  const t = nostrIdentityTweak(scanPubKey);
  const point = ecc.pointAddScalar(scanPubKey, t, true);
  if (!point) throw new Error('chat identity: tweak out of range or point invalid');
  return bytesToHex(point.slice(1));
}

/** The chat secret key for a 32-byte scan private key and its public key. */
export function secretFromScanKey(scanPrivKey: Uint8Array, scanPubKey: Uint8Array): Uint8Array {
  const t = nostrIdentityTweak(scanPubKey);
  const secret = ecc.privateAdd(scanPrivKey, t);
  if (!secret) throw new Error('chat identity: tweak out of range or secret is zero');
  return secret;
}

/**
 * The chat pubkey for any silent payment address, no keys needed. Throws on an address that does
 * not parse on `network` (the HRP is checked, so a `tsp1` address is refused on mainnet).
 */
export function pubkeyFromAddress(address: string, network: Network): string {
  const { scanKey } = decodeSilentPaymentAddress(address.trim().toLowerCase(), network);
  return pubkeyFromScanKey(scanKey);
}

/** The wallet's own chat identity, derived from its seed. */
export function deriveChatIdentity(seed: Buffer, network: NetworkConfig): ChatIdentity {
  const scanPriv = getScanPrivateKey(seed, network);
  const scanPub = ecc.pointFromScalar(scanPriv, true);
  if (!scanPub) throw new Error('chat identity: invalid scan key');
  const secretKey = secretFromScanKey(scanPriv, scanPub);
  return { secretKey, pubkey: pubkeyFromScanKey(scanPub), address: getSilentPaymentAddress(seed, network) };
}
