import AsyncStorage from '@react-native-async-storage/async-storage';

import { HDSilentPaymentsWallet } from '../../class/wallets/hd-bip352-wallet';
import type { TWallet } from '../../class/wallets/types';
import { requestNotificationPermission, startBackgroundScanning, stopBackgroundScanning } from '../../modules/BackgroundScanManager';
import { getDefaultIndexer } from '../../modules/SilentPaymentIndexer';
import { deleteScanCredentials, provisionScanCredentials, readScanCredentials } from './BackgroundScanCredentials';
import { clearStaging, readStaging } from './ScanStagingStore';

const USER_PREF_KEY = 'background_scan_user_pref'; // 'on' | 'off'; absent = on (default)

export async function isBackgroundScanningEnabledByUser(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(USER_PREF_KEY)) !== 'off';
  } catch {
    return true;
  }
}

export async function setBackgroundScanningUserPref(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(USER_PREF_KEY, enabled ? 'on' : 'off');
  try {
    if (enabled) {
      await requestNotificationPermission();
      await startBackgroundScanning();
    } else {
      await stopBackgroundScanning();
    }
  } catch (error) {
    console.warn('[BackgroundScan] Failed to toggle native scheduling:', error);
  }
}

export function findScannableWallet(wallets: TWallet[]): HDSilentPaymentsWallet | undefined {
  return wallets.find((w): w is HDSilentPaymentsWallet => w instanceof HDSilentPaymentsWallet);
}

/**
 * Merge-only path, run when the app returns to foreground from suspension: a
 * background scan may have staged finds while we were suspended, and the cold
 * start merge in syncBackgroundScanState won't re-run. Idempotent and cheap
 * when staging is empty.
 *
 * @returns number of staged UTXOs merged (caller should persist if > 0)
 */
export async function mergeStagedResults(wallets: TWallet[]): Promise<number> {
  const wallet = findScannableWallet(wallets);
  if (!wallet) return 0;

  const staged = await readStaging();
  if (!staged) return 0;

  const merged = wallet.mergeStagedScanResults(staged);
  await clearStaging();
  if (merged > 0) {
    console.log(`[BackgroundScan] Merged ${merged} staged UTXO(s) on foreground`);
  }
  return merged;
}

/**
 * Reconcile background-scan state with the loaded wallets. Called once per app
 * start (after wallets are decrypted, BEFORE any foreground scan) and after
 * wallet creation/import:
 *  - merges staged background finds into the wallet (idempotent),
 *  - (re-)provisions the scan-only credentials — backfills pre-existing wallets
 *    and self-heals the indexer baseUrl on rebuilds,
 *  - starts/stops the OS scheduling to match the user preference,
 *  - tears everything down when no scannable wallet exists.
 *
 * @returns number of staged UTXOs merged into the wallet (caller should persist if > 0)
 */
export async function syncBackgroundScanState(wallets: TWallet[]): Promise<number> {
  const wallet = findScannableWallet(wallets);

  if (!wallet) {
    await deleteScanCredentials();
    await clearStaging();
    try {
      await stopBackgroundScanning();
    } catch {} // native module unavailable (e.g. tests) — nothing scheduled anyway
    return 0;
  }

  let merged = 0;
  const staged = await readStaging();
  if (staged) {
    merged = wallet.mergeStagedScanResults(staged);
    await clearStaging();
    if (merged > 0) {
      console.log(`[BackgroundScan] Merged ${merged} staged UTXO(s) from background scans`);
    }
  }

  const hadCredentials = (await readScanCredentials()) !== null;
  try {
    // Same indexer the foreground scan uses (initialized in App.tsx from env).
    const baseUrl = getDefaultIndexer().getBaseUrl();
    await provisionScanCredentials(wallet, baseUrl);
  } catch (error) {
    console.warn('[BackgroundScan] Failed to provision scan credentials:', error);
    return merged;
  }

  if (await isBackgroundScanningEnabledByUser()) {
    try {
      if (!hadCredentials) {
        // First provisioning for this wallet: ask for notification permission
        // while we're in the foreground, then enable scheduling.
        await requestNotificationPermission();
      }
      await startBackgroundScanning();
    } catch (error) {
      console.warn('[BackgroundScan] Failed to start native scheduling:', error);
    }
  }

  return merged;
}

/** Remove credentials, staged data and OS scheduling for a deleted wallet. */
export async function teardownBackgroundScanState(): Promise<void> {
  await deleteScanCredentials();
  await clearStaging();
  try {
    await stopBackgroundScanning();
  } catch (error) {
    console.warn('[BackgroundScan] Failed to stop native scheduling:', error);
  }
}
