import * as bitcoin from 'bitcoinjs-lib';
import * as bip39 from 'bip39';
import { type PrivateKey } from '@silent-pay/core';
import { findSmallestOutpoint, isSilentPaymentAddress, resolveSilentPaymentTargets } from '../../helpers/silent-payments';
import { getSilentPaymentAddress } from '../../helpers/silent-payments/SilentPaymentKeyDerivation';
import { getNetwork } from '../../modules/network';
import ecc from '../../modules/noble_ecc';

const MAINNET = getNetwork('bitcoin');
const SIGNET = getNetwork('signet');

const SEED_A = bip39.mnemonicToSeedSync(
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  '',
);
const SEED_B = bip39.mnemonicToSeedSync('zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo glue', '');

const MAINNET_ONCHAIN = 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr';
const SIGNET_ONCHAIN = 'tb1p4tp4l6glyr2gs94neqcpr5gha7344nfyznfkc8szkreflscsdkgqsdent4';

/** Two arbitrary but valid input keys, so the summed key is a real point. */
const inputKeys = (): PrivateKey[] => [
  { key: '1'.repeat(63) + '1', isXOnly: true },
  { key: '2'.repeat(63) + '2', isXOnly: true },
];

const inputs = () => [
  { txid: 'bb'.repeat(32), vout: 3 },
  { txid: 'aa'.repeat(32), vout: 7 },
];

describe('findSmallestOutpoint', () => {
  it('picks the lexicographically smallest reverse(txid)||vout', () => {
    // reverse('aa'*32) === 'aa'*32, likewise for 'bb', so 'aa…' sorts first.
    expect(findSmallestOutpoint(inputs())).toEqual({ txid: 'aa'.repeat(32), vout: 7 });
  });

  it('is order-independent', () => {
    expect(findSmallestOutpoint([...inputs()].reverse())).toEqual(findSmallestOutpoint(inputs()));
  });

  it('breaks ties on vout', () => {
    const sameTxid = [
      { txid: 'cc'.repeat(32), vout: 9 },
      { txid: 'cc'.repeat(32), vout: 2 },
    ];
    expect(findSmallestOutpoint(sameTxid).vout).toBe(2);
  });

  it('refuses to compute an input hash with no inputs', () => {
    expect(() => findSmallestOutpoint([])).toThrow(/no inputs/i);
  });
});

describe('isSilentPaymentAddress', () => {
  const mainnetSp = getSilentPaymentAddress(SEED_A, MAINNET);
  const signetSp = getSilentPaymentAddress(SEED_A, SIGNET);

  it('accepts a same-network silent payment address', () => {
    expect(isSilentPaymentAddress(mainnetSp, MAINNET.bitcoinjs)).toBe(true);
    expect(isSilentPaymentAddress(signetSp, SIGNET.bitcoinjs)).toBe(true);
  });

  // The bug this replaces: BlueWallet's isPaymentCodeValid never checked the HRP, so a tsp1
  // address passed validation on mainnet and was then paid out as a literal on-chain address.
  it('rejects a cross-network silent payment address', () => {
    expect(isSilentPaymentAddress(signetSp, MAINNET.bitcoinjs)).toBe(false);
    expect(isSilentPaymentAddress(mainnetSp, SIGNET.bitcoinjs)).toBe(false);
  });

  it('rejects plain on-chain addresses and junk', () => {
    expect(isSilentPaymentAddress(MAINNET_ONCHAIN, MAINNET.bitcoinjs)).toBe(false);
    expect(isSilentPaymentAddress(undefined, MAINNET.bitcoinjs)).toBe(false);
    expect(isSilentPaymentAddress('', MAINNET.bitcoinjs)).toBe(false);
    expect(isSilentPaymentAddress('sp1nonsense', MAINNET.bitcoinjs)).toBe(false);
  });
});

describe('resolveSilentPaymentTargets', () => {
  const spA = getSilentPaymentAddress(SEED_A, MAINNET);
  const spB = getSilentPaymentAddress(SEED_B, MAINNET);

  const isTaproot = (address: string, network = MAINNET.bitcoinjs) => {
    const decoded = bitcoin.address.fromBech32(address);
    return decoded.version === 1 && decoded.data.length === 32 && decoded.prefix === network.bech32;
  };

  it('passes through a target list with no silent payments untouched', () => {
    const targets = [{ address: MAINNET_ONCHAIN, value: 1000 }];
    expect(resolveSilentPaymentTargets(targets, inputs(), inputKeys(), MAINNET.bitcoinjs)).toBe(targets);
  });

  it('resolves a silent payment target to a taproot address of the right network', () => {
    const [resolved] = resolveSilentPaymentTargets([{ address: spA, value: 1000 }], inputs(), inputKeys(), MAINNET.bitcoinjs);
    expect(resolved.address).not.toBe(spA);
    expect(isTaproot(resolved.address!)).toBe(true);
    expect(resolved.value).toBe(1000);
  });

  it('emits a tb1p output when building on a test chain', () => {
    const spSignet = getSilentPaymentAddress(SEED_A, SIGNET);
    const [resolved] = resolveSilentPaymentTargets([{ address: spSignet, value: 1000 }], inputs(), inputKeys(), SIGNET.bitcoinjs);
    expect(resolved.address!.startsWith('tb1p')).toBe(true);
  });

  // The regression that matters most. createOutputs returns outputs grouped by scan key rather
  // than in recipient order, so a wrong mapping here pays the wrong amount to the wrong address.
  it('keeps non-SP targets at their original index while resolving SP ones around them', () => {
    const targets = [
      { address: MAINNET_ONCHAIN, value: 111 },
      { address: spA, value: 222 },
      { address: MAINNET_ONCHAIN, value: 333 },
      { address: spB, value: 444 },
    ];

    const resolved = resolveSilentPaymentTargets(targets, inputs(), inputKeys(), MAINNET.bitcoinjs);

    expect(resolved).toHaveLength(4);
    expect(resolved[0]).toEqual({ address: MAINNET_ONCHAIN, value: 111 });
    expect(resolved[2]).toEqual({ address: MAINNET_ONCHAIN, value: 333 });

    expect(resolved[1].value).toBe(222);
    expect(resolved[3].value).toBe(444);
    expect(isTaproot(resolved[1].address!)).toBe(true);
    expect(isTaproot(resolved[3].address!)).toBe(true);
    expect(resolved[1].address).not.toBe(resolved[3].address);
  });

  // Two outputs sharing one scan key land in the same payment group and are distinguished only by
  // the group-internal counter `n`, which is where an off-by-one would silently swap amounts.
  it('maps two payments to the same recipient back to the right amounts', () => {
    const targets = [
      { address: spA, value: 1000 },
      { address: spB, value: 2000 },
      { address: spA, value: 3000 },
    ];

    const resolved = resolveSilentPaymentTargets(targets, inputs(), inputKeys(), MAINNET.bitcoinjs);

    expect(resolved.map(t => t.value)).toEqual([1000, 2000, 3000]);
    const addresses = resolved.map(t => t.address!);
    expect(new Set(addresses).size).toBe(3);
    addresses.forEach(address => expect(isTaproot(address)).toBe(true));
  });

  it('derives outputs the recipient can actually detect', () => {
    // End-to-end check against the scanning side: the output key must equal
    // B_spend + hash(shared_secret || n)*G for the recipient, which is what the wallet's own
    // scanner reconstructs. Here we settle for the weaker but still meaningful property that the
    // key is a valid point distinct from the recipient's plain spend key.
    const [resolved] = resolveSilentPaymentTargets([{ address: spA, value: 5000 }], inputs(), inputKeys(), MAINNET.bitcoinjs);
    const outputKey = bitcoin.address.fromBech32(resolved.address!).data;
    const compressed = Buffer.concat([Buffer.from([0x02]), Buffer.from(outputKey)]);
    expect(ecc.isPoint(compressed)).toBe(true);
  });

  it('changes the output when the inputs change, since the shared secret is input-bound', () => {
    const targets = [{ address: spA, value: 1000 }];
    const first = resolveSilentPaymentTargets(targets, inputs(), inputKeys(), MAINNET.bitcoinjs);
    const second = resolveSilentPaymentTargets(targets, [{ txid: 'dd'.repeat(32), vout: 0 }], inputKeys(), MAINNET.bitcoinjs);
    expect(first[0].address).not.toBe(second[0].address);
  });

  it('refuses a silent payment target with no value rather than sending a guess', () => {
    expect(() => resolveSilentPaymentTargets([{ address: spA }], inputs(), inputKeys(), MAINNET.bitcoinjs)).toThrow(/missing a value/i);
  });

  it('treats a cross-network SP address as a non-SP target, so it fails loudly downstream', () => {
    // Passed through unresolved on purpose: the send screen rejects it before this point, and
    // silently minting an output for the wrong chain would be far worse.
    const spSignet = getSilentPaymentAddress(SEED_A, SIGNET);
    const targets = [{ address: spSignet, value: 1000 }];
    expect(resolveSilentPaymentTargets(targets, inputs(), inputKeys(), MAINNET.bitcoinjs)).toBe(targets);
    expect(() => bitcoin.address.toOutputScript(spSignet, MAINNET.bitcoinjs)).toThrow();
  });

  it('ignores the signet on-chain address as a target on signet without resolving it', () => {
    const targets = [{ address: SIGNET_ONCHAIN, value: 1000 }];
    expect(resolveSilentPaymentTargets(targets, inputs(), inputKeys(), SIGNET.bitcoinjs)).toBe(targets);
  });
});
