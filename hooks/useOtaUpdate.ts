import { useCallback, useEffect, useState } from 'react';
import * as Updates from 'expo-updates';

import { useTheme } from '../components/themes';
import { isUpdateGateEnabled } from '../helpers/e2e';

export type OtaScreen =
  | { kind: 'hidden' }
  /**
   * `progress` is 0 to 1, or null when there's nothing meaningful to show (an indeterminate bar).
   * `slow`: the download has run long enough to offer carrying on without it.
   */
  | { kind: 'downloading'; progress: number | null; slow: boolean }
  | { kind: 'ready' }
  | { kind: 'restarting' }
  | { kind: 'error' };

export type UpdatesSnapshot = Pick<
  Updates.UseUpdatesReturnType,
  | 'currentlyRunning'
  | 'availableUpdate'
  | 'isUpdateAvailable'
  | 'isUpdatePending'
  | 'isDownloading'
  | 'isRestarting'
  | 'downloadError'
  | 'downloadProgress'
>;

// After this long on the downloading screen, the user may carry on without the update. A slow but
// moving download never times out, and the screen never goes away by itself: only the user can skip it.
export const SLOW_DOWNLOAD_MS = 60 * 1000;

const HIDDEN: OtaScreen = { kind: 'hidden' };

/**
 * How far the last file still downloading has got, or null if that can't be told. `fileCount` counts
 * every file of the update, the JavaScript bundle included.
 *
 * expo-updates reports progress as the average over every file of the update, with the ones already on
 * the device counted as done. An update is one JavaScript bundle plus ~50 images that rarely change, so
 * that average sits near 98% for the whole download. Only the last file left can be shown as a real
 * percentage, and only if it reports its bytes. A compressed response doesn't: on Android, expo-updates
 * decompresses before it counts. With update-server/README.md's compression that's never the bundle,
 * but serving it uncompressed would turn the percentage on with no change here.
 */
export const lastFileProgress = (progress: number | undefined, fileCount: number): number | null => {
  if (progress === undefined || fileCount < 1) return null;
  const floor = (fileCount - 1) / fileCount;
  return progress > floor && progress < 1 ? (progress - floor) * fileCount : null;
};

const fileCountOf = (update: UpdatesSnapshot['availableUpdate']): number => {
  const manifest = update?.manifest;
  // Updates from a server have a launchAsset (the bundle) next to their assets.
  return manifest && 'launchAsset' in manifest && Array.isArray(manifest.assets) ? manifest.assets.length + 1 : 0;
};

/** Which update screen to show, if any. */
export const deriveOtaScreen = (
  updates: UpdatesSnapshot,
  { dismissed, restarting, slow }: { dismissed: boolean; restarting: boolean; slow: boolean },
): OtaScreen => {
  if (dismissed) return HIDDEN;
  if (restarting || updates.isRestarting) return { kind: 'restarting' };
  if (updates.isUpdatePending) return { kind: 'ready' };
  // Ahead of the error: a retry starts downloading without clearing the last downloadError.
  if (updates.isDownloading) {
    return { kind: 'downloading', progress: lastFileProgress(updates.downloadProgress, fileCountOf(updates.availableUpdate)), slow };
  }
  if (updates.downloadError && updates.isUpdateAvailable) return { kind: 'error' };

  // A roll-back to the code built into the app downloads nothing and only needs a restart. The server
  // can resend an old roll-back (update-server/README.md), so it counts only if newer than what runs.
  const available = updates.availableUpdate;
  const runningSince = updates.currentlyRunning?.createdAt;
  if (available?.type === Updates.UpdateInfoType.ROLLBACK && (!runningSince || available.createdAt > runningSince)) {
    return { kind: 'ready' };
  }
  return HIDDEN;
};

/**
 * Holds the app while expo-updates downloads an update it found at launch, then asks for a restart.
 * A failed or slow download can be skipped for this session; the next launch tries again.
 */
export const useOtaUpdate = () => {
  const updates = Updates.useUpdates();
  const { colors } = useTheme();
  // Decided once per mount rather than when the module loads, so tests can set __DEV__ first.
  const [enabled] = useState(() => isUpdateGateEnabled() && Updates.isEnabled);
  const [dismissed, setDismissed] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [slow, setSlow] = useState(false);

  const screen = enabled ? deriveOtaScreen(updates, { dismissed, restarting, slow }) : HIDDEN;

  // Each stretch on the downloading screen gets its own minute, so a retry after an error starts over.
  useEffect(() => {
    if (screen.kind !== 'downloading') return;
    const timer = setTimeout(() => setSlow(true), SLOW_DOWNLOAD_MS);
    return () => {
      clearTimeout(timer);
      setSlow(false);
    };
  }, [screen.kind]);

  const restart = useCallback(() => {
    setRestarting(true);
    Updates.reloadAsync({
      // expo-updates always shows a reload screen, white with a blue spinner unless told otherwise.
      reloadScreenOptions: { backgroundColor: colors.background, spinner: { enabled: true, color: colors.brandPrimary }, fade: true },
    }).catch(() => {
      // The update is on disk and starts with the next launch anyway, so let the user back in.
      setRestarting(false);
      setDismissed(true);
    });
  }, [colors.background, colors.brandPrimary]);

  // The outcome comes back through useUpdates. A second tap queues behind the first and finds the
  // update already downloaded.
  const retry = useCallback(() => {
    Updates.fetchUpdateAsync().catch(() => {});
  }, []);

  const dismiss = useCallback(() => setDismissed(true), []);

  return { screen, restart, retry, dismiss };
};
