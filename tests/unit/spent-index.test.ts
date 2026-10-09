import { HDSilentPaymentsWallet } from '../../class/wallets/hd-bip352-wallet';
import { checkedThrough, matchSpent, outpointShortHash } from '../../helpers/silent-payments/spentIndex';
import type { SilentPaymentUTXO, SpentIndexBlock } from '../../helpers/silent-payments/types';
import * as indexerModule from '../../modules/SilentPaymentIndexer';

const TEST_SEED = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const TIP = 900_100;
const BLOCK_HASH = '000000000000000000026d1e6d0e5a1c6a3f5a8d2b1e6b7c0c7a4c0d8e6f1a2b';

const utxo = (n: number, height: number, value: number): SilentPaymentUTXO => ({
  txid: n.toString(16).padStart(64, '0'),
  vout: 0,
  value,
  height,
  address: '',
  silentPaymentAddress: 'sp1test',
  pubKey: 'aa'.repeat(32),
  tweak: new Uint8Array(32),
  blockHash: BLOCK_HASH,
  blockTime: 1_700_000_000,
  isSpent: false,
});

const spendBlock = (height: number, ...spent: SilentPaymentUTXO[]): SpentIndexBlock => ({
  height,
  blockHash: BLOCK_HASH,
  blockTime: 1_700_000_500,
  // a decoy hash so matching has to pick ours out of the block
  hashes: 'ffffffffffffffff' + spent.map(u => outpointShortHash(u.txid, u.vout, BLOCK_HASH)).join(''),
});

/**
 * An indexer with the spent index: one entry per height in the range, as it writes one for every
 * block. `spends` puts coins in given blocks; `missing` heights have no entry.
 */
const spentIndex =
  (spends: Record<number, SilentPaymentUTXO[]> = {}, missing: number[] = []) =>
  async (start: number, end: number) => {
    const blocks: SpentIndexBlock[] = [];
    for (let h = start; h <= end; h++) {
      if (!missing.includes(h)) blocks.push(spendBlock(h, ...(spends[h] ?? [])));
    }
    return { blocks };
  };

describe('spent index hashing', () => {
  // same vectors as silent-pay-indexer src/common/common.spec.ts: real Signet taproot spends,
  // both in block 325319
  it.each([
    ['aea2211b26f445057308975350d45c3b4fc67aa2f4f06df37556461b69ee4030', 0, '2c479685c677110a'],
    ['4ea3326c47e6bf4168221c9344f67348c6102f0692b24401bc7b6edc0d74dfa3', 1, '18528141b1385618'],
  ])('matches the indexer and spdk byte layout for %s:%d', (txid, vout, expected) => {
    expect(outpointShortHash(txid, vout, '0000000ae277a40f13748dd2bc05dd6d74dd109922578b17d30a7852b54badb5')).toBe(expected);
  });

  it('groups matches by the block that spent them', () => {
    const [a, b, c] = [utxo(1, 10, 1), utxo(2, 10, 1), utxo(3, 10, 1)];
    const matches = matchSpent([a, b, c], [spendBlock(20, a), spendBlock(21), spendBlock(22, c)]);
    expect([...matches]).toEqual([
      [20, [a]],
      [22, [c]],
    ]);
  });

  it('only matches a coin in the block that created it or a later one', () => {
    const a = utxo(1, 30, 1);
    expect([...matchSpent([a], [spendBlock(29, a), spendBlock(30, a)])]).toEqual([[30, [a]]]);
  });

  it('counts heights as checked only up to the first one with no entry', () => {
    const blocks = [spendBlock(10), spendBlock(11), spendBlock(13)];
    expect(checkedThrough(blocks, 10, 13)).toBe(11);
    expect(checkedThrough(blocks, 12, 13)).toBe(11);
  });
});

describe('external spend detection', () => {
  afterEach(() => jest.restoreAllMocks());

  const setup = (getSpentIndexByRange: jest.Mock) => {
    jest.spyOn(indexerModule, 'getDefaultIndexer').mockReturnValue({
      getLatestBlockHeight: jest.fn().mockResolvedValue({ height: TIP }),
      getSpentIndexByRange,
      scanForwardWithCallback: jest.fn().mockResolvedValue(undefined),
    } as any);

    const w = new HDSilentPaymentsWallet();
    w.setSecret(TEST_SEED);
    (w as any).lastScannedBlock = TIP - 1;
    return w;
  };

  it('catches up an existing wallet from its oldest coin and records one unknown send per block', async () => {
    const [a, b, keep] = [utxo(1, 900_000, 1000), utxo(2, 900_010, 2000), utxo(3, 900_020, 4000)];
    const getSpentIndexByRange = jest.fn(spentIndex({ 900_050: [a, b] }));
    const w = setup(getSpentIndexByRange);
    (w as any)._utxo = [a, b, keep];

    await w.scanForPayments();

    expect(getSpentIndexByRange).toHaveBeenCalledWith(900_000, 900_049);
    expect(getSpentIndexByRange).toHaveBeenCalledWith(900_050, TIP - 1);
    expect(w.getBalance()).toBe(4000);

    const unknown = w.getTransactions().filter(tx => tx.external);
    expect(unknown).toHaveLength(1);
    expect(unknown[0]).toMatchObject({ value: -3000, height: 900_050, outputs: [], timestamp: 1_700_000_500 });
    expect(unknown[0].confirmations).toBeGreaterThan(0);
    expect((w as any)._spentCheckedHeight).toBe(TIP - 1);
  });

  it('confirms our own send instead of recording an unknown one', async () => {
    const a = { ...utxo(1, 900_000, 1000), isSpent: true };
    const w = setup(jest.fn(spentIndex({ 900_050: [a] })));
    (w as any)._utxo = [a];
    (w as any)._sp_spending_txs = [
      { txid: 'ours', hash: 'ours', blockhash: '', confirmations: 0, value: -1000, inputs: [{ txid: a.txid, vout: 0 }], outputs: [] },
    ];

    await w.scanForPayments();

    const txs = w.getTransactions();
    expect(txs.some(tx => tx.external)).toBe(false);
    expect(txs.find(tx => tx.txid === 'ours')).toMatchObject({
      blockhash: BLOCK_HASH,
      height: 900_050,
      confirmations: TIP - 1 - 900_050 + 1,
    });
  });

  it('only rechecks the last few blocks once everything is checked', async () => {
    const getSpentIndexByRange = jest.fn(spentIndex());
    const w = setup(getSpentIndexByRange);
    (w as any)._utxo = [utxo(1, 900_000, 1000)];
    (w as any)._spentCheckedHeight = TIP - 1;

    await w.scanForPayments();

    expect(getSpentIndexByRange.mock.calls).toEqual([[TIP - 6, TIP - 1]]);
  });

  it('finds a spend that a reorg put into an already-checked block', async () => {
    const a = utxo(1, 900_000, 1000);
    // the block at TIP - 3 was checked before the reorg; its replacement spends our coin
    const w = setup(jest.fn(spentIndex({ [TIP - 3]: [a] })));
    (w as any)._utxo = [a];
    (w as any)._spentCheckedHeight = TIP - 1;

    await w.scanForPayments();

    expect(w.getBalance()).toBe(0);
  });

  it('stops at a height the indexer has no entry for and checks it on the next sync', async () => {
    const a = utxo(1, 900_000, 1000);
    const getSpentIndexByRange = jest.fn(spentIndex({ 900_040: [a] }, [900_030]));
    const w = setup(getSpentIndexByRange);
    (w as any)._utxo = [a];

    await w.scanForPayments();

    expect((w as any)._spentCheckedHeight).toBe(900_029);
    expect(getSpentIndexByRange).toHaveBeenCalledTimes(1);

    // the indexer has caught up on 900_030
    getSpentIndexByRange.mockImplementation(spentIndex({ 900_040: [a] }));
    await w.scanForPayments();

    expect(getSpentIndexByRange).toHaveBeenLastCalledWith(900_080, TIP - 1);
    expect((w as any)._spentCheckedHeight).toBe(TIP - 1);
    expect(w.getBalance()).toBe(0);
  });

  it('keeps scanning when the indexer has no spent index, without moving the checked height', async () => {
    const getSpentIndexByRange = jest.fn().mockRejectedValue(new Error('HTTP error! status: 404'));
    const w = setup(getSpentIndexByRange);
    (w as any)._utxo = [utxo(1, 900_000, 1000)];
    (w as any)._spentCheckedHeight = 899_999;

    await expect(w.scanForPayments()).resolves.toBe(0);

    expect((w as any)._spentCheckedHeight).toBe(899_999);
    expect(w.getBalance()).toBe(1000);
  });

  it('survives a serialize/restore round trip', () => {
    const w = new HDSilentPaymentsWallet();
    (w as any)._spentCheckedHeight = 123;
    w.prepareForSerialization();
    const restored = HDSilentPaymentsWallet.fromJson(JSON.stringify({ ...w, type: (w as any).type }));
    expect((restored as any)._spentCheckedHeight).toBe(123);
  });
});

describe('spend detection during the forward scan', () => {
  afterEach(() => jest.restoreAllMocks());

  // The real range scanner over a mocked indexer, with the wallet's own output detection stubbed
  // to "receive" given coins in the range that contains them.
  const setup = (received: SilentPaymentUTXO[], getSpentIndexByRange: jest.Mock) => {
    const indexer = new indexerModule.SilentPaymentIndexer({ baseUrl: 'http://indexer' });
    jest.spyOn(indexer, 'getLatestBlockHeight').mockResolvedValue({ height: TIP });
    jest.spyOn(indexer, 'getTransactionsByRange').mockImplementation(async (start, end) => ({
      transactions: received.filter(u => u.height >= start && u.height <= end) as any,
    }));
    jest.spyOn(indexer, 'getSpentIndexByRange').mockImplementation(getSpentIndexByRange);
    jest.spyOn(indexerModule, 'getDefaultIndexer').mockReturnValue(indexer);

    const w = new HDSilentPaymentsWallet();
    w.setSecret(TEST_SEED);
    jest.spyOn(w as any, 'processTransactions').mockImplementation(async (txs: any) => ({ utxos: txs, lastScannedBlock: 0 }));
    jest.spyOn(w as any, 'startPolling').mockImplementation(() => {});
    return w;
  };

  it('catches a coin received and spent within one range', async () => {
    const a = utxo(1, TIP - 55, 1000);
    const w = setup([a], jest.fn(spentIndex({ [TIP - 50]: [a] })));
    (w as any).lastScannedBlock = TIP - 60;
    (w as any)._spentCheckedHeight = TIP - 60;

    await w.scanForPayments();

    expect(w.getBalance()).toBe(0);
    expect(w.getTransactions().filter(tx => tx.external)).toHaveLength(1);
    expect((w as any)._spentCheckedHeight).toBe(TIP);
  });

  it('receives without the spent index, then checks those blocks once the indexer has it', async () => {
    const a = utxo(1, TIP - 55, 1000);
    const getSpentIndexByRange = jest.fn().mockRejectedValue(new Error('HTTP error! status: 404'));
    const w = setup([a], getSpentIndexByRange);
    (w as any).lastScannedBlock = TIP - 60;
    (w as any)._spentCheckedHeight = TIP - 60;

    await w.scanForPayments();

    expect(w.getBalance()).toBe(1000);
    expect((w as any).lastScannedBlock).toBe(TIP);
    expect((w as any)._spentCheckedHeight).toBe(TIP - 60);

    getSpentIndexByRange.mockImplementation(spentIndex({ [TIP - 50]: [a] }));
    await w.scanForPayments();

    expect(w.getBalance()).toBe(0);
    expect((w as any)._spentCheckedHeight).toBe(TIP);
  });

  it('rechecks the spent index from the start on a full rescan', async () => {
    const gap = new HDSilentPaymentsWallet().getEffectiveBirthHeight() + 10;
    const w = setup([], jest.fn(spentIndex({}, [gap])));
    (w as any).lastScannedBlock = TIP;
    (w as any)._spentCheckedHeight = TIP;

    await w.scanForPayments(undefined, true);

    expect((w as any)._spentCheckedHeight).toBe(gap - 1);
  });
});
