import * as bip39 from 'bip39';
import * as bitcoin from 'bitcoinjs-lib';

import { RustTransactionProcessor, SCAN_SLICE_SIZE } from '../../helpers/silent-payments/RustTransactionProcessor';
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
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  it('scans a window in slices, finding what one call over all of it would, in order', async () => {
    answerPerSlice();

    const found = await processor.processBatch(transactions(2 * SCAN_SLICE_SIZE + 1));

    expect(mockScan.mock.calls.map(call => call[2].length)).toEqual([SCAN_SLICE_SIZE, SCAN_SLICE_SIZE, 1]);
    expect(found.map(utxo => utxo.txid)).toEqual(['tx0', `tx${SCAN_SLICE_SIZE}`, `tx${2 * SCAN_SLICE_SIZE}`]);
  });

  it('lets the app run between slices', async () => {
    const order: string[] = [];
    answerPerSlice(() => order.push('slice'));

    const batch = processor.processBatch(transactions(2 * SCAN_SLICE_SIZE + 1));
    setTimeout(() => order.push('timer'), 0);
    await batch;

    // a timer queued while the batch runs gets a turn before its last slice
    expect(order).toEqual(['slice', 'slice', 'timer', 'slice']);
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
