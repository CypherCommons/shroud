import { BIP32Factory, BIP32Interface } from 'bip32';
import {
  encodeSilentPaymentAddress,
  createLabeledSilentPaymentAddress,
  createTaggedHash,
  serialiseUint32,
  type LabelMap,
} from '@silent-pay/core';
import { Buffer } from 'buffer';
import ecc from '../../modules/noble_ecc';
import type { NetworkConfig } from '../../modules/network';

const bip32 = BIP32Factory(ecc);

/** BIP-352 label index used as the wallet's change address by convention. */
export const SP_CHANGE_LABEL = 0;

interface SilentPaymentKeys {
  scanKey: BIP32Interface;
  spendKey: BIP32Interface;
}

/**
 * BIP-352 scan/spend keys at `m/352'/coin_type'/account'/{spend,scan}'/0`. Coin type follows
 * BIP-44, so it is 1' on every test chain — which means testnet4 and signet derive the *same*
 * keys and therefore the same address. They are told apart by `networkId` at the storage layer,
 * not here.
 */
function deriveSilentPaymentKeys(seed: Buffer, network: NetworkConfig): SilentPaymentKeys {
  const root = bip32.fromSeed(seed, network.bitcoinjs);
  const spendKey = root.derivePath(`m/352'/${network.coinType}'/0'/0'/0`);
  const scanKey = root.derivePath(`m/352'/${network.coinType}'/0'/1'/0`);

  return { scanKey, spendKey };
}

export function getScanPrivateKey(seed: Buffer, network: NetworkConfig): Uint8Array {
  const { scanKey } = deriveSilentPaymentKeys(seed, network);
  return new Uint8Array(scanKey.privateKey!);
}

export function getSpendPrivateKey(seed: Buffer, network: NetworkConfig): Uint8Array {
  const { spendKey } = deriveSilentPaymentKeys(seed, network);
  return new Uint8Array(spendKey.privateKey!);
}

export function getScanPublicKey(seed: Buffer, network: NetworkConfig): Uint8Array {
  const { scanKey } = deriveSilentPaymentKeys(seed, network);
  return new Uint8Array(scanKey.publicKey);
}

export function getSpendPublicKey(seed: Buffer, network: NetworkConfig): Uint8Array {
  const { spendKey } = deriveSilentPaymentKeys(seed, network);
  return new Uint8Array(spendKey.publicKey);
}

/** `sp1…` on mainnet, `tsp1…` on the test chains — the HRP comes from the bitcoinjs network. */
export function getSilentPaymentAddress(seed: Buffer, network: NetworkConfig): string {
  const { scanKey, spendKey } = deriveSilentPaymentKeys(seed, network);
  return encodeSilentPaymentAddress(new Uint8Array(scanKey.publicKey), new Uint8Array(spendKey.publicKey), network.bitcoinjs);
}

export function getSilentPaymentChangeAddress(seed: Buffer, network: NetworkConfig): string {
  const { scanKey, spendKey } = deriveSilentPaymentKeys(seed, network);
  return createLabeledSilentPaymentAddress(
    new Uint8Array(scanKey.privateKey!),
    new Uint8Array(spendKey.publicKey),
    SP_CHANGE_LABEL,
    network.bitcoinjs,
  );
}

/** The BIP-352 label scalar `m = hash_BIP0352/Label(b_scan || ser32(label))`. */
function deriveChangeLabelTweak(scanPriv: Uint8Array): Uint8Array {
  return createTaggedHash('BIP0352/Label', Buffer.concat([scanPriv, serialiseUint32(SP_CHANGE_LABEL)]));
}

export function getSilentPaymentChangeSpendPrivateKey(seed: Buffer, network: NetworkConfig): Uint8Array {
  const { scanKey, spendKey } = deriveSilentPaymentKeys(seed, network);
  const m = deriveChangeLabelTweak(new Uint8Array(scanKey.privateKey!));
  const tweakedPriv = ecc.privateAdd(new Uint8Array(spendKey.privateKey!), m);
  if (!tweakedPriv) throw new Error('Failed to derive labeled spend private key');
  return tweakedPriv;
}

/**
 * Label map in the shape `@silent-pay/core`'s scanner expects: `m*G` (hex) -> `m` (hex).
 *
 * A scan run with this map returns a tweak that already carries the label offset, so a
 * matched change output is spendable with the *main* spend key.
 */
export function getSilentPaymentChangeLabelMap(seed: Buffer, network: NetworkConfig): LabelMap {
  const { scanKey } = deriveSilentPaymentKeys(seed, network);
  const m = deriveChangeLabelTweak(new Uint8Array(scanKey.privateKey!));
  const mG = ecc.pointFromScalar(m, true);
  if (!mG) throw new Error('Failed to derive label point');
  return { [Buffer.from(mG).toString('hex')]: Buffer.from(m).toString('hex') };
}

export function getSilentPaymentChangeSpendPublicKey(seed: Buffer, network: NetworkConfig): Uint8Array {
  const tweakedPriv = getSilentPaymentChangeSpendPrivateKey(seed, network);
  const pubkey = ecc.pointFromScalar(tweakedPriv, true);
  if (!pubkey) throw new Error('Failed to derive labeled spend public key');
  return pubkey;
}
