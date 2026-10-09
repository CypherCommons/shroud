import AsyncStorage from '@react-native-async-storage/async-storage';
import { sha256 } from '@noble/hashes/sha256';
import Realm from 'realm';

import { ShroudApp } from '../../class/shroud-app';
import { HDSilentPaymentsWallet } from '../../class/wallets/hd-bip352-wallet';
import { setActiveNetwork, type NetworkId } from '../../modules/network';

const SEED = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSPHRASE = 'correct horse';

const walletOn = (networkId: NetworkId, passphrase?: string): HDSilentPaymentsWallet => {
  setActiveNetwork(networkId);
  return HDSilentPaymentsWallet.fromMnemonic(SEED, passphrase);
};

const readStoredData = async (app: ShroudApp): Promise<string> => app.getItem('data');

describe('ShroudApp passphrase wallets', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    setActiveNetwork('bitcoin');
  });

  afterEach(() => setActiveNetwork('bitcoin'));

  it('never writes the passphrase to storage', async () => {
    const app = new ShroudApp();
    app.wallets = [walletOn('bitcoin', PASSPHRASE)];
    await app.saveToDisk();

    expect(await readStoredData(app)).not.toContain(PASSPHRASE);
  });

  it('loads a passphrase wallet locked, and unlocks it to the same wallet', async () => {
    const app = new ShroudApp();
    const wallet = walletOn('bitcoin', PASSPHRASE);
    app.wallets = [wallet];
    await app.saveToDisk();

    const reloaded = new ShroudApp();
    expect(await reloaded.loadFromDisk()).toBe(true);
    expect(reloaded.getWallets()).toHaveLength(0);
    expect(reloaded.hasLockedWallet()).toBe(true);

    const unlocked = await reloaded.unlockWallet(PASSPHRASE);
    expect(unlocked?.getID()).toBe(wallet.getID());
    expect(reloaded.getWallets()).toHaveLength(1);
    expect(reloaded.hasLockedWallet()).toBe(false);
  });

  it('leaves storage untouched on a wrong passphrase', async () => {
    const app = new ShroudApp();
    app.wallets = [walletOn('bitcoin', PASSPHRASE)];
    await app.saveToDisk();
    const before = await readStoredData(app);

    const reloaded = new ShroudApp();
    await reloaded.loadFromDisk();
    expect(await reloaded.unlockWallet('wrong')).toBeNull();
    expect(reloaded.hasLockedWallet()).toBe(true);
    await reloaded.saveToDisk();

    expect(await readStoredData(reloaded)).toBe(before);
  });

  // The rule that keeps a locked wallet alive: every save rewrites the whole bucket.
  it('keeps a locked wallet through saves of other chains', async () => {
    const app = new ShroudApp();
    const locked = walletOn('bitcoin', PASSPHRASE);
    const open = walletOn('signet');
    app.wallets = [locked, open];
    await app.saveToDisk();

    const reloaded = new ShroudApp();
    await reloaded.loadFromDisk();
    setActiveNetwork('signet');
    expect(reloaded.getWallets().map(w => w.getID())).toEqual([open.getID()]);
    await reloaded.saveToDisk();

    const again = new ShroudApp();
    await again.loadFromDisk();
    setActiveNetwork('bitcoin');
    expect((await again.unlockWallet(PASSPHRASE))?.getID()).toBe(locked.getID());
  });

  it('does not duplicate a locked wallet when loaded twice', async () => {
    const app = new ShroudApp();
    app.wallets = [walletOn('bitcoin', PASSPHRASE)];
    await app.saveToDisk();

    const reloaded = new ShroudApp();
    await reloaded.loadFromDisk();
    await reloaded.loadFromDisk();
    expect(reloaded.lockedWallets).toHaveLength(1);
  });

  // Reloading must not lock again a wallet that is already open, even though saving it after
  // unlock rewrote its stored blob.
  it('does not lock an already unlocked wallet when storage is read again', async () => {
    const app = new ShroudApp();
    const wallet = walletOn('bitcoin', PASSPHRASE);
    app.wallets = [wallet];
    await app.saveToDisk();

    const reloaded = new ShroudApp();
    await reloaded.loadFromDisk();
    await reloaded.unlockWallet(PASSPHRASE);
    (reloaded.getWallets()[0] as HDSilentPaymentsWallet).setLabel('renamed'); // changes the blob on the next save
    await reloaded.saveToDisk();
    await reloaded.loadFromDisk();

    expect(reloaded.lockedWallets).toHaveLength(0);
    expect(reloaded.getAllWalletsAcrossNetworks()).toHaveLength(1);
  });

  it('keeps a locked wallet in encrypted storage', async () => {
    const app = new ShroudApp();
    const wallet = walletOn('bitcoin', PASSPHRASE);
    app.wallets = [wallet];
    await app.encryptStorage('storage-password');

    const reloaded = new ShroudApp();
    expect(await reloaded.loadFromDisk('storage-password')).toBe(true);
    expect(reloaded.hasLockedWallet()).toBe(true);
    await reloaded.saveToDisk(); // re-encrypts the bucket with the locked blob in it

    const again = new ShroudApp();
    await again.loadFromDisk('storage-password');
    expect((await again.unlockWallet(PASSPHRASE))?.getID()).toBe(wallet.getID());
  });

  it('keys a passphrase wallet on its fingerprint, so the stored ID says nothing about the passphrase', () => {
    const wallet = walletOn('bitcoin', PASSPHRASE);
    const expected = Buffer.from(
      sha256(wallet.type + wallet.getSecret() + wallet.passphraseFingerprint + wallet.getDerivationPath()),
    ).toString('hex');
    expect(wallet.getID()).toBe(expected);
  });

  it('clears a forgotten wallet’s cached transactions under its real ID', async () => {
    const app = new ShroudApp();
    const wallet = walletOn('bitcoin', PASSPHRASE);
    app.wallets = [wallet];
    await app.saveToDisk();

    const filters: string[] = [];
    const realmInstance = (Realm.open as jest.Mock)();
    const objects = jest.spyOn(realmInstance, 'objects').mockImplementation(() => ({
      filtered: (q: string) => {
        filters.push(q);
        return [];
      },
    }));

    const reloaded = new ShroudApp();
    await reloaded.loadFromDisk();
    filters.length = 0;
    await reloaded.forgetLockedWallet();

    expect(filters).toEqual([`walletid = '${wallet.getID()}'`]);
    objects.mockRestore();
  });

  it('keeps an open passphrase wallet open when storage encryption is turned off', async () => {
    const app = new ShroudApp();
    const wallet = walletOn('bitcoin', PASSPHRASE);
    app.wallets = [wallet, walletOn('signet')];
    setActiveNetwork('bitcoin');
    await app.encryptStorage('storage-password');

    await app.decryptStorage('storage-password');

    expect(app.hasLockedWallet()).toBe(false);
    expect(app.getWallets().map(w => w.getID())).toEqual([wallet.getID()]);
    expect(app.getAllWalletsAcrossNetworks()).toHaveLength(2);

    // still never saved with its passphrase: a fresh load finds it locked
    const reloaded = new ShroudApp();
    await reloaded.loadFromDisk();
    expect(reloaded.hasLockedWallet()).toBe(true);
  });

  it('forgets only the active chain’s locked wallet', async () => {
    const app = new ShroudApp();
    app.wallets = [walletOn('bitcoin', PASSPHRASE), walletOn('signet', PASSPHRASE)];
    await app.saveToDisk();

    const reloaded = new ShroudApp();
    await reloaded.loadFromDisk();
    setActiveNetwork('signet');
    await reloaded.forgetLockedWallet();
    await reloaded.saveToDisk();

    const again = new ShroudApp();
    await again.loadFromDisk();
    expect(again.hasLockedWallet()).toBe(false);
    setActiveNetwork('bitcoin');
    expect(again.hasLockedWallet()).toBe(true);
  });
});
