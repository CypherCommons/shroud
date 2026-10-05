import * as bitcoin from 'bitcoinjs-lib';
import { sha256 } from '@noble/hashes/sha256';
import { decodeSilentPaymentAddress } from '@silent-pay/core';
import { HDSilentPaymentsWallet } from '../../class/wallets/hd-bip352-wallet';
import { getActiveNetworkId, setActiveNetwork, type NetworkId } from '../../modules/network';
import { getHardcodedPeers } from '../../modules/Electrum';

const TEST_SEED = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

const NETWORK_IDS: NetworkId[] = ['bitcoin', 'testnet4', 'signet'];

const makeWallet = (networkId: NetworkId): HDSilentPaymentsWallet => {
  setActiveNetwork(networkId);
  const wallet = new HDSilentPaymentsWallet();
  wallet.setSecret(TEST_SEED);
  return wallet;
};

describe('wallet identity across networks', () => {
  afterEach(() => setActiveNetwork('bitcoin'));

  it('stamps a new wallet with the active network', () => {
    for (const networkId of NETWORK_IDS) {
      expect(makeWallet(networkId).networkId).toBe(networkId);
    }
  });

  it('derives with coin type 0 on mainnet and 1 on every test chain', () => {
    expect(makeWallet('bitcoin').getDerivationPath()).toBe("m/86'/0'/0'");
    expect(makeWallet('testnet4').getDerivationPath()).toBe("m/86'/1'/0'");
    expect(makeWallet('signet').getDerivationPath()).toBe("m/86'/1'/0'");
  });

  // The reason `getID` carries a network suffix at all. testnet4 and signet share coin type 1',
  // so without it these two hash identically — which makes loadFromDisk drop one of them and
  // merges their transaction histories in the Realm cache (keyed on wallet id).
  it('gives every network a distinct wallet id for the same seed', () => {
    const ids = NETWORK_IDS.map(networkId => makeWallet(networkId).getID());
    expect(new Set(ids).size).toBe(NETWORK_IDS.length);
  });

  it('leaves the mainnet wallet id unchanged, so wallets stored before this feature still match', () => {
    // The pre-multi-network formula, recomputed here rather than pinned as a literal so the
    // assertion states *why* the value is what it is. Mainnet must contribute an empty network
    // suffix: if this drifts, existing installs silently lose their Realm transaction cache and
    // their stored selected-wallet id.
    const wallet = makeWallet('bitcoin');
    // `setDerivationPath` is locked on silent payment wallets, so set the field directly — which
    // is also how `fromJson` restores a stored path.
    wallet._derivationPath = "m/84'/0'/0'";

    // NB `getPassphrase()` returns undefined when unset, which the original concatenation
    // stringifies to the literal "undefined". Reproduced rather than corrected: every mainnet id
    // in the wild was minted with it, so "fixing" it here would be the very break this guards.
    const legacyId = Buffer.from(sha256(`${wallet.type}${wallet.getSecret()}${wallet.getPassphrase()}${"m/84'/0'/0'"}`)).toString('hex');
    expect(wallet.getID()).toBe(legacyId);
  });

  describe('deserialization', () => {
    it('treats a stored wallet with no networkId as mainnet, whatever is selected', () => {
      setActiveNetwork('signet');
      const restored = HDSilentPaymentsWallet.fromJson(
        JSON.stringify({ type: HDSilentPaymentsWallet.type, secret: TEST_SEED, _derivationPath: "m/84'/0'/0'" }),
      );
      expect(restored.networkId).toBe('bitcoin');
    });

    it('round-trips the network through storage', () => {
      for (const networkId of NETWORK_IDS) {
        const wallet = makeWallet(networkId);
        // Mirrors what saveToDisk does: prepare, then shallow-copy the instance's own properties.
        wallet.prepareForSerialization();
        const serialized = JSON.stringify({ ...wallet, type: wallet.type });

        setActiveNetwork('bitcoin');
        const restored = HDSilentPaymentsWallet.fromJson(serialized);
        expect(restored.networkId).toBe(networkId);
        expect(restored.getID()).toBe(wallet.getID());
      }
    });

    it('rejects an unrecognised stored networkId rather than trusting it', () => {
      const restored = HDSilentPaymentsWallet.fromJson(
        JSON.stringify({ type: HDSilentPaymentsWallet.type, secret: TEST_SEED, networkId: 'dogecoin' }),
      );
      expect(restored.networkId).toBe('bitcoin');
    });

    // A blob with no `_derivationPath` falls back to the class default. That default has to come
    // from the *stored* network, not whichever chain happens to be selected while loading —
    // otherwise a legacy mainnet wallet is handed coin type 1' keys and a different getID().
    it('derives the default path from the stored network, not the active one', () => {
      setActiveNetwork('signet');
      const restored = HDSilentPaymentsWallet.fromJson(JSON.stringify({ type: HDSilentPaymentsWallet.type, secret: TEST_SEED }));

      expect(restored.networkId).toBe('bitcoin');
      expect(restored.getDerivationPath()).toBe("m/86'/0'/0'");

      const legacyId = Buffer.from(sha256(`${restored.type}${restored.getSecret()}${restored.getPassphrase()}${"m/86'/0'/0'"}`)).toString(
        'hex',
      );
      expect(restored.getID()).toBe(legacyId);
    });

    it('derives the default path for a stored test-chain wallet whatever is selected', () => {
      setActiveNetwork('bitcoin');
      const restored = HDSilentPaymentsWallet.fromJson(
        JSON.stringify({ type: HDSilentPaymentsWallet.type, secret: TEST_SEED, networkId: 'signet' }),
      );

      expect(restored.networkId).toBe('signet');
      expect(restored.getDerivationPath()).toBe("m/86'/1'/0'");
    });

    it('keeps a stored derivation path over the network default', () => {
      setActiveNetwork('signet');
      const restored = HDSilentPaymentsWallet.fromJson(
        JSON.stringify({ type: HDSilentPaymentsWallet.type, secret: TEST_SEED, _derivationPath: "m/84'/0'/0'" }),
      );
      expect(restored.getDerivationPath()).toBe("m/84'/0'/0'");
    });
  });

  describe('addresses', () => {
    it('encodes silent payment addresses with the sp HRP on mainnet and tsp on the test chains', () => {
      expect(makeWallet('bitcoin').getSilentPaymentAddress()!.startsWith('sp1')).toBe(true);
      expect(makeWallet('testnet4').getSilentPaymentAddress()!.startsWith('tsp1')).toBe(true);
      expect(makeWallet('signet').getSilentPaymentAddress()!.startsWith('tsp1')).toBe(true);
    });

    it('round-trips a tsp1 address through decode on the test chains', () => {
      const wallet = makeWallet('signet');
      const address = wallet.getSilentPaymentAddress()!;
      const decoded = decodeSilentPaymentAddress(address, bitcoin.networks.testnet);
      expect(Buffer.from(decoded.spendKey).toString('hex')).toBe(Buffer.from(wallet.getSpendPublicKey()).toString('hex'));
    });

    it('refuses to decode a tsp1 address as mainnet and vice versa', () => {
      const mainnetAddress = makeWallet('bitcoin').getSilentPaymentAddress()!;
      const testnetAddress = makeWallet('signet').getSilentPaymentAddress()!;

      expect(() => decodeSilentPaymentAddress(testnetAddress, bitcoin.networks.bitcoin)).toThrow();
      expect(() => decodeSilentPaymentAddress(mainnetAddress, bitcoin.networks.testnet)).toThrow();
    });

    it('derives identical silent payment addresses on testnet4 and signet', () => {
      // Expected, not a bug: both are coin type 1' with the `tb` HRP. It is exactly why storage
      // segregation keys on networkId rather than on the address or derivation path.
      expect(makeWallet('testnet4').getSilentPaymentAddress()).toBe(makeWallet('signet').getSilentPaymentAddress());
    });

    it('emits bc1p receive addresses on mainnet and tb1p on the test chains', () => {
      expect(makeWallet('bitcoin')._getExternalAddressByIndex(0).startsWith('bc1p')).toBe(true);
      expect(makeWallet('testnet4')._getExternalAddressByIndex(0).startsWith('tb1p')).toBe(true);
    });

    it('exposes a tpub on the test chains and an xpub on mainnet', () => {
      expect(makeWallet('bitcoin').getXpub().startsWith('xpub')).toBe(true);
      expect(makeWallet('signet').getXpub().startsWith('tpub')).toBe(true);
    });

    it('accepts only same-network addresses in isAddressValid', () => {
      const mainnetWallet = makeWallet('bitcoin');
      const signetWallet = makeWallet('signet');
      const mainnetAddress = mainnetWallet._getExternalAddressByIndex(0);
      const testnetAddress = signetWallet._getExternalAddressByIndex(0);

      expect(mainnetWallet.isAddressValid(mainnetAddress)).toBe(true);
      expect(mainnetWallet.isAddressValid(testnetAddress)).toBe(false);
      expect(signetWallet.isAddressValid(testnetAddress)).toBe(true);
      expect(signetWallet.isAddressValid(mainnetAddress)).toBe(false);
    });
  });

  it('scan floor is the BIP-352 activation height on mainnet and unrestricted on the test chains', () => {
    expect(makeWallet('bitcoin').getEffectiveBirthHeight()).toBe(842579);
    expect(makeWallet('signet').getEffectiveBirthHeight()).toBe(0);
  });

  it('does not leak the active network between assertions', () => {
    setActiveNetwork('bitcoin');
    expect(getActiveNetworkId()).toBe('bitcoin');
  });

  describe('electrum fallback peers', () => {
    it('follows the active network', () => {
      setActiveNetwork('bitcoin');
      expect(getHardcodedPeers().length).toBeGreaterThan(0);

      setActiveNetwork('testnet4');
      expect(getHardcodedPeers()).toEqual([{ host: 'testnet.aranguren.org', ssl: 52002 }]);
    });

    it('ships the signet server on signet, and never a peer from another chain', () => {
      setActiveNetwork('signet');
      expect(getHardcodedPeers()).toEqual([{ host: 'electrum.signet.shroudwallet.com', ssl: 50002 }]);

      // Each chain's list must stay its own: a mainnet or testnet4 server answering for signet
      // would read empty scripthashes as a zero balance.
      const hosts = (id: 'bitcoin' | 'testnet4' | 'signet') => {
        setActiveNetwork(id);
        return getHardcodedPeers().map(peer => peer.host);
      };
      expect(hosts('signet').filter(host => hosts('bitcoin').includes(host) || hosts('testnet4').includes(host))).toEqual([]);
    });

    it('never hands back an SSL-less peer, since connectMain picks the transport from it', () => {
      for (const networkId of NETWORK_IDS) {
        setActiveNetwork(networkId);
        getHardcodedPeers().forEach(peer => expect(peer.ssl ?? peer.tcp).toBeDefined());
      }
    });
  });
});
