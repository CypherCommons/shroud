import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { ShroudApp } from '../../class';
import { HDSilentPaymentsWallet } from '../../class/wallets/hd-bip352-wallet.ts';
import { StorageProvider } from '../../components/Context/StorageProvider';
import { useStorage } from '../../hooks/context/useStorage';
import { DEFAULT_NETWORK_ID, setActiveNetwork, type NetworkId } from '../../modules/network';
import { switchNetworkBackends } from '../../modules/networkPreference';

const fakeIndexer = {
  getLatestBlockHeight: jest.fn(async () => ({ height: 900_100 })),
  scanForwardWithCallback: jest.fn(async () => undefined),
};

jest.mock('../../modules/SilentPaymentIndexer', () => ({
  getDefaultIndexer: () => fakeIndexer,
}));

jest.mock('../../modules/networkPreference', () => {
  const network = jest.requireActual('../../modules/network');
  return {
    assertNetworkSwitchable: jest.fn(),
    switchNetworkBackends: jest.fn(async (next: NetworkId) => network.setActiveNetwork(next)),
    rollbackNetworkSwitch: jest.fn(async (previous: NetworkId) => network.setActiveNetwork(previous)),
  };
});

const SEED = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const shroudApp = ShroudApp.getInstance();

function makeWallet(): HDSilentPaymentsWallet {
  const wallet = new HDSilentPaymentsWallet();
  wallet.setSecret(SEED);
  (wallet as any).lastScannedBlock = 900_000;
  return wallet;
}

afterEach(() => {
  jest.clearAllMocks();
  setActiveNetwork(DEFAULT_NETWORK_ID);
  shroudApp.wallets = [];
});

describe('StorageProvider switchNetwork', () => {
  const renderStorage = () => {
    jest.spyOn(shroudApp, 'saveToDisk').mockResolvedValue(undefined);
    return renderHook(() => useStorage(), { wrapper: ({ children }) => <StorageProvider>{children}</StorageProvider> });
  };

  it('restarts the scan after switching away and back', async () => {
    const wallet = makeWallet();
    shroudApp.wallets = [wallet];
    const { result } = renderStorage();

    await act(() => result.current.switchNetwork('signet'));
    // Really off mainnet, and the mainnet wallet must not scan the signet indexer meanwhile.
    await act(() => wallet.scanForPayments());
    expect(fakeIndexer.scanForwardWithCallback).not.toHaveBeenCalled();

    await act(() => result.current.switchNetwork('bitcoin'));
    await waitFor(() => expect(fakeIndexer.scanForwardWithCallback).toHaveBeenCalledTimes(1));
  });

  it('restarts the scan after a failed switch', async () => {
    const wallet = makeWallet();
    shroudApp.wallets = [wallet];
    (switchNetworkBackends as jest.Mock).mockRejectedValueOnce(new Error('indexer init failed'));
    const { result } = renderStorage();

    await act(() => expect(result.current.switchNetwork('signet')).rejects.toThrow('indexer init failed'));
    await waitFor(() => expect(fakeIndexer.scanForwardWithCallback).toHaveBeenCalledTimes(1));
  });
});
