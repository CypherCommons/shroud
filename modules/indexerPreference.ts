import DefaultPreference from 'react-native-default-preference';
import { GROUP_IO_SHROUD } from './currency';
import { getNetwork, NETWORK_IDS, type NetworkId } from './network';
import type { SilentPaymentIndexerConfig } from '../helpers/silent-payments/types';

export type IndexerPreference = { baseUrl: string; onionUrl?: string };
const preferences: Partial<Record<NetworkId, IndexerPreference>> = {};
const preferenceKey = (id: NetworkId) => `IndexerPreference_${id}`;

export function normalizeIndexerUrl(value: string, onion = false): string {
  const url = new URL(value.trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Invalid indexer URL');
  }
  const isOnion = url.hostname.endsWith('.onion');
  if (onion ? !isOnion || url.protocol !== 'http:' : isOnion) throw new Error('Invalid indexer URL');
  return url.toString().replace(/\/+$/, '');
}

export function getIndexerPreference(id: NetworkId): IndexerPreference | undefined {
  return preferences[id];
}

export async function hydrateIndexerPreferences(): Promise<void> {
  await DefaultPreference.setName(GROUP_IO_SHROUD);
  for (const id of NETWORK_IDS) {
    delete preferences[id];
    try {
      const stored = await DefaultPreference.get(preferenceKey(id));
      if (typeof stored !== 'string' || !stored) continue;
      const parsed = JSON.parse(stored);
      preferences[id] = {
        baseUrl: normalizeIndexerUrl(parsed.baseUrl),
        onionUrl: parsed.onionUrl ? normalizeIndexerUrl(parsed.onionUrl, true) : undefined,
      };
    } catch {
      // Corrupt or obsolete preferences must not prevent startup with the built-in indexer.
    }
  }
}

export async function saveIndexerPreference(id: NetworkId, preference?: IndexerPreference): Promise<void> {
  const normalized = preference
    ? {
        baseUrl: normalizeIndexerUrl(preference.baseUrl),
        onionUrl: preference.onionUrl ? normalizeIndexerUrl(preference.onionUrl, true) : undefined,
      }
    : undefined;
  await DefaultPreference.setName(GROUP_IO_SHROUD);
  await DefaultPreference.set(preferenceKey(id), normalized ? JSON.stringify(normalized) : '');
  if (normalized) preferences[id] = normalized;
  else delete preferences[id];
}

export function getIndexerConfig(id: NetworkId): SilentPaymentIndexerConfig {
  const network = getNetwork(id);
  const custom = preferences[id];
  const defaults = {
    baseUrl: network.indexerBaseUrl,
    onionUrl: network.indexerOnionUrl || undefined,
    timeout: 100000,
  };
  // Never pair a custom clearnet endpoint with the default operator's onion endpoint.
  return custom ? { ...custom, timeout: 8000, fallback: defaults.baseUrl ? defaults : undefined } : defaults;
}
