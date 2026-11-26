import * as bip39 from 'bip39';
import * as bitcoin from 'bitcoinjs-lib';

import { RustTransactionProcessor, SCAN_SLICE_SIZE, SCAN_YIELD_AFTER_MS } from '../../helpers/silent-payments/RustTransactionProcessor';
import type { IndexerTransaction } from '../../helpers/silent-payments/types';
import { getNetwork } from '../../modules/network';
import ecc from '../../modules/noble_ecc';
import { spScanTransactions } from '../../modules/RustJsiBridge';

jest.mock('../../modules/RustJsiBridge', () => ({
  ...jest.requireActual('../../modules/RustJsiBridge'),
  spScanTransactions: jest.fn(),
}));

// matches are turned into taproot addresses, as the app does once a wallet module has loaded
bitcoin.initEccLib(ecc);

const mockScan = spScanTransactions as jest.Mock;
const TEST_SEED = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
// any valid x-only key will do: the generator point's
const X_ONLY_KEY = '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';

const transactions = (count: number): IndexerTransaction[] =>
  Array.from(
    { length: count },
    (_, i) => ({ id: `tx${i}`, blockHeight: 900_000, blockHash: 'h', blockTime: 0, scanTweak: 'aa', outputs: [] }) as any,
  );

// A clock the scanner moves on by however long its slice takes, so tests can say how long that is.
let clock = 0;

// The scanner's answer for a slice: one match per slice, named after the slice's first transaction.
const answerPerSlice = (onCall: () => void = () => {}) =>
  mockScan.mockImplementation((_priv: string, _pubs: string[], slice: IndexerTransaction[]) => {
    onCall();
    return {
      transactionsScanned: slice.length,
      outputsScanned: 0,
      matchedUtxos: [
        {
          txid: slice[0].id,
          vout: 0,
          value: 1000,
          height: 900_000,
          pubKey: X_ONLY_KEY,
          tweakHex: '00'.repeat(32),
          blockHash: 'h',
          isSpent: false,
          blockTime: 0,
        },
      ],
    };
  });

describe('unit - RustTransactionProcessor', () => {
  const processor = new RustTransactionProcessor(bip39.mnemonicToSeedSync(TEST_SEED), getNetwork('bitcoin'));

  beforeEach(() => {
    mockScan.mockReset();
    clock = 0;
    jest.spyOn(performance, 'now').mockImplementation(() => clock);
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  // Each slice holds the thread `ms`. Records the slices and the batch's yields in the order they came, with a
  // task queued just before the batch, which shows where the batch let other work run.
  const runWithSlicesOf = async (ms: number, sliceCount: number) => {
    const order: string[] = [];
    answerPerSlice(() => {
      clock += ms;
      order.push('slice');
    });
    setTimeout(() => order.push('other task'), 0);
    const realSetTimeout = global.setTimeout;
    const timers = jest.spyOn(global, 'setTimeout').mockImplementation(((callback: () => void, delay?: number) => {
      order.push('yield');
      return realSetTimeout(callback, delay);
    }) as typeof setTimeout);

    await processor.processBatch(transactions((sliceCount - 1) * SCAN_SLICE_SIZE + 1));

    timers.mockRestore();
    return order;
  };

  afterEach(() => jest.restoreAllMocks());

  it('scans a window in slices, finding what one call over all of it would, in order', async () => {
    answerPerSlice();

    const found = await processor.processBatch(transactions(2 * SCAN_SLICE_SIZE + 1));

    expect(mockScan.mock.calls.map(call => call[2].length)).toEqual([SCAN_SLICE_SIZE, SCAN_SLICE_SIZE, 1]);
    expect(found.map(utxo => utxo.txid)).toEqual(['tx0', `tx${SCAN_SLICE_SIZE}`, `tx${2 * SCAN_SLICE_SIZE}`]);
  });

  it('lets the app run before scanning a window of several slices, which it has only just parsed', async () => {
    const order = await runWithSlicesOf(5, 2);

    expect(order.slice(0, 3)).toEqual(['yield', 'other task', 'slice']);
  });

  it(`lets the app run again once slices have held the thread ${SCAN_YIELD_AFTER_MS}ms`, async () => {
    const order = await runWithSlicesOf(20, 3);

    // 20ms, then 40ms: a yield before the third slice
    expect(order).toEqual(['yield', 'other task', 'slice', 'slice', 'yield', 'slice']);
  });

  it('yields after every slice that holds the thread that long on its own', async () => {
    const order = await runWithSlicesOf(SCAN_YIELD_AFTER_MS + 10, 3);

    expect(order).toEqual(['yield', 'other task', 'slice', 'yield', 'slice', 'yield', 'slice']);
  });

  it('runs quick slices back to back, without idling between them', async () => {
    const order = await runWithSlicesOf(5, 3);

    // 15ms in all, so no yield after the first, which would cost up to a frame on iOS
    expect(order).toEqual(['yield', 'other task', 'slice', 'slice', 'slice']);
  });

  it('scans a window of one slice at once, with nothing parsed big enough to wait on', async () => {
    const order = await runWithSlicesOf(5, 1);

    expect(order).toEqual(['slice']);
  });

  it('stops before the first slice on a cancel, by throwing', async () => {
    answerPerSlice();

    await expect(processor.processBatch(transactions(1), () => true)).rejects.toThrow('SCAN_CANCELLED');
    expect(mockScan).not.toHaveBeenCalled();
  });

  it('stops between slices on a cancel, by throwing, so the caller never marks the window scanned', async () => {
    let cancelled = false;
    answerPerSlice(() => {
      cancelled = true;
    });

    await expect(processor.processBatch(transactions(2 * SCAN_SLICE_SIZE), () => cancelled)).rejects.toThrow('SCAN_CANCELLED');
    expect(mockScan).toHaveBeenCalledTimes(1);
  });

  it('has nothing to scan in an empty window', async () => {
    await expect(processor.processBatch([])).resolves.toEqual([]);
    expect(mockScan).not.toHaveBeenCalled();
  });
});
