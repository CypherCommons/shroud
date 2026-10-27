import { HDSilentPaymentsWallet } from '../../class/wallets/hd-bip352-wallet';
import { AbstractHDElectrumWallet } from '../../class/wallets/abstract-hd-electrum-wallet';
import { type SilentPaymentUTXO } from '../../helpers/silent-payments/types';

const SEED = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

function makeWallet(): HDSilentPaymentsWallet {
  const wallet = new HDSilentPaymentsWallet();
  wallet.setSecret(SEED);
  return wallet;
}

function makeSPUtxo(txid: string, vout: number, value: number): SilentPaymentUTXO {
  return {
    txid,
    vout,
    value,
    height: 800_000,
    address: `bc1p_${txid.slice(0, 8)}`,
    silentPaymentAddress: 'sp1qqtest',
    pubKey: 'aa'.repeat(32),
    tweak: new Uint8Array(32).fill(vout + 1),
    blockHash: 'bb'.repeat(32),
    blockTime: 1_700_000_000,
    isSpent: false,
  };
}

describe('fetchUtxo SP UTXO race condition', () => {
  afterEach(() => jest.restoreAllMocks());

  it('preserves SP UTXOs added concurrently during super.fetchUtxo()', async () => {
    const wallet = makeWallet();

    // Seed the wallet with a pre-existing SP UTXO.
    const existingSpUtxo = makeSPUtxo('aaaa', 0, 50_000);
    (wallet as any).addUTXO(existingSpUtxo);
    expect(wallet.getUTXOs()).toHaveLength(1);

    // Gate that signals when the parent fetchUtxo is blocked on the network.
    let parentBlocked: () => void;
    const parentIsBlocked = new Promise<void>(resolve => {
      parentBlocked = resolve;
    });

    // Gate that the test controls to unblock the parent fetchUtxo.
    let unblockParent: () => void;
    const parentGate = new Promise<void>(resolve => {
      unblockParent = resolve;
    });

    // A regular (non-SP) UTXO that the parent would return from Electrum.
    const regularUtxo = { txid: 'cccc', vout: 0, value: 30_000, address: 'bc1q_regular', height: 800_001 };

    // Mock the parent's fetchUtxo to simulate Electrum latency.
    jest.spyOn(AbstractHDElectrumWallet.prototype, 'fetchUtxo').mockImplementation(async function (this: any) {
      // Signal that we've entered the parent — the test can now add a concurrent UTXO.
      parentBlocked!();
      // Block until the test explicitly unblocks us.
      await parentGate;
      // Reproduce the real parent behavior: wipe _utxo and replace with Electrum results.
      this._utxo = [regularUtxo];
    });

    // Start fetchUtxo — it snapshots, then enters the mocked parent await.
    const fetchPromise = wallet.fetchUtxo();

    // Wait for the parent to be blocked (deterministic, no setTimeout).
    await parentIsBlocked;

    // Simulate scanForPayments() discovering a new SP UTXO while the parent is blocked.
    const concurrentSpUtxo = makeSPUtxo('bbbb', 1, 75_000);
    (wallet as any).addUTXO(concurrentSpUtxo);

    // Unblock the parent — it wipes _utxo with the regular UTXO, then the finally block runs.
    unblockParent!();
    await fetchPromise;

    // ---- Assertions ----

    // 1. The pre-existing SP UTXO must survive.
    expect(wallet._utxo.some(u => u.txid === 'aaaa' && u.vout === 0)).toBe(true);

    // 2. The concurrently added SP UTXO must survive (this was the bug).
    expect(wallet._utxo.some(u => u.txid === 'bbbb' && u.vout === 1)).toBe(true);

    // 3. The regular UTXO from Electrum must be present.
    expect(wallet._utxo.some(u => u.txid === 'cccc' && u.vout === 0)).toBe(true);

    // 4. No duplicates — total should be exactly 3.
    expect(wallet._utxo).toHaveLength(3);
  });

  it('does not duplicate SP UTXOs already in the Electrum response', async () => {
    const wallet = makeWallet();

    const spUtxo = makeSPUtxo('dddd', 0, 60_000);
    (wallet as any).addUTXO(spUtxo);

    let unblockParent: () => void;
    const parentGate = new Promise<void>(resolve => {
      unblockParent = resolve;
    });

    // Simulate the parent returning an array that already contains the same outpoint
    // (e.g. if Electrum somehow knew about the SP address).
    jest.spyOn(AbstractHDElectrumWallet.prototype, 'fetchUtxo').mockImplementation(async function (this: any) {
      await parentGate;
      this._utxo = [{ txid: 'dddd', vout: 0, value: 60_000, address: 'bc1p_dddd' }];
    });

    const fetchPromise = wallet.fetchUtxo();
    // No concurrent add — just test deduplication.
    unblockParent!();
    await fetchPromise;

    const matches = wallet._utxo.filter(u => u.txid === 'dddd' && u.vout === 0);
    expect(matches).toHaveLength(1);
  });

  it('preserves SP UTXOs even when super.fetchUtxo() throws', async () => {
    const wallet = makeWallet();

    const spUtxo = makeSPUtxo('eeee', 0, 40_000);
    (wallet as any).addUTXO(spUtxo);

    jest.spyOn(AbstractHDElectrumWallet.prototype, 'fetchUtxo').mockRejectedValue(new Error('Electrum down'));

    await expect(wallet.fetchUtxo()).rejects.toThrow('Electrum down');

    // SP UTXO must survive despite the error.
    expect(wallet.getUTXOs()).toHaveLength(1);
    expect(wallet._utxo.some(u => u.txid === 'eeee')).toBe(true);
  });
});
