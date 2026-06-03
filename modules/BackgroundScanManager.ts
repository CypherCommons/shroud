import { NativeEventEmitter, NativeModules, Platform } from 'react-native';

const LINKING_ERROR =
  `The 'BackgroundScanManager' module is not properly linked. ` +
  `Please ensure you've rebuilt the app after adding the native module.\n\n` +
  Platform.select({
    ios: "- Run 'cd ios && pod install && cd ..'\n",
    android: '- Ensure the BackgroundScanPackage is registered in MainApplication\n',
    default: '',
  }) +
  `- Rebuild the app (npx react-native run-ios or run-android)`;

const BackgroundScanManagerModule = NativeModules.BackgroundScanManager
  ? NativeModules.BackgroundScanManager
  : new Proxy(
      {},
      {
        get() {
          throw new Error(LINKING_ERROR);
        },
      },
    );

export interface BackgroundScanStartEvent {
  taskId: string;
  timeBudgetMs: number;
}

export interface BackgroundScanCancelEvent {
  taskId: string;
}

export interface BackgroundScanStatus {
  enabled: boolean;
  lastRunAt: number | null;
  available: boolean;
}

/** Enable + schedule periodic background scanning (WorkManager / BGTaskScheduler). */
export function startBackgroundScanning(): Promise<boolean> {
  return BackgroundScanManagerModule.start();
}

/** Cancel all scheduled background scanning. */
export function stopBackgroundScanning(): Promise<boolean> {
  return BackgroundScanManagerModule.stop();
}

export function getBackgroundScanStatus(): Promise<BackgroundScanStatus> {
  return BackgroundScanManagerModule.getStatus();
}

/**
 * Signal the native side that the background scan for `taskId` is done.
 * iOS: maps to BGTask.setTaskCompleted. Android: no-op (the headless task's
 * promise resolution notifies completion), kept for API symmetry.
 */
export function finishBackgroundScan(taskId: string, success: boolean): void {
  BackgroundScanManagerModule.finish(taskId, success);
}

/** Post a local notification. Safe to call from a headless/background context. */
export function postLocalNotification(title: string, body: string): Promise<void> {
  return BackgroundScanManagerModule.postNotification(title, body);
}

/** Foreground-only: prompts the user for notification permission. */
export function requestNotificationPermission(): Promise<boolean> {
  return BackgroundScanManagerModule.requestNotificationPermission();
}

/**
 * iOS-only event channel: a fired BGTask emits onBackgroundScanStart, and the
 * expiration handler emits onBackgroundScanCancel. Android drives the scan via
 * the registered headless task instead. Listeners must attach at module load
 * (index.js) so a cold background launch can reach JS.
 */
export function getBackgroundScanEventEmitter(): NativeEventEmitter | null {
  if (Platform.OS !== 'ios' || !NativeModules.BackgroundScanManager) return null;
  return new NativeEventEmitter(NativeModules.BackgroundScanManager);
}
