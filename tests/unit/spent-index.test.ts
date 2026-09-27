import { HDSilentPaymentsWallet } from '../../class/wallets/hd-bip352-wallet';
import { matchSpent, outpointShortHash } from '../../helpers/silent-payments/spentIndex';
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

describe('spent index hashing', () => {
  it('matches the indexer and spdk byte layout', () => {
    // same vector as silent-pay-indexer src/common/common.spec.ts
    expect(outpointShortHash('a2365547d16b555593e3f58a2b67143fc8ab84e7e1257b1c13d2a9a2ec3a2efb', 3, BLOCK_HASH)).toBe('a235084cbd2d2ec4');
  });

  it('groups matches by the block that spent them', () => {
    const [a, b, c] = [utxo(1, 10, 1), utxo(2, 10, 1), utxo(3, 10, 1)];
    const matches = matchSpent([a, b, c], [spendBlock(20, a), spendBlock(21), spendBlock(22, c)]);
    expect([...matches]).toEqual([
      [20, [a]],
      [22, [c]],
    ]);
  });
});

describe('external spend detection', () => {
  afterEach(() => jest.restoreAllMocks());

  const setup = (blocks: SpentIndexBlock[]) => {
    const getSpentIndexByRange = jest.fn().mockResolvedValue({ blocks });
    jest.spyOn(indexerModule, 'getDefaultIndexer').mockReturnValue({
      getLatestBlockHeight: jest.fn().mockResolvedValue({ height: TIP }),
      getSpentIndexByRange,
      scanForwardWithCallback: jest.fn().mockResolvedValue(undefined),
    } as any);

    const w = new HDSilentPaymentsWallet();
    w.setSecret(TEST_SEED);
    (w as any).lastScannedBlock = TIP - 1;
    return { w, getSpentIndexByRange };
  };

  it('catches up an existing wallet from its oldest coin and records one unknown send per block', async () => {
    const [a, b, keep] = [utxo(1, 900_000, 1000), utxo(2, 900_010, 2000), utxo(3, 900_020, 4000)];
    const { w, getSpentIndexByRange } = setup([spendBlock(900_050, a, b)]);
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
    const { w } = setup([spendBlock(900_050, a)]);
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

  it('resumes from where the last catch-up stopped and skips it once checked', async () => {
    const { w, getSpentIndexByRange } = setup([]);
    (w as any)._utxo = [utxo(1, 900_000, 1000)];
    (w as any)._spentCheckedHeight = TIP - 1;

    await w.scanForPayments();

    expect(getSpentIndexByRange).not.toHaveBeenCalled();
  });

  it('survives a serialize/restore round trip', () => {
    const w = new HDSilentPaymentsWallet();
    (w as any)._spentCheckedHeight = 123;
    w.prepareForSerialization();
    const restored = HDSilentPaymentsWallet.fromJson(JSON.stringify({ ...w, type: (w as any).type }));
    expect((restored as any)._spentCheckedHeight).toBe(123);
  });
});
