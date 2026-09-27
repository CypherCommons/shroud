import { HDSilentPaymentsWallet } from '../../class/wallets/hd-bip352-wallet';
import { BIP352_ACTIVATION_HEIGHT } from '../../modules/constants';
import * as indexerModule from '../../modules/SilentPaymentIndexer';
import { SilentPaymentIndexer } from '../../modules/SilentPaymentIndexer';

const TEST_SEED = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const CREATED_AT = 1_750_000_000; // some unix-seconds timestamp
const TIP = 900_000;
const RESOLVED = 890_000;

const stubIndexer = (overrides: Record<string, any> = {}) => {
  const scanForwardWithCallback = jest.fn().mockResolvedValue(undefined);
  jest.spyOn(indexerModule, 'getDefaultIndexer').mockReturnValue({
    getLatestBlockHeight: jest.fn().mockResolvedValue({ height: TIP }),
    getBlockHeightByTimestamp: jest.fn().mockResolvedValue({ blockHeight: RESOLVED }),
    scanForwardWithCallback,
    ...overrides,
  } as any);
  return scanForwardWithCallback;
};

const makeWallet = () => {
  const w = new HDSilentPaymentsWallet();
  w.setSecret(TEST_SEED);
  return w;
};

const pendingWallet = () => {
  const w = makeWallet();
  w.updateBirthHeight(BIP352_ACTIVATION_HEIGHT, { pendingTimestamp: CREATED_AT });
  return w;
};

describe('deferred birth height (indexer down at creation/import)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('setting an explicit birth height clears any pending timestamp', () => {
    const w = pendingWallet();
    w.updateBirthHeight(880_000, { resetScan: true });
    expect(w.getPendingBirthTimestamp()).toBeNull();
  });

  it('rejects a non-integer birth height', () => {
    expect(() => makeWallet().updateBirthHeight(890_000.5)).toThrow(/Invalid birth height/);
  });

  it('survives a serialize/restore round trip, so an app restart still defers instead of rescanning', () => {
    const w = pendingWallet();
    w.prepareForSerialization();

    const restored = HDSilentPaymentsWallet.fromJson(JSON.stringify({ ...w, type: (w as any).type }));

    expect(restored.getPendingBirthTimestamp()).toBe(CREATED_AT);
  });

  it('resolves the pending timestamp to a real height and scans from there, not from activation', async () => {
    const scan = stubIndexer();
    const w = pendingWallet();

    await w.scanForPayments();

    expect(w.getPendingBirthTimestamp()).toBeNull();
    expect(scan).toHaveBeenCalledWith(RESOLVED, TIP, expect.anything(), expect.anything(), expect.anything());
  });

  it.each([
    ['a missing blockHeight', {}],
    ['a null blockHeight', { blockHeight: null }],
    ['a fractional blockHeight', { blockHeight: 890_000.5 }],
  ])('skips the scan on %s instead of silently rescanning from activation', async (_label, response) => {
    const scan = stubIndexer({ getBlockHeightByTimestamp: jest.fn().mockResolvedValue(response) });
    const w = pendingWallet();

    await expect(w.scanForPayments()).resolves.toBe(0);
    expect(scan).not.toHaveBeenCalled();
    expect(w.getPendingBirthTimestamp()).toBe(CREATED_AT);
  });

  it('keeps deferring while the timestamp lookup fails, then falls back so the wallet is never stuck', async () => {
    const scan = stubIndexer({ getBlockHeightByTimestamp: jest.fn().mockRejectedValue(new Error('indexer down')) });
    const w = pendingWallet();

    // first two refreshes defer rather than rescan the whole chain
    await expect(w.scanForPayments()).resolves.toBe(0);
    await expect(w.scanForPayments()).resolves.toBe(0);
    expect(scan).not.toHaveBeenCalled();
    expect(w.getPendingBirthTimestamp()).toBe(CREATED_AT);

    // the third gives up and scans from the fallback height instead of never scanning again
    await w.scanForPayments();
    expect(w.getPendingBirthTimestamp()).toBeNull();
    expect(scan).toHaveBeenCalledWith(BIP352_ACTIVATION_HEIGHT, TIP, expect.anything(), expect.anything(), expect.anything());
  });
});

describe('scanBlocks range handling', () => {
  const indexer = () => {
    const sp = new SilentPaymentIndexer({ baseUrl: 'http://indexer.test' });
    jest.spyOn(sp, 'getSpentIndexByRange').mockResolvedValue({ blocks: [] });
    return sp;
  };

  it('aborts the scan when a range fetch fails, instead of skipping the range', async () => {
    const sp = indexer();
    jest
      .spyOn(sp, 'getTransactionsByRange')
      .mockResolvedValueOnce({ transactions: [] } as any)
      .mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await expect(sp.scanForwardWithCallback(1, 100, jest.fn().mockResolvedValue(0))).rejects.toThrow(
      /Failed to fetch range 51-100: ECONNREFUSED/,
    );
  });

  it('does not disguise a caller callback failure as a fetch failure', async () => {
    const sp = indexer();
    jest.spyOn(sp, 'getTransactionsByRange').mockResolvedValue({ transactions: [] } as any);

    await expect(
      sp.scanForwardWithCallback(1, 50, async () => {
        throw new Error('bug in processTransactions');
      }),
    ).rejects.toThrow('bug in processTransactions');
  });

  it('reports every range end, empty ones included, so progress is not rewound on abort', async () => {
    const sp = indexer();
    jest.spyOn(sp, 'getTransactionsByRange').mockResolvedValue({ transactions: [] } as any);
    const onRange = jest.fn().mockResolvedValue(0);

    await sp.scanForwardWithCallback(1, 100, onRange);

    expect(onRange.mock.calls.map(([, rangeEnd]) => rangeEnd)).toEqual([50, 100]);
  });
});
