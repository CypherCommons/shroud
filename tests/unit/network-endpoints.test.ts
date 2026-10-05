import { createHash } from 'crypto';
import { configureIndexerEndpoints, getAllNetworks, getNetwork, type NetworkId } from '../../modules/network';

// RFC 4648 base32 (lowercase, no padding) — enough to take a v3 onion address apart.
const base32Decode = (input: string): Buffer => {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
  let bits = '';
  for (const ch of input) bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  const bytes = bits.match(/.{8}/g) ?? [];
  return Buffer.from(bytes.map(b => parseInt(b, 2)));
};

/** A v3 onion address is base32(pubkey || checksum || 0x03); the checksum catches a mistyped one. */
const isValidV3Onion = (url: string): boolean => {
  const match = url.match(/^http:\/\/([a-z2-7]{56})\.onion$/);
  if (!match) return false;
  const raw = base32Decode(match[1]);
  const pubkey = raw.subarray(0, 32);
  const checksum = raw.subarray(32, 34);
  const version = raw.subarray(34);
  const expected = createHash('sha3-256')
    .update(Buffer.concat([Buffer.from('.onion checksum'), pubkey, version]))
    .digest()
    .subarray(0, 2);
  return version[0] === 3 && checksum.equals(expected);
};

describe('shipped indexer addresses', () => {
  it('gives every network a clearnet and an onion indexer, so none needs a .env', () => {
    for (const network of getAllNetworks()) {
      expect(network.indexerBaseUrl).toMatch(/^https:\/\/[a-z0-9.-]+$/);
      expect(network.indexerOnionUrl).not.toBe('');
    }
  });

  // Typos in a hand-copied onion address fail silently (Tor just never connects), so check the
  // address's own checksum rather than trusting the eye.
  it('ships well-formed v3 onion addresses', () => {
    for (const network of getAllNetworks()) {
      expect({ id: network.id, valid: isValidV3Onion(network.indexerOnionUrl) }).toEqual({ id: network.id, valid: true });
    }
  });

  // One shared address would send a chain's scans to another chain's indexer.
  it('never shares an address between networks', () => {
    const bases = getAllNetworks().map(n => n.indexerBaseUrl);
    const onions = getAllNetworks().map(n => n.indexerOnionUrl);
    expect(new Set(bases).size).toBe(bases.length);
    expect(new Set(onions).size).toBe(onions.length);
  });

  it('keeps each chain’s own name in its clearnet address', () => {
    expect(getNetwork('bitcoin').indexerBaseUrl).not.toMatch(/testnet|signet/);
    expect(getNetwork('testnet4').indexerBaseUrl).toMatch(/testnet/);
    expect(getNetwork('signet').indexerBaseUrl).toMatch(/signet/);
  });
});

describe('overriding the shipped addresses', () => {
  const shipped = (id: NetworkId) => ({ base: getNetwork(id).indexerBaseUrl, onion: getNetwork(id).indexerOnionUrl });

  it('keeps the default for a missing or blank value', () => {
    const before = shipped('signet');
    configureIndexerEndpoints({ signet: '', bitcoin: undefined }, { signet: undefined });
    expect(shipped('signet')).toEqual(before);
    expect(getNetwork('bitcoin').indexerBaseUrl).toBe('https://indexer.shroudwallet.com');
  });

  it('replaces only what is set, stripping a trailing slash', () => {
    const untouched = shipped('bitcoin');
    configureIndexerEndpoints({ signet: 'https://my-signet.example/' }, { signet: 'http://override.onion/' });

    expect(shipped('signet')).toEqual({ base: 'https://my-signet.example', onion: 'http://override.onion' });
    expect(shipped('bitcoin')).toEqual(untouched);
  });
});
