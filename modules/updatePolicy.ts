import AsyncStorage from '@react-native-async-storage/async-storage';

import { UPDATE_SERVER_URL } from '../constants/links';
import { fetch } from '../util/fetch';

const PLATFORMS = ['ios', 'android'] as const;
type StorePlatform = (typeof PLATFORMS)[number];

/**
 * The oldest native build each platform may still run, from the update server's `GET /policy`
 * (set with scripts/ota/minimum-build.mjs). A build below it shows "Update required" and nothing else.
 *
 * The document is unsigned. Whoever controls the server can block installs below a build, but can't
 * send anyone elsewhere: the store links are built into the app (constants/links.ts).
 */
export type UpdatePolicy = { minimumBuild: Partial<Record<StorePlatform, number>> };

const STORAGE_KEY = 'UpdatePolicy';

const isStorePlatform = (platform: string): platform is StorePlatform => (PLATFORMS as readonly string[]).includes(platform);

/** The policy in `value`, or null if it isn't one. Unknown keys are ignored, so the format can grow. */
export const parseUpdatePolicy = (value: unknown): UpdatePolicy | null => {
  if (typeof value !== 'object' || value === null) return null;
  const minimumBuild: unknown = (value as { minimumBuild?: unknown }).minimumBuild;
  if (typeof minimumBuild !== 'object' || minimumBuild === null) return null;

  const policy: UpdatePolicy = { minimumBuild: {} };
  for (const platform of PLATFORMS) {
    const build: unknown = (minimumBuild as Record<string, unknown>)[platform];
    if (build === undefined) continue;
    // A malformed minimum throws out the whole document rather than guessing what it meant.
    if (typeof build !== 'number' || !Number.isSafeInteger(build) || build < 0) return null;
    policy.minimumBuild[platform] = build;
  }
  return policy;
};

/** CFBundleVersion or versionCode as a number. EAS hands out plain integers; anything else is null. */
export const parseBuildNumber = (value: string): number | null => (/^\d{1,15}$/.test(value) ? Number(value) : null);

/** Whether `build` is below the policy's minimum for `platform`. A build that can't be read is never blocked. */
export const isUpdateRequired = (policy: UpdatePolicy | null, platform: string, build: number | null): boolean => {
  if (!policy || build === null || !isStorePlatform(platform)) return false;
  const minimum = policy.minimumBuild[platform];
  return minimum !== undefined && build < minimum;
};

const loadSavedPolicy = async (): Promise<UpdatePolicy | null> => {
  try {
    const saved = await AsyncStorage.getItem(STORAGE_KEY);
    return saved === null ? null : parseUpdatePolicy(JSON.parse(saved));
  } catch {
    return null;
  }
};

/**
 * Works out the policy for `channel`. The one saved from the server's last answer goes to `onSaved`
 * first, so a block holds before an answer comes, or without one. The promise then resolves with the
 * policy to apply from then on:
 * - a policy from the server, which replaces the saved one;
 * - null after a 204 (none published), which clears the saved one;
 * - the saved one after anything else, from no connection to a malformed document. A failed check
 *   neither lifts a block nor adds one.
 *
 * Like expo-updates' own launch check to the same host, this goes over the regular internet even in
 * Tor-only mode, since socks5Fetch can't do https (RELEASE.md).
 */
export const resolvePolicy = async (channel: string, onSaved: (policy: UpdatePolicy | null) => void): Promise<UpdatePolicy | null> => {
  const saved = await loadSavedPolicy();
  onSaved(saved);

  let response: Response;
  try {
    response = await fetch(`${UPDATE_SERVER_URL}/policy`, { headers: { 'expo-channel-name': channel } });
  } catch {
    return saved;
  }

  if (response.status === 204) {
    await AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
    return null;
  }
  if (response.status !== 200) return saved;

  let policy: UpdatePolicy | null;
  try {
    policy = parseUpdatePolicy(await response.json());
  } catch {
    return saved;
  }
  if (!policy) return saved;
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(policy)).catch(() => {});
  return policy;
};
