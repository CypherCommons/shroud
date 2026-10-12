import * as bip39 from 'bip39';
import * as bitcoin from 'bitcoinjs-lib';
import * as crypto from 'crypto';
import { createInputHash, decodeSilentPaymentAddress, scanOutputs } from '@silent-pay/core';
import { AbstractHDElectrumWallet } from '../../class/wallets/abstract-hd-electrum-wallet.ts';
import { HDSilentPaymentsWallet } from '../../class/wallets/hd-bip352-wallet.ts';
import { HDTaprootWallet } from '../../class/wallets/hd-taproot-wallet.ts';
import ecc from '../../modules/noble_ecc.ts';
import {
  getScanPrivateKey,
  getSilentPaymentAddress,
  getSilentPaymentChangeLabelMap,
  getSilentPaymentChangeSpendPublicKey,
  getSpendPublicKey,
} from '../../helpers/silent-payments';
import { type SilentPaymentUTXO } from '../../helpers/silent-payments/types.ts';
import { getNetwork, setActiveNetwork, type NetworkId } from '../../modules/network';
import { type CreateTransactionUtxo, type Transaction, type Utxo } from '../../class/wallets/types.ts';

const TEST_SEED = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

const taggedHash = (tag: string, data: Buffer): Buffer => {
  const tagHash = crypto.createHash('sha256').update(tag, 'utf-8').digest();
  return crypto
    .createHash('sha256')
    .update(Buffer.concat([tagHash, tagHash, data]))
    .digest();
};

/** A synthetic SP UTXO whose output key is `spendPubKey + tweak`, as a real one would be. */
const buildUtxo = (spendPubKey: Uint8Array, silentPaymentAddress: string, tweakByte: number): SilentPaymentUTXO => {
  const tweak = new Uint8Array(32);
  tweak[31] = tweakByte;
  const tweakedPub = ecc.pointAddScalar(spendPubKey, tweak, true);
  if (!tweakedPub) throw new Error('synthetic tweak produced invalid point');
  const outputKey = Buffer.from(tweakedPub.subarray(1, 33));

  return {
    txid: '1111111111111111111111111111111111111111111111111111111111111111',
    vout: 0,
    value: 100_000,
    height: 800_000,
    address: bitcoin.payments.p2tr({ pubkey: outputKey }).address!,
    silentPaymentAddress,
    pubKey: outputKey.toString('hex'),
    tweak,
    blockHash: '',
    blockTime: 0,
    isSpent: false,
  };
};

describe('BIP-352 Silent Payments', () => {
  it.each([
    {
      seed: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
      expectedAddress:
        'sp1qqfqnnv8czppwysafq3uwgwvsc638hc8rx3hscuddh0xa2yd746s7xqh6yy9ncjnqhqxazct0fzh98w7lpkm5fvlepqec2yy0sxlq4j6ccc3h6t0g',
    },
    {
      seed: 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo glue',
      expectedAddress:
        'sp1qqvchcnrcqpdutxhpf57ptn3wajj0ymqxwzu9g6vj9uxx3wuvlykhyqh99hyh33y5593802pzw5rtw040zrw9f8re52tgcwngc5974w5evuufdy0m',
    },
  ])('should generate a valid silent payment address', ({ seed, expectedAddress }) => {
    const wallet = new HDSilentPaymentsWallet();
    wallet.setSecret(seed);
    const silentPaymentAddress = wallet.getSilentPaymentAddress();
    expect(silentPaymentAddress).toBe(expectedAddress);
  });

  describe('derivation path is locked to BIP-86', () => {
    it("defaults to m/86'/0'/0' via the class's static override", () => {
      expect(HDSilentPaymentsWallet.derivationPath).toBe("m/86'/0'/0'");
      expect(new HDSilentPaymentsWallet().getDerivationPath()).toBe(HDSilentPaymentsWallet.derivationPath);
    });

    it('throws if something tries to change it', () => {
      const wallet = new HDSilentPaymentsWallet();
      expect(() => wallet.setDerivationPath("m/84'/0'/0'")).toThrow();
    });
  });

  describe('fromMnemonic', () => {
    const MNEMONIC = 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo glue';

    it('derives the canonical BIP-86 address and silent payment address for a known mnemonic', () => {
      const wallet = HDSilentPaymentsWallet.fromMnemonic(MNEMONIC);
      // bc1p... independently pinned in hd-taproot-wallet.test.ts for the same mnemonic
      expect(wallet._getExternalAddressByIndex(0)).toBe('bc1p4mc3hspc535vj2d9qcjmtynllv38u0lvfp8gs8npt64ejgtxszuq6t4ckj');
      expect(wallet.getSilentPaymentAddress()).toBe(
        'sp1qqvchcnrcqpdutxhpf57ptn3wajj0ymqxwzu9g6vj9uxx3wuvlykhyqh99hyh33y5593802pzw5rtw040zrw9f8re52tgcwngc5974w5evuufdy0m',
      );
    });
  });

  describe('createTransaction handles both spend pubkey parities of an SP coin', () => {
    it.each([
      {
        label: 'even-Y (0x02)',
        seed: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
        expectedParity: 0x02,
      },
      { label: 'odd-Y (0x03)', seed: 'all all all all all all all all all all all all', expectedParity: 0x03 },
    ])('signs a key-path Taproot input for $label spend pubkey', ({ seed, expectedParity }) => {
      const wallet = new HDSilentPaymentsWallet();
      wallet.setSecret(seed);

      const spendPubKey = wallet.getSpendPublicKey();
      expect(spendPubKey[0]).toBe(expectedParity);

      const utxo = buildUtxo(spendPubKey, wallet.getSilentPaymentAddress()!, 0x07);
      const expectedOutputKey = Buffer.from(utxo.pubKey, 'hex');

      const targetAddress = 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr';
      const result = wallet.createTransaction(
        [utxo as never],
        [{ address: targetAddress, value: 50_000 }],
        2,
        utxo.address,
        0xfffffffd,
        false,
        0,
      );

      expect(result.tx).toBeDefined();
      const tx = result.tx!;
      expect(tx.ins).toHaveLength(1);

      const witness = tx.ins[0].witness;
      expect(witness).toHaveLength(1);
      const sig = witness[0];
      expect(sig.length === 64 || sig.length === 65).toBe(true);

      const sighash = tx.hashForWitnessV1(
        0,
        [Buffer.concat([Buffer.from([0x51, 0x20]), expectedOutputKey])],
        [BigInt(utxo.value)],
        bitcoin.Transaction.SIGHASH_DEFAULT,
      );
      const sig64 = sig.length === 65 ? Buffer.from(sig.subarray(0, 64)) : Buffer.from(sig);
      expect(ecc.verifySchnorr!(sighash, expectedOutputKey, sig64)).toBe(true);
    });
  });

  describe('createTransaction verifies Schnorr signatures locally before returning', () => {
    const targetAddress = 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr';

    // produce a structurally valid Schnorr signature over the WRONG sighash: it parses fine
    // but cannot verify against the input's real sighash, like a signing bug would produce
    const mockBadSignature = () => {
      const realSignSchnorr = ecc.signSchnorr!;
      const wrongSighash = new Uint8Array(32).fill(0xaa);
      return jest.spyOn(ecc, 'signSchnorr').mockImplementation((_h, d, e) => realSignSchnorr(wrongSighash, d, e));
    };

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('throws instead of returning a transaction when the signature does not verify', () => {
      const wallet = new HDSilentPaymentsWallet();
      wallet.setSecret(TEST_SEED);
      const utxo = buildUtxo(wallet.getSpendPublicKey(), wallet.getSilentPaymentAddress()!, 0x07);
      mockBadSignature();

      expect(() =>
        wallet.createTransaction([utxo as never], [{ address: targetAddress, value: 50_000 }], 2, utxo.address, 0xfffffffd, false, 0),
      ).toThrow(/Schnorr signature verification failed/);
    });

    it('releases reserved UTXOs when verification fails, so the inputs are not stuck pending', () => {
      const wallet = new HDSilentPaymentsWallet();
      wallet.setSecret(TEST_SEED);
      const utxo = buildUtxo(wallet.getSpendPublicKey(), wallet.getSilentPaymentAddress()!, 0x07);
      mockBadSignature();

      expect(() =>
        wallet.createTransaction([utxo as never], [{ address: targetAddress, value: 50_000 }], 2, utxo.address, 0xfffffffd, false, 0),
      ).toThrow();

      const pendingInputs = (wallet as any)._sp_pending_inputs as Set<string>;
      expect(pendingInputs.has(`${utxo.txid}:${utxo.vout}`)).toBe(false);

      jest.restoreAllMocks();

      const result = wallet.createTransaction(
        [utxo as never],
        [{ address: targetAddress, value: 50_000 }],
        2,
        utxo.address,
        0xfffffffd,
        false,
        0,
      );
      expect(result.tx).toBeDefined();
    });
  });

  describe('label-0 change address', () => {
    it('derives the same labeled spend key as the encoded change address', () => {
      // These are two independent derivations of B_m: ours (b_spend + hash(scan||ser32(0)))
      // and the library's, via the encoded address. A drift here means unspendable change.
      const wallet = new HDSilentPaymentsWallet();
      wallet.setSecret(TEST_SEED);

      const changeAddress = wallet.getSilentPaymentChangeAddress();
      const fromAddress = decodeSilentPaymentAddress(changeAddress).spendKey;
      const derived = getSilentPaymentChangeSpendPublicKey(bip39.mnemonicToSeedSync(TEST_SEED, ''), getNetwork('bitcoin'));

      expect(Buffer.from(derived).toString('hex')).toBe(Buffer.from(fromAddress).toString('hex'));
      expect(changeAddress).not.toBe(wallet.getSilentPaymentAddress());
    });

    it('signs a change UTXO with the labeled spend key', () => {
      const wallet = new HDSilentPaymentsWallet();
      wallet.setSecret(TEST_SEED);

      const changeSpendPubKey = getSilentPaymentChangeSpendPublicKey(bip39.mnemonicToSeedSync(TEST_SEED, ''), getNetwork('bitcoin'));
      const utxo = buildUtxo(changeSpendPubKey, wallet.getSilentPaymentAddress()!, 0x07);
      const expectedOutputKey = Buffer.from(utxo.pubKey, 'hex');

      const result = wallet.createTransaction(
        [utxo as never],
        [{ address: 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr', value: 50_000 }],
        2,
        utxo.address,
        0xfffffffd,
        false,
        0,
      );

      const tx = result.tx!;
      expect(tx.ins).toHaveLength(1);

      const sighash = tx.hashForWitnessV1(
        0,
        [Buffer.concat([Buffer.from([0x51, 0x20]), expectedOutputKey])],
        [BigInt(utxo.value)],
        bitcoin.Transaction.SIGHASH_DEFAULT,
      );
      const sig = tx.ins[0].witness[0];
      const sig64 = sig.length === 65 ? Buffer.from(sig.subarray(0, 64)) : Buffer.from(sig);
      expect(ecc.verifySchnorr!(sighash, expectedOutputKey, sig64)).toBe(true);
    });

    it('rejects a UTXO no spend key of ours can own', () => {
      const wallet = new HDSilentPaymentsWallet();
      wallet.setSecret(TEST_SEED);

      const utxo = buildUtxo(wallet.getSpendPublicKey(), wallet.getSilentPaymentAddress()!, 0x07);
      // Corrupt the stored output key so neither the main nor the labeled key reproduces it.
      const corrupted = { ...utxo, pubKey: Buffer.from(utxo.pubKey, 'hex').reverse().toString('hex') };

      expect(() =>
        wallet.createTransaction(
          [corrupted as never],
          [{ address: 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr', value: 50_000 }],
          2,
          utxo.address,
          0xfffffffd,
          false,
          0,
        ),
      ).toThrow(/no spend key reproduces/);
    });
  });

  describe('post-broadcast change scan', () => {
    const RECIPIENT_SP =
      'sp1qqvchcnrcqpdutxhpf57ptn3wajj0ymqxwzu9g6vj9uxx3wuvlykhyqh99hyh33y5593802pzw5rtw040zrw9f8re52tgcwngc5974w5evuufdy0m';

    it('finds the label-0 change output and the change it finds is spendable', () => {
      const wallet = new HDSilentPaymentsWallet();
      wallet.setSecret(TEST_SEED);

      const utxo = buildUtxo(wallet.getSpendPublicKey(), wallet.getSilentPaymentAddress()!, 0x07);
      (wallet as any)._utxo = [utxo];

      const { tx } = wallet.createTransaction(
        [utxo as never],
        [{ address: RECIPIENT_SP, value: 50_000 }],
        2,
        wallet.getSilentPaymentChangeAddress(),
        0xfffffffd,
        false,
        0,
      );
      expect(tx!.outs).toHaveLength(2);

      (wallet as any).scanBroadcastedTxForOurOutputs(tx!, tx!.getId());

      const found = (wallet as any)._utxo.filter((u: SilentPaymentUTXO) => u.txid === tx!.getId());
      expect(found).toHaveLength(1);

      // The scan is only useful if the coin it records can actually be spent again.
      const change = found[0] as SilentPaymentUTXO;
      const changeOutputKey = Buffer.from(change.pubKey, 'hex');
      const spend = wallet.createTransaction(
        [change as never],
        [{ address: 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr', value: change.value - 5_000 }],
        2,
        change.address,
        0xfffffffd,
        false,
        0,
      );

      const sighash = spend.tx!.hashForWitnessV1(
        0,
        [Buffer.concat([Buffer.from([0x51, 0x20]), changeOutputKey])],
        [BigInt(change.value)],
        bitcoin.Transaction.SIGHASH_DEFAULT,
      );
      const sig = spend.tx!.ins[0].witness[0];
      const sig64 = sig.length === 65 ? Buffer.from(sig.subarray(0, 64)) : Buffer.from(sig);
      expect(ecc.verifySchnorr!(sighash, changeOutputKey, sig64)).toBe(true);
    });

    it('bails out when an input is not ours, rather than deriving a wrong tweak', () => {
      const wallet = new HDSilentPaymentsWallet();
      wallet.setSecret(TEST_SEED);

      const utxo = buildUtxo(wallet.getSpendPublicKey(), wallet.getSilentPaymentAddress()!, 0x07);
      (wallet as any)._utxo = [utxo];

      const { tx } = wallet.createTransaction(
        [utxo as never],
        [{ address: RECIPIENT_SP, value: 50_000 }],
        2,
        wallet.getSilentPaymentChangeAddress(),
        0xfffffffd,
        false,
        0,
      );

      // Same transaction, but now we no longer hold the input: the input hash would be
      // computed over a key we don't have, so any tweak derived from it is wrong.
      (wallet as any)._utxo = [];
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      (wallet as any).scanBroadcastedTxForOurOutputs(tx!, tx!.getId());

      expect((wallet as any)._utxo).toHaveLength(0);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('not one of our UTXOs'));
      warn.mockRestore();
    });
  });

  describe('getChangeAddressForUtxos', () => {
    const regularUtxo = {
      txid: '2222222222222222222222222222222222222222222222222222222222222222',
      vout: 0,
      value: 50_000,
      address: 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr',
    } as CreateTransactionUtxo;

    it('uses the label-0 address whenever a silent payment UTXO is on offer', () => {
      const wallet = new HDSilentPaymentsWallet();
      wallet.setSecret(TEST_SEED);

      const spUtxo = buildUtxo(wallet.getSpendPublicKey(), wallet.getSilentPaymentAddress()!, 0x07) as CreateTransactionUtxo;
      const fallback = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';

      expect(wallet.getChangeAddressForUtxos([spUtxo], fallback)).toBe(wallet.getSilentPaymentChangeAddress());

      // createTransaction can pay sp1 change whichever of these coin selection ends up
      // spending, so a mix gets it too, and its change counts toward the balance right away.
      expect(wallet.getChangeAddressForUtxos([spUtxo, regularUtxo], fallback)).toBe(wallet.getSilentPaymentChangeAddress());

      // regular coins alone keep regular change
      expect(wallet.getChangeAddressForUtxos([regularUtxo], fallback)).toBe(fallback);
      expect(wallet.getChangeAddressForUtxos([], fallback)).toBe(fallback);
    });
  });

  describe('sending to a silent payment (sp1) address from SP-received coins', () => {
    const senderSeed = TEST_SEED;
    const recipientSeed = 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo glue';
    const recipientSpAddress =
      'sp1qqvchcnrcqpdutxhpf57ptn3wajj0ymqxwzu9g6vj9uxx3wuvlykhyqh99hyh33y5593802pzw5rtw040zrw9f8re52tgcwngc5974w5evuufdy0m';

    function makeSpUtxo(wallet: HDSilentPaymentsWallet, tweakLastByte: number, value: number, txidHexChar: string): SilentPaymentUTXO {
      const tweak = new Uint8Array(32);
      tweak[31] = tweakLastByte;
      const tweakedPub = ecc.pointAddScalar(wallet.getSpendPublicKey(), tweak, true);
      if (!tweakedPub) throw new Error('synthetic tweak produced invalid point');
      const outputKey = Buffer.from(tweakedPub.subarray(1, 33));
      return {
        txid: txidHexChar.repeat(64),
        vout: 0,
        value,
        height: 800_000,
        address: bitcoin.payments.p2tr({ pubkey: outputKey }).address!,
        silentPaymentAddress: wallet.getSilentPaymentAddress() || '',
        pubKey: outputKey.toString('hex'),
        tweak,
        blockHash: '',
        blockTime: 0,
        isSpent: false,
      };
    }

    // Receiver-side BIP-352 derivation: recompute the taproot output key the recipient's
    // scan key would discover, independently of the sender-side code under test. It only
    // needs what the chain shows of each spent coin: its outpoint and output key.
    function expectedRecipientOutputKey(spentUtxos: Pick<SilentPaymentUTXO, 'txid' | 'vout' | 'pubKey'>[]): Buffer {
      const seed = bip39.mnemonicToSeedSync(recipientSeed);
      const bScan = getScanPrivateKey(seed, getNetwork('bitcoin'));
      const BSpend = getSpendPublicKey(seed, getNetwork('bitcoin'));

      // A = sum of the input taproot output keys, lifted to even-Y points
      let A: Uint8Array = Buffer.concat([Buffer.from([0x02]), Buffer.from(spentUtxos[0].pubKey, 'hex')]);
      for (const u of spentUtxos.slice(1)) {
        const lifted = Buffer.concat([Buffer.from([0x02]), Buffer.from(u.pubKey, 'hex')]);
        A = ecc.pointAdd(A, lifted, true)!;
      }

      const outpoints = spentUtxos
        .map(u => {
          const vout = Buffer.alloc(4);
          vout.writeUInt32LE(u.vout);
          return Buffer.concat([Buffer.from(u.txid, 'hex').reverse(), vout]);
        })
        .sort(Buffer.compare);
      const inputHash = taggedHash('BIP0352/Inputs', Buffer.concat([outpoints[0], Buffer.from(A)]));

      // b_scan * input_hash * A, serialized compressed like the sender side
      const sharedSecret = ecc.pointMultiply(ecc.pointMultiply(A, inputHash, true)!, bScan, true)!;
      const t0 = taggedHash('BIP0352/SharedSecret', Buffer.concat([Buffer.from(sharedSecret), Buffer.from([0, 0, 0, 0])]));
      const P0 = ecc.pointAdd(ecc.pointFromScalar(t0, true)!, BSpend, true)!;
      return Buffer.from(P0.subarray(1, 33));
    }

    it('uses a recipient address that really belongs to the recipient seed', () => {
      expect(getSilentPaymentAddress(bip39.mnemonicToSeedSync(recipientSeed), getNetwork('bitcoin'))).toBe(recipientSpAddress);
    });

    it('unwraps the sp1 target into the recipient taproot output on a MAX send of two SP coins', () => {
      const wallet = new HDSilentPaymentsWallet();
      wallet.setSecret(senderSeed);

      const utxos = [makeSpUtxo(wallet, 0x07, 16_867, '1'), makeSpUtxo(wallet, 0x09, 1_290, '2')];

      // MAX send: target without a value
      const result = wallet.createTransaction(
        utxos as never[],
        [{ address: recipientSpAddress }],
        2,
        utxos[0].address,
        0xfffffffd,
        false,
        0,
      );

      expect(result.tx).toBeDefined();
      const tx = result.tx!;
      expect(tx.ins).toHaveLength(2);
      expect(tx.outs).toHaveLength(1);

      const expectedScript = Buffer.concat([Buffer.from([0x51, 0x20]), expectedRecipientOutputKey(utxos)]);
      expect(Buffer.from(tx.outs[0].script).equals(expectedScript)).toBe(true);
    });

    it('unwraps the sp1 target and keeps the change output on a fixed-amount send', () => {
      const wallet = new HDSilentPaymentsWallet();
      wallet.setSecret(senderSeed);

      const utxo = makeSpUtxo(wallet, 0x07, 100_000, '1');
      const changeAddress = utxo.address;
      const feeRate = 2;

      const result = wallet.createTransaction(
        [utxo as never],
        [{ address: recipientSpAddress, value: 50_000 }],
        feeRate,
        changeAddress,
        0xfffffffd,
        false,
        0,
      );

      expect(result.tx).toBeDefined();
      const tx = result.tx!;
      expect(tx.outs).toHaveLength(2);

      const expectedScript = Buffer.concat([Buffer.from([0x51, 0x20]), expectedRecipientOutputKey([utxo])]);
      const changeScript = bitcoin.address.toOutputScript(changeAddress);
      const spOut = tx.outs.find(o => Buffer.from(o.script).equals(expectedScript));
      const changeOut = tx.outs.find(o => Buffer.from(o.script).equals(changeScript));
      expect(spOut).toBeDefined();
      expect(changeOut).toBeDefined();
      expect(spOut!.value).toBe(50_000n);

      // Coin selection sizes the sp1 target before it is unwrapped, so it has to be sized
      // as the P2TR output it becomes rather than falling through to coinselect's 25-byte
      // P2PKH default. Paying the same recipient script via bc1p must therefore cost the
      // same fee; sizing it as P2PKH underestimates by 12 bytes (24 sats at this feeRate).
      const p2trEquivalent = wallet.createTransaction(
        [utxo as never],
        [{ address: bitcoin.address.fromOutputScript(expectedScript), value: 50_000 }],
        feeRate,
        changeAddress,
        0xfffffffd,
        false,
        0,
      );
      expect(result.fee).toBe(p2trEquivalent.fee);

      // Both outputs are taproot, so the reserved fee has to cover the transaction that was
      // actually built — coinselect sizes its change output as P2PKH and would leave this
      // 18 sats short. Pinned exactly: the fee is deterministic, and an over-estimate is a
      // regression too.
      expect(result.fee).toBeGreaterThanOrEqual(tx.virtualSize() * feeRate);
      expect(result.fee).toBe(314);
    });

    // A regular BIP-86 coin as fetchUtxo stores it, plus what the recipient sees of it on chain:
    // its outpoint and the output key in its scriptPubKey (the TapTweak-ed internal key, not
    // the BIP-32 key itself).
    function regularCoin(wallet: HDSilentPaymentsWallet, value: number, txidHexChar: string) {
      const address = wallet._getExternalAddressByIndex(0);
      return {
        txid: txidHexChar.repeat(64),
        vout: 1,
        value,
        address,
        wif: wallet._getWifForAddress(address),
        pubKey: Buffer.from(bitcoin.address.toOutputScript(address).subarray(2)).toString('hex'),
      };
    }

    it('derives the sp1 output from every input when SP and regular coins are spent together', () => {
      const wallet = new HDSilentPaymentsWallet();
      wallet.setSecret(senderSeed);

      // the regular coin holds the smallest outpoint, which BIP-352 keys the input hash on
      const utxos = [makeSpUtxo(wallet, 0x07, 30_000, '3'), regularCoin(wallet, 50_000, '2')];

      // and its output key has odd Y, so this also checks the sender negates it before summing:
      // the receiver lifts every input key to even Y
      const internalKey = wallet._getPubkeyByAddress(utxos[1].address) as Buffer;
      expect(ecc.xOnlyPointAddTweak(internalKey, taggedHash('TapTweak', internalKey))?.parity).toBe(1);
      const result = wallet.createTransaction(
        utxos as never[],
        [{ address: recipientSpAddress, value: 60_000 }],
        2,
        wallet.getSilentPaymentChangeAddress(),
        0xfffffffd,
        false,
        0,
      );

      const tx = result.tx!;
      expect(tx.ins).toHaveLength(2);

      const expectedScript = Buffer.concat([Buffer.from([0x51, 0x20]), expectedRecipientOutputKey(utxos)]);
      const spOut = tx.outs.find(o => Buffer.from(o.script).equals(expectedScript));
      expect(spOut?.value).toBe(60_000n);

      // the caller sees the on-chain output derived for the recipient, not the sp1 code
      expect(result.outputs[0].address).toBe(bitcoin.address.fromOutputScript(expectedScript));
    });

    it('pays an sp1 address from regular coins alone with an output the recipient can find', () => {
      // The raw BIP-32 key of a BIP-86 coin is not the key of its output: summing it into the
      // input keys derives an output the recipient's scan never matches.
      const wallet = new HDSilentPaymentsWallet();
      wallet.setSecret(senderSeed);

      const utxo = regularCoin(wallet, 100_000, 'e');
      const { tx } = wallet.createTransaction(
        [utxo as never],
        [{ address: recipientSpAddress, value: 50_000 }],
        2,
        wallet._getInternalAddressByIndex(0),
        0xfffffffd,
        false,
        0,
      );

      const expectedScript = Buffer.concat([Buffer.from([0x51, 0x20]), expectedRecipientOutputKey([utxo])]);
      expect(tx!.outs.some(o => Buffer.from(o.script).equals(expectedScript))).toBe(true);
    });
  });

  describe('spending a mix of SP and regular coins', () => {
    const RECIPIENT = 'bc1p4mc3hspc535vj2d9qcjmtynllv38u0lvfp8gs8npt64ejgtxszuq6t4ckj'; // not TEST_SEED's

    afterEach(() => {
      jest.restoreAllMocks();
    });

    const newWallet = () => {
      const wallet = new HDSilentPaymentsWallet();
      wallet.setSecret(TEST_SEED);
      return wallet;
    };

    const spCoin = (wallet: HDSilentPaymentsWallet, value: number): SilentPaymentUTXO => ({
      ...buildUtxo(wallet.getSpendPublicKey(), wallet.getSilentPaymentAddress()!, 0x07),
      value,
    });

    /** A regular BIP-86 coin on the wallet's first receive address, as fetchUtxo stores it. */
    const regularCoin = (wallet: HDSilentPaymentsWallet, value: number): Utxo => {
      const address = wallet._getExternalAddressByIndex(0);
      return {
        txid: '2222222222222222222222222222222222222222222222222222222222222222',
        vout: 0,
        value,
        height: 800_000,
        address,
        wif: wallet._getWifForAddress(address),
      };
    };

    const spentUtxo = (input: { hash: Uint8Array; index: number }, utxos: Utxo[]): Utxo =>
      utxos.find(u => u.txid === Buffer.from(input.hash).reverse().toString('hex') && u.vout === input.index)!;

    // Every input's key-path signature verifies against its own prevout's output key, over a
    // sighash committing to all of the prevouts, as a node checks it.
    const expectEveryInputSigned = (tx: bitcoin.Transaction, utxos: Utxo[]) => {
      const prevouts = tx.ins.map(input => spentUtxo(input, utxos));
      const scripts = prevouts.map(u => bitcoin.address.toOutputScript(u.address));
      const values = prevouts.map(u => BigInt(u.value));

      tx.ins.forEach((input, idx) => {
        const sighash = tx.hashForWitnessV1(idx, scripts, values, bitcoin.Transaction.SIGHASH_DEFAULT);
        const sig = input.witness[0];
        const sig64 = sig.length === 65 ? sig.subarray(0, 64) : sig;
        expect(ecc.verifySchnorr!(sighash, scripts[idx].subarray(2), sig64)).toBe(true);
      });
    };

    // The outputs a scan fed by the indexer finds for us. It only has the input keys as the
    // chain shows them (each prevout's output key), never our private keys, so it checks the
    // wallet's BIP-352 key sum independently.
    const voutsFoundFromChain = (tx: bitcoin.Transaction, utxos: Utxo[]): number[] => {
      const prevouts = tx.ins.map(input => spentUtxo(input, utxos));
      const A = prevouts
        .map(u => Buffer.concat([Buffer.from([0x02]), bitcoin.address.toOutputScript(u.address).subarray(2)]))
        .reduce((sum, point) => Buffer.from(ecc.pointAdd(sum, point, true)!));
      const serialise = (u: Utxo) => {
        const vout = Buffer.alloc(4);
        vout.writeUInt32LE(u.vout);
        return Buffer.concat([Buffer.from(u.txid, 'hex').reverse(), vout]);
      };
      const smallest = [...prevouts].sort((a, b) => Buffer.compare(serialise(a), serialise(b)))[0];

      const seed = bip39.mnemonicToSeedSync(TEST_SEED);
      const network = getNetwork('bitcoin');
      const outputs = tx.outs.map(o => Buffer.concat([Buffer.from([0x02]), Buffer.from(o.script.subarray(2))]));
      const matches = scanOutputs(
        getScanPrivateKey(seed, network),
        getSpendPublicKey(seed, network),
        A,
        createInputHash(A, smallest),
        [...outputs], // scanOutputs removes what it matches from the array it's given
        getSilentPaymentChangeLabelMap(seed, network),
      );
      return [...matches.keys()].map(hex => outputs.findIndex(o => o.toString('hex') === hex));
    };

    it('spends both kinds in one transaction when the amount needs them', () => {
      const wallet = newWallet();
      const utxos = [spCoin(wallet, 30_000), regularCoin(wallet, 50_000)];
      const changeAddress = wallet.getChangeAddressForUtxos(utxos as never[], wallet._getInternalAddressByIndex(0));
      const feeRate = 2;

      const { tx, fee, outputs } = wallet.createTransaction(
        utxos as never[],
        [{ address: RECIPIENT, value: 60_000 }],
        feeRate,
        changeAddress,
        0xfffffffd,
        false,
        0,
      );

      expect(tx!.ins).toHaveLength(2);
      expectEveryInputSigned(tx!, utxos);
      expect(fee).toBeGreaterThanOrEqual(tx!.virtualSize() * feeRate);

      // the caller gets back its recipient, and change it can pick out by the address it passed
      expect(outputs.map(o => o.address)).toEqual([RECIPIENT, wallet.getSilentPaymentChangeAddress()]);
      expect(outputs.reduce((sum, o) => sum + o.value, 0)).toBe(80_000 - fee);
    });

    it.each([
      { picked: 'SP', spValue: 100_000, regularValue: 5_000 },
      { picked: 'regular', spValue: 5_000, regularValue: 100_000 },
    ])('spends only the $picked coin when coin selection picks just that one out of a mix', ({ picked, spValue, regularValue }) => {
      const wallet = newWallet();
      const utxos = [spCoin(wallet, spValue), regularCoin(wallet, regularValue)];
      (wallet as any)._utxo = [...utxos];

      const { tx, fee } = wallet.createTransaction(
        utxos as never[],
        [{ address: RECIPIENT, value: 20_000 }],
        2,
        wallet.getChangeAddressForUtxos(utxos as never[], wallet._getInternalAddressByIndex(0)),
        0xfffffffd,
        false,
        0,
      );

      expect(tx!.ins).toHaveLength(1);
      expect('tweak' in spentUtxo(tx!.ins[0], utxos)).toBe(picked === 'SP');
      expectEveryInputSigned(tx!, utxos);

      // with an SP coin on offer change is a silent payment, which the post-broadcast scan has
      // to find even when the only input it can take the keys from is a regular one
      (wallet as any).scanBroadcastedTxForOurOutputs(tx!, tx!.getId());
      const change = wallet.getUTXOs().filter(u => u.txid === tx!.getId());
      expect(change.map(u => u.value)).toEqual([100_000 - 20_000 - fee]);

      // and so does a scan that only sees the chain, as the indexer's does
      expect(voutsFoundFromChain(tx!, utxos)).toEqual([change[0].vout]);
    });

    it('sends mixed-input change to the label-0 address, where it is found and spendable again', () => {
      const wallet = newWallet();
      const utxos = [spCoin(wallet, 30_000), regularCoin(wallet, 50_000)];
      (wallet as any)._utxo = [...utxos];

      const { tx, fee } = wallet.createTransaction(
        utxos as never[],
        [{ address: RECIPIENT, value: 60_000 }],
        2,
        wallet.getSilentPaymentChangeAddress(),
        0xfffffffd,
        false,
        0,
      );

      (wallet as any).scanBroadcastedTxForOurOutputs(tx!, tx!.getId());

      const found = wallet.getUTXOs().filter(u => u.txid === tx!.getId());
      expect(found).toHaveLength(1);
      expect(found[0].value).toBe(80_000 - 60_000 - fee);
      expect(voutsFoundFromChain(tx!, utxos)).toEqual([found[0].vout]);

      const spend = wallet.createTransaction(
        [found[0] as never],
        [{ address: RECIPIENT, value: 10_000 }],
        2,
        wallet.getSilentPaymentChangeAddress(),
        0xfffffffd,
        false,
        0,
      );
      expectEveryInputSigned(spend.tx!, found);
    });

    it('reserves only the SP inputs, since broadcastTx reads anything reserved as SP', () => {
      const wallet = newWallet();
      const sp = spCoin(wallet, 30_000);

      wallet.createTransaction(
        [sp, regularCoin(wallet, 50_000)] as never[],
        [{ address: RECIPIENT, value: 60_000 }],
        2,
        wallet.getSilentPaymentChangeAddress(),
        0xfffffffd,
        false,
        0,
      );

      expect([...(wallet as any)._sp_pending_inputs]).toEqual([`${sp.txid}:${sp.vout}`]);
    });

    it.each([
      // the MAX send tests/unit/hd-taproot-wallet.test.ts pins the hex of
      { label: 'a MAX send', targets: [{ address: '13HaCAB4jf7FYSZexJxoczyDDnutzZigjS' }], feeRate: 1 },
      {
        label: 'a send with change',
        targets: [{ address: 'bc1pgrhjjw52p6a03v635f7cnl6ttvuz9f34ujhaefm6xqtscd3m473szkl92g', value: 100_000 }],
        feeRate: 2,
      },
    ])('spends regular coins alone exactly as the plain taproot wallet does, for $label', ({ targets, feeRate }) => {
      const mnemonic = 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo glue';
      // the coin tests/unit/hd-taproot-wallet.test.ts spends
      const utxos = [
        {
          height: 0,
          value: 181385,
          address: 'bc1p4mc3hspc535vj2d9qcjmtynllv38u0lvfp8gs8npt64ejgtxszuq6t4ckj',
          txid: 'e97f982766537c5330b50ef521bbcd8811971eb7cc9fd64bda45266136f27b82',
          vout: 0,
        },
      ];

      const taproot = new HDTaprootWallet();
      taproot.setSecret(mnemonic);
      const expected = taproot.createTransaction(utxos, targets, feeRate, taproot._getInternalAddressByIndex(0));

      const wallet = HDSilentPaymentsWallet.fromMnemonic(mnemonic);
      const changeAddress = wallet._getInternalAddressByIndex(0);
      const actual = wallet.createTransaction(
        utxos,
        targets,
        feeRate,
        wallet.getChangeAddressForUtxos(utxos, changeAddress),
        HDSilentPaymentsWallet.defaultRBFSequence,
        false,
        0,
      );

      expect(actual.tx!.toHex()).toBe(expected.tx!.toHex());
      expect(actual.fee).toBe(expected.fee);
    });

    it('records a mixed spend once, at its full value, before and after Electrum reports it', async () => {
      const wallet = newWallet();
      const sp = spCoin(wallet, 30_000);
      const regular = regularCoin(wallet, 50_000);
      (wallet as any)._utxo = [regular, sp];

      const { tx, fee } = wallet.createTransaction(
        [regular, sp] as never[],
        [{ address: RECIPIENT, value: 60_000 }],
        2,
        wallet.getSilentPaymentChangeAddress(),
        0xfffffffd,
        false,
        0,
      );
      const txid = tx!.getId();

      jest.spyOn(AbstractHDElectrumWallet.prototype, 'broadcastTx').mockResolvedValue(true);
      jest.spyOn(wallet, 'fetchUtxo').mockResolvedValue(undefined);
      expect(await wallet.broadcastTx(tx!.toHex())).toBe(true);

      // the SP input is spent and released; the SP change is ours already
      expect(wallet.getUTXOs().map(u => u.txid)).toEqual([txid]);
      expect((wallet as any)._sp_pending_inputs.size).toBe(0);

      const rowsForTx = () => wallet.getTransactions().filter(t => t.txid === txid);
      expect(rowsForTx()).toHaveLength(1);
      expect(rowsForTx()[0].value).toBe(-(60_000 + fee));
      expect(
        rowsForTx()[0]
          .inputs.map(i => i.addresses?.[0])
          .sort(),
      ).toEqual([regular.address, wallet.getSilentPaymentAddress()].sort());

      // Electrum then reports the transaction through the regular input's address, knowing
      // only that side of it (inputs carry the prevout values it looked up, in BTC)
      const btc = (sats: number) => sats / 100_000_000;
      const electrumRow: Transaction = {
        txid,
        hash: txid,
        version: 2,
        size: tx!.byteLength(),
        vsize: tx!.virtualSize(),
        weight: tx!.weight(),
        locktime: 0,
        blockhash: 'ab'.repeat(32),
        confirmations: 1,
        time: 1_700_000_000,
        blocktime: 1_700_000_000,
        timestamp: 1_700_000_000,
        inputs: tx!.ins.map(input => {
          const prevout = spentUtxo(input, [regular, sp]);
          return {
            txid: prevout.txid,
            vout: prevout.vout,
            scriptSig: { asm: '', hex: '' },
            txinwitness: [],
            sequence: input.sequence,
            addresses: [prevout.address],
            value: btc(prevout.value),
          };
        }),
        outputs: tx!.outs.map((out, n) => ({
          n,
          value: btc(Number(out.value)),
          scriptPubKey: {
            asm: '',
            hex: '',
            reqSigs: 1,
            type: 'witness_v1_taproot',
            addresses: [bitcoin.address.fromOutputScript(out.script)],
          },
        })),
      };
      (wallet as any)._txs_by_external_index = { 0: [electrumRow] };

      expect(rowsForTx()).toHaveLength(1);
      expect(rowsForTx()[0].value).toBe(-(60_000 + fee));
      expect(rowsForTx()[0].confirmations).toBe(1);
    });

    it('holds to the stricter Buffer#equals of the buffer polyfill the app runs on', async () => {
      // In the app `buffer` is the npm polyfill, whose Buffer#equals throws on a plain
      // Uint8Array (which is what bitcoinjs-lib 7 hands back), where Node's accepts one.
      const realEquals = Buffer.prototype.equals;
      jest.spyOn(Buffer.prototype, 'equals').mockImplementation(function (this: Buffer, other: unknown) {
        if (!Buffer.isBuffer(other)) throw new TypeError('Argument must be a Buffer');
        return realEquals.call(this, other);
      });

      const wallet = newWallet();
      const utxos = [spCoin(wallet, 30_000), regularCoin(wallet, 50_000)];
      (wallet as any)._utxo = [...utxos];

      const { tx } = wallet.createTransaction(
        utxos as never[],
        [
          {
            address: 'sp1qqvchcnrcqpdutxhpf57ptn3wajj0ymqxwzu9g6vj9uxx3wuvlykhyqh99hyh33y5593802pzw5rtw040zrw9f8re52tgcwngc5974w5evuufdy0m',
            value: 60_000,
          },
        ],
        2,
        wallet.getSilentPaymentChangeAddress(),
        0xfffffffd,
        false,
        0,
      );

      jest.spyOn(AbstractHDElectrumWallet.prototype, 'broadcastTx').mockResolvedValue(true);
      jest.spyOn(wallet, 'fetchUtxo').mockResolvedValue(undefined);
      await wallet.broadcastTx(tx!.toHex());

      // the instant scan ran through every input's keys and found the change
      expect(wallet.getUTXOs().map(u => u.txid)).toEqual([tx!.getId()]);
    });
  });

  describe('sending to a silent payment address from regular taproot coins', () => {
    afterEach(() => setActiveNetwork('bitcoin'));

    // The receiver's view, built from chain data alone: the output key behind each spent taproot
    // address (what the indexer's scan tweak is computed from) and the wallet's scan key. Nothing
    // here touches the sender's private keys, so it fails if the sender sums the wrong ones.
    function expectedRecipientOutputKey(networkId: NetworkId, spent: { txid: string; vout: number; address?: string }[]): Buffer {
      const network = getNetwork(networkId);
      const seed = bip39.mnemonicToSeedSync(TEST_SEED);
      const bScan = getScanPrivateKey(seed, network);
      const BSpend = getSpendPublicKey(seed, network);

      const lifted = spent.map(u =>
        Buffer.concat([Buffer.from([0x02]), Buffer.from(bitcoin.address.toOutputScript(u.address!, network.bitcoinjs).subarray(2))]),
      );
      const A = lifted.slice(1).reduce<Uint8Array>((sum, point) => ecc.pointAdd(sum, point, true)!, lifted[0]);

      const outpoints = spent
        .map(u => {
          const vout = Buffer.alloc(4);
          vout.writeUInt32LE(u.vout);
          return Buffer.concat([Buffer.from(u.txid, 'hex').reverse(), vout]);
        })
        .sort(Buffer.compare);
      const inputHash = taggedHash('BIP0352/Inputs', Buffer.concat([outpoints[0], Buffer.from(A)]));

      const sharedSecret = ecc.pointMultiply(ecc.pointMultiply(A, inputHash, true)!, bScan, true)!;
      const t0 = taggedHash('BIP0352/SharedSecret', Buffer.concat([Buffer.from(sharedSecret), Buffer.from([0, 0, 0, 0])]));
      const P0 = ecc.pointAdd(ecc.pointFromScalar(t0, true)!, BSpend, true)!;
      return Buffer.from(P0.subarray(1, 33));
    }

    it.each([
      { networkId: 'bitcoin', inputCount: 1 },
      { networkId: 'bitcoin', inputCount: 3 },
      { networkId: 'signet', inputCount: 1 },
      { networkId: 'signet', inputCount: 3 },
    ] as const)('pays an output the recipient finds on $networkId, spending $inputCount input(s)', ({ networkId, inputCount }) => {
      setActiveNetwork(networkId);
      const wallet = new HDSilentPaymentsWallet();
      wallet.setSecret(TEST_SEED);

      const utxos = Array.from({ length: inputCount }, (_, i) => ({
        txid: String(i + 1).repeat(64),
        vout: 0,
        value: 10_000,
        address: wallet._getExternalAddressByIndex(i),
        confirmations: 10,
        height: 1,
      }));
      // sized so that coin selection needs every input
      const amount = inputCount * 10_000 - 1_000;

      const result = wallet.createTransaction(
        utxos as never[],
        [{ address: wallet.getSilentPaymentAddress()!, value: amount }],
        1,
        wallet._getInternalAddressByIndex(0),
        0xfffffffd,
        false,
        0,
      );

      const tx = result.tx!;
      expect(tx.ins).toHaveLength(inputCount);

      const expectedScript = Buffer.concat([Buffer.from([0x51, 0x20]), expectedRecipientOutputKey(networkId, result.inputs)]);
      const spOut = tx.outs.find(o => Buffer.from(o.script).equals(expectedScript));
      expect(spOut).toBeDefined();
      expect(spOut!.value).toBe(BigInt(amount));
    });
  });

  describe('save/load round trip', () => {
    it('does not restore runtime-only fields, so SP coins stay spendable and the wallet stays deletable', () => {
      const wallet = new HDSilentPaymentsWallet();
      wallet.setSecret(TEST_SEED);
      const utxo = buildUtxo(wallet.getSpendPublicKey(), wallet.getSilentPaymentAddress()!, 0x07);
      const targetAddress = 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr';
      const send = (w: HDSilentPaymentsWallet) =>
        w.createTransaction([utxo as never], [{ address: targetAddress, value: 50_000 }], 2, utxo.address, 0xfffffffd, false, 0);

      (wallet as any)._utxo = [utxo];
      (wallet as any).lastScannedBlock = 900_000;
      send(wallet); // fills spendKeyCandidates with real Uint8Arrays
      (wallet as any).isPollingActive = true;
      (wallet as any).cancelScanCallbackScan = true;
      (wallet as any)._scanState = { ...(wallet as any)._scanState, status: 'scanning' };
      (wallet as any)._scanSamples = [{ t: 1, percent: 50 }];

      // unstripped blob, so fromJson has to drop the non-persisted fields itself
      wallet.prepareForSerialization();
      const loaded = HDSilentPaymentsWallet.fromJson(JSON.stringify({ ...wallet }));

      // _utxo is rebuilt from _utxos_serializable, so it isn't expected to match a fresh wallet
      const fresh = new HDSilentPaymentsWallet();
      for (const k of (HDSilentPaymentsWallet as any).NON_PERSISTED_KEYS) {
        expect(k in fresh).toBe(true);
        if (k !== '_utxo') expect((loaded as any)[k]).toEqual((fresh as any)[k]);
      }
      expect((loaded as any).lastScannedBlock).toBe(900_000);
      expect((loaded as any)._utxo[0].tweak).toBeInstanceOf(Uint8Array);

      expect(send(loaded).tx).toBeDefined();
      expect(() => loaded.clearCache()).not.toThrow();
      wallet.clearCache();
    });

    it('keeps the seed, key cache and runtime state out of the persisted blob', () => {
      const wallet = HDSilentPaymentsWallet.fromMnemonic(TEST_SEED);
      const utxo = buildUtxo(wallet.getSpendPublicKey(), wallet.getSilentPaymentAddress()!, 0x07);
      (wallet as any)._utxo = [utxo];
      wallet.createTransaction([utxo as never], [{ address: utxo.address, value: 50_000 }], 2, utxo.address, 0xfffffffd, false, 0);
      (wallet as any).getSeed(); // fills cachedSeed

      wallet.prepareForSerialization();
      const blob = JSON.parse(JSON.stringify(wallet.toPersistable()));
      for (const k of ['cachedSeed', 'spendKeyCandidates', 'transactionProcessor', '_utxo']) expect(blob).not.toHaveProperty(k);
      wallet.clearCache();
    });

    // fails on any new field, so it has to be put in NON_PERSISTED_KEYS or added here on purpose
    it('persists only the expected keys', () => {
      const wallet = HDSilentPaymentsWallet.fromMnemonic(TEST_SEED);
      wallet.prepareForSerialization();
      expect(Object.keys(wallet.toPersistable()).sort()).toEqual([
        '_address',
        '_address_to_wif_cache',
        '_balances_by_external_index',
        '_balances_by_internal_index',
        '_birthHeight',
        '_birthResolutionFailures',
        '_birthTimestamp',
        '_derivationPath',
        '_fp',
        '_hideTransactionsInWalletsList',
        '_lastBalanceFetch',
        '_lastTxFetch',
        '_sp_pending_inputs',
        '_sp_spending_txs',
        '_txs_by_external_index',
        '_txs_by_internal_index',
        '_utxoMetadata',
        '_utxos_serializable',
        '_xpub',
        'balance',
        'chain',
        'external_addresses_cache',
        'gap_limit',
        'hideBalance',
        'internal_addresses_cache',
        'label',
        'lastScannedBlock',
        'networkId',
        'next_free_address_index',
        'next_free_change_address_index',
        'passphrase',
        'preferredBalanceUnit',
        'secret',
        'segwitType',
        'type',
        'typeReadable',
        'unconfirmed_balance',
        'usedAddresses',
        'userHasSavedExport',
      ]);
    });
  });
});
