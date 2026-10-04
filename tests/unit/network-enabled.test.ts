import { initializeIndexer, disconnectIndexer } from '../../modules/SilentPaymentIndexer';
import * as Electrum from '../../modules/Electrum';
import {
  configureIndexerEndpoints,
  getActiveNetworkId,
  getAllNetworks,
  getEnabledNetworks,
  isNetworkEnabled,
  setActiveNetwork,
} from '../../modules/network';
import { bootActiveNetwork, persistNetworkId, readStoredNetworkId, switchNetworkBackends } from '../../modules/networkPreference';
import { HDSilentPaymentsWallet } from '../../class/wallets/hd-bip352-wallet';
import { ShroudApp } from '../../class/shroud-app';

jest.mock('../../modules/currency', () => ({ GROUP_IO_SHROUD: 'group.org.bitshala.shroud' }));
jest.mock('../../modules/Electrum', () => ({
  resetForNetworkSwitch: jest.fn(),
  connectMain: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../modules/SilentPaymentIndexer', () => ({
  initializeIndexer: jest.fn(),
  disconnectIndexer: jest.fn(),
}));

const MAINNET_INDEXER = 'https://mainnet.indexer.test';
const TESTNET4_INDEXER = 'https://testnet4.indexer.test';
const SEED = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

// Testnet4 is switched off in the registry (`enabled: false`). Everything about it stays — only
// the ability to select, switch to or start on it goes — so these tests give it a working indexer
// to prove that the flag, not a missing indexer, is what refuses it.
describe('a disabled network', () => {
  beforeAll(() => {
    configureIndexerEndpoints({ bitcoin: MAINNET_INDEXER, testnet4: TESTNET4_INDEXER });
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    setActiveNetwork('bitcoin');
    await persistNetworkId('bitcoin');
  });

  afterAll(() => setActiveNetwork('bitcoin'));

  it('is off by default for testnet4 only', () => {
    expect(isNetworkEnabled('bitcoin')).toBe(true);
    expect(isNetworkEnabled('signet')).toBe(true);
    expect(isNetworkEnabled('testnet4')).toBe(false);
  });

  it('is left out of what the UI offers but kept in the registry', () => {
    expect(getEnabledNetworks().map(n => n.id)).toEqual(['bitcoin', 'signet']);
    expect(getAllNetworks().map(n => n.id)).toContain('testnet4');
  });

  it('cannot be switched to, even with a working indexer, and nothing is touched', async () => {
    await expect(switchNetworkBackends('testnet4')).rejects.toThrow(/Testnet4 is currently disabled/);

    expect(getActiveNetworkId()).toBe('bitcoin');
    expect(await readStoredNetworkId()).toBe('bitcoin');
    expect(Electrum.resetForNetworkSwitch).not.toHaveBeenCalled();
    expect(disconnectIndexer).not.toHaveBeenCalled();
    expect(initializeIndexer).not.toHaveBeenCalled();
  });

  // A user who had testnet4 selected before it was switched off must land somewhere usable. The
  // stored preference is kept so that re-enabling the network puts them back.
  it('is not started on, falling back to mainnet and keeping the stored preference', async () => {
    await persistNetworkId('testnet4');

    expect(await bootActiveNetwork()).toEqual({ id: 'bitcoin', fellBackFrom: 'testnet4', reason: 'disabled' });
    expect(getActiveNetworkId()).toBe('bitcoin');
    expect(initializeIndexer).toHaveBeenCalledWith(expect.objectContaining({ baseUrl: MAINNET_INDEXER }));
    expect(await readStoredNetworkId()).toBe('testnet4');
  });

  // The app filters wallets by chain on read and never on write, so switching a chain off must not
  // make its wallets unreachable for persistence — or the next save would delete them.
  it('keeps its stored wallets reachable for persistence', () => {
    setActiveNetwork('testnet4');
    const wallet = new HDSilentPaymentsWallet();
    wallet.setSecret(SEED);
    setActiveNetwork('bitcoin');

    const app = new ShroudApp();
    app.wallets = [wallet];

    expect(app.getWallets()).toHaveLength(0);
    expect(app.getAllWalletsAcrossNetworks()).toHaveLength(1);
    expect(app.getAllWalletsAcrossNetworks()[0].networkId).toBe('testnet4');
  });
});
