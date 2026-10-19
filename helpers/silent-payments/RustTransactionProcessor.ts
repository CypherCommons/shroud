import { Buffer } from 'buffer';
import * as bitcoin from 'bitcoinjs-lib';
import {
  getScanPrivateKey,
  getSpendPublicKey,
  getSilentPaymentAddress,
  getSilentPaymentChangeSpendPublicKey,
} from './SilentPaymentKeyDerivation';
import { IndexerTransaction, SilentPaymentUTXO } from './types';
import { spScanTransactions, RustMatchedUTXO, RustBatchScanResult } from '../../modules/RustJsiBridge';
import { hexToUint8Array } from '../../modules/uint8array-extras';
import type { NetworkConfig } from '../../modules/network';

// Transactions per JSI call. The call is synchronous and holds the JS thread for its whole run, so taps,
// timers and JS-driven animation wait on it: a window of tens of thousands of transactions froze the
// app for seconds. At the ~30k tx/s in RUST_INTEGRATION.md, 1000 is ~35ms, short enough to go unnoticed.
export const SCAN_SLICE_SIZE = 1000;

// How long slices may run back to back before the scan yields. A yield costs up to a frame on iOS, where
// timers under 18ms wait for the next display frame (RCTTiming), so yielding after every slice left a
// fast device idle about as long as it scanned; a slow device's slice takes this long anyway.
export const SCAN_YIELD_AFTER_MS = 30;

// A macrotask: microtasks (and the setImmediate shim, built on them in bridgeless RN) all run before the
// runtime gets back to touches, timers and rendering.
const yieldToEventLoop = () => new Promise<void>(resolve => setTimeout(resolve, 0));

export class RustTransactionProcessor {
  private scanPrivkeyHex: string;
  /** Main spend pubkey plus the label-0 (change) spend pubkey — the scanner tries both. */
  private spendPubkeysHex: string[];
  private silentPaymentAddress: string;
  private network: NetworkConfig;

  constructor(seed: Buffer, network: NetworkConfig) {
    this.network = network;
    this.scanPrivkeyHex = Buffer.from(getScanPrivateKey(seed, network)).toString('hex');
    this.spendPubkeysHex = [
      Buffer.from(getSpendPublicKey(seed, network)).toString('hex'),
      Buffer.from(getSilentPaymentChangeSpendPublicKey(seed, network)).toString('hex'),
    ];
    this.silentPaymentAddress = getSilentPaymentAddress(seed, network);
  }

  private convertToSilentPaymentUTXO(rustUtxo: RustMatchedUTXO): SilentPaymentUTXO {
    return {
      txid: rustUtxo.txid,
      vout: rustUtxo.vout,
      value: rustUtxo.value,
      height: rustUtxo.height,
      address: bitcoin.payments.p2tr({
        pubkey: hexToUint8Array(rustUtxo.pubKey),
        network: this.network.bitcoinjs,
      }).address!,

      // sp specific fields
      // Always the main address, including for label-0 change: which spend key a UTXO
      // belongs to is derived from `pubKey`/`tweak` at spend time, and showing the user a
      // label-0 address they never published is meaningless.
      silentPaymentAddress: this.silentPaymentAddress,
      pubKey: rustUtxo.pubKey,
      tweak: hexToUint8Array(rustUtxo.tweakHex),
      blockHash: rustUtxo.blockHash,
      isSpent: rustUtxo.isSpent,
      blockTime: rustUtxo.blockTime,
    };
  }

  async processBatch(transactions: IndexerTransaction[], cancelScanCallback?: () => boolean): Promise<SilentPaymentUTXO[]> {
    if (transactions.length === 0) {
      return [];
    }

    if (cancelScanCallback?.()) {
      return [];
    }

    try {
      const matched: RustMatchedUTXO[] = [];
      let transactionsScanned = 0;
      let outputsScanned = 0;

      let holdingSince = Date.now();
      for (let start = 0; start < transactions.length; start += SCAN_SLICE_SIZE) {
        if (start > 0) {
          if (Date.now() - holdingSince >= SCAN_YIELD_AFTER_MS) {
            await yieldToEventLoop();
            holdingSince = Date.now();
          }
          // Thrown rather than returning what's found so far: once this resolves the caller marks the
          // whole window scanned, so the slices not yet scanned would be skipped for good.
          if (cancelScanCallback?.()) {
            throw new Error('SCAN_CANCELLED');
          }
        }

        const result: RustBatchScanResult = spScanTransactions(
          this.scanPrivkeyHex,
          this.spendPubkeysHex,
          transactions.slice(start, start + SCAN_SLICE_SIZE),
        );
        transactionsScanned += result.transactionsScanned;
        outputsScanned += result.outputsScanned;
        matched.push(...result.matchedUtxos);
      }

      console.log(
        `[RustTransactionProcessor] Scanned ${transactionsScanned} txs, ${outputsScanned} outputs, found ${matched.length} matches`,
      );

      return matched.map(utxo => this.convertToSilentPaymentUTXO(utxo));
    } catch (error: any) {
      if (error?.message !== 'SCAN_CANCELLED') {
        console.error('[RustTransactionProcessor] Batch processing error:', error);
      }
      throw error;
    }
  }

  clear(): void {
    // Note: this only drops our references. JS strings are immutable, so the original
    // bytes stay wherever the engine put them until GC — this is not a secure wipe.
    this.scanPrivkeyHex = '';
    this.spendPubkeysHex = [];
    this.silentPaymentAddress = '';
  }
}

export function createTransactionProcessor(seed: Buffer, network: NetworkConfig): RustTransactionProcessor {
  return new RustTransactionProcessor(seed, network);
}
