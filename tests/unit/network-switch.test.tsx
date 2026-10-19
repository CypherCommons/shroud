import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { ShroudApp } from '../../class';
import { HDSilentPaymentsWallet } from '../../class/wallets/hd-bip352-wallet.ts';
import { StorageProvider } from '../../components/Context/StorageProvider';
import { useStorage } from '../../hooks/context/useStorage';
import * as RustJsiBridge from '../../modules/RustJsiBridge';
import { DEFAULT_NETWORK_ID, setActiveNetwork, type NetworkId } from '../../modules/network';
import { switchNetworkBackends } from '../../modules/networkPreference';

const fakeIndexer = {
  getLatestBlockHeight: jest.fn(async () => ({ height: 900_100 })),
  scanForwardWithCallback: jest.fn(async () => undefined),
  getTransactionByTxid: jest.fn(async () => ({
    transaction: { txid: 'aa'.repeat(32), blockHeight: 900_050, scanTweak: '02' + '11'.repeat(32), outputs: [{ vout: 0 }] },
  })),
};

jest.mock('../../modules/SilentPaymentIndexer', () => ({
  getDefaultIndexer: () => fakeIndexer,
}));

jest.mock('../../modules/Electrum', () => ({
  ...jest.requireActual('../../modules/Electrum'),
  multiGetTransactionByTxid: jest.fn(async () => ({})),
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
const TXID = 'aa'.repeat(32);
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

describe('a cancelled scan', () => {
  it('stays stopped until allowScanning is called', async () => {
    const wallet = makeWallet();

    await wallet.cancelScanAndWait();
    await wallet.scanForPayments();
    expect(fakeIndexer.scanForwardWithCallback).not.toHaveBeenCalled();

    wallet.allowScanning();
    await wallet.scanForPayments();
    expect(fakeIndexer.scanForwardWithCallback).toHaveBeenCalledTimes(1);
  });

  it('keeps Track a payment from checking silent payments until allowScanning is called', async () => {
    const scanSpy = jest
      .spyOn(RustJsiBridge, 'spScanTransactions')
      .mockReturnValue({ transactionsScanned: 1, outputsScanned: 1, matchedUtxos: [] } as any);
    const wallet = makeWallet();

    await wallet.cancelScanAndWait();
    await wallet.scanByTxid(TXID);
    expect(scanSpy).not.toHaveBeenCalled();

    wallet.allowScanning();
    await wallet.scanByTxid(TXID);
    expect(scanSpy).toHaveBeenCalledTimes(1);
    scanSpy.mockRestore();
  });
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
    expect(result.current.wallets).toEqual([]);
    await act(() => wallet.scanForPayments());
    expect(fakeIndexer.scanForwardWithCallback).not.toHaveBeenCalled();

    await act(() => result.current.switchNetwork('bitcoin'));
    expect(result.current.wallets).toEqual([wallet]);
    await waitFor(() => expect(fakeIndexer.scanForwardWithCallback).toHaveBeenCalledTimes(1));
  });

  it('restarts the scan after a failed switch', async () => {
    const wallet = makeWallet();
    shroudApp.wallets = [wallet];
    (switchNetworkBackends as jest.Mock).mockRejectedValueOnce(new Error('indexer init failed'));
    const { result } = renderStorage();

    await act(() => expect(result.current.switchNetwork('signet')).rejects.toThrow('indexer init failed'));

    expect(result.current.activeNetworkId).toBe('bitcoin');
    await waitFor(() => expect(fakeIndexer.scanForwardWithCallback).toHaveBeenCalledTimes(1));
  });
});
