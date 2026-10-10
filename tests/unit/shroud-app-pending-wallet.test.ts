import AsyncStorage from '@react-native-async-storage/async-storage';

import { ShroudApp } from '../../class/shroud-app';
import { HDSilentPaymentsWallet } from '../../class/wallets/hd-bip352-wallet';
import { setActiveNetwork, type NetworkId } from '../../modules/network';

const SEED = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

const draftOn = async (networkId: NetworkId): Promise<HDSilentPaymentsWallet> => {
  setActiveNetwork(networkId);
  const wallet = new HDSilentPaymentsWallet();
  await wallet.generate();
  return wallet;
};

describe('ShroudApp pending (draft) wallets', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    setActiveNetwork('bitcoin');
  });

  afterEach(() => setActiveNetwork('bitcoin'));

  it('brings a draft back after a restart with the same words, outside the wallet list', async () => {
    const app = new ShroudApp();
    const draft = await draftOn('bitcoin');
    app.setPendingWallet(draft);
    await app.saveToDisk();

    const reloaded = new ShroudApp();
    expect(await reloaded.loadFromDisk()).toBe(true);
    expect(reloaded.getPendingWallet()?.getSecret()).toBe(draft.getSecret());
    expect(reloaded.getWallets()).toHaveLength(0);
    expect(reloaded.hasLockedWallet()).toBe(false);
  });

  it('keeps the draft inside encrypted storage', async () => {
    const app = new ShroudApp();
    const draft = await draftOn('bitcoin');
    app.setPendingWallet(draft);
    await app.encryptStorage('storage-password');

    expect(await app.getItem('data')).not.toContain(draft.getSecret());
    const reloaded = new ShroudApp();
    await reloaded.loadFromDisk('storage-password');
    expect(reloaded.getPendingWallet()?.getSecret()).toBe(draft.getSecret());
  });

  it('keeps one draft per chain', async () => {
    const app = new ShroudApp();
    const signetDraft = await draftOn('signet');
    app.setPendingWallet(signetDraft);
    await app.saveToDisk();

    const reloaded = new ShroudApp();
    await reloaded.loadFromDisk();
    setActiveNetwork('bitcoin');
    expect(reloaded.getPendingWallet()).toBeNull();
    setActiveNetwork('signet');
    expect(reloaded.getPendingWallet()?.getSecret()).toBe(signetDraft.getSecret());
  });

  it('ignores a stored draft for a chain that already has a wallet', async () => {
    const app = new ShroudApp();
    app.wallets = [HDSilentPaymentsWallet.fromMnemonic(SEED)];
    app.setPendingWallet(await draftOn('bitcoin'));
    await app.saveToDisk();

    const reloaded = new ShroudApp();
    await reloaded.loadFromDisk();
    expect(reloaded.getPendingWallet()).toBeNull();
    expect(reloaded.getWallets()).toHaveLength(1);
  });

  it('does not carry a draft into a plausible-deniability decoy bucket', async () => {
    const app = new ShroudApp();
    const draft = await draftOn('bitcoin');
    app.setPendingWallet(draft);
    await app.encryptStorage('real-password');

    await app.createFakeStorage('duress-password');

    expect(app.getPendingWallet()).toBeNull();
    const decoy = new ShroudApp();
    await decoy.loadFromDisk('duress-password');
    expect(decoy.getPendingWallet()).toBeNull();
    // the real bucket keeps its draft
    const real = new ShroudApp();
    await real.loadFromDisk('real-password');
    expect(real.getPendingWallet()?.getSecret()).toBe(draft.getSecret());
  });
});
