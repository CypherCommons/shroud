import * as bitcoin from 'bitcoinjs-lib';
import { isValidBech32Address } from '../../utils/isValidBech32Address';
import { setActiveNetwork } from '../../modules/network';

const MAINNET_ADDRESSES = [
  'bc1qatswv5uv7qetzz4n8u9u2x2ckmaxvc8qng5s7r', // P2WPKH (SegWit v0)
  'bc1ph76f32dqjkvd523g02ucylqstljj5pysqe3lmyuepnuyz5d7lw9sl0pp4m', // P2TR (Taproot v1)
];

const TEST_CHAIN_ADDRESSES = [
  'tb1ql4jps5nxnyz7qxgle9dp3q0mww2jk4ckfua6lr', // Testnet SegWit v0
  'tb1p4tp4l6glyr2gs94neqcpr5gha7344nfyznfkc8szkreflscsdkgqsdent4', // Testnet Taproot v1
];

const MALFORMED_ADDRESSES: (string | null | undefined)[] = [
  'moKVV6XEhfrBCE3QCYq6ppT7AaMF8KsZ1B',
  '16X9EwoL5fgUr2ordTy8bs7wT4Ff3QGQPW', // Legacy (P2PKH)
  '3HFvmZJhc7KbqVXXQXaa34StUPk4gxcQyR', // P2SH
  'bc1zw508d6qejxtdg4y5r3zarvaryvg6kdaj', // Invalid checksum
  'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kyd39', // Too short
  'BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KYGT080', // Uppercase (invalid Bech32)
  'bcrt1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh', // Regtest
  '', // Empty string
  null,
  undefined,
];

describe('isValidBech32Address', () => {
  afterEach(() => setActiveNetwork('bitcoin'));

  describe('on mainnet', () => {
    beforeEach(() => setActiveNetwork('bitcoin'));

    test.each(MAINNET_ADDRESSES)('accepts the mainnet address %s', (address: string) => {
      expect(isValidBech32Address(address)).toBe(true);
    });

    // Rejecting these is the point of making the check network-aware: `fromBech32` alone does
    // not look at the HRP, so a testnet address used to pass validation on mainnet.
    test.each(TEST_CHAIN_ADDRESSES)('rejects the test-chain address %s', (address: string) => {
      expect(isValidBech32Address(address)).toBe(false);
    });
  });

  describe.each(['testnet4', 'signet'] as const)('on %s', networkId => {
    beforeEach(() => setActiveNetwork(networkId));

    // testnet4 and signet share the `tb` HRP, so both accept the same addresses.
    test.each(TEST_CHAIN_ADDRESSES)('accepts the test-chain address %s', (address: string) => {
      expect(isValidBech32Address(address)).toBe(true);
    });

    test.each(MAINNET_ADDRESSES)('rejects the mainnet address %s', (address: string) => {
      expect(isValidBech32Address(address)).toBe(false);
    });
  });

  // A wallet is pinned to its own chain, which need not be the one currently selected — so the
  // caller can name the network and the ambient one must not leak in.
  describe('with an explicit network', () => {
    afterEach(() => setActiveNetwork('bitcoin'));

    test.each(TEST_CHAIN_ADDRESSES)('accepts the test-chain address %s on testnet even while mainnet is active', (address: string) => {
      setActiveNetwork('bitcoin');
      expect(isValidBech32Address(address, bitcoin.networks.testnet)).toBe(true);
    });

    test.each(MAINNET_ADDRESSES)('accepts the mainnet address %s on mainnet even while a test chain is active', (address: string) => {
      setActiveNetwork('signet');
      expect(isValidBech32Address(address, bitcoin.networks.bitcoin)).toBe(true);
    });

    test.each(MAINNET_ADDRESSES)('rejects the mainnet address %s on testnet even while mainnet is active', (address: string) => {
      setActiveNetwork('bitcoin');
      expect(isValidBech32Address(address, bitcoin.networks.testnet)).toBe(false);
    });
  });

  test.each(MALFORMED_ADDRESSES)('rejects the malformed address %s on every network', (address: string | null | undefined) => {
    for (const networkId of ['bitcoin', 'testnet4', 'signet'] as const) {
      setActiveNetwork(networkId);
      expect(isValidBech32Address(address as string)).toBe(false);
    }
  });
});
