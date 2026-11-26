import { useEffect, useRef, useState } from 'react';

import type { ScanStatus } from '../helpers/silent-payments';

/** The Sync screen's layouts: the scan's statuses, with `idle` read as done, the wallet caught up. */
export type SyncDisplayStatus = Exclude<ScanStatus, 'idle'> | 'done';

// A scan has to run this long before the screen swaps to its progress layout, so the scan each new
// block brings (often over in a few hundred milliseconds) doesn't flash it.
const SCANNING_SHOW_DELAY_MS = 400;
// Once shown, the progress layout stays at least this long, so a scan ending right after it appeared
// doesn't flicker it away.
const SCANNING_MIN_VISIBLE_MS = 800;

const isSwap = (a: SyncDisplayStatus, b: SyncDisplayStatus) => (a === 'scanning' && b === 'paused') || (a === 'paused' && b === 'scanning');
const isLanding = (status: SyncDisplayStatus) => status === 'done' || status === 'error';

/**
 * How long until the screen moves from the `shown` layout to the `target` one, or null to stay put for
 * now. `hold` is a check under way, whose outcome decides between done and error.
 */
export function syncDisplayDelay(
  shown: SyncDisplayStatus,
  target: SyncDisplayStatus,
  { hold, targetForMs, shownForMs }: { hold: boolean; targetForMs: number; shownForMs: number },
): number | null {
  if (shown === target) return null;
  if (isSwap(shown, target)) return 0;
  if (target === 'scanning') return Math.max(0, SCANNING_SHOW_DELAY_MS - targetForMs);
  if (shown === 'scanning' && target === 'done') return Math.max(0, SCANNING_MIN_VISIBLE_MS - shownForMs);
  // the check settles it, with its outcome, rather than the screen flipping under a busy button
  if (hold && isLanding(shown) && isLanding(target)) return null;
  return 0;
}

/**
 * The layout the Sync screen shows for the wallet's scan `status`, with hysteresis (see
 * syncDisplayDelay), so short scans don't flash it. `settled` is false while a change is pending.
 */
export function useSyncDisplayStatus(status: ScanStatus, hold: boolean): { status: SyncDisplayStatus; settled: boolean } {
  const target: SyncDisplayStatus = status === 'idle' ? 'done' : status;
  const [shown, setShown] = useState<SyncDisplayStatus>(target);
  // when the target and the shown layout last changed, so a pending wait survives `hold` changing. On the
  // monotonic clock: a clock change can't stretch a wait.
  const since = useRef({ target: 0, shown: 0 });

  // Pause and Continue land with the wallet's emit, in the same commit: the two layouts differ only in
  // their words and icons.
  if (isSwap(shown, target)) {
    setShown(target);
  }

  useEffect(() => {
    since.current.target = performance.now();
  }, [target]);

  useEffect(() => {
    since.current.shown = performance.now();
  }, [shown]);

  useEffect(() => {
    const now = performance.now();
    const delay = syncDisplayDelay(shown, target, { hold, targetForMs: now - since.current.target, shownForMs: now - since.current.shown });
    if (delay === null) return;

    // a timer even for no delay, since setting state in the effect itself would cascade into another render
    const timer = setTimeout(() => setShown(target), delay);
    return () => clearTimeout(timer);
  }, [shown, target, hold]);

  return { status: shown, settled: shown === target };
}
