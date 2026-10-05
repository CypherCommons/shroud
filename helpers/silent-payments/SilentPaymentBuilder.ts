import { Buffer } from 'buffer';
import * as bitcoin from 'bitcoinjs-lib';
import { createOutputs, decodeSilentPaymentAddress, type Outpoint, type PrivateKey, type RecipientAddress } from '@silent-pay/core';
import ecc from '../../modules/noble_ecc';

// Taproot output encoding needs the ECC backend. Done here rather than relying on a wallet class
// having been imported first, since this module is reachable on its own.
bitcoin.initEccLib(ecc);

/**
 * Sender-side BIP-352, wrapping `@silent-pay/core`'s `createOutputs`.
 *
 * This replaces BlueWallet's `silent-payments` fork, which hardcoded mainnet in three places
 * (an `sp1` prefix test, `pubkeyToAddress`, `addressToPubkey`) and therefore could not encode a
 * `tsp1` recipient or emit a testnet output.
 *
 * `createOutputs` differs from the builder it replaces in two ways that this module exists to
 * paper over:
 *
 *  1. It takes only silent-payment recipients — a plain on-chain address makes
 *     `decodeSilentPaymentAddress` throw — so non-SP targets have to be held back and passed
 *     through untouched.
 *  2. It returns outputs grouped by scan key rather than in recipient order, and carries no
 *     index back, so the caller has to reconstruct which target each output belongs to.
 */

/** A transaction output as the wallet layer models it, before SP resolution. */
export interface SilentPaymentTarget {
  address?: string;
  value?: number;
}

/**
 * Does this parse as a silent-payment address *on this network*? Unlike a `startsWith('sp1')`
 * test this verifies the bech32m HRP, so a mainnet `sp1` address is rejected on signet and a
 * `tsp1` address is rejected on mainnet instead of being mistaken for a regular on-chain
 * address and paid out verbatim.
 */
export function isSilentPaymentAddress(address: string | undefined, network: bitcoin.Network): boolean {
  if (!address) return false;
  try {
    decodeSilentPaymentAddress(address, network);
    return true;
  } catch {
    return false;
  }
}

/**
 * The outpoint BIP-352 keys the input hash on: the lexicographically smallest of
 * `reverse(txid) || vout` (vout little-endian) across every input.
 */
export function findSmallestOutpoint(inputs: Outpoint[]): Outpoint {
  if (inputs.length === 0) throw new Error('Cannot compute the silent payment input hash with no inputs');

  const serialise = (o: Outpoint) => {
    const buf = Buffer.alloc(4);
    buf.writeUInt32LE(o.vout);
    return Buffer.concat([Buffer.from(o.txid, 'hex').reverse(), buf]);
  };

  return [...inputs].sort((a, b) => Buffer.compare(serialise(a), serialise(b)))[0];
}

/**
 * Turn a BIP-352 output key into a spendable address. `createOutputs` names the field `script`
 * but hands back a 33-byte compressed pubkey, not a scriptPubKey — the taproot output key is
 * already final, so it goes in as `pubkey` rather than `internalPubkey` (no extra tweak).
 */
function outputKeyToTaprootAddress(compressedKey: Uint8Array, network: bitcoin.Network): string {
  const xOnly = Buffer.from(compressedKey.subarray(1, 33));
  const { address } = bitcoin.payments.p2tr({ pubkey: xOnly, network });
  if (!address) throw new Error('Could not derive a taproot address for a silent payment output');
  return address;
}

/**
 * Replace every silent-payment target with the taproot address it resolves to, leaving other
 * targets untouched and in place.
 *
 * The index bookkeeping mirrors `createOutputs`: it buckets recipients by scan key into a Map
 * and emits each bucket in turn, so flattening the same buckets built in the same recipient
 * order reproduces its output ordering exactly (JS Maps iterate in insertion order, per spec).
 * That is a coupling to the library's iteration, so it is checked rather than trusted — the
 * count and the per-output value are both verified below, and `tests/unit/sp-builder.test.ts`
 * pins the ordering for multi-recipient and shared-scan-key cases. A mismatch throws instead of
 * paying the wrong address.
 */
export function resolveSilentPaymentTargets<T extends SilentPaymentTarget>(
  targets: T[],
  inputs: Outpoint[],
  inputPrivateKeys: PrivateKey[],
  network: bitcoin.Network,
): T[] {
  const spIndices = targets.map((t, i) => (isSilentPaymentAddress(t.address, network) ? i : -1)).filter(i => i !== -1);
  if (spIndices.length === 0) return targets;

  const recipients: RecipientAddress[] = [];
  // scan key hex -> the original target indices paying to it, in recipient order
  const groups = new Map<string, number[]>();

  for (const idx of spIndices) {
    const target = targets[idx];
    if (target.value === undefined || target.value === null) {
      throw new Error(`Silent payment output to ${target.address} is missing a value`);
    }
    recipients.push({ address: target.address!, amount: target.value });

    const { scanKey } = decodeSilentPaymentAddress(target.address!, network);
    const scanKeyHex = Buffer.from(scanKey).toString('hex');
    const bucket = groups.get(scanKeyHex);
    if (bucket) bucket.push(idx);
    else groups.set(scanKeyHex, [idx]);
  }

  const outputs = createOutputs(inputPrivateKeys, findSmallestOutpoint(inputs), recipients, network);
  const orderedIndices = [...groups.values()].flat();

  if (outputs.length !== orderedIndices.length) {
    throw new Error(
      `Silent payment builder produced ${outputs.length} outputs for ${orderedIndices.length} recipients; refusing to guess which is which`,
    );
  }

  const resolved = [...targets];
  outputs.forEach((output, i) => {
    const targetIndex = orderedIndices[i];
    // Cross-check the permutation: the amount travels through createOutputs untouched, so a
    // mismatch means our reconstructed ordering disagrees with the library's.
    if (output.value !== targets[targetIndex].value) {
      throw new Error('Silent payment output ordering does not match the requested recipients; refusing to build the transaction');
    }
    resolved[targetIndex] = {
      ...targets[targetIndex],
      address: outputKeyToTaprootAddress(output.script, network),
    };
  });

  return resolved;
}
