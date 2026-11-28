import Keychain, { type SetOptions } from 'react-native-keychain';

import type { HDSilentPaymentsWallet } from '../../class/wallets/hd-bip352-wallet';
import type { ScanCredentials } from './types';

/**
 * Scan-only credentials live in their own keychain entry with AFTER_FIRST_UNLOCK
 * accessibility — unlike the main wallet storage (WHEN_UNLOCKED), they stay readable
 * during background runs on a locked device. By BIP-352 design the scan private key +
 * spend public key can detect incoming payments but cannot spend, so exposing them
 * after first unlock does not weaken custody of funds.
 */
const SERVICE = 'com.shroudwallet.app.background.scancreds';

const KEYCHAIN_OPTIONS: SetOptions = {
  service: SERVICE,
  accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

export async function provisionScanCredentials(wallet: HDSilentPaymentsWallet): Promise<void> {
  const network = wallet.getNetworkConfig();
  const credentials: ScanCredentials = {
    walletID: wallet.getID(),
    ...wallet.getScanKeys(),
    networkId: network.id,
    // A headless run cannot rely on the app having applied its .env overrides, so both URLs are stored.
    baseUrl: network.indexerBaseUrl,
    onionUrl: network.indexerOnionUrl || undefined,
    cursor: wallet.getLastScannedBlock(),
    birthHeight: wallet.getBirthHeight(),
    schema: 1,
  };

  await Keychain.setGenericPassword(SERVICE, JSON.stringify(credentials), KEYCHAIN_OPTIONS);
}

export async function readScanCredentials(): Promise<ScanCredentials | null> {
  try {
    const result = await Keychain.getGenericPassword({ service: SERVICE });
    if (!result) return null;

    const credentials = JSON.parse(result.password) as ScanCredentials;
    if (credentials.schema !== 1 || !credentials.scanPrivkeyHex || !credentials.spendPubkeysHex?.length) return null;

    return credentials;
  } catch (error) {
    console.warn('[BackgroundScan] Failed to read scan credentials:', error);
    return null;
  }
}

/**
 * Refresh the background cursor floor after a foreground scan so background runs
 * don't re-scan ranges the app already covered. Called once per completed scan,
 * never per-batch.
 */
export async function updateScanCursor(walletID: string, cursor: number): Promise<void> {
  const credentials = await readScanCredentials();
  if (!credentials || credentials.walletID !== walletID || cursor <= credentials.cursor) return;

  await Keychain.setGenericPassword(SERVICE, JSON.stringify({ ...credentials, cursor }), KEYCHAIN_OPTIONS);
}

export async function deleteScanCredentials(): Promise<void> {
  try {
    await Keychain.resetGenericPassword({ service: SERVICE });
  } catch (error) {
    console.warn('[BackgroundScan] Failed to delete scan credentials:', error);
  }
}
