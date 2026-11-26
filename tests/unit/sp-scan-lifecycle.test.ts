import * as Electrum from '../../modules/Electrum';
import { AbstractHDElectrumWallet } from '../../class/wallets/abstract-hd-electrum-wallet';
import { HDSilentPaymentsWallet } from '../../class/wallets/hd-bip352-wallet';
import { type ScanStateInfo } from '../../helpers/silent-payments/types';
import { defer } from '../helpers/defer';
import { spCoin as coin, stubIndexer, TIP } from '../helpers/silentPayments';

jest.mock('../../modules/Electrum', () => ({
  multiGetUtxoByAddress: jest.fn(),
  multiGetHistoryByAddress: jest.fn(),
}));

const TEST_SEED = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

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
    jest.clearAllMocks(); // the Electrum mocks count calls across tests otherwise
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

    it('backs off from the failure itself, so the first retry after a failed check is a full 30s away', async () => {
      jest.useFakeTimers();
      const getLatestBlockHeight = jest.fn().mockResolvedValue({ height: TIP });
      stubIndexer({ getLatestBlockHeight });
      const wallet = track(syncedWallet());
      await wallet.scanForPayments(); // 0s: caught up, the next poll is due at 30s

      await jest.advanceTimersByTimeAsync(20_000);
      getLatestBlockHeight.mockRejectedValue(new Error('indexer down'));
      await expect(wallet.checkForPayments()).rejects.toThrow('indexer down'); // 20s: a check fails

      await jest.advanceTimersByTimeAsync(10_000); // 30s: no poll, it would have been 10s after the failure
      expect(getLatestBlockHeight).toHaveBeenCalledTimes(2);

      await jest.advanceTimersByTimeAsync(20_000); // 50s: 30s after the failure
      expect(getLatestBlockHeight).toHaveBeenCalledTimes(3);
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
    jest.useFakeTimers({ doNotFake: ['setImmediate'] }); // for the spent check's 20s wait, left running
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

  it('reports a scan the unknown birth height kept from starting, and stops polling, leaving its retries to refreshes', async () => {
    stubIndexer({ getBlockHeightByTimestamp: jest.fn().mockRejectedValue(new Error('indexer down')) });
    const wallet = track(syncedWallet(0));
    wallet.updateBirthHeight(0, { pendingTimestamp: 1_750_000_000 });
    (wallet as any)._schedulePoll(30_000);

    await expect(wallet.scanForPayments()).rejects.toThrow('BIRTH_HEIGHT_PENDING');

    // not "caught up": nothing was scanned
    expect(wallet.getScanState().status).toBe('error');
    expect((wallet as any)._pollTimer).toBeNull();
  });

  describe('a pause', () => {
    it('is dropped with the scan it paused, so a scan that failed while paused doesn’t hold up the next', async () => {
      const windowFetched = defer<void>();
      const scanForwardWithCallback = jest
        .fn()
        .mockImplementationOnce(async () => {
          await windowFetched.promise;
          throw new Error('Failed to fetch range: socket closed');
        })
        .mockImplementation(async (_from: number, to: number, onRange: (txs: unknown[], end: number) => Promise<number>) => {
          await onRange([], to);
        });
      stubIndexer({ getLatestBlockHeight: jest.fn().mockResolvedValue({ height: TIP + 2 }), scanForwardWithCallback });
      const wallet = track(syncedWallet());

      const first = wallet.scanForPayments();
      await flush();
      wallet.pauseScan(); // as the app does on its way into the background
      windowFetched.resolve();
      await expect(first).rejects.toThrow('socket closed');

      // the retry (or the next poll) scans to the end instead of waiting on a pause nobody will lift
      await expect(wallet.checkForPayments()).resolves.toBe(0);
      expect(wallet.getScanState()).toMatchObject({ status: 'idle', lastScannedBlock: TIP + 2 });
    });

    it('that lands before the scan gets going starts it paused, rather than reading as scanning while it waits', async () => {
      const tip = defer<{ height: number }>();
      const scanForwardWithCallback = jest.fn(
        async (_from: number, to: number, onRange: (txs: unknown[], end: number) => Promise<number>) => {
          await onRange([], to);
        },
      );
      stubIndexer({ getLatestBlockHeight: jest.fn(() => tip.promise), scanForwardWithCallback });
      const wallet = track(syncedWallet());

      const scan = wallet.scanForPayments();
      wallet.pauseScan();
      tip.resolve({ height: TIP + 2 });
      await flush();
      expect(wallet.getScanState().status).toBe('paused');

      wallet.resumeScan();
      await expect(scan).resolves.toBe(0);
      expect(wallet.getScanState()).toMatchObject({ status: 'idle', lastScannedBlock: TIP + 2 });
    });
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
      regular.fetchBalance.mockImplementation(async function (this: HDSilentPaymentsWallet) {
        (this as any)._balances_by_external_index[0] = { c: 5000, u: 0 }; // a payment to a regular address
      });
      const onBalanceChange = jest.fn();
      const onPersist = jest.fn();
      wallet.setOnBalanceChangeCallback(onBalanceChange);
      wallet.setOnPersistCallback(onPersist);

      await wallet.checkForPayments();

      expect(onBalanceChange).toHaveBeenCalled();
      expect(onPersist).toHaveBeenCalled();
    });

    it('neither re-renders nor saves when the regular sync fetched nothing new', async () => {
      stubIndexer();
      const wallet = track(syncedWallet());
      const onBalanceChange = jest.fn();
      const onPersist = jest.fn();
      wallet.setOnBalanceChangeCallback(onBalanceChange);
      wallet.setOnPersistCallback(onPersist);

      await wallet.checkForPayments();

      expect(onBalanceChange).not.toHaveBeenCalled();
      expect(onPersist).not.toHaveBeenCalled();
    });

    it('shares a regular sync still running from an earlier check, rather than sending its requests again', async () => {
      jest.useFakeTimers();
      stubIndexer();
      regular.fetchBalance.mockReturnValue(new Promise(() => {})); // a connection that died without an error
      const wallet = track(syncedWallet());

      const first = wallet.checkForPayments();
      await jest.advanceTimersByTimeAsync(20_000);
      await first;

      const second = wallet.checkForPayments();
      await jest.advanceTimersByTimeAsync(20_000);
      await second;

      expect(regular.fetchBalance).toHaveBeenCalledTimes(1);
    });

    it('stops waiting on a spent check that never answers after 20s', async () => {
      jest.useFakeTimers();
      const indexer = stubIndexer();
      const wallet = track(syncedWallet());
      (wallet as any)._utxo = [coin('aa', 'addr-a')];
      (Electrum.multiGetUtxoByAddress as jest.Mock).mockReturnValue(new Promise(() => {}));

      let settled = false;
      wallet.checkForPayments().finally(() => {
        settled = true;
      });
      await jest.advanceTimersByTimeAsync(19_999);
      expect(settled).toBe(false);

      await jest.advanceTimersByTimeAsync(1);
      expect(settled).toBe(true);

      // and the next check runs, rather than joining the one stuck behind it
      const next = wallet.checkForPayments();
      await jest.advanceTimersByTimeAsync(20_000);
      await expect(next).resolves.toBe(0);
      expect(indexer.getLatestBlockHeight).toHaveBeenCalledTimes(2);
      expect(Electrum.multiGetUtxoByAddress).toHaveBeenCalledTimes(1); // the spent check still running is shared
    });

    it('rejects when the birth height is still being looked up, since nothing was checked', async () => {
      stubIndexer({ getBlockHeightByTimestamp: jest.fn().mockRejectedValue(new Error('indexer down')) });
      const wallet = track(syncedWallet(0));
      wallet.updateBirthHeight(0, { pendingTimestamp: 1_750_000_000 });

      await expect(wallet.checkForPayments()).rejects.toThrow('BIRTH_HEIGHT_PENDING');
      expect(wallet.getScanState().status).toBe('error');
    });

    it('rejects when the wallet’s scanning is cancelled while it runs', async () => {
      const tip = defer<{ height: number }>();
      stubIndexer({ getLatestBlockHeight: jest.fn(() => tip.promise) });
      const wallet = track(syncedWallet());

      const check = wallet.checkForPayments();
      wallet.cancelScan();
      tip.resolve({ height: TIP + 2 });

      await expect(check).rejects.toThrow('SCAN_CANCELLED');
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
