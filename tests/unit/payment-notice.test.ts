import * as bitcoin from 'bitcoinjs-lib';
import { Buffer } from 'buffer';
import {
  createInputHash,
  createOutputs,
  decodeSilentPaymentAddress,
  scanOutputsWithTweak,
  calculateSumOfPrivateKeys,
} from '@silent-pay/core';
import * as Electrum from '../../modules/Electrum';
import ecc from '../../modules/noble_ecc';
import { HDSilentPaymentsWallet } from '../../class/wallets/hd-bip352-wallet.ts';
import { findSmallestOutpoint, getScanPrivateKey, getSilentPaymentChangeLabelMap, getSpendPublicKey } from '../../helpers/silent-payments';
import type { IndexerTransaction, SilentPaymentUTXO } from '../../helpers/silent-payments';

jest.mock('../../modules/Electrum', () => ({
  ...jest.requireActual('../../modules/Electrum'),
  multiGetTransactionByTxid: jest.fn(),
  broadcastV2: jest.fn(),
}));

const SENDER_SEED = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const RECEIVER_SEED = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
const FUNDING_TXID = 'f'.repeat(64);
const AMOUNT = 50_000;

const walletFrom = (secret: string): HDSilentPaymentsWallet => {
  const w = new HDSilentPaymentsWallet();
  w.setSecret(secret);
  return w;
};

/**
 * A stand-in for the Rust scanner (a native JSI module, absent in jest): the same scan, run with
 * `scanOutputsWithTweak`, producing the UTXOs the real processor would.
 */
function stubScanner(wallet: HDSilentPaymentsWallet) {
  const seed = (wallet as any).getSeed();
  const network = wallet.getNetworkConfig();
  return jest.spyOn(wallet as any, 'processTransactions').mockImplementation(async (...args: unknown[]) => {
    const txs = args[0] as IndexerTransaction[];
    const utxos: SilentPaymentUTXO[] = [];
    for (const tx of txs) {
      if (!tx.scanTweak) continue;
      const compressed = tx.outputs.map(o => Buffer.concat([Buffer.from([0x02]), Buffer.from(o.pubKey, 'hex')]));
      const matches = scanOutputsWithTweak(
        getScanPrivateKey(seed, network),
        getSpendPublicKey(seed, network),
        Buffer.from(tx.scanTweak, 'hex'),
        compressed,
        getSilentPaymentChangeLabelMap(seed, network),
      );
      for (const [outputHex, tweak] of matches) {
        const out = tx.outputs.find(o => o.pubKey === outputHex.slice(2))!;
        utxos.push({
          txid: tx.id,
          vout: out.vout,
          value: out.value,
          height: tx.blockHeight,
          address: bitcoin.payments.p2tr({ pubkey: Buffer.from(out.pubKey, 'hex'), network: network.bitcoinjs }).address!,
          silentPaymentAddress: wallet.getSilentPaymentAddress()!,
          pubKey: out.pubKey,
          tweak,
          blockHash: tx.blockHash,
          isSpent: false,
          blockTime: tx.blockTime,
        } as SilentPaymentUTXO);
      }
    }
    return { utxos, lastScannedBlock: 0 };
  });
}

/** Sender: owns one regular taproot coin, pays `AMOUNT` to the receiver's SP address and keeps change. */
function buildPayment() {
  const sender = walletFrom(SENDER_SEED);
  const receiver = walletFrom(RECEIVER_SEED);
  const network = sender.getNetworkConfig();

  const fundedAddress = sender._getExternalAddressByIndex(0);
  const coin = { txid: FUNDING_TXID, vout: 1, value: 120_000, address: fundedAddress, height: 100 };
  sender._utxo = [coin];

  const { keyPair } = (sender as any).resolveInputKeys(coin);
  const inputKeys = [{ key: Buffer.from(keyPair.privateKey).toString('hex'), isXOnly: true }];
  const outputs = createOutputs(inputKeys, findSmallestOutpoint([{ txid: FUNDING_TXID, vout: 1 }]), [
    { address: receiver.getSilentPaymentAddress()!, amount: AMOUNT },
  ]);

  const tx = new bitcoin.Transaction();
  tx.version = 2;
  tx.addInput(Buffer.from(FUNDING_TXID, 'hex').reverse(), 1);
  // Change to an ordinary address first, so the recipient's output is not at index 0.
  tx.addOutput(bitcoin.address.toOutputScript(sender._getInternalAddressByIndex(0), network.bitcoinjs), 69_000n);
  // createOutputs hands back the 33-byte even-Y output key; the P2TR script is OP_1 <32-byte x>.
  tx.addOutput(Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.from(outputs[0].script.subarray(1))]), BigInt(AMOUNT));
  return { sender, receiver, tx, hex: tx.toHex(), txid: tx.getId(), recipientVout: 1, keyPair };
}

describe('payment notice: sender tweak and receiver instant detection', () => {
  const multiGet = Electrum.multiGetTransactionByTxid as unknown as jest.Mock;
  const broadcast = Electrum.broadcastV2 as unknown as jest.Mock;

  beforeEach(() => {
    multiGet.mockReset();
    broadcast.mockReset();
    broadcast.mockResolvedValue('txid');
  });

  it("computes the scan tweak as inputHash·A_sum, from the sender's own inputs", () => {
    const { sender, tx, keyPair } = buildPayment();
    const tweak = sender.computeScanTweak(tx);
    expect(tweak).toMatch(/^0[23][0-9a-f]{64}$/);

    const aSum = ecc.pointFromScalar(
      calculateSumOfPrivateKeys([{ key: Buffer.from(keyPair.privateKey).toString('hex'), isXOnly: true }]),
      true,
    )!;
    const inputHash = createInputHash(aSum, findSmallestOutpoint([{ txid: FUNDING_TXID, vout: 1 }]));
    expect(tweak).toBe(Buffer.from(ecc.pointMultiply(aSum, inputHash, true)!).toString('hex'));
  });

  it('gives no tweak when an input is not ours, instead of a wrong one', () => {
    const { sender, tx } = buildPayment();
    tx.addInput(Buffer.from('e'.repeat(64), 'hex'), 0);
    expect(sender.computeScanTweak(tx)).toBeNull();
    expect(walletFrom(RECEIVER_SEED).computeScanTweak(buildPayment().tx)).toBeNull();
  });

  it("finds exactly the recipient's output in the mempool, with the hex the sender sent", async () => {
    const { sender, receiver, tx, hex, txid, recipientVout } = buildPayment();
    const tweak = sender.computeScanTweak(tx)!;
    stubScanner(receiver);
    multiGet.mockResolvedValue({ [txid]: { confirmations: 0 } });
    const onBalance = jest.fn();
    const onPersist = jest.fn();
    receiver.setOnBalanceChangeCallback(onBalance);
    receiver.setOnPersistCallback(onPersist);
    const lastScanned = (receiver as any).lastScannedBlock;

    const result = await receiver.detectUnconfirmedPayment({ txid, tweak, hex });

    expect(result).toMatchObject({ found: true, totalValue: AMOUNT, confirmations: 0 });
    expect(result.outputs).toEqual([{ vout: recipientVout, value: AMOUNT, kind: 'silent-payment', isChange: false }]);
    // Stored as one pending coin: height 0, no block.
    expect(receiver._utxo).toHaveLength(1);
    expect(receiver._utxo[0]).toMatchObject({ txid, vout: recipientVout, value: AMOUNT, height: 0, blockHash: '' });
    expect(onBalance).toHaveBeenCalledTimes(1);
    expect(onPersist).toHaveBeenCalledTimes(1);
    expect((receiver as any).lastScannedBlock).toBe(lastScanned);
    // Electrum knew the transaction, so nothing was rebroadcast.
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('is idempotent, and the later confirmed record fills in the height instead of adding a twin', async () => {
    const { sender, receiver, tx, hex, txid, recipientVout } = buildPayment();
    const tweak = sender.computeScanTweak(tx)!;
    stubScanner(receiver);
    multiGet.mockResolvedValue({ [txid]: { confirmations: 0 } });
    const onBalance = jest.fn();
    receiver.setOnBalanceChangeCallback(onBalance);

    await receiver.detectUnconfirmedPayment({ txid, tweak, hex });
    const again = await receiver.detectUnconfirmedPayment({ txid, tweak, hex });
    expect(again.found).toBe(true);
    expect(receiver._utxo).toHaveLength(1);
    expect(onBalance).toHaveBeenCalledTimes(1);

    // What the block scan later returns for the same output.
    const existing = receiver._utxo[0] as SilentPaymentUTXO;
    const confirmed = { ...existing, height: 321, blockHash: 'abcd', blockTime: 1_700_000_000 };
    expect((receiver as any).addUTXO(confirmed)).toBe(false);
    expect(receiver._utxo).toHaveLength(1);
    expect(receiver._utxo[0]).toMatchObject({ txid, vout: recipientVout, height: 321, blockHash: 'abcd' });
  });

  it('finds nothing with a wrong tweak, and stores nothing', async () => {
    const { receiver, hex, txid } = buildPayment();
    stubScanner(receiver);
    multiGet.mockResolvedValue({ [txid]: { confirmations: 0 } });
    // A real curve point (the generator) that is nobody's tweak.
    const generator = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
    const result = await receiver.detectUnconfirmedPayment({ txid, tweak: generator, hex });
    expect(result).toMatchObject({ found: false, outputs: [], totalValue: 0 });
    expect(receiver._utxo).toHaveLength(0);
  });

  it('answers "not found" without scanning or fetching when the tweak is not a curve point', async () => {
    const { receiver, hex, txid } = buildPayment();
    const scanner = stubScanner(receiver);
    const result = await receiver.detectUnconfirmedPayment({ txid, tweak: '02' + '11'.repeat(32), hex });
    expect(result).toEqual({ found: false, outputs: [], totalValue: 0, confirmations: 0 });
    expect(scanner).not.toHaveBeenCalled();
    expect(multiGet).not.toHaveBeenCalled();
  });

  it("finds nothing in someone else's payment, even with the right tweak", async () => {
    const { sender, tx, hex, txid } = buildPayment();
    const stranger = walletFrom('letter advice cage absurd amount doctor acoustic avoid letter advice cage above');
    stubScanner(stranger);
    multiGet.mockResolvedValue({ [txid]: { confirmations: 0 } });
    const result = await stranger.detectUnconfirmedPayment({ txid, tweak: sender.computeScanTweak(tx)!, hex });
    expect(result.found).toBe(false);
    expect(stranger._utxo).toHaveLength(0);
  });

  it('refuses hex that does not hash to the txid, before touching anything', async () => {
    const { sender, receiver, tx, hex } = buildPayment();
    const scanner = stubScanner(receiver);
    await expect(receiver.detectUnconfirmedPayment({ txid: '1'.repeat(64), tweak: sender.computeScanTweak(tx)!, hex })).rejects.toThrow(
      /does not hash/,
    );
    expect(scanner).not.toHaveBeenCalled();
    expect(receiver._utxo).toHaveLength(0);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('rejects a malformed txid or tweak', async () => {
    const { receiver, hex, txid } = buildPayment();
    await expect(receiver.detectUnconfirmedPayment({ txid: 'nope', tweak: '02' + '11'.repeat(32), hex })).rejects.toThrow(/malformed/);
    await expect(receiver.detectUnconfirmedPayment({ txid, tweak: '04' + '11'.repeat(32), hex })).rejects.toThrow(/malformed/);
  });

  it('fetches the transaction from Electrum when the notice carries no hex', async () => {
    const { sender, receiver, tx, hex, txid } = buildPayment();
    stubScanner(receiver);
    multiGet.mockImplementation(async (_ids: string[], verbose: boolean) => ({ [txid]: verbose ? { confirmations: 2 } : hex }));
    const result = await receiver.detectUnconfirmedPayment({ txid, tweak: sender.computeScanTweak(tx)! });
    expect(result).toMatchObject({ found: true, totalValue: AMOUNT, confirmations: 2 });
  });

  it('reports not-found when Electrum does not know the transaction and there is no hex', async () => {
    const { receiver, txid } = buildPayment();
    const scanner = stubScanner(receiver);
    multiGet.mockResolvedValue({});
    expect(await receiver.detectUnconfirmedPayment({ txid, tweak: '02' + '11'.repeat(32) })).toEqual({
      found: false,
      outputs: [],
      totalValue: 0,
      confirmations: 0,
    });
    expect(scanner).not.toHaveBeenCalled();
  });

  it('rebroadcasts hash-verified hex that Electrum has not seen, and still detects the payment', async () => {
    const { sender, receiver, tx, hex, txid } = buildPayment();
    stubScanner(receiver);
    multiGet.mockResolvedValue({});
    const result = await receiver.detectUnconfirmedPayment({ txid, tweak: sender.computeScanTweak(tx)!, hex });
    expect(broadcast).toHaveBeenCalledWith(hex);
    expect(result).toMatchObject({ found: true, totalValue: AMOUNT });
  });

  it('survives a failed rebroadcast and a failing Electrum lookup', async () => {
    const { sender, receiver, tx, hex, txid } = buildPayment();
    stubScanner(receiver);
    multiGet.mockRejectedValue(new Error('electrum down'));
    broadcast.mockRejectedValue(new Error('already in mempool'));
    const result = await receiver.detectUnconfirmedPayment({ txid, tweak: sender.computeScanTweak(tx)!, hex });
    expect(result.found).toBe(true);
  });

  it('decodes the receiver address back to the scan key it scanned with (sanity)', () => {
    const { receiver } = buildPayment();
    const { scanKey } = decodeSilentPaymentAddress(receiver.getSilentPaymentAddress()!, receiver.getNetworkConfig().bitcoinjs);
    expect(Buffer.from(scanKey).toString('hex')).toBe(
      Buffer.from(ecc.pointFromScalar(getScanPrivateKey((receiver as any).getSeed(), receiver.getNetworkConfig()), true)!).toString('hex'),
    );
  });
});
