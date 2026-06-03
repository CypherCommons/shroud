import Keychain, { type SetOptions } from 'react-native-keychain';

import type { SilentPaymentUTXOSerializable, StagedScanData } from './types';

/**
 * Background scan results are staged here until the main app merges them
 * (see HDSilentPaymentsWallet.mergeStagedScanResults). Stored in the keychain
 * (device-bound, OS-encrypted, AFTER_FIRST_UNLOCK) rather than a plain file so
 * UTXO/balance metadata never sits unprotected on disk, and so background runs
 * on a locked device can write it. The payload is small: a cursor plus the few
 * UTXOs found since the app was last opened.
 */
const SERVICE = 'org.bitshala.shroud.background.staging';

const KEYCHAIN_OPTIONS: SetOptions = {
  service: SERVICE,
  accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

export async function readStaging(): Promise<StagedScanData | null> {
  try {
    const result = await Keychain.getGenericPassword({ service: SERVICE });
    if (!result) return null;

    const staged = JSON.parse(result.password) as StagedScanData;
    if (staged.schema !== 1 || typeof staged.cursor !== 'number') return null;

    return staged;
  } catch (error) {
    console.warn('[BackgroundScan] Failed to read staging:', error);
    return null;
  }
}

export async function writeStaging(staged: StagedScanData): Promise<void> {
  await Keychain.setGenericPassword(SERVICE, JSON.stringify(staged), KEYCHAIN_OPTIONS);
}

/**
 * Read-modify-write append. UTXOs are deduped on txid:vout, and the cursor only
 * ever advances — the write happens atomically at the keychain-value level, so a
 * task killed mid-run leaves either the old or the new state, never a cursor
 * pointing past unsaved UTXOs.
 */
export async function appendStagedUtxos(walletID: string, utxos: SilentPaymentUTXOSerializable[], newCursor: number): Promise<void> {
  const existing = await readStaging();
  const base: StagedScanData =
    existing && existing.walletID === walletID ? existing : { walletID, cursor: 0, utxos: [], updatedAt: 0, schema: 1 };

  const seen = new Set(base.utxos.map(u => `${u.txid}:${u.vout}`));
  const fresh = utxos.filter(u => !seen.has(`${u.txid}:${u.vout}`));

  await writeStaging({
    ...base,
    cursor: Math.max(base.cursor, newCursor),
    utxos: [...base.utxos, ...fresh],
    updatedAt: Date.now(),
  });
}

export async function clearStaging(): Promise<void> {
  try {
    await Keychain.resetGenericPassword({ service: SERVICE });
  } catch (error) {
    console.warn('[BackgroundScan] Failed to clear staging:', error);
  }
}
