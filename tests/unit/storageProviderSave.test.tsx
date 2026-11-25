import { act } from '@testing-library/react-native';

import { ShroudApp } from '../../class';
import { defer } from '../helpers/defer';
import { renderStorageWithWallet } from '../helpers/storageProvider';

// runAfterInteractions starts its task from a setImmediate
const settle = () => act(() => new Promise(resolve => setImmediate(resolve)));

describe('unit - StorageProvider saves', () => {
  let storage: ReturnType<typeof renderStorageWithWallet>['storage'];
  const withWallet = () => {
    const rendered = renderStorageWithWallet();
    storage = rendered.storage;
    return rendered.wallet;
  };

  afterEach(() => {
    ShroudApp.getInstance().wallets = [];
    jest.restoreAllMocks();
  });

  it('resolves once the wallets are written, not once their write has started', async () => {
    withWallet();
    const written = defer<void>();
    jest.spyOn(ShroudApp.getInstance(), 'saveToDisk').mockReturnValue(written.promise);

    let saved = false;
    act(() => {
      storage()
        .saveToDisk()
        .then(() => {
          saved = true;
        });
    });
    await settle();
    expect(saved).toBe(false);

    await act(async () => written.resolve());
    expect(saved).toBe(true);
  });

  it('shows what the wallets hold after a save, even one that failed', async () => {
    withWallet();
    jest.spyOn(ShroudApp.getInstance(), 'saveToDisk').mockRejectedValue(new Error('disk full'));
    const before = storage().wallets;

    await act(async () => {
      await expect(storage().saveToDisk()).rejects.toThrow('disk full');
    });

    expect(storage().wallets).not.toBe(before);
  });

  it('keeps `wallets` as it is when a wallet saves its own progress, so nothing re-renders for it', async () => {
    const wallet = withWallet();
    const save = jest.spyOn(ShroudApp.getInstance(), 'saveToDisk').mockResolvedValue(undefined as never);
    const timers = jest.spyOn(global, 'setTimeout');
    const before = storage().wallets;

    act(() => (wallet as any).onPersistCallback());
    // run the debounced save now rather than wait 2s for it
    const [debounced] = timers.mock.calls.find(([, ms]) => ms === 2000)!;
    await act(async () => (debounced as () => void)());
    await settle();

    expect(save).toHaveBeenCalledTimes(1);
    expect(storage().wallets).toBe(before);
  });

  it('saves at once for a wallet that can’t wait, as a scan paused on the app’s way into the background', async () => {
    const wallet = withWallet();
    const save = jest.spyOn(ShroudApp.getInstance(), 'saveToDisk').mockResolvedValue(undefined as never);

    act(() => (wallet as any).onPersistCallback()); // a save asked for in the usual way, still waiting
    act(() => (wallet as any).onPersistCallback({ immediately: true }));
    await settle();

    expect(save).toHaveBeenCalledTimes(1); // the one waiting went with it
  });
});
