import * as bitcoin from 'bitcoinjs-lib';

import { BIP352_ACTIVATION_HEIGHT } from './constants';

/**
 * Bitcoin network support.
 *
 * Three ideas are deliberately kept apart here, because conflating them is the source of every
 * subtle multi-network bug:
 *
 *  - `NetworkId` — the *chain identity*. The unit of storage segregation, wallet identity,
 *    backend selection (indexer, Electrum, explorer) and scan floor.
 *  - `NetworkConfig.bitcoinjs` — the *address encoding*. Governs address encode/decode, the
 *    xpub-vs-tpub prefix, the WIF version byte and PSBT output construction.
 *  - `NetworkConfig.coinType` — the *derivation*. BIP-44/84/86/352 coin type.
 *
 * The consequence that matters: **testnet4 and signet are indistinguishable at the address
 * layer.** Both are `tb1` / `tpub` / `tsp1` / coin type 1', and bitcoinjs has a single `testnet`
 * object that correctly serves both. So the same seed derives *identical* addresses on testnet4
 * and signet, and anything that needs to keep the two apart — stored wallets, transaction
 * history, wallet IDs — must key on `NetworkId`, never on `bitcoinjs` or the derivation path.
 *
 * This module is intentionally a leaf: no react-native imports, no environment reads, no storage access.
 * Wallet classes call `getActiveNetwork()` from synchronous code paths, and unit tests import
 * those classes without any mocking. Persistence lives in the settings layer. Each network ships
 * its own indexer addresses; `configureIndexerEndpoints` lets `.env` override them at startup.
 */

export type NetworkId = 'bitcoin' | 'testnet4' | 'signet';

export const NETWORK_IDS: readonly NetworkId[] = ['bitcoin', 'testnet4', 'signet'] as const;

export const DEFAULT_NETWORK_ID: NetworkId = 'bitcoin';

export interface Peer {
  host: string;
  ssl?: number;
  tcp?: number;
}

export interface NetworkConfig {
  id: NetworkId;
  displayName: string;
  /**
   * Whether the network is offered in the UI and can be switched to or started on. Switching a
   * network off removes nothing: it stays in the registry, its stored wallets stay on disk (the
   * app only ever filters by chain on read, never on write), and wallet IDs and derivation keep
   * working. It just cannot be selected, so bringing it back is flipping this flag.
   */
  enabled: boolean;
  /** Address encoding, xpub/tpub prefix, WIF version byte, PSBT. Shared by testnet4 + signet. */
  bitcoinjs: bitcoin.Network;
  /** BIP-44 coin type for every derivation path. 1' for all test chains. */
  coinType: 0 | 1;
  isTestnet: boolean;
  /**
   * Floor for silent-payment scanning. On mainnet this is the BIP-352 merge height, which saves
   * scanning ~840k pointless blocks.
   *
   * Deliberately 0 on testnet4 and signet. The index start is deployment config of whoever runs
   * that chain's indexer and the client cannot ask for it, so a constant here would be a guess
   * about a remote service, and too high a floor silently skips payments. The cost is that a
   * fresh wallet scans from genesis, with progress and ETA reported over the whole range: ~3,100
   * sequential 50-block requests on testnet4 today (the live indexer returns nothing below block
   * 4403, so ~90 of them are wasted) and ~6,500 on signet (~325k blocks). If that becomes a
   * problem, the fix is an indexer endpoint reporting its index start, not a number here.
   */
  bip352ActivationHeight: number;
  /**
   * Fallback peers used for round-robin when the user has not picked a server. Electrum only
   * powers the regular-output branch, so a chain with an empty list is a normal state, not an
   * error — the user can still enter a server by hand in the network settings.
   */
  electrumPeers: Peer[];
  explorerTxUrl: (txid: string) => string;
  /**
   * This chain's silent-payment indexer. Shipped here as the default; `.env` can override it via
   * `configureIndexerEndpoints`. Empty means none, and the network cannot be switched to. Kept
   * without a trailing slash.
   */
  indexerBaseUrl: string;
  /**
   * This chain's indexer as a .onion address, used when Tor is enabled. Per network on purpose: a
   * single onion address would send test-chain scans to the mainnet indexer over Tor. Plain
   * `http://` (onion services carry their own encryption, and the Tor client rejects https).
   * Empty when none is configured.
   */
  indexerOnionUrl: string;
}

const MAINNET_ELECTRUM_PEERS: Peer[] = [
  { host: 'mainnet.foundationdevices.com', ssl: 50002 },
  { host: 'bitcoin.lu.ke', ssl: 50002 },
  { host: 'electrum1.bluewallet.io', ssl: 443 },
  { host: 'electrum.acinq.co', ssl: 50002 },
  { host: 'electrum.bitaroo.net', ssl: 50002 },
];

// testnet.aranguren.org's public Fulcrum server, protocol 1.4 over TLS (self-signed certificate,
// which the Electrum client accepts). The host serves several chains on different ports and only
// 52002 is testnet4: 51002 is testnet3, whose scripthashes come back empty here and whose
// broadcasts a testnet4 transaction would never survive.
const TESTNET4_ELECTRUM_PEERS: Peer[] = [{ host: 'testnet.aranguren.org', ssl: 52002 }];

// The project's own signet Fulcrum, protocol 1.4 over TLS (self-signed certificate, which the
// Electrum client accepts). Its server.features reports the signet genesis hash.
const SIGNET_ELECTRUM_PEERS: Peer[] = [{ host: 'electrum.signet.shroudwallet.com', ssl: 50002 }];

const NETWORKS: Record<NetworkId, NetworkConfig> = {
  bitcoin: {
    id: 'bitcoin',
    displayName: 'Mainnet',
    enabled: true,
    bitcoinjs: bitcoin.networks.bitcoin,
    coinType: 0,
    isTestnet: false,
    bip352ActivationHeight: BIP352_ACTIVATION_HEIGHT,
    electrumPeers: MAINNET_ELECTRUM_PEERS,
    explorerTxUrl: txid => `https://mempool.space/tx/${txid}`,
    indexerBaseUrl: 'https://indexer.shroudwallet.com',
    indexerOnionUrl: 'http://o35owjo2xm7dgow27qsgpdxfss3sgr3m5npwzqp75xl43pvsqfqgnqqd.onion',
  },
  testnet4: {
    id: 'testnet4',
    displayName: 'Testnet4',
    // Switched off while its indexer is down. Existing testnet4 wallets are left in storage.
    enabled: false,
    bitcoinjs: bitcoin.networks.testnet,
    coinType: 1,
    isTestnet: true,
    bip352ActivationHeight: 0,
    electrumPeers: TESTNET4_ELECTRUM_PEERS,
    explorerTxUrl: txid => `https://mempool.space/testnet4/tx/${txid}`,
    // Listed even while the network is switched off, so re-enabling it is one flag.
    indexerBaseUrl: 'https://indexer.testnet.shroudwallet.com',
    indexerOnionUrl: 'http://jtkkqmdbbpybbt2dwa5rxv6j2bh4swnlyoxg2r6xmxhse7ys4a3um2ad.onion',
  },
  signet: {
    id: 'signet',
    displayName: 'Signet',
    enabled: true,
    bitcoinjs: bitcoin.networks.testnet,
    coinType: 1,
    isTestnet: true,
    bip352ActivationHeight: 0,
    electrumPeers: SIGNET_ELECTRUM_PEERS,
    explorerTxUrl: txid => `https://mempool.space/signet/tx/${txid}`,
    indexerBaseUrl: 'https://indexer.signet.shroudwallet.com',
    indexerOnionUrl: 'http://ixvamjnrnsdddttgoomf5bhr2kowkuyxifc6ojqllspdg5xz2cgr3iid.onion',
  },
};

let activeNetworkId: NetworkId = DEFAULT_NETWORK_ID;

export function isNetworkId(value: unknown): value is NetworkId {
  return typeof value === 'string' && (NETWORK_IDS as readonly string[]).includes(value);
}

export function getNetwork(id: NetworkId): NetworkConfig {
  return NETWORKS[id];
}

export function getAllNetworks(): NetworkConfig[] {
  return NETWORK_IDS.map(id => NETWORKS[id]);
}

export function isNetworkEnabled(id: NetworkId): boolean {
  return NETWORKS[id].enabled;
}

/** The networks the UI may offer. Use this, not `getAllNetworks`, for anything user-facing. */
export function getEnabledNetworks(): NetworkConfig[] {
  return getAllNetworks().filter(network => network.enabled);
}

export function getActiveNetwork(): NetworkConfig {
  return NETWORKS[activeNetworkId];
}

export function getActiveNetworkId(): NetworkId {
  return activeNetworkId;
}

/**
 * Switch the process-wide active network. Callers are responsible for the surrounding teardown
 * and reload — see the network switch in StorageProvider. Nothing here invalidates wallet
 * caches, because wallets are rebuilt from storage rather than mutated in place.
 */
export function setActiveNetwork(id: NetworkId): void {
  activeNetworkId = id;
}

/**
 * Override the shipped indexer addresses from the environment. A missing or empty value keeps the
 * default, so a blank `.env` entry is harmless. Called once from App startup, which is the only
 * place that reads the `EXPO_PUBLIC_INDEXER_*` variables — keeping this module importable from
 * tests without the build-time inlining those reads depend on.
 */
export function configureIndexerEndpoints(
  urls: Partial<Record<NetworkId, string | undefined>>,
  onionUrls: Partial<Record<NetworkId, string | undefined>> = {},
): void {
  for (const id of NETWORK_IDS) {
    const url = urls[id];
    if (url) NETWORKS[id].indexerBaseUrl = url.replace(/\/$/, '');
    const onionUrl = onionUrls[id];
    if (onionUrl) NETWORKS[id].indexerOnionUrl = onionUrl.replace(/\/$/, '');
  }
}
