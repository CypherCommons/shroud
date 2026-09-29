import { crypto } from 'bitcoinjs-lib';

import type { SpentIndexBlock } from './types';

export type Outpoint = { txid: string; vout: number };

/**
 * BlindBit/spdk spent index entry: sha256(txid || vout || blockhash)[:8], txid and blockhash in
 * internal byte order, vout u32 LE. Must stay byte-identical to the indexer's spentOutpointHash.
 */
export function outpointShortHash(txid: string, vout: number, blockHash: string): string {
  const buf = Buffer.alloc(68);
  Buffer.from(txid, 'hex').reverse().copy(buf, 0);
  buf.writeUInt32LE(vout, 32);
  Buffer.from(blockHash, 'hex').reverse().copy(buf, 36);
  return Buffer.from(crypto.sha256(buf)).subarray(0, 8).toString('hex');
}

/** Which of our outpoints each block spends. Matching is local, so outpoints never leave the device. */
export function matchSpent<T extends Outpoint>(outpoints: T[], blocks: SpentIndexBlock[]): Map<number, T[]> {
  const matches = new Map<number, T[]>();
  if (outpoints.length === 0) return matches;

  for (const block of blocks) {
    const spent = new Set<string>();
    for (let i = 0; i < block.hashes.length; i += 16) spent.add(block.hashes.slice(i, i + 16));

    const hits = outpoints.filter(o => spent.has(outpointShortHash(o.txid, o.vout, block.blockHash)));
    if (hits.length > 0) matches.set(block.height, hits);
  }
  return matches;
}
