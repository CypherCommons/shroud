import { Buffer } from 'buffer';

import { BIP352_ACTIVATION_HEIGHT } from '../../modules/constants';
import { postLocalNotification } from '../../modules/BackgroundScanManager';
import { initializeRustJsiBridge } from '../../modules/RustJsiBridge';
import { SilentPaymentIndexer } from '../../modules/SilentPaymentIndexer';
import loc from '../../loc';
import { readScanCredentials } from './BackgroundScanCredentials';
import { RustTransactionProcessor } from './RustTransactionProcessor';
import { appendStagedUtxos, readStaging } from './ScanStagingStore';
import { isForegroundActive } from './ScanLock';
import type { SilentPaymentUTXO, SilentPaymentUTXOSerializable } from './types';

export interface BackgroundScanParams {
  timeBudgetMs: number;
  reason?: 'ios-refresh' | 'ios-processing' | 'android-worker';
}

export interface BackgroundScanResult {
  blocksScanned: number;
  newUtxos: number;
  newCursor: number;
  caughtUp: boolean;
  bailedReason?: 'foreground-active' | 'no-credentials' | 'indexer-unreachable' | 'cancelled';
}

const RANGE_BATCH_SIZE = 50; // matches SilentPaymentIndexer.scanBlocks
/**
 * Short per-request timeout (vs the foreground 100s): fetchWithRetries retries
 * 3x with no backoff, so a hung indexer must not eat the whole iOS budget.
 */
const BG_REQUEST_TIMEOUT_MS = 8000;
/** Headroom reserved for the final staging write + native completion. */
const SAFETY_MARGIN_MS = 2000;

let cancelRequested = false;
let activeRun: Promise<BackgroundScanResult> | null = null;

/**
 * Cooperative cancellation, wired to the iOS BGTask expiration handler
 * (onBackgroundScanCancel). Checked at range boundaries.
 */
export function requestBackgroundScanCancel(): void {
  cancelRequested = true;
}

function toSerializable(utxo: SilentPaymentUTXO): SilentPaymentUTXOSerializable {
  const { tweak, ...rest } = utxo;
  return { ...rest, tweakHex: Buffer.from(tweak).toString('hex') };
}

async function doRunBackgroundScan(params: BackgroundScanParams): Promise<BackgroundScanResult> {
  const startedAt = Date.now();
  const deadline = startedAt + params.timeBudgetMs - SAFETY_MARGIN_MS;
  cancelRequested = false;

  const bail = (reason: BackgroundScanResult['bailedReason']): BackgroundScanResult => ({
    blocksScanned: 0,
    newUtxos: 0,
    newCursor: 0,
    caughtUp: false,
    bailedReason: reason,
  });

  if (await isForegroundActive()) {
    console.log('[BackgroundScan] Foreground app active, bailing');
    return bail('foreground-active');
  }

  const credentials = await readScanCredentials();
  if (!credentials) {
    console.log('[BackgroundScan] No scan credentials provisioned, bailing');
    return bail('no-credentials');
  }

  if (!initializeRustJsiBridge()) {
    console.warn('[BackgroundScan] Rust JSI bridge unavailable, bailing');
    return bail('no-credentials');
  }

  // Private indexer instance: must not clobber the foreground singleton's
  // config when running in a still-warm app runtime.
  const indexer = new SilentPaymentIndexer({ baseUrl: credentials.baseUrl, timeout: BG_REQUEST_TIMEOUT_MS });
  const processor = new RustTransactionProcessor(credentials.scanPrivkeyHex, credentials.spendPubkeyHex);

  let tipHeight: number;
  try {
    tipHeight = (await indexer.getLatestBlockHeight()).height;
  } catch (error) {
    console.warn('[BackgroundScan] Indexer unreachable:', error);
    return bail('indexer-unreachable');
  }

  const staging = await readStaging();
  const stagedCursor = staging && staging.walletID === credentials.walletID ? staging.cursor : 0;
  const cursor = Math.max(credentials.cursor, stagedCursor);
  const effectiveBirthHeight = Math.max(credentials.birthHeight, BIP352_ACTIVATION_HEIGHT);
  // Mirrors performScan: resume after the cursor, or start at birth for a never-scanned wallet.
  const startHeight = cursor > 0 ? cursor + 1 : effectiveBirthHeight;

  let blocksScanned = 0;
  let newUtxos = 0;
  let newCursor = cursor;

  for (let rangeStart = startHeight; rangeStart <= tipHeight; rangeStart += RANGE_BATCH_SIZE) {
    if (cancelRequested) {
      return { blocksScanned, newUtxos, newCursor, caughtUp: false, bailedReason: 'cancelled' };
    }
    if (Date.now() >= deadline) {
      break;
    }

    const rangeEnd = Math.min(rangeStart + RANGE_BATCH_SIZE - 1, tipHeight);

    try {
      const response = await indexer.getTransactionsByRange(rangeStart, rangeEnd);
      const valid = response.transactions.filter(tx => tx.scanTweak && tx.outputs && tx.outputs.length > 0);
      const matched = valid.length > 0 ? await processor.processBatch(valid, credentials.silentPaymentAddress) : [];

      // Stage UTXOs and cursor in one write — the cursor never points past
      // blocks whose finds weren't saved, so a kill mid-run is always safe.
      await appendStagedUtxos(credentials.walletID, matched.map(toSerializable), rangeEnd);

      newUtxos += matched.length;
      newCursor = rangeEnd;
      blocksScanned += rangeEnd - rangeStart + 1;
    } catch (error) {
      // Unlike the foreground scan we must NOT skip a failed range: advancing
      // the cursor past it would permanently miss any payments inside.
      console.warn(`[BackgroundScan] Range ${rangeStart}-${rangeEnd} failed, stopping:`, error);
      break;
    }
  }

  if (newUtxos > 0) {
    try {
      await postLocalNotification(loc.notifications.received_title, loc.notifications.received_body);
    } catch (error) {
      console.warn('[BackgroundScan] Failed to post notification:', error);
    }
  }

  const result: BackgroundScanResult = {
    blocksScanned,
    newUtxos,
    newCursor,
    caughtUp: newCursor >= tipHeight,
  };
  console.log(
    `[BackgroundScan] Done in ${Date.now() - startedAt}ms: ${blocksScanned} blocks, ` +
      `${newUtxos} new UTXOs, cursor ${newCursor}/${tipHeight} (${params.reason ?? 'unknown'})`,
  );
  return result;
}

/**
 * Headless background scan: detect incoming silent payments using only the
 * scan-only keychain credentials, and stage results for the main app to merge
 * on next open. Never touches the main wallet storage (unreadable while the
 * device is locked) and never holds spending keys.
 *
 * Single-flight: concurrent invocations (e.g. iOS refresh + processing tasks
 * firing together) share one run — interleaved loops would race the staging
 * read-modify-write.
 */
export async function runBackgroundScan(params: BackgroundScanParams): Promise<BackgroundScanResult> {
  if (activeRun) {
    return activeRun;
  }

  activeRun = doRunBackgroundScan(params);
  try {
    return await activeRun;
  } finally {
    activeRun = null;
  }
}
