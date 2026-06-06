import { HDSilentPaymentsWallet } from '../../class/wallets/hd-bip352-wallet.ts';
import { BIP352_ACTIVATION_HEIGHT } from '../../modules/constants.ts';
import { isScannable } from '../../helpers/silent-payments/types.ts';
import type { SilentPaymentUTXOSerializable, StagedScanData } from '../../helpers/silent-payments/types.ts';

const SEED = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

function makeWallet(birthHeight: number = BIP352_ACTIVATION_HEIGHT): HDSilentPaymentsWallet {
  const wallet = new HDSilentPaymentsWallet();
  wallet.setSecret(SEED);
  wallet.setBirthHeight(birthHeight);
  return wallet;
}

function makeStagedUtxo(overrides: Partial<SilentPaymentUTXOSerializable> = {}): SilentPaymentUTXOSerializable {
  return {
    txid: 'a'.repeat(64),
    vout: 0,
    value: 50000,
    height: BIP352_ACTIVATION_HEIGHT + 10,
    address: 'bc1p...test',
    silentPaymentAddress: 'sp1q...test',
    pubKey: '02'.repeat(33).slice(0, 66),
    tweakHex: 'cc'.repeat(32),
    blockHash: 'b'.repeat(64),
    blockTime: 1715000000,
    isSpent: false,
    ...overrides,
  };
}

function makeStaged(wallet: HDSilentPaymentsWallet, overrides: Partial<StagedScanData> = {}): StagedScanData {
  return {
    walletID: wallet.getID(),
    cursor: BIP352_ACTIVATION_HEIGHT + 100,
    utxos: [makeStagedUtxo()],
    updatedAt: Date.now(),
    schema: 1,
    ...overrides,
  };
}

describe('HDSilentPaymentsWallet scan contract', () => {
  it('satisfies the isScannable() structural guard', () => {
    // The entire scan UI (home banner, SyncScreen, scan-state callback wiring)
    // is gated on this guard. It once silently broke when isScanActive() was
    // deleted as "unused" — every method in IScannableWallet is load-bearing.
    expect(isScannable(makeWallet())).toBe(true);
  });
});

describe('HDSilentPaymentsWallet.mergeStagedScanResults', () => {
  it('merges staged UTXOs and adopts the staged cursor', () => {
    const wallet = makeWallet();
    const staged = makeStaged(wallet);

    const added = wallet.mergeStagedScanResults(staged);

    expect(added).toBe(1);
    expect(wallet.getLastScannedBlock()).toBe(staged.cursor);
    const utxos = wallet.getUTXOs();
    expect(utxos).toHaveLength(1);
    expect(utxos[0].txid).toBe('a'.repeat(64));
    // tweak must be rehydrated from hex into a Uint8Array
    expect(utxos[0].tweak).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(utxos[0].tweak).toString('hex')).toBe('cc'.repeat(32));
  });

  it('returns 0 and changes nothing for null staging', () => {
    const wallet = makeWallet();
    expect(wallet.mergeStagedScanResults(null)).toBe(0);
    expect(wallet.getLastScannedBlock()).toBe(0);
    expect(wallet.getUTXOs()).toHaveLength(0);
  });

  it('ignores staging that belongs to a different wallet', () => {
    const wallet = makeWallet();
    const staged = makeStaged(wallet, { walletID: 'some-other-wallet-id' });

    expect(wallet.mergeStagedScanResults(staged)).toBe(0);
    expect(wallet.getLastScannedBlock()).toBe(0);
    expect(wallet.getUTXOs()).toHaveLength(0);
  });

  it('dedups staged UTXOs against existing ones (re-merge is idempotent)', () => {
    const wallet = makeWallet();
    const staged = makeStaged(wallet);

    expect(wallet.mergeStagedScanResults(staged)).toBe(1);
    // merging the same staging again must be a no-op
    expect(wallet.mergeStagedScanResults(staged)).toBe(0);
    expect(wallet.getUTXOs()).toHaveLength(1);
  });

  it('never regresses the cursor', () => {
    const wallet = makeWallet();
    wallet.mergeStagedScanResults(makeStaged(wallet, { cursor: BIP352_ACTIVATION_HEIGHT + 500, utxos: [] }));
    expect(wallet.getLastScannedBlock()).toBe(BIP352_ACTIVATION_HEIGHT + 500);

    wallet.mergeStagedScanResults(makeStaged(wallet, { cursor: BIP352_ACTIVATION_HEIGHT + 100, utxos: [] }));
    expect(wallet.getLastScannedBlock()).toBe(BIP352_ACTIVATION_HEIGHT + 500);
  });

  it('does not adopt a staged cursor below the effective birth height (stale credentials)', () => {
    // wallet born at tip; a background run with stale credentials scanned from activation
    const birthHeight = 900000;
    const wallet = makeWallet(birthHeight);
    const staged = makeStaged(wallet, { cursor: BIP352_ACTIVATION_HEIGHT + 100 });

    const added = wallet.mergeStagedScanResults(staged);

    // UTXOs still merge (dedup makes this harmless) but the cursor must not
    // drag a never-scanned wallet years behind its birth height
    expect(added).toBe(1);
    expect(wallet.getLastScannedBlock()).toBe(0);
  });

  it('adopts a staged cursor at or past the birth height', () => {
    const birthHeight = 900000;
    const wallet = makeWallet(birthHeight);
    const staged = makeStaged(wallet, { cursor: birthHeight + 5, utxos: [] });

    wallet.mergeStagedScanResults(staged);
    expect(wallet.getLastScannedBlock()).toBe(birthHeight + 5);
  });

  it('fires balance and persist callbacks only when something changed', () => {
    const wallet = makeWallet();
    const onBalanceChange = jest.fn();
    const onPersist = jest.fn();
    wallet.setOnBalanceChangeCallback(onBalanceChange);
    wallet.setOnPersistCallback(onPersist);

    wallet.mergeStagedScanResults(makeStaged(wallet));
    expect(onBalanceChange).toHaveBeenCalledTimes(1);
    expect(onPersist).toHaveBeenCalledTimes(1);

    // idempotent re-merge: no new UTXOs, no cursor advance → no callbacks
    wallet.mergeStagedScanResults(makeStaged(wallet));
    expect(onBalanceChange).toHaveBeenCalledTimes(1);
    expect(onPersist).toHaveBeenCalledTimes(1);
  });

  it('survives serialization round-trip after merge', () => {
    const wallet = makeWallet();
    wallet.mergeStagedScanResults(makeStaged(wallet));

    wallet.prepareForSerialization();
    const restored = HDSilentPaymentsWallet.fromJson(JSON.stringify(wallet));

    expect(restored.getLastScannedBlock()).toBe(wallet.getLastScannedBlock());
    expect(restored.getUTXOs()).toHaveLength(1);
    expect(restored.getUTXOs()[0].tweak).toBeInstanceOf(Uint8Array);
  });
});
