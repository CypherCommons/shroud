import BigNumber from 'bignumber.js';
import * as bip39 from 'bip39';
import { Buffer } from 'buffer';
import { ECPairFactory } from 'ecpair';
import { AbstractHDElectrumWallet } from './abstract-hd-electrum-wallet.ts';
import * as Electrum from '../../modules/Electrum';
import { getDefaultIndexer, RANGE_BATCH_SIZE, SilentPaymentIndexer } from '../../modules/SilentPaymentIndexer';
import { checkedThrough, matchSpent } from '../../helpers/silent-payments/spentIndex';
import type { SpentIndexBlock } from '../../helpers/silent-payments/types';
import ecc from '../../modules/noble_ecc';
import { calculateSumOfPrivateKeys, createInputHash, scanOutputs, type PrivateKey } from '@silent-pay/core';
import {
  getSilentPaymentAddress,
  getSilentPaymentChangeAddress,
  getScanPrivateKey,
  getSpendPrivateKey,
  getSpendPublicKey,
  getSilentPaymentChangeSpendPrivateKey,
  getSilentPaymentChangeSpendPublicKey,
  getSilentPaymentChangeLabelMap,
  SP_CHANGE_LABEL,
  RustTransactionProcessor,
  createTransactionProcessor,
  type IndexerTransaction,
  type SilentPaymentUTXO,
  type SilentPaymentUTXOSerializable,
  type ScanProgressCallback,
  type ScanStateInfo,
  type ScanStatus,
  IDLE_SCAN_STATE,
  type IScannableWallet,
  isSilentPaymentAddress,
  findSmallestOutpoint,
  resolveSilentPaymentTargets,
} from '../../helpers/silent-payments';
import { clampBirthHeight } from '../../modules/constants';
import { normaliseStoredNetworkId } from './abstract-wallet';
import { CreateTransactionResult, CreateTransactionTarget, CreateTransactionUtxo, Transaction, Utxo } from './types.ts';
import * as bitcoin from 'bitcoinjs-lib';
import { HDTaprootWallet } from './hd-taproot-wallet.ts';

const ECPair = ECPairFactory(ecc);

// Psbt validators receive (pubkey, msghash, signature); ecc.verifySchnorr expects (msghash, pubkey, signature)
const verifySchnorrSig = (pubkey: Uint8Array, msghash: Uint8Array, signature: Uint8Array): boolean =>
  ecc.verifySchnorr!(msghash, pubkey, signature);

/** A spend keypair a silent payment output can belong to (main, or label-0 change). */
interface SpendKeyPair {
  spendPriv: Uint8Array;
  spendPub: Uint8Array;
}

// Minimum gap between scan-progress state emissions, to avoid flooding React with re-renders.
const SCAN_PROGRESS_THROTTLE_MS = 500;
// Number of recent progress samples kept for the windowed ETA throughput estimate.
const SCAN_ETA_ROLLING_WINDOW = 10;
// Consecutive failed birth-height lookups before we stop deferring and scan from the fallback height.
const BIRTH_RESOLUTION_MAX_ATTEMPTS = 3;
const POLLING_INTERVAL_MS = 30000;
// Already-checked blocks whose spent index is read again on every sync, in case a reorg replaced them.
const SPENT_RECHECK_DEPTH = 6;

type UpdateBirthHeightOptions = { resetScan?: boolean; pendingTimestamp?: number | null };

export type OwnedOutput = {
  vout: number;
  value: number; // sats
  kind: 'silent-payment' | 'regular';
  address?: string; // regular only
  // regular: an internal (change) chain address. silent-payment: a label-0 change match.
  // Either way, it's our own change, not a payment from someone else.
  isChange?: boolean;
};

export type ScanByTxidResult = {
  found: boolean;
  outputs: OwnedOutput[];
  totalValue: number;
  confirmations: number;
  // True when both the SP and regular branches threw, as opposed to running cleanly and finding
  // nothing — lets the caller tell "couldn't check" apart from "checked, no payment there".
  bothBranchesFailed: boolean;
};

// A regular output matched against this wallet's addresses, plus the derivation index needed to
// advance the discovery frontier. Internal handoff between detectRegularOutputs and
// ingestRegularOutputs only — never returned from scanByTxid, so OwnedOutput itself stays free of
// wallet-internal detail.
type RegularOutputMatch = OwnedOutput & { index: number };

export class HDSilentPaymentsWallet extends HDTaprootWallet implements IScannableWallet {
  static readonly type = 'HDSilentPaymentsWallet';
  static readonly typeReadable = 'HD Silent Payments';
  static readonly derivationPath = "m/86'/0'/0'";
  // @ts-ignore: override
  public readonly type = HDSilentPaymentsWallet.type;
  // @ts-ignore: override
  public readonly typeReadable = HDSilentPaymentsWallet.typeReadable;

  private cachedSeed: Buffer | null = null;
  private spendKeyCandidates: SpendKeyPair[] | null = null;
  private transactionProcessor: RustTransactionProcessor | null = null;
  private lastScannedBlock: number = 0;
  // Spent index checked through this height. null on wallets from before spend detection, which
  // need a one-off catch-up pass because the forward scan never revisits old blocks.
  private _spentCheckedHeight: number | null = null;
  // 0 means "not set yet"; the per-network activation height is applied by
  // `getEffectiveBirthHeight`. Deliberately *not* initialised from the network here: on
  // deserialization this field initialiser runs before `fromJson` has restored `networkId`, so
  // reading the network at this point would use whichever chain happens to be selected.
  private _birthHeight: number = 0;
  private _birthTimestamp: number | null = null; // set when indexer is unreachable, resolved to height on next scan
  private _birthResolutionFailures: number = 0; // consecutive failed attempts to resolve _birthTimestamp
  private spUTXOsCache: SilentPaymentUTXO[] | null = null;
  private activeScanPromise: Promise<number> | null = null;
  private cancelScanCallbackScan: boolean = false;
  private pollingIntervalId: NodeJS.Timeout | null = null;
  private isPollingActive: boolean = false;
  private onBalanceChangeCallback: (() => void) | null = null;
  private onPersistCallback: (() => void) | null = null;
  private _sp_spending_txs: Transaction[] = [];
  private _sp_pending_inputs: Set<string> = new Set(); // "txid:vout"

  private _scanState: ScanStateInfo = IDLE_SCAN_STATE;
  private _scanPaused: boolean = false;
  private _scanResumeResolver: (() => void) | null = null;
  private _scanResumePromise: Promise<void> | null = null;
  private _lastProgressEmitTime: number = 0;
  // rolling window of {wall-clock time, cumulative percentComplete} samples, used for ETA
  private _scanSamples: { t: number; percent: number }[] = [];
  private _scanStartTime: number = 0;
  private _onScanStateChangeCallback: ((state: ScanStateInfo) => void) | null = null;

  // never written to disk and ignored by fromJson. _utxo is rebuilt from _utxos_serializable,
  // everything else is in-memory only
  private static readonly NON_PERSISTED_KEYS: ReadonlySet<string> = new Set([
    'cachedSeed',
    'spendKeyCandidates',
    'transactionProcessor',
    'spUTXOsCache',
    'activeScanPromise',
    'cancelScanCallbackScan',
    'pollingIntervalId',
    'isPollingActive',
    'onBalanceChangeCallback',
    'onPersistCallback',
    '_scanState',
    '_scanPaused',
    '_scanResumeResolver',
    '_scanResumePromise',
    '_lastProgressEmitTime',
    '_scanSamples',
    '_scanStartTime',
    '_onScanStateChangeCallback',
    '_utxo',
  ]);

  setOnBalanceChangeCallback(callback: (() => void) | null): void {
    this.onBalanceChangeCallback = callback;
  }

  setOnPersistCallback(callback: (() => void) | null): void {
    this.onPersistCallback = callback;
  }

  setOnScanStateChangeCallback(callback: ((state: ScanStateInfo) => void) | null): void {
    this._onScanStateChangeCallback = callback;
  }

  getScanState(): ScanStateInfo {
    return { ...this._scanState, lastScannedBlock: this.lastScannedBlock };
  }

  pauseScan(): void {
    if (!this._scanPaused && this.activeScanPromise !== null) {
      this._scanPaused = true;
      this._scanResumePromise = new Promise<void>(resolve => {
        this._scanResumeResolver = resolve;
      });
      this._emitScanState('paused');
    }
  }

  resumeScan(): void {
    if (this._scanPaused) {
      this._scanPaused = false;
      this._scanSamples = [];
      this._scanResumeResolver?.();
      this._scanResumeResolver = null;
      this._scanResumePromise = null;
      if (this.activeScanPromise !== null) {
        this._emitScanState('scanning');
      }
    }
  }

  private _emitScanState(status: ScanStatus, overrides?: Partial<ScanStateInfo>): void {
    this._scanState = { ...this._scanState, status, ...overrides, lastScannedBlock: this.lastScannedBlock };
    this._onScanStateChangeCallback?.(this._scanState);
  }

  private async _waitIfPaused(): Promise<void> {
    if (this._scanPaused && this._scanResumePromise) {
      await this._scanResumePromise;
    }
  }

  static fromMnemonic(mnemonic: string, passphrase?: string): HDSilentPaymentsWallet {
    const wallet = new HDSilentPaymentsWallet();
    wallet.setSecret(mnemonic);
    if (passphrase) wallet.setPassphrase(passphrase);
    return wallet;
  }

  // SP wallets always derive at the BIP-86 default; moving off it silently changes every
  // address the wallet has ever shown, so this is a hard error rather than a no-op override.
  setDerivationPath(path: string): never {
    throw new Error(`HDSilentPaymentsWallet is locked to ${HDSilentPaymentsWallet.derivationPath}; refusing to set it to ${path}`);
  }

  static fromJson(obj: string): HDSilentPaymentsWallet {
    const data = JSON.parse(obj);
    const wallet = new HDSilentPaymentsWallet();

    // `new` stamped the wallet with whichever chain is selected right now. Pin it to the stored
    // one before the copy loop, so nothing computed from `networkId` can inherit the ambient
    // chain. Wallets stored before multi-network support carry no `networkId` and are all
    // mainnet — see `normaliseStoredNetworkId`.
    wallet.networkId = normaliseStoredNetworkId(data.networkId);

    for (const key of Object.keys(data)) {
      if (key === '_utxos_serializable') {
        const serializable = data[key] || [];
        wallet._utxo = serializable.map((utxo: SilentPaymentUTXOSerializable) => ({
          ...utxo,
          tweak: new Uint8Array(Buffer.from(utxo.tweakHex, 'hex')),
        }));
      } else if (key === 'lastScannedBlock') {
        wallet.lastScannedBlock = data[key] || 0;
      } else if (key === '_birthHeight') {
        wallet._birthHeight = data[key] || 0;
      } else if (key === '_birthTimestamp') {
        wallet._birthTimestamp = data[key] ?? null;
      } else if (key === '_sp_spending_txs') {
        wallet._sp_spending_txs = data[key] || [];
      } else if (key === '_sp_pending_inputs') {
        wallet._sp_pending_inputs = new Set(data[key] || []);
      } else if (
        key !== 'networkId' && // resolved above; the raw value may be unrecognised
        !HDSilentPaymentsWallet.NON_PERSISTED_KEYS.has(key)
      ) {
        (wallet as any)[key] = data[key];
      }
    }

    if (!(wallet._sp_pending_inputs instanceof Set)) {
      wallet._sp_pending_inputs = new Set();
    }

    // Anything the constructor defaulted from the ambient chain and the blob did not override has
    // to be recomputed for the stored one — here, the derivation path.
    if (data._derivationPath === undefined) wallet.applyNetworkDefaults();

    return wallet;
  }

  /** Plain-object form written to storage: serializable fields only, no runtime state. */
  toPersistable(): Record<string, unknown> {
    const obj: Record<string, unknown> = { ...(this as any) };
    for (const k of HDSilentPaymentsWallet.NON_PERSISTED_KEYS) delete obj[k];
    return obj;
  }

  prepareForSerialization(): void {
    super.prepareForSerialization();

    // IMPORTANT: serialize ALL SP UTXOs (both spent and unspent)
    // we need spent UTXOs for transaction history and value calculations
    const allSpUtxos = this._utxo.filter((u): u is SilentPaymentUTXO => 'tweak' in u && u.tweak instanceof Uint8Array);

    (this as any)._utxos_serializable = allSpUtxos.map((utxo): SilentPaymentUTXOSerializable => {
      const { tweak, ...rest } = utxo;
      return {
        ...rest,
        tweakHex: Buffer.from(tweak).toString('hex'),
      };
    });

    (this as any).lastScannedBlock = this.lastScannedBlock;
    (this as any)._spentCheckedHeight = this._spentCheckedHeight;
    (this as any)._birthHeight = this._birthHeight;
    (this as any)._birthTimestamp = this._birthTimestamp;
    (this as any)._sp_spending_txs = this._sp_spending_txs;
    (this as any)._sp_pending_inputs = Array.from(this._sp_pending_inputs);
  }

  private getSilentPaymentUTXOs(): SilentPaymentUTXO[] {
    if (this.spUTXOsCache !== null) {
      return this.spUTXOsCache;
    }

    this.spUTXOsCache = this._utxo.filter((u): u is SilentPaymentUTXO => 'tweak' in u && u.tweak instanceof Uint8Array);

    return this.spUTXOsCache;
  }

  private invalidateUTXOCache(): void {
    this.spUTXOsCache = null;
  }

  private addUTXO(utxo: SilentPaymentUTXO): boolean {
    const key = `${utxo.txid}:${utxo.vout}`;
    const existing = this._utxo.find(u => `${u.txid}:${u.vout}` === key) as SilentPaymentUTXO | undefined;

    if (existing) {
      // The post-broadcast scan stores a placeholder with height 0 and no block hash.
      // Reconcile it when the indexer later returns the confirmed record, otherwise the
      // placeholder metadata sticks forever.
      if (existing.height === 0 && utxo.height > 0) {
        existing.height = utxo.height;
        existing.blockHash = utxo.blockHash;
        existing.blockTime = utxo.blockTime;
        this.invalidateUTXOCache();
      }
      return false;
    }

    this._utxo.push(utxo);
    this.invalidateUTXOCache();
    return true;
  }

  private markUTXOAsSpent(txid: string, vout: number): boolean {
    const utxo = this._utxo.find(u => u.txid === txid && u.vout === vout) as SilentPaymentUTXO | undefined;

    if (!utxo) {
      console.warn(`[SP] markUTXOAsSpent: UTXO not found ${txid}:${vout}`);
      return false;
    }

    if (!('tweak' in utxo)) {
      console.warn(`[SP] markUTXOAsSpent: Not an SP UTXO ${txid}:${vout}`);
      return false;
    }

    if (utxo.isSpent) {
      return false;
    }

    utxo.isSpent = true;
    this.invalidateUTXOCache();

    this.onBalanceChangeCallback?.();
    this.onPersistCallback?.();

    return true;
  }

  private ensurePendingInputsInitialized(): void {
    if (!this._sp_pending_inputs || !(this._sp_pending_inputs instanceof Set)) {
      this._sp_pending_inputs = new Set();
    }
  }

  private releaseUTXOsFromTx(hex: string): number {
    this.ensurePendingInputsInitialized();
    try {
      const tx = bitcoin.Transaction.fromHex(hex);
      let releasedCount = 0;

      for (const input of tx.ins) {
        const txid = Buffer.from(input.hash).reverse().toString('hex');
        const vout = input.index;
        const inputKey = `${txid}:${vout}`;

        if (this._sp_pending_inputs.delete(inputKey)) {
          releasedCount++;
        }
      }

      return releasedCount;
    } catch (error) {
      console.error('[SP] Error parsing transaction hex in releaseUTXOsFromTx:', error);
      return 0;
    }
  }

  private ensureTransactionProcessor(): void {
    if (this.transactionProcessor !== null) return;

    const seed = this.getSeed();
    this.transactionProcessor = createTransactionProcessor(seed, this.getNetworkConfig());
  }

  getSilentPaymentAddress(): string | null {
    const seed = this.getSeed();
    return getSilentPaymentAddress(seed, this.getNetworkConfig());
  }

  getSilentPaymentChangeAddress(): string {
    const seed = this.getSeed();
    return getSilentPaymentChangeAddress(seed, this.getNetworkConfig());
  }

  /**
   * The change address that `createTransaction` will actually use for these UTXOs.
   *
   * Only `createSPTransaction` can consume a silent payment change address — the parent
   * builder feeds change straight to `psbt.addOutput`, which cannot encode an `sp1` address.
   * So the label-0 address is only valid when every selected UTXO is SP, which is exactly
   * the condition that routes to the SP builder.
   *
   * Callers that need the change address up front (e.g. to filter it out of a recipient
   * list) must use this rather than deciding for themselves.
   */
  getChangeAddressForUtxos(utxos: CreateTransactionUtxo[], fallbackChangeAddress: string): string {
    const allSp = utxos.length > 0 && utxos.every(u => 'tweak' in u && u.tweak instanceof Uint8Array);
    return allSp ? this.getSilentPaymentChangeAddress() : fallbackChangeAddress;
  }

  getSpendPrivateKey(): Uint8Array {
    const seed = this.getSeed();
    return getSpendPrivateKey(seed, this.getNetworkConfig());
  }

  getSpendPublicKey(): Uint8Array {
    const seed = this.getSeed();
    return getSpendPublicKey(seed, this.getNetworkConfig());
  }

  /** Every spend key this wallet can own an output under: the main one and label-0 change. */
  private getSpendKeyCandidates(): SpendKeyPair[] {
    if (!this.spendKeyCandidates) {
      const seed = this.getSeed();
      const network = this.getNetworkConfig();
      this.spendKeyCandidates = [
        { spendPriv: getSpendPrivateKey(seed, network), spendPub: getSpendPublicKey(seed, network) },
        {
          spendPriv: getSilentPaymentChangeSpendPrivateKey(seed, network),
          spendPub: getSilentPaymentChangeSpendPublicKey(seed, network),
        },
      ];
    }
    return this.spendKeyCandidates;
  }

  /**
   * Pick the spend key that actually owns this UTXO.
   *
   * A UTXO is either a normal SP receive (main spend key) or our own label-0 change
   * (labeled spend key). This is derived rather than remembered: exactly one of
   * `B_main + tweak` and `B_change + tweak` reproduces the output key, so the answer
   * verifies itself and cannot drift with stale persisted metadata.
   */
  private resolveSpendKeys(spUtxo: SilentPaymentUTXO): SpendKeyPair {
    const outputKey = Buffer.from(spUtxo.pubKey, 'hex');
    if (outputKey.length !== 32) {
      throw new Error(`UTXO ${spUtxo.txid}:${spUtxo.vout}: pubKey must be 32-byte x-only, got ${outputKey.length}`);
    }

    for (const candidate of this.getSpendKeyCandidates()) {
      const tweakedPub = ecc.pointAddScalar(candidate.spendPub, spUtxo.tweak, true);
      if (tweakedPub && outputKey.equals(Buffer.from(tweakedPub.subarray(1, 33)))) {
        return candidate;
      }
    }

    throw new Error(
      `UTXO ${spUtxo.txid}:${spUtxo.vout}: no spend key reproduces the stored output key ` +
        `(tried the main key and label-${SP_CHANGE_LABEL} change) — its tweak or pubKey is wrong`,
    );
  }

  /**
   * True when an SP UTXO matches the label-0 change spend key rather than the main one — i.e.
   * it's our own change from an SP-to-SP send, not a payment from someone else. `resolveSpendKeys`
   * throws for a UTXO whose tweak doesn't reproduce either key, which shouldn't happen for
   * anything the scanner itself just matched; treated as "not change" rather than propagated,
   * since this only affects how scanByTxid labels the output for display.
   */
  private isLabelChangeOutput(spUtxo: SilentPaymentUTXO): boolean {
    try {
      const { spendPub } = this.resolveSpendKeys(spUtxo);
      const changeSpendPub = this.getSpendKeyCandidates()[1].spendPub;
      return Buffer.from(spendPub).equals(Buffer.from(changeSpendPub));
    } catch {
      return false;
    }
  }

  private getSeed(): Buffer {
    if (this.cachedSeed) return this.cachedSeed;

    const mnemonic = this.secret;
    this.cachedSeed = bip39.mnemonicToSeedSync(mnemonic, '');
    return this.cachedSeed;
  }

  private async processTransactions(transactions: IndexerTransaction[]): Promise<{ utxos: SilentPaymentUTXO[]; lastScannedBlock: number }> {
    this.ensureTransactionProcessor();

    const validTransactions = transactions.filter(tx => tx.scanTweak && tx.outputs && tx.outputs.length > 0);

    // Derive the highest block height from transactions
    const maxBlockHeight = validTransactions.reduce((max, tx) => Math.max(max, tx.blockHeight), this.lastScannedBlock);

    const newUTXOs = await this.transactionProcessor!.processBatch(validTransactions, () => this.cancelScanCallbackScan);

    return {
      utxos: newUTXOs,
      lastScannedBlock: maxBlockHeight,
    };
  }

  private commitUTXOs(utxos: SilentPaymentUTXO[], newLastScannedBlock: number): number {
    let addedCount = 0;

    for (const utxo of utxos) {
      if (this.addUTXO(utxo)) {
        addedCount++;
      }
    }

    // Always update lastScannedBlock to track progress, even if no UTXOs found
    if (newLastScannedBlock > this.lastScannedBlock) {
      this.lastScannedBlock = newLastScannedBlock;
    }

    // Trigger callbacks if state changed
    if (addedCount > 0) {
      this.onBalanceChangeCallback?.();
    }

    // Always persist when lastScannedBlock updates to track scan progress
    if (newLastScannedBlock > 0 && this.onPersistCallback) {
      this.onPersistCallback();
    }

    return addedCount;
  }

  cancelScan(): void {
    this.cancelScanCallbackScan = true;
    // unblock any pending pause so the scan loop can exit cleanly
    if (this._scanPaused) {
      this._scanPaused = false;
      this._scanResumeResolver?.();
      this._scanResumeResolver = null;
      this._scanResumePromise = null;
    }
    // NOTE: intentionally do NOT call disconnectIndexer() here. The indexer is an app-wide
    // singleton initialised once in App.tsx; nulling it on a per-wallet cancel/delete leaves
    // the whole app without an indexer until restart (e.g. a subsequent wallet import throws
    // "Silent Payment Indexer not initialized"). cancelScan stops the scan loop via the cancel
    // flag below; it must not tear down the shared indexer.
    this.stopPolling();
    this._emitScanState('idle', IDLE_SCAN_STATE);
  }

  isScanActive(): boolean {
    return this.activeScanPromise !== null;
  }

  /**
   * Cancel and wait for the scan loop to unwind. `cancelScan` only raises a flag that the loop
   * polls between batches, so callers that are about to repoint the indexer at another chain
   * must await this — otherwise an in-flight batch commits the previous chain's UTXOs after the
   * switch.
   */
  async cancelScanAndWait(): Promise<void> {
    this.cancelScan();
    try {
      await this.activeScanPromise;
    } catch (error) {
      console.warn('[SP] Scan ended with an error while being cancelled:', error);
    }
  }

  private startPolling(): void {
    if (this.isPollingActive) {
      return;
    }

    this.isPollingActive = true;

    this.pollingIntervalId = setInterval(async () => {
      try {
        await this.scanForPayments();
      } catch (error) {
        console.warn('[SP] Polling scan failed:', error instanceof Error ? error.message : error);
      }
    }, POLLING_INTERVAL_MS);
  }

  private stopPolling(): void {
    if (this.pollingIntervalId !== null) {
      clearInterval(this.pollingIntervalId);
      this.pollingIntervalId = null;
      this.isPollingActive = false;
    }
  }

  /**
   * Scan forward for silent payments (from wallet birth/last scan to latest block).
   * This is called when the user refreshes or opens the wallet.
   * Uses incremental scanning - only scans blocks since last scan.
   * Respects wallet birth height - will not scan blocks before the wallet was created.
   *
   * Thread-safe: If a scan is already in progress, returns the existing promise to avoid redundant work.
   * Can be cancelled using cancelScan() method.
   *
   * @param {ScanProgressCallback} onProgress - Optional callback for progress updates
   * @param {boolean} forceFullScan - Force a full scan ignoring lastScannedBlock (default: false)
   * @returns {Promise<number>} - Number of new UTXOs found
   */
  async scanForPayments(onProgress?: ScanProgressCallback, forceFullScan: boolean = false): Promise<number> {
    if (this.cancelScanCallbackScan) {
      return 0;
    }

    if (this.activeScanPromise !== null) {
      return this.activeScanPromise;
    }

    this.cancelScanCallbackScan = false;
    this.activeScanPromise = this.performScan(onProgress, forceFullScan);

    try {
      const result = await this.activeScanPromise;
      return result;
    } finally {
      this.activeScanPromise = null;
      // don't cancelScanCallbackScan here — if cancelScan() was called during this scan,
      // the flag must stay true so subsequent calls to scanForPayments() exit early.
    }
  }

  private async performScan(onProgress?: ScanProgressCallback, forceFullScan: boolean = false): Promise<number> {
    this._scanStartTime = Date.now();
    this._scanSamples = [];
    this._lastProgressEmitTime = 0;

    try {
      const indexer = getDefaultIndexer();
      const latestHeight = (await indexer.getLatestBlockHeight()).height;

      if (latestHeight <= 0) {
        throw new Error(`Invalid latest block height: ${latestHeight}`);
      }

      if (!(await this._resolvePendingBirthHeight(indexer, latestHeight))) {
        // birth height still unknown, so there is no correct range to scan yet. the next refresh retries.
        this._emitScanState('idle', IDLE_SCAN_STATE);
        return 0;
      }

      // After the pending-birth resolution above, which may have just moved `_birthHeight`.
      const effectiveBirthHeight = this.getEffectiveBirthHeight();

      let startHeight: number;
      const endHeight: number = latestHeight;

      if (!forceFullScan && this.lastScannedBlock > 0) {
        startHeight = this.lastScannedBlock + 1;

        // before the early return below, so a wallet that is already synced still catches up
        await this.catchUpSpentIndex(indexer, Math.min(this.lastScannedBlock, latestHeight), latestHeight);

        if (startHeight > latestHeight) {
          return 0;
        }
      } else {
        startHeight = effectiveBirthHeight;
        // this scan re-reads the spent index from the start, so it is the one that checks it
        this._spentCheckedHeight = startHeight - 1;
      }

      if (startHeight > endHeight) {
        return 0;
      }

      this._emitScanState('scanning', { startedAt: this._scanStartTime, progress: null, eta: null, etaComputedAt: null, error: null });

      let totalUTXOsAdded = 0;

      const wrappedProgress: ScanProgressCallback = async progress => {
        await this._waitIfPaused();
        if (this.activeScanPromise === null || this.cancelScanCallbackScan) return;

        this._scanSamples.push({ t: Date.now(), percent: progress.percentComplete });
        if (this._scanSamples.length > SCAN_ETA_ROLLING_WINDOW) {
          this._scanSamples.shift();
        }

        // Estimate ETA from the recent throughput (percent/ms) over the rolling window,
        // not a raw batch count: time spanned vs. percent gained between the oldest and
        // newest samples gives the current scan rate, which we extrapolate to 100%.
        let eta: number | null = null;
        let etaComputedAt: number | null = null;
        if (this._scanSamples.length >= 2) {
          const oldest = this._scanSamples[0];
          const newest = this._scanSamples[this._scanSamples.length - 1];
          const elapsedMs = newest.t - oldest.t;
          const percentGained = newest.percent - oldest.percent;
          if (elapsedMs > 0 && percentGained > 0) {
            const msPerPercent = elapsedMs / percentGained;
            const remainingPercent = 100 - progress.percentComplete;
            eta = Math.round(msPerPercent * remainingPercent);
            etaComputedAt = newest.t;
          }
        }

        const now = Date.now();
        const isComplete = progress.percentComplete >= 100;
        const statusChanged = this._scanState.status !== 'scanning';
        const throttleElapsed = now - this._lastProgressEmitTime >= SCAN_PROGRESS_THROTTLE_MS;

        if (isComplete || statusChanged || throttleElapsed) {
          this._lastProgressEmitTime = now;
          this._emitScanState('scanning', { progress, eta, etaComputedAt });
        }

        if (onProgress) {
          await onProgress(progress);
        }
      };

      await indexer.scanForwardWithCallback(
        startHeight,
        endHeight,
        async (transactions, rangeEnd, spentBlocks) => {
          if (this.cancelScanCallbackScan) {
            throw new Error('SCAN_CANCELLED');
          }

          await this._waitIfPaused();
          if (this.cancelScanCallbackScan) throw new Error('SCAN_CANCELLED');

          const result = await this.processTransactions(transactions);
          // rangeEnd, not the highest tx height: the whole range was queried, so it is all scanned
          const addedCount = this.commitUTXOs(result.utxos, Math.max(result.lastScannedBlock, rangeEnd));
          totalUTXOsAdded += addedCount;

          // after commitUTXOs, so a coin received and spent inside this range is caught
          if (spentBlocks) {
            this.applySpentIndex(spentBlocks, latestHeight);
            this.advanceSpentChecked(spentBlocks, rangeEnd);
          }

          return addedCount;
        },
        wrappedProgress,
        () => this.cancelScanCallbackScan,
      );

      this._emitScanState('idle', IDLE_SCAN_STATE);

      if (this.lastScannedBlock >= latestHeight && !this.isPollingActive && !this.cancelScanCallbackScan) {
        this.startPolling();
      }

      return totalUTXOsAdded;
    } catch (error: any) {
      if (error.message === 'SCAN_CANCELLED') {
        this._emitScanState('idle', IDLE_SCAN_STATE);
        return 0;
      }

      if (error.message?.includes('not initialized')) {
        this._emitScanState('error', { error: 'Silent Payment Indexer not initialized.' });
        throw new Error('Silent Payment Indexer not initialized. Please configure the indexer first.');
      }

      this._emitScanState('error', { error: error.message ?? 'Unknown scan error' });
      throw error;
    }
  }

  /**
   * dana's ownedOutpoints: unspent SP coins, plus the inputs of our own sends that are not confirmed
   * yet. Matching those inputs is how our own sends get confirmed.
   */
  private spentCheckOutpoints(): SilentPaymentUTXO[] {
    const pendingInputs = new Set(
      this._sp_spending_txs.filter(tx => !tx.blockhash).flatMap(tx => tx.inputs.map(i => `${i.txid}:${i.vout}`)),
    );
    return this.getSilentPaymentUTXOs().filter(u => !u.isSpent || pendingInputs.has(`${u.txid}:${u.vout}`));
  }

  private applySpentIndex(blocks: SpentIndexBlock[], tipHeight: number): void {
    const matches = matchSpent(this.spentCheckOutpoints(), blocks);
    for (const block of blocks) {
      const spent = matches.get(block.height);
      if (spent) this.applySpentOutpoints(block, spent, tipHeight);
    }
  }

  /**
   * dana's _onSyncResult, input half. A spend of one of our own recorded txs confirms it. Anything
   * else was spent by another wallet on this seed and is recorded as one outgoing tx per block.
   */
  private applySpentOutpoints(block: SpentIndexBlock, outpoints: SilentPaymentUTXO[], tipHeight: number): void {
    const confirm = (tx: Transaction) => {
      tx.blockhash = block.blockHash;
      tx.height = block.height;
      tx.blocktime = block.blockTime;
      tx.confirmations = Math.max(tipHeight - block.height + 1, 1);
    };

    const unknown: SilentPaymentUTXO[] = [];
    for (const utxo of outpoints) {
      const own = this._sp_spending_txs.find(tx => !tx.blockhash && tx.inputs.some(i => i.txid === utxo.txid && i.vout === utxo.vout));
      if (own) {
        confirm(own);
      } else if (this.markUTXOAsSpent(utxo.txid, utxo.vout)) {
        unknown.push(utxo);
      }
    }

    if (unknown.length > 0) {
      const txid = `unknown:${block.height}:${unknown[0].txid}:${unknown[0].vout}`;
      const tx: Transaction = {
        txid,
        hash: txid,
        version: 2,
        size: 0,
        vsize: 0,
        weight: 0,
        locktime: 0,
        value: -unknown.reduce((sum, u) => sum + u.value, 0),
        confirmations: 0,
        blockhash: '',
        time: block.blockTime,
        blocktime: block.blockTime,
        timestamp: block.blockTime,
        inputs: unknown.map(u => ({
          txid: u.txid,
          vout: u.vout,
          scriptSig: { asm: '', hex: '' },
          txinwitness: [],
          sequence: 0,
          addresses: [u.silentPaymentAddress || ''],
          value: u.value,
        })),
        outputs: [],
        external: true,
      };
      confirm(tx);
      this._sp_spending_txs.push(tx);
    }

    this.onPersistCallback?.();
    this.onBalanceChangeCallback?.();
  }

  /**
   * Moves `_spentCheckedHeight` forward over the heights `blocks` covers without a gap. A range
   * that does not start right after it, or a height the indexer has no entry for, leaves it where
   * it is, so the catch-up pass checks those blocks on a later sync instead of skipping them.
   */
  private advanceSpentChecked(blocks: SpentIndexBlock[], upTo: number): boolean {
    const from = (this._spentCheckedHeight ?? upTo) + 1;
    const checked = checkedThrough(blocks, from, upTo);
    if (checked < from) return false;
    this._spentCheckedHeight = checked;
    this.onPersistCallback?.();
    return checked === upTo;
  }

  /**
   * Spent-index-only pass over blocks the forward scan has already passed but whose spends were
   * not checked: wallets from before spend detection, and ranges the indexer had no spent index
   * for. Stops at the first gap and picks up from there on the next sync. Runs on every sync, so it
   * also re-reads the last SPENT_RECHECK_DEPTH checked blocks.
   */
  private async catchUpSpentIndex(indexer: SilentPaymentIndexer, upTo: number, tipHeight: number): Promise<void> {
    if (this._spentCheckedHeight !== null) {
      // a reorg can replace a checked block with one that spends our coins, and nothing else reads
      // a checked block again. a block that did not change matches nothing new
      const checked = this._spentCheckedHeight;
      const recheckFrom = Math.max(checked - SPENT_RECHECK_DEPTH + 1, 1);
      if (recheckFrom <= checked) {
        try {
          const { blocks } = await indexer.getSpentIndexByRange(recheckFrom, checked);
          this.applySpentIndex(blocks, tipHeight);
        } catch (error: any) {
          console.warn(`[SP] Spent index recheck of ${recheckFrom}-${checked} failed: ${error?.message ?? error}`);
        }
      }
    } else {
      // nothing was ever checked: start at the oldest coin that could still be unspent
      const heights = this.spentCheckOutpoints()
        .map(u => u.height)
        .filter(h => h > 0);
      this._spentCheckedHeight = (heights.length > 0 ? Math.min(...heights) : upTo + 1) - 1;
      this.onPersistCallback?.();
    }

    while (this._spentCheckedHeight < upTo) {
      await this._waitIfPaused();
      if (this.cancelScanCallbackScan) throw new Error('SCAN_CANCELLED');

      const rangeStart = this._spentCheckedHeight + 1;
      const rangeEnd = Math.min(rangeStart + RANGE_BATCH_SIZE - 1, upTo);
      let blocks: SpentIndexBlock[];
      try {
        ({ blocks } = await indexer.getSpentIndexByRange(rangeStart, rangeEnd));
      } catch (error: any) {
        console.warn(`[SP] Spent index catch-up stopped at ${rangeStart}: ${error?.message ?? error}`);
        return;
      }

      this.applySpentIndex(blocks, tipHeight);
      if (!this.advanceSpentChecked(blocks, rangeEnd)) return;
    }
  }

  /**
   * Answers "did this txid pay me?" by detecting owned outputs directly from the transaction,
   * on both the Silent Payment side (indexer) and the regular-address side (Electrum), then
   * merging what each side found. Detection never depends on the wallet already having synced
   * the paying address; the regular branch only triggers a wallet sync once it has confirmed
   * there's something to ingest.
   */
  async scanByTxid(txid: string): Promise<ScanByTxidResult> {
    let spOutputs: OwnedOutput[] = [];
    let spConfirmations = 0;
    let spFailed = false;
    try {
      const sp = await this.scanTxidForSilentPayment(txid);
      spOutputs = sp.outputs;
      spConfirmations = sp.confirmations;
    } catch (error) {
      spFailed = true;
      console.warn('[SP] scanByTxid: silent payment branch failed:', error);
    }

    let regularOutputs: OwnedOutput[] = [];
    let regularConfirmations: number | null = null;
    let regularFailed = false;
    try {
      // Sequential on purpose: this only calls fetchUtxo() (via ingestRegularOutputs) after the
      // SP branch above has finished committing, so its snapshot-restore of SP UTXOs can't race
      // a concurrent SP write.
      const detected = await this.detectRegularOutputs(txid);
      if (detected) {
        regularConfirmations = detected.confirmations;
        if (detected.outputs.length > 0) {
          await this.ingestRegularOutputs(detected.outputs);
          regularOutputs = detected.outputs.map(({ index, ...output }) => output);
        }
      }
    } catch (error) {
      regularFailed = true;
      console.warn('[regular] scanByTxid: regular payment branch failed:', error);
    }

    const merged = new Map<number, OwnedOutput>();
    for (const output of [...spOutputs, ...regularOutputs]) {
      merged.set(output.vout, output);
    }
    const outputs = Array.from(merged.values());
    const totalValue = outputs.reduce((sum, output) => sum + output.value, 0);
    // Prefer Electrum's real confirmations (the regular-branch lookup runs regardless of
    // ownership) over the SP branch's indexer-height-diff approximation.
    const confirmations = regularConfirmations ?? spConfirmations;

    return {
      found: outputs.length > 0,
      outputs,
      totalValue,
      confirmations,
      bothBranchesFailed: spFailed && regularFailed,
    };
  }

  private async scanTxidForSilentPayment(txid: string): Promise<{ outputs: OwnedOutput[]; confirmations: number }> {
    const indexer = getDefaultIndexer();
    const [response, tipResponse] = await Promise.all([indexer.getTransactionByTxid(txid), indexer.getLatestBlockHeight()]);
    const tx = response.transaction;

    const result = await this.processTransactions([tx]);

    // Deliberately not commitUTXOs(): this is a single-txid lookup, not a range scan, so it must
    // not move lastScannedBlock forward (that would let a later forward scan skip over blocks
    // that were never actually scanned) or persist when nothing new was found.
    let newlyAdded = false;
    for (const utxo of result.utxos) {
      if (this.addUTXO(utxo)) {
        newlyAdded = true;
      }
    }

    if (newlyAdded) {
      this.onBalanceChangeCallback?.();
      this.onPersistCallback?.();
    }

    const confirmations = tx.blockHeight > 0 ? Math.max(tipResponse.height - tx.blockHeight + 1, 0) : 0;

    return {
      outputs: result.utxos.map(utxo => ({
        vout: utxo.vout,
        value: utxo.value,
        kind: 'silent-payment' as const,
        isChange: this.isLabelChangeOutput(utxo),
      })),
      confirmations,
    };
  }

  /**
   * Looks the txid up directly on Electrum and checks each output's address against this
   * wallet's derived (external + change) addresses. Read-only: never touches wallet state.
   * Returns null only if Electrum doesn't know the txid at all.
   */
  private async detectRegularOutputs(txid: string): Promise<{ outputs: RegularOutputMatch[]; confirmations: number } | null> {
    const result = await Electrum.multiGetTransactionByTxid([txid], true);
    const tx = result[txid];
    if (!tx) return null;

    const outputs: RegularOutputMatch[] = [];
    for (const vout of tx.vout) {
      const address = vout.scriptPubKey?.addresses?.[0];
      if (!address) continue;
      const owned = this.findAddressIndex(address);
      if (!owned) continue;
      outputs.push({
        vout: vout.n,
        value: new BigNumber(vout.value).multipliedBy(100000000).toNumber(), // verbose value is BTC
        kind: 'regular',
        address,
        isChange: owned.internal,
        index: owned.index,
      });
    }

    return { outputs, confirmations: tx.confirmations };
  }

  /**
   * Brings detected regular outputs into the wallet: advances the discovery frontier past the
   * matched address(es), then runs the normal balance/tx/utxo sync so the payment shows up in
   * getTransactions() and becomes spendable.
   */
  private async ingestRegularOutputs(outputs: RegularOutputMatch[]): Promise<void> {
    for (const output of outputs) {
      if (output.isChange) {
        this.next_free_change_address_index = Math.max(this.next_free_change_address_index, output.index + 1);
      } else {
        this.next_free_address_index = Math.max(this.next_free_address_index, output.index + 1);
      }
    }

    // fetchUtxo() only queries addresses with a known balance, so fetchBalance() must run first.
    await super.fetchBalance();
    // super, not this.fetchTransactions(): the SP branch already ran earlier in this scanByTxid
    // call, so re-triggering scanForSilentPayments() here would just be a redundant SP scan.
    await super.fetchTransactions();
    await this.fetchUtxo();

    this.onBalanceChangeCallback?.();
    this.onPersistCallback?.();
  }

  async fetchUtxo(): Promise<void> {
    const spUtxos = this.getSilentPaymentUTXOs();

    try {
      await super.fetchUtxo();
    } catch (error) {
      console.warn('[SP] super.fetchUtxo failed:', error);
    } finally {
      // Restore SP UTXOs
      const existingKeys = new Set(this._utxo.map(u => `${u.txid}:${u.vout}`));
      let restoredCount = 0;

      for (const utxo of spUtxos) {
        const key = `${utxo.txid}:${utxo.vout}`;
        if (!existingKeys.has(key)) {
          this._utxo.push(utxo);
          restoredCount++;
        }
      }

      if (restoredCount > 0) {
        this.invalidateUTXOCache();
      }
    }
  }

  async fetchBalance(): Promise<void> {
    await super.fetchBalance();
  }

  async fetchTransactions(): Promise<void> {
    try {
      await super.fetchTransactions();
    } catch (regularError) {
      console.error('[SP] Error fetching regular transactions:', regularError);
    }

    this.scanForSilentPayments();
  }

  private async scanForSilentPayments(): Promise<void> {
    if (this.cancelScanCallbackScan) {
      return;
    }

    try {
      await this.scanForPayments();
    } catch (spError: any) {
      if (spError?.message !== 'SCAN_CANCELLED') {
        console.warn('[SP] Scan failed:', spError?.message || spError);
      }
    }
  }

  getUTXOs(): SilentPaymentUTXO[] {
    const allSpUtxos = this.getSilentPaymentUTXOs();
    const unspentUtxos = allSpUtxos.filter(u => !u.isSpent);
    return unspentUtxos;
  }

  /**
   * Get only regular (non-SP) UTXOs from the wallet.
   * Filters out Silent Payment UTXOs to avoid duplicates.
   */
  private getRegularUtxos(): Utxo[] {
    if (this._utxo.length === 0) {
      return this.getDerivedUtxoFromOurTransaction();
    }
    // Filter out SP UTXOs - they have a 'tweak' property
    return this._utxo.filter(u => !('tweak' in u));
  }

  /**
   * override parent's getUtxo() to include both regular UTXOs and SP UTXOs.
   * ensures coin control and transaction creation have access to all available UTXOs.
   * IMPORTANT: We separate regular and SP UTXOs to avoid duplicates.
   */
  getUtxo(respectFrozen = false): Utxo[] {
    const spUtxos = this.getUTXOs(); // unspent SP UTXOs only
    let regularUtxos = this.getRegularUtxos();

    if (!respectFrozen) {
      regularUtxos = regularUtxos.filter(({ txid, vout }) => !this.getUTXOMetadata(txid, vout).frozen);
    }

    // Combine regular UTXOs with SP UTXOs (no duplicates since they're from different sources)
    return [...regularUtxos, ...spUtxos];
  }

  getBalance(): number {
    const regularBalance = super.getBalance();
    // Only add SP balance - regular balance is already computed by parent
    const unspentSpUtxos = this.getUTXOs();
    const silentPaymentBalance = unspentSpUtxos.reduce((sum, utxo) => sum + utxo.value, 0);

    return regularBalance + silentPaymentBalance;
  }

  /**
   * Where scanning actually starts: the wallet's own birth height, floored at the chain's BIP-352
   * activation height. On mainnet that floor skips ~840k blocks predating the spec; the test
   * chains deliberately have no floor, so a fresh wallet there scans from genesis — see
   * `bip352ActivationHeight` in `modules/network.ts`.
   */
  getEffectiveBirthHeight(): number {
    return Math.max(this._birthHeight, this.getNetworkConfig().bip352ActivationHeight);
  }

  setBirthHeight(height: number): void {
    this.updateBirthHeight(height);
  }

  /**
   * Set the wallet's birth height. `pendingTimestamp` defers the real height to the first scan
   * that reaches the indexer; taking both here keeps them from being set in the wrong order.
   */
  updateBirthHeight(height: number, { resetScan = false, pendingTimestamp = null }: UpdateBirthHeightOptions = {}): void {
    if (!Number.isInteger(height) || height < 0) {
      throw new Error(`Invalid birth height: ${height}`);
    }

    this._birthHeight = height;
    this._birthTimestamp = pendingTimestamp;
    this._birthResolutionFailures = 0;

    if (resetScan) {
      this.lastScannedBlock = 0;
    }
  }

  getPendingBirthTimestamp(): number | null {
    return this._birthTimestamp;
  }

  /**
   * Turn a deferred birth timestamp into a real height now that the indexer is reachable.
   * Returns false when the height is still unknown and the caller must not scan.
   */
  private async _resolvePendingBirthHeight(indexer: SilentPaymentIndexer, latestHeight: number): Promise<boolean> {
    if (this._birthTimestamp === null) return true;

    try {
      const { blockHeight } = await indexer.getBlockHeightByTimestamp(this._birthTimestamp);
      if (!Number.isInteger(blockHeight)) {
        throw new Error(`Invalid block height for timestamp ${this._birthTimestamp}: ${blockHeight}`);
      }

      this.updateBirthHeight(clampBirthHeight(blockHeight, latestHeight, this.getNetworkConfig().bip352ActivationHeight), {
        resetScan: true,
      });
      this.onPersistCallback?.();
      return true;
    } catch (error) {
      this._birthResolutionFailures++;
      this.onPersistCallback?.();
      if (this._birthResolutionFailures < BIRTH_RESOLUTION_MAX_ATTEMPTS) {
        console.warn(
          `[SP] Birth height resolution failed (${this._birthResolutionFailures}/${BIRTH_RESOLUTION_MAX_ATTEMPTS}), skipping scan:`,
          error,
        );
        return false;
      }

      // stop deferring rather than leave the wallet permanently unscannable: pay the one-off cost
      // of scanning from whatever height we have (BIP-352 activation, at worst).
      console.warn('[SP] Giving up on birth height resolution, scanning from the fallback height:', error);
      this.updateBirthHeight(this._birthHeight, { resetScan: true });
      this.onPersistCallback?.();
      return true;
    }
  }

  getTransactions(): Transaction[] {
    const regularTransactions = super.getTransactions();

    // Include ALL UTXOs (both spent and unspent) so incoming SP transactions appear in the list
    const utxos = this.getSilentPaymentUTXOs();

    const txMap = new Map<string, SilentPaymentUTXO[]>();

    for (const utxo of utxos) {
      if (!txMap.has(utxo.txid)) {
        txMap.set(utxo.txid, []);
      }
      txMap.get(utxo.txid)!.push(utxo);
    }

    // Create incoming SP transactions (receiving payments)
    const spIncomingTransactions: Transaction[] = [];

    for (const [txid, utxoGroup] of txMap) {
      if (this._sp_spending_txs.some(tx => tx.txid === txid)) {
        continue;
      }
      const totalValue = utxoGroup.reduce((sum, utxo) => sum + utxo.value, 0);
      const firstUtxo = utxoGroup[0];

      spIncomingTransactions.push({
        txid,
        hash: txid,
        version: 2,
        size: 0,
        vsize: 0,
        weight: 0,
        locktime: 0,
        value: totalValue,
        confirmations: 7, // FIXME: dont assume stuff
        blockhash: firstUtxo.blockHash,
        time: firstUtxo.blockTime,
        blocktime: firstUtxo.blockTime,
        timestamp: firstUtxo.blockTime,
        inputs: [], // inputs are not tracked by the indexer
        outputs: utxoGroup.map((utxo, index) => ({
          value: utxo.value,
          n: utxo.vout,
          scriptPubKey: {
            asm: '',
            hex: utxo.pubKey,
            reqSigs: 1,
            type: 'witness_v1_taproot',
            addresses: [utxo.silentPaymentAddress || ''],
          },
        })),
      });
    }

    // Include spending transactions (when we spend SP UTXOs)
    // These have negative value since money is leaving our wallet
    // confirmations stored at confirm time go stale, so derive them from the scan tip. copies, so
    // memoized list rows see a new object when a send confirms
    const spendingTransactions = this._sp_spending_txs.map(tx =>
      tx.height ? { ...tx, confirmations: Math.max(this.lastScannedBlock - tx.height + 1, 1) } : tx,
    );
    const allTransactions = [...regularTransactions, ...spIncomingTransactions, ...spendingTransactions];

    allTransactions.sort((a, b) => {
      const timeA = a.timestamp || a.blocktime || 0;
      const timeB = b.timestamp || b.blocktime || 0;
      return timeB - timeA;
    });

    return allTransactions;
  }

  allowSend(): boolean {
    return true;
  }

  createTransaction(
    utxos: CreateTransactionUtxo[],
    targets: CreateTransactionTarget[],
    feeRate: number,
    changeAddress: string,
    sequence: number = AbstractHDElectrumWallet.finalRBFSequence,
    skipSigning = false,
    masterFingerprint: number = 0,
  ): CreateTransactionResult {
    if (targets.length === 0) throw new Error('No destination provided');
    if (utxos.length === 0) throw new Error('No UTXOs provided');

    const spUtxos: SilentPaymentUTXO[] = [];
    const regularUtxos: CreateTransactionUtxo[] = [];

    for (const utxo of utxos) {
      if ('tweak' in utxo && utxo.tweak instanceof Uint8Array) {
        spUtxos.push(utxo as SilentPaymentUTXO);
      } else {
        regularUtxos.push(utxo);
      }
    }

    // Case 1: Only SP UTXOs - use SP builder exclusively
    if (spUtxos.length > 0 && regularUtxos.length === 0) {
      return this.createSPTransaction(spUtxos, targets, feeRate, changeAddress, sequence, skipSigning);
    }

    // Case 2: Only regular UTXOs - delegate to parent
    if (spUtxos.length === 0 && regularUtxos.length > 0) {
      return super.createTransaction(regularUtxos, targets, feeRate, changeAddress, sequence, skipSigning, masterFingerprint);
    }

    // Case 3: Mixed UTXOs - not yet implemented
    throw new Error('Mixed UTXO spending (SP + regular) is not yet implemented. Please select only SP UTXOs or only regular UTXOs.');
  }

  private createSPTransaction(
    spUtxos: SilentPaymentUTXO[],
    targets: CreateTransactionTarget[],
    feeRate: number,
    changeAddress: string,
    sequence: number,
    skipSigning: boolean,
  ): CreateTransactionResult {
    if (targets.length === 0) throw new Error('No destination provided');

    const { inputs, outputs, fee } = this.coinselect(spUtxos as CreateTransactionUtxo[], targets, feeRate);
    const utxoMap = new Map(spUtxos.map(u => [`${u.txid}:${u.vout}`, u]));

    this.ensurePendingInputsInitialized();

    // Reserve UTXOs to prevent double-spend attempts
    const inputKeys = inputs.map(input => `${input.txid}:${input.vout}`);
    inputKeys.forEach(key => this._sp_pending_inputs.add(key));

    try {
      // Resolve each input's spend key once. `resolveSpendKeys` derives which key owns the
      // UTXO from its own tweak/pubKey, so it doubles as the check that the stored UTXO is
      // internally consistent before we build anything.
      const resolvedInputs = inputs.map(input => {
        const spUtxo = utxoMap.get(`${input.txid}:${input.vout}`);
        if (!spUtxo) {
          throw new Error(`UTXO not found: ${input.txid}:${input.vout}`);
        }

        const { spendPriv, spendPub } = this.resolveSpendKeys(spUtxo);
        const tweakedPriv = ecc.privateAdd(spendPriv, spUtxo.tweak);
        if (!tweakedPriv) {
          throw new Error(`UTXO ${input.txid}:${input.vout}: failed to compute tweaked private key`);
        }

        return { input, spendPub, tweakedPriv, outputKey: Buffer.from(spUtxo.pubKey, 'hex') };
      });

      const network = this.getNetworkConfig().bitcoinjs;
      const psbt = new bitcoin.Psbt({ network });

      // add taproot inputs with tweaked public keys
      resolvedInputs.forEach(({ input, spendPub, outputKey }) => {
        const witnessScript = Buffer.concat([
          Buffer.from([0x51, 0x20]), // OP_1 + PUSH32 (Taproot script)
          outputKey,
        ]);

        psbt.addInput({
          hash: input.txid,
          index: input.vout,
          sequence,
          witnessUtxo: {
            script: witnessScript,
            value: BigInt(input.value),
          },
          tapInternalKey: Buffer.from(spendPub.subarray(1, 33)),
        });
      });

      let finalOutputs = outputs.map(o => ({
        address: o.address || changeAddress,
        value: o.value,
      }));

      const hasSilentPaymentOutput = finalOutputs.some(o => isSilentPaymentAddress(o.address, network));
      if (hasSilentPaymentOutput) {
        // Every input here is a taproot SP spend, so all keys go in x-only and
        // `calculateSumOfPrivateKeys` negates the ones whose pubkey has an odd Y. Passing the
        // tweaked private keys straight through also drops a WIF encode/decode round-trip that
        // would otherwise need the network threaded into it.
        const inputPrivateKeys: PrivateKey[] = resolvedInputs.map(({ tweakedPriv }) => ({
          key: Buffer.from(tweakedPriv).toString('hex'),
          isXOnly: true,
        }));

        finalOutputs = resolveSilentPaymentTargets(
          finalOutputs,
          resolvedInputs.map(({ input }) => ({ txid: input.txid, vout: input.vout })),
          inputPrivateKeys,
          network,
        );
      }

      finalOutputs.forEach(output => {
        if (!output.address) {
          throw new Error('Transaction output is missing an address');
        }
        if (output.value === undefined || output.value === null) {
          throw new Error(`Transaction output to ${output.address} is missing a value`);
        }
        psbt.addOutput({
          address: output.address,
          value: BigInt(output.value),
        });
      });

      let tx: bitcoin.Transaction | undefined;

      if (!skipSigning) {
        // sign each input with its tweaked key pair, then round-trip verify the signature
        // we just produced (both sides trust witnessUtxo, so this catches a bad signature,
        // not a bad prevout); must run before finalizeAllInputs(), which strips tapKeySig
        resolvedInputs.forEach(({ input, tweakedPriv }, idx) => {
          const tweakedKeyPair = ECPair.fromPrivateKey(Buffer.from(tweakedPriv), { compressed: true });
          psbt.signTaprootInput(idx, tweakedKeyPair);
          if (!psbt.validateSignaturesOfInput(idx, verifySchnorrSig)) {
            throw new Error(`UTXO ${input.txid}:${input.vout}: Schnorr signature verification failed`);
          }
        });

        psbt.finalizeAllInputs();
        tx = psbt.extractTransaction();
      }

      return {
        tx,
        psbt,
        inputs: inputs.map(i => ({
          txid: i.txid,
          vout: i.vout,
          address: i.address,
          value: i.value,
        })),
        outputs: outputs.map(o => ({
          address: o.address || changeAddress,
          value: o.value,
        })),
        fee,
      };
    } catch (error) {
      // If transaction creation fails, release the reserved UTXOs
      inputKeys.forEach(key => this._sp_pending_inputs.delete(key));
      throw error;
    }
  }

  /**
   * Scan a transaction we just built for silent payment outputs belonging to us — in
   * practice our label-0 change, but a self-payment to the main address is found too.
   *
   * Every input must be ours: the BIP-352 input hash is computed over *all* of them, so a
   * foreign or regular input would silently produce a wrong tweak that matches nothing.
   *
   * Note the tweak stored here already carries the label offset for a change match (that is
   * what the label map buys us), so change found this way is spendable with the *main*
   * spend key, whereas the Rust scanner reports the raw tweak against the labeled key.
   * Both are handled because `resolveSpendKeys` derives the owning key per UTXO.
   */
  private scanBroadcastedTxForOurOutputs(tx: bitcoin.Transaction, broadcastedTxid: string): void {
    const ourInputs = tx.ins.map(input => ({
      txid: Buffer.from(input.hash).reverse().toString('hex'),
      vout: input.index,
    }));

    const inputPrivKeys: PrivateKey[] = [];
    for (const { txid, vout } of ourInputs) {
      const spUtxo = this._utxo.find(u => u.txid === txid && u.vout === vout) as SilentPaymentUTXO | undefined;
      if (!spUtxo || !('tweak' in spUtxo)) {
        console.warn(`[SP] Skipping instant change scan: input ${txid}:${vout} is not one of our SP UTXOs`);
        return;
      }
      const { spendPriv } = this.resolveSpendKeys(spUtxo);
      const tweakedPriv = ecc.privateAdd(spendPriv, spUtxo.tweak);
      if (!tweakedPriv) {
        console.warn(`[SP] Skipping instant change scan: could not tweak the key for input ${txid}:${vout}`);
        return;
      }
      inputPrivKeys.push({ key: Buffer.from(tweakedPriv).toString('hex'), isXOnly: true });
    }

    const sumOfInputPrivKeys = calculateSumOfPrivateKeys(inputPrivKeys);
    const sumOfInputPubKeys = ecc.pointFromScalar(sumOfInputPrivKeys, true);
    if (!sumOfInputPubKeys) {
      console.warn('[SP] Skipping instant change scan: summed input keys are not a valid point');
      return;
    }

    // BIP-352 keys the input hash on the lexicographically smallest outpoint. Shared with the
    // sender side so both compute it the same way.
    const smallestOutpoint = findSmallestOutpoint(ourInputs);

    // Taproot outputs as the 33-byte even-Y pubkeys the scanner compares against.
    const outputsByHex = new Map<string, number>();
    tx.outs.forEach((out, idx) => {
      if (out.script.length === 34 && out.script[0] === 0x51 && out.script[1] === 0x20) {
        const compressed = Buffer.concat([Buffer.from([0x02]), Buffer.from(out.script.subarray(2))]);
        outputsByHex.set(compressed.toString('hex'), idx);
      }
    });
    if (outputsByHex.size === 0) return;

    const seed = this.getSeed();
    const networkConfig = this.getNetworkConfig();
    const matches = scanOutputs(
      getScanPrivateKey(seed, networkConfig),
      getSpendPublicKey(seed, networkConfig),
      sumOfInputPubKeys,
      createInputHash(sumOfInputPubKeys, smallestOutpoint),
      [...outputsByHex.keys()].map(hex => Buffer.from(hex, 'hex')),
      getSilentPaymentChangeLabelMap(seed, networkConfig),
    );

    const blockTime = Math.floor(Date.now() / 1000);
    for (const [outputHex, tweak] of matches) {
      const vout = outputsByHex.get(outputHex);
      if (vout === undefined) continue;

      const pubKey = outputHex.slice(2); // drop the 0x02 prefix back to x-only
      this.addUTXO({
        txid: broadcastedTxid,
        vout,
        value: Number(tx.outs[vout].value),
        height: 0,
        address: bitcoin.payments.p2tr({ pubkey: Buffer.from(pubKey, 'hex'), network: networkConfig.bitcoinjs }).address!,
        silentPaymentAddress: this.getSilentPaymentAddress()!,
        pubKey,
        tweak,
        blockHash: '',
        isSpent: false,
        blockTime,
      });
    }
  }

  /**
   * Override broadcastTx to mark SP UTXOs as spent only after successful broadcast
   */
  async broadcastTx(hex: string): Promise<boolean> {
    try {
      this.ensurePendingInputsInitialized();

      const tx = bitcoin.Transaction.fromHex(hex);
      const spInputs: Array<{ txid: string; vout: number }> = [];

      // check each input against both pending inputs AND our SP UTXOs
      for (const input of tx.ins) {
        const txid = Buffer.from(input.hash).reverse().toString('hex');
        const vout = input.index;
        const inputKey = `${txid}:${vout}`;

        // check if it's in pending inputs OR if it's one of our SP UTXOs
        const isSpUtxo = this._utxo.some(u => u.txid === txid && u.vout === vout && 'tweak' in u);

        if (this._sp_pending_inputs.has(inputKey) || isSpUtxo) {
          spInputs.push({ txid, vout });
        }
      }

      // broadcast using parent implementation
      const txid = await super.broadcastTx(hex);

      // only after successful broadcast, mark SP UTXOs as spent
      if (txid && spInputs.length > 0) {
        const broadcastedTxid = tx.getId();

        // -------------------------
        // INSTANT SP CHANGE SCAN
        // -------------------------
        // Our own change is a silent payment output, so `weOwnAddress` can't see it and it
        // would stay invisible until the next indexer scan. Rebuild the scan data from the
        // inputs we just signed and scan this transaction locally.
        try {
          this.scanBroadcastedTxForOurOutputs(tx, broadcastedTxid);
        } catch (scanError) {
          console.warn('[SP] Post-broadcast instant scan failed:', scanError);
        }

        // start with 0, subtract our inputs, add our outputs (change)
        let value = 0;

        // subtract all SP inputs (money leaving our wallet)
        for (const { txid: inputTxid, vout } of spInputs) {
          const utxo = this._utxo.find(u => u.txid === inputTxid && u.vout === vout);
          if (utxo) {
            value -= utxo.value;
          } else {
            console.warn(`[SP] UTXO not found for input ${inputTxid}:${vout}, value calculation may be incorrect`);
          }
        }

        // add back any outputs going to our addresses (change)
        for (let idx = 0; idx < tx.outs.length; idx++) {
          const output = tx.outs[idx];

          // Any SP output of this tx that our scan claimed is ours — change *or* a
          // self-payment to the main address, both of which `weOwnAddress` cannot see.
          const isSpOutputOfOurs = this._utxo.some(u => u.txid === broadcastedTxid && u.vout === idx && 'tweak' in u);
          if (isSpOutputOfOurs) {
            value += Number(output.value);
            continue;
          }

          try {
            const address = bitcoin.address.fromOutputScript(output.script, this.getNetworkConfig().bitcoinjs);
            if (this.weOwnAddress(address)) {
              value += Number(output.value);
            }
          } catch (e) {
            // If we can't decode the address, assume it's not ours
            console.warn('[SP] Failed to decode output address for value calculation:', e);
          }
        }

        const spendingTx: Transaction = {
          txid: broadcastedTxid,
          hash: broadcastedTxid,
          version: tx.version,
          size: tx.byteLength(),
          vsize: tx.virtualSize(),
          weight: tx.weight(),
          locktime: tx.locktime,
          value,
          confirmations: 0,
          blockhash: '',
          time: Math.floor(Date.now() / 1000),
          blocktime: Math.floor(Date.now() / 1000),
          timestamp: Math.floor(Date.now() / 1000),
          inputs: spInputs.map((input, idx) => ({
            txid: input.txid,
            vout: input.vout,
            scriptSig: { asm: '', hex: '' },
            txinwitness: [],
            sequence: tx.ins[idx]?.sequence || 0xfffffffd,
            addresses: [this.getSilentPaymentAddress() || ''],
            value: this._utxo.find(u => u.txid === input.txid && u.vout === input.vout)?.value || 0,
          })),
          outputs: tx.outs.map((output, n) => {
            // Decode the address from the output script
            let addresses: string[] = [];
            try {
              const address = bitcoin.address.fromOutputScript(output.script, this.getNetworkConfig().bitcoinjs);
              addresses = [address];
            } catch (e) {
              // If address decoding fails, leave empty
              console.warn('[SP] Failed to decode output address:', e);
            }

            return {
              value: Number(output.value),
              n,
              scriptPubKey: {
                asm: '',
                hex: Buffer.from(output.script).toString('hex'),
                reqSigs: 1,
                type:
                  output.script[0] === 0x00 && output.script[1] === 0x14
                    ? 'witness_v0_keyhash'
                    : output.script[0] === 0x51 && output.script[1] === 0x20
                      ? 'witness_v1_taproot'
                      : 'unknown',
                addresses,
              },
            };
          }),
        };

        this._sp_spending_txs.push(spendingTx);

        for (const { txid: inputTxid, vout } of spInputs) {
          const inputKey = `${inputTxid}:${vout}`;
          this._sp_pending_inputs.delete(inputKey);
          this.markUTXOAsSpent(inputTxid, vout);
        }
        this.fetchUtxo().catch(error => console.warn('[SP] Post-broadcast fetchUtxo failed:', error));

        this.onPersistCallback?.();
        this.onBalanceChangeCallback?.();
      }

      return txid;
    } catch (error) {
      this.releaseUTXOsFromTx(hex);
      throw error;
    }
  }

  clearCache(): void {
    if (this.transactionProcessor) {
      this.transactionProcessor.clear();
      this.transactionProcessor = null;
    }

    if (this.cachedSeed) {
      this.cachedSeed.fill(0);
      this.cachedSeed = null;
    }

    if (this.spendKeyCandidates) {
      this.spendKeyCandidates.forEach(({ spendPriv }) => spendPriv.fill(0));
      this.spendKeyCandidates = null;
    }

    this.stopPolling();
    this.invalidateUTXOCache();
    this._sp_pending_inputs = new Set();
    this.onBalanceChangeCallback = null;
    this.onPersistCallback = null;
    this._onScanStateChangeCallback = null;
    this._scanState = IDLE_SCAN_STATE;
    this._scanPaused = false;
    this._scanResumeResolver = null;
    this._scanResumePromise = null;
    this._scanSamples = [];
  }
}
