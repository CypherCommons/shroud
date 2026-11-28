import AsyncStorage from '@react-native-async-storage/async-storage';

import { HDSilentPaymentsWallet } from '../../class/wallets/hd-bip352-wallet';
import type { TWallet } from '../../class/wallets/types';
import { requestNotificationPermission, startBackgroundScanning, stopBackgroundScanning } from '../../modules/BackgroundScanManager';
import { deleteScanCredentials, provisionScanCredentials, readScanCredentials, updateScanCursor } from './BackgroundScanCredentials';
import { clearStaging, readStaging } from './ScanStagingStore';

const USER_PREF_KEY = 'background_scan_user_pref'; // 'on' | 'off'; absent = on (default)

export async function isBackgroundScanningEnabledByUser(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(USER_PREF_KEY)) !== 'off';
  } catch {
    return true;
  }
}

export function findScannableWallet(wallets: TWallet[]): HDSilentPaymentsWallet | undefined {
  return wallets.find((w): w is HDSilentPaymentsWallet => w instanceof HDSilentPaymentsWallet);
}

async function mergeStaged(wallets: TWallet[]): Promise<number> {
  const wallet = findScannableWallet(wallets);
  if (!wallet) return 0;

  const staged = await readStaging();
  if (!staged) return 0;

  const merged = wallet.mergeStagedScanResults(staged);
  await clearStaging();
  // The wallet now covers everything that was staged. Move the background cursor with it, or the
  // next run starts behind, finds the same payments again and notifies a second time.
  await updateScanCursor(wallet.getID(), wallet.getLastScannedBlock());
  if (merged > 0) {
    console.log(`[BackgroundScan] Merged ${merged} staged UTXO(s)`);
  }
  return merged;
}

let mergeInFlight: Promise<number> | null = null;

/**
 * Merge whatever background scans have staged into the wallet. Run before the
 * wallets are shown, and again whenever the app returns to the foreground.
 * Idempotent and cheap when staging is empty.
 *
 * One at a time: app start and the foreground transition both call this, and a
 * keychain read that overlaps the other call's reset fails on Android.
 *
 * @returns number of staged UTXOs merged (caller should persist if > 0)
 */
export function mergeStagedResults(wallets: TWallet[]): Promise<number> {
  mergeInFlight ??= mergeStaged(wallets).finally(() => {
    mergeInFlight = null;
  });
  return mergeInFlight;
}

/** Remove the scan credentials, staged data and OS scheduling. */
export async function teardownBackgroundScanState(): Promise<void> {
  await deleteScanCredentials();
  await clearStaging();
  try {
    await stopBackgroundScanning();
  } catch (error) {
    console.warn('[BackgroundScan] Failed to stop native scheduling:', error);
  }
}

/**
 * Reconcile background-scan state with the loaded wallets. Called on app start,
 * after wallet creation/import, on a network or storage switch, and when the
 * user flips the setting:
 *  - merges staged background finds into the wallet (idempotent),
 *  - with a scannable wallet and the setting on: (re-)provisions the scan-only
 *    credentials and schedules the OS job,
 *  - otherwise removes the credentials, staged data and scheduling. The scan key
 *    only leaves the wallet storage while there is something to scan for.
 *
 * @returns number of staged UTXOs merged into the wallet (caller should persist if > 0)
 */
export async function syncBackgroundScanState(wallets: TWallet[]): Promise<number> {
  const wallet = findScannableWallet(wallets);
  const merged = await mergeStagedResults(wallets);

  if (!wallet || !(await isBackgroundScanningEnabledByUser())) {
    await teardownBackgroundScanState();
    return merged;
  }

  const hadCredentials = (await readScanCredentials()) !== null;
  try {
    await provisionScanCredentials(wallet);
  } catch (error) {
    console.warn('[BackgroundScan] Failed to provision scan credentials:', error);
    return merged;
  }

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

  return merged;
}

export async function setBackgroundScanningUserPref(enabled: boolean, wallets: TWallet[]): Promise<void> {
  await AsyncStorage.setItem(USER_PREF_KEY, enabled ? 'on' : 'off');
  // Off removes the scan key, staged results and OS scheduling; on provisions them again.
  await syncBackgroundScanState(wallets);
}
