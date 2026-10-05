import { initializeIndexer, disconnectIndexer } from '../../modules/SilentPaymentIndexer';
import * as Electrum from '../../modules/Electrum';
import { configureIndexerEndpoints, getActiveNetworkId, getNetwork, setActiveNetwork } from '../../modules/network';
import {
  bootActiveNetwork,
  persistNetworkId,
  readStoredNetworkId,
  rollbackNetworkSwitch,
  switchNetworkBackends,
} from '../../modules/networkPreference';

jest.mock('../../modules/currency', () => ({ GROUP_IO_SHROUD: 'group.com.shroudwallet.app' }));
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
const MAINNET_ONION = 'http://mainnet-indexer.onion';
const TESTNET4_ONION = 'http://testnet4-indexer.onion';

// These tests are about switch sequencing and need a second working chain. Testnet4 is switched off
// in the registry, so turn it back on for this file only (the registry is per test file); the flag
// itself is covered in network-enabled.test.ts.
beforeAll(() => {
  getNetwork('testnet4').enabled = true;
  // Signet is the chain with no indexer in these tests, but the registry now ships a default for
  // it, so blank it explicitly.
  getNetwork('signet').indexerBaseUrl = '';
});
afterAll(() => {
  getNetwork('testnet4').enabled = false;
});

describe('network switch sequencing', () => {
  beforeAll(() => {
    // Signet is deliberately left without an indexer (blanked above).
    configureIndexerEndpoints(
      { bitcoin: MAINNET_INDEXER, testnet4: TESTNET4_INDEXER },
      { bitcoin: MAINNET_ONION, testnet4: TESTNET4_ONION },
    );
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    setActiveNetwork('bitcoin');
    await persistNetworkId('bitcoin');
  });

  afterAll(() => setActiveNetwork('bitcoin'));

  // The commit-before-validate bug: the network used to be set and persisted first, so a chain
  // with no indexer left the module on signet, the stored preference on signet, and the UI on the
  // old chain — and a restart landed back on the broken state.
  it('refuses a chain with no indexer and leaves the active network and stored preference alone', async () => {
    setActiveNetwork('testnet4');
    await persistNetworkId('testnet4');

    await expect(switchNetworkBackends('signet')).rejects.toThrow(/Signet/);

    expect(getActiveNetworkId()).toBe('testnet4');
    expect(await readStoredNetworkId()).toBe('testnet4');
  });

  it('does not tear down the current chain when it refuses', async () => {
    await expect(switchNetworkBackends('signet')).rejects.toThrow();

    expect(Electrum.resetForNetworkSwitch).not.toHaveBeenCalled();
    expect(disconnectIndexer).not.toHaveBeenCalled();
    expect(initializeIndexer).not.toHaveBeenCalled();
  });

  it('switches, repoints the indexer and persists when the target has an indexer', async () => {
    await switchNetworkBackends('testnet4');

    expect(getActiveNetworkId()).toBe('testnet4');
    expect(await readStoredNetworkId()).toBe('testnet4');
    expect(Electrum.resetForNetworkSwitch).toHaveBeenCalledTimes(1);
    expect(initializeIndexer).toHaveBeenCalledWith(expect.objectContaining({ baseUrl: TESTNET4_INDEXER }));
  });

  // A single shared onion address would carry test-chain scans to the mainnet indexer over Tor.
  it('hands the indexer the active chain’s own onion address, never another chain’s', async () => {
    await switchNetworkBackends('testnet4');
    expect(initializeIndexer).toHaveBeenLastCalledWith(expect.objectContaining({ baseUrl: TESTNET4_INDEXER, onionUrl: TESTNET4_ONION }));

    await switchNetworkBackends('bitcoin');
    expect(initializeIndexer).toHaveBeenLastCalledWith(expect.objectContaining({ baseUrl: MAINNET_INDEXER, onionUrl: MAINNET_ONION }));
  });

  it('persists the preference last, so a failed indexer start never writes it', async () => {
    (initializeIndexer as jest.Mock).mockImplementationOnce(() => {
      throw new Error('indexer init failed');
    });

    await expect(switchNetworkBackends('testnet4')).rejects.toThrow('indexer init failed');

    expect(await readStoredNetworkId()).toBe('bitcoin');
  });

  it('rolls the module and the stored preference back to the previous chain', async () => {
    (initializeIndexer as jest.Mock).mockImplementationOnce(() => {
      throw new Error('indexer init failed');
    });
    await expect(switchNetworkBackends('testnet4')).rejects.toThrow();
    // The module has already moved by the time the indexer throws; the caller rolls it back.
    expect(getActiveNetworkId()).toBe('testnet4');

    await rollbackNetworkSwitch('bitcoin');

    expect(getActiveNetworkId()).toBe('bitcoin');
    expect(await readStoredNetworkId()).toBe('bitcoin');
    expect(initializeIndexer).toHaveBeenLastCalledWith(expect.objectContaining({ baseUrl: MAINNET_INDEXER }));
  });
});

describe('boot network', () => {
  beforeAll(() => configureIndexerEndpoints({ bitcoin: MAINNET_INDEXER, testnet4: TESTNET4_INDEXER }));
  beforeEach(() => {
    jest.clearAllMocks();
    setActiveNetwork('bitcoin');
  });
  afterAll(() => setActiveNetwork('bitcoin'));

  it('comes up on the stored chain when its indexer is configured', async () => {
    await persistNetworkId('testnet4');

    expect(await bootActiveNetwork()).toEqual({ id: 'testnet4' });
    expect(getActiveNetworkId()).toBe('testnet4');
    expect(initializeIndexer).toHaveBeenCalledWith(expect.objectContaining({ baseUrl: TESTNET4_INDEXER }));
  });

  // Without the fallback the app mounted on a chain whose indexer was never initialised, and the
  // first scan failed with "Silent Payment Indexer not initialized".
  it('falls back to mainnet when the stored chain has no indexer, without overwriting the preference', async () => {
    await persistNetworkId('signet');

    expect(await bootActiveNetwork()).toEqual({ id: 'bitcoin', fellBackFrom: 'signet', reason: 'no-indexer' });
    expect(getActiveNetworkId()).toBe('bitcoin');
    expect(initializeIndexer).toHaveBeenCalledWith(expect.objectContaining({ baseUrl: MAINNET_INDEXER }));
    // Kept, so configuring the signet indexer later puts the user back where they were.
    expect(await readStoredNetworkId()).toBe('signet');
  });
});
