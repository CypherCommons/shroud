import React, { useContext } from 'react';
import { act, render } from '@testing-library/react-native';

import { ShroudApp } from '../../class';
import { HDSilentPaymentsWallet } from '../../class/wallets/hd-bip352-wallet';
import { StorageContext, StorageProvider } from '../../components/Context/StorageProvider';

const TEST_SEED = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

// runAfterInteractions starts its task from a setImmediate, and nothing waits for the task to finish
const settle = () => act(() => new Promise(resolve => setImmediate(resolve)));

describe('unit - StorageProvider saves', () => {
  let storage: React.ContextType<typeof StorageContext>;
  const StorageReader = () => {
    storage = useContext(StorageContext);
    return null;
  };

  const withWallet = () => {
    render(
      <StorageProvider>
        <StorageReader />
      </StorageProvider>,
    );
    const wallet = new HDSilentPaymentsWallet();
    wallet.setSecret(TEST_SEED);
    act(() => {
      storage.addWallet(wallet);
    });
    return wallet;
  };

  afterEach(() => {
    ShroudApp.getInstance().wallets = [];
    jest.restoreAllMocks();
  });

  it('shows what the wallets hold after a save, even one that failed', async () => {
    withWallet();
    jest.spyOn(ShroudApp.getInstance(), 'saveToDisk').mockRejectedValue(new Error('disk full'));
    const logged = jest.spyOn(console, 'error').mockImplementation(() => {});
    const before = storage.wallets;

    await act(async () => {
      await storage.saveToDisk();
    });
    await settle();

    expect(storage.wallets).not.toBe(before);
    expect(logged).toHaveBeenCalledWith('[StorageProvider] Saving to disk failed:', expect.any(Error));
  });

  it('keeps `wallets` as it is when a wallet saves its own progress, so nothing re-renders for it', async () => {
    const wallet = withWallet();
    const save = jest.spyOn(ShroudApp.getInstance(), 'saveToDisk').mockResolvedValue(undefined as never);
    const timers = jest.spyOn(global, 'setTimeout');
    const before = storage.wallets;

    act(() => (wallet as any).onPersistCallback());
    // run the debounced save now rather than wait 2s for it
    const [debounced] = timers.mock.calls.find(([, ms]) => ms === 2000)!;
    await act(async () => (debounced as () => void)());
    await settle();

    expect(save).toHaveBeenCalledTimes(1);
    expect(storage.wallets).toBe(before);
  });
});
