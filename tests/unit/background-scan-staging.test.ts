import Keychain from 'react-native-keychain';

import { appendStagedUtxos } from '../../helpers/silent-payments/ScanStagingStore.ts';
import type { SilentPaymentUTXOSerializable, StagedScanData } from '../../helpers/silent-payments/types.ts';

const getGenericPassword = Keychain.getGenericPassword as jest.Mock;
const setGenericPassword = Keychain.setGenericPassword as jest.Mock;

const utxo = (txid: string) => ({ txid, vout: 0 }) as SilentPaymentUTXOSerializable;

describe('appendStagedUtxos', () => {
  beforeEach(() => jest.clearAllMocks());

  it('does not overwrite staged finds when the keychain cannot be read', async () => {
    // Seen on Android: a read racing a reset fails with "Key permanently invalidated". Treating
    // that as "nothing staged" would replace earlier finds and move the cursor past their blocks.
    getGenericPassword.mockRejectedValue(new Error('Key permanently invalidated'));

    await expect(appendStagedUtxos('wallet-1', [utxo('b')], 200)).rejects.toThrow('Key permanently invalidated');
    expect(setGenericPassword).not.toHaveBeenCalled();
  });

  it('keeps earlier finds and reports only what is new', async () => {
    const staged: StagedScanData = { walletID: 'wallet-1', cursor: 100, utxos: [utxo('a')], updatedAt: 0, schema: 1 };
    getGenericPassword.mockResolvedValue({ password: JSON.stringify(staged) });

    await expect(appendStagedUtxos('wallet-1', [utxo('a'), utxo('b')], 200)).resolves.toBe(1);

    const written = JSON.parse(setGenericPassword.mock.calls[0][1]) as StagedScanData;
    expect(written.cursor).toBe(200);
    expect(written.utxos.map(u => u.txid)).toEqual(['a', 'b']);
  });
});
