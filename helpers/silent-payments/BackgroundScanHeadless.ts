import { finishBackgroundScan } from '../../modules/BackgroundScanManager';
import { runBackgroundScan } from './BackgroundScanTask';

export interface BackgroundScanTaskData {
  taskId?: string;
  timeBudgetMs?: number;
  reason?: 'ios-refresh' | 'ios-processing' | 'android-worker';
}

const DEFAULT_TIME_BUDGET_MS = 25000;

/**
 * Entry point for OS-driven background scans.
 * Android: registered via AppRegistry.registerHeadlessTask('BackgroundScan', ...)
 * and started by BackgroundScanService — the resolved promise notifies completion.
 * iOS: invoked by the onBackgroundScanStart listener in index.js; finish() maps
 * to BGTask.setTaskCompleted, so it MUST be called on every path.
 */
export default async function BackgroundScanHeadless(data: BackgroundScanTaskData): Promise<void> {
  let success = false;

  try {
    const result = await runBackgroundScan({
      timeBudgetMs: data?.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS,
      reason: data?.reason,
    });
    // Bailing because the live app owns scanning is a successful no-op, not a failure.
    success = result.bailedReason === undefined || result.bailedReason === 'foreground-active';
  } catch (error) {
    console.warn('[BackgroundScan] Task failed:', error);
  } finally {
    if (data?.taskId) {
      try {
        finishBackgroundScan(data.taskId, success);
      } catch (error) {
        console.warn('[BackgroundScan] finish() failed:', error);
      }
    }
  }
}
