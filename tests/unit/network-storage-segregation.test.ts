import { ShroudApp } from '../../class/shroud-app';
import { HDSilentPaymentsWallet } from '../../class/wallets/hd-bip352-wallet';
import { setActiveNetwork, type NetworkId } from '../../modules/network';

const SEED = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

const walletOn = (networkId: NetworkId): HDSilentPaymentsWallet => {
  setActiveNetwork(networkId);
  const wallet = new HDSilentPaymentsWallet();
  wallet.setSecret(SEED);
  return wallet;
};

describe('storage segregation by network', () => {
  let app: ShroudApp;

  beforeEach(() => {
    app = new ShroudApp();
    app.wallets = [walletOn('bitcoin'), walletOn('testnet4'), walletOn('signet')];
  });

  afterEach(() => setActiveNetwork('bitcoin'));

  it('shows only the active chain’s wallets', () => {
    for (const networkId of ['bitcoin', 'testnet4', 'signet'] as const) {
      setActiveNetwork(networkId);
      const visible = app.getWallets();
      expect(visible).toHaveLength(1);
      expect(visible[0].networkId).toBe(networkId);
    }
  });

  // The invariant that keeps a network switch from destroying data: saveToDisk serializes
  // `wallets` wholesale, so the full list must stay reachable even though the UI sees one chain.
  it('keeps every chain’s wallets reachable for persistence', () => {
    setActiveNetwork('signet');
    expect(app.getWallets()).toHaveLength(1);
    expect(app.getAllWalletsAcrossNetworks()).toHaveLength(3);
    expect(
      app
        .getAllWalletsAcrossNetworks()
        .map(w => w.networkId)
        .sort(),
    ).toEqual(['bitcoin', 'signet', 'testnet4']);
  });

  it('sums balances only for the active chain', () => {
    app.wallets.forEach((wallet, index) => {
      (wallet as any).balance = (index + 1) * 1000;
      wallet.getBalance = () => (index + 1) * 1000;
    });

    setActiveNetwork('bitcoin');
    expect(app.getBalance()).toBe(1000);
    setActiveNetwork('testnet4');
    expect(app.getBalance()).toBe(2000);
    setActiveNetwork('signet');
    expect(app.getBalance()).toBe(3000);
  });

  it('deletes by id without disturbing the other chains', () => {
    setActiveNetwork('testnet4');
    const target = app.getWallets()[0];
    app.deleteWallet(target);

    expect(app.getWallets()).toHaveLength(0);
    expect(app.getAllWalletsAcrossNetworks()).toHaveLength(2);
    expect(
      app
        .getAllWalletsAcrossNetworks()
        .map(w => w.networkId)
        .sort(),
    ).toEqual(['bitcoin', 'signet']);
  });

  it('gives each chain’s wallet a distinct id so none can shadow another', () => {
    const ids = app.getAllWalletsAcrossNetworks().map(w => w.getID());
    expect(new Set(ids).size).toBe(3);
  });
});
