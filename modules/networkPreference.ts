import DefaultPreference from 'react-native-default-preference';

import { GROUP_IO_SHROUD } from './currency';
import * as Electrum from './Electrum';
import { disconnectIndexer, initializeIndexer } from './SilentPaymentIndexer';
import {
  DEFAULT_NETWORK_ID,
  getActiveNetworkId,
  getNetwork,
  isNetworkEnabled,
  isNetworkId,
  setActiveNetwork,
  type NetworkId,
} from './network';

/**
 * Persistence and backend wiring for the active network.
 *
 * Kept separate from `modules/network.ts` on purpose: that module is a leaf that wallet classes
 * import from synchronous code, and pulling `react-native-default-preference` into it would drag
 * a native module into every wallet unit test.
 */

export const NETWORK_PREFERENCE_KEY = 'NetworkPreference';

const INDEXER_TIMEOUT_MS = 100000;

export async function readStoredNetworkId(): Promise<NetworkId> {
  try {
    await DefaultPreference.setName(GROUP_IO_SHROUD);
    const stored = await DefaultPreference.get(NETWORK_PREFERENCE_KEY);
    return isNetworkId(stored) ? stored : DEFAULT_NETWORK_ID;
  } catch (e) {
    console.error('Error reading the network preference:', e);
    return DEFAULT_NETWORK_ID;
  }
}

export async function persistNetworkId(id: NetworkId): Promise<void> {
  try {
    await DefaultPreference.setName(GROUP_IO_SHROUD);
    await DefaultPreference.set(NETWORK_PREFERENCE_KEY, id);
  } catch (e) {
    console.error('Error persisting the network preference:', e);
  }
}

/**
 * Apply the stored network before anything reads it.
 *
 * Must complete before the first wallet is deserialized and before the provider tree mounts:
 * `getActiveNetwork()` is synchronous and defaults to mainnet, so any consumer that runs earlier
 * would silently see the wrong chain.
 */
export async function hydrateActiveNetwork(): Promise<NetworkId> {
  const id = await readStoredNetworkId();
  setActiveNetwork(id);
  return id;
}

/** Throws if the chain is switched off in the registry (`enabled: false`). Side-effect free. */
export function assertNetworkEnabled(id: NetworkId): void {
  if (!isNetworkEnabled(id)) {
    throw new Error(`${getNetwork(id).displayName} is currently disabled.`);
  }
}

/** Throws if the chain has no indexer configured. Cheap and side-effect free, so call it first. */
export function assertIndexerConfigured(id: NetworkId): void {
  const network = getNetwork(id);
  if (!network.indexerBaseUrl) {
    throw new Error(`No silent payment indexer is configured for ${network.displayName}. Set INDEXER_BASE_URL_* in .env`);
  }
}

/** Everything that can be known about a switch before touching anything. Side-effect free. */
export function assertNetworkSwitchable(id: NetworkId): void {
  assertNetworkEnabled(id);
  assertIndexerConfigured(id);
}

/** Point the indexer singleton at the active chain. Throws if that chain has no indexer set. */
export function pointIndexerAtActiveNetwork(): void {
  const network = getNetwork(getActiveNetworkId());
  assertIndexerConfigured(network.id);
  disconnectIndexer();
  initializeIndexer({
    baseUrl: network.indexerBaseUrl,
    // This chain's own onion address, or none: never another chain's, or Tor would carry the
    // scan to the wrong indexer.
    onionUrl: network.indexerOnionUrl || undefined,
    timeout: INDEXER_TIMEOUT_MS,
  });
}

function reconnectElectrum(): void {
  // Best effort: a chain with no configured server simply stays disconnected, which is normal
  // on the test chains where silent payments run entirely off the indexer.
  Electrum.connectMain().catch(e => console.warn('Electrum reconnect after a network switch failed:', e));
}

/**
 * Apply the stored network and point the indexer at it, as the app starts.
 *
 * If the stored chain is switched off, or has no indexer (its URL was removed from `.env`, say),
 * the app would mount on a chain it cannot use, so it falls back to the default chain for this
 * run. The stored preference is left alone: re-enabling the chain, or configuring its indexer,
 * puts the user back where they were.
 */
export async function bootActiveNetwork(): Promise<{
  id: NetworkId;
  fellBackFrom?: NetworkId;
  reason?: 'disabled' | 'no-indexer';
}> {
  const stored = await hydrateActiveNetwork();
  if (!isNetworkEnabled(stored)) {
    setActiveNetwork(DEFAULT_NETWORK_ID);
    pointIndexerAtActiveNetwork();
    return { id: DEFAULT_NETWORK_ID, fellBackFrom: stored, reason: 'disabled' };
  }
  try {
    pointIndexerAtActiveNetwork();
    return { id: stored };
  } catch (e) {
    if (stored === DEFAULT_NETWORK_ID) throw e;
    setActiveNetwork(DEFAULT_NETWORK_ID);
    pointIndexerAtActiveNetwork();
    return { id: DEFAULT_NETWORK_ID, fellBackFrom: stored, reason: 'no-indexer' };
  }
}

/**
 * Tear down the current chain's connections and bring up the next one's.
 *
 * Deliberately does not touch wallet objects: they cache derived xpubs, nodes, seeds, spend keys
 * and UTXO views, and chasing every one of those is how state leaks across chains. The caller
 * reloads wallets from storage instead.
 *
 * Ordered so a failure cannot commit a half-switch: the target is validated before anything is
 * torn down, and the preference is written last, after the indexer has actually started. If this
 * throws after the module has moved, the caller restores it with `rollbackNetworkSwitch`.
 */
export async function switchNetworkBackends(next: NetworkId): Promise<void> {
  assertNetworkSwitchable(next);

  Electrum.resetForNetworkSwitch();

  setActiveNetwork(next);
  pointIndexerAtActiveNetwork();
  await persistNetworkId(next);

  reconnectElectrum();
}

/** Undo a `switchNetworkBackends` that threw (or a switch that failed after it): back to `previous`. */
export async function rollbackNetworkSwitch(previous: NetworkId): Promise<void> {
  setActiveNetwork(previous);
  await persistNetworkId(previous);
  try {
    pointIndexerAtActiveNetwork();
  } catch (e) {
    console.warn('Could not restore the indexer while rolling back a network switch:', e);
  }
  reconnectElectrum();
}
