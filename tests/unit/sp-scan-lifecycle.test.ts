import * as Electrum from '../../modules/Electrum';
import { AbstractHDElectrumWallet } from '../../class/wallets/abstract-hd-electrum-wallet';
import { HDSilentPaymentsWallet } from '../../class/wallets/hd-bip352-wallet';
import { type ScanStateInfo, type SilentPaymentUTXO } from '../../helpers/silent-payments/types';
import { SCAN_SLICE_SIZE } from '../../helpers/silent-payments/RustTransactionProcessor';
import { spScanTransactions } from '../../modules/RustJsiBridge';
import * as indexerModule from '../../modules/SilentPaymentIndexer';

jest.mock('../../modules/Electrum', () => ({
  multiGetUtxoByAddress: jest.fn(),
  multiGetHistoryByAddress: jest.fn(),
}));
jest.mock('../../modules/RustJsiBridge', () => ({
  ...jest.requireActual('../../modules/RustJsiBridge'),
  spScanTransactions: jest.fn(),
}));

const TEST_SEED = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const TIP = 900_000;

const stubIndexer = (overrides: Record<string, any> = {}) => {
  const indexer = {
    getLatestBlockHeight: jest.fn().mockResolvedValue({ height: TIP }),
    getBlockHeightByTimestamp: jest.fn(),
    scanForwardWithCallback: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  jest.spyOn(indexerModule, 'getDefaultIndexer').mockReturnValue(indexer as any);
  return indexer;
};

/** A wallet that has already scanned up to `lastScannedBlock`. */
const syncedWallet = (lastScannedBlock = TIP) => {
  const wallet = new HDSilentPaymentsWallet();
  wallet.setSecret(TEST_SEED);
  (wallet as any).lastScannedBlock = lastScannedBlock;
  return wallet;
};

const recordStates = (wallet: HDSilentPaymentsWallet) => {
  const states: ScanStateInfo[] = [];
  wallet.setOnScanStateChangeCallback(state => states.push(state));
  return states;
};

const coin = (txid: string, address: string): SilentPaymentUTXO => ({
  txid,
  vout: 0,
  value: 1000,
  height: TIP + 1,
  address,
  silentPaymentAddress: '',
  pubKey: '',
  tweak: new Uint8Array(32),
  blockHash: '',
  blockTime: 0,
  isSpent: false,
});

const defer = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(_resolve => {
    resolve = _resolve;
  });
  return { promise, resolve };
};

const flush = () => new Promise(resolve => setImmediate(resolve));

describe('scan lifecycle', () => {
  let wallets: HDSilentPaymentsWallet[];
  let regular: { fetchBalance: jest.SpyInstance; fetchTransactions: jest.SpyInstance };

  const track = (wallet: HDSilentPaymentsWallet) => {
    wallets.push(wallet);
    return wallet;
  };

  beforeEach(() => {
    wallets = [];
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    (Electrum.multiGetUtxoByAddress as jest.Mock).mockResolvedValue({});
    (Electrum.multiGetHistoryByAddress as jest.Mock).mockResolvedValue({});
    regular = {
      fetchBalance: jest.spyOn(AbstractHDElectrumWallet.prototype, 'fetchBalance').mockResolvedValue(undefined),
      fetchTransactions: jest.spyOn(AbstractHDElectrumWallet.prototype, 'fetchTransactions').mockResolvedValue(undefined),
    };
  });

  afterEach(() => {
    // stops any polling interval a test started
    wallets.forEach(wallet => wallet.cancelScan());
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('a check that finds the wallet caught up', () => {
    it('clears an error an earlier failed check left behind', async () => {
      stubIndexer({ getLatestBlockHeight: jest.fn().mockRejectedValueOnce(new Error('indexer down')).mockResolvedValue({ height: TIP }) });
      const wallet = track(syncedWallet());
      const states = recordStates(wallet);

      await expect(wallet.scanForPayments()).rejects.toThrow('indexer down');
      expect(wallet.getScanState()).toMatchObject({ status: 'error', error: 'indexer down' });

      await expect(wallet.scanForPayments()).resolves.toBe(0);
      expect(wallet.getScanState()).toMatchObject({ status: 'idle', error: null });
      expect(states.map(state => state.status)).toEqual(['error', 'idle']);
    });

    it('emits nothing once the state already says so', async () => {
      stubIndexer();
      const wallet = track(syncedWallet());
      await wallet.scanForPayments();

      const states = recordStates(wallet);
      await wallet.scanForPayments();
      await wallet.scanForPayments();

      expect(states).toEqual([]);
    });

    it('starts polling, so a wallet already at the tip still watches for new blocks', async () => {
      jest.useFakeTimers();
      const indexer = stubIndexer();
      const wallet = track(syncedWallet());

      await wallet.scanForPayments();
      expect(indexer.getLatestBlockHeight).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(30_000);
      expect(indexer.getLatestBlockHeight).toHaveBeenCalledTimes(2);
    });
  });

  describe('a failed check', () => {
    it('keeps polling, backing off while checks keep failing and returning to every tick after one succeeds', async () => {
      jest.useFakeTimers();
      const getLatestBlockHeight = jest.fn().mockRejectedValue(new Error('indexer down'));
      stubIndexer({ getLatestBlockHeight });
      const wallet = track(syncedWallet());

      await expect(wallet.scanForPayments()).rejects.toThrow('indexer down'); // 0s: the next poll is 30s away
      await jest.advanceTimersByTimeAsync(30_000); // 30s: polls, fails again, so it skips a tick
      expect(getLatestBlockHeight).toHaveBeenCalledTimes(2);

      await jest.advanceTimersByTimeAsync(30_000); // 60s: skipped
      expect(getLatestBlockHeight).toHaveBeenCalledTimes(2);

      getLatestBlockHeight.mockResolvedValue({ height: TIP });
      await jest.advanceTimersByTimeAsync(30_000); // 90s: polls and gets through
      expect(getLatestBlockHeight).toHaveBeenCalledTimes(3);
      expect(wallet.getScanState().status).toBe('idle');

      await jest.advanceTimersByTimeAsync(30_000); // 120s: every tick again
      expect(getLatestBlockHeight).toHaveBeenCalledTimes(4);
    });

    it('reports the same failure only once', async () => {
      stubIndexer({ getLatestBlockHeight: jest.fn().mockRejectedValue(new Error('indexer down')) });
      const wallet = track(syncedWallet());
      const states = recordStates(wallet);

      await expect(wallet.scanForPayments()).rejects.toThrow();
      await expect(wallet.scanForPayments()).rejects.toThrow();

      expect(states.map(state => state.status)).toEqual(['error']);
    });
  });

  it('frees the scan for the next check while the spent check still waits on Electrum', async () => {
    const indexer = stubIndexer();
    const wallet = track(syncedWallet());
    (wallet as any)._utxo = [coin('aa', 'addr-a')];
    // Electrum requests have no timeout, so this one never answers
    (Electrum.multiGetUtxoByAddress as jest.Mock).mockReturnValue(new Promise(() => {}));

    wallet.scanForPayments();
    await flush();
    expect(wallet.isScanActive()).toBe(false);

    wallet.scanForPayments();
    await flush();
    expect(indexer.getLatestBlockHeight).toHaveBeenCalledTimes(2);
  });

  it('leaves a window unscanned when the scan is cancelled between its slices', async () => {
    const window = Array.from({ length: SCAN_SLICE_SIZE + 1 }, (_, i) => ({
      id: `tx${i}`,
      blockHeight: TIP,
      blockHash: 'h',
      blockTime: 0,
      scanTweak: 'aa',
      outputs: [{ transactionId: `tx${i}`, vout: 0, pubKey: 'bb', value: 1000, isSpent: false }],
    }));
    stubIndexer({
      scanForwardWithCallback: jest.fn(async (_from: number, to: number, onRange: (txs: unknown[], end: number) => Promise<number>) => {
        await onRange(window, to);
      }),
    });
    const wallet = track(syncedWallet(TIP - 10));
    // the user leaves the chain while the first slice is being scanned
    (spScanTransactions as jest.Mock).mockImplementation(() => {
      wallet.cancelScan();
      return { transactionsScanned: SCAN_SLICE_SIZE, outputsScanned: 0, matchedUtxos: [] };
    });

    await expect(wallet.scanForPayments()).resolves.toBe(0);

    expect(spScanTransactions).toHaveBeenCalledTimes(1);
    expect(wallet.getScanState()).toMatchObject({ status: 'idle', lastScannedBlock: TIP - 10 });
  });

  it('stops polling while the birth height is still unknown, leaving its retries to refreshes', async () => {
    stubIndexer({ getBlockHeightByTimestamp: jest.fn().mockRejectedValue(new Error('indexer down')) });
    const wallet = track(syncedWallet(0));
    wallet.updateBirthHeight(0, { pendingTimestamp: 1_750_000_000 });
    (wallet as any).startPolling();

    await expect(wallet.scanForPayments()).resolves.toBe(0);

    expect((wallet as any).isPollingActive).toBe(false);
  });

  describe('checkForPayments', () => {
    it('resolves with the payments the scan found, once the scan has finished', async () => {
      const windowFetched = defer<void>();
      stubIndexer({
        getLatestBlockHeight: jest.fn().mockResolvedValue({ height: TIP + 2 }),
        scanForwardWithCallback: jest.fn(async (_from: number, to: number, onRange: (txs: unknown[], end: number) => Promise<number>) => {
          await windowFetched.promise;
          await onRange([], to);
        }),
      });
      const wallet = track(syncedWallet());
      jest.spyOn(wallet as any, 'processTransactions').mockResolvedValue({ utxos: [coin('aa', 'addr-a')], lastScannedBlock: TIP + 2 });

      let settled = false;
      const check = wallet.checkForPayments().finally(() => {
        settled = true;
      });
      await flush();
      expect(settled).toBe(false);

      windowFetched.resolve();
      await expect(check).resolves.toBe(1);
      expect(wallet.getScanState()).toMatchObject({ status: 'idle', lastScannedBlock: TIP + 2 });
    });

    it('rejects when the scan fails', async () => {
      stubIndexer({ getLatestBlockHeight: jest.fn().mockRejectedValue(new Error('indexer down')) });
      const wallet = track(syncedWallet());

      await expect(wallet.checkForPayments()).rejects.toThrow('indexer down');
      expect(wallet.getScanState().status).toBe('error');
    });

    it('resolves when only the regular sync fails, since that says nothing about the scan', async () => {
      stubIndexer();
      regular.fetchBalance.mockRejectedValue(new Error('electrum down'));
      const wallet = track(syncedWallet());

      await expect(wallet.checkForPayments()).resolves.toBe(0);
    });

    it('syncs the regular addresses while the scan looks up the tip, not after', async () => {
      const tip = defer<{ height: number }>();
      stubIndexer({ getLatestBlockHeight: jest.fn(() => tip.promise) });
      const wallet = track(syncedWallet());

      const check = wallet.checkForPayments();
      await flush();
      expect(regular.fetchBalance).toHaveBeenCalledTimes(1);
      expect(regular.fetchTransactions).toHaveBeenCalledTimes(1);

      tip.resolve({ height: TIP });
      await expect(check).resolves.toBe(0);
    });

    it('shows and saves what the regular sync fetched', async () => {
      stubIndexer();
      const wallet = track(syncedWallet());
      const onBalanceChange = jest.fn();
      const onPersist = jest.fn();
      wallet.setOnBalanceChangeCallback(onBalanceChange);
      wallet.setOnPersistCallback(onPersist);

      await wallet.checkForPayments();

      expect(onBalanceChange).toHaveBeenCalled();
      expect(onPersist).toHaveBeenCalled();
    });

    it('stops waiting on a regular sync that never answers after 20s', async () => {
      jest.useFakeTimers();
      stubIndexer();
      regular.fetchBalance.mockReturnValue(new Promise(() => {}));
      const wallet = track(syncedWallet());

      let settled = false;
      wallet.checkForPayments().finally(() => {
        settled = true;
      });
      await jest.advanceTimersByTimeAsync(19_999);
      expect(settled).toBe(false);

      await jest.advanceTimersByTimeAsync(1);
      expect(settled).toBe(true);
    });

    it('shares one run between checks started together', async () => {
      const indexer = stubIndexer();
      const wallet = track(syncedWallet());

      const first = wallet.checkForPayments();
      expect(wallet.checkForPayments()).toBe(first);
      await first;

      expect(regular.fetchBalance).toHaveBeenCalledTimes(1);
      expect(indexer.getLatestBlockHeight).toHaveBeenCalledTimes(1);
    });

    it('joins a scan already in flight instead of starting another', async () => {
      const tip = defer<{ height: number }>();
      const indexer = stubIndexer({ getLatestBlockHeight: jest.fn(() => tip.promise) });
      const wallet = track(syncedWallet());

      const poll = wallet.scanForPayments();
      const check = wallet.checkForPayments();
      tip.resolve({ height: TIP });

      await expect(Promise.all([poll, check])).resolves.toEqual([0, 0]);
      expect(indexer.getLatestBlockHeight).toHaveBeenCalledTimes(1);
    });

    it('rejects for a wallet whose scanning was cancelled, without asking Electrum or the indexer', async () => {
      const indexer = stubIndexer();
      const wallet = track(syncedWallet());
      wallet.cancelScan();

      await expect(wallet.checkForPayments()).rejects.toThrow('SCAN_CANCELLED');
      expect(regular.fetchBalance).not.toHaveBeenCalled();
      expect(indexer.getLatestBlockHeight).not.toHaveBeenCalled();
    });
  });
});
