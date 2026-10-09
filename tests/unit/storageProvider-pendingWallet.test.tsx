import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook } from '@testing-library/react-native';

import { ShroudApp } from '../../class';
import { HDSilentPaymentsWallet } from '../../class/wallets/hd-bip352-wallet';
import { StorageProvider } from '../../components/Context/StorageProvider';
import { useStorage } from '../../hooks/context/useStorage';

jest.mock('../../components/Alert');

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

const renderProvider = () => renderHook(() => useStorage(), { wrapper: StorageProvider }).result;

const reload = async () => {
  const app = new ShroudApp();
  await app.loadFromDisk();
  return app;
};

const newDraft = async () => {
  const wallet = new HDSilentPaymentsWallet();
  await wallet.generate();
  return wallet;
};

describe('unit - StorageProvider pending wallet', () => {
  const shroudApp = ShroudApp.getInstance();

  beforeEach(async () => {
    await AsyncStorage.clear();
    shroudApp.wallets = [];
    shroudApp.lockedWallets = [];
    shroudApp.pendingWallets = [];
  });

  it('saves the draft before resolving, outside the wallet list', async () => {
    const storage = renderProvider();
    const wallet = await newDraft();
    await act(() => storage.current.setPendingWallet(wallet));

    expect(shroudApp.getAllWalletsAcrossNetworks()).toHaveLength(0);
    expect(storage.current.getPendingWallet()).toBe(wallet);
    expect((await reload()).getPendingWallet()?.getSecret()).toBe(wallet.getSecret());
  });

  it('commits once, with the passphrase: the wallet is stored locked and the draft is gone', async () => {
    const storage = renderProvider();
    const wallet = await newDraft();
    await act(() => storage.current.setPendingWallet(wallet));

    await act(() => storage.current.commitPendingWallet(wallet, 'correct horse'));
    await expect(storage.current.commitPendingWallet(wallet, 'ignored')).rejects.toThrow();

    expect(shroudApp.getAllWalletsAcrossNetworks()).toEqual([wallet]);
    expect(wallet.getPassphrase()).toBe('correct horse');
    expect(storage.current.getPendingWallet()).toBeNull();

    const reloaded = await reload();
    expect(reloaded.getPendingWallet()).toBeNull();
    expect(reloaded.hasLockedWallet()).toBe(true);
    expect(await shroudApp.getItem('data')).not.toContain('correct horse');
    expect((await reloaded.unlockWallet('correct horse'))?.getID()).toBe(wallet.getID());
  });

  it('commits a plain wallet when no passphrase was chosen', async () => {
    const storage = renderProvider();
    const wallet = await newDraft();
    await act(() => storage.current.setPendingWallet(wallet));

    await act(() => storage.current.commitPendingWallet(wallet));

    const reloaded = await reload();
    expect(reloaded.hasLockedWallet()).toBe(false);
    expect(reloaded.getPendingWallet()).toBeNull();
    expect(reloaded.getWallets().map(w => w.getID())).toEqual([wallet.getID()]);
  });

  it('commits a draft that came back after a restart', async () => {
    const draft = await newDraft();
    shroudApp.setPendingWallet(draft);
    await shroudApp.saveToDisk();
    shroudApp.pendingWallets = (await reload()).pendingWallets;

    const storage = renderProvider();
    const resumed = storage.current.getPendingWallet()!;
    await act(() => storage.current.commitPendingWallet(resumed, 'correct horse'));

    expect(resumed.getSecret()).toBe(draft.getSecret());
    expect((await (await reload()).unlockWallet('correct horse'))?.getSecret()).toBe(draft.getSecret());
  });

  // A double tap on Create can replace the draft after the backup screen showed the first.
  it('refuses to save a wallet that is no longer the draft', async () => {
    const storage = renderProvider();
    const shown = await newDraft();
    await act(() => storage.current.setPendingWallet(shown));
    await act(() => storage.current.setPendingWallet(HDSilentPaymentsWallet.fromMnemonic(MNEMONIC)));

    await expect(storage.current.commitPendingWallet(shown, 'correct horse')).rejects.toThrow();
    expect(shroudApp.getAllWalletsAcrossNetworks()).toHaveLength(0);
    expect(shown.getPassphrase()).toBeUndefined();
  });

  it('drops the draft, without applying the passphrase, when the chain already has a wallet', async () => {
    shroudApp.wallets = [HDSilentPaymentsWallet.fromMnemonic(MNEMONIC)];
    const storage = renderProvider();
    const wallet = await newDraft();
    await act(() => storage.current.setPendingWallet(wallet));

    await expect(storage.current.commitPendingWallet(wallet, 'correct horse')).rejects.toThrow();
    expect(wallet.getPassphrase()).toBeUndefined();
    expect(storage.current.getPendingWallet()).toBeNull();
    expect((await reload()).getPendingWallet()).toBeNull();
  });

  it('drops an unfinished draft when a wallet is restored instead', async () => {
    const storage = renderProvider();
    await act(() => storage.current.setPendingWallet(new HDSilentPaymentsWallet()));

    await act(() => storage.current.addAndSaveWallet(HDSilentPaymentsWallet.fromMnemonic(MNEMONIC)));

    expect(storage.current.getPendingWallet()).toBeNull();
  });

  it('removes the forgotten wallet from storage', async () => {
    const locked = HDSilentPaymentsWallet.fromMnemonic(MNEMONIC, 'correct horse');
    const writer = new ShroudApp();
    writer.wallets = [locked];
    await writer.saveToDisk();
    await shroudApp.loadFromDisk();
    expect(shroudApp.hasLockedWallet()).toBe(true);

    const storage = renderProvider();
    await storage.current.forgetLockedWallet();

    expect((await reload()).hasLockedWallet()).toBe(false);
  });
});
