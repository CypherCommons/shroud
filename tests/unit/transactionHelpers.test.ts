import { type Transaction } from '../../class/wallets/types';
import { getRelevantAddress, splitSelfTransfer } from '../../utils/transactionHelpers';

const output = (n: number, address: string) => ({
  n,
  value: 0.0001,
  scriptPubKey: { asm: '', hex: '', reqSigs: 1, type: 'witness_v1_taproot', addresses: [address] },
});

const tx = (overrides: Partial<Transaction>): Transaction => ({
  txid: 'ab'.repeat(32),
  hash: 'ab'.repeat(32),
  version: 2,
  size: 0,
  vsize: 0,
  weight: 0,
  locktime: 0,
  inputs: [],
  outputs: [],
  blockhash: '',
  confirmations: 1,
  time: 0,
  blocktime: 0,
  timestamp: 0,
  ...overrides,
});

describe('splitSelfTransfer', () => {
  it('lists a self-transfer as what it paid us, then the send carrying the fee', () => {
    const rows = splitSelfTransfer(tx({ value: -157, selfTransfer: { value: 5_321, address: 'tb1pself' } }));

    expect(rows.map(row => row.value)).toEqual([5_321, -5_478]);
    // still sums to what the transaction did to the balance
    expect(rows.reduce((sum, row) => sum + (row.value ?? 0), 0)).toBe(-157);
  });

  it('lists anything else as the one row', () => {
    const send = tx({ value: -2_000 });

    expect(splitSelfTransfer(send)).toEqual([send]);
  });
});

describe('getRelevantAddress', () => {
  it('shows either row of a self-transfer by the address of ours it paid', () => {
    // the payment to our own receive address comes first, its silent payment change second
    const selfTransfer = tx({
      value: -157,
      selfTransfer: { value: 5_234, address: 'tb1preceive' },
      outputs: [output(0, 'tb1preceive'), output(1, 'tb1pspchange')],
    });
    const wallet = { weOwnAddress: (address: string) => address === 'tb1preceive' };

    for (const row of splitSelfTransfer(selfTransfer)) {
      expect(getRelevantAddress(row, wallet)).toBe('tb1preceive');
    }
  });

  it('shows a send by its first output that is not ours', () => {
    const send = tx({ value: -2_000, outputs: [output(0, 'tb1pmine'), output(1, 'tb1ptheirs')] });

    expect(getRelevantAddress(send, { weOwnAddress: address => address === 'tb1pmine' })).toBe('tb1ptheirs');
  });

  it("shows a receive by the output of ours it paid, not the sender's change", () => {
    const receive = tx({ value: 10_000, outputs: [output(0, 'tb1psenderchange'), output(1, 'tb1pmine')] });

    expect(getRelevantAddress(receive, { weOwnAddress: address => address === 'tb1pmine' })).toBe('tb1pmine');
  });

  it('shows a receive with no output it can tell is ours by its first output', () => {
    // a silent payment receive lists only our outputs, under our sp1 address, which isn't one of our BIP-86 addresses
    const receive = tx({ value: 10_000, outputs: [output(0, 'tsp1qmine')] });

    expect(getRelevantAddress(receive, { weOwnAddress: () => false })).toBe('tsp1qmine');
  });
});
