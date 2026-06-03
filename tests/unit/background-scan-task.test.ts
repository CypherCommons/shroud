import { BIP352_ACTIVATION_HEIGHT } from '../../modules/constants.ts';
import type { ScanCredentials, StagedScanData } from '../../helpers/silent-payments/types.ts';
// jest.mock calls below are hoisted above this import by ts-jest
import { runBackgroundScan } from '../../helpers/silent-payments/BackgroundScanTask.ts';

const mockReadScanCredentials = jest.fn();
const mockReadStaging = jest.fn();
const mockAppendStagedUtxos = jest.fn();
const mockIsForegroundActive = jest.fn();
const mockPostLocalNotification = jest.fn();
const mockGetLatestBlockHeight = jest.fn();
const mockGetTransactionsByRange = jest.fn();
const mockProcessBatch = jest.fn();

jest.mock('../../helpers/silent-payments/BackgroundScanCredentials', () => ({
  readScanCredentials: () => mockReadScanCredentials(),
}));

jest.mock('../../helpers/silent-payments/ScanStagingStore', () => ({
  readStaging: () => mockReadStaging(),
  appendStagedUtxos: (...args: unknown[]) => mockAppendStagedUtxos(...args),
}));

jest.mock('../../helpers/silent-payments/ScanLock', () => ({
  isForegroundActive: () => mockIsForegroundActive(),
}));

jest.mock('../../modules/BackgroundScanManager', () => ({
  postLocalNotification: (...args: unknown[]) => mockPostLocalNotification(...args),
}));

jest.mock('../../modules/RustJsiBridge', () => ({
  initializeRustJsiBridge: () => true,
}));

jest.mock('../../modules/SilentPaymentIndexer', () => ({
  SilentPaymentIndexer: jest.fn().mockImplementation(() => ({
    getLatestBlockHeight: () => mockGetLatestBlockHeight(),
    getTransactionsByRange: (start: number, end: number) => mockGetTransactionsByRange(start, end),
  })),
}));

jest.mock('../../helpers/silent-payments/RustTransactionProcessor', () => ({
  RustTransactionProcessor: jest.fn().mockImplementation(() => ({
    processBatch: (...args: unknown[]) => mockProcessBatch(...args),
  })),
}));

// loc pulls in currency/AsyncStorage at module scope; stub the one string table we use
jest.mock('../../loc', () => ({
  notifications: { received_title: 'Payment received', received_body: 'You received bitcoin.' },
}));

const BIRTH = BIP352_ACTIVATION_HEIGHT + 1000;

function credentials(overrides: Partial<ScanCredentials> = {}): ScanCredentials {
  return {
    walletID: 'wallet-1',
    scanPrivkeyHex: '11'.repeat(32),
    spendPubkeyHex: '02' + '22'.repeat(32),
    silentPaymentAddress: 'sp1qtest',
    baseUrl: 'http://indexer.test',
    cursor: 0,
    birthHeight: BIRTH,
    schema: 1,
  };
}

function staging(overrides: Partial<StagedScanData> = {}): StagedScanData {
  return { walletID: 'wallet-1', cursor: 0, utxos: [], updatedAt: 0, schema: 1, ...overrides };
}

describe('runBackgroundScan', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsForegroundActive.mockResolvedValue(false);
    mockReadScanCredentials.mockResolvedValue(credentials());
    mockReadStaging.mockResolvedValue(null);
    mockAppendStagedUtxos.mockResolvedValue(undefined);
    mockPostLocalNotification.mockResolvedValue(undefined);
    mockGetTransactionsByRange.mockResolvedValue({ transactions: [] });
    mockProcessBatch.mockResolvedValue([]);
  });

  it('bails when the foreground app is active', async () => {
    mockIsForegroundActive.mockResolvedValue(true);

    const result = await runBackgroundScan({ timeBudgetMs: 25000 });

    expect(result.bailedReason).toBe('foreground-active');
    expect(mockReadScanCredentials).not.toHaveBeenCalled();
  });

  it('bails when no credentials are provisioned', async () => {
    mockReadScanCredentials.mockResolvedValue(null);

    const result = await runBackgroundScan({ timeBudgetMs: 25000 });

    expect(result.bailedReason).toBe('no-credentials');
  });

  it('bails when the indexer is unreachable', async () => {
    mockGetLatestBlockHeight.mockRejectedValue(new Error('network down'));

    const result = await runBackgroundScan({ timeBudgetMs: 25000 });

    expect(result.bailedReason).toBe('indexer-unreachable');
    expect(mockAppendStagedUtxos).not.toHaveBeenCalled();
  });

  it('scans from the birth height for a never-scanned wallet and stages per range', async () => {
    mockGetLatestBlockHeight.mockResolvedValue({ height: BIRTH + 99 }); // 100 blocks = 2 ranges

    const result = await runBackgroundScan({ timeBudgetMs: 60000 });

    expect(result.bailedReason).toBeUndefined();
    expect(result.caughtUp).toBe(true);
    expect(result.blocksScanned).toBe(100);
    expect(mockGetTransactionsByRange).toHaveBeenNthCalledWith(1, BIRTH, BIRTH + 49);
    expect(mockGetTransactionsByRange).toHaveBeenNthCalledWith(2, BIRTH + 50, BIRTH + 99);
    // cursor staged once per range, only after that range's fetch+scan succeeded
    expect(mockAppendStagedUtxos).toHaveBeenNthCalledWith(1, 'wallet-1', [], BIRTH + 49);
    expect(mockAppendStagedUtxos).toHaveBeenNthCalledWith(2, 'wallet-1', [], BIRTH + 99);
    expect(mockPostLocalNotification).not.toHaveBeenCalled();
  });

  it('resumes from the highest of credentials and staging cursors', async () => {
    mockReadScanCredentials.mockResolvedValue(credentials({ cursor: BIRTH + 10 }));
    mockReadStaging.mockResolvedValue(staging({ cursor: BIRTH + 60 }));
    mockGetLatestBlockHeight.mockResolvedValue({ height: BIRTH + 80 });

    const result = await runBackgroundScan({ timeBudgetMs: 60000 });

    expect(mockGetTransactionsByRange).toHaveBeenCalledTimes(1);
    expect(mockGetTransactionsByRange).toHaveBeenCalledWith(BIRTH + 61, BIRTH + 80);
    expect(result.newCursor).toBe(BIRTH + 80);
  });

  it('ignores staging that belongs to another wallet', async () => {
    mockReadStaging.mockResolvedValue(staging({ walletID: 'other-wallet', cursor: BIRTH + 60 }));
    mockGetLatestBlockHeight.mockResolvedValue({ height: BIRTH + 49 });

    await runBackgroundScan({ timeBudgetMs: 60000 });

    expect(mockGetTransactionsByRange).toHaveBeenCalledWith(BIRTH, BIRTH + 49);
  });

  it('stops at a failed range without advancing the cursor past it', async () => {
    mockGetLatestBlockHeight.mockResolvedValue({ height: BIRTH + 149 }); // 3 ranges
    mockGetTransactionsByRange.mockResolvedValueOnce({ transactions: [] }).mockRejectedValueOnce(new Error('range fetch failed'));

    const result = await runBackgroundScan({ timeBudgetMs: 60000 });

    expect(result.bailedReason).toBeUndefined();
    expect(result.caughtUp).toBe(false);
    expect(result.newCursor).toBe(BIRTH + 49); // only the successful range
    expect(mockAppendStagedUtxos).toHaveBeenCalledTimes(1);
  });

  it('stops when the time budget is exhausted', async () => {
    mockGetLatestBlockHeight.mockResolvedValue({ height: BIRTH + 10_000 });
    // Budget = safety margin → deadline already passed when the loop starts
    const result = await runBackgroundScan({ timeBudgetMs: 2000 });

    expect(result.blocksScanned).toBe(0);
    expect(result.caughtUp).toBe(false);
    expect(mockGetTransactionsByRange).not.toHaveBeenCalled();
  });

  it('posts a notification when new UTXOs are found and stages them with the cursor', async () => {
    mockGetLatestBlockHeight.mockResolvedValue({ height: BIRTH + 49 });
    const tx = { id: 'tx1', blockHeight: BIRTH + 5, blockHash: 'h', blockTime: 1, scanTweak: 'ab', outputs: [{}] };
    mockGetTransactionsByRange.mockResolvedValue({ transactions: [tx] });
    const found = {
      txid: 'f'.repeat(64),
      vout: 0,
      value: 1234,
      height: BIRTH + 5,
      address: 'bc1ptest',
      silentPaymentAddress: 'sp1qtest',
      pubKey: '02ab',
      tweak: new Uint8Array([0xaa, 0xbb]),
      blockHash: 'h',
      blockTime: 1,
      isSpent: false,
    };
    mockProcessBatch.mockResolvedValue([found]);

    const result = await runBackgroundScan({ timeBudgetMs: 60000 });

    expect(result.newUtxos).toBe(1);
    expect(mockAppendStagedUtxos).toHaveBeenCalledWith(
      'wallet-1',
      [expect.objectContaining({ txid: 'f'.repeat(64), tweakHex: 'aabb' })],
      BIRTH + 49,
    );
    expect(mockPostLocalNotification).toHaveBeenCalledTimes(1);
  });

  it('still succeeds when the notification fails to post', async () => {
    mockGetLatestBlockHeight.mockResolvedValue({ height: BIRTH + 49 });
    mockGetTransactionsByRange.mockResolvedValue({
      transactions: [{ id: 'tx1', blockHeight: BIRTH + 5, blockHash: 'h', blockTime: 1, scanTweak: 'ab', outputs: [{}] }],
    });
    mockProcessBatch.mockResolvedValue([
      {
        txid: 'f'.repeat(64),
        vout: 0,
        value: 1,
        height: BIRTH + 5,
        address: 'a',
        silentPaymentAddress: 's',
        pubKey: 'p',
        tweak: new Uint8Array([1]),
        blockHash: 'h',
        blockTime: 1,
        isSpent: false,
      },
    ]);
    mockPostLocalNotification.mockRejectedValue(new Error('not linked'));

    const result = await runBackgroundScan({ timeBudgetMs: 60000 });

    expect(result.bailedReason).toBeUndefined();
    expect(result.newUtxos).toBe(1);
  });
});
