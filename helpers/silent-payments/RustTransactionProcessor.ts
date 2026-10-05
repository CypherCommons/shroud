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
      const result: RustBatchScanResult = spScanTransactions(this.scanPrivkeyHex, this.spendPubkeysHex, transactions);

      console.log(
        `[RustTransactionProcessor] Scanned ${result.transactionsScanned} txs, ` +
          `${result.outputsScanned} outputs, found ${result.matchedUtxos.length} matches`,
      );

      return result.matchedUtxos.map(utxo => this.convertToSilentPaymentUTXO(utxo));
    } catch (error) {
      console.error('[RustTransactionProcessor] Batch processing error:', error);
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
